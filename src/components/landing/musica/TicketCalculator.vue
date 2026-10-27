<script setup>
// Talón calculadora del precio (SPEC_landing_musica §4.9): valor de la entrada, quién paga el cargo y cuánto paga el
// público / recibe la banda. Misma fórmula que el checkout y las otras calculadoras (priceQuote → computeFeeSplit de
// fees.mjs): $12.000 → el público paga $13.142 y tú recibes $12.000; absorbido → $12.000 / $10.858. Las etiquetas del
// desglose son las del checkout (SERVICE_FEE_LABEL / SERVICE_FEE_TAX_LABEL). Mismo comportamiento que PriceCalculator,
// PriceSentence y AcademyCalculator (usePriceCalculator.js: radiogroup con flechas y resultado anunciado con pausa).
// A diferencia de academias, el selector también se ve en mobile (en música absorber para un precio redondo es común).
// En mobile el talón es vertical (perforación horizontal). M16: los montos interpolan en 250 ms.
// Analítica: mu_calc_change { price, payer } al soltar el slider o cambiar quién paga.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatCLP, priceQuote } from '../producerLanding.js'
import { SERVICE_FEE_LABEL, SERVICE_FEE_TAX_LABEL } from '../../../../netlify/lib/fees.mjs'
import { useDelayedAnnouncement, usePayerToggle } from '../../../composables/usePriceCalculator.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { MUSIC_CALC_PRICE } from './musicaLanding.js'

const payers = [
  { value: 'buyer', label: 'Paga el público' },
  { value: 'producer', label: 'Lo absorbo yo' },
]
const price = ref(MUSIC_CALC_PRICE.default)
const { payer, segButtons, onSegKey } = usePayerToggle(payers)
const quote = computed(() => priceQuote(price.value, payer.value))
const absorbed = computed(() => payer.value === 'producer')
const announced = useDelayedAnnouncement(quote, (q) => `Tu público paga ${formatCLP(q.buyerPays)}. Tú recibes ${formatCLP(q.perTicket)}.`)

// M16: los dos montos grandes interpolan (sin "reducir movimiento"); el texto final es siempre el exacto
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

const track = () => trackEvent('mu_calc_change', { price: price.value, payer: payer.value })
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
  <div class="mu-ticket tc" data-testid="music-calculator">
    <div class="tc-body">
      <p class="mu-mono tc-kicker">Tu entrada</p>
      <p class="mu-display tc-price" aria-hidden="true">{{ formatCLP(price) }}</p>
      <div class="tc-field">
        <p class="tc-row"><label for="mu-calc-price">Valor de la entrada</label><span class="mu-mono">{{ formatCLP(price) }}</span></p>
        <input
          id="mu-calc-price"
          v-model.number="price"
          type="range"
          class="mu-range"
          :min="MUSIC_CALC_PRICE.min"
          :max="MUSIC_CALC_PRICE.max"
          :step="MUSIC_CALC_PRICE.step"
          :aria-valuetext="formatCLP(price)"
          data-testid="music-calculator-range"
          @change="track"
        />
      </div>

      <div class="tc-seg" role="radiogroup" aria-label="¿Quién paga el cargo?">
        <span class="tc-seg-thumb" :class="{ 'is-right': absorbed }" aria-hidden="true"></span>
        <button
          v-for="(p, i) in payers"
          :key="p.value"
          :ref="(el) => (segButtons[i] = el)"
          type="button"
          role="radio"
          class="tc-seg-btn"
          :class="{ 'is-on': payer === p.value }"
          :aria-checked="payer === p.value ? 'true' : 'false'"
          :tabindex="payer === p.value ? 0 : -1"
          :data-testid="`music-calculator-payer-${p.value}`"
          @click="choosePayer(p.value)"
          @keydown="onPayerKey($event, i)"
        >{{ p.label }}</button>
      </div>

      <dl class="mu-mono tc-breakdown">
        <div><dt>Entrada</dt><dd>{{ formatCLP(quote.price) }}</dd></div>
        <div><dt>{{ SERVICE_FEE_LABEL }}</dt><dd>{{ absorbed ? '−' : '+' }} {{ formatCLP(quote.fee) }}</dd></div>
        <div><dt>{{ SERVICE_FEE_TAX_LABEL }}</dt><dd>{{ absorbed ? '−' : '+' }} {{ formatCLP(quote.iva) }}</dd></div>
      </dl>
      <p class="mu-example tc-hint">{{ absorbed ? 'El cargo y su IVA se descuentan de tu entrada.' : 'El cargo y su IVA los paga tu público.' }}</p>
    </div>

    <div class="mu-ticket-stub tc-stub">
      <dl class="tc-result">
        <div class="tc-pays">
          <dt class="mu-mono">Tu público paga</dt>
          <dd class="mu-display" data-testid="music-calculator-public">{{ formatCLP(shownPays) }}</dd>
        </div>
        <div class="tc-gets">
          <dt class="mu-mono">Tú recibes</dt>
          <dd class="mu-display" data-testid="music-calculator-you">{{ formatCLP(shownGets) }}</dd>
        </div>
      </dl>
    </div>
    <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
  </div>
</template>

<style scoped>
/* Mobile: talón vertical (perforación horizontal); desktop: horizontal con el talón a la derecha */
.tc {
  --stub: 236px;
  --notch: 12px;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto var(--stub);
  background: #fff;
  box-shadow: 0 24px 50px rgba(17, 16, 19, 0.18);
  -webkit-mask: radial-gradient(circle var(--notch) at 0 calc(100% - var(--stub)), #0000 98%, #000) left / 51% 100% no-repeat,
    radial-gradient(circle var(--notch) at 100% calc(100% - var(--stub)), #0000 98%, #000) right / 51% 100% no-repeat;
  mask: radial-gradient(circle var(--notch) at 0 calc(100% - var(--stub)), #0000 98%, #000) left / 51% 100% no-repeat,
    radial-gradient(circle var(--notch) at 100% calc(100% - var(--stub)), #0000 98%, #000) right / 51% 100% no-repeat;
}
.tc-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 20px;
}
.tc-kicker {
  color: var(--mu-ink-3);
}
.tc-price {
  margin-top: -8px;
  font-size: 56px;
  line-height: 60px;
}
.tc-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  font-weight: 600;
}
.tc-row label {
  color: var(--mu-ink-2);
}
.tc-seg {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border: 2px solid var(--mu-ink);
  border-radius: 6px;
}
.tc-seg-thumb {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 50%;
  background: var(--mu-ink);
  transition: transform 260ms var(--ease-in-out);
}
.tc-seg-thumb.is-right {
  transform: translateX(100%);
}
.tc-seg-btn {
  position: relative;
  min-height: 44px;
  border: 0;
  background: none;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--mu-ink);
  cursor: pointer;
  transition: color 260ms var(--ease-in-out);
}
.tc-seg-btn.is-on {
  color: #fff;
}
.tc-seg-btn:focus-visible {
  outline: 3px solid var(--mu-red-ink);
  outline-offset: 2px;
  z-index: 1;
}
.tc-breakdown {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid rgba(17, 16, 19, 0.16);
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0.02em;
}
.tc-breakdown div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.tc-breakdown dt {
  color: var(--mu-ink-2);
}
.tc-breakdown dd {
  font-weight: 700;
  white-space: nowrap;
}
.tc-hint {
  margin-top: -6px;
}
.tc-stub {
  display: flex;
  align-items: center;
  padding: 18px 20px;
}
.tc-result {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tc-result dt {
  font-size: 12px;
  color: var(--mu-ink-3);
}
.tc-pays dd {
  font-size: 44px;
  line-height: 48px;
}
.tc-gets {
  padding: 12px 14px;
  background: var(--brand-lime);
}
.tc-gets dt {
  color: var(--mu-ink);
}
.tc-gets dd {
  font-size: 52px;
  line-height: 56px;
}
@media (min-width: 900px) {
  .tc {
    --stub: 300px;
    grid-template-columns: minmax(0, 1fr) var(--stub);
    grid-template-rows: none;
    -webkit-mask: radial-gradient(circle var(--notch) at calc(100% - var(--stub)) 0, #0000 98%, #000) top / 100% 51% no-repeat,
      radial-gradient(circle var(--notch) at calc(100% - var(--stub)) 100%, #0000 98%, #000) bottom / 100% 51% no-repeat;
    mask: radial-gradient(circle var(--notch) at calc(100% - var(--stub)) 0, #0000 98%, #000) top / 100% 51% no-repeat,
      radial-gradient(circle var(--notch) at calc(100% - var(--stub)) 100%, #0000 98%, #000) bottom / 100% 51% no-repeat;
  }
  .tc-body {
    padding: 32px 32px 28px;
  }
  .tc-price {
    font-size: 72px;
    line-height: 76px;
  }
  .tc-stub {
    padding: 28px 24px;
    border-top: 0;
    border-left: 2px dashed rgba(17, 16, 19, 0.35);
  }
  .tc-pays dd {
    font-size: 48px;
    line-height: 52px;
  }
  .tc-gets dd {
    font-size: 56px;
    line-height: 60px;
  }
}
@media (max-width: 899px) {
  .tc-stub {
    border-left: 0;
    border-top: 2px dashed rgba(17, 16, 19, 0.35);
  }
}
@media (prefers-reduced-motion: reduce) {
  .tc-seg-thumb,
  .tc-seg-btn {
    transition-duration: 1ms;
  }
}
</style>
