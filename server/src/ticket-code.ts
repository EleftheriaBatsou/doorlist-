import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

// QR payload: "DL1.<ticket_code>.<sig>"
//   ticket_code = 128 random bits (base64url) — unguessable, never sequential
//   sig         = HMAC-SHA256(TICKET_SECRET, ticket_code), truncated to 96 bits
// A forged or mistyped code fails the signature check before touching the database.
const PREFIX = 'DL1';

export function newTicketCode(): string {
  return randomBytes(16).toString('base64url');
}

function sign(code: string): string {
  return createHmac('sha256', config.ticketSecret).update(code).digest().subarray(0, 12).toString('base64url');
}

export function qrPayload(code: string): string {
  return `${PREFIX}.${code}.${sign(code)}`;
}

/** Returns the ticket_code if the payload is authentic, otherwise null. */
export function verifyPayload(payload: string): string | null {
  const parts = payload.trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, code, sig] = parts;
  if (!/^[A-Za-z0-9_-]{22}$/.test(code)) return null;
  const expected = Buffer.from(sign(code));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return code;
}
