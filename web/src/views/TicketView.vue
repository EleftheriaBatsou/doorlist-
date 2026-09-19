<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import StatusPill from '../components/StatusPill.vue';
import { api } from '../lib/api';
import { fmtDateLong, fmtTime } from '../lib/format';

interface PublicTicket {
  attendeeName: string;
  status: 'valid' | 'checked_in' | 'cancelled';
  checkedInAt: string | null;
  qrReady: boolean;
  emailStatus: string;
  event: { slug: string; title: string; startsAt: string; venue: string; coverUrl: string | null };
}

const route = useRoute();
const code = String(route.params.code);
const t = ref<PublicTicket | null>(null);
const notFound = ref(false);
const isNew = route.query.new === '1';
const again = route.query.again === '1';
let poll: ReturnType<typeof setTimeout> | undefined;

async function load() {
  try {
    t.value = await api.get<PublicTicket>(`/api/public/tickets/${code}`);
    document.title = `Ticket · ${t.value.event.title}`;
    // The worker renders the QR asynchronously (usually < 1s) — poll until it lands.
    if (!t.value.qrReady) poll = setTimeout(load, 800);
  } catch {
    notFound.value = true;
  }
}
onMounted(load);
onBeforeUnmount(() => clearTimeout(poll));

const emailLine = computed(() => {
  switch (t.value?.emailStatus) {
    case 'sent':
      return 'We’ve emailed this ticket to you, with a calendar invite.';
    case 'preview':
      return 'Your ticket email is ready (email sending isn’t configured on this server yet).';
    case 'retrying':
      return 'Our email is having a moment — we’ll keep retrying. This page is your ticket either way.';
    case 'failed':
      return 'We couldn’t email this ticket. No problem — this page is your ticket.';
    default:
      return 'Your ticket email is on its way.';
  }
});
</script>

<template>
  <AppHeader />
  <main class="wrap">
    <div v-if="isNew" class="confetti" aria-hidden="true">
      <i v-for="n in 28" :key="n" :style="{ '--i': n }" />
    </div>

    <div v-if="t" class="stack">
      <div class="headline">
        <h1 v-if="isNew">You’re in, {{ t.attendeeName.split(' ')[0] }}! 🎉</h1>
        <h1 v-else-if="again">You already have a ticket</h1>
        <h1 v-else>Your ticket</h1>
        <p class="muted">{{ emailLine }}</p>
      </div>

      <article class="ticket card">
        <div class="top" :style="t.event.coverUrl ? { backgroundImage: `url(${t.event.coverUrl})` } : undefined">
          <div class="top-inner">
            <div class="eyebrow light">Admit one</div>
            <h2>{{ t.event.title }}</h2>
          </div>
        </div>
        <div class="details">
          <div>
            <div class="label">Name</div>
            <div class="val">{{ t.attendeeName }}</div>
          </div>
          <div>
            <div class="label">When</div>
            <div class="val">{{ fmtDateLong(t.event.startsAt) }}</div>
          </div>
          <div>
            <div class="label">Where</div>
            <div class="val">{{ t.event.venue }}</div>
          </div>
        </div>
        <div class="perf" aria-hidden="true"><span /><span /></div>
        <div class="qr-area">
          <div v-if="t.status === 'cancelled'" class="qr-msg bad">This ticket was cancelled.</div>
          <template v-else>
            <img v-if="t.qrReady" :src="`/api/public/tickets/${code}/qr.png`" alt="Ticket QR code" class="qr" width="260" height="260" />
            <div v-else class="qr skeleton"><span>Generating your QR…</span></div>
            <div class="status-line">
              <StatusPill v-if="t.status === 'checked_in'" kind="checked_in" :label="`Checked in ${t.checkedInAt ? 'at ' + fmtTime(t.checkedInAt) : ''}`" />
              <span v-else class="muted small">Show this at the door. Turn your brightness up ☀️</span>
            </div>
          </template>
        </div>
      </article>

      <div class="actions">
        <a class="btn" :href="`/api/public/tickets/${code}/event.ics`">🗓️ Add to calendar</a>
        <RouterLink class="btn ghost" :to="`/e/${t.event.slug}`">Event details</RouterLink>
      </div>
    </div>

    <div v-else-if="notFound" class="stack center">
      <h1>Ticket not found</h1>
      <p class="muted">Double-check the link from your email.</p>
    </div>
  </main>
</template>

<style scoped>
.wrap {
  padding: 36px 16px 80px;
  display: grid;
  justify-items: center;
  position: relative;
  overflow: hidden;
}
.stack {
  width: 100%;
  max-width: 420px;
  display: grid;
  gap: 20px;
}
.center {
  text-align: center;
}
.headline {
  text-align: center;
}
.headline h1 {
  font-size: 30px;
}
.headline p {
  margin: 8px 0 0;
}
.ticket {
  overflow: hidden;
  box-shadow: var(--shadow-lift);
  animation: pop 0.6s var(--spring) both;
}
@keyframes pop {
  from {
    transform: translateY(16px) scale(0.96);
    opacity: 0;
  }
}
.top {
  background: linear-gradient(135deg, #2a1b6b, #7c5cff 55%, #ff5c9a);
  background-size: cover;
  background-position: center;
  color: #fff;
}
.top-inner {
  padding: 34px 22px 18px;
  background: linear-gradient(to bottom, rgba(27, 27, 47, 0) 0%, rgba(27, 27, 47, 0.65) 100%);
}
.top h2 {
  font-size: 24px;
  margin-top: 4px;
}
.eyebrow.light {
  color: rgba(255, 255, 255, 0.85);
}
.details {
  padding: 18px 22px 8px;
  display: grid;
  gap: 12px;
}
.label {
  font-size: 11.5px;
  font-weight: 800;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.val {
  font-weight: 700;
}
.perf {
  position: relative;
  height: 24px;
  margin: 6px 0;
  border-top: 2px dashed var(--line-strong);
  top: 12px;
}
.perf span {
  position: absolute;
  top: -13px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bg);
}
.perf span:first-child {
  left: -12px;
}
.perf span:last-child {
  right: -12px;
}
.qr-area {
  padding: 4px 22px 24px;
  display: grid;
  justify-items: center;
  gap: 12px;
}
.qr {
  width: 260px;
  height: 260px;
  border-radius: 14px;
  image-rendering: pixelated;
}
.skeleton {
  display: grid;
  place-items: center;
  background: linear-gradient(90deg, var(--surface-2), #fff, var(--surface-2));
  background-size: 200% 100%;
  animation: shimmer 1.2s linear infinite;
  color: var(--muted);
  font-weight: 600;
  font-size: 14px;
}
@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}
.qr-msg.bad {
  padding: 40px 0;
  color: var(--danger-ink);
  font-weight: 700;
}
.small {
  font-size: 14px;
}
.actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}
.confetti {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.confetti i {
  position: absolute;
  top: -20px;
  left: calc(var(--i) * 3.5% - 2%);
  width: 9px;
  height: 14px;
  border-radius: 2px;
  background: var(--accent);
  animation: fall 2.6s cubic-bezier(0.2, 0.6, 0.4, 1) forwards;
  animation-delay: calc(var(--i) * 35ms);
  opacity: 0;
}
.confetti i:nth-child(4n + 1) { background: var(--pink); }
.confetti i:nth-child(4n + 2) { background: var(--warn); }
.confetti i:nth-child(4n + 3) { background: var(--success); }
@keyframes fall {
  0% { opacity: 1; transform: translateY(0) rotate(0); }
  100% { opacity: 0; transform: translateY(620px) rotate(calc(var(--i) * 57deg)); }
}
</style>
