<script setup>
// "Por dónde llegan" (SPEC_landing_seminarios §4.5): la tabla de canales de las métricas del evento (eventAnalytics.ts:
// trackingChannel "ref:paula-rios", LinkedIn por categorizeReferrer y la venta sin seguimiento con DIRECT_CHANNEL, por
// props). Entradas por canal y los ingresos calculados con los precios del congreso de §4.3 (seminarChannels; el
// convenio con el descuento de COLEGIO20 por entrada). Selector "Por entradas" / "Por ingresos" (reordena con FLIP).
// Cada canal se despliega: las visitas (en mobile, la tabla va con 3 columnas) y, en los links con ref, el link de
// ejemplo con "Copiar" (copia el texto de ejemplo y avisa que es un ejemplo).
// C10: las barras de entradas crecen al entrar (data-lp-grow, stagger 80 ms) y el orden cambia con FLIP (320 ms).
// Analítica: se_channel_sort {by}, se_channel_open {channel} y se_link_copy.
import { computed, onBeforeUnmount, ref } from 'vue'
import { formatCLP } from '../producerLanding.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { channelLink, seminarChannels, sortChannels } from './seminariosLanding.js'

const props = defineProps({
  /** DIRECT_CHANNEL de src/lib/eventAnalytics.ts */
  directLabel: { type: String, required: true },
})

const sorts = [
  { value: 'tickets', label: 'Por entradas' },
  { value: 'revenue', label: 'Por ingresos' },
]
const by = ref('tickets')
const open = ref('paula-rios')
const toast = ref('')
const all = seminarChannels(props.directLabel)
const rows = computed(() => sortChannels(all, by.value))
const maxTickets = Math.max(...all.map((r) => r.tickets))
const isRef = (row) => row.label.startsWith('ref:')

function setSort(value) {
  if (by.value === value) return
  by.value = value
  trackEvent('se_channel_sort', { by: value })
}
function onSortKey(e, i) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
  e.preventDefault()
  const next = (i + 1) % sorts.length
  setSort(sorts[next].value)
  e.currentTarget.parentElement?.children[next]?.focus()
}
function toggle(row) {
  open.value = open.value === row.id ? null : row.id
  if (open.value) trackEvent('se_channel_open', { channel: row.id })
}
let toastTimer = null
async function copy(row) {
  try {
    await navigator.clipboard?.writeText(channelLink(row.id))
  } catch {
    // Sin permiso de portapapeles: igual se muestra el aviso (es un ejemplo)
  }
  toast.value = 'Es un ejemplo: crea los tuyos en el panel'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
  trackEvent('se_link_copy', {})
}
onBeforeUnmount(() => clearTimeout(toastTimer))
</script>

<template>
  <div class="ct" data-testid="seminar-channels">
    <div class="ct-head">
      <p class="se-meta">Por dónde llegan · ejemplo</p>
      <div class="se-seg ct-seg" role="radiogroup" aria-label="Ordenar canales">
        <button
          v-for="(s, i) in sorts"
          :key="s.value"
          type="button"
          role="radio"
          class="se-seg-btn"
          :class="{ 'is-on': by === s.value }"
          :aria-checked="by === s.value ? 'true' : 'false'"
          :tabindex="by === s.value ? 0 : -1"
          :data-testid="`seminar-channels-sort-${s.value}`"
          @click="setSort(s.value)"
          @keydown="onSortKey($event, i)"
        >{{ s.label }}</button>
      </div>
    </div>
    <!-- Un <tbody> por canal (su fila y su detalle): así el FLIP mueve el grupo entero y el SSR calza con el cliente -->
    <TransitionGroup name="ct-row" tag="table" class="ct-table">
      <caption key="caption" class="lp-sr-only">Visitas, entradas e ingresos por canal (ejemplo)</caption>
      <thead key="head">
        <tr>
          <th scope="col" class="se-meta">Canal</th>
          <th scope="col" class="se-meta ct-num ct-visits">Visitas</th>
          <th scope="col" class="se-meta ct-num">Entradas</th>
          <th scope="col" class="se-meta ct-num">Ingresos</th>
        </tr>
      </thead>
      <tbody v-for="(row, i) in rows" :key="row.id" class="ct-group">
        <tr class="ct-row" :class="{ 'is-open': open === row.id }" :data-testid="`seminar-channel-${row.id}`">
          <th scope="row" class="ct-channel">
            <button type="button" class="ct-toggle se-focus" :aria-expanded="open === row.id ? 'true' : 'false'" @click="toggle(row)">
              <span class="ct-name">{{ row.label }}</span>
              <span v-if="row.who" class="ct-who">{{ row.who }}</span>
            </button>
          </th>
          <td class="ct-num ct-visits se-tabular">{{ row.visits.toLocaleString('es-CL') }}</td>
          <td class="ct-num se-tabular">
            {{ row.tickets }}
            <span class="ct-bar" aria-hidden="true"><span data-lp-grow :style="{ width: `${(row.tickets / maxTickets) * 100}%`, '--lp-d': `${i * 80}ms` }"></span></span>
          </td>
          <td class="ct-num se-tabular">{{ formatCLP(row.revenue) }}</td>
        </tr>
        <tr v-if="open === row.id" class="ct-detail">
          <td colspan="4">
            <p class="ct-detail-visits se-tabular">{{ row.visits.toLocaleString('es-CL') }} visitas</p>
            <p v-if="isRef(row)" class="ct-link">
              <code class="se-tabular">{{ channelLink(row.id) }}</code>
              <button type="button" class="ct-copy se-focus" :data-testid="`seminar-copy-${row.id}`" @click="copy(row)">Copiar</button>
            </p>
          </td>
        </tr>
      </tbody>
    </TransitionGroup>
    <p class="ct-toast" role="status" aria-live="polite">{{ toast }}</p>
  </div>
</template>

<style scoped>
.ct {
  min-width: 0;
  font-size: 14px;
}
.ct-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.ct-table {
  width: 100%;
  border-collapse: collapse;
}
.ct-table th,
.ct-table td {
  padding: 6px 6px;
  border-bottom: 1px solid var(--se-filete);
  text-align: left;
  vertical-align: middle;
}
.ct-table thead th {
  border-bottom: 1px solid var(--se-grafito);
}
.ct-num {
  text-align: right !important;
  white-space: nowrap;
}
.ct-visits {
  display: none;
}
.ct-row {
  height: 48px;
}
.ct-row.is-open {
  background: var(--se-cordon-claro);
}
.ct-channel {
  font-weight: 400;
}
.ct-toggle {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-height: 44px;
  justify-content: center;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
}
.ct-name {
  font-family: var(--se-font);
  font-weight: 700;
  font-stretch: 75%;
  font-size: 14px;
  letter-spacing: 0.02em;
  text-decoration: underline;
  text-decoration-color: var(--border-strong);
  text-underline-offset: 3px;
}
.ct-who {
  font-size: 12px;
  color: var(--se-text-3);
}
.ct-bar {
  display: block;
  height: 4px;
  margin-top: 4px;
  background: var(--se-papel-2);
}
.ct-bar span {
  display: block;
  height: 100%;
  margin-left: auto;
  background: var(--se-cordon);
  transform-origin: right center;
}
.ct-detail td {
  padding: 8px 6px 12px;
  background: var(--se-cordon-claro);
}
.ct-detail-visits {
  font-size: 13px;
  color: var(--se-text-2);
}
.ct-link {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.ct-link code {
  font-size: 13px;
  word-break: break-all;
}
.ct-copy {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--se-grafito);
  border-radius: 4px;
  background: #ffffff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.ct-toast {
  min-height: 20px;
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--se-cordon-ink);
}
.ct-row-move {
  transition: transform 320ms var(--se-ease);
}
@media (min-width: 768px) {
  .ct-visits {
    display: table-cell;
  }
  .ct-detail-visits {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ct-row-move {
    transition: none;
  }
}
</style>
