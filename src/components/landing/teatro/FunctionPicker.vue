<script setup>
// "Así lo ve tu público" (SPEC_landing_teatro §4.3, Escena 1): demo de la sección "Funciones" de la página del evento
// (§4.9b de la spec de evento: eventView.js functionListModel / checkoutFunctions / ticketRowsFor) con la piel del
// tema. Lista de funciones con los mismos estados (Disponible, Últimas, Agotada), "Desde $X" cuando esa función tiene
// otro precio (los jueves populares) y "Ver las 16 funciones". Al tocar "Elegir", la card pasa al paso "Entradas" de
// esa función (crossfade + translateX 24 px, T8) con el precio final con cargo incluido, como el checkout real
// (priceQuote → computeFeeSplit de fees.mjs): General $10.952, Estudiante y adulto mayor $7.666 y, los jueves, Jueves
// popular $6.571. Es una demo: no hay compra.
// Accesibilidad: el paso de entradas se anuncia con una región aria-live propia ("Entradas para …", con pausa, como la
// temporada) y no la lista entera. El foco se mueve cuando la vista nueva ya está en pantalla (@after-enter: con
// mode="out-in" no existe hasta que termina de salir la anterior): al botón "Funciones" al elegir y, al volver, a la
// función elegida. "Ver las 16 funciones" desaparece al tocarlo, así que el foco pasa a la primera función nueva.
// Sin JS se ve la lista (los botones no hacen nada). Analítica: te_function_pick { weekday }.
import { computed, nextTick, ref } from 'vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { useDelayedAnnouncement } from '../../../composables/usePriceCalculator.js'
import { formatCLP } from '../producerLanding.js'
import {
  PICKER_STATUS,
  PICKER_VISIBLE,
  SEASON_FUNCTIONS,
  STATE_LABELS,
  functionFrom,
  ticketsFor,
} from './teatroLanding.js'

const A11Y_STATE = { available: 'disponible', last: 'últimas entradas', soldout: 'agotada' }

const rows = SEASON_FUNCTIONS.map((fn) => {
  const state = PICKER_STATUS[fn.id] || 'available'
  return { fn, state, from: functionFrom(fn), aria: `Elegir función del ${fn.long}, ${A11Y_STATE[state]}` }
})
const expanded = ref(false)
const visibleRows = computed(() => (expanded.value ? rows : rows.slice(0, PICKER_VISIBLE)))
const selected = ref(null)
const tickets = computed(() => (selected.value ? ticketsFor(selected.value) : []))
const backButton = ref(null)
const list = ref(null)
let lastPicked = null

const announced = useDelayedAnnouncement(selected, (fn) => (fn ? `Entradas para el ${fn.long}` : ''))

function pick(row) {
  if (row.state === 'soldout') return
  lastPicked = row.fn.id
  selected.value = row.fn
  trackEvent('te_function_pick', { weekday: row.fn.weekday })
}
function back() {
  selected.value = null
}
// Al terminar de entrar la vista (T8): con entradas, el foco al botón para volver; con la lista, a la función elegida
function focusView() {
  if (selected.value) backButton.value?.focus()
  else list.value?.querySelector(`[data-fn="${lastPicked}"]`)?.focus()
}
function showAll() {
  expanded.value = true
  const next = rows.slice(PICKER_VISIBLE).find((r) => r.state !== 'soldout')
  if (next) nextTick(() => list.value?.querySelector(`[data-fn="${next.fn.id}"]`)?.focus())
}
</script>

<template>
  <div class="fp" data-testid="theatre-function-picker">
    <p class="te-example fp-label">Página de tu obra · ejemplo</p>
    <div class="fp-stage">
      <Transition name="fp-step" mode="out-in" @after-enter="focusView">
        <div v-if="!selected" key="list" class="fp-view">
          <p class="fp-heading">Funciones</p>
          <p class="fp-month">Noviembre</p>
          <ul ref="list" class="fp-list">
            <li
              v-for="(row, i) in visibleRows"
              :key="row.fn.id"
              class="fp-row"
              :class="`is-${row.state}`"
              :style="{ '--i': i }"
            >
              <span class="fp-when">
                <span class="fp-date">{{ row.fn.label }}</span>
                <span v-if="row.from" class="fp-from">{{ row.from }}</span>
              </span>
              <span class="fp-chip" :class="`fp-chip-${row.state}`">
                <s v-if="row.state === 'soldout'">{{ STATE_LABELS.soldout }}</s>
                <template v-else>{{ STATE_LABELS[row.state] }}</template>
              </span>
              <button
                v-if="row.state !== 'soldout'"
                type="button"
                class="fp-pick"
                :data-fn="row.fn.id"
                :aria-label="row.aria"
                :data-testid="`theatre-pick-${row.fn.id}`"
                @click="pick(row)"
              >Elegir</button>
              <span v-else class="fp-pick-off" aria-hidden="true"></span>
            </li>
          </ul>
          <button
            v-if="!expanded"
            type="button"
            class="fp-all"
            data-testid="theatre-picker-all"
            @click="showAll"
          >Ver las {{ rows.length }} funciones</button>
        </div>

        <div v-else key="tickets" class="fp-view" data-testid="theatre-picker-tickets">
          <button ref="backButton" type="button" class="fp-back" @click="back">
            <span aria-hidden="true">←</span> Funciones
          </button>
          <p class="fp-heading">Entradas</p>
          <p class="fp-selected">{{ selected.label }}</p>
          <ul class="fp-tickets">
            <li v-for="t in tickets" :key="t.id" class="fp-ticket">
              <span class="fp-ticket-name">{{ t.name }}</span>
              <span class="fp-ticket-price" :data-testid="`theatre-ticket-${t.id}`">{{ formatCLP(t.final) }}</span>
            </li>
          </ul>
          <p class="fp-note">Precio final con cargo por servicio incluido.</p>
        </div>
      </Transition>
    </div>
    <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
  </div>
</template>

<style scoped>
.fp {
  position: relative;
  padding: 18px 16px 20px;
  border-radius: 10px;
  border-top: 1px solid rgba(212, 175, 106, 0.5);
  background: var(--te-sala-3);
  box-shadow: 0 30px 60px rgba(7, 10, 18, 0.45);
}
.fp-label {
  margin-bottom: 12px;
}
.fp-stage {
  min-height: 380px;
}
.fp-heading {
  font-family: var(--te-display);
  font-size: 28px;
  line-height: 34px;
  font-weight: 500;
}
.fp-month {
  margin-top: 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--te-line-strong);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--te-oro);
}
.fp-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 6px 0;
  border-bottom: 1px solid var(--te-line);
}
.fp-when {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.fp-date {
  font-size: 15px;
  font-weight: 500;
  color: var(--te-text-1);
}
.fp-from {
  font-size: 13px;
  color: var(--te-text-3);
}
.fp-row.is-soldout .fp-date {
  color: var(--te-text-3);
  text-decoration: line-through;
}
.fp-chip {
  font-size: 13px;
  line-height: 18px;
  color: var(--te-text-2);
  white-space: nowrap;
}
.fp-chip-last {
  padding: 2px 8px;
  border: 1px solid var(--te-oro);
  border-radius: 6px;
  color: var(--te-oro);
}
.fp-chip-soldout {
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--te-velvet);
  color: var(--te-text-1);
}
.fp-pick,
.fp-pick-off {
  min-width: 76px;
}
.fp-pick {
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid rgba(212, 175, 106, 0.6);
  border-radius: 8px;
  background: transparent;
  color: var(--te-text-1);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}
.fp-pick:hover {
  border-color: var(--te-oro);
  background: rgba(212, 175, 106, 0.12);
}
.fp-pick:focus-visible,
.fp-all:focus-visible,
.fp-back:focus-visible {
  outline: 2px solid var(--te-oro);
  outline-offset: 2px;
}
.fp-all {
  width: 100%;
  min-height: 44px;
  margin-top: 14px;
  border: 1px solid var(--te-line-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--te-text-1);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.fp-all:hover {
  border-color: rgba(212, 175, 106, 0.6);
}
.fp-back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  margin: -8px 0 4px -4px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--te-text-2);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.fp-back:hover {
  color: var(--te-text-1);
}
.fp-selected {
  margin-top: 4px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--te-line-strong);
  font-size: 15px;
  color: var(--te-oro);
}
.fp-ticket {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  min-height: 56px;
  padding: 14px 0;
  border-bottom: 1px solid var(--te-line);
}
.fp-ticket-name {
  font-size: 15px;
  font-weight: 500;
}
.fp-ticket-price {
  font-family: var(--te-display);
  font-size: 24px;
  font-weight: 500;
  font-variant-numeric: lining-nums tabular-nums;
}
.fp-note {
  margin-top: 12px;
  font-size: 13px;
  line-height: 19px;
  color: var(--te-text-3);
}
/* T8: crossfade + translateX 24 px entre la lista y las entradas */
.fp-step-enter-active,
.fp-step-leave-active {
  transition: opacity 260ms var(--ease-out), transform 260ms var(--ease-out);
}
.fp-step-enter-from {
  opacity: 0;
  transform: translateX(24px);
}
.fp-step-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}
/* T8: filas con stagger de 50 ms cuando la card se revela (el [data-lp-reveal] está fuera de la isla) */
@keyframes fp-row-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
:global(.lp-motion) :global(.is-in) .fp-row {
  animation: fp-row-in 500ms var(--ease-out) calc(200ms + var(--i) * 50ms) both;
}
@media (min-width: 1024px) {
  .fp {
    padding: 24px 28px 28px;
  }
  .fp-date {
    font-size: 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .fp-step-enter-active,
  .fp-step-leave-active {
    transition-duration: 1ms;
  }
}
</style>
