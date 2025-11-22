<script setup>
import { ref, onMounted, computed } from 'vue'
import { QrcodeStream } from 'vue-qrcode-reader'
import { useClientStorage } from '../composables/useClientStorage'

const props = defineProps({
  event: {
    type: Object,
    required: true
  }
})

console.log("📅 Evento recibido:", props.event)

// Estado local
const scannedCode = ref('')
const ticketData = ref(null)
const resultMessage = ref('')
const loading = ref(false)
const cameraVisible = ref(true)
const syncing = ref(false)
const isOnline = ref(false) // Se inicializa en onMounted para evitar mismatch de hidratación
const lastSyncDate = ref(null)

// Configuración de cámara
const selectedConstraints = ref({ facingMode: 'environment' })
const defaultConstraintOptions = [
  { label: 'Cámara trasera', constraints: { facingMode: 'environment' } },
  { label: 'Cámara frontal', constraints: { facingMode: 'user' } }
]
const constraintOptions = ref(defaultConstraintOptions)
const cameraError = ref('')

// Almacenamiento local
const { value: localEvent, setValue: setLocalEvent } = useClientStorage(`event_${props.event.slug}`, null)
const { value: pendingValidations, setValue: setPendingValidations } = useClientStorage(`pending_validations_${props.event.slug}`, [])

// Sonidos de validación (se inicializarán en onMounted)
let successSound = null
let errorSound = null

// Contador de validaciones
const validatedCount = computed(() => {
  if (!localEvent.value?.attendees) return 0
  return localEvent.value.attendees.filter(a => a.status === 'validated').length
})

const totalTickets = computed(() => {
  return localEvent.value?.attendees?.length || 0
})

// Inicializar datos locales
onMounted(() => {
  // Inicializar sonidos en el cliente
  if (typeof window !== 'undefined') {
    successSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZPQ8eZ7vo76dXFApGp+PwvWohBjKI0vPUgjIGHW6/7+OYPg8eaLrm76hYFApHqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPg8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPg8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPg8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPg8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPg8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrm76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrm76hYFApGqOPwvWohBjKI0fPTgjMGHm+/7+OZPQ8eaLrm76dYFApGqOPwvWohBjKI0fPTgjMGHm+/7+OZPQ8eZ7rm76dYFApGqOPwvWohBjKI0fPTgjMGHm+/7+OZPQ8eZ7rm76dYFA==')
  }

  // Establecer estado de conexión en el cliente
  isOnline.value = navigator.onLine

  // Guardar evento en localStorage al cargar por primera vez
  if (!localEvent.value || localEvent.value.id !== props.event.id) {
    setLocalEvent(props.event)
    lastSyncDate.value = new Date().toISOString()
  } else {
    // Cargar fecha de última sincronización
    lastSyncDate.value = localEvent.value.last_sync || null
  }

  // Escuchar cambios de conexión
  window.addEventListener('online', () => { isOnline.value = true })
  window.addEventListener('offline', () => { isOnline.value = false })
})

// Callback cuando la cámara está lista
const onCameraReady = async () => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const videoDevices = devices.filter(({ kind }) => kind === 'videoinput')

    constraintOptions.value = [
      ...defaultConstraintOptions,
      ...videoDevices.map(({ deviceId, label }) => ({
        label: `${label || 'Cámara'} (ID: ${deviceId.substring(0, 8)}...)`,
        constraints: { deviceId }
      }))
    ]

    cameraError.value = ''
    console.log('📷 Cámaras disponibles:', videoDevices)
  } catch (error) {
    console.error('Error al obtener cámaras:', error)
  }
}

// Función para dibujar el bounding box rojo
const paintOutline = (detectedCodes, ctx) => {
  for (const detectedCode of detectedCodes) {
    const [firstPoint, ...otherPoints] = detectedCode.cornerPoints

    ctx.strokeStyle = 'red'
    ctx.lineWidth = 3

    ctx.beginPath()
    ctx.moveTo(firstPoint.x, firstPoint.y)
    for (const { x, y } of otherPoints) {
      ctx.lineTo(x, y)
    }
    ctx.lineTo(firstPoint.x, firstPoint.y)
    ctx.closePath()
    ctx.stroke()
  }
}

// Manejar errores de cámara
const onCameraError = (error) => {
  console.error('Error de cámara:', error)
  
  if (error.name === 'NotAllowedError') {
    cameraError.value = '❌ Permisos de cámara denegados. Por favor, permite el acceso a la cámara.'
  } else if (error.name === 'NotFoundError') {
    cameraError.value = '❌ No se encontró ninguna cámara en el dispositivo.'
  } else if (error.name === 'NotReadableError') {
    cameraError.value = '❌ La cámara está siendo usada por otra aplicación.'
  } else if (error.name === 'OverconstrainedError') {
    cameraError.value = '⚠️ Las cámaras instaladas no son adecuadas. Intenta seleccionar otra.'
  } else if (error.name === 'NotSupportedError') {
    cameraError.value = '❌ Se requiere contexto seguro (HTTPS, localhost)'
  } else if (error.name === 'StreamApiNotSupportedError') {
    cameraError.value = '❌ Stream API no es compatible con este navegador'
  } else if (error.name === 'InsecureContextError') {
    cameraError.value = '❌ El acceso a la cámara solo se permite en contexto seguro (HTTPS)'
  } else {
    cameraError.value = `❌ Error: ${error.message}`
  }
}


// Validar QR offline
const onDetect = async ([result]) => {
  console.log("📸 QR detectado:", result?.rawValue)
  if (!result?.rawValue) return
  
  scannedCode.value = result.rawValue
  resultMessage.value = ''
  ticketData.value = null
  loading.value = true

  try {
    // Buscar ticket en datos locales
    const ticket = localEvent.value.attendees.find(a => a.qr_code === scannedCode.value)
    
    if (!ticket) {
      if (errorSound) errorSound.play()
      resultMessage.value = '❌ Este QR no corresponde a este evento.'
      loading.value = false
      return
    }

    if (ticket.status === 'validated') {
      if (errorSound) errorSound.play()
      resultMessage.value = '❌ Este QR ya ha sido validado anteriormente.'
      loading.value = false
      return
    }

    // Mostrar datos del ticket para confirmar
    ticketData.value = {
      id: ticket.id,
      event_id: ticket.event_id,
      status: ticket.status,
      validated_at: ticket.validated_at,
      full_name: `${ticket.attendees.first_name} ${ticket.attendees.last_name}`,
      email: ticket.attendees.email,
      ticket_name: ticket.event_tickets.ticket_name,
      price: ticket.event_tickets.price,
      qr_code: ticket.qr_code
    }
    
    cameraVisible.value = false
  } catch (err) {
    if (errorSound) errorSound.play()
    resultMessage.value = `❌ ${err.message}`
  } finally {
    loading.value = false
  }
}

// Confirmar validación (offline)
const confirmValidation = () => {
  if (!ticketData.value) return

  try {
    loading.value = true

    // Actualizar estado local
    const updatedAttendees = localEvent.value.attendees.map(a => {
      if (a.qr_code === ticketData.value.qr_code) {
        return {
          ...a,
          status: 'validated',
          validated_at: new Date().toISOString()
        }
      }
      return a
    })

    setLocalEvent({
      ...localEvent.value,
      attendees: updatedAttendees
    })

    // Agregar a validaciones pendientes de sincronización
    const pending = [...pendingValidations.value, {
      ticket_id: ticketData.value.id,
      validated_at: new Date().toISOString()
    }]
    setPendingValidations(pending)

    // Reproducir sonido de éxito
    if (successSound) successSound.play()

    resultMessage.value = `✅ Entrada validada con éxito para ${ticketData.value.full_name}`
    ticketData.value = null
    scannedCode.value = ''
    cameraVisible.value = true
  } catch (err) {
    if (errorSound) errorSound.play()
    resultMessage.value = `❌ ${err.message}`
  } finally {
    loading.value = false
  }
}

// Sincronizar con el servidor
const syncWithServer = async () => {
  if (!isOnline.value) {
    resultMessage.value = '❌ No hay conexión a internet. Conéctate para sincronizar.'
    return
  }

  try {
    syncing.value = true
    resultMessage.value = '🔄 Sincronizando...'

    // 1. Enviar validaciones pendientes
    if (pendingValidations.value.length > 0) {
      for (const validation of pendingValidations.value) {
        try {
          const res = await fetch('/api/confirm-ticket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticket_id: validation.ticket_id })
          })
          
          if (!res.ok) {
            console.error('Error al sincronizar ticket:', validation.ticket_id)
          }
        } catch (err) {
          console.error('Error en sincronización:', err)
        }
      }
      
      // Limpiar validaciones pendientes
      setPendingValidations([])
    }

    // 2. Obtener datos actualizados del servidor
    const response = await fetch(`/api/get-event-attendees?event_id=${props.event.id}`)
    
    if (response.ok) {
      const data = await response.json()
      
      setLocalEvent({
        ...localEvent.value,
        attendees: data.attendees,
        last_sync: new Date().toISOString()
      })
      
      lastSyncDate.value = new Date().toISOString()
      resultMessage.value = '✅ Sincronización completada exitosamente.'
    } else {
      throw new Error('Error al obtener datos del servidor')
    }
  } catch (err) {
    resultMessage.value = `❌ Error al sincronizar: ${err.message}`
  } finally {
    syncing.value = false
  }
}

// Cancelar validación
const cancelValidation = () => {
  ticketData.value = null
  scannedCode.value = ''
  resultMessage.value = ''
  cameraVisible.value = true
}

// Gestión de lista de asistentes
const searchQuery = ref('')
const showAttendeesList = ref(false)

const filteredAttendees = computed(() => {
  if (!localEvent.value?.attendees) return []
  
  const query = searchQuery.value.toLowerCase().trim()
  if (!query) return localEvent.value.attendees

  return localEvent.value.attendees.filter(attendee => {
    const fullName = `${attendee.attendees.first_name} ${attendee.attendees.last_name}`.toLowerCase()
    const email = attendee.attendees.email.toLowerCase()
    return fullName.includes(query) || email.includes(query)
  })
})

const toggleAttendeesList = () => {
  showAttendeesList.value = !showAttendeesList.value
}

const manualValidation = (attendee) => {
  if (attendee.status === 'validated') {
    resultMessage.value = '❌ Este ticket ya fue validado'
    return
  }

  // Actualizar estado local
  const updatedAttendees = localEvent.value.attendees.map(a => {
    if (a.id === attendee.id) {
      return {
        ...a,
        status: 'validated',
        validated_at: new Date().toISOString()
      }
    }
    return a
  })

  setLocalEvent({
    ...localEvent.value,
    attendees: updatedAttendees
  })

  // Agregar a validaciones pendientes
  const pending = [...pendingValidations.value, {
    ticket_id: attendee.id,
    validated_at: new Date().toISOString()
  }]
  setPendingValidations(pending)

  // Reproducir sonido de éxito
  if (successSound) successSound.play()

  resultMessage.value = `✅ Entrada validada manualmente para ${attendee.attendees.first_name} ${attendee.attendees.last_name}`
}
</script>



<template>
  <div class="max-w-4xl mx-auto font-[Prompt] px-4 sm:px-6">
    <h2 class="text-xl sm:text-2xl mb-4 sm:mb-6 font-[Unbounded]">Escáner de Entradas QR</h2>

    <!-- Estado del evento -->
    <div class="mb-3 sm:mb-4 p-3 bg-gray-100 rounded-md">
      <p class="font-semibold text-base sm:text-lg truncate">{{ event.name }}</p>
      <p class="text-xs sm:text-sm text-gray-600">{{ validatedCount }} / {{ totalTickets }} entradas validadas</p>
    </div>

    <!-- Estado de conexión y sincronización -->
    <div class="mb-3 sm:mb-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-0">
      <div class="flex items-center gap-2">
        <span :class="isOnline ? 'bg-green-500' : 'bg-red-500'" class="w-3 h-3 rounded-full flex-shrink-0"></span>
        <span class="text-xs sm:text-sm">{{ isOnline ? 'Online' : 'Offline' }}</span>
      </div>
      
      <button
        @click="syncWithServer"
        :disabled="syncing || !isOnline"
        class="w-full sm:w-auto px-3 sm:px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-xs sm:text-sm font-medium"
      >
        {{ syncing ? '🔄 Sincronizando...' : '🔄 Sincronizar' }}
      </button>
    </div>

    <!-- Indicador de validaciones pendientes -->
    <div v-if="pendingValidations.length > 0" class="mb-3 sm:mb-4 p-2 bg-yellow-100 border border-yellow-400 rounded text-xs sm:text-sm">
      ⚠️ {{ pendingValidations.length }} validación(es) pendiente(s) de sincronizar
    </div>

    <!-- Última sincronización -->
    <p v-if="lastSyncDate" class="text-xs text-gray-500 mb-3 sm:mb-4">
      Última sincronización: {{ new Date(lastSyncDate).toLocaleString('es-ES') }}
    </p>

    <!-- Error de cámara -->
    <div v-if="cameraError" class="mb-4 p-3 bg-red-100 border border-red-400 rounded text-sm text-red-700">
      {{ cameraError }}
    </div>

    <!-- Selector de cámara -->
    <div v-if="cameraVisible" class="mb-4">
      <label class="block text-sm font-medium text-gray-700 mb-2">
        Seleccionar cámara:
      </label>
      <select 
        v-model="selectedConstraints"
        class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
      >
        <option
          v-for="option in constraintOptions"
          :key="option.label"
          :value="option.constraints"
        >
          {{ option.label }}
        </option>
      </select>
    </div>

    <!-- Cámara QR -->
    <div v-if="cameraVisible" class="max-w-xl mx-auto pb-4">
      <QrcodeStream 
        :constraints="selectedConstraints"
        :track="paintOutline"
        @detect="onDetect" 
        @error="onCameraError"
        @camera-on="onCameraReady"
      />
    </div>

    <!-- Datos de la entrada -->
    <div v-if="ticketData" class="mt-4 sm:mt-6 p-3 sm:p-4 bg-white rounded-md shadow-lg border-2 border-blue-500">
      <h3 class="text-base sm:text-lg font-bold mb-3">Confirmar validación</h3>
      <div class="space-y-1 text-sm sm:text-base">
        <p class="break-words"><strong>Nombre:</strong> {{ ticketData.full_name }}</p>
        <p class="break-all"><strong>Email:</strong> {{ ticketData.email }}</p>
        <p><strong>Ticket:</strong> {{ ticketData.ticket_name }}</p>
      </div>

      <div class="flex flex-col sm:flex-row gap-2 mt-4">
        <button
          @click="confirmValidation"
          class="flex-1 bg-green-600 text-white px-4 py-2.5 rounded hover:bg-green-700 font-medium text-sm sm:text-base"
        >
          ✓ Validar Entrada
        </button>
        <button
          @click="cancelValidation"
          class="flex-1 bg-gray-500 text-white px-4 py-2.5 rounded hover:bg-gray-600 font-medium text-sm sm:text-base"
        >
          ✗ Cancelar
        </button>
      </div>
    </div>

    <!-- Mensaje resultado -->
    <p v-if="resultMessage" class="mt-4 text-xs sm:text-sm font-semibold p-3 rounded break-words" :class="{
      'text-green-700 bg-green-100': resultMessage.startsWith('✅'),
      'text-red-700 bg-red-100': resultMessage.startsWith('❌'),
      'text-blue-700 bg-blue-100': resultMessage.startsWith('🔄')
    }">
      {{ resultMessage }}
    </p>

    <!-- Indicador de carga -->
    <div v-if="loading" class="mt-4 text-center">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>

    <!-- Botón para mostrar/ocultar lista de asistentes -->
    <div class="mt-6 sm:mt-8 mb-4">
      <button
        @click="toggleAttendeesList"
        class="w-full px-4 py-3 bg-gray-700 text-white rounded hover:bg-gray-800 font-semibold text-sm sm:text-base"
      >
        {{ showAttendeesList ? '▲ Ocultar Lista de Asistentes' : '▼ Ver Lista de Asistentes' }}
      </button>
    </div>

    <!-- Sección de lista de asistentes -->
    <div v-if="showAttendeesList" class="mt-4 sm:mt-6 bg-white rounded-lg shadow-lg p-4 sm:p-6">
      <h3 class="text-lg sm:text-xl font-bold mb-4 font-[Unbounded]">Lista de Asistentes</h3>

      <!-- Estadísticas -->
      <div class="grid grid-cols-2 gap-2 sm:gap-3 mb-4 sm:mb-6">
        <div class="bg-blue-50 p-2 sm:p-3 rounded-lg text-center">
          <p class="text-xs sm:text-sm text-gray-600">Total Tickets</p>
          <p class="text-xl sm:text-2xl font-bold text-blue-600">{{ totalTickets }}</p>
        </div>
        <div class="bg-green-50 p-2 sm:p-3 rounded-lg text-center">
          <p class="text-xs sm:text-sm text-gray-600">Validados</p>
          <p class="text-xl sm:text-2xl font-bold text-green-600">{{ validatedCount }}</p>
        </div>
      </div>

      <!-- Buscador -->
      <div class="mb-4">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Buscar por nombre o correo..."
          class="w-full px-3 sm:px-4 py-2 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <!-- Lista de asistentes -->
      <div class="space-y-2 sm:space-y-3 max-h-[500px] sm:max-h-[600px] overflow-y-auto">
        <div
          v-for="attendee in filteredAttendees"
          :key="attendee.id"
          class="border rounded-lg p-3 sm:p-4 hover:bg-gray-50 transition-colors"
          :class="{
            'border-green-300 bg-green-50': attendee.status === 'validated',
            'border-gray-200': attendee.status !== 'validated'
          }"
        >
          <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 sm:gap-4">
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2 mb-1">
                <p class="font-semibold text-sm sm:text-base break-words">
                  {{ attendee.attendees.first_name }} {{ attendee.attendees.last_name }}
                </p>
                <span
                  v-if="attendee.status === 'validated'"
                  class="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                >
                  ✓ Validado
                </span>
                <span
                  v-else
                  class="text-xs bg-yellow-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                >
                  Pendiente
                </span>
              </div>
              <p class="text-xs sm:text-sm text-gray-600 break-all">{{ attendee.attendees.email }}</p>
              <p class="text-xs sm:text-sm text-gray-700 mt-1">
                <strong>Ticket:</strong> {{ attendee.event_tickets.ticket_name }}
              </p>
              <p v-if="attendee.validated_at" class="text-xs text-gray-500 mt-1">
                Validado: {{ new Date(attendee.validated_at).toLocaleString('es-ES') }}
              </p>
            </div>
            <button
              v-if="attendee.status !== 'validated'"
              @click="manualValidation(attendee)"
              class="w-full sm:w-auto px-3 sm:px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-xs sm:text-sm whitespace-nowrap flex-shrink-0"
            >
              ✓ Validar
            </button>
            <div v-else class="w-full sm:w-auto px-3 sm:px-4 py-2 bg-gray-300 text-gray-600 rounded text-xs sm:text-sm whitespace-nowrap text-center flex-shrink-0">
              ✓ Validado
            </div>
          </div>
        </div>

        <!-- Sin resultados -->
        <div v-if="filteredAttendees.length === 0" class="text-center py-8 text-gray-500">
          <p class="text-sm">No se encontraron asistentes</p>
        </div>
      </div>
    </div>
  </div>
</template>
  
  




