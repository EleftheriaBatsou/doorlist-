<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ kind: string; label?: string }>();
const map: Record<string, { cls: string; label: string; icon: string }> = {
  checked_in: { cls: 'ok', label: 'Checked in', icon: '✓' },
  success: { cls: 'ok', label: 'Checked in', icon: '✓' },
  valid: { cls: 'neutral', label: 'Not arrived', icon: '•' },
  already_used: { cls: 'warn', label: 'Already used', icon: '!' },
  cancelled: { cls: 'bad', label: 'Cancelled', icon: '×' },
  invalid: { cls: 'bad', label: 'Invalid', icon: '×' },
  wrong_event: { cls: 'bad', label: 'Wrong event', icon: '×' },
  queued: { cls: 'queued', label: 'Queued offline', icon: '⏱' },
};
const m = computed(() => map[props.kind] ?? { cls: 'neutral', label: props.kind, icon: '•' });
</script>

<template>
  <span class="pill" :class="m.cls"><span class="ico" aria-hidden="true">{{ m.icon }}</span>{{ label ?? m.label }}</span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 7px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
  line-height: 1.3;
}
.ico {
  display: inline-grid;
  place-items: center;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 900;
}
.ok { background: var(--success-soft); color: var(--success-ink); }
.ok .ico { background: var(--success); color: #fff; }
.warn { background: var(--warn-soft); color: var(--warn-ink); }
.warn .ico { background: var(--warn); color: var(--ink); }
.bad { background: var(--danger-soft); color: var(--danger-ink); }
.bad .ico { background: var(--danger); color: #fff; }
.neutral { background: #f1f0f6; color: var(--ink-2); }
.neutral .ico { background: #d9d7e4; color: var(--ink-2); }
.queued { background: var(--accent-soft); color: var(--accent-ink); }
.queued .ico { background: var(--accent); color: #fff; font-size: 9px; }
</style>
