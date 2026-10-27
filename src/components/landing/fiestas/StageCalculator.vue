<script setup>
// Calculadora por etapas (SPEC_landing_fiestas §4.8): una fila por etapa (las cuatro de la escalera por defecto; "+ Etapa"
// hasta 4 y "×" hasta dejar 1) con su mini pulsera, precio (parseAmount, tope CALC_PRICE.inputMax) y cupo (1 a
// CALC_QTY.inputMax), quién paga el cargo y, por fila, cuánto paga tu público y cuánto recibes por entrada. Abajo, el
// desglose de una entrada de la etapa elegida con las etiquetas del checkout (SERVICE_FEE_LABEL, SERVICE_FEE_TAX_LABEL) y
// los totales si se vende todo. Misma fórmula que el checkout (priceQuote → computeFeeSplit de fees.mjs): $10.000 →
// $10.952 / $10.000 (absorbido $9.048); con 150/200/200/150 a $8.000/$10.000/$12.000/$15.000 recibes $7.850.000 (tu
// público paga $8.597.300) y, absorbido, $7.102.700. Comportamiento de las otras calculadoras (usePriceCalculator.js:
// radiogroup con flechas y resultado anunciado con pausa). Las filas, sus cuentas y "+ Etapa" / "×" son las de
// useTicketLines (compartido con la cotización de seminarios). Analítica: fi_calc_change {payer, stages} (con pausa).
import { computed, onBeforeUnmount, watch } from 'vue'
import { formatCLP } from '../producerLanding.js'
import { SERVICE_FEE_LABEL, SERVICE_FEE_TAX_LABEL } from '../../../../netlify/lib/fees.mjs'
import { useDelayedAnnouncement, usePayerToggle } from '../../../composables/usePriceCalculator.js'
import { useTicketLines } from '../../../composables/useTicketLines.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { CALC_STAGES_MAX, CALC_STAGES_MIN, defaultStages } from './fiestasLanding.js'

const payers = [
  { value: 'buyer', label: 'Paga el público' },
  { value: 'producer', label: 'Lo absorbo yo' },
]
const ALL = defaultStages(4)
const position = (name) => ALL.findIndex((s) => s.name === name)
const { payer, segButtons, onSegKey } = usePayerToggle(payers)
const absorbed = computed(() => payer.value === 'producer')
const { rows, picked, quotes, totalPublic, totalYou, pickedIndex, pickedRow, pickedQuote, signature, onPrice, onQty, blurRow, onPickKey, addLine, removeLine } =
  useTicketLines({
    lines: ALL.map((s) => ({ ...s, qty: s.capacity })),
    payer,
    max: CALC_STAGES_MAX,
    min: CALC_STAGES_MIN,
    order: (a, b) => position(a.name) - position(b.name),
  })

const state = computed(() => [totalYou.value, totalPublic.value])
const announced = useDelayedAnnouncement(state, ([you, pub]) => `Si se vende todo, tu público paga ${formatCLP(pub)}. Tú recibes ${formatCLP(you)}.`)

let trackTimer = null
watch([payer, signature], () => {
  clearTimeout(trackTimer)
  trackTimer = setTimeout(() => trackEvent('fi_calc_change', { payer: payer.value, stages: rows.value.length }), 800)
})
onBeforeUnmount(() => clearTimeout(trackTimer))

function addStage() {
  const used = new Set(rows.value.map((r) => r.name))
  const next = ALL.find((s) => !used.has(s.name)) ?? ALL[rows.value.length]
  addLine({ ...next, qty: next.capacity })
}
</script>

<template>
  <div class="sc" data-testid="party-calc">
    <div class="fi-seg sc-seg" role="radiogroup" aria-label="¿Quién paga el cargo?">
      <button
        v-for="(p, i) in payers"
        :key="p.value"
        :ref="(el) => (segButtons[i] = el)"
        type="button"
        role="radio"
        class="fi-seg-btn"
        :class="{ 'is-on': payer === p.value }"
        :aria-checked="payer === p.value ? 'true' : 'false'"
        :tabindex="payer === p.value ? 0 : -1"
        :data-testid="`party-calc-payer-${p.value}`"
        @click="payer = p.value"
        @keydown="onSegKey($event, i)"
      >{{ p.label }}</button>
    </div>

    <ul class="sc-rows">
      <li v-for="(row, i) in rows" :key="row.name" class="sc-row" :data-testid="`party-calc-row-${i}`">
        <div class="sc-name">
          <span class="fi-band fi-band-mini" :class="`fi-band--${row.color}`" style="--tilt: -4deg" aria-hidden="true">
            <span class="fi-band-strip"><span class="fi-band-half fi-band-a"></span><span class="fi-band-half fi-band-b"></span></span>
          </span>
          <span class="sc-name-text">{{ row.name }}</span>
          <button v-if="rows.length > CALC_STAGES_MIN" type="button" class="sc-remove" :aria-label="`Quitar ${row.name}`" @click="removeLine(i)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <label class="sc-field">
          <span class="sc-label">Precio</span>
          <span class="sc-input">
            <span aria-hidden="true">$</span>
            <input
              v-model="row.priceText"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              :aria-label="`Precio de ${row.name}`"
              :data-testid="`party-calc-price-${i}`"
              @input="onPrice(row, $event)"
              @blur="blurRow(row)"
            />
          </span>
        </label>
        <label class="sc-field">
          <span class="sc-label">Cupo</span>
          <span class="sc-input">
            <input
              v-model="row.qtyText"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              :aria-label="`Cupo de ${row.name}`"
              :data-testid="`party-calc-qty-${i}`"
              @input="onQty(row, $event)"
              @blur="blurRow(row)"
            />
          </span>
        </label>
        <p class="sc-out">
          <span>Tu público paga <strong class="fi-tabular" :data-testid="`party-calc-public-${i}`">{{ formatCLP(quotes[i].one.buyerPays) }}</strong></span>
          <span>Tú recibes <strong class="fi-tabular" :data-testid="`party-calc-you-${i}`">{{ formatCLP(quotes[i].one.perTicket) }}</strong></span>
        </p>
      </li>
    </ul>
    <button v-if="rows.length < CALC_STAGES_MAX" type="button" class="sc-add" data-testid="party-calc-add" @click="addStage">+ Etapa</button>

    <div class="sc-detail">
      <div class="sc-pick" role="radiogroup" aria-label="Desglose de una entrada de" @keydown="onPickKey">
        <button
          v-for="(row, i) in rows"
          :key="row.name"
          type="button"
          role="radio"
          class="sc-pick-btn"
          :class="{ 'is-on': pickedIndex === i }"
          :aria-checked="pickedIndex === i ? 'true' : 'false'"
          :tabindex="pickedIndex === i ? 0 : -1"
          @click="picked = i"
        >{{ row.name }}</button>
      </div>
      <dl class="sc-breakdown">
        <div><dt>Entrada ({{ pickedRow.name }})</dt><dd class="fi-tabular">{{ formatCLP(pickedQuote.price) }}</dd></div>
        <div><dt>{{ SERVICE_FEE_LABEL }}</dt><dd class="fi-tabular">{{ absorbed ? '−' : '+' }} {{ formatCLP(pickedQuote.fee) }}</dd></div>
        <div><dt>{{ SERVICE_FEE_TAX_LABEL }}</dt><dd class="fi-tabular">{{ absorbed ? '−' : '+' }} {{ formatCLP(pickedQuote.iva) }}</dd></div>
      </dl>
    </div>

    <dl class="sc-totals">
      <div class="sc-public">
        <dt>Si se vende todo, tu público paga</dt>
        <dd class="fi-tabular" data-testid="party-calc-total-public">{{ formatCLP(totalPublic) }}</dd>
      </div>
      <div class="sc-you">
        <dt>Tú recibes</dt>
        <dd class="fi-display fi-tabular" data-testid="party-calc-total-you">{{ formatCLP(totalYou) }}</dd>
      </div>
    </dl>
    <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
  </div>
</template>

<style scoped>
.sc {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border: 2px solid var(--fi-tinta);
  border-radius: 20px;
  background: #fff;
  box-shadow: 5px 5px 0 var(--fi-tinta);
}
.sc-seg {
  align-self: flex-start;
}
.sc-rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sc-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px 10px;
  padding: 12px;
  border: 2px solid var(--fi-tinta);
  border-radius: 16px;
  background: var(--fi-crema);
}
.sc-name {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
}
.sc-name-text {
  flex: 1 1 auto;
  white-space: nowrap;
}
.sc-remove {
  flex: 0 0 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  color: var(--fi-tinta);
  border: 2px solid var(--fi-tinta);
  border-radius: 50%;
  background: #fff;
  font: inherit;
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}
.sc-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.sc-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fi-text-3);
}
.sc-input {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  padding: 0 10px;
  border: 2px solid var(--fi-tinta);
  border-radius: 12px;
  background: #fff;
  font-weight: 700;
}
.sc-input:focus-within {
  outline: 3px solid var(--fi-cobalto);
  outline-offset: 2px;
}
.sc-input input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  outline: none;
}
.sc-out {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 14px;
  font-weight: 600;
}
.sc-out strong {
  font-weight: 700;
}
.sc-remove:focus-visible,
.sc-add:focus-visible,
.sc-pick-btn:focus-visible {
  outline: 3px solid var(--fi-cobalto);
  outline-offset: 2px;
}
.sc-add {
  align-self: flex-start;
  min-height: 44px;
  padding: 0 16px;
  border: 2px dashed var(--fi-tinta);
  border-radius: 999px;
  background: none;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.sc-detail {
  padding-top: 12px;
  border-top: 2px dashed var(--border-strong);
}
.sc-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sc-pick-btn {
  min-height: 36px;
  padding: 0 12px;
  border: 2px solid var(--fi-tinta);
  border-radius: 999px;
  background: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.sc-pick-btn.is-on {
  background: var(--fi-tinta);
  color: var(--fi-crema);
}
.sc-breakdown {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  font-size: 14px;
}
.sc-breakdown div,
.sc-totals div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.sc-totals {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sc-public dt {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.sc-public dd {
  font-weight: 700;
}
.sc-you {
  flex-direction: column;
  padding: 16px 18px;
  border: 2px solid var(--fi-tinta);
  border-radius: 16px;
  background: var(--brand-lime);
  color: var(--fi-tinta);
}
.sc-you dt {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.sc-you dd {
  font-size: 40px;
  line-height: 44px;
}
@media (min-width: 768px) {
  .sc {
    padding: 24px;
  }
  .sc-row {
    grid-template-columns: minmax(190px, 1.3fr) minmax(0, 1fr) minmax(0, 0.7fr) minmax(0, 1.3fr);
    align-items: end;
    padding: 12px 14px;
  }
  .sc-name {
    grid-column: auto;
    align-self: center;
  }
  .sc-out {
    grid-column: auto;
    flex-direction: column;
    align-self: center;
    font-size: 13px;
  }
  .sc-you dd {
    font-size: 56px;
    line-height: 58px;
  }
}
</style>
