<script setup>
// Solicitar retiro desde /dashboard/finance. Dos pasos (igual que request_payout por MCP/REST):
// 1) POST sin token → resumen (monto, cuenta, fecha estimada) y confirmation_token;
// 2) el productor confirma → POST con el token y una idempotency_key (un doble clic no duplica el retiro).
import { ref } from 'vue'
import { Banknote } from 'lucide-vue-next'

const props = defineProps({
  available: { type: Number, required: true },
  canRequest: { type: Boolean, default: false },
  missing: { type: Array, default: () => [] } // etiquetas de lo que falta para retirar
})

const step = ref('idle') // idle | confirming | done
const loading = ref(false)
const error = ref('')
const summary = ref('')
const token = ref('')
const result = ref(null)
const idempotencyKey = ref('')

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`

async function post(body) {
  const res = await fetch('/api/payouts/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) throw new Error(data?.error?.message || 'No se pudo solicitar el retiro. Intenta de nuevo.')
  return data.data
}

async function start() {
  error.value = ''
  loading.value = true
  try {
    const data = await post({})
    summary.value = data.summary
    token.value = data.confirmation_token
    idempotencyKey.value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
    step.value = 'confirming'
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function reset() {
  step.value = 'idle'
}

async function confirm() {
  error.value = ''
  loading.value = true
  try {
    result.value = await post({ confirmation_token: token.value, idempotency_key: idempotencyKey.value })
    step.value = 'done'
  } catch (e) {
    error.value = e.message
    step.value = 'idle'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="text-sm" data-testid="payout-request">
    <template v-if="step === 'idle'">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 font-semibold text-lime-400 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="loading || !canRequest || available <= 0"
        @click="start"
      >
        <Banknote class="h-4 w-4" />
        {{ loading ? 'Preparando…' : 'Solicitar retiro' }}
      </button>
      <p v-if="available <= 0" class="mt-2 text-xs text-gray-500">Aún no tienes saldo disponible para retirar.</p>
      <div v-else-if="!canRequest && missing.length" class="mt-2 text-xs text-amber-800">
        Para retirar falta:
        <ul class="list-disc pl-4">
          <li v-for="m in missing" :key="m">{{ m }}</li>
        </ul>
        <a href="/dashboard/settings#datos-bancarios" class="underline">Completar en Configuración</a>
      </div>
    </template>

    <div v-else-if="step === 'confirming'" class="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p class="text-gray-800">{{ summary }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-lg bg-black px-4 py-2 font-semibold text-lime-400 hover:bg-gray-800 disabled:opacity-40"
          :disabled="loading"
          @click="confirm"
        >
          {{ loading ? 'Solicitando…' : 'Confirmar retiro' }}
        </button>
        <button type="button" class="rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-100" :disabled="loading" @click="reset">
          Cancelar
        </button>
      </div>
    </div>

    <p v-else-if="step === 'done' && result" class="rounded-lg bg-green-50 p-3 text-green-800">
      Retiro de {{ clp(result.amount) }} solicitado. Llegará a tu cuenta {{ result.bank }} ****{{ result.account_last4 }} a más tardar el
      {{ result.estimated_payment_date }}.
    </p>

    <p v-if="error" class="mt-2 text-xs text-red-700">{{ error }}</p>
  </div>
</template>
