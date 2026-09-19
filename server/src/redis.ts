import { Redis } from 'ioredis';
import { config } from './config.js';
import { pool } from './db.js';

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
/** Dedicated connection for pub/sub fan-in. */
export const subscriber = new Redis(config.redisUrl);

export const statsKey = (eventId: string) => `ev:${eventId}:stats`;
export const channelFor = (eventId: string) => `ev:${eventId}:live`;

export interface EventStats {
  checkedIn: number;
  issued: number; // active (non-cancelled) tickets
  capacity: number;
}

// HINCRBY only when the hash exists — otherwise the next read rebuilds it from Postgres.
redis.defineCommand('hincrIfExists', {
  numberOfKeys: 1,
  lua: `if redis.call('EXISTS', KEYS[1]) == 1 then return redis.call('HINCRBY', KEYS[1], ARGV[1], ARGV[2]) end return false`,
});
declare module 'ioredis' {
  interface RedisCommander<Context> {
    hincrIfExists(key: string, field: string, by: number): Promise<number | null>;
  }
}

async function rebuildStats(eventId: string): Promise<EventStats | null> {
  const { rows } = await pool.query(
    `SELECT e.capacity,
            count(t.id) FILTER (WHERE t.status <> 'cancelled')::int  AS issued,
            count(t.id) FILTER (WHERE t.status = 'checked_in')::int AS checked_in
       FROM events e LEFT JOIN tickets t ON t.event_id = e.id
      WHERE e.id = $1 GROUP BY e.id`,
    [eventId],
  );
  if (!rows[0]) return null;
  const s: EventStats = { capacity: rows[0].capacity, issued: rows[0].issued, checkedIn: rows[0].checked_in };
  await redis
    .multi()
    .hset(statsKey(eventId), { capacity: s.capacity, issued: s.issued, checkedIn: s.checkedIn })
    .expire(statsKey(eventId), 6 * 3600)
    .exec();
  return s;
}

/** Live counters: served from the cache, rebuilt from Postgres on miss. */
export async function getStats(eventId: string): Promise<EventStats | null> {
  const h = await redis.hgetall(statsKey(eventId));
  if (h.capacity === undefined) return rebuildStats(eventId);
  return { capacity: Number(h.capacity), issued: Number(h.issued), checkedIn: Number(h.checkedIn) };
}

export async function bumpStat(eventId: string, field: 'checkedIn' | 'issued', by: number) {
  await redis.hincrIfExists(statsKey(eventId), field, by);
}

export async function invalidateStats(eventId: string) {
  await redis.del(statsKey(eventId));
}

/** Publish a live message to every API instance's WebSocket clients for this event. */
export async function publishLive(eventId: string, message: Record<string, unknown>) {
  await redis.publish(channelFor(eventId), JSON.stringify(message));
}
