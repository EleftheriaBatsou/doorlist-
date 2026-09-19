import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, jetstreamManager, RetentionPolicy, StorageType, type JetStreamClient } from '@nats-io/jetstream';
import { config } from './config.js';

export const STREAM = 'TICKETS';

export type TicketJob =
  | { kind: 'issue'; ticketId: string; sendEmail: boolean }
  | { kind: 'resend'; ticketId: string };

let nc: NatsConnection | undefined;
let js: JetStreamClient | undefined;

/**
 * JetStream (not core pub/sub): jobs persist on the broker until the worker acks,
 * so an RSVP is never lost if the worker is down or an email send fails.
 */
export async function connectQueue(log: { info: (m: string) => void }) {
  nc = await connect({ servers: config.nats.servers, user: config.nats.user, pass: config.nats.pass, name: 'api' });
  const jsm = await jetstreamManager(nc);
  const streamCfg = {
    name: STREAM,
    subjects: ['tickets.>'],
    retention: RetentionPolicy.Workqueue,
    storage: StorageType.File,
    duplicate_window: 2 * 60 * 1_000_000_000, // ns — dedupes by msgID
  };
  try {
    await jsm.streams.info(STREAM);
  } catch {
    await jsm.streams.add(streamCfg);
    log.info(`created JetStream stream ${STREAM}`);
  }
  js = jetstream(nc);
}

export async function enqueue(job: TicketJob, msgID?: string) {
  if (!js) throw new Error('queue not connected');
  await js.publish(`tickets.${job.kind}`, JSON.stringify(job), msgID ? { msgID } : undefined);
}

export async function closeQueue() {
  await nc?.drain();
}
