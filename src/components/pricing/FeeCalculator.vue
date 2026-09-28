<script setup>
// Calculadora de /precios. Usa exactamente la misma regla que el checkout (netlify/lib/fees.mjs vía
// Reservation/pricing.js): el comprador paga precio + cargo por servicio (10% del subtotal, redondeado a
// pesos) + IVA del cargo (19% del cargo, redondeado), y el productor recibe el 100% del precio de las
// entradas (0% de comisión para el productor). Ej.: $8.000 → cargo $800 + IVA $152 = $8.952.
import { computed, ref } from 'vue'
import { IVA_PERCENT_LABEL, SERVICE_FEE_PERCENT_LABEL, computeTotals, formatCLP } from '../Reservation/pricing.js'

const MAX_PRICE = 10_000_000
const MAX_QTY = 100_000

const priceInput = ref('8000')
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
      <p class="text-xs text-gray-500">
        Total que pagan tus compradores: {{ formatCLP(totals.total) }} ({{ formatCLP(totals.feeNet) }} de cargo por servicio
        + {{ formatCLP(totals.feeIva) }} de IVA del cargo). El cargo y su IVA se calculan sobre el total de cada compra y se
        redondean al peso, igual que en el checkout. El precio de tu entrada no lleva cargos ni retenciones.
      </p>
    </div>
  </div>
</template>
