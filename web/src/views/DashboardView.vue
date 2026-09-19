<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import ArrivalChart from '../components/ArrivalChart.vue';
import Avatar from '../components/Avatar.vue';
import CountUp from '../components/CountUp.vue';
import StatusPill from '../components/StatusPill.vue';
import { api, ApiError } from '../lib/api';
import { fmtDateLong, fmtTime, relTime } from '../lib/format';
import { useLive } from '../lib/live';
import type { EventSummary, LiveMessage, ScanLogEntry, ScanOutcome, Stats, Ticket } from '../lib/types';

const route = useRoute();
const router = useRouter();
const id = computed(() => route.params.id as string);

const ev = ref<EventSummary | null>(null);
const stats = ref<Stats>({ checkedIn: 0, issued: 0, capacity: 0 });
const tickets = ref<Ticket[]>([]);
const arrivals = ref<string[]>([]);
const scans = ref<ScanLogEntry[]>([]);
const pulse = ref(0);
const toasts = ref<{ id: number; text: string; kind: string }[]>([]);
let toastId = 0;

function toast(text: string, kind = 'info') {
  const t = { id: ++toastId, text, kind };
  toasts.value.push(t);
  setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== t.id)), 3500);
}

async function loadAll() {
  const [e, t, a, s] = await Promise.all([
    api.get<EventSummary>(`/api/events/${id.value}`),
    api.get<Ticket[]>(`/api/events/${id.value}/tickets`),
    api.get<string[]>(`/api/events/${id.value}/arrivals`),
    api.get<ScanLogEntry[]>(`/api/events/${id.value}/scans?limit=12`),
  ]);
  ev.value = e;
  if (e.stats) stats.value = e.stats;
  tickets.value = t;
  arrivals.value = a;
  scans.value = s;
  document.title = `${e.title} · Live`;
}

let rosterTimer: ReturnType<typeof setTimeout> | undefined;
const refreshRoster = () => {
  clearTimeout(rosterTimer);
  rosterTimer = setTimeout(async () => (tickets.value = await api.get<Ticket[]>(`/api/events/${id.value}/tickets`)), 400);
};

function applyStats(s?: Stats | null) {
  if (!s) return;
  if (s.checkedIn > stats.value.checkedIn) pulse.value++;
  stats.value = s;
}

const live = useLive(
  () => id.value,
  (m: LiveMessage) => {
    if (m.type === 'scan') {
      applyStats(m.stats);
      scans.value = [
        { id: `live-${Date.now()}-${Math.random()}`, at: m.at, result: m.result, reason: m.reason, device: m.device, name: m.ticket?.name ?? null, ticketId: m.ticket?.id },
        ...scans.value,
      ].slice(0, 12);
      if (m.result === 'success' && m.ticket) {
        arrivals.value = [...arrivals.value, m.ticket.checkedInAt ?? m.at];
        const t = tickets.value.find((x) => x.id === m.ticket!.id);
        if (t) Object.assign(t, { status: 'checked_in', checkedInAt: m.ticket.checkedInAt, checkedInBy: m.ticket.checkedInBy });
      }
    } else if (m.type === 'ticket') {
      applyStats(m.stats);
      refreshRoster();
    }
  },
  () => loadAll(),
);

onMounted(loadAll);

// Attendee list
const filter = ref<'all' | 'checked_in' | 'valid' | 'cancelled'>('all');
const q = ref('');
const counts = computed(() => ({
  all: tickets.value.filter((t) => t.status !== 'cancelled').length,
  checked_in: tickets.value.filter((t) => t.status === 'checked_in').length,
  valid: tickets.value.filter((t) => t.status === 'valid').length,
  cancelled: tickets.value.filter((t) => t.status === 'cancelled').length,
}));
const visible = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return tickets.value
    .filter((t) => (filter.value === 'all' ? t.status !== 'cancelled' : t.status === filter.value))
    .filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.email.toLowerCase().includes(needle))
    .sort((a, b) =>
      filter.value === 'checked_in'
        ? (b.checkedInAt ?? '').localeCompare(a.checkedInAt ?? '')
        : a.name.localeCompare(b.name),
    );
});

const busyRow = reactive<Record<string, boolean>>({});
async function rowAction(t: Ticket, action: 'checkin' | 'resend' | 'cancel') {
  if (action === 'cancel' && !confirm(`Cancel ${t.name}’s ticket? Their QR code will stop working.`)) return;
  busyRow[t.id] = true;
  try {
    if (action === 'checkin') {
      const r = await api.post<ScanOutcome>(`/api/events/${id.value}/tickets/${t.id}/check-in`, { deviceLabel: 'Dashboard' });
      if (r.result === 'success') toast(`${t.name} checked in`, 'ok');
      else toast(`${t.name}: ${r.result === 'already_used' ? 'already checked in' : 'not valid'}`, 'warn');
    } else if (action === 'resend') {
      Object.assign(t, await api.post<Ticket>(`/api/tickets/${t.id}/resend`));
      toast(`Ticket email re-queued for ${t.name}`, 'ok');
    } else {
      Object.assign(t, await api.post<Ticket>(`/api/tickets/${t.id}/cancel`));
      toast(`${t.name}’s ticket cancelled`, 'warn');
    }
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Network error', 'bad');
  } finally {
    busyRow[t.id] = false;
  }
}

const adding = ref(false);
const newAtt = reactive({ name: '', email: '' });
async function addAttendee() {
  try {
    const r = await api.post<{ existing: boolean }>(`/api/events/${id.value}/tickets`, newAtt);
    toast(r.existing ? 'They already have a ticket' : `Ticket issued to ${newAtt.name}`, r.existing ? 'warn' : 'ok');
    newAtt.name = '';
    newAtt.email = '';
    adding.value = false;
    refreshRoster();
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Network error', 'bad');
  }
}

async function resetDemo() {
  if (!confirm('Reset the demo event? All its tickets and check-ins are recreated with a fresh arrival curve.')) return;
  const r = await api.post<{ id: string }>('/api/demo/reset');
  router.replace(`/admin/events/${r.id}`);
  setTimeout(loadAll, 50);
}

const pct = computed(() => (stats.value.issued ? Math.round((stats.value.checkedIn / stats.value.issued) * 100) : 0));
const scanLabel = (s: ScanLogEntry) =>
  s.result === 'success'
    ? 'Checked in'
    : s.result === 'already_used'
      ? 'Already used'
      : s.result === 'wrong_event'
        ? 'Wrong event'
        : s.reason === 'cancelled'
          ? 'Cancelled ticket'
          : 'Invalid ticket';
const emailLabel: Record<string, string> = {
  pending: 'Email queued', sent: 'Email sent', preview: 'Email preview', retrying: 'Retrying email', failed: 'Email failed', skipped: 'No email',
};
</script>

<template>
  <AppHeader admin />
  <main v-if="ev" class="container page">
    <div class="head">
      <div class="head-l">
        <div class="eyebrow">
          <span class="live-dot" :class="{ on: live.connected.value }" />
          {{ live.connected.value ? 'Live' : 'Reconnecting…' }} · {{ fmtDateLong(ev.startsAt) }}
        </div>
        <h1>{{ ev.title }}</h1>
      </div>
      <div class="head-actions">
        <RouterLink :to="`/scan/${ev.id}`" class="btn">📷 Open scanner</RouterLink>
        <a :href="`/e/${ev.slug}`" target="_blank" class="btn ghost">Public page ↗</a>
        <RouterLink :to="`/admin/events/${ev.id}/edit`" class="btn ghost">Edit</RouterLink>
      </div>
    </div>

    <section class="top">
      <div class="hero card" :key="pulse" :class="{ pulse: pulse > 0 }">
        <div class="hero-label">Checked in</div>
        <div class="hero-num">
          <CountUp :value="stats.checkedIn" />
          <span class="of">/ {{ stats.issued }}</span>
        </div>
        <div class="hero-bar"><div class="hero-fill" :style="{ width: `${pct}%` }" /></div>
        <div class="hero-sub">{{ pct }}% of ticket holders have arrived</div>
        <span class="ring" aria-hidden="true" />
      </div>
      <div class="tiles">
        <div class="tile card">
          <div class="t-label">Not arrived yet</div>
          <div class="t-val">{{ Math.max(0, stats.issued - stats.checkedIn) }}</div>
        </div>
        <div class="tile card">
          <div class="t-label">Tickets issued</div>
          <div class="t-val">{{ stats.issued }}</div>
        </div>
        <div class="tile card">
          <div class="t-label">Spots left</div>
          <div class="t-val">{{ Math.max(0, stats.capacity - stats.issued) }}<span class="t-of"> of {{ stats.capacity }}</span></div>
        </div>
      </div>
    </section>

    <section class="mid">
      <div class="card chart-card">
        <div class="card-head">
          <h2>Arrivals over time</h2>
          <span class="muted small">People checked in, cumulative — and per interval below</span>
        </div>
        <ArrivalChart :arrivals="arrivals" :starts-at="ev.startsAt" />
      </div>
      <div class="card feed">
        <div class="card-head"><h2>Latest scans</h2></div>
        <TransitionGroup name="feed" tag="ul" class="feed-list">
          <li v-for="s in scans" :key="s.id" :class="`r-${s.result}`">
            <span class="dot" aria-hidden="true" />
            <div class="f-main">
              <div class="f-name">{{ s.name ?? 'Unknown code' }}</div>
              <div class="f-sub">{{ scanLabel(s) }}<template v-if="s.device"> · {{ s.device }}</template></div>
            </div>
            <time class="f-time">{{ fmtTime(s.at) }}</time>
          </li>
        </TransitionGroup>
        <p v-if="!scans.length" class="muted small pad">No scans yet — open the scanner on a phone.</p>
      </div>
    </section>

    <section class="card people">
      <div class="people-head">
        <h2>Attendees</h2>
        <div class="tools">
          <div class="seg" role="tablist">
            <button v-for="f in (['all', 'checked_in', 'valid', 'cancelled'] as const)" :key="f" role="tab" :aria-selected="filter === f" :class="{ on: filter === f }" @click="filter = f">
              {{ { all: 'All', checked_in: 'Checked in', valid: 'Not arrived', cancelled: 'Cancelled' }[f] }}
              <span class="cnt">{{ counts[f] }}</span>
            </button>
          </div>
          <input v-model="q" class="input search" type="search" placeholder="Search name or email" />
          <button class="btn ghost small" @click="adding = !adding">＋ Add</button>
        </div>
      </div>
      <form v-if="adding" class="add" @submit.prevent="addAttendee">
        <input v-model="newAtt.name" class="input" placeholder="Name" required />
        <input v-model="newAtt.email" class="input" type="email" placeholder="Email" required />
        <button class="btn small">Issue ticket</button>
      </form>

      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr><th>Attendee</th><th>Status</th><th class="hide-sm">Ticket email</th><th class="right">Actions</th></tr>
          </thead>
          <tbody>
            <tr v-for="t in visible" :key="t.id">
              <td>
                <div class="who">
                  <Avatar :name="t.name" :size="34" />
                  <div>
                    <div class="name">{{ t.name }}</div>
                    <div class="email">{{ t.email }}</div>
                  </div>
                </div>
              </td>
              <td>
                <StatusPill :kind="t.status" />
                <div v-if="t.checkedInAt" class="when">{{ fmtTime(t.checkedInAt) }}<template v-if="t.checkedInBy"> · {{ t.checkedInBy }}</template></div>
              </td>
              <td class="hide-sm">
                <span class="mail" :class="`m-${t.emailStatus}`" :title="t.emailError ?? ''">{{ emailLabel[t.emailStatus] }}</span>
                <a v-if="t.emailStatus === 'preview'" :href="`/api/tickets/${t.id}/email-preview`" target="_blank" class="preview">view</a>
                <div class="when">issued {{ relTime(t.issuedAt) }}</div>
              </td>
              <td class="right">
                <div class="acts">
                  <button v-if="t.status === 'valid'" class="btn small" :disabled="busyRow[t.id]" @click="rowAction(t, 'checkin')">Check in</button>
                  <button v-if="t.status !== 'cancelled'" class="btn ghost small" :disabled="busyRow[t.id]" @click="rowAction(t, 'resend')">Resend</button>
                  <button v-if="t.status !== 'cancelled'" class="btn danger small" :disabled="busyRow[t.id]" @click="rowAction(t, 'cancel')">Cancel</button>
                </div>
              </td>
            </tr>
            <tr v-if="!visible.length"><td colspan="4" class="muted pad">No one matches.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="ev.isDemo" class="demo">
      <span class="muted small">Demo event — want a fresh arrival curve for filming?</span>
      <button class="btn ghost small" @click="resetDemo">↺ Reset demo data</button>
    </div>

    <div class="toasts" aria-live="polite">
      <TransitionGroup name="toast">
        <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
      </TransitionGroup>
    </div>
  </main>
</template>

<style scoped>
.page { padding-top: 28px; padding-bottom: 80px; display: grid; gap: 20px; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
h1 { font-size: clamp(26px, 3.4vw, 36px); margin-top: 6px; }
h2 { font-size: 17px; }
.small { font-size: 13px; }
.pad { padding: 14px 4px; }
.head-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.live-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); margin-right: 4px; vertical-align: 1px; }
.live-dot.on { background: var(--success); box-shadow: 0 0 0 0 rgba(43, 217, 104, 0.6); animation: live 1.8s infinite; }
@keyframes live { 70% { box-shadow: 0 0 0 8px rgba(43, 217, 104, 0); } 100% { box-shadow: 0 0 0 0 rgba(43, 217, 104, 0); } }

.top { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 20px; }
.hero {
  position: relative; overflow: hidden; padding: 28px 30px;
  background: radial-gradient(120% 140% at 100% 0%, #efeaff 0%, #fff 55%);
}
.hero-label { font-weight: 800; color: var(--ink-2); font-size: 15px; }
.hero-num { font-size: clamp(72px, 10vw, 120px); font-weight: 800; letter-spacing: -0.05em; line-height: 1; margin: 6px 0 16px; color: var(--ink); }
.hero-num .of { font-size: 0.34em; color: var(--muted); letter-spacing: -0.02em; font-weight: 700; margin-left: 6px; }
.hero-bar { height: 12px; background: var(--success-soft); border-radius: 999px; overflow: hidden; }
.hero-fill { height: 100%; background: linear-gradient(90deg, #22c55e, var(--success)); border-radius: 999px; transition: width 0.9s var(--spring); }
.hero-sub { margin-top: 10px; color: var(--ink-2); font-weight: 600; font-size: 14px; }
.hero.pulse { animation: heroPulse 0.9s var(--spring); }
.hero.pulse .ring { position: absolute; left: 40px; top: 70px; width: 60px; height: 60px; border-radius: 50%; border: 3px solid var(--success); animation: ring 1s ease-out forwards; pointer-events: none; }
@keyframes heroPulse { 0% { transform: scale(1); } 30% { transform: scale(1.018); box-shadow: 0 0 0 6px rgba(43, 217, 104, 0.18), var(--shadow-lift); } 100% { transform: scale(1); } }
@keyframes ring { from { opacity: 0.9; transform: scale(0.6); } to { opacity: 0; transform: scale(4); } }
.tiles { display: grid; gap: 12px; grid-template-rows: repeat(3, 1fr); }
.tile { padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; transition: transform .3s var(--spring); }
.tile:hover { transform: translateY(-2px); }
.t-label { font-weight: 700; color: var(--ink-2); font-size: 14px; }
.t-val { font-size: 30px; font-weight: 800; letter-spacing: -0.03em; }
.t-of { font-size: 14px; color: var(--muted); font-weight: 700; letter-spacing: 0; }

.mid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.chart-card, .feed { padding: 20px 22px; }
.card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.feed-list { list-style: none; margin: 0; padding: 0; }
.feed-list li { display: flex; align-items: center; gap: 12px; padding: 9px 4px; border-bottom: 1px solid var(--line); }
.feed-list li:last-child { border-bottom: 0; }
.dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.r-success .dot { background: var(--success); }
.r-already_used .dot { background: var(--warn); }
.r-invalid .dot, .r-wrong_event .dot { background: var(--danger); }
.f-main { flex: 1; min-width: 0; }
.f-name { font-weight: 700; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.f-sub { font-size: 12.5px; color: var(--muted); }
.f-time { font-size: 13px; color: var(--ink-2); font-variant-numeric: tabular-nums; font-weight: 600; }
.feed-enter-active { transition: all 0.5s var(--spring); }
.feed-enter-from { opacity: 0; transform: translateY(-10px) scale(0.97); background: var(--accent-soft); }

.people { padding: 20px 22px; }
.people-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.seg { display: flex; background: var(--surface-2); border-radius: 999px; padding: 4px; gap: 2px; }
.seg button { font: inherit; font-size: 13.5px; font-weight: 700; border: 0; background: none; padding: 7px 12px; border-radius: 999px; color: var(--ink-2); cursor: pointer; transition: background .2s, color .2s; }
.seg button.on { background: #fff; color: var(--accent-ink); box-shadow: 0 1px 3px rgba(27,27,47,.1); }
.cnt { font-size: 11.5px; color: var(--muted); margin-left: 3px; font-variant-numeric: tabular-nums; }
.search { width: 220px; padding: 9px 14px; font-size: 14px; border-radius: 999px; }
.add { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.add .input { flex: 1; min-width: 160px; padding: 9px 12px; }
.table-wrap { overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; }
.tbl th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 8px; border-bottom: 1px solid var(--line); }
.tbl td { padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.tbl tr:hover td { background: #fcfbff; }
.who { display: flex; align-items: center; gap: 12px; }
.name { font-weight: 700; }
.email { font-size: 13px; color: var(--muted); }
.when { font-size: 12px; color: var(--muted); margin-top: 3px; font-variant-numeric: tabular-nums; }
.mail { font-size: 13px; font-weight: 700; }
.m-sent { color: var(--success-ink); } .m-failed { color: var(--danger-ink); } .m-retrying { color: var(--warn-ink); }
.m-preview, .m-pending { color: var(--accent-ink); } .m-skipped { color: var(--muted); }
.preview { font-size: 12.5px; margin-left: 6px; font-weight: 700; }
.right { text-align: right; }
.acts { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.demo { display: flex; gap: 12px; align-items: center; justify-content: center; padding: 6px; }
.toasts { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); display: grid; gap: 8px; z-index: 50; }
.toast { background: var(--ink); color: #fff; padding: 11px 18px; border-radius: 999px; font-weight: 700; font-size: 14px; box-shadow: var(--shadow-lift); }
.toast.ok { background: #13823f; } .toast.warn { background: #8a5a00; } .toast.bad { background: #b0163c; }
.toast-enter-active, .toast-leave-active { transition: all .35s var(--spring); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(12px) scale(.95); }
@media (max-width: 960px) { .top, .mid { grid-template-columns: 1fr; } .tiles { grid-template-columns: repeat(3, 1fr); grid-template-rows: none; } .tile { flex-direction: column; align-items: flex-start; } }
@media (max-width: 640px) { .hide-sm { display: none; } .tiles { grid-template-columns: 1fr; } .tile { flex-direction: row; align-items: center; } .search { width: 100%; } .tools { width: 100%; } }
</style>
