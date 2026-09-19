<script setup lang="ts">
import AppHeader from '../components/AppHeader.vue';
</script>

<template>
  <AppHeader />
  <main class="container nf">
    <div class="big">404</div>
    <h1>Nothing at this door.</h1>
    <p class="muted">The page you’re looking for doesn’t exist.</p>
    <RouterLink to="/" class="btn">Back home</RouterLink>
  </main>
</template>

<style scoped>
.nf { text-align: center; padding: 96px 20px; display: grid; justify-items: center; gap: 12px; }
.big { font-size: 96px; font-weight: 800; color: var(--accent); letter-spacing: -0.04em; line-height: 1; }
</style>
