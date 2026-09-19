<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppHeader from '../components/AppHeader.vue';
import { api } from '../lib/api';
import { fmtDateLong } from '../lib/format';
import type { EventSummary } from '../lib/types';

const events = ref<EventSummary[] | null>(null);
onMounted(async () => {
  document.title = 'Doorlist';
  events.value = await api.get<EventSummary[]>('/api/public/events');
});
</script>

<template>
  <AppHeader />
  <main>
    <section class="hero container">
      <div class="eyebrow">Self-hosted tickets</div>
      <h1>RSVP in seconds.<br /><span class="grad">Scan in a blink.</span></h1>
      <p class="lede">Doorlist issues QR tickets, emails them with a calendar invite, and turns any phone into a door scanner — with a live arrivals dashboard for the organiser.</p>
    </section>

    <section class="container">
      <h2 class="section-title">Upcoming events</h2>
      <div class="grid">
        <RouterLink v-for="e in events ?? []" :key="e.id" :to="`/e/${e.slug}`" class="ev card hoverable">
          <div class="cover" :style="e.coverUrl ? { backgroundImage: `url(${e.coverUrl})` } : undefined" />
          <div class="body">
            <div class="when">{{ fmtDateLong(e.startsAt) }}</div>
            <h3>{{ e.title }}</h3>
            <div class="muted venue">{{ e.venue }}</div>
          </div>
        </RouterLink>
        <div v-if="events && !events.length" class="empty card">No published events yet.</div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.hero {
  padding: 64px 20px 40px;
  max-width: 860px;
  margin-left: max(0px, calc((100% - 1160px) / 2));
}
h1 {
  font-size: clamp(38px, 6vw, 64px);
  letter-spacing: -0.045em;
  margin-top: 10px;
}
.grad {
  background: linear-gradient(90deg, var(--accent), var(--pink));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.lede {
  font-size: 19px;
  color: var(--ink-2);
  max-width: 620px;
  line-height: 1.6;
}
.section-title {
  font-size: 20px;
  margin: 12px 0 16px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 20px;
  padding-bottom: 80px;
}
.ev {
  overflow: hidden;
  color: var(--ink);
  text-decoration: none !important;
}
.cover {
  height: 150px;
  background: linear-gradient(135deg, #2a1b6b, #7c5cff 55%, #ff5c9a);
  background-size: cover;
  background-position: center;
}
.body {
  padding: 16px 18px 20px;
}
.when {
  font-size: 13px;
  font-weight: 700;
  color: var(--pink);
}
h3 {
  font-size: 19px;
  margin: 4px 0;
}
.venue {
  font-size: 14px;
}
.empty {
  padding: 32px;
  text-align: center;
  color: var(--muted);
}
</style>
