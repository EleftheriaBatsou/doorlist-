<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import { api, ApiError } from '../lib/api';
import type { EventSummary } from '../lib/types';

const route = useRoute();
const router = useRouter();
const id = computed(() => route.params.id as string | undefined);
const isNew = computed(() => !id.value);

const form = reactive({ title: '', slug: '', description: '', startsAt: '', venue: '', capacity: 100, published: false });
const coverUrl = ref<string | null>(null);
const coverFile = ref<File | null>(null);
const coverPreview = ref<string | null>(null);
const error = ref('');
const busy = ref(false);
const loaded = ref(false);

// <input type="datetime-local"> wants local time without zone.
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
};

onMounted(async () => {
  if (id.value) {
    const e = await api.get<EventSummary>(`/api/events/${id.value}`);
    Object.assign(form, {
      title: e.title, slug: e.slug, description: e.description, startsAt: toLocalInput(e.startsAt),
      venue: e.venue, capacity: e.capacity, published: e.published,
    });
    coverUrl.value = e.coverUrl;
    document.title = `Edit · ${e.title}`;
  } else {
    const d = new Date(Date.now() + 14 * 86_400_000);
    d.setHours(19, 0, 0, 0);
    form.startsAt = toLocalInput(d.toISOString());
    document.title = 'New event · Doorlist';
  }
  loaded.value = true;
});

function pickCover(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  coverFile.value = f;
  coverPreview.value = URL.createObjectURL(f);
}

async function save() {
  busy.value = true;
  error.value = '';
  try {
    const body = {
      title: form.title,
      slug: form.slug || undefined,
      description: form.description,
      startsAt: new Date(form.startsAt).toISOString(),
      venue: form.venue,
      capacity: Number(form.capacity),
      published: form.published,
    };
    const saved = isNew.value
      ? await api.post<EventSummary>('/api/events', body)
      : await api.put<EventSummary>(`/api/events/${id.value}`, body);
    if (coverFile.value) {
      const fd = new FormData();
      fd.append('file', coverFile.value);
      await api.upload(`/api/events/${saved.id}/cover`, fd);
    }
    router.push(`/admin/events/${saved.id}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Couldn’t save — check your connection';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppHeader admin />
  <main v-if="loaded" class="container page">
    <RouterLink :to="isNew ? '/admin' : `/admin/events/${id}`" class="back">← Back</RouterLink>
    <h1>{{ isNew ? 'Create an event' : 'Edit event' }}</h1>

    <form class="layout" @submit.prevent="save">
      <div class="card panel">
        <div class="field">
          <label for="title">Title</label>
          <input id="title" v-model="form.title" class="input" required placeholder="Neon Nights — Autumn Launch Party" />
        </div>
        <div class="row2">
          <div class="field">
            <label for="starts">Starts</label>
            <input id="starts" v-model="form.startsAt" class="input" type="datetime-local" required />
          </div>
          <div class="field">
            <label for="cap">Capacity</label>
            <input id="cap" v-model.number="form.capacity" class="input" type="number" min="1" max="100000" required />
          </div>
        </div>
        <div class="field">
          <label for="venue">Venue</label>
          <input id="venue" v-model="form.venue" class="input" placeholder="Kasárna Karlín, Prague" />
        </div>
        <div class="field">
          <label for="desc">Description</label>
          <textarea id="desc" v-model="form.description" class="input" rows="7" placeholder="What should people expect? Blank lines make paragraphs." />
        </div>
        <div class="field">
          <label for="slug">Public URL</label>
          <div class="slug">
            <span class="muted">/e/</span>
            <input id="slug" v-model="form.slug" class="input" placeholder="auto from title" pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?" />
          </div>
        </div>
      </div>

      <div class="side">
        <div class="card panel">
          <label class="label">Cover image</label>
          <label class="cover" :style="coverPreview || coverUrl ? { backgroundImage: `url(${coverPreview ?? coverUrl})` } : undefined">
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" @change="pickCover" />
            <span class="cover-cta">{{ coverPreview || coverUrl ? 'Change image' : 'Upload image' }}</span>
          </label>
          <p class="muted hint">Wide images look best (2:1). Stored in object storage.</p>
        </div>
        <div class="card panel">
          <label class="toggle">
            <input v-model="form.published" type="checkbox" />
            <span class="switch" aria-hidden="true" />
            <span>
              <strong>Published</strong><br />
              <span class="muted hint">Public RSVP page is live at /e/{{ form.slug || '…' }}</span>
            </span>
          </label>
        </div>
        <p v-if="error" class="error-text">{{ error }}</p>
        <button class="btn save" :disabled="busy">{{ busy ? 'Saving…' : isNew ? 'Create event' : 'Save changes' }}</button>
      </div>
    </form>
  </main>
</template>

<style scoped>
.page { padding-top: 24px; padding-bottom: 80px; }
.back { font-weight: 700; font-size: 14px; }
h1 { font-size: 32px; margin: 8px 0 24px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; align-items: start; }
.panel { padding: 22px; display: grid; gap: 18px; }
.side { display: grid; gap: 16px; }
.row2 { display: grid; grid-template-columns: 1fr 160px; gap: 14px; }
.slug { display: flex; align-items: center; gap: 6px; }
.label { font-weight: 700; font-size: 13px; color: var(--ink-2); }
.cover {
  position: relative; display: grid; place-items: center; height: 160px; border-radius: 12px; cursor: pointer;
  background: var(--surface-2) linear-gradient(135deg, #efeaff, #ffe6f0); background-size: cover; background-position: center;
  border: 2px dashed var(--line-strong); overflow: hidden; transition: transform .3s var(--spring);
}
.cover:hover { transform: scale(1.02); }
.cover input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.cover-cta { background: rgba(255,255,255,.92); padding: 8px 14px; border-radius: 999px; font-weight: 700; font-size: 14px; box-shadow: var(--shadow); }
.hint { font-size: 13px; margin: 0; }
.toggle { display: flex; gap: 14px; align-items: flex-start; cursor: pointer; }
.toggle input { position: absolute; opacity: 0; }
.switch { flex: none; width: 46px; height: 28px; border-radius: 999px; background: #dcd9e6; position: relative; transition: background .2s; margin-top: 2px; }
.switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.2); transition: transform .3s var(--spring); }
.toggle input:checked + .switch { background: var(--success); }
.toggle input:checked + .switch::after { transform: translateX(18px); }
.toggle input:focus-visible + .switch { outline: 3px solid rgba(124,92,255,.5); outline-offset: 2px; }
.save { width: 100%; padding: 14px; }
@media (max-width: 820px) { .layout { grid-template-columns: 1fr; } .row2 { grid-template-columns: 1fr 1fr; } }
</style>
