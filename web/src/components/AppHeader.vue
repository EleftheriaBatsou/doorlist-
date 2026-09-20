<script setup lang="ts">
import { useRouter } from 'vue-router';
import { api } from '../lib/api';
import { currentUser, setUser } from '../lib/auth';

defineProps<{ admin?: boolean }>();
const router = useRouter();

async function logout() {
  await api.post('/api/auth/logout');
  setUser(null);
  router.push('/');
}
</script>

<template>
  <header class="hdr">
    <div class="container row">
      <RouterLink :to="admin ? '/admin' : '/'" class="brand">
        <span class="logo" aria-hidden="true">
          <svg viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#7C5CFF" /><path d="M18 33l9 9 19-20" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </span>
        Doorlist
      </RouterLink>
      <nav class="nav">
        <slot />
        <template v-if="admin">
          <RouterLink to="/admin" class="navlink">Events</RouterLink>
          <span v-if="currentUser" class="who" :title="currentUser.email">{{ currentUser.name }}</span>
          <button class="navlink" @click="logout">Sign out</button>
        </template>
        <template v-else-if="currentUser">
          <RouterLink to="/admin" class="navlink">My events</RouterLink>
        </template>
        <template v-else>
          <RouterLink to="/login" class="navlink">Sign in</RouterLink>
          <RouterLink to="/register" class="navlink primary">Create account</RouterLink>
        </template>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.hdr {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(251, 250, 255, 0.82);
  backdrop-filter: saturate(1.4) blur(12px);
  border-bottom: 1px solid var(--line);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 800;
  font-size: 19px;
  color: var(--ink);
  letter-spacing: -0.02em;
  text-decoration: none !important;
}
.logo svg {
  width: 30px;
  height: 30px;
  display: block;
  transition: transform 0.4s var(--spring);
}
.brand:hover .logo svg {
  transform: rotate(-8deg) scale(1.08);
}
.nav {
  display: flex;
  align-items: center;
  gap: 4px;
}
.navlink {
  font: inherit;
  font-weight: 650;
  font-size: 14.5px;
  color: var(--ink-2);
  background: none;
  border: 0;
  padding: 8px 12px;
  border-radius: 999px;
  cursor: pointer;
  text-decoration: none !important;
}
.navlink.primary {
  background: var(--accent);
  color: #fff;
}
.navlink.primary:hover {
  background: var(--accent-ink);
  color: #fff;
}
.who {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--accent-ink);
  background: var(--accent-soft);
  padding: 6px 12px;
  border-radius: 999px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.navlink:hover,
.navlink.router-link-exact-active {
  background: var(--accent-soft);
  color: var(--accent-ink);
}
</style>
