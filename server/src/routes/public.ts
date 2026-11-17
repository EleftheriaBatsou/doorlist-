import type { FastifyInstance, FastifyReply } from 'fastify';
import { pool } from '../db.js';
import { issueTicket, RsvpError } from '../rsvp.js';
import { getObject } from '../storage.js';
import { getStats } from '../redis.js';
import { buildIcs } from '../ics.js';
import { config } from '../config.js';

export const coverUrl = (key: string | null) => (key ? `/media/${key}` : null);

function publicEvent(r: any, remaining?: number) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    startsAt: r.starts_at,
    venue: r.venue,
    capacity: r.capacity,
    coverUrl: coverUrl(r.cover_image_key),
    remaining,
  };
}

async function streamObject(reply: FastifyReply, key: string, fallbackType: string) {
  const obj = await getObject(key);
  if (!obj) return reply.code(404).send({ error: 'not found' });
  reply.header('content-type', obj.contentType ?? fallbackType);
  reply.header('cache-control', 'public, max-age=3600');
  if (obj.length) reply.header('content-length', obj.length);
  return reply.send(obj.body);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function publicRoutes(app: FastifyInstance) {
  app.get('/api/public/events', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM events WHERE published ORDER BY starts_at DESC LIMIT 50`,
    );
    return rows.map((r) => publicEvent(r));
  });

  app.get<{ Params: { slug: string } }>('/api/public/events/:slug', async (req, reply) => {
    const { rows } = await pool.query(`SELECT * FROM events WHERE slug = $1 AND published`, [req.params.slug]);
    if (!rows[0]) return reply.code(404).send({ error: 'Event not found' });
    const stats = await getStats(rows[0].id);
    return publicEvent(rows[0], stats ? Math.max(0, stats.capacity - stats.issued) : undefined);
  });

  app.post<{ Params: { slug: string }; Body: { name?: string; email?: string } }>(
    '/api/public/events/:slug/rsvp',
    { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const name = (req.body?.name ?? '').trim().slice(0, 120);
      const email = (req.body?.email ?? '').trim().toLowerCase().slice(0, 200);
      if (name.length < 2) return reply.code(400).send({ error: 'Please tell us your name' });
      if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: 'That email doesn’t look right' });
      try {
        const t = await issueTicket({ slug: req.params.slug, name, email, requirePublished: true });
        return reply.code(t.existing ? 200 : 201).send({ ticketCode: t.ticketCode, existing: t.existing });
      } catch (err) {
        if (err instanceof RsvpError) {
          return reply.code(err.code === 'sold_out' ? 409 : 404).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // Ticket codes are 128-bit random secrets, so possession of the URL is the credential.
  app.get<{ Params: { code: string } }>('/api/public/tickets/:code', async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT t.id, t.attendee_name, t.status, t.checked_in_at, t.qr_object_key, t.email_status, t.issued_at,
              e.slug, e.title, e.starts_at, e.venue, e.cover_image_key, e.description
         FROM tickets t JOIN events e ON e.id = t.event_id WHERE t.ticket_code = $1`,
      [req.params.code],
    );
    const r = rows[0];
    if (!r) return reply.code(404).send({ error: 'Ticket not found' });
    return {
      attendeeName: r.attendee_name,
      status: r.status,
      checkedInAt: r.checked_in_at,
      qrReady: !!r.qr_object_key,
      emailStatus: r.email_status,
      issuedAt: r.issued_at,
      event: {
        slug: r.slug,
        title: r.title,
        startsAt: r.starts_at,
        venue: r.venue,
        coverUrl: coverUrl(r.cover_image_key),
        // Smaller variant for the ticket header on phones.
        coverThumbUrl: `/media/${r.cover_image_key.replace(/\.(\w+)$/, '-thumb.$1')}`,
      },
    };
  });

  app.get<{ Params: { code: string } }>('/api/public/tickets/:code/qr.png', async (req, reply) => {
    const { rows } = await pool.query(`SELECT qr_object_key FROM tickets WHERE ticket_code = $1`, [req.params.code]);
    if (!rows[0]?.qr_object_key) return reply.code(404).send({ error: 'QR not ready' });
    return streamObject(reply, rows[0].qr_object_key, 'image/png');
  });

  app.get<{ Params: { code: string } }>('/api/public/tickets/:code/event.ics', async (req, reply) => {
    const { rows } = await pool.query(
      `SELECT t.id, t.ics_object_key, e.title, e.description, e.venue, e.starts_at
         FROM tickets t JOIN events e ON e.id = t.event_id WHERE t.ticket_code = $1`,
      [req.params.code],
    );
    const r = rows[0];
    if (!r) return reply.code(404).send({ error: 'Ticket not found' });
    reply.header('content-disposition', 'attachment; filename="event.ics"');
    if (r.ics_object_key) return streamObject(reply, r.ics_object_key, 'text/calendar');
    reply.header('content-type', 'text/calendar; charset=utf-8');
    return buildIcs({
      uid: r.id,
      title: r.title,
      description: r.description,
      venue: r.venue,
      startsAt: new Date(r.starts_at),
      url: `${config.publicUrl}/t/${req.params.code}`,
    });
  });

  // Cover images (event covers are public by nature).
  app.get<{ Params: { '*': string } }>('/media/*', async (req, reply) => {
    const key = req.params['*'];
    if (!key.startsWith('covers/') || key.includes('..')) return reply.code(404).send({ error: 'not found' });
    return streamObject(reply, key, 'application/octet-stream');
  });
}
