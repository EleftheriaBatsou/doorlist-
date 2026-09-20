<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import { api, ApiError } from '../lib/api';
import { setUser, type User } from '../lib/auth';

const route = useRoute();
const router = useRouter();
const name = ref('');
const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    const res = await api.post<{ user: User }>(
      '/api/auth/register',
      { name: name.value, email: email.value, password: password.value },
      { timeoutMs: 30_000 }, // first login also seeds a demo event
    );
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
      <h1>Create your account</h1>
      <p class="muted">Run your own events: take RSVPs, email QR tickets and scan people in at the door.</p>
      <div class="field">
        <label for="name">Your name</label>
        <input id="name" v-model="name" class="input" autocomplete="name" placeholder="Anna Kowalski" autofocus required minlength="2" />
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" v-model="email" class="input" type="email" autocomplete="email" required />
      </div>
      <div class="field">
        <label for="pw">Password</label>
        <input id="pw" v-model="password" class="input" type="password" autocomplete="new-password" required minlength="8" />
        <span class="hint muted">At least 8 characters.</span>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <button class="btn" :disabled="busy">{{ busy ? 'Setting things up…' : 'Create account' }}</button>
      <p class="alt muted">
        Already have one?
        <RouterLink :to="{ path: '/login', query: route.query }">Sign in</RouterLink>
      </p>
    </form>
  </main>
</template>

<style scoped>
.wrap { display: grid; place-items: center; padding: 56px 16px; }
.box { width: 100%; max-width: 420px; padding: 32px; display: grid; gap: 16px; }
h1 { font-size: 28px; }
p { margin: 0; }
.hint { font-size: 12.5px; }
.alt { font-size: 14px; text-align: center; }
</style>
