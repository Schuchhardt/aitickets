<script setup>
import { ref, watch } from 'vue'
import { QrcodeStream } from 'vue-qrcode-reader'

const props = defineProps({
  events: {
    type: Array,
    required: true
  }
})
console.log("📅 Eventos recibidos:", props.events)


const scannedCode = ref('')
const ticketData = ref(null)
const resultMessage = ref('')
const loading = ref(false)
const cameraVisible = ref(false)
const selectedEventId = ref('')
const warningMessage = ref('')

//Escuchar cambios en el evento seleccionado
watch(selectedEventId, (eventId) => {
  if (!eventId) return
  const selectedEvent = props.events.find(ev => ev.id === eventId)
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


// 🎯 Al detectar el QR
const onDetect = async ([result]) => {
  console.log("📸 QR detectado:", result?.rawValue)
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
    console.log("📦 Datos recibidos:", data)

    if (!res.ok) throw new Error(data.message)

    if (data.ticket.status === 'validated') {
      resultMessage.value = '❌ Este QR ya ha sido validado anteriormente.'
      return // ⚠️ No ocultes cámara, no se debe validar
    }

    ticketData.value = data.ticket
    cameraVisible.value = false //Ahora sí, ocúltala porque el QR es válido y se mostrará el ticket
  } catch (err) {
    resultMessage.value = `❌ ${err.message}`
    //NO ocultes la cámara si hay error
  } finally {
    loading.value = false
  }
}

const confirmValidation = async () => {
  if (!ticketData.value) {
    console.warn("⚠️ No hay ticketData.value")
    return
  }

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
    //selectedEventId.value = ''
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
      <option v-for="event in events" :key="event.id" :value="event.id">
        {{ event.name }}
      </option>
    </select>

    <p v-if="warningMessage" class="text-yellow-600 font-semibold text-sm mb-4">{{ warningMessage }}</p>

    <div class="max-w-xl mx-auto font-[Prompt] pb-1">
      <QrcodeStream v-if="cameraVisible" @detect="onDetect" />
    </div>
  
      <!-- Datos de la entrada -->
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
  
      <!-- Mensaje resultado -->
      <p v-if="resultMessage" class="mt-4 text-sm font-semibold" :class="{
        'text-green-600': resultMessage.startsWith('✅'),
        'text-red-600': resultMessage.startsWith('❌')
      }">
        {{ resultMessage }}
      </p>
    </div>
  </template>
  
  




