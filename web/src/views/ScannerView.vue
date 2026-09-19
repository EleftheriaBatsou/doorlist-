<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import QrScanner from 'qr-scanner';
import Avatar from '../components/Avatar.vue';
import CountUp from '../components/CountUp.vue';
import { api, ApiError, isNetworkError } from '../lib/api';
import { playFeedback, unlockAudio, type Feedback } from '../lib/feedback';
import { fmtTime, uuid } from '../lib/format';
import { useLive } from '../lib/live';
import { enqueueScan, pendingScans, syncScans, type PendingScan } from '../lib/offline-queue';
import type { EventSummary, LiveMessage, ScanOutcome, Stats, Ticket } from '../lib/types';

const route = useRoute();
const eventId = route.params.id as string;

const ev = ref<EventSummary | null>(null);
const stats = ref<Stats | null>(null);
const roster = ref<Ticket[]>([]);
const online = ref(navigator.onLine);
const queued = ref(0);

// Door name is a per-device convenience, so it lives in localStorage.
const device = ref(safeGet('doorlist.device') ?? 'Main door');
function safeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function saveDevice() {
  try {
    localStorage.setItem('doorlist.device', device.value);
  } catch {
    /* private mode */
  }
}

// ---------- roster (in memory only: offline name lookup + manual search) ----------
const byCode = computed(() => new Map(roster.value.map((t) => [t.code, t])));
const byId = computed(() => new Map(roster.value.map((t) => [t.id, t])));
function markArrived(id: string | undefined, at: string | null, by: string | null) {
  const t = id ? byId.value.get(id) : undefined;
  if (t) Object.assign(t, { status: 'checked_in', checkedInAt: at, checkedInBy: by });
}

async function loadEvent() {
  const [e, r] = await Promise.all([api.get<EventSummary>(`/api/events/${eventId}`), api.get<Ticket[]>(`/api/events/${eventId}/tickets`)]);
  ev.value = e;
  stats.value = e.stats ?? null;
  roster.value = r;
  document.title = `Scan · ${e.title}`;
}

// ---------- camera ----------
const video = ref<HTMLVideoElement | null>(null);
let scanner: QrScanner | null = null;
const started = ref(false);
const camError = ref('');
const hasTorch = ref(false);
const torchOn = ref(false);
let wakeLock: any = null;

async function start() {
  unlockAudio();
  saveDevice();
  camError.value = '';
  if (!window.isSecureContext) {
    camError.value = 'The camera needs HTTPS. Open this page via its https:// address.';
    return;
  }
  started.value = true;
  await nextTick();
  try {
    scanner = new QrScanner(video.value!, (r) => onDecode(r.data), {
      preferredCamera: 'environment',
      maxScansPerSecond: 10,
      highlightScanRegion: false,
      highlightCodeOutline: false,
      returnDetailedScanResult: true,
    });
    await scanner.start();
    hasTorch.value = await scanner.hasFlash().catch(() => false);
    wakeLock = await (navigator as any).wakeLock?.request('screen').catch(() => null);
  } catch (e) {
    started.value = false;
    const msg = String((e as Error)?.message ?? e);
    camError.value = /denied|NotAllowed/i.test(msg)
      ? 'Camera permission was denied. Allow camera access in your browser settings, then try again.'
      : /not found|no camera/i.test(msg)
        ? 'No camera found on this device. You can still check people in with “Find attendee”.'
        : `Couldn’t start the camera: ${msg}`;
  }
}

async function toggleTorch() {
  if (!scanner) return;
  await scanner.toggleFlash();
  torchOn.value = scanner.isFlashOn();
}

// ---------- result overlay ----------
interface Overlay {
  kind: Feedback;
  title: string;
  name?: string;
  detail?: string;
}
const overlay = ref<Overlay | null>(null);
let overlayTimer: ReturnType<typeof setTimeout> | undefined;

function show(o: Overlay) {
  clearTimeout(overlayTimer);
  overlay.value = o;
  playFeedback(o.kind);
  overlayTimer = setTimeout(dismiss, o.kind === 'success' ? 1600 : o.kind === 'queued' ? 1500 : 2600);
}
function dismiss() {
  clearTimeout(overlayTimer);
  overlay.value = null;
}

function overlayFor(r: ScanOutcome): Overlay {
  const name = r.ticket?.name;
  switch (r.result) {
    case 'success':
      return { kind: 'success', title: 'Checked in', name };
    case 'already_used':
      return {
        kind: 'already_used',
        title: r.ticket?.checkedInAt ? `Already checked in at ${fmtTime(r.ticket.checkedInAt)}` : 'Already checked in',
        name,
        detail: r.ticket?.checkedInBy ? `by ${r.ticket.checkedInBy}` : undefined,
      };
    case 'wrong_event':
      return { kind: 'wrong_event', title: 'Wrong event', name, detail: r.otherEventTitle ? `Ticket is for “${r.otherEventTitle}”` : undefined };
    default:
      return {
        kind: 'invalid',
        title: r.reason === 'cancelled' ? 'Ticket cancelled' : 'Invalid ticket',
        name,
        detail: r.reason === 'cancelled' ? 'This ticket was cancelled by the organiser' : 'Not a Doorlist ticket, or it’s been tampered with',
      };
  }
}

// ---------- recent scans ----------
interface Recent {
  id: string;
  name: string;
  kind: Feedback;
  at: string;
  label: string;
}
const recent = ref<Recent[]>([]);
function pushRecent(r: Recent) {
  recent.value = [r, ...recent.value.filter((x) => x.id !== r.id)].slice(0, 5);
}
const recentLabel: Record<string, string> = {
  success: 'Checked in', already_used: 'Already used', invalid: 'Invalid', wrong_event: 'Wrong event', queued: 'Saved offline',
};

// ---------- scanning ----------
let lastRaw = '';
let lastAt = 0;

function onDecode(raw: string) {
  if (overlay.value || busy.value) return; // one result at a time
  const now = Date.now();
  if (raw === lastRaw && now - lastAt < 4000) return; // same code still in frame
  lastRaw = raw;
  lastAt = now;
  void submit({ clientScanId: uuid(), eventId, payload: raw, deviceLabel: device.value, scannedAt: new Date().toISOString() });
}

const busy = ref(false);

async function submit(scan: PendingScan) {
  busy.value = true;
  try {
    if (!navigator.onLine) return await saveOffline(scan);
    const { eventId: _e, ...body } = scan;
    const url = scan.ticketId ? `/api/events/${eventId}/tickets/${scan.ticketId}/check-in` : `/api/events/${eventId}/scan`;
    const r = await api.post<ScanOutcome>(url, body, { timeoutMs: 3500 });
    online.value = true;
    handleOutcome(scan.clientScanId, r);
  } catch (e) {
    if (isNetworkError(e)) {
      online.value = false;
      await saveOffline(scan);
    } else {
      show({ kind: 'invalid', title: 'Scan failed', detail: e instanceof ApiError ? e.message : String(e) });
    }
  } finally {
    busy.value = false;
  }
}

function handleOutcome(id: string, r: ScanOutcome) {
  if (r.stats) stats.value = r.stats;
  if (r.result === 'success') markArrived(r.ticket?.id, r.ticket?.checkedInAt ?? null, r.ticket?.checkedInBy ?? null);
  const o = overlayFor(r);
  show(o);
  pushRecent({ id, name: r.ticket?.name ?? 'Unknown code', kind: r.result, at: new Date().toISOString(), label: recentLabel[r.result]! });
}

/** Offline: queue for sync, and give provisional feedback from the in-memory roster. */
async function saveOffline(scan: PendingScan) {
  await enqueueScan(scan);
  queued.value = (await pendingScans(eventId)).length;
  const code = scan.payload?.split('.')[1];
  const t = scan.ticketId ? byId.value.get(scan.ticketId) : code ? byCode.value.get(code) : undefined;
  if (t && t.status === 'checked_in') {
    show({
      kind: 'already_used',
      title: t.checkedInAt ? `Already checked in at ${fmtTime(t.checkedInAt)}` : 'Already checked in',
      name: t.name,
      detail: 'Offline check — will confirm when back online',
    });
    pushRecent({ id: scan.clientScanId, name: t.name, kind: 'already_used', at: scan.scannedAt, label: 'Already used (offline)' });
    return;
  }
  if (t && t.status === 'cancelled') {
    show({ kind: 'invalid', title: 'Ticket cancelled', name: t.name, detail: 'Offline check' });
    pushRecent({ id: scan.clientScanId, name: t.name, kind: 'invalid', at: scan.scannedAt, label: 'Cancelled (offline)' });
    return;
  }
  if (t) markArrived(t.id, scan.scannedAt, device.value); // provisional; the server confirms on sync
  show({
    kind: 'queued',
    title: 'Saved offline',
    name: t?.name,
    detail: t ? 'Let them in — this syncs when the connection is back' : 'Unknown code — will verify when back online',
  });
  pushRecent({ id: scan.clientScanId, name: t?.name ?? 'Unknown code', kind: 'queued', at: scan.scannedAt, label: 'Saved offline' });
}

// ---------- sync ----------
const syncNote = ref('');
async function trySync() {
  const pending = await pendingScans(eventId);
  queued.value = pending.length;
  if (!pending.length) return;
  const res = await syncScans(eventId).catch(() => null);
  if (!res) {
    online.value = false;
    return;
  }
  online.value = true;
  if (res.stats) stats.value = res.stats;
  const conflicts: string[] = [];
  for (const s of res.synced) {
    const r = s.outcome;
    if (r.result === 'success') markArrived(r.ticket?.id, r.ticket?.checkedInAt ?? null, r.ticket?.checkedInBy ?? null);
    else if (!r.replayed) conflicts.push(`${r.ticket?.name ?? 'Unknown code'}: ${recentLabel[r.result]!.toLowerCase()}`);
    const existing = recent.value.find((x) => x.id === s.clientScanId);
    if (existing) Object.assign(existing, { kind: r.result, label: `${recentLabel[r.result]} (synced)` });
  }
  queued.value = (await pendingScans(eventId)).length;
  syncNote.value = `Synced ${res.synced.length} offline scan${res.synced.length === 1 ? '' : 's'}${conflicts.length ? ` · ⚠ ${conflicts.join(', ')}` : ''}`;
  setTimeout(() => (syncNote.value = ''), conflicts.length ? 9000 : 4000);
}

const goOnline = () => {
  online.value = true;
  void trySync();
};
const goOffline = () => (online.value = false);
let syncTimer: ReturnType<typeof setInterval> | undefined;

// ---------- live updates from other doors ----------
useLive(
  () => eventId,
  (m: LiveMessage) => {
    if (m.type === 'scan') {
      if (m.stats) stats.value = m.stats;
      if (m.result === 'success' && m.ticket) markArrived(m.ticket.id, m.ticket.checkedInAt, m.ticket.checkedInBy);
    } else if (m.type === 'ticket') {
      if (m.stats) stats.value = m.stats;
      void api.get<Ticket[]>(`/api/events/${eventId}/tickets`).then((r) => (roster.value = r)).catch(() => {});
    }
  },
  () => void trySync(),
);

// ---------- manual fallback ----------
const sheet = ref(false);
const search = ref('');
const searchInput = ref<HTMLInputElement | null>(null);
const matches = computed(() => {
  const q = search.value.trim().toLowerCase();
  const list = roster.value.filter((t) => t.status !== 'cancelled');
  if (!q) return list.filter((t) => t.status === 'valid').slice(0, 30);
  return list.filter((t) => t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q)).slice(0, 30);
});
async function openSheet() {
  unlockAudio();
  sheet.value = true;
  await nextTick();
  searchInput.value?.focus();
}
async function manualCheckIn(t: Ticket) {
  sheet.value = false;
  search.value = '';
  await submit({ clientScanId: uuid(), eventId, ticketId: t.id, deviceLabel: `${device.value} (manual)`, scannedAt: new Date().toISOString() });
}

// ---------- lifecycle ----------
const reactiveState = reactive({ loading: true, loadError: '' });
onMounted(async () => {
  window.addEventListener('online', goOnline);
  window.addEventListener('offline', goOffline);
  syncTimer = setInterval(() => void trySync(), 8000);
  try {
    await loadEvent();
  } catch (e) {
    reactiveState.loadError = isNetworkError(e) ? 'You’re offline — connect once to load the guest list.' : String((e as Error).message);
  } finally {
    reactiveState.loading = false;
  }
  void trySync();
});
onBeforeUnmount(() => {
  window.removeEventListener('online', goOnline);
  window.removeEventListener('offline', goOffline);
  clearInterval(syncTimer);
  clearTimeout(overlayTimer);
  scanner?.destroy();
  wakeLock?.release?.().catch(() => {});
});

const icon: Record<string, string> = { success: '✓', already_used: '!', invalid: '✕', wrong_event: '✕', queued: '⏱' };
</script>

<template>
  <div class="scanner">
    <!-- top bar -->
    <header class="bar">
      <RouterLink :to="`/admin/events/${eventId}`" class="back" aria-label="Back to dashboard">‹</RouterLink>
      <div class="bar-mid">
        <div class="ev-title">{{ ev?.title ?? 'Loading…' }}</div>
        <div class="conn" :class="online ? 'on' : 'off'">
          <span class="cdot" />{{ online ? 'Online' : 'Offline' }}<template v-if="queued"> · {{ queued }} queued</template> · {{ device }}
        </div>
      </div>
      <div class="count" aria-live="polite">
        <strong><CountUp :value="stats?.checkedIn ?? 0" /></strong><span> / {{ stats?.issued ?? '–' }}</span>
        <div class="count-l">checked in</div>
      </div>
    </header>

    <!-- camera -->
    <section class="cam">
      <video ref="video" class="video" :class="{ live: started }" muted playsinline />
      <div v-if="started" class="finder" aria-hidden="true">
        <span class="c tl" /><span class="c tr" /><span class="c bl" /><span class="c br" />
        <span class="laser" />
      </div>
      <div v-if="started" class="hint">Point at a ticket QR</div>

      <div v-if="!started" class="start">
        <div class="start-card">
          <div class="big-ico" aria-hidden="true">📷</div>
          <h1>Ready at the door?</h1>
          <p>Name this device so the organiser sees which door checked each guest in.</p>
          <label class="door">
            <span>Door name</span>
            <input v-model="device" maxlength="30" placeholder="Main door" />
          </label>
          <p v-if="camError" class="cam-err">{{ camError }}</p>
          <p v-if="reactiveState.loadError" class="cam-err">{{ reactiveState.loadError }}</p>
          <button class="go" :disabled="reactiveState.loading" @click="start">Start scanning</button>
        </div>
      </div>
      <div v-if="syncNote" class="sync-note">{{ syncNote }}</div>
    </section>

    <!-- bottom -->
    <section class="bottom">
      <ul class="recent">
        <li v-for="r in recent" :key="r.id" :class="`k-${r.kind}`">
          <span class="rdot">{{ icon[r.kind] }}</span>
          <span class="rname">{{ r.name }}</span>
          <span class="rlabel">{{ r.label }}</span>
          <time>{{ fmtTime(r.at) }}</time>
        </li>
        <li v-if="!recent.length" class="empty">Scans will appear here</li>
      </ul>
      <div class="actions">
        <button class="find" @click="openSheet">🔍 Find attendee</button>
        <button v-if="hasTorch" class="torch" :class="{ on: torchOn }" :aria-pressed="torchOn" aria-label="Toggle torch" @click="toggleTorch">🔦</button>
      </div>
    </section>

    <!-- full-bleed result -->
    <Transition name="result">
      <div v-if="overlay" class="result" :class="`res-${overlay.kind}`" role="alert" @click="dismiss">
        <div class="res-ico">{{ icon[overlay.kind] }}</div>
        <div class="res-title">{{ overlay.title }}</div>
        <div v-if="overlay.name" class="res-name">{{ overlay.name }}</div>
        <div v-if="overlay.detail" class="res-detail">{{ overlay.detail }}</div>
        <div class="res-tap">Tap to continue</div>
      </div>
    </Transition>

    <!-- manual search sheet -->
    <Transition name="sheet">
      <div v-if="sheet" class="sheet-wrap" @click.self="sheet = false">
        <div class="sheet" role="dialog" aria-label="Find attendee">
          <div class="grab" />
          <div class="sheet-head">
            <input ref="searchInput" v-model="search" class="s-input" type="search" placeholder="Search name or email" enterkeyhint="search" />
            <button class="s-close" @click="sheet = false">Done</button>
          </div>
          <div class="s-hint">{{ search ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'Not arrived yet' }}</div>
          <ul class="s-list">
            <li v-for="t in matches" :key="t.id">
              <Avatar :name="t.name" :size="40" />
              <div class="s-who">
                <div class="s-name">{{ t.name }}</div>
                <div class="s-email">{{ t.email }}</div>
              </div>
              <button v-if="t.status === 'valid'" class="s-btn" @click="manualCheckIn(t)">Check in</button>
              <span v-else class="s-done">✓ {{ t.checkedInAt ? fmtTime(t.checkedInAt) : 'In' }}</span>
            </li>
            <li v-if="!matches.length" class="s-empty">No one found. Check the spelling or search by email.</li>
          </ul>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.scanner {
  --dark: #12101f;
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--dark);
  color: #fff;
  overflow: hidden;
  user-select: none;
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(env(safe-area-inset-top) + 10px) 14px 10px;
  background: #1b1830;
}
.back {
  color: #fff;
  font-size: 34px;
  line-height: 1;
  width: 40px;
  height: 44px;
  display: grid;
  place-items: center;
  text-decoration: none !important;
  margin-left: -6px;
}
.bar-mid {
  flex: 1;
  min-width: 0;
}
.ev-title {
  font-weight: 800;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conn {
  font-size: 12px;
  color: #b9b4d6;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cdot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 5px;
  vertical-align: 1px;
}
.conn.on .cdot {
  background: var(--success);
}
.conn.off {
  color: var(--warn);
}
.conn.off .cdot {
  background: var(--warn);
}
.count {
  text-align: right;
  line-height: 1;
}
.count strong {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.03em;
}
.count span {
  font-size: 16px;
  color: #b9b4d6;
  font-weight: 700;
}
.count-l {
  font-size: 11px;
  color: #b9b4d6;
  font-weight: 700;
  margin-top: 3px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.cam {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #000;
}
.video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.4s ease;
}
.video.live {
  opacity: 1;
}
.finder {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(68vw, 300px);
  aspect-ratio: 1;
  transform: translate(-50%, -54%);
  border-radius: 28px;
  box-shadow: 0 0 0 100vmax rgba(10, 8, 24, 0.45);
}
.c {
  position: absolute;
  width: 44px;
  height: 44px;
  border: 5px solid #fff;
}
.tl { top: -3px; left: -3px; border-right: 0; border-bottom: 0; border-radius: 28px 0 0 0; }
.tr { top: -3px; right: -3px; border-left: 0; border-bottom: 0; border-radius: 0 28px 0 0; }
.bl { bottom: -3px; left: -3px; border-right: 0; border-top: 0; border-radius: 0 0 0 28px; }
.br { bottom: -3px; right: -3px; border-left: 0; border-top: 0; border-radius: 0 0 28px 0; }
.laser {
  position: absolute;
  left: 10%;
  right: 10%;
  height: 3px;
  border-radius: 3px;
  background: var(--accent);
  box-shadow: 0 0 16px 4px rgba(124, 92, 255, 0.7);
  animation: laser 2.2s ease-in-out infinite;
}
@keyframes laser {
  0%, 100% { top: 12%; }
  50% { top: 86%; }
}
.hint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 18px;
  text-align: center;
  font-weight: 700;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
}
.start {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: radial-gradient(120% 90% at 50% 0%, #3a2a8f 0%, var(--dark) 70%);
}
.start-card {
  width: 100%;
  max-width: 360px;
  text-align: center;
  display: grid;
  gap: 14px;
}
.big-ico {
  font-size: 44px;
}
.start h1 {
  font-size: 26px;
}
.start p {
  margin: 0;
  color: #cfcae8;
  font-size: 15px;
}
.door {
  display: grid;
  gap: 6px;
  text-align: left;
  font-size: 13px;
  font-weight: 700;
  color: #cfcae8;
}
.door input {
  font: inherit;
  font-size: 17px;
  font-weight: 700;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1.5px solid #4a4380;
  background: #221e3d;
  color: #fff;
  outline: none;
}
.door input:focus {
  border-color: var(--accent);
}
.go {
  font: inherit;
  font-size: 18px;
  font-weight: 800;
  border: 0;
  border-radius: 18px;
  padding: 18px;
  background: var(--accent);
  color: #fff;
  box-shadow: 0 10px 30px rgba(124, 92, 255, 0.5);
  cursor: pointer;
  transition: transform 0.25s var(--spring);
}
.go:active {
  transform: scale(0.97);
}
.go:disabled {
  opacity: 0.6;
}
.cam-err {
  color: #ffc1ce !important;
  font-weight: 600;
}
.sync-note {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  background: rgba(27, 24, 48, 0.94);
  border: 1px solid #3b3566;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 13.5px;
  font-weight: 700;
  text-align: center;
}

.bottom {
  background: #1b1830;
  padding: 10px 14px calc(env(safe-area-inset-bottom) + 12px);
  display: grid;
  gap: 10px;
}
.recent {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
  min-height: 92px;
}
.recent li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  padding: 3px 0;
}
.rdot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 900;
  flex: none;
  color: var(--ink);
}
.k-success .rdot { background: var(--success); }
.k-already_used .rdot { background: var(--warn); }
.k-invalid .rdot, .k-wrong_event .rdot { background: var(--danger); }
.k-queued .rdot { background: var(--accent); color: #fff; font-size: 10px; }
.rname {
  font-weight: 700;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rlabel {
  color: #b9b4d6;
  font-size: 12.5px;
  white-space: nowrap;
}
.recent time {
  color: #b9b4d6;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
.recent .empty {
  color: #8d88ad;
  justify-content: center;
  font-size: 13.5px;
}
.actions {
  display: flex;
  gap: 10px;
}
.find {
  flex: 1;
  font: inherit;
  font-size: 17px;
  font-weight: 800;
  border: 0;
  border-radius: 16px;
  padding: 17px;
  background: #fff;
  color: var(--ink);
  cursor: pointer;
}
.find:active {
  transform: scale(0.98);
}
.torch {
  width: 60px;
  border: 0;
  border-radius: 16px;
  background: #2c2750;
  font-size: 22px;
  cursor: pointer;
}
.torch.on {
  background: var(--warn);
}

/* result: full-bleed, unmissable */
.result {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 24px;
  gap: 10px;
  color: #10121a;
}
.res-success { background: var(--success); color: #05290f; }
.res-already_used { background: var(--warn); color: #2b1d00; }
.res-invalid, .res-wrong_event { background: var(--danger); color: #2e0410; }
.res-queued { background: var(--accent); color: #fff; }
.res-ico {
  width: 150px;
  height: 150px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 92px;
  font-weight: 900;
  background: rgba(255, 255, 255, 0.35);
  animation: pop 0.5s var(--spring) both;
}
.res-title {
  font-size: clamp(30px, 8vw, 44px);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.1;
  margin-top: 12px;
}
.res-name {
  font-size: clamp(26px, 7vw, 38px);
  font-weight: 700;
  letter-spacing: -0.02em;
}
.res-detail {
  font-size: 17px;
  font-weight: 600;
  opacity: 0.85;
  max-width: 340px;
}
.res-tap {
  position: absolute;
  bottom: calc(env(safe-area-inset-bottom) + 24px);
  font-size: 13px;
  font-weight: 700;
  opacity: 0.6;
}
@keyframes pop {
  from { transform: scale(0.4); opacity: 0; }
}
.result-enter-active { transition: opacity 0.12s ease, transform 0.35s var(--spring); }
.result-leave-active { transition: opacity 0.2s ease; }
.result-enter-from { opacity: 0; transform: scale(1.06); }
.result-leave-to { opacity: 0; }

/* manual search sheet */
.sheet-wrap {
  position: fixed;
  inset: 0;
  z-index: 30;
  background: rgba(10, 8, 24, 0.55);
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  max-height: 88dvh;
  background: var(--bg);
  color: var(--ink);
  border-radius: 24px 24px 0 0;
  display: flex;
  flex-direction: column;
  padding: 8px 14px calc(env(safe-area-inset-bottom) + 12px);
}
.grab {
  width: 44px;
  height: 5px;
  border-radius: 99px;
  background: #d6d2e6;
  margin: 4px auto 10px;
}
.sheet-head {
  display: flex;
  gap: 8px;
}
.s-input {
  flex: 1;
  font: inherit;
  font-size: 17px;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1.5px solid var(--line-strong);
  outline: none;
  background: #fff;
}
.s-input:focus {
  border-color: var(--accent);
}
.s-close {
  font: inherit;
  font-weight: 800;
  border: 0;
  background: none;
  color: var(--accent-ink);
  padding: 0 8px;
  cursor: pointer;
}
.s-hint {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--muted);
  margin: 10px 4px 4px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.s-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  min-height: 200px;
}
.s-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--line);
}
.s-who {
  flex: 1;
  min-width: 0;
}
.s-name {
  font-weight: 700;
}
.s-email {
  font-size: 13px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.s-btn {
  font: inherit;
  font-weight: 800;
  font-size: 15px;
  border: 0;
  border-radius: 12px;
  padding: 12px 16px;
  background: var(--success);
  color: #05290f;
  cursor: pointer;
}
.s-done {
  font-weight: 700;
  color: var(--success-ink);
  font-size: 14px;
}
.s-empty {
  color: var(--muted);
  justify-content: center;
  padding: 24px !important;
}
.sheet-enter-active,
.sheet-leave-active {
  transition: background 0.25s ease;
}
.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform 0.4s var(--spring);
}
.sheet-enter-from,
.sheet-leave-to {
  background: rgba(10, 8, 24, 0);
}
.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(100%);
}
</style>
