import { withTx } from './db.js';
import { newTicketCode } from './ticket-code.js';
import { enqueue } from './queue.js';
import { bumpStat, getStats, publishLive } from './redis.js';

export class RsvpError extends Error {
  constructor(
    public code: 'not_found' | 'sold_out',
    message: string,
  ) {
    super(message);
  }
}

export interface IssuedTicket {
  id: string;
  ticketCode: string;
  eventId: string;
  existing: boolean;
}

/**
 * Capacity-safe issuance. `SELECT … FOR UPDATE` on the event row serialises every RSVP
 * for that event, so the count-then-insert below cannot interleave with another RSVP:
 * a rush of simultaneous requests queues on the lock and the (capacity+1)th sees "full".
 */
export async function issueTicket(opts: {
  slug?: string;
  eventId?: string;
  name: string;
  email: string;
  requirePublished: boolean;
}): Promise<IssuedTicket> {
  const issued = await withTx(async (tx) => {
    const ev = await tx.query(
      `SELECT id, capacity, published FROM events WHERE ${opts.eventId ? 'id' : 'slug'} = $1 FOR UPDATE`,
      [opts.eventId ?? opts.slug],
    );
    const event = ev.rows[0];
    if (!event || (opts.requirePublished && !event.published)) throw new RsvpError('not_found', 'Event not found');

    const existing = await tx.query(
      `SELECT id, ticket_code FROM tickets
        WHERE event_id = $1 AND lower(attendee_email) = lower($2) AND status <> 'cancelled'`,
      [event.id, opts.email],
    );
    if (existing.rows[0]) {
      return { id: existing.rows[0].id, ticketCode: existing.rows[0].ticket_code, eventId: event.id, existing: true };
    }

    const { rows } = await tx.query(
      `SELECT count(*)::int AS n FROM tickets WHERE event_id = $1 AND status <> 'cancelled'`,
      [event.id],
    );
    if (rows[0].n >= event.capacity) throw new RsvpError('sold_out', 'This event is full');

    const code = newTicketCode();
    const ins = await tx.query(
      `INSERT INTO tickets (event_id, attendee_name, attendee_email, ticket_code)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [event.id, opts.name, opts.email, code],
    );
    return { id: ins.rows[0].id, ticketCode: code, eventId: event.id, existing: false };
  });

  if (!issued.existing) {
    // After commit. If this publish fails the worker's reconciler re-enqueues pending tickets.
    await enqueue({ kind: 'issue', ticketId: issued.id, sendEmail: true }, `issue-${issued.id}`).catch(() => {});
    await bumpStat(issued.eventId, 'issued', 1);
    await publishLive(issued.eventId, { type: 'ticket', ticketId: issued.id, stats: await getStats(issued.eventId) });
  }
  return issued;
}
