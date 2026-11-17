import * as Sentry from '@sentry/node';

// Loaded first (see the top of index.ts) so Sentry can hook in before anything else.
// The DSN comes from the SENTRY_DSN env var set in Zerops; with no DSN, Sentry stays off.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 1.0,
});
