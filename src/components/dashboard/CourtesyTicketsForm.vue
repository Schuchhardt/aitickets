<script setup>
import { ref } from 'vue'
import { Gift } from 'lucide-vue-next'

const props = defineProps({
  eventId: { type: Number, required: true },
  tickets: { type: Array, required: true } // [{ id, ticket_name }]
})

const ticketId = ref(props.tickets[0]?.id || '')
const quantity = ref(1)
const firstName = ref('')
const lastName = ref('')
const email = ref('')
const loading = ref(false)
const message = ref('')
const isError = ref(false)

const submit = async () => {
  message.value = ''
  isError.value = false
  if (!ticketId.value || !firstName.value.trim() || !email.value.trim()) {
    isError.value = true
    message.value = 'Completa tipo de entrada, nombre y email.'
    return
  }
  loading.value = true
  try {
    const res = await fetch('/api/events/courtesy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: props.eventId,
        ticketId: Number(ticketId.value),
        quantity: Number(quantity.value),
        firstName: firstName.value,
        lastName: lastName.value,
        email: email.value
      })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudieron emitir las cortesías')
    isError.value = data.emailSent === false
    message.value = data.message
    firstName.value = ''
    lastName.value = ''
    email.value = ''
    quantity.value = 1
  } catch (e) {
    isError.value = true
    message.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
    <div class="p-6 border-b border-gray-100">
      <h3 class="font-bold text-lg flex items-center gap-2"><Gift size="18" /> Entradas de cortesía</h3>
      <p class="text-sm text-gray-500 mt-1">Emite entradas gratis (invitados, prensa, staff). Se envían por email con su QR.</p>
    </div>

    <div v-if="!tickets.length" class="p-6 text-sm text-gray-500">
      Primero agrega un tipo de entrada al evento.
    </div>

    <form v-else @submit.prevent="submit" class="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo de entrada</label>
        <select v-model="ticketId" class="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white outline-none focus:ring-2 focus:ring-black">
          <option v-for="t in tickets" :key="t.id" :value="t.id">{{ t.ticket_name }}</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Cantidad</label>
        <input v-model="quantity" type="number" min="1" max="50" class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre</label>
        <input v-model="firstName" type="text" class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Apellido</label>
        <input v-model="lastName" type="text" class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
      </div>
      <div class="md:col-span-2">
        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
        <input v-model="email" type="email" class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
      </div>

      <div class="md:col-span-2 flex flex-col sm:flex-row sm:items-center gap-3">
        <button
          type="submit"
          :disabled="loading"
          class="px-5 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {{ loading ? 'Emitiendo...' : 'Emitir y enviar cortesías' }}
        </button>
        <p v-if="message" class="text-sm" :class="isError ? 'text-red-600' : 'text-green-700'">{{ message }}</p>
      </div>
    </form>
  </section>
</template>
