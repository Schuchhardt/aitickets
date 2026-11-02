<script setup>
// Dibujo de un mapa de asientos (src/lib/seatMap.mjs). Lo usan el editor del panel (mode 'edit': un clic quita o
// devuelve un asiento) y el checkout (mode 'pick': un clic elige o suelta un asiento libre).
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import { sectionRows } from "../../lib/seatMap.mjs";

const props = defineProps({
  map: { type: Object, required: true },
  mode: { type: String, default: "pick" }, // 'pick' | 'edit' | 'preview'
  taken: { type: Array, default: () => [] },
  selected: { type: Array, default: () => [] },
  // Secciones que se pueden elegir (null = todas). Las demás se ven atenuadas.
  allowedSections: { type: Array, default: null },
});
const emit = defineEmits(["toggle"]);

const takenSet = computed(() => new Set(props.taken));
const selectedSet = computed(() => new Set(props.selected));
const multi = computed(() => (props.map?.sections?.length || 0) > 1);

const sections = computed(() =>
  (props.map?.sections || []).map((sec) => ({
    ...sec,
    allowed: !props.allowedSections || props.allowedSections.includes(sec.id),
    grid: sectionRows(sec),
  })),
);

// Tamaño del asiento para que la fila más ancha quepa en el ancho disponible (entre 12 y 26 px; si no cabe, scroll)
const root = ref(null);
const width = ref(0);
let observer = null;
onMounted(() => {
  if (!root.value) return;
  width.value = root.value.clientWidth;
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(([entry]) => (width.value = entry.contentRect.width));
    observer.observe(root.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());
const sizeStyle = computed(() => {
  if (!width.value) return null;
  // Unidades de ancho por fila: asientos + 0.75 por pasillo + 2 etiquetas de fila (~0.9 cada una)
  const units = Math.max(...(props.map?.sections || []).map((s) => s.seatsPerRow + 0.75 * (s.aisles?.length || 0) + 1.8), 1);
  const cols = Math.max(...(props.map?.sections || []).map((s) => s.seatsPerRow + (s.aisles?.length || 0) + 2), 1);
  const gapRatio = 0.16;
  const seat = Math.floor((width.value - 20) / (units + cols * gapRatio));
  const size = Math.max(12, Math.min(26, seat));
  return { "--seat": `${size}px`, "--gap": `${Math.max(2, Math.round(size * gapRatio))}px`, "--seat-font": `${Math.max(7, Math.round(size * 0.4))}px` };
});

function stateOf(sec, seat) {
  if (seat.removed) return "removed";
  if (props.mode !== "pick") return "free";
  if (selectedSet.value.has(seat.key)) return "selected";
  if (takenSet.value.has(seat.key)) return "taken";
  if (!sec.allowed) return "blocked";
  return "free";
}

function label(sec, row, seat) {
  const base = `Fila ${row.label}, asiento ${seat.n}`;
  const where = multi.value ? `${sec.name}, ${base}` : base;
  const st = stateOf(sec, seat);
  if (props.mode === "edit") return seat.removed ? `${where} (sin asiento, clic para agregarlo)` : `${where} (clic para quitarlo)`;
  if (st === "taken") return `${where}, ocupado`;
  if (st === "blocked") return `${where}, no corresponde a tus entradas`;
  return where;
}

function onClick(sec, row, seat) {
  if (props.mode === "preview") return;
  if (props.mode === "edit") {
    emit("toggle", { sectionId: sec.id, row: row.label, n: seat.n, key: seat.key });
    return;
  }
  const st = stateOf(sec, seat);
  if (st === "removed" || st === "taken" || st === "blocked") return;
  emit("toggle", { sectionId: sec.id, row: row.label, n: seat.n, key: seat.key });
}
</script>

<template>
  <div ref="root" class="seatmap" :data-mode="mode" :style="sizeStyle">
    <div class="scroller">
      <div class="canvas">
        <div class="stage" aria-hidden="true">{{ map.stage || "Escenario" }}</div>
        <section v-for="sec in sections" :key="sec.id" class="section" :class="{ 'is-dim': mode === 'pick' && !sec.allowed }" :aria-label="sec.name">
          <p v-if="multi || mode === 'edit'" class="section-name">{{ sec.name }}</p>
          <div v-for="row in sec.grid" :key="row.label" class="row">
            <span class="row-label" aria-hidden="true">{{ row.label }}</span>
            <template v-for="seat in row.seats" :key="seat.key">
              <button
                v-if="mode !== 'preview' && (mode === 'edit' || !seat.removed)"
                type="button"
                class="seat"
                :data-state="stateOf(sec, seat)"
                :aria-label="label(sec, row, seat)"
                :aria-pressed="mode === 'pick' ? (selectedSet.has(seat.key) ? 'true' : 'false') : (seat.removed ? 'false' : 'true')"
                :disabled="mode === 'pick' && ['taken', 'blocked'].includes(stateOf(sec, seat))"
                :data-seat="seat.key"
                @click="onClick(sec, row, seat)"
              >
                <span class="seat-n">{{ seat.n }}</span>
              </button>
              <span v-else class="seat" :data-state="seat.removed ? 'gap' : 'free'" aria-hidden="true"></span>
              <span v-if="seat.aisleAfter" class="aisle" aria-hidden="true"></span>
            </template>
            <span class="row-label" aria-hidden="true">{{ row.label }}</span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.seatmap {
  --seat: 24px;
  --gap: 4px;
  --seat-free: #ffffff;
  --seat-border: #9ca3af;
  --seat-taken: #d1d5db;
  --seat-selected: var(--accent, #111827);
  --seat-selected-text: var(--accent-contrast, #ffffff);
  --text-muted: #6b7280;
  width: 100%;
}
.scroller {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 6px;
}
.canvas {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  min-width: max-content;
  margin: 0 auto;
  padding: 4px 8px;
}
.stage {
  width: 70%;
  min-width: 160px;
  text-align: center;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
  border-top: 3px solid var(--seat-border);
  border-radius: 50% 50% 0 0 / 14px 14px 0 0;
  padding-top: 6px;
}
.section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap);
  transition: opacity 0.2s;
}
.section.is-dim {
  opacity: 0.45;
}
.section-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  margin: 0 0 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--gap);
}
.row-label {
  width: calc(var(--seat) * 0.9);
  text-align: center;
  font-size: var(--seat-font, 10px);
  font-weight: 600;
  color: var(--text-muted);
}
.aisle {
  width: calc(var(--seat) * 0.75);
}
.seat {
  width: var(--seat);
  height: var(--seat);
  border-radius: 28% 28% 18% 18%;
  border: 1.5px solid var(--seat-border);
  background: var(--seat-free);
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font: inherit;
  cursor: pointer;
  flex: none;
  transition: transform 0.1s, background-color 0.15s;
}
.seat-n {
  font-size: var(--seat-font, 9px);
  line-height: 1;
  color: var(--text-muted);
  opacity: 0;
}
.seat:hover .seat-n,
.seat[data-state="selected"] .seat-n {
  opacity: 1;
}
.seat:focus-visible {
  outline: 2px solid var(--seat-selected);
  outline-offset: 2px;
}
.seat[data-state="free"]:hover {
  transform: translateY(-1px);
  border-color: var(--seat-selected);
}
.seat[data-state="selected"] {
  background: var(--seat-selected);
  border-color: var(--seat-selected);
}
.seat[data-state="selected"] .seat-n {
  color: var(--seat-selected-text);
}
.seat[data-state="taken"] {
  background: var(--seat-taken);
  border-color: var(--seat-taken);
  cursor: not-allowed;
}
.seat[data-state="blocked"] {
  cursor: not-allowed;
}
.seat[data-state="removed"] {
  border-style: dashed;
  background: transparent;
  opacity: 0.35;
}
.seat[data-state="gap"] {
  border-color: transparent;
  background: transparent;
  cursor: default;
}
[data-mode="preview"] .seat {
  cursor: default;
}
</style>
