<script setup>
// Selector de asientos del checkout (entradas numeradas, src/lib/seatMap.mjs). Un asiento por entrada elegida, en la
// función elegida. Los ocupados se piden a /api/events/seats al abrir y al cambiar de función; el servidor vuelve a
// validarlos al comprar (/api/purchase-ticket).
import { ref, computed, watch, onMounted } from "vue";
import SeatMapView from "../seats/SeatMapView.vue";
import { seatLabel, assignSeatsToLines } from "../../lib/seatMap.mjs";

const props = defineProps({
  event: { type: Object, required: true },
  functionId: { type: [String, Number], required: true },
  // [{ id, quantity }] de la selección actual
  lines: { type: Array, default: () => [] },
  modelValue: { type: Array, default: () => [] },
  notice: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue", "track"]);

const map = computed(() => {
  const s = props.event?.seating;
  const key = s?.map_of_date?.[String(props.functionId)];
  return key ? s.maps[key] : null;
});
const sectionsOf = (id) => (props.event.tickets || []).find((t) => String(t.id) === String(id))?.seat_sections || null;
const ticketLines = computed(() => props.lines.filter((l) => l.quantity > 0).map((l) => ({ id: l.id, quantity: l.quantity, seat_sections: sectionsOf(l.id) })));
const needed = computed(() => ticketLines.value.reduce((s, l) => s + Number(l.quantity || 0), 0));

// Secciones elegibles: las de alguna entrada elegida (null = todas)
const allowedSections = computed(() => {
  if (!ticketLines.value.length || ticketLines.value.some((l) => !l.seat_sections)) return null;
  return [...new Set(ticketLines.value.flatMap((l) => l.seat_sections))];
});

const taken = ref([]);
const loading = ref(false);
const loadError = ref("");
async function refresh() {
  if (!props.functionId) return;
  loading.value = true;
  loadError.value = "";
  try {
    const res = await fetch(`/api/events/seats?event=${encodeURIComponent(props.event.id)}&function=${encodeURIComponent(props.functionId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message);
    taken.value = Array.isArray(data.taken) ? data.taken : [];
    const free = props.modelValue.filter((k) => !taken.value.includes(k));
    if (free.length !== props.modelValue.length) emit("update:modelValue", free);
  } catch {
    loadError.value = "No pudimos cargar los asientos. Revisa tu conexión.";
  } finally {
    loading.value = false;
  }
}
defineExpose({ refresh });
onMounted(refresh);
watch(() => props.functionId, () => {
  emit("update:modelValue", []);
  refresh();
});
// Si baja la cantidad de entradas, se sueltan los últimos asientos elegidos
watch(needed, (n) => {
  if (props.modelValue.length > n) emit("update:modelValue", props.modelValue.slice(0, n));
});

function toggle({ key }) {
  const current = props.modelValue;
  if (current.includes(key)) {
    emit("update:modelValue", current.filter((k) => k !== key));
    return;
  }
  // Ya están todos: el más antiguo deja su lugar al nuevo (cambiar de asiento con un solo clic)
  const next = current.length >= needed.value ? [...current.slice(1), key] : [...current, key];
  emit("update:modelValue", next);
  emit("track", "checkout_seat_select", { count: next.length });
}

const labelOf = (key) => (map.value ? seatLabel(map.value, key) : "") || key;
const chosen = computed(() => [...props.modelValue].sort((a, b) => a.localeCompare(b, "es", { numeric: true })).map(labelOf));
// Los asientos no calzan con las entradas (p. ej. dos de Platea con una entrada de Balcón)
const mismatch = computed(() => {
  if (props.modelValue.length !== needed.value || !map.value) return "";
  const r = assignSeatsToLines(map.value, ticketLines.value, props.modelValue);
  return r.error || "";
});
</script>

<template>
  <div v-if="map" class="picker" data-testid="seat-picker">
    <div class="picker-head">
      <h3 class="title">Elige tus asientos</h3>
      <p class="count ev-tabular" aria-live="polite">{{ modelValue.length }} de {{ needed }}</p>
    </div>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="loadError" class="notice" role="alert">{{ loadError }} <button type="button" class="ev-link" @click="refresh">Reintentar</button></p>
    <div class="map" :aria-busy="loading ? 'true' : 'false'">
      <SeatMapView :map="map" mode="pick" :taken="taken" :selected="modelValue" :allowed-sections="allowedSections" @toggle="toggle" />
    </div>
    <ul class="legend" aria-hidden="true">
      <li><span class="dot is-free"></span>Libre</li>
      <li><span class="dot is-selected"></span>Tu elección</li>
      <li><span class="dot is-taken"></span>Ocupado</li>
    </ul>
    <ul v-if="chosen.length" class="chosen" aria-label="Asientos elegidos">
      <li v-for="c in chosen" :key="c">{{ c }}</li>
    </ul>
    <p v-if="mismatch" class="notice" role="alert">{{ mismatch }}</p>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.picker-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}
.count {
  font-size: 14px;
  color: var(--text-2, #4b5563);
}
.map {
  border: 1px solid var(--border, #e5e7eb);
  border-radius: var(--r-md, 12px);
  padding: 14px 4px 8px;
}
.legend {
  display: flex;
  gap: 16px;
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 12px;
  color: var(--text-2, #4b5563);
}
.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1.5px solid #9ca3af;
}
.dot.is-selected {
  background: var(--accent, #111827);
  border-color: var(--accent, #111827);
}
.dot.is-taken {
  background: #d1d5db;
  border-color: #d1d5db;
}
.chosen {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.chosen li {
  font-size: 13px;
  font-weight: 500;
  border-radius: 999px;
  padding: 4px 10px;
  background: var(--surface-2, #f3f4f6);
}
.notice {
  font-size: 14px;
  font-weight: 500;
  color: var(--warning-text, #92400e);
  background: #fffaeb;
  border-radius: var(--r-md, 12px);
  padding: 10px 12px;
  margin: 0;
}
</style>
