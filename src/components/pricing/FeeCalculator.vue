<script setup>
// Calculadora de /precios. Usa exactamente la misma regla que el checkout (netlify/lib/fees.mjs vía
// Reservation/pricing.js): el comprador paga precio + cargo por servicio (8% del subtotal, redondeado a
// pesos) + IVA del cargo (19% del cargo, redondeado), y el productor recibe el 100% del precio de las
// entradas (0% de comisión para el productor). Ej.: $10.000 → cargo $800 + IVA $152 = $10.952.
// "Comparado con Passline": 15% sobre el precio, 13% si la entrada vale menos de $15.000
// (src/data/competitor-fees.mjs).
import { computed, ref } from 'vue'
import { IVA_PERCENT_LABEL, SERVICE_FEE_PERCENT_LABEL, computeTotals, formatCLP } from '../Reservation/pricing.js'
import { PASSLINE_BUYER_FEE, passlineBuyerTotal } from '../../data/competitor-fees.mjs'

const MAX_PRICE = 10_000_000
const MAX_QTY = 100_000

const priceInput = ref('10000')
const quantityInput = ref('100')

const toInt = (value, max) => {
  const n = Math.round(Number(String(value).replace(/[^\d]/g, '')))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, max)
}

const price = computed(() => toInt(priceInput.value, MAX_PRICE))
const quantity = computed(() => toInt(quantityInput.value, MAX_QTY))

// Por entrada (lo que ve un comprador que compra 1) y por el total vendido
const perTicket = computed(() => computeTotals([{ total: price.value, quantity: 1 }]))
const totals = computed(() => computeTotals([{ total: price.value * quantity.value, quantity: quantity.value }]))

const isFree = computed(() => price.value === 0)

// Comparación por entrada con Passline (mismo precio de entrada)
const passline = computed(() => passlineBuyerTotal(price.value))
const passlinePercent = computed(() => `${Math.round(passline.value.rate * 100)}%`)
const savingsPerTicket = computed(() => Math.max(0, passline.value.total - perTicket.value.total))
const savingsPer100 = computed(() => savingsPerTicket.value * 100)
</script>

<template>
  <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-lg sm:p-8">
    <h2 class="text-xl font-bold text-gray-900">Calcula cuánto recibes</h2>
    <p class="mt-1 text-sm text-gray-600">Ingresa el precio de tu entrada y cuántas esperas vender.</p>

    <div class="mt-6 grid gap-4 sm:grid-cols-2">
      <div>
        <label for="fee-calc-price" class="block text-sm font-medium text-gray-700">Precio de la entrada (CLP)</label>
        <input
          id="fee-calc-price"
          v-model="priceInput"
          inputmode="numeric"
          autocomplete="off"
          data-testid="fee-calc-input"
          class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-lg focus:border-lime-500 focus:outline-none focus:ring-2 focus:ring-lime-200"
        />
      </div>
      <div>
        <label for="fee-calc-qty" class="block text-sm font-medium text-gray-700">Entradas vendidas</label>
        <input
          id="fee-calc-qty"
          v-model="quantityInput"
          inputmode="numeric"
          autocomplete="off"
          data-testid="fee-calc-qty"
          class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-lg focus:border-lime-500 focus:outline-none focus:ring-2 focus:ring-lime-200"
        />
      </div>
    </div>

    <div
      class="mt-6 space-y-3"
      data-testid="fee-calc-result"
      :data-price="price"
      :data-fee="perTicket.feeNet"
      :data-fee-iva="perTicket.feeIva"
      :data-buyer-total="perTicket.total"
      :data-producer-total="totals.subtotal"
      aria-live="polite"
    >
      <div class="rounded-xl bg-gray-50 p-4">
        <p class="text-sm font-semibold uppercase tracking-wide text-gray-500">El comprador paga por entrada</p>
        <p class="mt-1 text-3xl font-extrabold text-gray-900">{{ formatCLP(perTicket.total) }}</p>
        <p class="mt-1 text-sm text-gray-600">
          <template v-if="isFree">Evento gratuito: sin cargo por servicio.</template>
          <template v-else>
            {{ formatCLP(price) }} de entrada + {{ formatCLP(perTicket.feeNet) }} de cargo por servicio ({{ SERVICE_FEE_PERCENT_LABEL }})
            + {{ formatCLP(perTicket.feeIva) }} de IVA del cargo ({{ IVA_PERCENT_LABEL }}).
          </template>
        </p>
      </div>
      <div class="rounded-xl bg-lime-50 p-4 ring-1 ring-lime-200">
        <p class="text-sm font-semibold uppercase tracking-wide text-lime-800">Tú recibes</p>
        <p class="mt-1 text-3xl font-extrabold text-gray-900">{{ formatCLP(totals.subtotal) }}</p>
        <p class="mt-1 text-sm text-gray-700">
          {{ quantity.toLocaleString('es-CL') }} × {{ formatCLP(price) }}. 0% de comisión para el productor: recibes el 100% del precio de tus entradas.
        </p>
      </div>
      <div
        v-if="!isFree"
        class="rounded-xl border border-gray-200 p-4"
        data-testid="fee-calc-compare"
        :data-passline-rate="passline.rate"
        :data-passline-total="passline.total"
        :data-savings="savingsPerTicket"
        :data-savings-100="savingsPer100"
      >
        <p class="text-sm font-semibold uppercase tracking-wide text-gray-500">Comparado con Passline</p>
        <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt class="text-gray-600">Con Passline ({{ passlinePercent }})</dt>
          <dd class="text-right font-semibold text-gray-900">{{ formatCLP(passline.total) }}</dd>
          <dt class="text-gray-600">Con AI Tickets ({{ SERVICE_FEE_PERCENT_LABEL }} + IVA del cargo)</dt>
          <dd class="text-right font-semibold text-gray-900">{{ formatCLP(perTicket.total) }}</dd>
        </dl>
        <p class="mt-3 text-sm text-gray-800">
          <template v-if="savingsPerTicket > 0">
            Tu comprador ahorra <strong>{{ formatCLP(savingsPerTicket) }}</strong> por entrada:
            <strong>{{ formatCLP(savingsPer100) }}</strong> cada 100 entradas.
          </template>
          <template v-else>Con este precio, el comprador paga lo mismo o menos con Passline.</template>
        </p>
        <p class="mt-2 text-xs text-gray-500">
          Passline: {{ Math.round(PASSLINE_BUYER_FEE.rate * 100) }}% sobre el precio de la entrada y
          {{ Math.round(PASSLINE_BUYER_FEE.reducedRate * 100) }}% en entradas de menos de {{ formatCLP(PASSLINE_BUYER_FEE.reducedBelow) }},
          {{ PASSLINE_BUYER_FEE.sourceLabel }}. Puede variar según el evento. {{ PASSLINE_BUYER_FEE.ivaNote }}
        </p>
      </div>
      <p class="text-xs text-gray-500">
        Total que pagan tus compradores: {{ formatCLP(totals.total) }} ({{ formatCLP(totals.feeNet) }} de cargo por servicio
        + {{ formatCLP(totals.feeIva) }} de IVA del cargo). El cargo y su IVA se calculan sobre el total de cada compra y se
        redondean al peso, igual que en el checkout. El precio de tu entrada no lleva cargos ni retenciones.
      </p>
    </div>
  </div>
</template>
