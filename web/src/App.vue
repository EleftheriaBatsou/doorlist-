<script setup lang="ts">
import { onMounted } from 'vue';
import { loadUser } from './lib/auth';

// Know who's signed in on public pages too (the header adapts); never blocks rendering.
onMounted(() => void loadUser().catch(() => {}));
</script>

<template>
  <RouterView />
</template>
