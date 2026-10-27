<script setup>
// La cotización (SPEC_landing_seminarios §4.8): un documento blanco con forma de cotización ("COTIZACIÓN N° 0001 ·
// EJEMPLO", el nombre de la jornada y la fecha de hoy) con una línea por tipo de entrada (las cuatro del congreso de §4.3
// por defecto; "+ Línea" hasta 5 y "×" hasta dejar 1), precio (parseAmount, tope CALC_PRICE.inputMax) y cantidad (1 a
// CALC_QTY.inputMax), y por línea lo que paga tu público por entrada y lo que recibes en total. Una línea fija de cierre:
// las cortesías no son venta. Quién paga el cargo (usePayerToggle), el desglose de una entrada de la línea elegida con
// las etiquetas del checkout (SERVICE_FEE_LABEL, SERVICE_FEE_TAX_LABEL) y los totales si se vende todo. Misma fórmula que
// el checkout (useTicketLines → priceQuote → computeFeeSplit de fees.mjs): $60.000 → $65.712 / $60.000 (absorbido
// $54.288); con las cuatro líneas (260 entradas) recibes $11.800.000, tu público paga $12.923.360 y, absorbido,
// $10.676.640. Mobile: cada línea como card apilada. C14: una línea nueva entra con clip-path horizontal.
// Analítica: se_calc_change {payer, lines} (con pausa).
import { computed, onBeforeUnmount, watch } from 'vue'
import { formatCLP } from '../producerLanding.js'
import { SERVICE_FEE_LABEL, SERVICE_FEE_TAX_LABEL } from '../../../../netlify/lib/fees.mjs'
import { useDelayedAnnouncement, usePayerToggle } from '../../../composables/usePriceCalculator.js'
import { useTicketLines } from '../../../composables/useTicketLines.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { QUOTE_EXTRA_LINES, QUOTE_LINES_MAX, QUOTE_LINES_MIN, SEMINAR_NAME, quoteLines } from './seminariosLanding.js'

const props = defineProps({
  /** Fecha de la cotización (la del build: "Mar 27 oct") */
  today: { type: String, required: true },
})

const payers = [
  { value: 'buyer', label: 'Paga el público' },
  { value: 'producer', label: 'Lo absorbo yo' },
]
const { payer, segButtons, onSegKey } = usePayerToggle(payers)
const absorbed = computed(() => payer.value === 'producer')
const { rows, picked, quotes, totalPublic, totalYou, pickedIndex, pickedRow, pickedQuote, signature, onPrice, onQty, blurRow, onPickKey, addLine, removeLine } =
  useTicketLines({ lines: quoteLines(), payer, max: QUOTE_LINES_MAX, min: QUOTE_LINES_MIN })
const totalQty = computed(() => rows.value.reduce((s, r) => s + r.qty, 0))

const state = computed(() => [totalYou.value, totalPublic.value])
const announced = useDelayedAnnouncement(state, ([you, pub]) => `Si se vende todo, tu público paga ${formatCLP(pub)}. Tú recibes ${formatCLP(you)}.`)

let trackTimer = null
watch([payer, signature], () => {
  clearTimeout(trackTimer)
  trackTimer = setTimeout(() => trackEvent('se_calc_change', { payer: payer.value, lines: rows.value.length }), 800)
})
onBeforeUnmount(() => clearTimeout(trackTimer))

function addNext() {
  const used = new Set(rows.value.map((r) => r.id))
  addLine([...quoteLines(), ...QUOTE_EXTRA_LINES].find((l) => !used.has(l.id)))
}
</script>

<template>
  <div class="qc" data-testid="seminar-quote">
    <div class="qc-head">
      <p class="se-meta qc-doc">Cotización N° 0001 · ejemplo</p>
      <p class="se-meta qc-doc">{{ SEMINAR_NAME }} · {{ props.today }}</p>
    </div>

    <div class="se-seg qc-seg" role="radiogroup" aria-label="¿Quién paga el cargo?">
      <button
        v-for="(p, i) in payers"
        :key="p.value"
        :ref="(el) => (segButtons[i] = el)"
        type="button"
        role="radio"
        class="se-seg-btn"
        :class="{ 'is-on': payer === p.value }"
        :aria-checked="payer === p.value ? 'true' : 'false'"
        :tabindex="payer === p.value ? 0 : -1"
        :data-testid="`seminar-quote-payer-${p.value}`"
        @click="payer = p.value"
        @keydown="onSegKey($event, i)"
      >{{ p.label }}</button>
    </div>

    <div class="qc-table" role="table" aria-label="Líneas de la cotización">
      <div class="qc-tr qc-th" role="row">
        <span class="se-meta" role="columnheader">Tipo de entrada</span>
        <span class="se-meta" role="columnheader">Precio</span>
        <span class="se-meta" role="columnheader">Cantidad</span>
        <span class="se-meta qc-r" role="columnheader">Tu público paga</span>
        <span class="se-meta qc-r" role="columnheader">Tú recibes</span>
      </div>
      <TransitionGroup name="qc-line">
        <div v-for="(row, i) in rows" :key="row.id" class="qc-tr qc-line" role="row" :data-testid="`seminar-quote-row-${i}`">
          <span class="qc-name" role="cell">
            {{ row.name }}
            <button v-if="rows.length > QUOTE_LINES_MIN" type="button" class="qc-remove se-focus" :aria-label="`Quitar ${row.name}`" @click="removeLine(i)">×</button>
          </span>
          <label class="qc-field" role="cell">
            <span class="se-meta qc-label">Precio</span>
            <span class="qc-input">
              <span aria-hidden="true">$</span>
              <input
                v-model="row.priceText"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                :aria-label="`Precio de ${row.name}`"
                :data-testid="`seminar-quote-price-${i}`"
                @input="onPrice(row, $event)"
                @blur="blurRow(row)"
              />
            </span>
          </label>
          <label class="qc-field" role="cell">
            <span class="se-meta qc-label">Cantidad</span>
            <span class="qc-input">
              <input
                v-model="row.qtyText"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                :aria-label="`Cantidad de ${row.name}`"
                :data-testid="`seminar-quote-qty-${i}`"
                @input="onQty(row, $event)"
                @blur="blurRow(row)"
              />
            </span>
          </label>
          <span class="qc-out qc-r" role="cell">
            <span class="se-meta qc-label">Tu público paga</span>
            <span class="se-tabular" :data-testid="`seminar-quote-public-${i}`">{{ formatCLP(quotes[i].one.buyerPays) }}</span>
          </span>
          <span class="qc-out qc-r" role="cell">
            <span class="se-meta qc-label">Tú recibes</span>
            <strong class="se-tabular" :data-testid="`seminar-quote-you-${i}`">{{ formatCLP(quotes[i].all.total) }}</strong>
          </span>
        </div>
      </TransitionGroup>
      <div class="qc-tr qc-courtesy" role="row">
        <span role="cell">Cortesías (expositores y prensa) · no son venta</span>
        <span class="qc-r se-tabular" role="cell">$0</span>
      </div>
    </div>
    <button v-if="rows.length < QUOTE_LINES_MAX" type="button" class="qc-add se-focus" data-testid="seminar-quote-add" @click="addNext">+ Línea</button>

    <div class="qc-detail">
      <div class="qc-pick" role="radiogroup" aria-label="Desglose de una entrada de" @keydown="onPickKey">
        <button
          v-for="(row, i) in rows"
          :key="row.id"
          type="button"
          role="radio"
          class="qc-pick-btn se-focus"
          :class="{ 'is-on': pickedIndex === i }"
          :aria-checked="pickedIndex === i ? 'true' : 'false'"
          :tabindex="pickedIndex === i ? 0 : -1"
          @click="picked = i"
        >{{ row.name }}</button>
      </div>
      <dl class="qc-breakdown">
        <div><dt>Entrada ({{ pickedRow.name }})</dt><dd class="se-tabular">{{ formatCLP(pickedQuote.price) }}</dd></div>
        <div><dt>{{ SERVICE_FEE_LABEL }}</dt><dd class="se-tabular">{{ absorbed ? '−' : '+' }} {{ formatCLP(pickedQuote.fee) }}</dd></div>
        <div><dt>{{ SERVICE_FEE_TAX_LABEL }}</dt><dd class="se-tabular">{{ absorbed ? '−' : '+' }} {{ formatCLP(pickedQuote.iva) }}</dd></div>
      </dl>
    </div>

    <dl class="qc-totals">
      <div class="qc-public">
        <dt class="se-meta">Si se vende todo ({{ totalQty.toLocaleString('es-CL') }} entradas), tu público paga</dt>
        <dd class="se-tabular" data-testid="seminar-quote-total-public">{{ formatCLP(totalPublic) }}</dd>
      </div>
      <div class="qc-you">
        <dt class="se-meta">Tú recibes</dt>
        <dd class="se-display se-tabular" data-testid="seminar-quote-total-you">{{ formatCLP(totalYou) }}</dd>
      </div>
    </dl>
    <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
  </div>
</template>

<style scoped>
.qc {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border: 1px solid var(--se-grafito);
  border-radius: 4px;
  background: #ffffff;
}
.qc-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 16px;
  padding-bottom: 10px;
  border-bottom: 3px double var(--se-grafito);
}
.qc-doc {
  color: var(--se-grafito);
}
.qc-seg {
  align-self: flex-start;
}
.qc-table {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.qc-th {
  display: none !important;
}
.qc-tr {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px 10px;
}
.qc-line {
  padding: 12px;
  border: 1px solid var(--se-filete);
  border-radius: 4px;
}
.qc-name {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-family: var(--se-font);
  font-weight: 700;
}
.qc-remove {
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  border: 1px solid var(--se-filete);
  border-radius: 4px;
  background: #ffffff;
  font: inherit;
  font-size: 18px;
  cursor: pointer;
}
.qc-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.qc-input {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  padding: 0 10px;
  border: 1px solid var(--se-grafito);
  border-radius: 4px;
  background: #ffffff;
  font-family: var(--se-font);
  font-weight: 600;
}
.qc-input:focus-within {
  outline: 3px solid var(--se-cordon-ink);
  outline-offset: 2px;
}
.qc-input input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  outline: none;
}
.qc-out {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 15px;
}
.qc-courtesy {
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--se-text-3);
}
.qc-r {
  text-align: right;
}
.qc-add {
  align-self: flex-start;
  min-height: 44px;
  padding: 0 16px;
  border: 1px dashed var(--se-grafito);
  border-radius: 4px;
  background: none;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.qc-detail {
  padding-top: 12px;
  border-top: 1px solid var(--se-filete);
}
.qc-pick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.qc-pick-btn {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--se-grafito);
  border-radius: 2px;
  background: #ffffff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.qc-pick-btn.is-on {
  background: var(--se-grafito);
  color: #ffffff;
}
.qc-breakdown {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  font-size: 14px;
}
.qc-breakdown div,
.qc-totals div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.qc-totals {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.qc-public dt {
  max-width: 70%;
}
.qc-public dd {
  font-weight: 700;
}
.qc-you {
  flex-direction: column;
  padding: 16px 18px;
  border-radius: 4px;
  background: var(--brand-lime);
  color: var(--se-grafito);
}
.qc-you dt {
  color: var(--se-grafito);
}
.qc-you dd {
  font-size: 36px;
  line-height: 40px;
}
.qc-line-enter-active {
  transition: clip-path 320ms var(--se-ease);
}
.qc-line-enter-from {
  clip-path: inset(0 100% 0 0);
}
.qc-line-leave-active {
  display: none;
}
@media (min-width: 768px) {
  .qc {
    padding: 24px;
  }
  .qc-th {
    display: grid !important;
    padding: 0 0 6px;
    border-bottom: 1px solid var(--se-grafito);
  }
  .qc-tr {
    grid-template-columns: minmax(150px, 1.4fr) minmax(0, 1fr) minmax(0, 0.7fr) minmax(0, 0.9fr) minmax(0, 1.1fr);
    align-items: center;
  }
  .qc-line {
    padding: 4px 0 10px;
    border: 0;
    border-bottom: 1px solid var(--se-filete);
    border-radius: 0;
  }
  .qc-name {
    grid-column: auto;
  }
  .qc-label {
    display: none;
  }
  .qc-courtesy {
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 4px 0;
  }
  .qc-you dd {
    font-size: 56px;
    line-height: 58px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .qc-line-enter-active {
    transition: none;
  }
}
</style>
