import { createStore, del, entries, set } from 'idb-keyval';
import { api, isNetworkError } from './api';
import type { ScanOutcome, Stats } from './types';

/**
 * Scans taken while the venue Wi-Fi is down wait here (IndexedDB) until they can be
 * synced. This is a transient outbox, not a data store: the server decides every outcome,
 * and each scan carries a clientScanId so a retried sync can't double-count.
 */
export interface PendingScan {
  clientScanId: string;
  eventId: string;
  payload?: string;
  ticketId?: string;
  deviceLabel: string;
  scannedAt: string;
}

const store = createStore('doorlist-outbox', 'scans');

export async function enqueueScan(s: PendingScan) {
  await set(s.clientScanId, s, store);
}

export async function pendingScans(eventId: string): Promise<PendingScan[]> {
  const all = (await entries<string, PendingScan>(store)).map(([, v]) => v);
  return all.filter((s) => s.eventId === eventId).sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
}

export interface SyncResult {
  synced: Array<PendingScan & { outcome: ScanOutcome }>;
  stats?: Stats | null;
}

let syncing = false;

/** Push queued scans in order; returns per-scan server outcomes. Leaves them queued on network failure. */
export async function syncScans(eventId: string): Promise<SyncResult | null> {
  if (syncing) return null;
  syncing = true;
  try {
    const pending = await pendingScans(eventId);
    if (!pending.length) return { synced: [] };
    const batch = pending.slice(0, 100);
    const res = await api.post<{ results: Array<ScanOutcome & { clientScanId: string }>; stats: Stats }>(
      `/api/events/${eventId}/scan/batch`,
      { scans: batch.map(({ eventId: _e, ...s }) => s) },
      { timeoutMs: 15_000 },
    );
    const synced: SyncResult['synced'] = [];
    for (const r of res.results) {
      const p = batch.find((b) => b.clientScanId === r.clientScanId);
      if (!p) continue;
      await del(p.clientScanId, store);
      synced.push({ ...p, outcome: r });
    }
    return { synced, stats: res.stats };
  } catch (e) {
    if (isNetworkError(e)) return null;
    throw e;
  } finally {
    syncing = false;
  }
}
