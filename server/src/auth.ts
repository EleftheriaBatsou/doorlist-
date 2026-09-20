import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { pool } from './db.js';
import { redis } from './redis.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'dl_session';
const SESSION_TTL_S = 30 * 86_400;
const sessionKey = (id: string) => `sess:${id}`;

export interface User {
  id: string;
  email: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

// ---------- passwords ----------
// scrypt with a per-user salt; format: scrypt$<salt-b64>$<hash-b64>
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

// ---------- sessions (in the cache, so sign-out revokes immediately) ----------
async function createSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await redis.set(sessionKey(id), userId, 'EX', SESSION_TTL_S);
  return id;
}

/** Resolves a signed session cookie to the logged-in user, or null. */
export async function userFromCookie(app: FastifyInstance, raw: string | undefined): Promise<User | null> {
  if (!raw) return null;
  const unsigned = app.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const userId = await redis.get(sessionKey(unsigned.value));
  if (!userId) return null;
  await redis.expire(sessionKey(unsigned.value), SESSION_TTL_S); // sliding window
  const { rows } = await pool.query(`SELECT id, email, name FROM users WHERE id = $1`, [userId]);
  return rows[0] ?? null;
}

function setSessionCookie(reply: FastifyReply, sessionId: string) {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd || config.publicUrl.startsWith('https'),
    path: '/',
    maxAge: SESSION_TTL_S,
  });
}

/** preHandler: 401 unless signed in; attaches req.user. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const user = await userFromCookie(req.server, req.cookies[SESSION_COOKIE]);
  if (!user) return reply.code(401).send({ error: 'unauthorized' });
  req.user = user;
}

// ---------- routes ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Credentials {
  name?: string;
  email?: string;
  password?: string;
}

export function authRoutes(app: FastifyInstance, onRegister: (user: User) => Promise<void>) {
  app.post<{ Body: Credentials }>(
    '/api/auth/register',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const name = (req.body?.name ?? '').trim().slice(0, 80);
      const email = (req.body?.email ?? '').trim().toLowerCase().slice(0, 200);
      const password = req.body?.password ?? '';
      if (name.length < 2) return reply.code(400).send({ error: 'Please enter your name' });
      if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: 'That email doesn’t look right' });
      if (password.length < 8) return reply.code(400).send({ error: 'Use at least 8 characters for your password' });

      let user: User;
      try {
        const { rows } = await pool.query(
          `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name`,
          [name, email, await hashPassword(password)],
        );
        user = rows[0];
      } catch (err: any) {
        if (err?.code === '23505') return reply.code(409).send({ error: 'An account with that email already exists' });
        throw err;
      }

      await onRegister(user).catch((err) => req.log.error({ err }, 'post-register setup failed'));
      setSessionCookie(reply, await createSession(user.id));
      return reply.code(201).send({ user });
    },
  );

  app.post<{ Body: Credentials }>(
    '/api/auth/login',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const email = (req.body?.email ?? '').trim().toLowerCase();
      const password = req.body?.password ?? '';
      const { rows } = await pool.query(
        `SELECT id, email, name, password_hash FROM users WHERE lower(email) = $1`,
        [email],
      );
      const row = rows[0];
      // Same message either way — don't reveal which emails have accounts.
      if (!row || !(await verifyPassword(password, row.password_hash))) {
        return reply.code(401).send({ error: 'Wrong email or password' });
      }
      await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [row.id]);
      setSessionCookie(reply, await createSession(row.id));
      return { user: { id: row.id, email: row.email, name: row.name } };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const unsigned = app.unsignCookie(req.cookies[SESSION_COOKIE] ?? '');
    if (unsigned.valid && unsigned.value) await redis.del(sessionKey(unsigned.value));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const user = await userFromCookie(app, req.cookies[SESSION_COOKIE]);
    return { authenticated: !!user, user };
  });
}
