<script setup>
// Plancha de stickers de los promotores (SPEC_landing_fiestas §4.4): un sticker por código con su anillo de usos
// (usos / máximo). Al tocar uno se despega y por detrás muestra las mismas columnas del panel (DiscountCodesManager.vue:
// "Usos N / máx", compras, descuento otorgado y ventas = subtotal ya descontado), calculadas con computeDiscountedTotals
// por orden (promoStats de fiestasLanding.js); otro toque lo vuelve a pegar. "Por ventas" / "Por usos" reordena (FLIP).
// Con "Links", la plancha pasa a los canales de las métricas de la fiesta (trackingChannel: "ref:cata"; la venta directa
// es DIRECT_CHANNEL, por props) con visitas, entradas e ingresos; un canal con link muestra su link de ejemplo y
// "Copiar" (copia el texto de ejemplo y avisa que es un ejemplo).
// Movimiento: F9 (al revelarse la sección los stickers hacen pop escalonado de 70 ms y cada anillo de usos se dibuja con
// stroke-dashoffset en 600 ms; el giro de cara con perspective; con "reducir movimiento", aparecen quietos y cambian de
// cara sin girar). Un sticker ya despegado no vuelve a dibujar su anillo al pegarlo de nuevo (touched). Accesibilidad:
// el botón se nombra con el texto de la cara visible (sin aria-label, para que los números del reverso se lean) y el
// estado va en aria-pressed; al despegarlo, sus números se anuncian en una región role="status" (§5). Analítica:
// fi_promo_flip {code}, fi_promo_mode {mode}, fi_promo_sort {by}, fi_link_copy.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatCLP } from '../producerLanding.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { prefersReducedMotion } from './fiestasLanding.client.js'
import { promoChannels, promoLink, promoSheet, sortPromos } from './fiestasLanding.js'

const props = defineProps({
  /** DIRECT_CHANNEL de src/lib/eventAnalytics.ts */
  directLabel: { type: String, required: true },
})

const modes = [
  { value: 'codes', label: 'Códigos' },
  { value: 'links', label: 'Links' },
]
const sorts = [
  { value: 'sales', label: 'Por ventas' },
  { value: 'uses', label: 'Por usos' },
]
const mode = ref('codes')
const sortBy = ref('sales')
const flipped = ref(new Set())
const touched = ref(new Set())
const turning = ref('')
const selected = ref('cata')
const toast = ref('')
const announce = ref('')
let reduced = true
let turnTimer = null
let toastTimer = null

const rows = computed(() => sortPromos(promoSheet(), sortBy.value))
const channels = computed(() => promoChannels(props.directLabel))
const maxTickets = computed(() => Math.max(...channels.value.map((c) => c.tickets)))
const selectedChannel = computed(() => channels.value.find((c) => c.id === selected.value && c.label.startsWith('ref:')) ?? null)

const RING = 2 * Math.PI * 16
const ringLen = (row) => (row.uses / row.maxUses) * RING
const ringDash = (row) => `${ringLen(row)} ${RING}`

onMounted(() => {
  reduced = prefersReducedMotion()
})
onBeforeUnmount(() => {
  clearTimeout(turnTimer)
  clearTimeout(toastTimer)
})

function setMode(value) {
  if (mode.value === value) return
  mode.value = value
  trackEvent('fi_promo_mode', { mode: value })
}
function setSort(value) {
  if (sortBy.value === value) return
  sortBy.value = value
  trackEvent('fi_promo_sort', { by: value })
}
function flip(code) {
  const apply = () => {
    const next = new Set(flipped.value)
    next.has(code) ? next.delete(code) : next.add(code)
    flipped.value = next
    const row = rows.value.find((r) => r.code === code)
    announce.value = next.has(code) && row
      ? `${row.code}: usos ${row.uses} de ${row.maxUses}, ${row.purchases} compras, descuento ${formatCLP(row.discount)}, ventas ${formatCLP(row.sales)}`
      : ''
  }
  if (!flipped.value.has(code)) trackEvent('fi_promo_flip', { code })
  if (!touched.value.has(code)) touched.value = new Set(touched.value).add(code)
  if (reduced) return apply()
  // Gira hasta el canto, cambia de cara y termina de girar (F9)
  turning.value = code
  clearTimeout(turnTimer)
  turnTimer = setTimeout(() => {
    apply()
    turnTimer = setTimeout(() => (turning.value = ''), 210)
  }, 210)
}
async function copyLink() {
  const text = promoLink(selected.value)
  try {
    await navigator.clipboard?.writeText(`https://${text}`)
  } catch {
    // Sin permiso para el portapapeles: el aviso igual explica que es un ejemplo
  }
  trackEvent('fi_link_copy', {})
  toast.value = 'Es un ejemplo: crea los tuyos en el panel'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
}
function onRadioKey(e, list, current, set) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
  e.preventDefault()
  const i = list.findIndex((o) => o.value === current)
  const next = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + list.length) % list.length
  set(list[next].value)
  e.currentTarget.children[next]?.focus()
}
</script>

<template>
  <div class="pm" data-testid="party-promos">
    <div class="pm-controls">
      <div class="fi-seg" role="radiogroup" aria-label="Ver" @keydown="onRadioKey($event, modes, mode, setMode)">
        <button
          v-for="m in modes"
          :key="m.value"
          type="button"
          role="radio"
          class="fi-seg-btn"
          :class="{ 'is-on': mode === m.value }"
          :aria-checked="mode === m.value ? 'true' : 'false'"
          :tabindex="mode === m.value ? 0 : -1"
          :data-testid="`party-promos-mode-${m.value}`"
          @click="setMode(m.value)"
        >{{ m.label }}</button>
      </div>
      <div v-if="mode === 'codes'" class="fi-seg" role="radiogroup" aria-label="Ordenar" @keydown="onRadioKey($event, sorts, sortBy, setSort)">
        <button
          v-for="o in sorts"
          :key="o.value"
          type="button"
          role="radio"
          class="fi-seg-btn"
          :class="{ 'is-on': sortBy === o.value }"
          :aria-checked="sortBy === o.value ? 'true' : 'false'"
          :tabindex="sortBy === o.value ? 0 : -1"
          :data-testid="`party-promos-sort-${o.value}`"
          @click="setSort(o.value)"
        >{{ o.label }}</button>
      </div>
    </div>

    <div v-if="mode === 'codes'" class="pm-sheet">
      <p class="fi-example pm-example">Plancha de ejemplo · 10% sobre la Preventa 2</p>
      <TransitionGroup tag="ul" name="pm" class="pm-grid">
        <li v-for="(row, i) in rows" :key="row.code" class="pm-cell" :style="{ '--i': i }">
          <button
            type="button"
            class="fi-sticker pm-sticker"
            :class="[`fi-sticker--${row.shape}`, `fi-tone-${row.tone}`, { 'is-turning': turning === row.code, 'is-back': flipped.has(row.code) }]"
            :style="{ '--tilt': `${[-3, 2, -1.5, 3, -2, 1.5][i % 6]}deg` }"
            :aria-pressed="flipped.has(row.code) ? 'true' : 'false'"
            :data-testid="`party-promo-${row.code}`"
            @click="flip(row.code)"
          >
            <span class="fi-sticker-paper" aria-hidden="true"></span>
            <span class="fi-sticker-ink" aria-hidden="true"></span>
            <span v-if="!flipped.has(row.code)" class="fi-sticker-body pm-front">
              <span class="pm-code fi-display">{{ row.code }}</span>
              <span class="pm-who">{{ row.who }}</span>
              <span class="lp-sr-only">. Ver sus números</span>
              <svg class="pm-ring" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
                <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-width="4"></circle>
                <circle
                  class="pm-ring-on"
                  :class="{ 'is-drawn': touched.has(row.code) }"
                  :style="{ '--len': ringLen(row) }"
                  cx="20"
                  cy="20"
                  r="16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="4"
                  stroke-linecap="round"
                  :stroke-dasharray="ringDash(row)"
                  transform="rotate(-90 20 20)"
                ></circle>
              </svg>
            </span>
            <span v-else class="fi-sticker-body pm-back" :data-testid="`party-promo-back-${row.code}`">
              <span class="pm-back-code">{{ row.code }}</span>
              <span class="lp-sr-only">, {{ row.who }}. </span>
              <span class="pm-stat"><span>Usos</span> <strong class="fi-tabular">{{ row.uses }} / {{ row.maxUses }}</strong></span>
              <span class="pm-stat"><span>Compras</span> <strong class="fi-tabular">{{ row.purchases }}</strong></span>
              <span class="pm-stat"><span>Descuento</span> <strong class="fi-tabular">{{ formatCLP(row.discount) }}</strong></span>
              <span class="pm-stat"><span>Ventas</span> <strong class="fi-tabular">{{ formatCLP(row.sales) }}</strong></span>
            </span>
          </button>
        </li>
      </TransitionGroup>
      <p class="fi-note pm-hint">Toca un sticker para ver sus números, como en tu panel.</p>
      <p class="lp-sr-only" role="status" data-testid="party-promo-status">{{ announce }}</p>
    </div>

    <div v-else class="pm-links" data-testid="party-promos-links">
      <p class="fi-example pm-example">Canales de ejemplo de las métricas de la fiesta</p>
      <table class="pm-table">
        <caption class="lp-sr-only">Visitas, entradas e ingresos por canal, ejemplo</caption>
        <thead>
          <tr>
            <th scope="col">Canal</th>
            <th scope="col">Visitas</th>
            <th scope="col">Entradas</th>
            <th scope="col">Ingresos</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in channels" :key="c.id" :class="{ 'is-on': selected === c.id }">
            <th scope="row">
              <button v-if="c.label.startsWith('ref:')" type="button" class="pm-ch-btn" :aria-pressed="selected === c.id ? 'true' : 'false'" @click="selected = c.id">
                {{ c.label }}
              </button>
              <span v-else>{{ c.label }}</span>
              <span class="pm-bar" aria-hidden="true"><span :style="{ transform: `scaleX(${c.tickets / maxTickets})` }"></span></span>
            </th>
            <td class="fi-tabular">{{ c.visits == null ? '—' : c.visits.toLocaleString('es-CL') }}</td>
            <td class="fi-tabular">{{ c.tickets }}</td>
            <td class="fi-tabular">{{ formatCLP(c.revenue) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="selectedChannel" class="pm-link-box">
        <p class="pm-link" data-testid="party-promo-link">{{ promoLink(selected) }}</p>
        <button type="button" class="fi-btn fi-btn-tinta pm-copy" data-testid="party-promo-copy" @click="copyLink">Copiar</button>
      </div>
      <p class="pm-toast" role="status">{{ toast }}</p>
    </div>
  </div>
</template>

<style scoped>
.pm {
  min-width: 0;
}
.pm-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.pm-sheet,
.pm-links {
  position: relative;
  margin-top: 16px;
  padding: 26px 14px 18px;
  border: 2px dashed rgba(22, 17, 13, 0.45);
  border-radius: 18px;
  background: var(--fi-crema-2);
}
.pm-example {
  position: absolute;
  top: -10px;
  left: 16px;
  padding: 0 8px;
  background: var(--fi-crema);
}
.pm-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px 14px;
}
.pm-cell {
  display: flex;
  justify-content: center;
  min-width: 0;
}
.pm-sticker {
  width: 100%;
  max-width: 190px;
  min-height: 120px;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
  transform: perspective(600px) rotateY(0deg) rotate(var(--tilt));
  transition: transform 210ms ease-in;
}
.pm-sticker.is-turning {
  transform: perspective(600px) rotateY(90deg) rotate(var(--tilt));
}
.pm-sticker:focus-visible {
  outline: 3px solid var(--fi-cobalto);
  outline-offset: 6px;
}
.pm-sticker.fi-sticker--burst,
.pm-sticker.fi-sticker--circle,
.pm-sticker.fi-sticker--heart {
  max-width: 170px;
}
.pm-sticker.fi-sticker--burst {
  padding: 20%;
}
.pm-sticker.fi-sticker--circle {
  padding: 14%;
}
.pm-sticker.fi-sticker--pill {
  align-self: center;
  min-height: 0;
  padding: 16px 18px;
}
.pm-front,
.pm-back {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  text-align: center;
}
.pm-code {
  font-size: 24px;
  line-height: 26px;
}
.pm-who {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.pm-ring {
  margin-top: 4px;
}
/* En la estrella y el corazón el área útil es más chica: el código baja un punto */
.fi-sticker--burst .pm-code,
.fi-sticker--heart .pm-code {
  font-size: 20px;
  line-height: 22px;
}
.pm-back-code {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.pm-stat {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  font-size: 11px;
  line-height: 15px;
}
.pm-stat strong {
  font-weight: 700;
}
.pm-hint {
  margin-top: 16px;
}
.pm-move {
  transition: transform 320ms var(--ease-out);
}
/* F9: entrada de la plancha al revelarse la sección (LandingMotion: .is-in; sin html.lp-motion queda quieta). Pop de
   fi-pop (landing-fiestas.css) con stagger de 70 ms y el anillo que se dibuja desde vacío (dashoffset = largo del arco →
   0). Solo "backwards": al terminar no queda pisando el transform del FLIP ni el giro. */
@keyframes pm-ring-draw {
  from {
    stroke-dashoffset: var(--len);
  }
  to {
    stroke-dashoffset: 0;
  }
}
.lp-motion .fi [data-lp-reveal]:not(.is-in) .pm-cell {
  opacity: 0;
}
.lp-motion .fi .is-in .pm-cell {
  animation: fi-pop 420ms cubic-bezier(0.34, 1.4, 0.64, 1) calc(var(--lp-d, 0ms) + var(--i, 0) * 70ms + 150ms) backwards;
}
.lp-motion .fi .is-in .pm-ring-on:not(.is-drawn) {
  animation: pm-ring-draw 600ms var(--ease-out) calc(var(--lp-d, 0ms) + var(--i, 0) * 70ms + 450ms) backwards;
}
.pm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.pm-table th,
.pm-table td {
  padding: 10px 6px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
.pm-table thead th {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fi-text-3);
}
.pm-table tbody th {
  font-weight: 600;
}
.pm-table tr.is-on th {
  color: var(--fi-naranja-ink);
}
.pm-ch-btn {
  min-height: 32px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-weight: 700;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
  text-align: left;
}
.pm-ch-btn:focus-visible {
  outline: 3px solid var(--fi-cobalto);
  outline-offset: 2px;
}
.pm-bar {
  display: block;
  height: 6px;
  margin-top: 6px;
  border-radius: 999px;
  background: rgba(22, 17, 13, 0.1);
  overflow: hidden;
}
.pm-bar span {
  display: block;
  height: 100%;
  background: var(--fi-cobalto);
  transform-origin: left center;
}
.pm-link-box {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}
.pm-link {
  flex: 1 1 200px;
  min-width: 0;
  padding: 10px 12px;
  border: 2px solid var(--fi-tinta);
  border-radius: 12px;
  background: #fff;
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.pm-copy {
  min-height: 44px;
}
.pm-toast {
  min-height: 20px;
  margin-top: 10px;
  font-size: 13px;
  font-weight: 600;
}
@media (min-width: 768px) {
  .pm-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 28px 18px;
  }
  .pm-code {
    font-size: 28px;
    line-height: 30px;
  }
  .fi-sticker--burst .pm-code,
  .fi-sticker--heart .pm-code {
    font-size: 22px;
    line-height: 24px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pm-sticker,
  .pm-move {
    transition: none;
  }
  .pm-cell,
  .pm-ring-on {
    animation: none;
  }
}
</style>
