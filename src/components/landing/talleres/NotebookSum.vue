<script setup>
// La cuenta del cuaderno (SPEC_landing_talleres §4.8): si es gratis o con pago, el valor del taller, los cupos y quién
// paga el cargo; a la derecha, la suma escrita en el cuaderno con la misma fórmula que el checkout (priceQuote →
// computeFeeSplit de fees.mjs) y las etiquetas del desglose del checkout (SERVICE_FEE_LABEL / SERVICE_FEE_TAX_LABEL).
// Los cupos son el multiplicador del taller lleno: $25.000 × 12 → paga $27.380, recibes $25.000, $300.000 en total;
// absorbido → paga $25.000, recibes $22.620, $271.440.
// Mismo comportamiento que las otras calculadoras (usePriceCalculator.js: radiogroup con flechas y resultado anunciado
// con pausa). TL17: los montos interpolan en 250 ms y la raya y el doble subrayado se redibujan cuando cambia el total.
// Analítica: tl_calc_change { price, seats, payer, free } con debounce de 600 ms.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatCLP } from '../producerLanding.js'
import { SERVICE_FEE_LABEL, SERVICE_FEE_TAX_LABEL } from '../../../../netlify/lib/fees.mjs'
import { useDelayedAnnouncement, usePayerToggle } from '../../../composables/usePriceCalculator.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { SUM_PRICE, SUM_SEATS, notebookSum } from './talleresLanding.js'

const payers = [
  { value: 'buyer', label: 'Paga quien se inscribe' },
  { value: 'producer', label: 'Lo absorbo yo' },
]
const free = ref(false)
const price = ref(SUM_PRICE.default)
const seats = ref(SUM_SEATS.default)
const { payer, segButtons, onSegKey } = usePayerToggle(payers)
const quote = computed(() => notebookSum(price.value, payer.value, seats.value))
const absorbed = computed(() => payer.value === 'producer')
const announced = useDelayedAnnouncement(
  computed(() => [free.value, quote.value]),
  ([isFree, q]) =>
    isFree
      ? 'Taller gratis: $0 para todos.'
      : `Quien se inscribe paga ${formatCLP(q.buyerPays)}. Tú recibes ${formatCLP(q.perTicket)} por inscripción: ${formatCLP(q.total)} con el taller lleno.`,
)

// TL17: montos que interpolan; el texto final es siempre el exacto
const shown = ref({ pays: quote.value.buyerPays, gets: quote.value.perTicket, total: quote.value.total })
let reduced = true
let frame = 0
onMounted(() => {
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
})
watch(quote, (q) => {
  cancelAnimationFrame(frame)
  const to = { pays: q.buyerPays, gets: q.perTicket, total: q.total }
  if (reduced) {
    shown.value = to
    return
  }
  const from = { ...shown.value }
  const start = performance.now()
  const step = (now) => {
    const t = Math.min(1, (now - start) / 250)
    const e = 1 - Math.pow(1 - t, 3)
    shown.value = {
      pays: Math.round(from.pays + (to.pays - from.pays) * e),
      gets: Math.round(from.gets + (to.gets - from.gets) * e),
      total: Math.round(from.total + (to.total - from.total) * e),
    }
    if (t < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
})

let trackTimer = 0
function track() {
  clearTimeout(trackTimer)
  trackTimer = setTimeout(
    () => trackEvent('tl_calc_change', { price: price.value, seats: seats.value, payer: payer.value, free: free.value }),
    600,
  )
}
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  clearTimeout(trackTimer)
})
function changeSeats(delta) {
  seats.value = Math.min(SUM_SEATS.max, Math.max(SUM_SEATS.min, seats.value + delta))
  track()
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
</script>

<template>
  <div class="tl-card tl-card-plain ns" data-testid="workshop-sum">
    <p class="tl-card-head tl-card-label">La cuenta · ejemplo</p>
    <div class="tl-card-body ns-body">
      <div class="ns-controls">
        <fieldset class="ns-field">
          <legend class="tl-control-label">¿Cobras?</legend>
          <div class="tl-seg ns-seg">
            <label class="tl-seg-opt">
              <input v-model="free" type="radio" name="ns-free" :value="true" data-testid="workshop-sum-free" @change="track" />
              <span>Gratis</span>
            </label>
            <label class="tl-seg-opt">
              <input v-model="free" type="radio" name="ns-free" :value="false" data-testid="workshop-sum-paid" @change="track" />
              <span>Con pago</span>
            </label>
          </div>
        </fieldset>

        <template v-if="!free">
          <div class="ns-field">
            <label class="ns-label" for="ns-price">
              <span class="tl-control-label">Valor del taller</span>
              <span class="tl-num ns-label-value">{{ formatCLP(price) }}</span>
            </label>
            <input
              id="ns-price"
              v-model.number="price"
              type="range"
              class="tl-range"
              :min="SUM_PRICE.min"
              :max="SUM_PRICE.max"
              :step="SUM_PRICE.step"
              :aria-valuetext="formatCLP(price)"
              data-testid="workshop-sum-price"
              @change="track"
            />
          </div>

          <div class="ns-field">
            <p id="ns-seats-label" class="tl-control-label">Cupos</p>
            <div class="tl-stepper ns-stepper" role="group" aria-labelledby="ns-seats-label">
              <button type="button" class="tl-step-btn" aria-label="Quitar un cupo" :disabled="seats <= SUM_SEATS.min" @click="changeSeats(-1)">−</button>
              <output class="tl-num tl-step-value" data-testid="workshop-sum-seats">{{ seats }}</output>
              <button type="button" class="tl-step-btn" aria-label="Agregar un cupo" :disabled="seats >= SUM_SEATS.max" @click="changeSeats(1)">+</button>
            </div>
          </div>

          <div class="ns-payer" role="radiogroup" aria-label="¿Quién paga el cargo?">
            <button
              v-for="(p, i) in payers"
              :key="p.value"
              :ref="(el) => (segButtons[i] = el)"
              type="button"
              role="radio"
              class="ns-payer-btn"
              :class="{ 'is-on': payer === p.value }"
              :aria-checked="payer === p.value ? 'true' : 'false'"
              :tabindex="payer === p.value ? 0 : -1"
              :data-testid="`workshop-sum-payer-${p.value}`"
              @click="choosePayer(p.value)"
              @keydown="onPayerKey($event, i)"
            >{{ p.label }}</button>
          </div>
        </template>
      </div>

      <div class="ns-sum">
        <template v-if="free">
          <p class="tl-num ns-zero" data-testid="workshop-sum-zero">$0 para todos</p>
          <p class="tl-hand ns-zero-note" aria-hidden="true">y la entrada con QR igual</p>
        </template>
        <!-- Dos listas de términos (el desglose y el resultado) con la raya y el total escrito a mano entre ellas y
             después: un <dl> solo admite grupos dt/dd -->
        <div v-else class="ns-lines">
          <dl class="ns-dl">
            <div class="ns-line">
              <dt>Valor del taller</dt>
              <dd class="tl-num">{{ formatCLP(quote.price) }}</dd>
            </div>
            <div class="ns-line">
              <dt>{{ absorbed ? '−' : '+' }} {{ SERVICE_FEE_LABEL }}</dt>
              <dd class="tl-num">{{ formatCLP(quote.fee) }}</dd>
            </div>
            <div class="ns-line">
              <dt>{{ absorbed ? '−' : '+' }} {{ SERVICE_FEE_TAX_LABEL }}</dt>
              <dd class="tl-num">{{ formatCLP(quote.iva) }}</dd>
            </div>
          </dl>
          <svg :key="`r-${quote.total}`" class="ns-rule" viewBox="0 0 300 6" preserveAspectRatio="none" aria-hidden="true">
            <path d="M2 3 C 80 1, 200 5, 298 3" />
          </svg>
          <dl class="ns-dl">
            <div class="ns-line ns-pays">
              <dt>Quien se inscribe paga</dt>
              <dd class="tl-num" data-testid="workshop-sum-pays">{{ formatCLP(shown.pays) }}</dd>
            </div>
            <div class="ns-line ns-gets">
              <dt>Tú recibes por inscripción</dt>
              <dd class="tl-num" data-testid="workshop-sum-gets">{{ formatCLP(shown.gets) }}</dd>
            </div>
          </dl>
          <div class="ns-total">
            <p class="tl-hand ns-total-hand" aria-hidden="true">× {{ seats }} cupos = {{ formatCLP(shown.total) }}</p>
            <svg :key="`u-${quote.total}`" class="ns-underline" viewBox="0 0 220 12" preserveAspectRatio="none" aria-hidden="true">
              <path d="M4 3 C 70 1, 150 5, 216 3" />
              <path d="M10 9 C 80 7, 150 11, 212 9" />
            </svg>
            <p class="ns-total-text">
              <span class="tl-hand ns-total-note" aria-hidden="true">con el taller lleno</span>
              <span class="lp-sr-only" data-testid="workshop-sum-total">{{ seats }} cupos: {{ formatCLP(quote.total) }} con el taller lleno</span>
            </p>
          </div>
        </div>
      </div>
      <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
    </div>
  </div>
</template>

<style scoped>
.ns {
  max-width: 760px;
}
.ns-body {
  display: grid;
  gap: 28px;
  padding-top: 20px;
}
.ns-controls {
  display: grid;
  gap: 20px;
  align-content: start;
}
.ns-field {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.ns-seg,
.ns-stepper {
  margin-top: 10px;
}
.ns-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.ns-label-value {
  font-size: 22px;
}
.ns-payer {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.ns-payer-btn {
  min-height: 48px;
  padding: 6px 10px;
  border: 2px solid var(--tl-grafito);
  border-radius: 8px;
  background: var(--tl-ficha);
  box-shadow: 2px 2px 0 var(--tl-grafito);
  color: var(--tl-grafito);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition: transform 80ms var(--ease-out), box-shadow 80ms var(--ease-out), background-color 150ms var(--ease-out);
}
.ns-payer-btn.is-on {
  background: var(--tl-destacador);
  transform: translate(2px, 2px);
  box-shadow: 0 0 0 var(--tl-grafito);
}
.ns-payer-btn:focus-visible {
  outline: 3px solid var(--tl-tinta);
  outline-offset: 2px;
}

/* La suma, alineada a la derecha sobre los renglones */
.ns-sum {
  background-image: repeating-linear-gradient(to bottom, transparent 0 35px, var(--tl-ficha-renglon) 35px 36px);
}
.ns-lines,
.ns-dl {
  display: grid;
}
.ns-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
  padding: 4px 0;
}
.ns-line dt {
  font-size: 14px;
  line-height: 20px;
  color: var(--tl-grafito-2);
}
.ns-line dd {
  font-size: 20px;
  text-align: right;
  white-space: nowrap;
}
.ns-rule {
  width: 100%;
  height: 6px;
  margin: 6px 0;
}
.ns-rule path,
.ns-underline path {
  fill: none;
  stroke: var(--tl-grafito);
  stroke-width: 2.5;
  stroke-linecap: round;
}
.ns-underline path {
  stroke: var(--tl-tinta);
  stroke-width: 2.25;
}
.ns-pays dt,
.ns-gets dt {
  font-size: 16px;
  font-weight: 600;
  color: var(--tl-grafito);
}
.ns-pays dd,
.ns-gets dd {
  font-size: 24px;
}
.ns-gets {
  margin-top: 8px;
  padding: 8px 12px;
  border: 2px solid var(--tl-grafito);
  border-radius: 8px;
  background: var(--brand-lime);
}
.ns-total {
  margin-top: 14px;
  text-align: right;
}
.ns-total-hand {
  font-size: 32px;
  line-height: 36px;
}
.ns-underline {
  display: block;
  width: min(220px, 70%);
  height: 12px;
  margin: 2px 0 0 auto;
}
.ns-total-note {
  font-size: 22px;
}
.ns-zero {
  font-size: 44px;
  line-height: 1.1;
}
.ns-zero-note {
  margin-top: 8px;
}
@media (min-width: 768px) {
  .ns-body {
    grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    gap: 40px;
  }
  .ns-pays dd,
  .ns-gets dd {
    font-size: 32px;
  }
  .ns-total-hand {
    font-size: 40px;
    line-height: 44px;
  }
  .ns-zero {
    font-size: 56px;
  }
}
/* TL17: la raya y el doble subrayado se redibujan (el :key los vuelve a montar cuando cambia el total) */
.lp-motion .ns-rule,
.lp-motion .ns-underline {
  animation: tl-draw 450ms var(--ease-out) both;
}
@media (prefers-reduced-motion: reduce) {
  .ns-payer-btn {
    transition-duration: 1ms;
  }
}
</style>
