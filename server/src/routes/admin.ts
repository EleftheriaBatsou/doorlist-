import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { processScan, type ScanInput } from '../checkin.js';
import { issueTicket, RsvpError } from '../rsvp.js';
import { enqueue } from '../queue.js';
import { getStats, invalidateStats, publishLive } from '../redis.js';
import { getObject, putObject } from '../storage.js';
import { coverUrl } from './public.js';
import { isDemoSlug, seedDemo } from '../seed.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adminEvent(r: any) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    startsAt: r.starts_at,
    venue: r.venue,
    capacity: r.capacity,
    coverUrl: coverUrl(r.cover_image_key),
    published: r.published,
    createdAt: r.created_at,
    isDemo: isDemoSlug(r.slug),
  };
}

export function adminTicket(r: any) {
  return {
    id: r.id,
    name: r.attendee_name,
    email: r.attendee_email,
    code: r.ticket_code,
    status: r.status,
    issuedAt: r.issued_at,
    checkedInAt: r.checked_in_at,
    checkedInBy: r.checked_in_by,
    qrReady: !!r.qr_object_key,
    emailStatus: r.email_status,
    emailAttempts: r.email_attempts,
    emailError: r.email_error,
  };
}

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

interface EventBody {
  title?: string;
  slug?: string;
  description?: string;
  startsAt?: string;
  venue?: string;
  capacity?: number;
  published?: boolean;
}

function validateEvent(b: EventBody, partial: boolean): string | null {
  if (!partial || b.title !== undefined) if (!b.title || b.title.trim().length < 2) return 'Title is required';
  if (!partial || b.startsAt !== undefined) if (!b.startsAt || Number.isNaN(Date.parse(b.startsAt))) return 'Start time is required';
  if (!partial || b.capacity !== undefined)
    if (!Number.isInteger(b.capacity) || (b.capacity as number) < 1 || (b.capacity as number) > 100_000) return 'Capacity must be 1–100000';
  if (b.slug !== undefined && !/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(b.slug)) return 'Slug: lowercase letters, numbers and dashes';
  return null;
}

export function adminRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook('preHandler', requireAuth);
    // Ownership gate: an event or ticket belonging to another organiser is a 404 here,
    // so no route below has to remember to filter by owner.
    r.addHook('preHandler', async (req, reply) => {
      const p = (req.params ?? {}) as { id?: string; ticketId?: string };
      const notFound = () => reply.code(404).send({ error: 'Not found' });
      if (p.id !== undefined) {
        if (!UUID_RE.test(p.id)) return notFound();
        const { rowCount } = await pool.query(`SELECT 1 FROM events WHERE id = $1 AND owner_id = $2`, [p.id, req.user!.id]);
        if (!rowCount) return notFound();
      }
      if (p.ticketId !== undefined) {
        if (!UUID_RE.test(p.ticketId)) return notFound();
        const { rowCount } = await pool.query(
          `SELECT 1 FROM tickets t JOIN events e ON e.id = t.event_id WHERE t.id = $1 AND e.owner_id = $2`,
          [p.ticketId, req.user!.id],
        );
        if (!rowCount) return notFound();
      }
    });

    r.get('/api/events', async (req) => {
      const { rows } = await pool.query(`SELECT * FROM events WHERE owner_id = $1 ORDER BY starts_at DESC`, [req.user!.id]);
      return Promise.all(rows.map(async (e) => ({ ...adminEvent(e), stats: await getStats(e.id) })));
    });

    r.post<{ Body: EventBody }>('/api/events', async (req, reply) => {
      const b = req.body ?? {};
      const err = validateEvent(b, false);
      if (err) return reply.code(400).send({ error: err });
      const slug = b.slug || `${slugify(b.title!)}-${randomBytes(2).toString('hex')}`;
      try {
        const { rows } = await pool.query(
          `INSERT INTO events (slug, title, description, starts_at, venue, capacity, published, owner_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [slug, b.title!.trim(), b.description ?? '', b.startsAt, b.venue ?? '', b.capacity, b.published ?? false, req.user!.id],
        );
        return reply.code(201).send(adminEvent(rows[0]));
      } catch (e: any) {
        if (e.code === '23505') return reply.code(409).send({ error: 'That URL slug is already taken' });
        throw e;
      }
    });

    r.get<{ Params: { id: string } }>('/api/events/:id', async (req, reply) => {
      const { rows } = await pool.query(`SELECT * FROM events WHERE id = $1`, [req.params.id]);
      if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
      return { ...adminEvent(rows[0]), stats: await getStats(req.params.id) };
    });

    r.put<{ Params: { id: string }; Body: EventBody }>('/api/events/:id', async (req, reply) => {
      const b = req.body ?? {};
      const err = validateEvent(b, true);
      if (err) return reply.code(400).send({ error: err });
      if (b.capacity !== undefined) {
        const stats = await getStats(req.params.id);
        if (stats && b.capacity < stats.issued)
          return reply.code(400).send({ error: `Capacity can’t go below the ${stats.issued} tickets already issued` });
      }
      try {
        const { rows } = await pool.query(
          `UPDATE events SET
             title = COALESCE($2, title), slug = COALESCE($3, slug), description = COALESCE($4, description),
             starts_at = COALESCE($5, starts_at), venue = COALESCE($6, venue), capacity = COALESCE($7, capacity),
             published = COALESCE($8, published)
           WHERE id = $1 RETURNING *`,
          [req.params.id, b.title?.trim(), b.slug, b.description, b.startsAt, b.venue, b.capacity, b.published],
        );
        if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
        await invalidateStats(req.params.id);
        return adminEvent(rows[0]);
      } catch (e: any) {
        if (e.code === '23505') return reply.code(409).send({ error: 'That URL slug is already taken' });
        throw e;
      }
    });

    r.post<{ Params: { id: string } }>('/api/events/:id/cover', async (req, reply) => {
      const file = await req.file({ limits: { fileSize: 8 * 1024 * 1024 } });
      if (!file) return reply.code(400).send({ error: 'No file' });
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.mimetype];
      if (!ext) return reply.code(400).send({ error: 'Use a JPG, PNG, WebP or GIF image' });
      const buf = await file.toBuffer();
      const key = `covers/${req.params.id}-${randomBytes(4).toString('hex')}.${ext}`;
      await putObject(key, buf, file.mimetype);
      const { rows } = await pool.query(`UPDATE events SET cover_image_key = $2 WHERE id = $1 RETURNING *`, [
        req.params.id,
        key,
      ]);
      if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
      return adminEvent(rows[0]);
    });

    // Full roster — the scanner keeps it in memory for offline name lookup and manual check-in.
    r.get<{ Params: { id: string } }>('/api/events/:id/tickets', async (req) => {
      const { rows } = await pool.query(
        `SELECT * FROM tickets WHERE event_id = $1 ORDER BY attendee_name`,
        [req.params.id],
      );
      return rows.map(adminTicket);
    });

    r.post<{ Params: { id: string }; Body: { name?: string; email?: string } }>(
      '/api/events/:id/tickets',
      async (req, reply) => {
        const name = (req.body?.name ?? '').trim();
        const email = (req.body?.email ?? '').trim().toLowerCase();
        if (name.length < 2 || !email.includes('@')) return reply.code(400).send({ error: 'Name and email required' });
        try {
          const t = await issueTicket({ eventId: req.params.id, name, email, requirePublished: false });
          return reply.code(t.existing ? 200 : 201).send({ id: t.id, existing: t.existing });
        } catch (err) {
          if (err instanceof RsvpError) return reply.code(err.code === 'sold_out' ? 409 : 404).send({ error: err.message });
          throw err;
        }
      },
    );

    // Arrival timestamps → the client buckets them into the arrival curve and appends live scans.
    r.get<{ Params: { id: string } }>('/api/events/:id/arrivals', async (req) => {
      const { rows } = await pool.query(
        `SELECT checked_in_at FROM tickets WHERE event_id = $1 AND checked_in_at IS NOT NULL ORDER BY checked_in_at`,
        [req.params.id],
      );
      return rows.map((r) => r.checked_in_at);
    });

    r.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/events/:id/scans', async (req) => {
      const limit = Math.min(Number(req.query.limit ?? 12) || 12, 100);
      const { rows } = await pool.query(
        `SELECT l.id, l.ts, l.result, l.reason, l.device_label, t.id AS ticket_id, t.attendee_name
           FROM check_in_log l LEFT JOIN tickets t ON t.id = l.ticket_id
          WHERE l.event_id = $1 ORDER BY l.ts DESC, l.id DESC LIMIT $2`,
        [req.params.id, limit],
      );
      return rows.map((r) => ({
        id: r.id,
        at: r.ts,
        result: r.result,
        reason: r.reason,
        device: r.device_label,
        ticketId: r.ticket_id,
        name: r.attendee_name,
      }));
    });

    const scanLimit = { rateLimit: { max: 240, timeWindow: '1 minute' } };

    r.post<{ Params: { id: string }; Body: Omit<ScanInput, 'eventId' | 'ticketId'> }>(
      '/api/events/:id/scan',
      { config: scanLimit },
      async (req, reply) => {
        if (typeof req.body?.payload !== 'string') return reply.code(400).send({ error: 'payload required' });
        return processScan({ ...pickScan(req.body), payload: req.body.payload.slice(0, 200), eventId: req.params.id });
      },
    );

    // Offline queue sync — processed in scan order; the server stays the single-use authority.
    r.post<{ Params: { id: string }; Body: { scans?: Array<Omit<ScanInput, 'eventId'>> } }>(
      '/api/events/:id/scan/batch',
      { config: scanLimit },
      async (req, reply) => {
        const scans = req.body?.scans;
        if (!Array.isArray(scans) || scans.length > 200) return reply.code(400).send({ error: 'scans[] required (max 200)' });
        const results = [];
        for (const s of scans) {
          const base = { ...pickScan(s), eventId: req.params.id };
          const input: ScanInput =
            typeof s.ticketId === 'string' && UUID_RE.test(s.ticketId)
              ? { ...base, ticketId: s.ticketId }
              : { ...base, payload: String(s.payload ?? '').slice(0, 200) };
          results.push({ clientScanId: s.clientScanId, ...(await processScan(input)) });
        }
        return { results, stats: await getStats(req.params.id) };
      },
    );

    r.post<{ Params: { id: string; ticketId: string }; Body: Omit<ScanInput, 'eventId' | 'ticketId' | 'payload'> }>(
      '/api/events/:id/tickets/:ticketId/check-in',
      async (req) => {
        return processScan({ ...pickScan(req.body ?? {}), eventId: req.params.id, ticketId: req.params.ticketId });
      },
    );

    r.post<{ Params: { ticketId: string } }>('/api/tickets/:ticketId/resend', async (req, reply) => {
      const { rows } = await pool.query(
        `UPDATE tickets SET email_status = 'pending', email_error = NULL
          WHERE id = $1 AND status <> 'cancelled' RETURNING *`,
        [req.params.ticketId],
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Ticket not found or cancelled' });
      await enqueue({ kind: 'resend', ticketId: rows[0].id }, `resend-${rows[0].id}-${Date.now()}`);
      await publishLive(rows[0].event_id, { type: 'ticket', ticketId: rows[0].id });
      return adminTicket(rows[0]);
    });

    r.post<{ Params: { ticketId: string } }>('/api/tickets/:ticketId/cancel', async (req, reply) => {
      const { rows } = await pool.query(
        `UPDATE tickets SET status = 'cancelled' WHERE id = $1 AND status <> 'cancelled' RETURNING *`,
        [req.params.ticketId],
      );
      if (!rows[0]) return reply.code(409).send({ error: 'Ticket already cancelled' });
      await invalidateStats(rows[0].event_id);
      const stats = await getStats(rows[0].event_id);
      await publishLive(rows[0].event_id, { type: 'ticket', ticketId: rows[0].id, stats });
      return adminTicket(rows[0]);
    });

    // Rendered ticket email (stored by the worker when SMTP isn't configured).
    r.get<{ Params: { ticketId: string } }>('/api/tickets/:ticketId/email-preview', async (req, reply) => {
      const obj = await getObject(`emails/${req.params.ticketId}.html`);
      if (!obj) return reply.code(404).send({ error: 'No preview for this ticket' });
      reply.header('content-type', 'text/html; charset=utf-8');
      reply.header('content-security-policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'");
      return reply.send(obj.body);
    });

    r.post<{ Params: { id: string } }>('/api/events/:id/demo-reset', async (req, reply) => {
      const { rows } = await pool.query(`SELECT slug FROM events WHERE id = $1`, [req.params.id]);
      if (!isDemoSlug(rows[0]?.slug ?? '')) return reply.code(400).send({ error: 'Only the demo event can be reset' });
      return { id: await seedDemo({ ownerId: req.user!.id, replaceEventId: req.params.id }) };
    });
  });
}

function pickScan(b: any): Pick<ScanInput, 'deviceLabel' | 'clientScanId' | 'scannedAt'> {
  return {
    deviceLabel: typeof b.deviceLabel === 'string' ? b.deviceLabel.slice(0, 40) : undefined,
    clientScanId: typeof b.clientScanId === 'string' ? b.clientScanId.slice(0, 64) : undefined,
    scannedAt: typeof b.scannedAt === 'string' ? b.scannedAt : undefined,
  };
}
