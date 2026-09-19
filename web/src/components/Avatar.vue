<script setup lang="ts">
import { computed } from 'vue';
import { avatarColor, initials } from '../lib/format';
const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 36 });
const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.round(props.size * 0.38)}px`,
  background: avatarColor(props.name),
}));
</script>

<template>
  <span class="avatar" :style="style" aria-hidden="true">{{ initials(name) }}</span>
</template>

<style scoped>
.avatar {
  display: inline-grid;
  place-items: center;
  flex: none;
  border-radius: 50%;
  color: #fff;
  font-weight: 800;
  letter-spacing: 0.02em;
}
</style>
