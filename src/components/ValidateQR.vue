<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { QrcodeStream } from 'vue-qrcode-reader'

const token = ref('')
const organizationId = ref(null)
const userId = ref(null)
const filteredEvents = ref([])

const props = defineProps({
  events: {
    type: Array,
    required: true
  }
})

onMounted(async () => {
  token.value = new URLSearchParams(window.location.search).get('token') || ''
  console.log("🔐 Token recibido:", token.value)
  console.log("📅 Eventos recibidos:", props.events)

  if (!token.value) {
    console.warn("⚠️ No hay token en la URL")
    filteredEvents.value = props.events
    return
  }

  try {
    const res = await fetch('https://api.aitickets.cl/profile', {
      headers: {
        Authorization: `Bearer ${token.value}`,
      }
    })

    const data = await res.json()
    console.log("👤 Usuario logueado:", data)

    userId.value = data.user?.id
    organizationId.value = data.user?.organization_id

    if (!organizationId.value) {
      console.warn("⚠️ No se pudo obtener el organization_id")
      return
    }

    filteredEvents.value = props.events.filter(
  ev => String(ev.organization_id) === String(organizationId.value)
)


    console.log("✅ Eventos filtrados:", filteredEvents.value)
  } catch (err) {
    console.error("🔥 Error al obtener perfil:", err)
  }
})

const scannedCode = ref('')
const ticketData = ref(null)
const resultMessage = ref('')
const loading = ref(false)
const cameraVisible = ref(false)
const selectedEventId = ref('')
const warningMessage = ref('')

watch(selectedEventId, (eventId) => {
  if (!eventId) return
  const selectedEvent = filteredEvents.value.find(ev => ev.id === eventId)
  if (!selectedEvent) return

  resultMessage.value = ''
  ticketData.value = null
  scannedCode.value = ''

  const today = new Date()
  const start = new Date(selectedEvent.start_date)
  const end = new Date(selectedEvent.end_date)

  if (today < start) {
    warningMessage.value = '⚠️ Este evento aún no ha comenzado.'
    cameraVisible.value = false
  } else if (today > end) {
    warningMessage.value = '⚠️ Este evento ya ha finalizado.'
    cameraVisible.value = false
  } else {
    warningMessage.value = ''
    cameraVisible.value = true
  }
})

const onDetect = async ([result]) => {
  if (!result?.rawValue) return
  scannedCode.value = result.rawValue

  try {
    loading.value = true
    resultMessage.value = ''
    ticketData.value = null

    const res = await fetch('/api/validate-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        qr_code: scannedCode.value,
        event_id: selectedEventId.value
      })
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.message)

    if (data.ticket.status === 'validated') {
      resultMessage.value = '❌ Este QR ya ha sido validado anteriormente.'
      return
    }

    ticketData.value = data.ticket
    cameraVisible.value = false
  } catch (err) {
    resultMessage.value = `❌ ${err.message}`
  } finally {
    loading.value = false
  }
}

const confirmValidation = async () => {
  if (!ticketData.value) return
  try {
    loading.value = true
    const res = await fetch('/api/confirm-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: ticketData.value.id })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.message)

    resultMessage.value = `✅ Entrada validada con éxito para ${ticketData.value.full_name}`
    ticketData.value = null
    scannedCode.value = ''
    cameraVisible.value = true
  } catch (err) {
    resultMessage.value = `❌ ${err.message}`
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-xl mx-auto font-[Prompt]">
    <h2 class="text-2xl mb-6 font-[Unbounded]">Escáner de Entradas QR</h2>

    <select v-model="selectedEventId" class="mb-4 p-2 border rounded w-full">
      <option disabled value="">Selecciona un evento</option>
      <option v-for="event in filteredEvents" :key="event.id" :value="event.id">
        {{ event.name }}
      </option>
    </select>

    <p v-if="warningMessage" class="text-yellow-600 font-semibold text-sm mb-4">
      {{ warningMessage }}
    </p>

    <div class="max-w-xl mx-auto font-[Prompt] pb-1">
      <QrcodeStream v-if="cameraVisible" @detect="onDetect" />
    </div>

    <div v-if="ticketData" class="mt-6 p-4 bg-white rounded-md shadow">
      <p><strong>Nombre:</strong> {{ ticketData.full_name }}</p>
      <p><strong>Email:</strong> {{ ticketData.email }}</p>
      <p><strong>Estado:</strong> {{ ticketData.status }}</p>
      <p><strong>Ticket:</strong> {{ ticketData.ticket_name }}</p>
      <p><strong>Precio:</strong> {{ ticketData.price }}</p>

      <button
        @click="confirmValidation"
        class="bg-green-600 text-white px-4 py-2 mt-4 rounded hover:bg-green-700"
      >
        Validar Entrada
      </button>
    </div>

    <p v-if="resultMessage" class="mt-4 text-sm font-semibold" :class="{
      'text-green-600': resultMessage.startsWith('✅'),
      'text-red-600': resultMessage.startsWith('❌')
    }">
      {{ resultMessage }}
    </p>
  </div>
</template>
  
  




