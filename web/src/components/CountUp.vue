<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(defineProps<{ value: number; duration?: number }>(), { duration: 900 });
const shown = ref(0);
let raf = 0;

function animate(from: number, to: number) {
  cancelAnimationFrame(raf);
  const start = performance.now();
  const dur = Math.abs(to - from) > 3 ? props.duration : 450;
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    shown.value = Math.round(from + (to - from) * eased);
    if (p < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

watch(
  () => props.value,
  (to, from) => animate(from ?? 0, to),
  { immediate: true },
);
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <span class="count-up">{{ shown.toLocaleString() }}</span>
</template>
