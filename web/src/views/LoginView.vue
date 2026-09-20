<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import { api, ApiError } from '../lib/api';
import { setUser, type User } from '../lib/auth';

const route = useRoute();
const router = useRouter();
const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    const res = await api.post<{ user: User }>('/api/auth/login', { email: email.value, password: password.value });
    setUser(res.user);
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
      <p class="muted">Sign in to manage your events and scan tickets at the door.</p>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" v-model="email" class="input" type="email" autocomplete="email" autofocus required />
      </div>
      <div class="field">
        <label for="pw">Password</label>
        <input id="pw" v-model="password" class="input" type="password" autocomplete="current-password" required />
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <button class="btn" :disabled="busy || !email || !password">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
      <p class="alt muted">
        New here?
        <RouterLink :to="{ path: '/register', query: route.query }">Create an account</RouterLink>
      </p>
    </form>
  </main>
</template>

<style scoped>
.wrap { display: grid; place-items: center; padding: 64px 16px; }
.box { width: 100%; max-width: 400px; padding: 32px; display: grid; gap: 16px; }
h1 { font-size: 28px; }
p { margin: 0; }
.alt { font-size: 14px; text-align: center; }
</style>
