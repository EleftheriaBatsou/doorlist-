<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { fmtTime } from '../lib/format';

const props = defineProps<{ arrivals: string[]; startsAt: string }>();

const wrap = ref<HTMLElement | null>(null);
const width = ref(640);
const now = ref(Date.now());
let ro: ResizeObserver | undefined;
let tick: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  ro = new ResizeObserver(([e]) => (width.value = Math.max(280, Math.round(e!.contentRect.width))));
  if (wrap.value) ro.observe(wrap.value);
  tick = setInterval(() => (now.value = Date.now()), 30_000);
});
onBeforeUnmount(() => {
  ro?.disconnect();
  clearInterval(tick);
});

const M = { l: 36, r: 40, t: 16 };
const AREA_H = 190;
const GAP = 22;
const COL_H = 64;
const AXIS_H = 26;
const H = M.t + AREA_H + GAP + COL_H + AXIS_H;

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120];

const model = computed(() => {
  const times = props.arrivals.map((a) => new Date(a).getTime()).sort((a, b) => a - b);
  const start = new Date(props.startsAt).getTime();
  const lo0 = Math.min(times[0] ?? start, start - 30 * 60_000);
  const hi0 = Math.max(now.value, times[times.length - 1] ?? now.value, lo0 + 30 * 60_000);
  const span = (hi0 - lo0) / 60_000;
  const step = STEPS.find((s) => span / s <= 36) ?? 240;
  const stepMs = step * 60_000;
  const lo = Math.floor(lo0 / stepMs) * stepMs;
  const n = Math.max(1, Math.ceil((hi0 - lo) / stepMs));
  const counts = new Array<number>(n).fill(0);
  for (const t of times) counts[Math.min(n - 1, Math.max(0, Math.floor((t - lo) / stepMs)))]!++;
  let run = 0;
  const cum = counts.map((c) => (run += c));
  return { lo, stepMs, step, n, counts, cum, start, total: times.length };
});

const plotW = computed(() => width.value - M.l - M.r);
// Bucket i is drawn at its END time (cumulative total reached by then).
const xAt = (i: number) => M.l + ((i + 1) / model.value.n) * plotW.value;
const x0 = computed(() => M.l);

function niceStep(raw: number) {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  return [1, 2, 3, 4, 5, 6, 8, 10].map((k) => k * pow).find((k) => k >= raw)!;
}
// Clean ticks: 4 steps of a 1/2/5 × 10ⁿ increment.
const yStep = computed(() => niceStep(Math.max(1, model.value.total) / 4));
const yMax = computed(() => Math.max(yStep.value * 4, Math.ceil(model.value.total / yStep.value) * yStep.value));
const colMax = computed(() => niceStep(Math.max(2, ...model.value.counts) / 2) * 2);
const yCum = (v: number) => M.t + AREA_H - (v / yMax.value) * AREA_H;
const colTop = M.t + AREA_H + GAP;

const linePath = computed(() => {
  const pts = [`M${x0.value},${yCum(0)}`];
  model.value.cum.forEach((c, i) => pts.push(`L${xAt(i).toFixed(1)},${yCum(c).toFixed(1)}`));
  return pts.join(' ');
});
const areaPath = computed(
  () => `${linePath.value} L${xAt(model.value.n - 1).toFixed(1)},${yCum(0)} L${x0.value},${yCum(0)} Z`,
);

const yTicks = computed(() => Array.from({ length: Math.round(yMax.value / yStep.value) + 1 }, (_, i) => i * yStep.value));

const bandW = computed(() => plotW.value / model.value.n);
const colW = computed(() => Math.max(2, Math.min(24, bandW.value - 2)));

function colPath(i: number) {
  const c = model.value.counts[i]!;
  if (!c) return '';
  const h = Math.max(3, (c / colMax.value) * COL_H);
  const cx = M.l + (i + 0.5) * bandW.value;
  const x = cx - colW.value / 2;
  const w = colW.value;
  const yb = colTop + COL_H;
  const r = Math.min(4, w / 2, h);
  // 4px rounded data-end, square at the baseline
  return `M${x},${yb} L${x},${yb - h + r} Q${x},${yb - h} ${x + r},${yb - h} L${x + w - r},${yb - h} Q${x + w},${yb - h} ${x + w},${yb - h + r} L${x + w},${yb} Z`;
}

const xTicks = computed(() => {
  const { lo, stepMs, n } = model.value;
  const want = Math.max(2, Math.floor(plotW.value / 90));
  const every = Math.max(1, Math.ceil(n / want));
  const out: { x: number; label: string }[] = [];
  for (let i = 0; i <= n; i += every) out.push({ x: M.l + (i / n) * plotW.value, label: fmtTime(new Date(lo + i * stepMs)) });
  return out;
});

const startX = computed(() => {
  const { lo, stepMs, n } = model.value;
  const f = (model.value.start - lo) / (stepMs * n);
  return f >= 0 && f <= 1 ? M.l + f * plotW.value : null;
});

// Crosshair + tooltip
const hover = ref<number | null>(null);
function onMove(e: PointerEvent) {
  const svg = e.currentTarget as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * width.value;
  const i = Math.floor((x - M.l) / bandW.value);
  hover.value = i >= 0 && i < model.value.n ? i : null;
}
const tip = computed(() => {
  const i = hover.value;
  if (i === null) return null;
  const { lo, stepMs, counts, cum } = model.value;
  const from = new Date(lo + i * stepMs);
  const to = new Date(lo + (i + 1) * stepMs);
  const cx = M.l + (i + 0.5) * bandW.value;
  return {
    i,
    cx,
    lineX: xAt(i),
    leftPct: (cx / width.value) * 100,
    flip: cx > width.value * 0.62,
    range: `${fmtTime(from)}–${fmtTime(to)}`,
    added: counts[i]!,
    total: cum[i]!,
  };
});

const last = computed(() => ({ x: xAt(model.value.n - 1), y: yCum(model.value.total) }));
const showTable = ref(false);
const tableRows = computed(() =>
  model.value.counts
    .map((c, i) => ({ c, i, t: model.value.cum[i]! }))
    .filter((r) => r.c > 0)
    .map((r) => ({
      range: `${fmtTime(new Date(model.value.lo + r.i * model.value.stepMs))}–${fmtTime(new Date(model.value.lo + (r.i + 1) * model.value.stepMs))}`,
      added: r.c,
      total: r.t,
    })),
);
</script>

<template>
  <div class="chart" ref="wrap">
    <div class="svgwrap">
      <svg
        :viewBox="`0 0 ${width} ${H}`"
        :width="width"
        :height="H"
        role="img"
        :aria-label="`Arrival curve: ${model.total} people checked in`"
        @pointermove="onMove"
        @pointerleave="hover = null"
      >
        <!-- recessive hairline grid -->
        <g class="grid">
          <line v-for="t in yTicks" :key="t" :x1="M.l" :x2="width - M.r" :y1="yCum(t)" :y2="yCum(t)" />
          <line :x1="M.l" :x2="width - M.r" :y1="colTop + COL_H" :y2="colTop + COL_H" />
        </g>
        <g class="ytick">
          <text v-for="t in yTicks" :key="t" :x="M.l - 8" :y="yCum(t) + 4" text-anchor="end">{{ t }}</text>
        </g>

        <!-- event start annotation -->
        <g v-if="startX !== null" class="start">
          <line :x1="startX" :x2="startX" :y1="M.t" :y2="colTop + COL_H" />
          <text :x="startX + 6" :y="M.t + 10">Start</text>
        </g>

        <!-- cumulative arrivals: 2px line + 10% wash -->
        <path :d="areaPath" class="area" />
        <path :d="linePath" class="line" />

        <!-- arrivals per interval -->
        <path v-for="(_, i) in model.counts" :key="i" :d="colPath(i)" class="col" :class="{ dim: tip && tip.i !== i }" />

        <!-- crosshair -->
        <g v-if="tip">
          <line class="cross" :x1="tip.lineX" :x2="tip.lineX" :y1="M.t" :y2="M.t + AREA_H" />
          <circle :cx="tip.lineX" :cy="yCum(tip.total)" r="5" class="dot" />
        </g>

        <!-- end marker + direct label -->
        <circle :cx="last.x" :cy="last.y" r="5" class="dot" />
        <text :x="last.x + 9" :y="last.y + 4" class="endlabel">{{ model.total }}</text>

        <g class="xtick">
          <text v-for="t in xTicks" :key="t.x" :x="t.x" :y="H - 6" text-anchor="middle">{{ t.label }}</text>
        </g>
        <text class="panel-label" :x="M.l" :y="colTop - 6">Per {{ model.step }} min</text>
      </svg>
      <div v-if="tip" class="tooltip" :class="{ flip: tip.flip }" :style="{ left: `${tip.leftPct}%` }">
        <div class="tt-head">{{ tip.range }}</div>
        <div class="tt-row"><span class="key key-line" /><strong>{{ tip.total }}</strong><span>arrived so far</span></div>
        <div class="tt-row"><span class="key key-col" /><strong>+{{ tip.added }}</strong><span>in this interval</span></div>
      </div>
    </div>
    <button class="table-toggle" @click="showTable = !showTable">{{ showTable ? 'Hide table' : 'View as table' }}</button>
    <table v-if="showTable" class="data-table">
      <thead><tr><th>Interval</th><th>Arrived</th><th>Running total</th></tr></thead>
      <tbody>
        <tr v-for="r in tableRows" :key="r.range"><td>{{ r.range }}</td><td>{{ r.added }}</td><td>{{ r.total }}</td></tr>
        <tr v-if="!tableRows.length"><td colspan="3" class="muted">No arrivals yet</td></tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.chart {
  width: 100%;
}
.svgwrap {
  position: relative;
}
svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  touch-action: pan-y;
}
.grid line {
  stroke: var(--line);
  stroke-width: 1;
  shape-rendering: crispEdges;
}
.ytick text,
.xtick text {
  fill: var(--muted);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.panel-label {
  fill: var(--muted);
  font-size: 11.5px;
  font-weight: 600;
}
.start line {
  stroke: var(--line-strong);
  stroke-width: 1;
}
.start text {
  fill: var(--muted);
  font-size: 11px;
  font-weight: 700;
}
.area {
  fill: var(--accent);
  fill-opacity: 0.1;
}
.line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.col {
  fill: var(--accent);
  transition: opacity 0.15s ease;
}
.col.dim {
  opacity: 0.35;
}
.dot {
  fill: var(--accent);
  stroke: var(--surface);
  stroke-width: 2;
}
.cross {
  stroke: var(--ink-2);
  stroke-width: 1;
  opacity: 0.5;
}
.endlabel {
  fill: var(--ink);
  font-size: 13px;
  font-weight: 800;
}
.tooltip {
  position: absolute;
  top: 8px;
  transform: translateX(12px);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow-lift);
  padding: 10px 12px;
  font-size: 13px;
  pointer-events: none;
  min-width: 170px;
}
.tooltip.flip {
  transform: translateX(calc(-100% - 12px));
}
.tt-head {
  color: var(--muted);
  font-weight: 600;
  margin-bottom: 4px;
  font-size: 12px;
}
.tt-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-2);
}
.tt-row strong {
  color: var(--ink);
  font-size: 15px;
}
.key {
  width: 12px;
  flex: none;
  background: var(--accent);
}
.key-line {
  height: 2px;
  border-radius: 2px;
}
.key-col {
  height: 10px;
  border-radius: 3px 3px 0 0;
}
.table-toggle {
  margin-top: 6px;
  background: none;
  border: 0;
  padding: 4px 0;
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--accent-ink);
  cursor: pointer;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-top: 6px;
  font-variant-numeric: tabular-nums;
}
.data-table th,
.data-table td {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
}
.data-table th {
  color: var(--muted);
  font-weight: 700;
}
</style>
