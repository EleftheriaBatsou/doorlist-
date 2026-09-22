# Doorlist

Self-hosted event ticketing focused on the door: create an event, let people RSVP, issue each attendee a unique QR ticket, and scan tickets in with a phone camera. The organiser watches arrivals live.

This repo is the web app — a Vue 3 frontend and a Fastify API served from one origin. QR rendering and ticket email live in the companion worker: [doorlist-worker](https://github.com/EleftheriaBatsou/doorlist-worker).

## Features

- **Public RSVP page** at `/e/:slug`, with a capacity meter. Capacity is enforced inside a transaction (`SELECT … FOR UPDATE` on the event row), so a rush of simultaneous RSVPs can't oversell.
- **Ticket page** at `/t/:code` with the QR code and an "add to calendar" `.ics` file.
- **Mobile scanner** at `/scan/:eventId`:
  - reads QR codes continuously from the phone camera;
  - shows a full-screen green / amber / red result, with a distinct sound and vibration for each;
  - manual search and check-in as a fallback;
  - scans taken offline wait in IndexedDB and sync when the connection returns.
- **Organiser dashboard:** live arrival counter, arrival-curve chart, live scan feed, attendee list with filters and search, manual check-in, resend and cancel.
- **Accounts:** register and log in; each organiser sees only their own events.

## Single-use check-in

A scan is one conditional update, inside a transaction that also writes the check-in log:

```sql
UPDATE tickets SET status = 'checked_in', checked_in_at = now()
WHERE ticket_code = $1 AND event_id = $2 AND status = 'valid'
```

If two doors scan the same ticket at the same instant, Postgres row locking lets exactly one of those updates succeed. The other matches zero rows and reports "already checked in". Every attempt is logged, successful or not. Offline scans carry a client-generated id, so a retried sync never counts twice.

QR codes encode `DL1.<ticket_code>.<hmac>`. The ticket code is 128 random bits, and forged or mistyped codes fail the signature check before the database is queried.

## Architecture

| Piece | Tech | Role |
|---|---|---|
| This app | Node 24, Fastify 5, Vue 3.5, Vite 8, TypeScript | API, WebSocket hub, SPA |
| Worker | Node 24 ([doorlist-worker](https://github.com/EleftheriaBatsou/doorlist-worker)) | QR PNGs, `.ics` files, ticket email with retries |
| `db` | PostgreSQL 18 | Source of truth: users, events, tickets, check-in log |
| `queue` | NATS JetStream | Durable ticket jobs (RSVP returns immediately) |
| `cache` | Valkey | Live counters, pub/sub to dashboards, rate limits, sessions |
| `storage` | S3-compatible object storage | QR images, cover images, `.ics` files, email previews |

Live updates: every scan publishes to a cache channel, and each API instance relays it to its WebSocket clients, so dashboards and other door scanners update instantly.

## Running on Zerops

`zerops.yaml` defines two setups:

- **`dev`** — a mutable workspace. The dev server runs Fastify with Vite in middleware mode (`npm run dev`, live reload on one port).
- **`prod`** — `npm ci && npm run build`, then `node dist/server/index.js`, with a health check on `/api/health`.

Connection details come from Zerops service references (`${db_*}`, `${cache_*}`, `${queue_*}`, `${storage_*}`). Project-level secrets are `TICKET_SECRET` and `SESSION_SECRET`, shared with the worker.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with live reload (port 3000) |
| `npm run build` | Production build: SPA into `dist/web`, server into `dist/server` |
| `npm start` | Run the production build |
| `npm run typecheck` | Server type-check (TypeScript 7) plus `.vue` files |

`.vue` files are type-checked via `tools/vue-typecheck`, which pins TypeScript 6.0.3. `vue-tsc` needs the TypeScript JS API, which TypeScript 7's native compiler no longer ships.
