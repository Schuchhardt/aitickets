<script setup>
// Paso 1 del checkout pagado (§6.3): lugar → función → entradas. Cada nivel se omite si tiene una sola opción.
import { ref, computed, nextTick } from "vue";
import QuantityStepper from "./QuantityStepper.vue";
import { formatCLP, miniCalendar, hhmm, ticketMax, ticketRowsFor, groupByMonth, formatSaleStart } from "./eventView.js";
import { isFeeAbsorbed } from "../Reservation/pricing.js";

const props = defineProps({
  event: { type: Object, required: true },
  // checkoutFunctions(event)
  model: { type: Object, required: true },
  place: { type: String, default: null },
  functionId: { type: [String, Number], default: null },
  selection: { type: Object, default: () => ({}) },
  notice: { type: String, default: "" },
});
const emit = defineEmits(["update:place", "update:functionId", "update:selection", "track"]);

const showPlaces = computed(() => props.model.places.length > 1);
const placeFunctions = computed(() =>
  props.model.functions.filter((f) => !showPlaces.value || !props.place || f.place === props.place),
);
const showFunctions = computed(() => props.model.needsFunction && placeFunctions.value.length > 1);
const selectedPlace = computed(() => props.model.places.find((p) => p.key === props.place) || null);

// Más de 8 funciones en el mismo lugar: agrupadas por mes
const functionGroups = computed(() => {
  const list = placeFunctions.value;
  return list.length <= 8 ? [{ key: "all", label: "", items: list }] : groupByMonth(list);
});

const rows = computed(() => {
  if (props.model.needsFunction && !props.functionId) return [];
  return ticketRowsFor(props.event, props.model.needsFunction ? props.functionId : null);
});
const absorbed = computed(() => isFeeAbsorbed(props.event));

// Se llegó con la función elegida (?funcion=, chip de la card o "Elegir" de la lista, §4.9b): el foco va a la primera
// fila de entradas a la venta (al "+" de su stepper) en vez de al lugar o la fecha
const rowsEl = ref(null);
defineExpose({
  focusTickets() {
    const target = rowsEl.value?.$el?.querySelector('[data-ticket-row="available"] .stepper-plus');
    target?.focus({ preventScroll: true });
    return Boolean(target);
  },
});

function selectPlace(key) {
  if (key === props.place) return;
  emit("update:place", key);
  emit("track", "checkout_place_select", { place: key });
}
function selectFunction(id) {
  if (String(id) === String(props.functionId)) return;
  emit("update:functionId", String(id));
  emit("track", "checkout_function_select", { function_id: id });
}
function setQty(ticket, qty) {
  const next = { ...props.selection };
  if (qty > 0) next[ticket.id] = qty;
  else delete next[ticket.id];
  emit("update:selection", next);
  emit("track", "checkout_qty_change", { ticket_id: ticket.id, quantity: qty });
}

// Flechas dentro de un radiogroup (chips y tiles)
async function onRadioKey(e, items, current, select, keyOf) {
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  const enabled = items.filter((i) => i.status !== "sold_out");
  if (!enabled.length) return;
  let idx = enabled.findIndex((i) => String(keyOf(i)) === String(current));
  const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
  idx = (idx + delta + enabled.length) % enabled.length;
  select(keyOf(enabled[idx]));
  await nextTick();
  e.currentTarget.querySelector('[aria-checked="true"]')?.focus();
}
</script>

<template>
  <div class="choose">
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>

    <!-- a) Lugar -->
    <fieldset v-if="showPlaces" class="block">
      <legend class="block-title">Lugar</legend>
      <div
        class="chips"
        role="radiogroup"
        aria-label="Lugar"
        @keydown="onRadioKey($event, model.places, place, selectPlace, (p) => p.key)"
      >
        <button
          v-for="p in model.places"
          :key="p.key"
          type="button"
          role="radio"
          class="chip"
          :class="{ 'is-on': p.key === place }"
          :aria-checked="p.key === place ? 'true' : 'false'"
          :tabindex="p.key === place || (!place && p === model.places[0]) ? 0 : -1"
          @click="selectPlace(p.key)"
        >{{ p.city || p.name }}</button>
      </div>
      <p v-if="selectedPlace?.address" class="place-address">{{ selectedPlace.name }} · {{ selectedPlace.address }}</p>
    </fieldset>

    <!-- b) Función -->
    <fieldset v-if="showFunctions" class="block">
      <legend class="block-title">Fecha y hora</legend>
      <div v-for="group in functionGroups" :key="group.key">
        <p v-if="group.label" class="month">{{ group.label }}</p>
        <div
          class="tiles"
          role="radiogroup"
          aria-label="Fecha y hora"
          @keydown="onRadioKey($event, group.items, functionId, selectFunction, (f) => f.id)"
        >
          <button
            v-for="f in group.items"
            :key="f.id"
            type="button"
            role="radio"
            class="tile"
            :class="{ 'is-on': String(f.id) === String(functionId), 'is-out': f.status === 'sold_out' }"
            :aria-checked="String(f.id) === String(functionId) ? 'true' : 'false'"
            :aria-disabled="f.status === 'sold_out' ? 'true' : undefined"
            :tabindex="String(f.id) === String(functionId) || (!functionId && f === group.items.find((x) => x.status !== 'sold_out')) ? 0 : -1"
            @click="f.status !== 'sold_out' && selectFunction(f.id)"
          >
            <span class="tile-day">{{ miniCalendar(f.date)?.weekday }} {{ miniCalendar(f.date)?.day }}</span>
            <span class="tile-month">{{ miniCalendar(f.date)?.month }}</span>
            <span class="tile-time ev-tabular">{{ hhmm(f.start_time) }}</span>
            <span v-if="f.status === 'few'" class="tile-tag is-few">Últimas</span>
            <span v-else-if="f.status === 'sold_out'" class="tile-tag">Agotada</span>
          </button>
        </div>
      </div>
    </fieldset>

    <!-- c) Entradas -->
    <div v-if="rows.length" class="block">
      <h3 class="block-title">Entradas</h3>
      <TransitionGroup ref="rowsEl" tag="ul" name="row" class="rows" appear :key="functionId || 'all'">
        <li
          v-for="(t, i) in rows"
          :key="t.id"
          class="row"
          :data-ticket-row="t.status"
          :class="{ 'is-off': t.status !== 'available' }"
          :style="{ '--i': i }"
        >
          <div class="row-info">
            <p class="row-price ev-tabular">{{ Number(t.price) > 0 ? formatCLP(t.final_price ?? t.price) : "Gratis" }}</p>
            <p class="row-name">{{ t.ticket_name }}</p>
            <p v-if="t.status === 'sold_out'" class="row-sub">Agotada</p>
            <p v-else-if="t.status === 'upcoming' && t.opens_after" class="row-sub">Se abre al agotarse {{ t.opens_after }}</p>
            <p v-else-if="t.status === 'upcoming'" class="row-sub">Disponible desde el {{ formatSaleStart(t.sales_start, event.timezone) }}</p>
          </div>
          <div class="row-side">
            <QuantityStepper
              v-if="t.status === 'available'"
              :model-value="selection[t.id] || 0"
              :max="ticketMax(t)"
              :item-label="`una entrada ${t.ticket_name}`"
              @update:model-value="setQty(t, $event)"
            />
          </div>
        </li>
      </TransitionGroup>
      <p class="rows-note">{{ absorbed ? "Precios finales." : "Precios finales: incluyen cargo por servicio e IVA del cargo." }}</p>
    </div>
    <p v-else-if="model.needsFunction && !functionId" class="pick-hint">Elige una fecha para ver las entradas.</p>
  </div>
</template>

<style scoped>
.choose {
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.notice {
  font-size: 14px;
  font-weight: 500;
  color: var(--warning-text);
  background: #fffaeb;
  border-radius: var(--r-md);
  padding: 10px 12px;
}
.block {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.block-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  padding: 0;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  min-height: 40px;
  padding: 0 16px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  background: var(--surface-1);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-1);
  cursor: pointer;
  transition: background-color var(--dur-2), color var(--dur-2);
}
.chip:hover {
  background: var(--surface-2);
}
.chip.is-on {
  background: var(--brand-ink);
  color: #fff;
  border-color: var(--brand-ink);
  animation: pop var(--dur-2) var(--ease-spring);
}
.chip:focus-visible,
.tile:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}
.place-address {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-2);
}
.month {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  margin: 12px 0 8px;
}
.tiles {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding: 2px 2px 6px;
  margin: -2px -2px 0;
  scrollbar-width: none;
}
.tiles::-webkit-scrollbar {
  display: none;
}
.tile {
  flex: 0 0 88px;
  height: 92px;
  scroll-snap-align: start;
  border-radius: var(--r-md);
  border: 1px solid var(--border-strong);
  background: var(--surface-0);
  color: var(--text-1);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  cursor: pointer;
  transition: border-color var(--dur-2), background-color var(--dur-2), box-shadow var(--dur-2);
}
.tile:hover:not(.is-out) {
  border-color: var(--text-1);
}
.tile.is-on {
  border-color: var(--text-1);
  box-shadow: inset 0 0 0 1px var(--text-1);
  background: var(--surface-1);
  animation: pop var(--dur-2) var(--ease-spring);
}
.tile.is-out {
  opacity: 0.4;
  cursor: not-allowed;
}
.tile.is-out .tile-day,
.tile.is-out .tile-time {
  text-decoration: line-through;
}
.tile-day {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.tile-month {
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--text-2);
}
.tile-time {
  font-size: 15px;
  font-weight: 600;
}
.tile-tag {
  font-size: 11px;
  color: var(--text-2);
}
.tile-tag.is-few {
  color: var(--warning-text);
  font-weight: 500;
}
@keyframes pop {
  from { transform: scale(0.96); }
  to { transform: scale(1); }
}
.rows {
  display: flex;
  flex-direction: column;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.row:first-child {
  padding-top: 0;
}
.row.is-off {
  opacity: 0.5;
}
.row-info {
  min-width: 0;
}
.row-name {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-2);
  overflow-wrap: anywhere;
  margin-top: 2px;
}
.row-sub {
  font-size: 13px;
  color: var(--text-2);
  margin-top: 2px;
}
.row-side {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}
.row-price {
  font-size: 18px;
  line-height: 24px;
  font-weight: 700;
  color: var(--text-1);
}
.rows-note,
.pick-hint {
  margin-top: 10px;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-3);
}
.pick-hint {
  font-size: 14px;
  color: var(--text-2);
}
/* A10: las filas entran escalonadas al elegir función */
.row-enter-active {
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
  transition-delay: calc(var(--i, 0) * 30ms);
}
.row-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
@media (min-width: 640px) {
  .tiles {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    overflow: visible;
  }
  .tile {
    width: auto;
  }
}
</style>
