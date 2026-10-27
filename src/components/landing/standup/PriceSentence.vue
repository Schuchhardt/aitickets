<script setup>
// Precio de la landing de stand-up (SPEC_landing_standup §4.7): el H2 dice cuánto recibes y cuánto paga tu público y
// cambia en vivo con la calculadora. Misma fórmula que la calculadora de /organizadores (priceQuote → computeFeeSplit
// de fees.mjs, la regla del checkout): cargo de SERVICE_FEE_PERCENT_LABEL redondeado a pesos + IVA del cargo, que paga
// el comprador o absorbe el productor. Ej.: $10.000 → el público paga $10.952 / recibes $10.000; absorbido → $9.048.
// La bajada y la línea de garantías llegan armadas desde la página (con los textos de fees.mjs, legal.mjs y
// producerFaq.ts). Comparte con la calculadora principal la fórmula (priceQuote) y el comportamiento
// (usePriceCalculator.js: radiogroup con flechas y resultado anunciado con 400 ms de pausa); cambian el rango del slider
// (§4.7), los textos y el diseño, por eso no es el mismo componente.
import { computed, ref } from 'vue'
import { SERVICE_FEE_LABEL, SERVICE_FEE_TAX_LABEL } from '../../../../netlify/lib/fees.mjs'
import { formatCLP, priceQuote } from '../producerLanding.js'
import { useDelayedAnnouncement, usePayerToggle } from '../../../composables/usePriceCalculator.js'

const props = defineProps({
  lead: { type: String, required: true },
  guarantees: { type: Array, required: true },
})

/** Rango del slider de esta página (§4.7) */
const PRICE = { min: 1000, max: 60000, step: 500, default: 10000 }

const payers = [
  { value: 'buyer', label: 'Paga el público' },
  { value: 'producer', label: 'Lo absorbo yo' },
]
const price = ref(PRICE.default)
const { payer, segButtons, onSegKey } = usePayerToggle(payers)
const quote = computed(() => priceQuote(price.value, payer.value))
const sign = computed(() => (payer.value === 'buyer' ? '+' : '−'))

// El H2 cambia con cada paso del slider: a los lectores de pantalla se les anuncia solo el valor final
const announced = useDelayedAnnouncement(quote, (q) => `Tú recibes ${formatCLP(q.perTicket)}. Tu público paga ${formatCLP(q.buyerPays)}.`)
</script>

<template>
  <div class="ps" data-testid="standup-price">
    <div class="ps-copy">
      <p class="ps-eyebrow">Precio</p>
      <h2 id="precio-title" class="ps-title">
        Tú recibes <span class="ev-tabular">{{ formatCLP(quote.perTicket) }}</span>.
        <span class="ps-serif">Tu público paga <span class="ev-tabular">{{ formatCLP(quote.buyerPays) }}</span>.</span>
      </h2>
      <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
      <p class="ps-lead">{{ props.lead }}</p>
      <ul class="ps-guarantees">
        <li v-for="g in props.guarantees" :key="g">{{ g }}</li>
      </ul>
    </div>

    <div class="ps-calc">
      <div>
        <p class="ps-row"><label for="ps-price">Precio de tu entrada</label><span class="ev-tabular">{{ formatCLP(price) }}</span></p>
        <input
          id="ps-price"
          v-model.number="price"
          type="range"
          class="su-range ps-range"
          :min="PRICE.min"
          :max="PRICE.max"
          :step="PRICE.step"
          :aria-valuetext="formatCLP(price)"
          data-testid="standup-price-range"
        />
      </div>

      <div class="ps-seg" role="radiogroup" aria-label="¿Quién paga el cargo?">
        <span class="ps-seg-thumb" :class="{ 'is-right': payer === 'producer' }" aria-hidden="true"></span>
        <button
          v-for="(p, i) in payers"
          :key="p.value"
          :ref="(el) => (segButtons[i] = el)"
          type="button"
          role="radio"
          class="ps-seg-btn"
          :class="{ 'is-on': payer === p.value }"
          :aria-checked="payer === p.value ? 'true' : 'false'"
          :tabindex="payer === p.value ? 0 : -1"
          :data-testid="`standup-price-payer-${p.value}`"
          @click="payer = p.value"
          @keydown="onSegKey($event, i)"
        >{{ p.label }}</button>
      </div>

      <dl class="ps-breakdown ev-tabular">
        <div><dt>Entrada</dt><dd>{{ formatCLP(quote.price) }}</dd></div>
        <div><dt>{{ SERVICE_FEE_LABEL }}</dt><dd>{{ sign }}{{ formatCLP(quote.fee) }}</dd></div>
        <div><dt>{{ SERVICE_FEE_TAX_LABEL }}</dt><dd>{{ sign }}{{ formatCLP(quote.iva) }}</dd></div>
        <div class="ps-total"><dt>Tú recibes por entrada</dt><dd>{{ formatCLP(quote.perTicket) }}</dd></div>
      </dl>
      <a href="/precios" class="ps-more" data-cta="pricing" data-section="pricing">Ver precios en detalle <span aria-hidden="true">→</span></a>
    </div>
  </div>
</template>

<style scoped>
.ps {
  display: grid;
  gap: 40px;
  color: var(--sb-ground);
}
.ps-eyebrow {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #6b6158;
}
.ps-title {
  margin-top: 14px;
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 30px;
  font-weight: 700;
  line-height: 35px;
  letter-spacing: -0.03em;
}
.ps-serif {
  display: block;
  font-family: "Fraunces", Georgia, serif;
  font-style: italic;
  font-weight: 400;
  letter-spacing: -0.01em;
  color: var(--sb-ink-3);
}
.ps-lead {
  max-width: 560px;
  margin-top: 18px;
  font-size: 16px;
  line-height: 25px;
  color: var(--sb-ink-2);
}
.ps-guarantees {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin-top: 24px;
  font-size: 15px;
  font-weight: 500;
}
.ps-calc {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 24px;
  border-radius: 24px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(14, 11, 9, 0.06), 0 24px 60px rgba(14, 11, 9, 0.1);
}
.ps-row {
  display: flex;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 600;
}
.ps-range {
  margin-top: 10px;
}
.ps-seg {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 4px;
  border-radius: 999px;
  background: var(--sb-paper);
}
.ps-seg-thumb {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc(50% - 4px);
  border-radius: 999px;
  background: var(--sb-ground);
  transition: transform 220ms var(--ease-in-out);
}
.ps-seg-thumb.is-right {
  transform: translateX(100%);
}
.ps-seg-btn {
  position: relative;
  min-height: 44px;
  border: 0;
  border-radius: 999px;
  background: none;
  font-family: inherit;
  font-size: 15px;
  font-weight: 500;
  color: var(--sb-ink-2);
  cursor: pointer;
  transition: color 220ms var(--ease-in-out);
}
.ps-seg-btn.is-on {
  color: var(--sb-text-1);
}
.ps-seg-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px #fff, 0 0 0 5px var(--sb-ground);
}
.ps-breakdown {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 20px;
  border-top: 1px solid rgba(14, 11, 9, 0.1);
  font-size: 15px;
}
.ps-breakdown div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.ps-breakdown dt {
  color: #6b6158;
}
.ps-total {
  margin-top: 6px;
  font-weight: 600;
}
.ps-total dt {
  color: var(--sb-ground);
}
.ps-more {
  align-self: flex-start;
  font-size: 15px;
  font-weight: 500;
  color: var(--sb-ground);
  border-radius: 4px;
}
.ps-more:focus-visible {
  outline: 2px solid var(--sb-ground);
  outline-offset: 2px;
}
@media (min-width: 1024px) {
  .ps {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    align-items: center;
    gap: 80px;
  }
  .ps-title {
    margin-top: 18px;
    font-size: 52px;
    line-height: 58px;
  }
  .ps-lead {
    margin-top: 24px;
    font-size: 18px;
    line-height: 29px;
  }
  .ps-guarantees {
    margin-top: 32px;
  }
  .ps-calc {
    padding: 32px;
    border-radius: 28px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ps-seg-thumb,
  .ps-seg-btn {
    transition-duration: 1ms;
  }
}
</style>
