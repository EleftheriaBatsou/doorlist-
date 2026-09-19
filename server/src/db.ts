import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Tx = pg.PoolClient;

/** Run fn inside a transaction; rolls back on throw. */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL,
  description     text NOT NULL DEFAULT '',
  starts_at       timestamptz NOT NULL,
  venue           text NOT NULL DEFAULT '',
  capacity        integer NOT NULL CHECK (capacity > 0),
  cover_image_key text,
  published       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  attendee_name   text NOT NULL,
  attendee_email  text NOT NULL,
  ticket_code     text NOT NULL UNIQUE,
  qr_object_key   text,
  ics_object_key  text,
  status          text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','checked_in','cancelled')),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  checked_in_at   timestamptz,
  checked_in_by   text,
  email_status    text NOT NULL DEFAULT 'pending'
                  CHECK (email_status IN ('pending','sent','preview','retrying','failed','skipped')),
  email_attempts  integer NOT NULL DEFAULT 0,
  email_error     text,
  email_sent_at   timestamptz
);
-- One active ticket per email per event (re-RSVP returns the existing ticket).
CREATE UNIQUE INDEX IF NOT EXISTS tickets_event_email_active
  ON tickets (event_id, lower(attendee_email)) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS tickets_event_status ON tickets (event_id, status);

CREATE TABLE IF NOT EXISTS check_in_log (
  id             bigserial PRIMARY KEY,
  ticket_id      uuid REFERENCES tickets(id) ON DELETE CASCADE,
  event_id       uuid REFERENCES events(id) ON DELETE CASCADE,
  ts             timestamptz NOT NULL DEFAULT now(),
  result         text NOT NULL CHECK (result IN ('success','already_used','invalid','wrong_event')),
  device_label   text,
  reason         text,
  client_scan_id text
);
-- Makes offline-queue replays idempotent: a retried sync returns the original outcome.
CREATE UNIQUE INDEX IF NOT EXISTS check_in_log_client_scan
  ON check_in_log (client_scan_id) WHERE client_scan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS check_in_log_event_ts ON check_in_log (event_id, ts DESC);
`;

/** Idempotent schema setup, serialised across containers with an advisory lock. */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(SCHEMA);
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}
