<script setup>
// Calculadora "cierre de caja" (SPEC_landing_clubs §4.8): presets Lista free / Cover / Mesa, quién paga el cargo y
// cuánto paga el público / recibe el club. Misma fórmula que el checkout y las otras calculadoras (priceQuote →
// computeFeeSplit de fees.mjs): $10.000 → $10.952 / $10.000 (absorbido $10.000 / $9.048); $180.000 → $197.136 /
// $180.000 (absorbido $180.000 / $162.864). Etiquetas del desglose del checkout (SERVICE_FEE_LABEL /
// SERVICE_FEE_TAX_LABEL). Con "Lista free" no hay cargo ni selector: $0 para todos.
// Cover: slider $0–$60.000 (paso $500). Mesa: campo numérico (parseAmount, tope CALC_PRICE.inputMax). Comportamiento de
// PriceCalculator y TicketCalculator (usePriceCalculator.js: radiogroups con flechas y resultado anunciado con pausa).
// C13: los montos interpolan en 250 ms. Analítica: cl_calc_preset { preset }, cl_calc_change { price, payer } (al
// soltar el slider, al salir del campo o al cambiar quién paga).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CALC_PRICE, formatCLP, parseAmount, priceQuote } from '../producerLanding.js'
import { SERVICE_FEE_LABEL, SERVICE_FEE_TAX_LABEL } from '../../../../netlify/lib/fees.mjs'
import { useDelayedAnnouncement, usePayerToggle } from '../../../composables/usePriceCalculator.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { CASH_PRESETS, CLUB_COVER_RANGE } from './clubsLanding.js'

const payers = [
  { value: 'buyer', label: 'Paga el público' },
  { value: 'producer', label: 'Lo absorbo yo' },
]
const preset = ref('cover')
const cover = ref(CASH_PRESETS.find((p) => p.id === 'cover').price)
const table = ref(CASH_PRESETS.find((p) => p.id === 'mesa').price)
const tableText = ref(table.value.toLocaleString('es-CL'))
const { payer, segButtons, onSegKey } = usePayerToggle(payers)

const free = computed(() => preset.value === 'lista')
const price = computed(() => (preset.value === 'mesa' ? table.value : preset.value === 'cover' ? cover.value : 0))
const quote = computed(() => priceQuote(price.value, free.value ? 'buyer' : payer.value))
const absorbed = computed(() => !free.value && payer.value === 'producer')
const announced = useDelayedAnnouncement(quote, (q) =>
  free.value ? '$0 para todos. Cada persona recibe su QR.' : `Tu público paga ${formatCLP(q.buyerPays)}. Tú recibes ${formatCLP(q.perTicket)}.`,
)

// C13: los dos montos grandes interpolan (sin "reducir movimiento"); el texto final es siempre el exacto
const shownPays = ref(quote.value.buyerPays)
const shownGets = ref(quote.value.perTicket)
let reduced = true
let frame = 0
onMounted(() => {
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
})
onBeforeUnmount(() => cancelAnimationFrame(frame))
watch(quote, (q) => {
  cancelAnimationFrame(frame)
  if (reduced) {
    shownPays.value = q.buyerPays
    shownGets.value = q.perTicket
    return
  }
  const from = { pays: shownPays.value, gets: shownGets.value }
  const start = performance.now()
  const step = (now) => {
    const t = Math.min(1, (now - start) / 250)
    const e = 1 - Math.pow(1 - t, 3)
    shownPays.value = Math.round(from.pays + (q.buyerPays - from.pays) * e)
    shownGets.value = Math.round(from.gets + (q.perTicket - from.gets) * e)
    if (t < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
})

const track = () => trackEvent('cl_calc_change', { price: price.value, payer: payer.value })

// Presets como radiogroup: las flechas cambian la opción y mueven el foco
const presetButtons = ref([])
function choosePreset(id) {
  if (preset.value === id) return
  preset.value = id
  trackEvent('cl_calc_preset', { preset: id })
}
function onPresetKey(e, i) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
  e.preventDefault()
  const next = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + CASH_PRESETS.length) % CASH_PRESETS.length
  choosePreset(CASH_PRESETS[next].id)
  presetButtons.value[next]?.focus()
}
function choosePayer(value) {
  if (payer.value === value) return
  payer.value = value
  track()
}
function onPayerKey(e, i) {
  const before = payer.value
  onSegKey(e, i)
  if (payer.value !== before) track()
}
function onTableInput(e) {
  table.value = parseAmount(e.target.value, CALC_PRICE.inputMax)
}
function onTableBlur() {
  tableText.value = table.value.toLocaleString('es-CL')
  track()
}
</script>

<template>
  <div class="cc" data-testid="club-calc">
    <div class="cc-presets" role="radiogroup" aria-label="Tipo de entrada">
      <button
        v-for="(p, i) in CASH_PRESETS"
        :key="p.id"
        :ref="(el) => (presetButtons[i] = el)"
        type="button"
        role="radio"
        class="cc-preset"
        :class="{ 'is-on': preset === p.id }"
        :aria-checked="preset === p.id ? 'true' : 'false'"
        :tabindex="preset === p.id ? 0 : -1"
        :data-testid="`club-calc-preset-${p.id}`"
        @click="choosePreset(p.id)"
        @keydown="onPresetKey($event, i)"
      >
        {{ p.label }} · <span class="cl-tabular">{{ formatCLP(p.price) }}</span>
      </button>
    </div>

    <div v-if="preset === 'cover'" class="cc-field">
      <p class="cc-row"><label for="cl-calc-cover">Valor del cover</label><span class="cl-tabular">{{ formatCLP(cover) }}</span></p>
      <input
        id="cl-calc-cover"
        v-model.number="cover"
        type="range"
        class="cl-range"
        :min="CLUB_COVER_RANGE.min"
        :max="CLUB_COVER_RANGE.max"
        :step="CLUB_COVER_RANGE.step"
        :aria-valuetext="formatCLP(cover)"
        data-testid="club-calc-range"
        @change="track"
      />
    </div>
    <div v-else-if="preset === 'mesa'" class="cc-field">
      <label for="cl-calc-table" class="cc-row">Valor de la mesa</label>
      <div class="cc-input">
        <span aria-hidden="true">$</span>
        <input
          id="cl-calc-table"
          v-model="tableText"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          data-testid="club-calc-table"
          @input="onTableInput"
          @blur="onTableBlur"
        />
      </div>
    </div>

    <div v-if="!free" class="cc-seg" role="radiogroup" aria-label="¿Quién paga el cargo?">
      <span class="cc-seg-thumb" :class="{ 'is-right': absorbed }" aria-hidden="true"></span>
      <button
        v-for="(p, i) in payers"
        :key="p.value"
        :ref="(el) => (segButtons[i] = el)"
        type="button"
        role="radio"
        class="cc-seg-btn"
        :class="{ 'is-on': payer === p.value }"
        :aria-checked="payer === p.value ? 'true' : 'false'"
        :tabindex="payer === p.value ? 0 : -1"
        :data-testid="`club-calc-payer-${p.value}`"
        @click="choosePayer(p.value)"
        @keydown="onPayerKey($event, i)"
      >{{ p.label }}</button>
    </div>

    <p v-if="free" class="cc-free" data-testid="club-calc-free">$0 para todos. Cada persona recibe su QR.</p>
    <dl v-else class="cc-breakdown">
      <div><dt>Entrada</dt><dd class="cl-tabular">{{ formatCLP(quote.price) }}</dd></div>
      <div><dt>{{ SERVICE_FEE_LABEL }}</dt><dd class="cl-tabular">{{ absorbed ? '−' : '+' }} {{ formatCLP(quote.fee) }}</dd></div>
      <div><dt>{{ SERVICE_FEE_TAX_LABEL }}</dt><dd class="cl-tabular">{{ absorbed ? '−' : '+' }} {{ formatCLP(quote.iva) }}</dd></div>
    </dl>

    <dl class="cc-result">
      <div class="cc-pays">
        <dt>Tu público paga</dt>
        <dd class="cl-tabular" data-testid="club-calc-public">{{ formatCLP(shownPays) }}</dd>
      </div>
      <div class="cc-gets">
        <dt>Tú recibes</dt>
        <!-- Doto: el separador de miles va en Prompt (.cl-sep), el punto de Doto se lee como "+" -->
        <dd data-testid="club-calc-you"><template v-for="(part, i) in formatCLP(shownGets).split('.')" :key="i"><span v-if="i" class="cl-sep">.</span>{{ part }}</template></dd>
      </div>
    </dl>
    <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
  </div>
</template>

<style scoped>
.cc {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border: 1px solid var(--cl-servicio-2);
  border-radius: 16px;
  background: #fff;
  color: var(--cl-ink);
  box-shadow: 0 18px 40px rgba(20, 18, 28, 0.1);
}
/* Presets en scroll horizontal si no caben (mobile) */
.cc-presets {
  display: flex;
  gap: 6px;
  margin-inline: -4px;
  padding: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}
.cc-preset {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0 14px;
  border: 1.5px solid var(--cl-ink);
  border-radius: 12px;
  background: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--cl-ink);
  white-space: nowrap;
  cursor: pointer;
}
.cc-preset.is-on {
  background: var(--cl-ink);
  color: #fff;
}
.cc-preset:focus-visible,
.cc-seg-btn:focus-visible {
  outline: 3px solid var(--cl-fluor-ink);
  outline-offset: 2px;
}
.cc-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cc-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--cl-ink-2);
}
.cc-input {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 48px;
  padding: 0 14px;
  border: 1.5px solid var(--cl-ink);
  border-radius: 12px;
  font-size: 20px;
  font-weight: 700;
}
.cc-input:focus-within {
  outline: 3px solid var(--cl-fluor-ink);
  outline-offset: 2px;
}
.cc-input input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  font-variant-numeric: tabular-nums;
  outline: none;
}
.cc-seg {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border: 1.5px solid var(--cl-ink);
  border-radius: 12px;
  overflow: hidden;
}
.cc-seg-thumb {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 50%;
  background: var(--cl-ink);
  transition: transform 260ms var(--ease-in-out);
}
.cc-seg-thumb.is-right {
  transform: translateX(100%);
}
.cc-seg-btn {
  position: relative;
  min-height: 44px;
  border: 0;
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--cl-ink);
  cursor: pointer;
  transition: color 260ms var(--ease-in-out);
}
.cc-seg-btn.is-on {
  color: #fff;
}
.cc-free {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--cl-servicio);
  font-weight: 600;
}
.cc-breakdown {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--cl-servicio-2);
  font-size: 14px;
}
.cc-breakdown div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.cc-breakdown dt {
  color: var(--cl-ink-2);
}
.cc-breakdown dd {
  font-weight: 600;
  white-space: nowrap;
}
.cc-result {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cc-result dt {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--cl-ink-3);
}
.cc-pays {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.cc-pays dd {
  font-size: 26px;
  line-height: 32px;
  font-weight: 700;
}
.cc-gets {
  padding: 12px 16px 14px;
  border-radius: 12px;
  background: var(--brand-lime);
}
.cc-gets dt {
  color: var(--cl-ink);
}
.cc-gets dd {
  font-family: var(--cl-led);
  font-weight: 800;
  font-size: 44px;
  line-height: 48px;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--cl-ink);
  overflow-wrap: anywhere;
}
@media (min-width: 640px) {
  .cc {
    padding: 24px;
  }
  .cc-gets dd {
    font-size: 56px;
    line-height: 60px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cc-seg-thumb,
  .cc-seg-btn {
    transition-duration: 1ms;
  }
}
</style>
