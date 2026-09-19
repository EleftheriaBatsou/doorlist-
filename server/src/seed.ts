import { pool, withTx } from './db.js';
import { newTicketCode } from './ticket-code.js';
import { enqueue } from './queue.js';
import { invalidateStats } from './redis.js';
import { putObject } from './storage.js';

export const DEMO_SLUG = 'neon-nights';

const NAMES = [
  'Anna Kowalski', 'Mateo García', 'Priya Raman', 'Jonas Lindqvist', 'Amara Okafor', 'Lukas Novák',
  'Sofia Rossi', 'Kenji Watanabe', 'Chloé Martin', 'Daniel Cohen', 'Fatima Zahra', 'Oliver Bennett',
  'Mei Lin', 'Tomás Silva', 'Elif Yılmaz', 'Noah Fischer', 'Isabela Costa', 'Aarav Mehta',
  'Freya Hansen', 'Kwame Mensah', 'Léa Dubois', 'Ivan Petrov', 'Hana Suzuki', 'Marco Bianchi',
  'Zoe Papadopoulos', 'Samuel Adeyemi', 'Ingrid Johansson', 'Diego Hernández', 'Yara Haddad', 'Felix Wagner',
  'Nadia Kowalczyk', 'Arjun Nair', 'Emma Schmidt', 'Tariq Rahman', 'Lucía Fernández', 'Petr Dvořák',
  'Grace Liu', 'Ethan Walsh', 'Aisha Bello', 'Viktor Horváth',
];

function emailFor(name: string) {
  const ascii = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase();
  return `${ascii.replace(/[^a-z]+/g, '.')}@example.com`;
}

// Acklam's rational approximation of the inverse normal CDF — gives a smooth bell-shaped arrival curve.
function probit(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const q = p < 0.5 ? p : 1 - p;
  let x: number;
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q));
    x = (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
    return p < 0.5 ? x : -x;
  }
  const r = q - 0.5;
  const s = r * r;
  x = ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
  return p < 0.5 ? x : -x;
}

// Deterministic PRNG so the demo looks the same every reset.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function coverSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 800" width="1600" height="800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2A1B6B"/><stop offset=".55" stop-color="#7C5CFF"/><stop offset="1" stop-color="#FF5C9A"/>
    </linearGradient>
    <radialGradient id="glow" cx=".78" cy=".22" r=".5">
      <stop offset="0" stop-color="#FFC93C" stop-opacity=".85"/><stop offset="1" stop-color="#FFC93C" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="800" fill="url(#bg)"/>
  <rect width="1600" height="800" fill="url(#glow)"/>
  <g fill="none" stroke-linecap="round" stroke-width="26" opacity=".9">
    <path d="M-40 640 C 300 520, 520 760, 860 600 S 1400 420, 1680 540" stroke="#2BD968"/>
    <path d="M-40 700 C 320 600, 560 820, 900 680 S 1420 520, 1680 620" stroke="#FFC93C" opacity=".8"/>
  </g>
  <g fill="#FBFAFF">
    <circle cx="240" cy="190" r="70" opacity=".16"/><circle cx="1280" cy="560" r="120" opacity=".1"/>
    <circle cx="560" cy="140" r="16" opacity=".6"/><circle cx="1040" cy="260" r="10" opacity=".7"/>
    <circle cx="1380" cy="170" r="22" opacity=".5"/><circle cx="160" cy="470" r="12" opacity=".6"/>
  </g>
</svg>`;
}

export async function demoExists(): Promise<boolean> {
  const { rowCount } = await pool.query('SELECT 1 FROM events WHERE slug = $1', [DEMO_SLUG]);
  return (rowCount ?? 0) > 0;
}

/** Creates (or recreates) the demo event with ~40 attendees, about half already arrived. */
export async function seedDemo(opts: { reset?: boolean } = {}): Promise<string> {
  const rand = mulberry32(42);
  const now = Date.now();
  const startsAt = new Date(now - 50 * 60_000); // doors opened ~80 min ago, event started 50 min ago
  const coverKey = `covers/${DEMO_SLUG}-v2.svg`;
  await putObject(coverKey, coverSvg(), 'image/svg+xml');

  const { eventId, ticketIds } = await withTx(async (tx) => {
    if (opts.reset) await tx.query('DELETE FROM events WHERE slug = $1', [DEMO_SLUG]);
    const ev = await tx.query(
      `INSERT INTO events (slug, title, description, starts_at, venue, capacity, cover_image_key, published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
      [
        DEMO_SLUG,
        'Neon Nights — Autumn Launch Party',
        'An evening of synth-pop, glow paint and very good snacks to celebrate the autumn launch.\n\n' +
          'Doors open 30 minutes before the start. Bring your ticket QR on your phone — we scan at the door, ' +
          'it takes a second. Dress code: anything that glows.',
        startsAt,
        'Kasárna Karlín, Prague',
        120,
        coverKey,
      ],
    );
    const eventId: string = ev.rows[0].id;
    const ids: string[] = [];
    const arrivals = 21;
    const devices = ['Main door', 'Main door', 'Side door'];

    for (let i = 0; i < NAMES.length; i++) {
      const name = NAMES[i];
      const issuedAt = new Date(now - (2 + rand() * 20) * 86_400_000);
      let checkedInAt: Date | null = null;
      if (i < arrivals) {
        // Bell-shaped arrivals centred ~5 min after start, clamped into the past.
        const u = (i + 0.5) / arrivals;
        const offsetMin = Math.max(-28, Math.min(46, 4 + 13 * probit(u) + (rand() - 0.5) * 3));
        checkedInAt = new Date(startsAt.getTime() + offsetMin * 60_000);
      }
      const device = devices[Math.floor(rand() * devices.length)];
      const t = await tx.query(
        `INSERT INTO tickets (event_id, attendee_name, attendee_email, ticket_code, status, issued_at,
                              checked_in_at, checked_in_by, email_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'skipped') RETURNING id`,
        [eventId, name, emailFor(name), newTicketCode(), checkedInAt ? 'checked_in' : 'valid', issuedAt, checkedInAt,
          checkedInAt ? device : null],
      );
      ids.push(t.rows[0].id);
      if (checkedInAt) {
        await tx.query(
          `INSERT INTO check_in_log (ticket_id, event_id, ts, result, device_label) VALUES ($1, $2, $3, 'success', $4)`,
          [t.rows[0].id, eventId, checkedInAt, device],
        );
      }
    }
    // A few realistic non-success attempts in the log.
    await tx.query(
      `INSERT INTO check_in_log (ticket_id, event_id, ts, result, device_label, reason) VALUES
         ($1, $3, now() - interval '31 minutes', 'already_used', 'Side door', NULL),
         (NULL, $3, now() - interval '18 minutes', 'invalid', 'Main door', 'bad_signature'),
         ($2, $3, now() - interval '6 minutes', 'already_used', 'Main door', NULL)`,
      [ids[3], ids[0], eventId],
    );
    return { eventId, ticketIds: ids };
  });

  await invalidateStats(eventId);
  // Worker renders each QR (no email for demo attendees).
  for (const id of ticketIds) await enqueue({ kind: 'issue', ticketId: id, sendEmail: false }, `issue-${id}`).catch(() => {});
  return eventId;
}
