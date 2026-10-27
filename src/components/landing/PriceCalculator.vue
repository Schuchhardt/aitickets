<script setup>
// Calculadora de la landing de productores (SPEC_landing_productores §5.3). Los montos salen de fees.mjs (priceQuote →
// computeFeeSplit), la misma regla del checkout: cargo 8% redondeado a pesos + IVA 19% del cargo, que paga el
// comprador o absorbe el productor. Ej.: $10.000 → comprador $10.952 / recibes $10.000; absorbido → recibes $9.048.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AnimatedNumber from '../event/AnimatedNumber.vue'
import { IVA_PERCENT_LABEL, SERVICE_FEE_PERCENT_LABEL } from '../../../netlify/lib/fees.mjs'
import { CALC_PRICE, CALC_QTY, formatCLP, parseAmount, priceQuote } from './producerLanding.js'

const price = ref(CALC_PRICE.default)
const priceText = ref(CALC_PRICE.default.toLocaleString('es-CL'))
const qty = ref(CALC_QTY.default)
const payer = ref('buyer')
const breakdownOpen = ref(false)

const quote = computed(() => priceQuote(price.value, payer.value, qty.value))
const payers = [
  { value: 'buyer', label: 'El comprador' },
  { value: 'producer', label: 'Yo lo absorbo' },
]

function onPriceText(e) {
  const n = parseAmount(e.target.value, CALC_PRICE.inputMax)
  price.value = n
  priceText.value = e.target.value.replace(/\D/g, '') ? n.toLocaleString('es-CL') : ''
}
function onPriceRange(e) {
  price.value = Number(e.target.value)
  priceText.value = price.value.toLocaleString('es-CL')
}
function onQtyText(e) {
  qty.value = parseAmount(e.target.value, CALC_QTY.inputMax)
}
function onQtyRange(e) {
  qty.value = Number(e.target.value)
}

// Segmented control como radiogroup: flechas cambian la opción (y el foco)
const segButtons = ref([])
function onSegKey(e, i) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
  e.preventDefault()
  const next = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + payers.length) % payers.length
  payer.value = payers[next].value
  segButtons.value[next]?.focus()
}

// Total anunciado a lectores de pantalla con 400 ms de pausa (no a cada paso del slider)
const announced = ref('')
let announceTimer = null
watch(
  () => quote.value.total,
  (total) => {
    clearTimeout(announceTimer)
    announceTimer = setTimeout(() => {
      announced.value = `Tú recibes en total ${formatCLP(total)}`
    }, 400)
  },
)
onBeforeUnmount(() => clearTimeout(announceTimer))
</script>

<template>
  <div class="pc lp-card" data-testid="price-calculator">
    <div class="pc-inputs">
      <div>
        <label for="pc-price" class="pc-label">Precio de tu entrada</label>
        <div class="pc-price-row">
          <div class="pc-money">
            <span class="pc-prefix" aria-hidden="true">$</span>
            <input
              id="pc-price"
              class="ev-field pc-number"
              inputmode="numeric"
              autocomplete="off"
              :value="priceText"
              data-testid="price-calculator-price"
              @input="onPriceText"
            />
          </div>
          <input
            type="range"
            class="pc-range"
            :min="CALC_PRICE.min"
            :max="CALC_PRICE.max"
            :step="CALC_PRICE.step"
            :value="Math.min(Math.max(price, CALC_PRICE.min), CALC_PRICE.max)"
            aria-label="Precio de tu entrada"
            :aria-valuetext="formatCLP(price)"
            @input="onPriceRange"
          />
        </div>
      </div>

      <div>
        <div class="pc-label-row">
          <label for="pc-qty" class="pc-label">Entradas que esperas vender</label>
          <input
            class="ev-field pc-qty-number"
            inputmode="numeric"
            autocomplete="off"
            aria-label="Entradas que esperas vender (número)"
            :value="qty.toLocaleString('es-CL')"
            data-testid="price-calculator-qty"
            @change="onQtyText"
          />
        </div>
        <input
          id="pc-qty"
          type="range"
          class="pc-range pc-range-full"
          :min="CALC_QTY.min"
          :max="CALC_QTY.max"
          :step="CALC_QTY.step"
          :value="Math.min(Math.max(qty, CALC_QTY.min), CALC_QTY.max)"
          :aria-valuetext="`${qty.toLocaleString('es-CL')} entradas`"
          @input="onQtyRange"
        />
      </div>

      <div>
        <p id="pc-payer-label" class="pc-label">¿Quién paga el cargo?</p>
        <div class="pc-seg" role="radiogroup" aria-labelledby="pc-payer-label">
          <span class="pc-seg-thumb" :class="{ 'is-right': payer === 'producer' }" aria-hidden="true"></span>
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
            :data-testid="`price-calculator-payer-${p.value}`"
            @click="payer = p.value"
            @keydown="onSegKey($event, i)"
          >{{ p.label }}</button>
        </div>
      </div>
    </div>

    <div class="pc-results">
      <div class="pc-line"><span>El comprador paga</span><strong class="ev-tabular" data-testid="price-calculator-buyer">{{ formatCLP(quote.buyerPays) }}</strong></div>
      <div class="pc-line"><span>Tú recibes por entrada</span><strong class="ev-tabular" data-testid="price-calculator-per-ticket">{{ formatCLP(quote.perTicket) }}</strong></div>
      <div class="pc-total">
        <p class="pc-total-label">Tú recibes en total</p>
        <p class="pc-total-value" data-testid="price-calculator-total"><AnimatedNumber :value="quote.total" /></p>
        <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
      </div>

      <button
        type="button"
        class="pc-toggle"
        :aria-expanded="breakdownOpen ? 'true' : 'false'"
        aria-controls="pc-breakdown"
        @click="breakdownOpen = !breakdownOpen"
      >
        {{ breakdownOpen ? 'Ocultar detalle' : 'Ver detalle' }}
        <svg class="pc-chev" :class="{ 'is-open': breakdownOpen }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <!-- inert mientras está cerrado: fuera del orden de tabulación y del árbol de accesibilidad -->
      <div id="pc-breakdown" class="ev-collapse" :class="{ 'is-open': breakdownOpen }" :inert="!breakdownOpen">
        <div>
          <dl class="pc-breakdown ev-tabular">
            <div><dt>Entrada</dt><dd>{{ formatCLP(quote.price) }}</dd></div>
            <div><dt>Cargo por servicio ({{ SERVICE_FEE_PERCENT_LABEL }})</dt><dd>{{ formatCLP(quote.fee) }}</dd></div>
            <div><dt>IVA del cargo ({{ IVA_PERCENT_LABEL }})</dt><dd>{{ formatCLP(quote.iva) }}</dd></div>
            <div class="pc-breakdown-strong">
              <dt>{{ payer === 'buyer' ? 'Paga el comprador' : 'Recibes (cargo absorbido)' }}</dt>
              <dd>{{ formatCLP(payer === 'buyer' ? quote.buyerPays : quote.perTicket) }}</dd>
            </div>
          </dl>
        </div>
      </div>

      <p class="pc-guarantees">Sin mensualidad · Sin permanencia · Sin costos fijos</p>
    </div>
  </div>
</template>

<style scoped>
.pc {
  display: grid;
  overflow: hidden;
  border-radius: var(--r-xl);
}
.pc-inputs {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.pc-results {
  padding: 20px;
  background: var(--surface-1);
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.pc-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}
.pc-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.pc-price-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 10px;
}
.pc-money {
  position: relative;
  width: 100%;
}
.pc-prefix {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-2);
}
.pc-number {
  padding-left: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pc-qty-number {
  width: 96px;
  height: 40px;
  text-align: right;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pc-range {
  width: 100%;
  height: 28px;
  margin: 0;
  accent-color: var(--brand-ink);
  cursor: pointer;
}
.pc-range-full {
  margin-top: 10px;
}
.pc-range:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 4px;
  border-radius: 4px;
}
.pc-seg {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 10px;
  padding: 4px;
  border-radius: var(--r-md);
  background: var(--surface-1);
}
.pc-seg-thumb {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc(50% - 4px);
  border-radius: 9px;
  background: var(--surface-0);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  transition: transform var(--dur-2) var(--ease-in-out);
}
.pc-seg-thumb.is-right {
  transform: translateX(100%);
}
.pc-seg-btn {
  position: relative;
  height: 44px;
  border: 0;
  border-radius: 9px;
  background: none;
  font-family: inherit;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-2);
  cursor: pointer;
  transition: color var(--dur-2);
}
.pc-seg-btn.is-on {
  color: var(--text-1);
}
.pc-seg-btn:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: -2px;
}
.pc-line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 15px;
  color: var(--text-2);
}
.pc-line strong {
  font-weight: 600;
  color: var(--text-1);
}
.pc-total {
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.pc-total-label {
  font-size: 14px;
  color: var(--text-2);
}
.pc-total-value {
  margin-top: 4px;
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 34px;
  line-height: 40px;
  font-weight: 700;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}
.pc-toggle {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  font-family: inherit;
  font-size: 14px;
  color: var(--text-2);
  cursor: pointer;
  border-radius: 4px;
}
.pc-toggle:hover {
  color: var(--text-1);
}
.pc-toggle:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}
.pc-chev {
  transition: transform var(--dur-2) var(--ease-in-out);
}
.pc-chev.is-open {
  transform: rotate(180deg);
}
.pc-breakdown {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
  color: var(--text-2);
}
.pc-breakdown > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.pc-breakdown-strong {
  color: var(--text-1);
}
.pc-guarantees {
  margin-top: auto;
  padding-top: 8px;
  font-size: 13px;
  color: var(--text-3);
}
@media (min-width: 640px) {
  .pc-price-row {
    flex-direction: row;
    align-items: center;
    gap: 16px;
  }
  .pc-money {
    width: 150px;
    flex: 0 0 auto;
  }
}
@media (min-width: 900px) {
  .pc {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  }
  .pc-inputs,
  .pc-results {
    padding: 36px;
  }
  .pc-inputs {
    gap: 28px;
  }
  .pc-results {
    border-top: 0;
    border-left: 1px solid var(--border);
  }
  .pc-total-value {
    font-size: 40px;
    line-height: 48px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pc-seg-thumb,
  .pc-chev {
    transition-duration: 1ms;
  }
}
</style>
