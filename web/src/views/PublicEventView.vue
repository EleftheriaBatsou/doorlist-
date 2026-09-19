<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import { api, ApiError } from '../lib/api';
import type { EventSummary } from '../lib/types';

const route = useRoute();
const router = useRouter();
const ev = ref<EventSummary | null>(null);
const notFound = ref(false);
const name = ref('');
const email = ref('');
const error = ref('');
const busy = ref(false);

onMounted(async () => {
  try {
    ev.value = await api.get<EventSummary>(`/api/public/events/${route.params.slug}`);
    document.title = `${ev.value.title} · Doorlist`;
  } catch {
    notFound.value = true;
  }
});

const date = computed(() => (ev.value ? new Date(ev.value.startsAt) : null));
const dayNum = computed(() => date.value?.toLocaleDateString([], { day: 'numeric' }));
const monthShort = computed(() => date.value?.toLocaleDateString([], { month: 'short' }).toUpperCase());
const longDate = computed(() => date.value?.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
const time = computed(() => date.value?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
const soldOut = computed(() => ev.value?.remaining === 0);
const filledPct = computed(() =>
  ev.value && ev.value.remaining !== undefined ? Math.round(((ev.value.capacity - ev.value.remaining) / ev.value.capacity) * 100) : 0,
);
const paragraphs = computed(() => (ev.value?.description ?? '').split(/\n{2,}/).filter(Boolean));
const mapsUrl = computed(() => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.value?.venue ?? '')}`);

async function rsvp() {
  busy.value = true;
  error.value = '';
  try {
    const res = await api.post<{ ticketCode: string; existing: boolean }>(`/api/public/events/${route.params.slug}/rsvp`, {
      name: name.value,
      email: email.value,
    });
    router.push({ path: `/t/${res.ticketCode}`, query: res.existing ? { again: '1' } : { new: '1' } });
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'We couldn’t reach the server. Check your connection and try again.';
    if (e instanceof ApiError && e.body?.code === 'sold_out' && ev.value) ev.value.remaining = 0;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main v-if="ev" class="page">
    <section class="hero">
      <div class="cover" :style="ev.coverUrl ? { backgroundImage: `url(${ev.coverUrl})` } : undefined" />
      <div class="hero-fade" />
    </section>

    <div class="container layout">
      <article class="main">
        <div class="title-row">
          <div class="datebadge card" aria-hidden="true">
            <span class="m">{{ monthShort }}</span>
            <span class="d">{{ dayNum }}</span>
          </div>
          <div>
            <div class="eyebrow">You’re invited</div>
            <h1>{{ ev.title }}</h1>
          </div>
        </div>

        <div class="facts">
          <div class="fact card">
            <span class="ico" aria-hidden="true">🗓️</span>
            <div>
              <div class="label">When</div>
              <div class="val">{{ longDate }}</div>
              <div class="sub">Starts {{ time }}</div>
            </div>
          </div>
          <a class="fact card hoverable" :href="mapsUrl" target="_blank" rel="noopener">
            <span class="ico" aria-hidden="true">📍</span>
            <div>
              <div class="label">Where</div>
              <div class="val">{{ ev.venue || 'Venue to be announced' }}</div>
              <div class="sub">Open in Maps ↗</div>
            </div>
          </a>
        </div>

        <div class="about">
          <h2>About this event</h2>
          <p v-for="(p, i) in paragraphs" :key="i">{{ p }}</p>
        </div>
      </article>

      <aside class="side">
        <form class="rsvp card" @submit.prevent="rsvp">
          <div class="rsvp-head">
            <h2>{{ soldOut ? 'Sold out' : 'Grab your spot' }}</h2>
            <span class="free">Free</span>
          </div>
          <div v-if="ev.remaining !== undefined" class="meter-wrap">
            <div class="meter" role="meter" :aria-valuenow="filledPct" aria-valuemin="0" aria-valuemax="100" aria-label="Spots taken">
              <div class="meter-fill" :style="{ width: `${filledPct}%` }" />
            </div>
            <div class="meter-text">
              <strong>{{ ev.remaining }}</strong> of {{ ev.capacity }} spots left
            </div>
          </div>
          <template v-if="!soldOut">
            <div class="field">
              <label for="n">Your name</label>
              <input id="n" v-model="name" class="input" autocomplete="name" placeholder="Anna Kowalski" required minlength="2" />
            </div>
            <div class="field">
              <label for="e">Email</label>
              <input id="e" v-model="email" class="input" type="email" autocomplete="email" inputmode="email" placeholder="anna@example.com" required />
            </div>
            <p v-if="error" class="error-text">{{ error }}</p>
            <button class="btn big" :disabled="busy">{{ busy ? 'Reserving…' : 'RSVP — get my ticket' }}</button>
            <p class="fine">We’ll email your QR ticket and a calendar invite. One ticket per email.</p>
          </template>
          <p v-else class="muted">Every spot has been claimed. Check back in case someone cancels.</p>
        </form>
      </aside>
    </div>
  </main>

  <main v-else-if="notFound" class="container nf">
    <h1>We couldn’t find that event</h1>
    <p class="muted">It may have been unpublished, or the link is mistyped.</p>
    <RouterLink to="/" class="btn">See upcoming events</RouterLink>
  </main>

  <main v-else class="container loading"><div class="spinner" /></main>
</template>

<style scoped>
.page {
  padding-bottom: 80px;
}
.hero {
  position: relative;
  height: clamp(220px, 42vw, 420px);
  overflow: hidden;
}
.cover {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #2a1b6b, #7c5cff 55%, #ff5c9a);
  background-size: cover;
  background-position: center;
  transform: scale(1.02);
}
.hero-fade {
  position: absolute;
  inset: auto 0 0 0;
  height: 45%;
  background: linear-gradient(to bottom, rgba(251, 250, 255, 0), var(--bg));
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 40px;
  margin-top: -72px;
  position: relative;
}
.title-row {
  display: flex;
  gap: 18px;
  align-items: flex-end;
}
.datebadge {
  flex: none;
  width: 76px;
  height: 84px;
  display: grid;
  place-content: center;
  text-align: center;
  line-height: 1;
}
.datebadge .m {
  font-size: 13px;
  font-weight: 800;
  color: var(--pink);
  letter-spacing: 0.08em;
}
.datebadge .d {
  font-size: 34px;
  font-weight: 800;
  margin-top: 4px;
}
h1 {
  font-size: clamp(30px, 4.6vw, 48px);
  letter-spacing: -0.035em;
  margin-top: 4px;
}
.facts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 28px;
}
.fact {
  display: flex;
  gap: 14px;
  padding: 18px;
  color: var(--ink);
  text-decoration: none !important;
}
.fact .ico {
  font-size: 22px;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  border-radius: 12px;
  flex: none;
}
.label {
  font-size: 12px;
  font-weight: 800;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.val {
  font-weight: 700;
}
.sub {
  font-size: 14px;
  color: var(--accent-ink);
  font-weight: 600;
}
.about {
  margin-top: 36px;
}
.about h2 {
  font-size: 22px;
  margin-bottom: 10px;
}
.about p {
  font-size: 17px;
  line-height: 1.7;
  color: var(--ink-2);
  margin: 0 0 14px;
  white-space: pre-line;
}
.side {
  position: relative;
}
.rsvp {
  position: sticky;
  top: 84px;
  padding: 26px;
  display: grid;
  gap: 16px;
  box-shadow: var(--shadow-lift);
}
.rsvp-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.rsvp h2 {
  font-size: 22px;
}
.free {
  background: var(--success-soft);
  color: var(--success-ink);
  font-weight: 800;
  font-size: 13px;
  padding: 4px 10px;
  border-radius: 999px;
}
.meter {
  height: 8px;
  background: var(--accent-soft);
  border-radius: 999px;
  overflow: hidden;
}
.meter-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--pink));
  border-radius: 999px;
  transition: width 0.8s var(--spring);
}
.meter-text {
  font-size: 14px;
  color: var(--ink-2);
  margin-top: 8px;
}
.btn.big {
  width: 100%;
  padding: 15px 20px;
  font-size: 16px;
}
.fine {
  font-size: 13px;
  color: var(--muted);
  margin: 0;
  text-align: center;
}
.nf {
  text-align: center;
  padding: 96px 20px;
  display: grid;
  gap: 12px;
  justify-items: center;
}
.loading {
  display: grid;
  place-items: center;
  padding: 120px;
}
.spinner {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 4px solid var(--accent-soft);
  border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 880px) {
  .layout {
    grid-template-columns: 1fr;
    gap: 28px;
    margin-top: -48px;
  }
  .rsvp {
    position: static;
  }
  .side {
    order: -1;
    display: none;
  }
  .main {
    display: contents;
  }
}
@media (max-width: 880px) {
  .side {
    display: block;
    order: 2;
  }
  .title-row {
    order: 1;
  }
  .facts {
    order: 3;
  }
  .about {
    order: 4;
    margin-top: 8px;
  }
}
@media (max-width: 560px) {
  .facts {
    grid-template-columns: 1fr;
  }
  .datebadge {
    width: 62px;
    height: 70px;
  }
  .datebadge .d {
    font-size: 28px;
  }
}
</style>
