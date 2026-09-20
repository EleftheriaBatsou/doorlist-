import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { SESSION_COOKIE, userFromCookie } from './auth.js';
import { subscriber } from './redis.js';
import { pool } from './db.js';

/**
 * Real-time fan-out: every API instance PSUBSCRIBEs to `ev:*:live` on the cache and relays
 * messages to its own WebSocket clients for that event. Any instance (or the worker) can
 * publish, and every connected dashboard/scanner sees it — no sticky sessions needed.
 */
export async function setupLive(app: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<string, Set<WebSocket>>();

  app.server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws') return; // leave other upgrades (Vite HMR in dev) alone
    const eventId = url.searchParams.get('event') ?? '';
    void (async () => {
      const cookies = app.parseCookie(req.headers.cookie ?? '');
      const user = /^[0-9a-f-]{36}$/i.test(eventId)
        ? await userFromCookie(app, cookies[SESSION_COOKIE])
        : null;
      // Only the event's own organiser may watch its live feed.
      const owns =
        user &&
        (await pool.query(`SELECT 1 FROM events WHERE id = $1 AND owner_id = $2`, [eventId, user.id])).rowCount;
      if (!owns) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        let room = rooms.get(eventId);
        if (!room) rooms.set(eventId, (room = new Set()));
        room.add(ws);
        (ws as any).isAlive = true;
        ws.on('pong', () => ((ws as any).isAlive = true));
        ws.on('close', () => {
          room!.delete(ws);
          if (room!.size === 0) rooms.delete(eventId);
        });
        ws.send(JSON.stringify({ type: 'hello' }));
      });
    })();
  });

  // Keep connections alive through the L7 balancer and drop dead clients.
  const heartbeat = setInterval(() => {
    for (const room of rooms.values())
      for (const ws of room) {
        if (!(ws as any).isAlive) {
          ws.terminate();
          continue;
        }
        (ws as any).isAlive = false;
        ws.ping();
      }
  }, 25_000);

  await subscriber.psubscribe('ev:*:live');
  subscriber.on('pmessage', (_pattern, channel, message) => {
    const eventId = channel.split(':')[1];
    const room = rooms.get(eventId);
    if (!room) return;
    for (const ws of room) if (ws.readyState === ws.OPEN) ws.send(message);
  });

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  });
}
