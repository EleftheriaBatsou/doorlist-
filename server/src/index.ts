import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import path from 'node:path';
import { config } from './config.js';
import { migrate, pool } from './db.js';
import { redis, subscriber } from './redis.js';
import { closeQueue, connectQueue } from './queue.js';
import { authRoutes } from './auth.js';
import { publicRoutes } from './routes/public.js';
import { adminRoutes } from './routes/admin.js';
import { setupLive } from './live.js';
import { demoExists, seedDemo } from './seed.js';

const app = Fastify({
  logger: { level: 'info' },
  trustProxy: true, // behind the Zerops L7 balancer — real client IP for rate limits
  bodyLimit: 1024 * 1024,
  forceCloseConnections: true, // fast restarts: don't wait on idle keep-alive / HMR sockets
  disableRequestLogging: !config.isProd, // dev: Vite module requests would drown the log
});

await app.register(cookie, { secret: config.sessionSecret });
await app.register(multipart);
// Rate limits live in the shared cache, so they hold across API containers.
await app.register(rateLimit, {
  global: false,
  redis,
  nameSpace: 'rl:',
  keyGenerator: (req) => req.ip,
  errorResponseBuilder: (_req, ctx) => ({
    statusCode: 429,
    error: `Slow down a little — try again in ${Math.ceil(ctx.ttl / 1000)}s`,
  }),
});

app.get('/api/health', async (_req, reply) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    return { ok: true };
  } catch (err) {
    return reply.code(503).send({ ok: false, error: String(err) });
  }
});

authRoutes(app);
publicRoutes(app);
adminRoutes(app);

const isBackendPath = (u: string) => u.startsWith('/api/') || u.startsWith('/media/') || u.startsWith('/ws');

if (config.isProd) {
  const root = path.resolve('dist/web');
  const fastifyStatic = (await import('@fastify/static')).default;
  await app.register(fastifyStatic, {
    root,
    wildcard: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) res.header('cache-control', 'public, max-age=31536000, immutable');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || isBackendPath(req.url)) return reply.code(404).send({ error: 'Not found' });
    reply.header('cache-control', 'no-cache');
    return reply.sendFile('index.html');
  });
} else {
  // Dev: Vite runs in middleware mode inside this server — one port, HMR over the same origin.
  const { createServer } = await import('vite');
  const middie = (await import('@fastify/middie')).default;
  const vite = await createServer({
    server: {
      middlewareMode: true,
      ws: { server: app.server, clientPort: config.hmrClientPort },
    },
    appType: 'spa',
  });
  await app.register(middie);
  app.use((req, res, next) => (isBackendPath(req.url ?? '') ? next() : vite.middlewares(req, res, next)));
  app.addHook('onClose', async () => vite.close());
}

await setupLive(app);

await migrate();
await connectQueue(app.log);
if (!(await demoExists())) {
  app.log.info('seeding demo event');
  // Another container may seed concurrently; the slug's unique index makes that a no-op.
  await seedDemo().catch((err) => app.log.warn({ err }, 'demo seed skipped'));
}

const shutdown = async () => {
  await app.close();
  await closeQueue().catch(() => {});
  redis.disconnect();
  subscriber.disconnect();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: '0.0.0.0', port: config.port });
