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

// ==== Helpers de estado / funciones (R1) ====
const isActiveStatus = (status) => status == null || status === 'active'

const SHORT_WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const todayInSantiago = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const functionLabel = (d) => {
  if (!d?.date) return ''
  const [y, m, day] = String(d.date).slice(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day, 12))
  return `${SHORT_WEEKDAYS[dt.getUTCDay()]} ${day} ${SHORT_MONTHS[m - 1]}${d.start_time ? ` · ${String(d.start_time).slice(0, 5)}` : ''}`
}

/** Aviso si la entrada es de una función específica que no es hoy (se puede validar igual). */
const localFunctionCheck = (attendee) => {
  const fnId = attendee?.event_tickets?.event_date_id ?? attendee?.event_date_id ?? null
  if (fnId == null) return { function_mismatch: false, function_label: null }
  const dates = localEvent.value?.dates || props.event.dates || []
  const fn = dates.find(d => String(d.id) === String(fnId))
  if (!fn) return { function_mismatch: false, function_label: null }
  return { function_mismatch: String(fn.date).slice(0, 10) !== todayInSantiago(), function_label: functionLabel(fn) }
}

/**
 * Combina la lista fresca del servidor con el estado local: las entradas validadas offline que siguen
 * pendientes de sincronizar se mantienen como validadas (salvo que el servidor diga que están anuladas).
 */
const mergeWithLocalState = (serverAttendees) => {
  const pendingById = new Map((pendingValidations.value || []).map(p => [p.ticket_id, p]))
  const previousById = new Map((localEvent.value?.attendees || []).map(a => [a.id, a]))
  return (serverAttendees || []).map(a => {
    const previous = previousById.get(a.id)
    const pending = pendingById.get(a.id)
    const merged = { ...a, event_order_id: a.event_order_id ?? previous?.event_order_id ?? null }
    if (pending && isActiveStatus(a.status)) {
      merged.status = 'validated'
      merged.validated_at = pending.validated_at
    }
    return merged
  })
}

const applyServerList = (attendees, dates) => {
  const now = new Date().toISOString()
  setLocalEvent({
    ...props.event,
    ...(localEvent.value?.id === props.event.id ? localEvent.value : {}),
    dates: dates || localEvent.value?.dates || props.event.dates || [],
    attendees: mergeWithLocalState(attendees),
    last_sync: now
  })
  lastSyncDate.value = now
}

/** Descarga la lista completa del servidor (paginada en la API) y la combina con el estado local. */
const refreshFromServer = async () => {
  const response = await fetch(`/api/get-event-attendees?event_id=${props.event.id}`)
  if (response.status === 401) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión para sincronizar.')
  if (!response.ok) throw new Error('Error al obtener datos del servidor')
  const data = await response.json()
  applyServerList(data.attendees || [], data.dates)
}

// Inicializar datos locales
onMounted(() => {
  // Inicializar sonidos en el cliente
  if (typeof window !== 'undefined') {
    successSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZPQ8eZ7vo76dXFApGp+PwvWohBjKI0vPUgjIGHW6/7+OYPg8eaLrm76hYFApHqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPg8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPg8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPg8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPg8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPg8eaLrn76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrm76hYFApGqOPwvWwhBjKI0fPUgjMGHm6/7+OZPQ8eaLrm76hYFApGqOPwvWohBjKI0fPTgjMGHm+/7+OZPQ8eaLrm76dYFApGqOPwvWohBjKI0fPTgjMGHm+/7+OZPQ8eZ7rm76dYFApGqOPwvWohBjKI0fPTgjMGHm+/7+OZPQ8eZ7rm76dYFA==')
  }

  // Establecer estado de conexión en el cliente
  isOnline.value = navigator.onLine

  const hasCache = localEvent.value && localEvent.value.id === props.event.id
  if (isOnline.value || !hasCache) {
    // La página se acaba de renderizar en el servidor: su lista es la más fresca.
    // Se combina con las validaciones locales pendientes en vez de conservar un caché viejo.
    applyServerList(props.event.attendees || [], props.event.dates || [])
  } else {
    // Offline con caché de este evento: conservarlo
    lastSyncDate.value = localEvent.value.last_sync || null
  }

  // Escuchar cambios de conexión (al volver la conexión se sincroniza lo pendiente)
  window.addEventListener('online', () => {
    isOnline.value = true
    if (pendingValidations.value.length && !syncing.value) syncWithServer()
  })
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


const toTicketData = (ticket, fnCheck) => ({
  id: ticket.id,
  event_id: ticket.event_id,
  status: ticket.status,
  validated_at: ticket.validated_at,
  full_name: `${ticket.attendees?.first_name || ''} ${ticket.attendees?.last_name || ''}`.trim(),
  email: ticket.attendees?.email || '',
  ticket_name: ticket.event_tickets?.ticket_name || '',
  qr_code: ticket.qr_code,
  function_mismatch: Boolean(fnCheck?.function_mismatch),
  function_label: fnCheck?.function_label || null
})

/** Busca en el servidor un QR que no está en la lista local (entrada vendida después de la última carga). */
const lookupTicketOnServer = async (qrCode) => {
  const res = await fetch('/api/validate-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qr_code: qrCode, event_id: props.event.id })
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error('No se pudo consultar la entrada en el servidor')
  const { ticket } = await res.json()
  if (!ticket) return null
  // Normalizar a la forma de la lista local y agregarla
  const attendee = {
    id: ticket.id,
    event_id: ticket.event_id,
    qr_code: ticket.qr_code || qrCode,
    status: ticket.status,
    validated_at: ticket.validated_at,
    event_order_id: ticket.event_order_id || null,
    is_complimentary: ticket.is_complimentary || false,
    attendees: {
      first_name: (ticket.full_name || '').split(' ')[0] || '',
      last_name: (ticket.full_name || '').split(' ').slice(1).join(' '),
      email: ticket.email || ''
    },
    event_tickets: { ticket_name: ticket.ticket_name || '', event_date_id: ticket.event_date_id ?? null }
  }
  const others = (localEvent.value?.attendees || []).filter(a => a.id !== attendee.id)
  setLocalEvent({ ...localEvent.value, attendees: [...others, attendee] })
  return { attendee, fnCheck: { function_mismatch: ticket.function_mismatch, function_label: ticket.function_label } }
}

// Validar QR (lista local; si no está y hay conexión, se consulta al servidor)
const onDetect = async ([result]) => {
  if (!result?.rawValue) return

  scannedCode.value = result.rawValue
  resultMessage.value = ''
  ticketData.value = null
  loading.value = true

  try {
    let ticket = (localEvent.value?.attendees || []).find(a => a.qr_code === scannedCode.value)
    let fnCheck = ticket ? localFunctionCheck(ticket) : null

    if (!ticket && isOnline.value) {
      const found = await lookupTicketOnServer(scannedCode.value)
      if (found) {
        ticket = found.attendee
        fnCheck = found.fnCheck
      }
    }

    if (!ticket) {
      if (errorSound) errorSound.play()
      resultMessage.value = isOnline.value
        ? '❌ Este QR no corresponde a este evento.'
        : '❌ Este QR no está en la lista descargada. Sincroniza con conexión para verificar entradas nuevas.'
      return
    }

    if (ticket.status === 'validated') {
      if (errorSound) errorSound.play()
      resultMessage.value = '❌ Este QR ya ha sido validado anteriormente.'
      return
    }

    if (!isActiveStatus(ticket.status)) {
      if (errorSound) errorSound.play()
      resultMessage.value = ticket.status === 'cancelled' ? '❌ Esta entrada fue anulada.' : `❌ Entrada no válida (estado: ${ticket.status}).`
      return
    }

    // Mostrar datos del ticket para confirmar
    ticketData.value = toTicketData(ticket, fnCheck)
    cameraVisible.value = false
  } catch (err) {
    if (errorSound) errorSound.play()
    resultMessage.value = `❌ ${err.message}`
  } finally {
    loading.value = false
  }
}

// Actualiza el estado local de una entrada
const setLocalStatus = (ticketId, status, validatedAt = null) => {
  const updatedAttendees = (localEvent.value?.attendees || []).map(a => {
    if (a.id === ticketId) {
      return { ...a, status, validated_at: status === 'validated' ? (validatedAt || a.validated_at || new Date().toISOString()) : a.validated_at }
    }
    return a
  })
  setLocalEvent({ ...localEvent.value, attendees: updatedAttendees })
}
const markLocalValidated = (ticketId, validatedAt = null) => setLocalStatus(ticketId, 'validated', validatedAt || new Date().toISOString())

const queuePendingValidation = (ticketId) => {
  const others = pendingValidations.value.filter(p => p.ticket_id !== ticketId)
  setPendingValidations([...others, {
    ticket_id: ticketId,
    validated_at: new Date().toISOString()
  }])
}

/** 409 de confirm-ticket: ¿la entrada ya estaba validada (y no anulada / otro estado)? */
const isAlreadyValidated = (data) => data?.code === 'already_validated' || (!data?.code && /ya validada/i.test(data?.message || ''))

/**
 * Valida una entrada. Online: confirma en el servidor (/api/confirm-ticket con event_id).
 * Offline o si el servidor no responde: la valida localmente y la deja pendiente de sincronizar.
 * Devuelve { ok, message, offline?, function_mismatch?, function_label? }.
 */
const validateTicket = async (ticketId) => {
  if (isOnline.value) {
    try {
      const res = await fetch('/api/confirm-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId, event_id: props.event.id })
      })
      let data = {}
      try { data = await res.json() } catch (e) { /* sin cuerpo */ }
      if (res.ok) {
        markLocalValidated(ticketId, data.validated_at)
        return { ok: true, function_mismatch: data.function_mismatch, function_label: data.function_label }
      }
      if (res.status === 401) {
        return { ok: false, message: 'Tu sesión expiró. Vuelve a iniciar sesión.' }
      }
      if (res.status >= 400 && res.status < 500) {
        if (res.status === 409) {
          if (isAlreadyValidated(data)) markLocalValidated(ticketId, data.validated_at)
          else if (data?.status) setLocalStatus(ticketId, data.status)
        }
        return { ok: false, message: data.message || 'No se pudo validar la entrada.' }
      }
      // 5xx: se valida offline y se reintenta al sincronizar
    } catch (err) {
      console.error('Error validando en servidor, se guarda offline:', err)
    }
  }
  markLocalValidated(ticketId)
  queuePendingValidation(ticketId)
  return { ok: true, offline: true }
}

// Confirmar validación del QR escaneado
const confirmValidation = async () => {
  if (!ticketData.value) return

  try {
    loading.value = true
    const result = await validateTicket(ticketData.value.id)

    if (result.ok) {
      if (successSound) successSound.play()
      const fnWarning = ticketData.value.function_mismatch && ticketData.value.function_label
        ? ` · Ojo: entrada para ${ticketData.value.function_label}`
        : ''
      resultMessage.value = `✅ Entrada validada con éxito para ${ticketData.value.full_name}${result.offline ? ' (pendiente de sincronizar)' : ''}${fnWarning}`
    } else {
      if (errorSound) errorSound.play()
      resultMessage.value = `❌ ${result.message}`
    }
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
  if (syncing.value) return

  try {
    syncing.value = true
    resultMessage.value = '🔄 Sincronizando...'

    // 1. Enviar validaciones pendientes. Solo se quitan de la cola las confirmadas (2xx) o las que el
    //    servidor ya tenía validadas (409 already_validated). Errores de red / 5xx / sesión quedan en cola.
    //    Rechazos definitivos (anulada, no pertenece al evento) se quitan y se informan.
    const resolved = new Set()
    const rejected = []
    let authError = false
    for (const validation of [...pendingValidations.value]) {
      try {
        const res = await fetch('/api/confirm-ticket', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticket_id: validation.ticket_id, event_id: props.event.id, validated_at: validation.validated_at })
        })
        let data = {}
        try { data = await res.json() } catch (e) { /* sin cuerpo */ }

        if (res.ok || (res.status === 409 && isAlreadyValidated(data))) {
          resolved.add(validation.ticket_id)
        } else if (res.status === 401 || res.status === 403) {
          authError = true
          break
        } else if (res.status === 404 || res.status === 409) {
          resolved.add(validation.ticket_id)
          rejected.push(validation.ticket_id)
        } else {
          console.error('Error al sincronizar ticket (se reintentará):', validation.ticket_id, res.status)
        }
      } catch (err) {
        console.error('Error de red al sincronizar (se reintentará):', err)
      }
    }
    // Conservar lo no resuelto (y lo que se haya encolado durante la sincronización)
    setPendingValidations(pendingValidations.value.filter(p => !resolved.has(p.ticket_id)))

    if (authError) {
      throw new Error('Tu sesión expiró. Vuelve a iniciar sesión para sincronizar.')
    }

    // 2. Obtener datos actualizados del servidor y combinarlos con lo pendiente
    await refreshFromServer()

    const stillPending = pendingValidations.value.length
    const parts = ['✅ Sincronización completada.']
    if (rejected.length) parts.push(`${rejected.length} validación(es) rechazada(s) por el servidor (entrada anulada o de otro evento).`)
    if (stillPending) parts.push(`${stillPending} validación(es) siguen pendientes; se reintentarán.`)
    resultMessage.value = parts.join(' ')
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
const showAttendeesList = ref(true)

const filteredAttendees = computed(() => {
  if (!localEvent.value?.attendees) return []
  
  const query = searchQuery.value.toLowerCase().trim()
  if (!query) return localEvent.value.attendees

  return localEvent.value.attendees.filter(attendee => {
    const fullName = `${attendee.attendees?.first_name || ''} ${attendee.attendees?.last_name || ''}`.toLowerCase()
    const email = (attendee.attendees?.email || '').toLowerCase()
    return fullName.includes(query) || email.includes(query)
  })
})

const toggleAttendeesList = () => {
  showAttendeesList.value = !showAttendeesList.value
}

const manualValidation = async (attendee) => {
  if (attendee.status === 'validated') {
    resultMessage.value = '❌ Este ticket ya fue validado'
    return
  }
  if (!isActiveStatus(attendee.status)) {
    resultMessage.value = attendee.status === 'cancelled' ? '❌ Esta entrada fue anulada' : `❌ Entrada no válida (estado: ${attendee.status})`
    return
  }

  const fnCheck = localFunctionCheck(attendee)
  if (fnCheck.function_mismatch && !confirm(`Esta entrada es para otra función (${fnCheck.function_label}). ¿Validarla de todas formas?`)) return

  const name = `${attendee.attendees?.first_name || ''} ${attendee.attendees?.last_name || ''}`.trim()
  const result = await validateTicket(attendee.id)
  if (result.ok) {
    if (successSound) successSound.play()
    resultMessage.value = `✅ Entrada validada manualmente para ${name}${result.offline ? ' (pendiente de sincronizar)' : ''}`
  } else {
    if (errorSound) errorSound.play()
    resultMessage.value = `❌ ${result.message}`
  }
}

// Reenviar entradas de una orden (p. ej. "no me llegó la entrada")
const resendingOrderId = ref(null)
const resendTickets = async (attendee) => {
  const orderId = attendee.event_order_id
  if (!orderId) {
    resultMessage.value = '❌ Esta entrada no tiene una orden asociada para reenviar.'
    return
  }
  if (!isOnline.value) {
    resultMessage.value = '❌ Necesitas conexión a internet para reenviar entradas.'
    return
  }
  if (!confirm(`¿Reenviar las entradas de esta orden a ${attendee.attendees?.email || 'el comprador'}?`)) return

  resendingOrderId.value = orderId
  try {
    const res = await fetch('/api/orders/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId })
    })
    const data = await res.json().catch(() => ({}))
    resultMessage.value = res.ok
      ? `✅ Entradas reenviadas a ${attendee.attendees?.email || 'el comprador'}`
      : `❌ ${data.message || 'No se pudieron reenviar las entradas'}`
  } catch (err) {
    resultMessage.value = `❌ ${err.message}`
  } finally {
    resendingOrderId.value = null
  }
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
      <div v-if="ticketData.function_mismatch" class="mt-3 p-2 bg-yellow-100 border border-yellow-400 rounded text-xs sm:text-sm text-yellow-900" role="alert">
        ⚠️ Esta entrada es para otra función<span v-if="ticketData.function_label">: <strong>{{ ticketData.function_label }}</strong></span>. Puedes validarla de todas formas si corresponde.
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
      'text-blue-700 bg-blue-100': resultMessage.startsWith('🔄'),
      'text-yellow-800 bg-yellow-100': resultMessage.startsWith('⚠️')
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
        {{ showAttendeesList ? '▲ Ocultar búsqueda de asistentes' : '▼ Buscar asistente (validación manual / reenviar entradas)' }}
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
                  {{ attendee.attendees?.first_name }} {{ attendee.attendees?.last_name }}
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
              <p class="text-xs sm:text-sm text-gray-600 break-all">{{ attendee.attendees?.email }}</p>
              <p class="text-xs sm:text-sm text-gray-700 mt-1">
                <strong>Ticket:</strong> {{ attendee.event_tickets?.ticket_name }}
                <span v-if="localFunctionCheck(attendee).function_label" class="ml-1 text-xs text-gray-500">({{ localFunctionCheck(attendee).function_label }})</span>
                <span v-if="attendee.is_complimentary" class="ml-1 text-xs text-purple-600">(cortesía)</span>
              </p>
              <button
                v-if="attendee.event_order_id"
                @click="resendTickets(attendee)"
                :disabled="resendingOrderId === attendee.event_order_id"
                class="mt-2 text-xs text-blue-600 hover:underline disabled:text-gray-400"
              >
                {{ resendingOrderId === attendee.event_order_id ? 'Reenviando...' : '✉️ Reenviar entradas' }}
              </button>
              <p v-if="attendee.validated_at" class="text-xs text-gray-500 mt-1">
                Validado: {{ new Date(attendee.validated_at).toLocaleString('es-ES') }}
              </p>
            </div>
            <div v-if="attendee.status === 'cancelled'" class="w-full sm:w-auto px-3 sm:px-4 py-2 bg-red-100 text-red-700 rounded text-xs sm:text-sm whitespace-nowrap text-center flex-shrink-0">
              Anulada
            </div>
            <button
              v-else-if="attendee.status !== 'validated'"
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
  
  




