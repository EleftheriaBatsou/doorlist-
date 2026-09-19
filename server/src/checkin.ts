import { withTx, type Tx } from './db.js';
import { verifyPayload } from './ticket-code.js';
import { bumpStat, getStats, publishLive, type EventStats } from './redis.js';

export type ScanResult = 'success' | 'already_used' | 'invalid' | 'wrong_event';

export interface ScanInput {
  eventId: string;
  /** Raw QR payload (signed) — or null when checking in by ticket id (manual). */
  payload?: string;
  ticketId?: string;
  deviceLabel?: string;
  /** Client-generated id; makes offline-queue retries idempotent. */
  clientScanId?: string;
  /** When the scan physically happened (offline scans sync later). */
  scannedAt?: string;
}

export interface ScanOutcome {
  result: ScanResult;
  reason?: 'cancelled' | 'bad_signature' | 'not_found' | 'other_event';
  ticket?: { id: string; name: string; email: string; checkedInAt: string | null; checkedInBy: string | null };
  otherEventTitle?: string;
  replayed?: boolean;
  stats?: EventStats | null;
}

/** Accept a client timestamp only if it is plausible (not in the future, < 24h old). */
function scanTime(scannedAt?: string): Date | null {
  if (!scannedAt) return null;
  const t = new Date(scannedAt);
  const now = Date.now();
  if (Number.isNaN(t.getTime()) || t.getTime() > now + 60_000 || t.getTime() < now - 86_400_000) return null;
  return t;
}

async function log(tx: Tx, input: ScanInput, result: ScanResult, ticketId: string | null, reason?: string) {
  await tx.query(
    `INSERT INTO check_in_log (ticket_id, event_id, ts, result, device_label, reason, client_scan_id)
     VALUES ($1, $2, COALESCE($3, now()), $4, $5, $6, $7)`,
    [ticketId, input.eventId, scanTime(input.scannedAt), result, input.deviceLabel ?? null, reason ?? null, input.clientScanId ?? null],
  );
}

const TICKET_COLS = `id, attendee_name AS name, attendee_email AS email, checked_in_at, checked_in_by, event_id, status`;

function shapeTicket(r: any): ScanOutcome['ticket'] {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    checkedInAt: r.checked_in_at ? new Date(r.checked_in_at).toISOString() : null,
    checkedInBy: r.checked_in_by,
  };
}

async function replay(tx: Tx, clientScanId: string): Promise<ScanOutcome | null> {
  const { rows } = await tx.query(
    `SELECT l.result, l.reason, t.id, t.attendee_name AS name, t.attendee_email AS email, t.checked_in_at, t.checked_in_by
       FROM check_in_log l LEFT JOIN tickets t ON t.id = l.ticket_id
      WHERE l.client_scan_id = $1`,
    [clientScanId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return { result: r.result, reason: r.reason ?? undefined, ticket: r.id ? shapeTicket(r) : undefined, replayed: true };
}

/**
 * Single-use enforcement. The check-in is ONE conditional UPDATE — the row only flips
 * valid → checked_in if it is still valid at the moment Postgres applies the write.
 * Two doors scanning the same ticket at the same instant both issue the UPDATE; the row
 * lock makes the second wait, re-evaluate `status = 'valid'` (now false), and match zero
 * rows. Exactly one door gets "success". No read-then-write race exists to exploit.
 */
async function checkIn(tx: Tx, input: ScanInput): Promise<ScanOutcome> {
  if (input.clientScanId) {
    const prior = await replay(tx, input.clientScanId);
    if (prior) return prior;
  }

  let code: string | null = null;
  if (input.payload !== undefined) {
    code = verifyPayload(input.payload);
    if (!code) {
      await log(tx, input, 'invalid', null, 'bad_signature');
      return { result: 'invalid', reason: 'bad_signature' };
    }
  } else if (input.ticketId) {
    const { rows } = await tx.query(`SELECT ticket_code FROM tickets WHERE id = $1 AND event_id = $2`, [
      input.ticketId,
      input.eventId,
    ]);
    code = rows[0]?.ticket_code ?? null;
    if (!code) {
      await log(tx, input, 'invalid', null, 'not_found');
      return { result: 'invalid', reason: 'not_found' };
    }
  }

  const by = input.deviceLabel ?? (input.payload === undefined ? 'manual' : 'scanner');
  const updated = await tx.query(
    `UPDATE tickets
        SET status = 'checked_in', checked_in_at = COALESCE($3, now()), checked_in_by = $4
      WHERE ticket_code = $1 AND event_id = $2 AND status = 'valid'
      RETURNING ${TICKET_COLS}`,
    [code, input.eventId, scanTime(input.scannedAt), by],
  );

  if (updated.rowCount === 1) {
    const t = updated.rows[0];
    await log(tx, input, 'success', t.id);
    return { result: 'success', ticket: shapeTicket(t) };
  }

  // Zero rows: work out why, purely for the operator's benefit.
  const { rows } = await tx.query(
    `SELECT ${TICKET_COLS}, (SELECT title FROM events WHERE id = tickets.event_id) AS event_title
       FROM tickets WHERE ticket_code = $1`,
    [code],
  );
  const t = rows[0];
  if (!t) {
    await log(tx, input, 'invalid', null, 'not_found');
    return { result: 'invalid', reason: 'not_found' };
  }
  if (t.event_id !== input.eventId) {
    await log(tx, input, 'wrong_event', t.id, 'other_event');
    return { result: 'wrong_event', reason: 'other_event', otherEventTitle: t.event_title, ticket: shapeTicket(t) };
  }
  if (t.status === 'cancelled') {
    await log(tx, input, 'invalid', t.id, 'cancelled');
    return { result: 'invalid', reason: 'cancelled', ticket: shapeTicket(t) };
  }
  await log(tx, input, 'already_used', t.id);
  return { result: 'already_used', ticket: shapeTicket(t) };
}

export async function processScan(input: ScanInput): Promise<ScanOutcome> {
  let outcome: ScanOutcome;
  try {
    outcome = await withTx((tx) => checkIn(tx, input));
  } catch (err: any) {
    // Two concurrent retries of the same offline scan: the loser hits the unique index.
    if (err?.code === '23505' && input.clientScanId) {
      outcome = (await withTx((tx) => replay(tx, input.clientScanId!))) ?? { result: 'invalid' };
    } else {
      throw err;
    }
  }

  if (!outcome.replayed) {
    if (outcome.result === 'success') await bumpStat(input.eventId, 'checkedIn', 1);
    outcome.stats = await getStats(input.eventId);
    await publishLive(input.eventId, {
      type: 'scan',
      result: outcome.result,
      reason: outcome.reason,
      ticket: outcome.ticket,
      device: input.deviceLabel ?? null,
      at: outcome.ticket?.checkedInAt && outcome.result === 'success' ? outcome.ticket.checkedInAt : new Date().toISOString(),
      stats: outcome.stats,
    });
  } else {
    outcome.stats = await getStats(input.eventId);
  }
  return outcome;
}
