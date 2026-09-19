<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import { api, ApiError } from '../lib/api';
import { setAuthed } from '../lib/auth';

const route = useRoute();
const router = useRouter();
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    await api.post('/api/auth/login', { password: password.value });
    setAuthed(true);
    router.replace(typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/admin');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Can’t reach the server';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="wrap">
    <form class="card box" @submit.prevent="submit">
      <div class="eyebrow">Organiser</div>
      <h1>Welcome back</h1>
      <p class="muted">Enter the organiser passcode to manage events and scan tickets.</p>
      <div class="field">
        <label for="pw">Passcode</label>
        <input id="pw" v-model="password" class="input" type="password" autocomplete="current-password" autofocus required />
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <button class="btn" :disabled="busy || !password">{{ busy ? 'Checking…' : 'Sign in' }}</button>
    </form>
  </main>
</template>

<style scoped>
.wrap { display: grid; place-items: center; padding: 64px 16px; }
.box { width: 100%; max-width: 400px; padding: 32px; display: grid; gap: 16px; }
h1 { font-size: 28px; }
p { margin: 0; }
</style>
