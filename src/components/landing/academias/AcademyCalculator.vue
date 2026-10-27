<script setup>
// Mini calculadora de "Muestra con entrada" (SPEC_landing_academias §3.6, AC11): valor de la entrada, quién paga el
// cargo y cuánto paga la familia / recibe la academia. Misma fórmula que el checkout y las otras calculadoras
// (priceQuote → computeFeeSplit de fees.mjs): $5.000 → la familia paga $5.476 y la academia recibe $5.000; absorbido →
// $4.524. Mismo comportamiento que PriceCalculator y PriceSentence (usePriceCalculator.js: radiogroup con flechas y
// resultado anunciado con pausa). En mobile no hay selector (§3.10): se muestra el caso "paga la familia".
// Analítica: ac_calc_change { price, payer } al soltar el slider o cambiar quién paga.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatCLP, priceQuote } from '../producerLanding.js'
import { useDelayedAnnouncement, usePayerToggle } from '../../../composables/usePriceCalculator.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { ACADEMY_CALC_PRICE } from './academiasLanding.js'

const payers = [
  { value: 'buyer', label: 'Paga la familia' },
  { value: 'producer', label: 'Lo absorbo yo' },
]
const price = ref(ACADEMY_CALC_PRICE.default)
const { payer, segButtons, onSegKey } = usePayerToggle(payers)

// El selector solo existe desde 768 px; bajo eso, siempre paga la familia
const wide = ref(true)
let media = null
const onMedia = () => {
  wide.value = media.matches
}
onMounted(() => {
  media = window.matchMedia('(min-width: 768px)')
  onMedia()
  media.addEventListener?.('change', onMedia)
})
onBeforeUnmount(() => media?.removeEventListener?.('change', onMedia))

const effectivePayer = computed(() => (wide.value ? payer.value : 'buyer'))
const quote = computed(() => priceQuote(price.value, effectivePayer.value))
const announced = useDelayedAnnouncement(quote, (q) => `La familia paga ${formatCLP(q.buyerPays)}. La academia recibe ${formatCLP(q.perTicket)}.`)

const track = () => trackEvent('ac_calc_change', { price: price.value, payer: effectivePayer.value })
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
  <div class="calc" data-testid="academy-calculator">
    <div>
      <p class="calc-row"><label for="ac-price">Valor de la entrada</label><span class="ev-tabular">{{ formatCLP(price) }}</span></p>
      <input
        id="ac-price"
        v-model.number="price"
        type="range"
        class="calc-range"
        :min="ACADEMY_CALC_PRICE.min"
        :max="ACADEMY_CALC_PRICE.max"
        :step="ACADEMY_CALC_PRICE.step"
        :aria-valuetext="formatCLP(price)"
        data-testid="academy-calculator-range"
        @change="track"
      />
    </div>

    <div class="calc-seg" role="radiogroup" aria-label="¿Quién paga el cargo?">
      <span class="calc-seg-thumb" :class="{ 'is-right': payer === 'producer' }" aria-hidden="true"></span>
      <button
        v-for="(p, i) in payers"
        :key="p.value"
        :ref="(el) => (segButtons[i] = el)"
        type="button"
        role="radio"
        class="calc-seg-btn"
        :class="{ 'is-on': payer === p.value }"
        :aria-checked="payer === p.value ? 'true' : 'false'"
        :tabindex="payer === p.value ? 0 : -1"
        :data-testid="`academy-calculator-payer-${p.value}`"
        @click="choosePayer(p.value)"
        @keydown="onPayerKey($event, i)"
      >{{ p.label }}</button>
    </div>

    <dl class="calc-result ev-tabular">
      <div><dt>La familia paga</dt><dd data-testid="academy-calculator-family">{{ formatCLP(quote.buyerPays) }}</dd></div>
      <div class="calc-receive"><dt>La academia recibe</dt><dd data-testid="academy-calculator-academy">{{ formatCLP(quote.perTicket) }}</dd></div>
    </dl>
    <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
  </div>
</template>

<style scoped>
.calc {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(251, 247, 240, 0.06);
  color: var(--ac-on-ink-1);
}
.calc-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  font-weight: 600;
}
.calc-range {
  width: 100%;
  height: 28px;
  margin: 8px 0 0;
  accent-color: var(--brand-lime);
  cursor: pointer;
}
.calc-range:focus-visible {
  outline: 2px solid var(--brand-lime);
  outline-offset: 4px;
  border-radius: 4px;
}
/* §3.10: en mobile no hay selector, el resultado es el de "paga la familia" */
.calc-seg {
  display: none;
}
.calc-seg-thumb {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc(50% - 4px);
  border-radius: 999px;
  background: var(--ac-paper);
  transition: transform 260ms var(--ease-in-out);
}
.calc-seg-thumb.is-right {
  transform: translateX(100%);
}
.calc-seg-btn {
  position: relative;
  min-height: 44px;
  border: 0;
  border-radius: 999px;
  background: none;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--ac-on-ink-2);
  cursor: pointer;
  transition: color 260ms var(--ease-in-out);
}
.calc-seg-btn.is-on {
  color: var(--ac-ink);
}
.calc-seg-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--ac-ink), 0 0 0 4px var(--brand-lime);
}
.calc-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
}
.calc-result div {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.calc-result dt {
  color: var(--ac-on-ink-2);
}
.calc-result dd {
  font-weight: 600;
}
.calc-receive dd {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: var(--brand-lime);
}
@media (min-width: 768px) {
  .calc {
    padding: 20px;
    border-radius: 20px;
  }
  .calc-seg {
    position: relative;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 4px;
    border-radius: 999px;
    background: rgba(251, 247, 240, 0.08);
  }
}
@media (prefers-reduced-motion: reduce) {
  .calc-seg-thumb,
  .calc-seg-btn {
    transition-duration: 1ms;
  }
}
</style>
