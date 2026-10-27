<script setup>
// Ranking de RRPP (SPEC_landing_clubs §4.4): visitas, inscritos en la lista free, cover, mesas e ingresos de cada link
// de ejemplo (rrppBoard: ingresos = cantidades × precios de CLUB_TICKETS, lo que recibe el club sin cargo) y la venta
// directa (DIRECT_CHANNEL de eventAnalytics.ts, llega por props). Es lo que ya muestran las métricas por canal
// (eventAnalytics.ts, channelConversion), inscripciones gratis incluidas con ingreso $0. "Entraron" (check-ins por canal)
// no existe: la columna va con "—" y "Pronto".
// Selector "Por inscritos / Por ingresos" (radiogroup) que reordena con FLIP (TransitionGroup, 320 ms); al tocar una
// fila aparece su link de ejemplo con "Copiar" (copia el texto y avisa que es un ejemplo). C10: las barras crecen al
// hidratarse (client:visible), stagger 80 ms. Mobile: cada fila es una card con nombre, barra y tres cifras.
// Analítica: cl_rrpp_sort { by }, cl_rrpp_select { rrpp }, cl_link_copy.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import SoonBadge from '../../ui/SoonBadge.vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { formatCLP } from '../producerLanding.js'
import { rrppBoard, rrppLink, sortRrpp } from './clubsLanding.js'

const props = defineProps({
  /** DIRECT_CHANNEL de src/lib/eventAnalytics.ts */
  directLabel: { type: String, required: true },
})

const sorts = [
  { value: 'lista', label: 'Por inscritos' },
  { value: 'revenue', label: 'Por ingresos' },
]
const by = ref('lista')
const rows = computed(() => sortRrpp(rrppBoard(props.directLabel), by.value))
const max = computed(() => Math.max(...rows.value.map((r) => r[by.value]), 1))
const selectedId = ref('cata')
const selected = computed(() => rows.value.find((r) => r.id === selectedId.value))
const toast = ref('')
const playing = ref(false)
const num = (n) => (n === null || n === undefined ? '—' : n.toLocaleString('es-CL'))

const sortButtons = ref([])
function choose(value) {
  if (by.value === value) return
  by.value = value
  trackEvent('cl_rrpp_sort', { by: value })
}
function onSortKey(e, i) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
  e.preventDefault()
  const next = (i + 1) % sorts.length
  choose(sorts[next].value)
  sortButtons.value[next]?.focus()
}
function select(row) {
  if (row.direct) return
  selectedId.value = row.id
  trackEvent('cl_rrpp_select', { rrpp: row.id })
}

let toastTimer = 0
async function copy() {
  const text = rrppLink(selected.value)
  try {
    await navigator.clipboard?.writeText(text)
  } catch {
    // Sin permiso de portapapeles igual se muestra el aviso: es un link de ejemplo
  }
  toast.value = 'Es un ejemplo: crea los tuyos en el panel'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
  trackEvent('cl_link_copy', {})
}
onMounted(() => {
  playing.value = document.documentElement.classList.contains('lp-motion')
})
onBeforeUnmount(() => clearTimeout(toastTimer))
</script>

<template>
  <div class="rb cl-card" :class="{ 'is-playing': playing }" data-testid="club-rrpp">
    <div class="rb-head">
      <p class="cl-meta">Lista por RRPP · <span class="rb-example">ejemplo</span></p>
      <div class="rb-seg" role="radiogroup" aria-label="Ordenar el ranking">
        <button
          v-for="(s, i) in sorts"
          :key="s.value"
          :ref="(el) => (sortButtons[i] = el)"
          type="button"
          role="radio"
          class="rb-seg-btn"
          :class="{ 'is-on': by === s.value }"
          :aria-checked="by === s.value ? 'true' : 'false'"
          :tabindex="by === s.value ? 0 : -1"
          :data-testid="`club-rrpp-sort-${s.value}`"
          @click="choose(s.value)"
          @keydown="onSortKey($event, i)"
        >{{ s.label }}</button>
      </div>
    </div>

    <table class="rb-table" role="table">
      <caption class="lp-sr-only">Ventas e inscripciones por link de RRPP en una noche de ejemplo</caption>
      <thead role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader">RRPP (link)</th>
          <th scope="col" role="columnheader" class="rb-num rb-hide-sm">Visitas</th>
          <th scope="col" role="columnheader" class="rb-num">Lista free</th>
          <th scope="col" role="columnheader" class="rb-num">Cover</th>
          <th scope="col" role="columnheader" class="rb-num rb-hide-sm">Mesas</th>
          <th scope="col" role="columnheader" class="rb-num">Ingresos</th>
          <th scope="col" role="columnheader" class="rb-num rb-hide-sm rb-soon">Entraron <SoonBadge dark /></th>
        </tr>
      </thead>
      <TransitionGroup tag="tbody" name="rb-move" role="rowgroup">
        <tr
          v-for="(row, i) in rows"
          :key="row.id"
          role="row"
          class="rb-row"
          :class="{ 'is-top': i === 0, 'is-selected': row.id === selectedId, 'is-direct': row.direct }"
          :data-testid="`club-rrpp-row-${row.id}`"
        >
          <th scope="row" role="rowheader" class="rb-name">
            <button
              v-if="!row.direct"
              type="button"
              class="rb-pick"
              :aria-pressed="row.id === selectedId ? 'true' : 'false'"
              @click="select(row)"
            >{{ row.name }}</button>
            <span v-else class="rb-direct">{{ row.name }}</span>
            <span class="rb-bar" aria-hidden="true">
              <span :style="{ transform: `scaleX(${row[by] / max})`, '--i': i }"></span>
            </span>
          </th>
          <td class="rb-num rb-hide-sm" role="cell" data-label="Visitas">{{ num(row.visits) }}</td>
          <td class="rb-num" role="cell" data-label="Lista">{{ num(row.lista) }}</td>
          <td class="rb-num" role="cell" data-label="Cover">{{ num(row.cover) }}</td>
          <td class="rb-num rb-hide-sm" role="cell" data-label="Mesas">{{ num(row.mesa) }}</td>
          <td class="rb-num rb-money" role="cell" data-label="Ingresos">{{ formatCLP(row.revenue) }}</td>
          <td class="rb-num rb-hide-sm rb-dim" role="cell">—</td>
        </tr>
      </TransitionGroup>
    </table>

    <div v-if="selected" class="rb-link">
      <p class="cl-meta">Link de {{ selected.name }}</p>
      <div class="rb-link-row">
        <code class="rb-url" data-testid="club-rrpp-link">{{ rrppLink(selected) }}</code>
        <button type="button" class="rb-copy" data-testid="club-rrpp-copy" @click="copy">Copiar</button>
      </div>
    </div>
    <p class="rb-toast" role="status" aria-live="polite">{{ toast }}</p>
  </div>
</template>

<style scoped>
.rb {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 16px;
}
.rb-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.rb-example {
  color: var(--cl-text-3);
}
.rb-seg {
  display: inline-grid;
  grid-template-columns: repeat(2, auto);
  padding: 3px;
  border: 1px solid var(--cl-line-strong);
  border-radius: 12px;
}
.rb-seg-btn {
  min-height: 40px;
  padding: 0 12px;
  border: 0;
  border-radius: 9px;
  background: none;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--cl-text-2);
  cursor: pointer;
}
.rb-seg-btn.is-on {
  background: var(--cl-text-1);
  color: var(--cl-ink);
}
.rb-seg-btn:focus-visible,
.rb-pick:focus-visible,
.rb-copy:focus-visible {
  outline: 2px solid var(--cl-uv-soft);
  outline-offset: 2px;
}
.rb-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.rb-table thead th {
  padding: 0 8px 8px;
  border-bottom: 1px solid var(--cl-line);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-align: left;
  color: var(--cl-text-3);
  white-space: nowrap;
}
.rb-soon :deep(.soon) {
  margin-left: 4px;
}
.rb-num {
  text-align: right !important;
}
.rb-row th,
.rb-row td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--cl-line);
  font-size: 14px;
  vertical-align: middle;
}
.rb-row.is-top {
  outline: 1px solid var(--cl-line-glow);
  outline-offset: -1px;
  box-shadow: 0 0 24px rgba(138, 92, 255, 0.16) inset;
}
.rb-row.is-selected th,
.rb-row.is-selected td {
  background: rgba(255, 79, 184, 0.06);
}
.rb-name {
  min-width: 140px;
  text-align: left;
  font-weight: 600;
}
.rb-pick {
  min-height: 32px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-weight: 600;
  color: var(--cl-text-1);
  text-align: left;
  text-decoration: underline;
  text-decoration-color: rgba(180, 155, 255, 0.45);
  text-underline-offset: 3px;
  cursor: pointer;
}
.rb-row.is-selected .rb-pick {
  color: var(--cl-fluor);
  text-decoration-color: currentColor;
}
.rb-direct {
  display: block;
  font-weight: 500;
  color: var(--cl-text-2);
}
.rb-bar {
  display: block;
  height: 4px;
  margin-top: 6px;
  border-radius: 2px;
  background: var(--cl-led-off);
  overflow: hidden;
}
.rb-bar span {
  display: block;
  height: 100%;
  background: var(--cl-fluor);
  box-shadow: 0 0 8px rgba(255, 79, 184, 0.6);
  transform-origin: left center;
  transition: transform 320ms var(--ease-out);
}
.rb-row.is-direct .rb-bar span {
  background: var(--cl-uv-soft);
  box-shadow: none;
}
.rb-money {
  font-weight: 600;
}
.rb-dim {
  color: var(--cl-text-3);
}
.rb-link {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rb-link-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 12px;
  border: 1px solid var(--cl-line-glow);
  border-radius: 12px;
  background: var(--cl-noche-2);
}
.rb-url {
  flex: 1 1 auto;
  min-width: 0;
  font-family: "Prompt", system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--cl-text-1);
  overflow-wrap: anywhere;
}
.rb-copy {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  background: var(--brand-lime);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--cl-ink);
  cursor: pointer;
}
.rb-toast {
  min-height: 18px;
  font-size: 13px;
  color: var(--cl-text-2);
}
/* FLIP al reordenar (C10) */
.rb-move-move {
  transition: transform 320ms var(--ease-out);
}

/* Mobile: cards con nombre + barra + lista, cover e ingresos. Los role explícitos de la tabla (como TourDates de música)
   mantienen filas y encabezados de columna para el lector de pantalla aunque aquí cambie el display. */
@media (max-width: 767px) {
  .rb-hide-sm {
    display: none;
  }
  .rb-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }
  .rb-table,
  .rb-table tbody {
    display: block;
  }
  .rb-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px 8px;
    margin-bottom: 8px;
    padding: 10px 12px;
    border: 1px solid var(--cl-line);
    border-radius: 12px;
  }
  .rb-row.is-top {
    outline-offset: -1px;
    border-color: transparent;
  }
  .rb-row th,
  .rb-row td {
    padding: 0;
    border: 0;
    background: none !important;
  }
  .rb-row .rb-name {
    grid-column: 1 / -1;
    min-width: 0;
  }
  .rb-row td.rb-num {
    display: flex;
    flex-direction: column;
    text-align: left !important;
    font-size: 15px;
  }
  .rb-row td.rb-num::before {
    content: attr(data-label);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--cl-text-3);
  }
  .rb-row td.rb-hide-sm {
    display: none;
  }
}
@media (min-width: 1024px) {
  .rb {
    padding: 20px;
  }
}

/* C10: las barras crecen al hidratarse, stagger 80 ms */
.rb.is-playing .rb-bar span {
  animation: cl-grow-x 600ms var(--ease-out) calc(var(--i) * 80ms) backwards;
}
@media (prefers-reduced-motion: reduce) {
  .rb-bar span,
  .rb-move-move {
    transition: none;
  }
}
</style>
