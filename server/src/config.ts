function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

/** Public origin used in emails and links. Explicit PUBLIC_URL wins (custom domain). */
function publicUrl(): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  // zeropsSubdomain is platform-injected on runtimes with subdomain access.
  const sub = process.env.zeropsSubdomain;
  if (sub) return (sub.startsWith('http') ? sub : `https://${sub}`).replace(/\/$/, '');
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  publicUrl: publicUrl(),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),
  nats: {
    servers: `${required('NATS_HOST')}:${required('NATS_PORT')}`,
    user: required('NATS_USER'),
    pass: required('NATS_PASS'),
  },
  s3: {
    endpoint: required('S3_ENDPOINT'),
    bucket: required('S3_BUCKET'),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    region: process.env.S3_REGION ?? 'us-east-1',
  },
  // Project-level secrets, shared with the worker.
  ticketSecret: required('TICKET_SECRET'),
  sessionSecret: required('SESSION_SECRET'),
  hmrClientPort: process.env.HMR_CLIENT_PORT ? Number(process.env.HMR_CLIENT_PORT) : undefined,
};
