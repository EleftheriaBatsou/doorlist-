import { timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';

export const SESSION_COOKIE = 'dl_session';
const MAX_AGE_S = 30 * 86_400;

function samePassword(given: string): boolean {
  // Hash both sides so lengths match for timingSafeEqual.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(config.adminPassword).digest();
  return timingSafeEqual(a, b);
}

/** Validates a signed session cookie value (also used by the WebSocket upgrade). */
export function isValidSession(app: FastifyInstance, raw: string | undefined): boolean {
  if (!raw) return false;
  const res = app.unsignCookie(raw);
  if (!res.valid || !res.value) return false;
  const issued = Number(res.value.split(':')[1]);
  return Number.isFinite(issued) && Date.now() - issued < MAX_AGE_S * 1000;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (!isValidSession(req.server, req.cookies[SESSION_COOKIE])) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

export function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { password?: string } }>(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (req, reply) => {
      if (!req.body?.password || !samePassword(req.body.password)) {
        return reply.code(401).send({ error: 'Wrong passcode' });
      }
      reply.setCookie(SESSION_COOKIE, `admin:${Date.now()}`, {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProd || config.publicUrl.startsWith('https'),
        path: '/',
        maxAge: MAX_AGE_S,
      });
      return { ok: true };
    },
  );

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ authenticated: isValidSession(app, req.cookies[SESSION_COOKIE]) }));
}
