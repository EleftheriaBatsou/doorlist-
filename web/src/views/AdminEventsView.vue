<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppHeader from '../components/AppHeader.vue';
import { api } from '../lib/api';
import { fmtDateShort } from '../lib/format';
import type { EventSummary } from '../lib/types';

const events = ref<EventSummary[] | null>(null);
onMounted(async () => {
  document.title = 'Events · Doorlist';
  events.value = await api.get<EventSummary[]>('/api/events');
});
const pct = (e: EventSummary) => (e.stats && e.stats.issued ? Math.round((e.stats.checkedIn / e.stats.issued) * 100) : 0);
</script>

<template>
  <AppHeader admin />
  <main class="container page">
    <div class="head">
      <div>
        <div class="eyebrow">Organiser</div>
        <h1>Your events</h1>
      </div>
      <RouterLink to="/admin/events/new" class="btn">＋ New event</RouterLink>
    </div>

    <div class="grid">
      <RouterLink v-for="e in events ?? []" :key="e.id" :to="`/admin/events/${e.id}`" class="ev card hoverable">
        <div class="cover" :style="e.coverUrl ? { backgroundImage: `url(${e.coverUrl})` } : undefined">
          <span class="badge" :class="e.published ? 'live' : 'draft'">{{ e.published ? 'Published' : 'Draft' }}</span>
        </div>
        <div class="body">
          <div class="when">{{ fmtDateShort(e.startsAt) }}</div>
          <h3>{{ e.title }}</h3>
          <div v-if="e.stats" class="mini">
            <div class="bar"><div class="fill" :style="{ width: `${pct(e)}%` }" /></div>
            <div class="nums">
              <span><strong>{{ e.stats.checkedIn }}</strong> / {{ e.stats.issued }} arrived</span>
              <span class="muted">{{ e.stats.issued }} of {{ e.capacity }} tickets issued</span>
            </div>
          </div>
        </div>
      </RouterLink>
    </div>
    <div v-if="events && !events.length" class="empty card">
      <h3>No events yet</h3>
      <p class="muted">Create your first event to start taking RSVPs.</p>
      <RouterLink to="/admin/events/new" class="btn">Create an event</RouterLink>
    </div>
  </main>
</template>

<style scoped>
.page { padding-top: 32px; padding-bottom: 80px; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 24px; }
h1 { font-size: 34px; margin-top: 4px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
.ev { overflow: hidden; color: var(--ink); text-decoration: none !important; }
.cover { height: 130px; position: relative; background: linear-gradient(135deg, #2a1b6b, #7c5cff 55%, #ff5c9a); background-size: cover; background-position: center; }
.badge { position: absolute; top: 12px; left: 12px; font-size: 12px; font-weight: 800; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,.92); }
.badge.live { color: var(--success-ink); }
.badge.draft { color: var(--muted); }
.body { padding: 16px 18px 18px; }
.when { font-size: 13px; font-weight: 700; color: var(--pink); }
h3 { font-size: 18px; margin: 4px 0 12px; }
.bar { height: 8px; border-radius: 999px; background: var(--success-soft); overflow: hidden; }
.fill { height: 100%; background: var(--success); border-radius: 999px; }
.nums { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 13px; margin-top: 8px; }
.empty { padding: 40px; text-align: center; display: grid; gap: 10px; justify-items: center; }
.empty p { margin: 0; }
</style>
