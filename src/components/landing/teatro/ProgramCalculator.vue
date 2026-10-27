<script setup>
// Ficha de la entrada en el programa de mano (SPEC_landing_teatro §4.7): valor de la entrada, quién paga el cargo y el
// reparto del precio con líneas de puntos, como el reparto de una obra. Misma fórmula que el checkout y las otras
// calculadoras (priceQuote → computeFeeSplit de fees.mjs): $10.000 → el público paga $10.952 y la compañía recibe
// $10.000; absorbido → $10.000 / $9.048. Las etiquetas del desglose son las del checkout (SERVICE_FEE_LABEL /
// SERVICE_FEE_TAX_LABEL). Mismo comportamiento que TicketCalculator de música (usePriceCalculator.js: radiogroup con
// flechas y resultado anunciado con pausa). T17: los montos interpolan en 250 ms.
// Analítica: te_calc_change { price, payer } al soltar el slider o cambiar quién paga.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatCLP, priceQuote } from '../producerLanding.js'
import { SERVICE_FEE_LABEL, SERVICE_FEE_TAX_LABEL } from '../../../../netlify/lib/fees.mjs'
import { useDelayedAnnouncement, usePayerToggle } from '../../../composables/usePriceCalculator.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { THEATRE_CALC_PRICE } from './teatroLanding.js'

const payers = [
  { value: 'buyer', label: 'Paga el público' },
  { value: 'producer', label: 'Lo absorbe la compañía' },
]
const price = ref(THEATRE_CALC_PRICE.default)
const { payer, segButtons, onSegKey } = usePayerToggle(payers)
const quote = computed(() => priceQuote(price.value, payer.value))
const absorbed = computed(() => payer.value === 'producer')
const announced = useDelayedAnnouncement(
  quote,
  (q) => `Tu público paga ${formatCLP(q.buyerPays)}. La compañía recibe ${formatCLP(q.perTicket)}.`,
)

// T17: los dos montos finales interpolan (sin "reducir movimiento"); el texto final es siempre el exacto
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

const track = () => trackEvent('te_calc_change', { price: price.value, payer: payer.value })
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
  <div class="pc" data-testid="theatre-calculator">
    <p class="pc-kicker">Valor de la entrada</p>
    <p class="te-display pc-price" aria-hidden="true">{{ formatCLP(price) }}</p>
    <label class="lp-sr-only" for="te-calc-price">Valor de la entrada</label>
    <input
      id="te-calc-price"
      v-model.number="price"
      type="range"
      class="te-range pc-range"
      :min="THEATRE_CALC_PRICE.min"
      :max="THEATRE_CALC_PRICE.max"
      :step="THEATRE_CALC_PRICE.step"
      :aria-valuetext="formatCLP(price)"
      data-testid="theatre-calculator-range"
      @change="track"
    />
    <p class="pc-range-ends" aria-hidden="true"><span>{{ formatCLP(THEATRE_CALC_PRICE.min) }}</span><span>{{ formatCLP(THEATRE_CALC_PRICE.max) }}</span></p>

    <div class="pc-seg" role="radiogroup" aria-label="¿Quién paga el cargo?">
      <button
        v-for="(p, i) in payers"
        :key="p.value"
        :ref="(el) => (segButtons[i] = el)"
        type="button"
        role="radio"
        class="pc-seg-btn"
        :class="{ 'is-on': payer === p.value }"
        :aria-checked="payer === p.value ? 'true' : 'false'"
        :tabindex="payer === p.value ? 0 : -1"
        :data-testid="`theatre-calculator-payer-${p.value}`"
        @click="choosePayer(p.value)"
        @keydown="onPayerKey($event, i)"
      >{{ p.label }}</button>
    </div>

    <dl class="pc-cast">
      <div class="pc-line">
        <dt class="pc-role">Entrada</dt>
        <dd class="pc-amount"><span class="te-leader" aria-hidden="true"></span><span>{{ formatCLP(quote.price) }}</span></dd>
      </div>
      <div class="pc-line">
        <dt class="pc-role">{{ SERVICE_FEE_LABEL }}</dt>
        <dd class="pc-amount"><span class="te-leader" aria-hidden="true"></span><span>{{ absorbed ? '−' : '+' }} {{ formatCLP(quote.fee) }}</span></dd>
      </div>
      <div class="pc-line">
        <dt class="pc-role">{{ SERVICE_FEE_TAX_LABEL }}</dt>
        <dd class="pc-amount"><span class="te-leader" aria-hidden="true"></span><span>{{ absorbed ? '−' : '+' }} {{ formatCLP(quote.iva) }}</span></dd>
      </div>
      <div class="pc-line pc-pays">
        <dt class="pc-role">Tu público paga</dt>
        <dd class="pc-amount"><span class="te-leader" aria-hidden="true"></span><span class="te-display" data-testid="theatre-calculator-public">{{ formatCLP(shownPays) }}</span></dd>
      </div>
      <div class="pc-line pc-gets">
        <dt class="pc-role">La compañía recibe</dt>
        <dd class="pc-amount"><span class="te-leader" aria-hidden="true"></span><span class="te-display" data-testid="theatre-calculator-company">{{ formatCLP(shownGets) }}</span></dd>
      </div>
    </dl>
    <p class="pc-hint">{{ absorbed ? 'El cargo y su IVA se descuentan de la entrada.' : 'El cargo y su IVA los paga tu público.' }}</p>
    <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
  </div>
</template>

<style scoped>
.pc {
  color: var(--te-ink);
  text-align: left;
}
.pc-kicker {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  text-align: center;
  color: var(--te-oro-ink);
}
.pc-price {
  margin-top: 4px;
  font-size: 48px;
  line-height: 56px;
  text-align: center;
}
.pc-range {
  margin-top: 12px;
}
.pc-range-ends {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 12px;
  color: var(--te-ink-3);
}
.pc-seg {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  margin-top: 20px;
  padding: 4px;
  border-radius: 8px;
  background: var(--te-programa-2);
}
.pc-seg-btn {
  min-height: 44px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--te-ink-2);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition: background-color 200ms var(--ease-out), color 200ms var(--ease-out);
}
.pc-seg-btn.is-on {
  background: var(--te-ink);
  color: var(--te-programa);
}
.pc-seg-btn:focus-visible {
  outline: 2px solid var(--te-oro-ink);
  outline-offset: 2px;
}
.pc-cast {
  margin-top: 24px;
}
.pc-line {
  display: flex;
  align-items: baseline;
  padding: 8px 0;
}
.pc-role {
  flex: 0 1 auto;
  font-family: var(--te-display);
  font-size: 20px;
  line-height: 26px;
  font-weight: 500;
}
.pc-amount {
  flex: 1 1 auto;
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  font-size: 16px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pc-amount .te-leader {
  margin-inline: 10px;
}
.pc-pays {
  margin-top: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--te-oro-ink);
}
.pc-pays .pc-role,
.pc-pays .te-display {
  font-size: 24px;
  line-height: 30px;
}
.pc-gets {
  margin-top: 8px;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--brand-lime);
}
.pc-gets .pc-role {
  font-size: 22px;
}
.pc-gets .te-display {
  font-size: 28px;
  line-height: 34px;
  font-weight: 700;
}
.pc-gets .te-leader {
  --te-dot: rgba(22, 26, 36, 0.45);
}
.pc-hint {
  margin-top: 10px;
  font-size: 13px;
  color: var(--te-ink-3);
}
/* Mobile angosto: "La compañía recibe" y su monto no caben en una línea; el monto baja a la derecha */
@media (max-width: 479px) {
  .pc-gets {
    flex-wrap: wrap;
  }
  .pc-gets .pc-role {
    flex: 1 0 100%;
  }
  .pc-gets .te-leader {
    display: none;
  }
}
@media (min-width: 768px) {
  .pc-price {
    font-size: 64px;
    line-height: 72px;
  }
  .pc-role {
    font-size: 22px;
  }
  .pc-amount {
    font-size: 18px;
  }
  .pc-pays .pc-role,
  .pc-pays .te-display {
    font-size: 30px;
    line-height: 36px;
  }
  .pc-gets .te-display {
    font-size: 36px;
    line-height: 42px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pc-seg-btn {
    transition-duration: 1ms;
  }
}
</style>
