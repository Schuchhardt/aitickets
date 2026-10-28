<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { Calendar, MapPin, Ticket, CheckCircle, Image as ImageIcon, Plus, Trash2, ChevronRight, ChevronLeft, UploadCloud, Star } from 'lucide-vue-next'
import RichTextEditor from './RichTextEditor.vue'
import EventFAQManager from '../dashboard/EventFAQManager.vue'
import EventVideoUploader from '../dashboard/EventVideoUploader.vue'
import { normalizeSlug, SLUG_MIN, SLUG_PATTERN } from '../../lib/eventSlugFormat'
import { plainTextLength, sanitizeClient } from '../../lib/richTextClient'
import { prepareImageForUpload, MAX_UPLOAD_BYTES, MAX_SOURCE_BYTES } from '../../lib/clientImage'
import { chainOptions, pruneChain, chainSummary } from './ticketChain'
import { REVEAL_HOURS_OPTIONS, REVEAL_EVENT_DAY, DEFAULT_REVEAL_HOURS, revealOptionLabel } from '../../../netlify/lib/secret-location.mjs'
import { applyRepeat, applyTicketCopy } from './functionRepeat'
import FunctionRepeat from './FunctionRepeat.vue'
import TicketCopyToFunctions from './TicketCopyToFunctions.vue'
import CheckoutFieldsEditor from './CheckoutFieldsEditor.vue'
import { MAX_PEOPLE_PER_TICKET } from '../../lib/checkoutFields.mjs'
import { EVENT_PAGE_LAYOUTS, EVENT_PAGE_BACKGROUNDS, normalizePageSettings } from '../../lib/eventPageSettings'
import IridescenceBg from '../event/IridescenceBg.vue'

const props = defineProps({
  initialVenues: {
    type: Array,
    required: true
  },
  eventId: {
    type: [String, Number],
    required: true
  },
  initialFormState: {
    type: Object,
    required: true
  },
  eventStatus: {
    type: String,
    default: 'draft'
  },
  // Entradas confirmadas (no anuladas) del evento
  attendeeCount: {
    type: Number,
    default: 0
  },
  // Prefijo del link público, p. ej. https://aitickets.cl/eventos/
  publicBaseUrl: {
    type: String,
    default: ''
  },
  // Eventos demo: su link no se puede cambiar
  slugLocked: {
    type: Boolean,
    default: false
  }
})

// Aviso a los asistentes (solo eventos publicados con asistentes). Los cambios de fecha/horario o lugar
// se avisan automáticamente; para otros cambios el productor decide explícitamente al guardar en Revisión.
const canNotify = props.eventStatus === 'published' && props.attendeeCount > 0
const notifyAttendees = ref(false)
const notifyMessage = ref('')
const attendeeLabel = `${props.attendeeCount.toLocaleString('es-CL')} ${props.attendeeCount === 1 ? 'asistente' : 'asistentes'}`

const currentStep = ref(1)
const steps = [
  { number: 1, title: 'Información', icon: ImageIcon },
  { number: 2, title: 'Ubicación y Fechas', icon: Calendar },
  { number: 3, title: 'Entradas', icon: Ticket },
  { number: 4, title: 'Revisión', icon: CheckCircle },
]

// Form Data State - Init from Prop
const form = ref(JSON.parse(JSON.stringify(props.initialFormState)));
// Diseño de la página pública y organizador visible (events.page_settings)
form.value.general.pageSettings = normalizePageSettings(form.value.general.pageSettings)
if (typeof form.value.general.slug !== 'string') form.value.general.slug = ''
// Reseñas: correo "¿Cómo estuvo?" 24 h después de cada función (toggle al final del formulario)
if (!form.value.reviews) form.value.reviews = { enabled: true }

// Link público (/eventos/<slug>). Se normaliza al salir del campo; el servidor valida que esté libre y, si el
// evento ya circula (publicado o con inscritos), deja el link anterior redirigiendo al nuevo.
const originalSlug = props.initialFormState.general?.slug || ''
const slugError = ref('')
const slugPreview = computed(() => normalizeSlug(form.value.general.slug))
const slugChanged = computed(() => slugPreview.value !== originalSlug)
const isSlugValid = computed(() =>
  props.slugLocked || (!originalSlug && !slugPreview.value) || (slugPreview.value.length >= SLUG_MIN && SLUG_PATTERN.test(slugPreview.value))
)
const publicUrl = computed(() => `${props.publicBaseUrl}${slugPreview.value}`)
const publicBaseLabel = computed(() => props.publicBaseUrl.replace(/^https?:\/\//, ''))
const normalizeSlugInput = () => { form.value.general.slug = slugPreview.value }
const slugFromName = () => { form.value.general.slug = normalizeSlug(form.value.general.name) }
watch(() => form.value.general.slug, () => { slugError.value = '' })

// IA de la descripción: contexto del evento guardado + lo que hay sin guardar en el formulario
const descriptionAi = {
  eventId: props.eventId,
  draft: () => ({ name: form.value.general.name, category: form.value.general.category, description: form.value.general.description }),
}

// Cambios sin guardar: se compara con la última versión guardada
const savedSnapshot = ref(JSON.stringify(form.value))
const isDirty = computed(() => JSON.stringify(form.value) !== savedSnapshot.value)
let leavingAfterSave = false

// La vista previa sanitiza con DOMPurify (solo en el navegador)
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
  // Tras guardar se recarga la página en el mismo paso (?step=N&saved=1)
  const params = new URLSearchParams(window.location.search)
  const step = Number(params.get('step'))
  if (step >= 1 && step <= 4) currentStep.value = step
  if (params.get('saved') === '1') {
    savedNotice.value = true
    setTimeout(() => { savedNotice.value = false }, 4000)
  }
  if (params.has('step') || params.has('saved')) {
    window.history.replaceState(null, '', window.location.pathname)
  }
  window.addEventListener('beforeunload', (e) => {
    if (isDirty.value && !leavingAfterSave) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
})
const descriptionPreview = computed(() => (mounted.value ? sanitizeClient(form.value.general.description) : ''))

// Validation per step
const isStep1Valid = computed(() => {
  return form.value.general.name.length > 3 && plainTextLength(form.value.general.description) > 10 && isSlugValid.value
})

const isStep2Valid = computed(() => {
  return form.value.locations.length > 0 && form.value.locations.every(loc => {
    const venueValid = loc.isNewVenue ? loc.newVenueName.length > 3 : loc.venueId
    const datesValid = loc.dates.length > 0 && loc.dates.every(d => d.date && d.startTime)
    return venueValid && datesValid
  })
})

const isStep3Valid = computed(() => {
  return form.value.tickets.length > 0 && form.value.tickets.every(t => t.name && t.price >= 0 && (t.quantity === null || t.quantity === '' || t.quantity > 0))
})

const canNext = computed(() => {
  if (currentStep.value === 1) return isStep1Valid.value
  if (currentStep.value === 2) return isStep2Valid.value
  if (currentStep.value === 3) return isStep3Valid.value
  return true
})

const stepValidity = computed(() => ({ 1: isStep1Valid.value, 2: isStep2Valid.value, 3: isStep3Valid.value, 4: true }))

// Actions
const nextStep = () => {
  if (canNext.value && currentStep.value < 4) currentStep.value++
}

// Navegación libre entre pasos: el formulario es uno solo, la validación se hace al guardar
const goToStep = (n) => {
  currentStep.value = n
  submitError.value = ''
}

const prevStep = () => {
  if (currentStep.value > 1) currentStep.value--
}

// Ids temporales únicos (> 1e12 => el servidor los trata como nuevos)
let tempSeq = 0
const newTempId = () => Date.now() * 1000 + (tempSeq++ % 1000)

// Logic Step 2 (Locations)
const addLocation = () => {
  form.value.locations.push({
    id: newTempId(),
    venueId: '',
    isNewVenue: false,
    newVenueName: '',
    newVenueAddress: '',
    newVenueCity: '',
    dates: [{ id: newTempId(), date: '', startTime: '21:00', endTime: '04:00' }]
  })
}

const removeLocation = (index) => {
  form.value.locations.splice(index, 1)
}

const addDate = (locationIndex) => {
  form.value.locations[locationIndex].dates.push({ id: newTempId(), date: '', startTime: '21:00', endTime: '04:00' })
}

const removeDate = (locationIndex, dateIndex) => {
  form.value.locations[locationIndex].dates.splice(dateIndex, 1)
}

// Repetir funciones con un patrón y copiar las entradas a cada función (functionRepeat.js)
const repeatFunctions = (locationIndex, pattern) => applyRepeat(form.value.locations, locationIndex, pattern, newTempId)
// Entradas guardadas para «Todas las funciones» pueden tener ventas: solo las nuevas se asignan a una función al copiar
const canPinTicket = (t) => Number(t.id) > 1000000000000
const copyTicketsToFunctions = () =>
  applyTicketCopy(form.value.tickets, functionOptions.value.map((o) => o.id), newTempId, { canPin: canPinTicket })

// Qué pedir al comprar (events.checkout_fields): asistentes por entrada, empresa y preguntas (CheckoutFieldsEditor)
if (!form.value.general.checkoutFields) form.value.general.checkoutFields = { attendee_names: 'off', company: false, questions: [] }
// Dirección que solo ven quienes compran: al apagar el interruptor se borra al guardar
const secretLocationOn = ref(Boolean(form.value.general.secretLocation))
// Al prenderlo, por defecto se revela el día del evento
watch(secretLocationOn, (on) => {
  if (on && form.value.general.secretLocationRevealHours === '') form.value.general.secretLocationRevealHours = DEFAULT_REVEAL_HOURS
  if (!on) {
    form.value.general.secretLocation = ''
    form.value.general.secretLocationRevealHours = ''
  }
})

// Logic Step 3 (Tickets)
// peoplePerTicket: mesa para N (un QR por persona; cupo y precio por mesa). 1 = entrada normal.
const addTicket = () => {
  form.value.tickets.push({ id: newTempId(), name: '', price: 0, quantity: 100, description: '', eventDateId: '', opensAfterId: '', peoplePerTicket: 1, entryUntil: '' })
}

const removeTicket = (index) => {
  form.value.tickets.splice(index, 1)
}

// R1: funciones disponibles para asignar a cada tipo de entrada
const formatFunctionLabel = (d, venueName) => {
  let dayLabel = d.date
  try {
    const [y, m, day] = d.date.split('-').map(Number)
    dayLabel = new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
      .format(new Date(Date.UTC(y, m - 1, day, 12)))
  } catch { /* fecha incompleta */ }
  return [dayLabel, d.startTime, venueName].filter(Boolean).join(' · ')
}

const venueNameFor = (loc) => loc.isNewVenue
  ? loc.newVenueName
  : (props.initialVenues?.find(v => String(v.id) === String(loc.venueId))?.name || '')

const functionOptions = computed(() => {
  const multipleVenues = form.value.locations.length > 1
  return form.value.locations.flatMap(loc =>
    loc.dates
      .filter(d => d.date)
      .map(d => ({ id: d.id, label: formatFunctionLabel(d, multipleVenues ? venueNameFor(loc) : '') }))
  )
})

const functionLabelFor = (eventDateId) => {
  if (eventDateId === '' || eventDateId === null || eventDateId === undefined) return 'Todas las funciones'
  return functionOptions.value.find(o => String(o.id) === String(eventDateId))?.label || 'Todas las funciones'
}

// Tanda que espera a otra: si esa se borra o queda sin cupo, vuelve a venderse desde ya
watch(() => form.value.tickets.map((t) => `${t.id}:${t.quantity}:${t.opensAfterId}`).join(','), () => pruneChain(form.value.tickets))

// Si se elimina la función asignada, la entrada vuelve a "Todas las funciones"
watch(functionOptions, (options) => {
  const ids = new Set(options.map(o => String(o.id)))
  for (const t of form.value.tickets) {
    if (t.eventDateId !== '' && t.eventDateId !== null && t.eventDateId !== undefined && !ids.has(String(t.eventDateId))) {
      t.eventDateId = ''
    }
  }
})

// Image Upload Handling
const isDragging = ref(false)
const uploadingImage = ref(false)
const uploadError = ref('')

const triggerFileInput = () => {
  document.getElementById('editEventImageInput').click()
}

const handleImageUpload = async (e) => {
  const file = e.target.files[0]
  if (file) await uploadFile(file)
}

const onDragOver = (e) => {
  e.preventDefault()
  isDragging.value = true
}

const onDragLeave = (e) => {
  e.preventDefault()
  isDragging.value = false
}

const onDrop = async (e) => {
  e.preventDefault()
  isDragging.value = false
  const file = e.dataTransfer.files[0]
  if (file) await uploadFile(file)
}

const uploadFile = async (file) => {
  // Validate type and size
  if (!file.type.startsWith('image/')) {
    uploadError.value = 'Solo se permiten imágenes.'
    return
  }
  if (file.size > MAX_SOURCE_BYTES) {
    uploadError.value = 'La imagen es demasiado pesada (máx. 30MB).'
    return
  }

  uploadingImage.value = true
  uploadError.value = ''

  try {
    // Fotos de celular: se achican en el navegador para que suban rápido y bajo el límite de 5MB
    const prepared = await prepareImageForUpload(file)
    if (prepared.size > MAX_UPLOAD_BYTES) throw new Error('La imagen no debe superar los 5MB.')
    const formData = new FormData()
    formData.append('file', prepared)

    const response = await fetch('/api/events/upload-image', {
      method: 'POST',
      body: formData
    })

    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.message || 'Error al subir imagen')
    }

    form.value.general.imageUrl = result.url

  } catch (e) {
    console.error(e)
    uploadError.value = e.message || 'Error al subir la imagen. Intenta nuevamente.'
  } finally {
    uploadingImage.value = false
  }
}

const removeImage = () => {
  form.value.general.imageUrl = ''
}

// Video de portada (se guarda al instante, EventVideoUploader.vue). Si el evento no tenía imagen, el servidor usa
// el póster del video: se refleja aquí y en la versión guardada, para que "Guardar" no la borre ni la marque como cambio.
const onCoverVideoChange = ({ image_url }) => {
  if (!image_url || form.value.general.imageUrl) return
  form.value.general.imageUrl = image_url
  const saved = JSON.parse(savedSnapshot.value)
  if (!saved.general.imageUrl) {
    saved.general.imageUrl = image_url
    savedSnapshot.value = JSON.stringify(saved)
  }
}

// Submit
const isSubmitting = ref(false)
const submitError = ref('')
const submitSuccess = ref(false)
const savedNotice = ref(false)

const STEP_ERRORS = {
  1: 'Revisa la información: el nombre debe tener más de 3 caracteres, la descripción más de 10 y el link público al menos 3 (letras minúsculas, números y guiones).',
  2: 'Revisa ubicación y fechas: cada ubicación necesita un lugar y al menos una función con fecha y hora.',
  3: 'Revisa las entradas: cada una necesita nombre, precio válido y cantidad mayor a 0 (o sin límite).',
}

// Guarda desde cualquier paso. exit=true vuelve al panel del evento; si no, recarga en el mismo paso
// (así las ubicaciones, funciones y entradas nuevas quedan con su id real y no se duplican al volver a guardar).
const submitEvent = async ({ exit = false } = {}) => {
  const invalidStep = [1, 2, 3].find(n => !stepValidity.value[n])
  if (invalidStep) {
    currentStep.value = invalidStep
    submitError.value = STEP_ERRORS[invalidStep]
    return
  }

  isSubmitting.value = true
  submitError.value = ''
  savedNotice.value = false

  try {
    // Add eventId to payload
    const payload = {
      ...form.value,
      general: { ...form.value.general, slug: props.slugLocked ? undefined : slugPreview.value },
      reviewsEnabled: form.value.reviews.enabled,
      eventId: props.eventId,
      notifyAttendees: canNotify && exit && notifyAttendees.value,
      notifyMessage: canNotify && exit && notifyAttendees.value ? notifyMessage.value.trim() : '',
    }

    const response = await fetch('/api/events/update', {
      method: 'POST', // or PUT depending on implementation
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    
    const result = await response.json()
    
    if (!response.ok) {
      if (result.field === 'slug') {
        currentStep.value = 1
        slugError.value = result.message || 'Ese link no está disponible.'
      }
      throw new Error(result.message || 'Error al actualizar evento')
    }
    
    leavingAfterSave = true
    if (exit) {
      submitSuccess.value = true
      setTimeout(() => {
        window.location.href = `/dashboard/events/${props.eventId}`
      }, 1500)
    } else {
      window.location.href = `${window.location.pathname}?step=${currentStep.value}&saved=1`
    }
    
  } catch (e) {
    submitError.value = e.message
  } finally {
    isSubmitting.value = false
  }
}

</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm min-h-[600px] flex flex-col">
    <!-- Steps Header -->
    <div class="border-b border-gray-100 p-6 pb-12 sm:pb-6">
      <div class="flex items-center justify-between max-w-2xl mx-auto">
        <button
          v-for="(step, index) in steps"
          :key="step.number"
          type="button"
          @click="goToStep(step.number)"
          :disabled="isSubmitting"
          :aria-current="currentStep === step.number ? 'step' : undefined"
          class="flex flex-col items-center relative z-10 group"
        >
          <div 
            class="relative w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all duration-300"
            :class="[
              currentStep === step.number ? 'bg-black text-white ring-4 ring-black/10' : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200 group-hover:text-black',
            ]"
          >
            <component :is="step.icon" size="18" />
            <span
              v-if="!stepValidity[step.number]"
              class="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-white"
              title="Este paso tiene datos por completar"
            ></span>
          </div>
          <span 
            class="text-xs font-medium mt-2 absolute top-full w-20 sm:w-32 text-center leading-tight sm:leading-normal"
            :class="currentStep === step.number ? 'text-black' : 'hidden sm:block text-gray-500 group-hover:text-black'"
          >
            {{ step.title }}
          </span>
        </button>
        
        <!-- Progress Bar Background (Simple visual hack) -->
        <div class="absolute top-10 left-0 w-full h-0.5 bg-gray-100 -z-0 hidden md:block"></div> 
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 p-4 sm:p-8 overflow-y-auto">
      <div class="max-w-3xl mx-auto">

        <div v-if="submitError" class="mb-6 p-4 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100">
          {{ submitError }}
        </div>
        <div v-if="savedNotice" class="mb-6 p-4 bg-green-50 text-green-700 rounded-lg text-sm border border-green-100 font-medium">
          Cambios guardados.
        </div>
        
        <!-- Step 1: Info -->
        <div v-show="currentStep === 1" class="space-y-6">
          <h2 class="text-xl font-bold font-[Unbounded]">Información General</h2>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Nombre del Evento</label>
            <input v-model="form.general.name" type="text" placeholder="Ej: Festival de Verano 2025" class="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-black outline-none" />
          </div>

          <!-- Link público (events.slug) -->
          <div id="link-publico" class="scroll-mt-24">
            <label for="eventSlug" class="block text-sm font-medium text-gray-700 mb-1">Link público</label>
            <div
              class="flex rounded-lg border overflow-hidden bg-white focus-within:ring-2 focus-within:ring-black"
              :class="slugError || !isSlugValid ? 'border-red-300' : 'border-gray-300'"
            >
              <span v-if="publicBaseLabel" class="hidden sm:flex items-center pl-4 pr-1 bg-gray-50 text-gray-500 text-sm whitespace-nowrap border-r border-gray-200">{{ publicBaseLabel }}</span>
              <input
                id="eventSlug"
                v-model="form.general.slug"
                type="text"
                :disabled="slugLocked || isSubmitting"
                maxlength="120"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                placeholder="fiesta-de-verano-2026"
                aria-describedby="eventSlugHelp"
                class="flex-1 min-w-0 px-3 py-2 outline-none text-sm disabled:bg-gray-50 disabled:text-gray-500"
                @blur="normalizeSlugInput"
              />
            </div>
            <div id="eventSlugHelp" class="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
              <span class="text-gray-500 break-all">{{ publicUrl }}</span>
              <button v-if="!slugLocked" type="button" class="text-gray-600 underline hover:text-black" @click="slugFromName">Usar el nombre del evento</button>
            </div>
            <p v-if="slugError" class="mt-1 text-sm text-red-600" role="alert">{{ slugError }}</p>
            <p v-else-if="!isSlugValid" class="mt-1 text-xs text-red-600">Usa al menos 3 caracteres: letras minúsculas sin tildes, números y guiones.</p>
            <p v-else-if="slugLocked" class="mt-1 text-xs text-gray-500">El link de un evento demo no se puede cambiar.</p>
            <p v-else-if="slugChanged && originalSlug" class="mt-1 text-xs text-amber-700">
              {{ eventStatus === 'published'
                ? `El link anterior (/eventos/${originalSlug}) seguirá funcionando: redirige automáticamente al nuevo.`
                : 'Se aplica al guardar. Si el evento ya tiene inscritos, el link anterior redirige al nuevo; si no, queda libre.' }}
            </p>
          </div>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
              <select v-model="form.general.category" class="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-black outline-none bg-white">
                <option value="">Selecciona una categoría...</option>
              <option value="Comedia / Stand-up">Comedia / Stand-up</option>
              <option value="Teatro">Teatro</option>
              <option value="Música">Música</option>
              <option value="Fiesta">Fiesta</option>
              <option value="Festival">Festival</option>
              <option value="Circo">Circo</option>
              <option value="Danza">Danza</option>
              <option value="Infantil">Infantil</option>
              <option value="Taller / Charla">Taller / Charla</option>
              <option value="Deportes">Deportes</option>
              <option value="Gastronomía">Gastronomía</option>
              <option value="Otro">Otro</option>
              </select>
            </div>
            <div class="flex items-end">
              <label class="flex items-center gap-2 text-sm text-gray-700 pb-2 cursor-pointer">
                <input v-model="form.general.isPrivate" type="checkbox" class="w-4 h-4 rounded border-gray-300" />
                Evento privado (no aparece en la cartelera pública; solo con el link)
              </label>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
            <RichTextEditor v-model="form.general.description" :aiContext="descriptionAi" />
          </div>

          <!-- Preguntas frecuentes: crear y editar en un modal; se guardan al instante -->
          <div>
            <EventFAQManager :eventId="Number(props.eventId)" />
            <p class="mt-2 text-xs text-gray-500">Las preguntas se guardan al instante, sin necesidad de "Guardar".</p>
          </div>

           <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Imagen del Evento (Cover)</label>
            
            <input 
              type="file" 
              id="editEventImageInput" 
              class="hidden" 
              accept="image/*"
              @change="handleImageUpload"
            />

            <!-- Preview State -->
            <div v-if="form.general.imageUrl" class="relative w-full h-48 sm:h-64 rounded-xl overflow-hidden group border border-gray-200">
               <img :src="form.general.imageUrl" class="w-full h-full object-cover" />
               <div class="absolute inset-0 bg-black/50 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                 <button @click="triggerFileInput" class="px-4 py-2 bg-white rounded-lg text-sm font-medium hover:bg-gray-100 transition">Cambiar</button>
                 <button @click="removeImage" class="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"><Trash2 size="18"/></button>
               </div>
            </div>

            <!-- Empty State / Dropzone -->
            <div 
              v-else
              class="border-2 border-dashed rounded-xl p-6 sm:p-10 flex flex-col items-center justify-center text-center transition-all cursor-pointer"
              :class="[
                isDragging ? 'border-black bg-gray-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50',
                uploadingImage ? 'opacity-50 pointer-events-none' : ''
              ]"
              @dragover="onDragOver"
              @dragleave="onDragLeave"
              @drop="onDrop"
              @click="triggerFileInput"
            >
              <div v-if="uploadingImage" class="flex flex-col items-center">
                 <div class="animate-spin w-8 h-8 border-3 border-gray-300 border-t-black rounded-full mb-3"></div>
                 <p class="text-sm text-gray-500">Subiendo imagen...</p>
              </div>
              
              <div v-else class="flex flex-col items-center pointer-events-none">
                <div class="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-500">
                  <UploadCloud size="24" />
                </div>
                <p class="font-medium text-gray-900 mb-1">Haz click o arrastra tu imagen aquí</p>
                <p class="text-xs text-gray-500">JPG, PNG o WEBP · se optimiza automáticamente</p>
              </div>
            </div>

            <p v-if="form.general.imageUrl" class="mt-2 text-xs text-gray-500">
              Para ajustar el encuadre en desktop y mobile o generar la portada con IA, usa la sección Portada en
              <a :href="`/dashboard/events/${props.eventId}`" class="underline hover:text-black">el detalle del evento</a>.
            </p>

            <p v-if="uploadError" class="mt-2 text-sm text-red-600 flex items-center gap-1">
              <span class="w-1 h-1 bg-red-600 rounded-full"></span> {{ uploadError }}
            </p>

            <!-- Video de portada: reemplaza la imagen arriba de la página del evento -->
            <div class="mt-4 p-4 rounded-xl border border-gray-200">
              <EventVideoUploader :event-id="Number(props.eventId)" kind="cover"
                hint="Reemplaza la imagen arriba de la página del evento: se reproduce solo y sin sonido, y tu público activa el sonido con el ícono del parlante. La imagen se sigue usando en la cartelera, al compartir y en los correos. Se guarda al instante."
                @change="onCoverVideoChange" />
            </div>
          </div>

          <!-- Diseño de la página pública (events.page_settings) -->
          <fieldset>
            <legend class="block text-sm font-medium text-gray-700 mb-1">Diseño de la página</legend>
            <p class="text-xs text-gray-500 mb-3">Cómo se ubica la imagen (o el video de portada) respecto del título en la página del evento. Con video, el diseño compacto se muestra como póster.</p>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Diseño de la página">
              <label
                v-for="opt in EVENT_PAGE_LAYOUTS"
                :key="opt.value"
                class="relative flex flex-col gap-2 p-3 rounded-xl border cursor-pointer transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-black"
                :class="form.general.pageSettings.layout === opt.value ? 'border-black ring-2 ring-black/10 bg-gray-50' : 'border-gray-200 hover:border-gray-400'"
              >
                <input v-model="form.general.pageSettings.layout" type="radio" name="pageLayout" :value="opt.value" class="sr-only" />
                <!-- Miniatura del diseño -->
                <div class="h-20 rounded-lg bg-white border border-gray-100 p-2 overflow-hidden" aria-hidden="true">
                  <div v-if="opt.value === 'poster'" class="flex gap-2 h-full">
                    <div class="w-2/5 h-full rounded bg-lime-300"></div>
                    <div class="flex-1 flex flex-col gap-1 pt-1">
                      <div class="h-2 w-4/5 rounded bg-gray-800"></div>
                      <div class="h-1.5 w-3/5 rounded bg-gray-300"></div>
                      <div class="mt-auto h-4 w-full rounded bg-gray-200"></div>
                    </div>
                  </div>
                  <div v-else-if="opt.value === 'banner'" class="flex flex-col gap-1 h-full">
                    <div class="h-8 w-full rounded bg-lime-300"></div>
                    <div class="h-2 w-3/5 rounded bg-gray-800 -mt-2.5 ml-1 ring-2 ring-white"></div>
                    <div class="h-1.5 w-2/5 rounded bg-gray-300 ml-1"></div>
                    <div class="mt-auto h-3 w-1/3 self-end rounded bg-gray-200"></div>
                  </div>
                  <div v-else class="flex flex-col gap-1.5 h-full">
                    <div class="flex gap-2 items-center">
                      <div class="w-7 h-7 rounded bg-lime-300 shrink-0"></div>
                      <div class="flex-1 flex flex-col gap-1">
                        <div class="h-2 w-4/5 rounded bg-gray-800"></div>
                        <div class="h-1.5 w-1/2 rounded bg-gray-300"></div>
                      </div>
                    </div>
                    <div class="h-1.5 w-full rounded bg-gray-200"></div>
                    <div class="h-1.5 w-5/6 rounded bg-gray-200"></div>
                  </div>
                </div>
                <span class="text-sm font-semibold text-gray-900">{{ opt.label }}</span>
                <span class="text-xs text-gray-500 leading-snug">{{ opt.hint }}</span>
                <CheckCircle v-if="form.general.pageSettings.layout === opt.value" size="18" class="absolute top-2 right-2 text-black bg-white rounded-full" />
              </label>
            </div>

            <p class="block text-sm font-medium text-gray-700 mt-5 mb-1">Fondo</p>
            <p class="text-xs text-gray-500 mb-3">Un degradado iridiscente muy suave que se mueve lento detrás de la página.</p>
            <div class="flex flex-wrap gap-3" role="radiogroup" aria-label="Fondo de la página">
              <label
                v-for="bg in EVENT_PAGE_BACKGROUNDS"
                :key="bg.value"
                class="flex flex-col items-center gap-1.5 cursor-pointer group"
              >
                <input v-model="form.general.pageSettings.background" type="radio" name="pageBackground" :value="bg.value" class="sr-only peer" />
                <span
                  class="relative block w-16 h-16 rounded-full overflow-hidden border transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-black"
                  :class="form.general.pageSettings.background === bg.value ? 'border-black ring-2 ring-black/15 scale-105' : 'border-gray-200 group-hover:border-gray-400'"
                >
                  <IridescenceBg
                    v-if="bg.color"
                    class="absolute inset-0"
                    :color="bg.color"
                    :soft="bg.soft"
                    :still="form.general.pageSettings.background !== bg.value"
                    :resolution="1"
                    :speed="0.4"
                  />
                  <span v-else class="absolute inset-0 bg-white flex items-center justify-center text-gray-300">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M5.6 18.4L18.4 5.6" /></svg>
                  </span>
                </span>
                <span class="text-xs" :class="form.general.pageSettings.background === bg.value ? 'text-gray-900 font-semibold' : 'text-gray-500'">{{ bg.label }}</span>
              </label>
            </div>

            <label class="mt-5 flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input v-model="form.general.pageSettings.show_organizer" type="checkbox" class="mt-0.5 w-4 h-4 rounded border-gray-300" />
              <span>
                Mostrar el organizador en la página del evento
                <span class="block text-xs text-gray-500">"Organiza &lt;nombre de tu productora&gt;" bajo el título.</span>
              </span>
            </label>
          </fieldset>
        </div>

        <!-- Step 2: Locations & Dates -->
        <div v-show="currentStep === 2" class="space-y-8">
           <div v-for="(loc, locIndex) in form.locations" :key="loc.id" class="p-4 sm:p-6 bg-gray-50 rounded-xl border border-gray-200 relative">
             <button @click="removeLocation(locIndex)" v-if="form.locations.length > 1" class="absolute top-3 right-3 sm:top-4 sm:right-4 p-1 text-gray-400 hover:text-red-500">
               <Trash2 size="18" />
             </button>

             <h3 class="font-bold mb-4 flex items-center gap-2 pr-8">
               <MapPin size="18" /> Ubicación #{{ locIndex + 1 }}
             </h3>

             <!-- Venue Selection -->
             <div class="mb-6">
                <!-- If editing, typically we just show the venue. Allowing change is complex if it has data. For now allow switch logic similar to create. -->
                <div class="flex gap-4 mb-2">
                  <button 
                    type="button"
                    @click="loc.isNewVenue = false"
                    class="px-3 py-1 text-sm rounded-full transition-colors"
                    :class="!loc.isNewVenue ? 'bg-black text-white' : 'bg-gray-200 text-gray-600'"
                  > 
                    Existente
                  </button>
                   <button 
                    type="button"
                    @click="loc.isNewVenue = true"
                    class="px-3 py-1 text-sm rounded-full transition-colors"
                    :class="loc.isNewVenue ? 'bg-black text-white' : 'bg-gray-200 text-gray-600'"
                  > 
                    Nuevo
                  </button>
                </div>

                <div v-if="!loc.isNewVenue">
                  <select v-model="loc.venueId" class="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none">
                    <option value="">Selecciona un lugar...</option>
                    <option v-for="v in props.initialVenues" :key="v.id" :value="v.id">{{ v.name }} ({{ v.city }})</option>
                  </select>
                </div>
                <div v-else class="space-y-3">
                   <input v-model="loc.newVenueName" type="text" placeholder="Nombre del Lugar" class="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
                   <input v-model="loc.newVenueAddress" type="text" placeholder="Dirección" class="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
                   <input v-model="loc.newVenueCity" type="text" placeholder="Ciudad / Comuna" class="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
                </div>
             </div>

             <!-- Dates (Functions) -->
             <div class="space-y-3">
               <label class="text-sm font-bold text-gray-700">Funciones (Fechas y Hora)</label>
               <div v-for="(date, dateIndex) in loc.dates" :key="date.id" class="flex flex-wrap sm:flex-nowrap gap-3 items-center">
                 <input v-model="date.date" type="date" class="w-full sm:w-auto sm:flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
                 <input v-model="date.startTime" type="time" class="flex-1 min-w-0 sm:flex-none sm:w-24 px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
                 <span class="text-gray-400">-</span>
                 <input v-model="date.endTime" type="time" class="flex-1 min-w-0 sm:flex-none sm:w-24 px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
                 
                 <button @click="removeDate(locIndex, dateIndex)" v-if="loc.dates.length > 1" class="p-1 text-gray-400 hover:text-red-500">
                   <Trash2 size="16" />
                 </button>
               </div>
               <button @click="addDate(locIndex)" class="text-sm text-blue-600 font-medium hover:underline flex items-center gap-1">
                 <Plus size="14" /> Agregar otra fecha
               </button>
               <FunctionRepeat :locations="form.locations" :loc-index="locIndex" @apply="(pattern) => repeatFunctions(locIndex, pattern)" />
             </div>
           </div>

           <button @click="addLocation" class="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:border-black hover:text-black transition-colors flex items-center justify-center gap-2">
             <Plus size="20" /> Agregar otra Ubicación
           </button>

           <!-- Dirección que solo ven quienes compran (events.secret_location, netlify/lib/secret-location.mjs) -->
           <div class="p-4 sm:p-6 bg-gray-50 rounded-xl border border-gray-200" data-testid="secret-location">
             <label class="flex items-start gap-3 cursor-pointer">
               <input type="checkbox" v-model="secretLocationOn" class="mt-1 h-4 w-4 accent-black" />
               <span>
                 <span class="font-bold block">Dirección solo para quienes compran</span>
                 <span class="text-sm text-gray-500">La página pública dice «Lugar secreto» y la comuna: sin el nombre del lugar, la calle ni el mapa. Quienes compran ven la dirección en su orden, su entrada y por correo desde el momento que elijas.</span>
               </span>
             </label>
             <div v-if="secretLocationOn" class="mt-4 grid gap-3 sm:grid-cols-3">
               <div class="sm:col-span-2">
                 <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Dirección exacta</label>
                 <input v-model="form.general.secretLocation" type="text" maxlength="300" placeholder="Ej: Av. Irarrázaval 1234, depto 5, Ñuñoa" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none bg-white" data-testid="secret-location-address" />
               </div>
               <div>
                 <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Se revela</label>
                 <select v-model="form.general.secretLocationRevealHours" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none bg-white" data-testid="secret-location-reveal">
                   <option :value="REVEAL_EVENT_DAY">{{ revealOptionLabel(REVEAL_EVENT_DAY) }}</option>
                   <option v-for="h in REVEAL_HOURS_OPTIONS" :key="h" :value="h">{{ revealOptionLabel(h) }}</option>
                   <option value="">Apenas compran</option>
                 </select>
               </div>
               <p v-if="form.general.secretLocationRevealHours === REVEAL_EVENT_DAY" class="sm:col-span-3 text-xs text-gray-500">Quien compra antes ve «te llega por correo el día del evento». Ese día a las 9:00 (o al empezar, si es antes) le mandamos la dirección.</p>
               <p v-else-if="form.general.secretLocationRevealHours !== ''" class="sm:col-span-3 text-xs text-gray-500">Quien compra antes ve «te llega por correo {{ revealOptionLabel(form.general.secretLocationRevealHours) }}» y a esa hora le mandamos la dirección.</p>
             </div>
           </div>
        </div>

        <!-- Step 3: Tickets -->
        <div v-show="currentStep === 3" class="space-y-6">
           <p v-if="functionOptions.length > 1" class="text-sm text-gray-600 bg-blue-50 border border-blue-100 rounded-lg p-3">
             Para vender cupos separados por función, crea un tipo de entrada por función. Una entrada con "Todas las funciones" comparte su cupo entre todas las fechas.
           </p>
           <TicketCopyToFunctions
             v-if="functionOptions.length > 1"
             :tickets="form.tickets"
             :function-ids="functionOptions.map((o) => o.id)"
             :can-pin="canPinTicket"
             @apply="copyTicketsToFunctions"
           />
           <div v-for="(ticket, index) in form.tickets" :key="ticket.id" class="p-4 sm:p-6 bg-gray-50 rounded-xl border border-gray-200 relative flex gap-4 sm:gap-6 items-start">
             <button @click="removeTicket(index)" v-if="form.tickets.length > 1" class="absolute top-3 right-3 sm:top-4 sm:right-4 p-1 text-gray-400 hover:text-red-500">
               <Trash2 size="18" />
             </button>

             <div class="hidden sm:block bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                <Ticket size="24" class="text-gray-400" />
             </div>

             <div class="flex-1 min-w-0 grid grid-cols-2 gap-3 sm:gap-4">
               <div class="col-span-2">
                 <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre Ticket</label>
                 <input v-model="ticket.name" type="text" placeholder="Ej: General Early Bird" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
               </div>
               <div>
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Precio</label>
                  <div class="relative">
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input v-model="ticket.price" type="number" class="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" placeholder="0" />
                  </div>
               </div>
               <div>
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Cantidad</label>
                  <input v-model="ticket.quantity" type="number" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
               </div>
               <div class="col-span-2">
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-1" :for="`people-${ticket.id}`">Personas por entrada</label>
                  <input :id="`people-${ticket.id}`" v-model.number="ticket.peoplePerTicket" type="number" min="1" :max="MAX_PEOPLE_PER_TICKET" placeholder="1" class="w-28 px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" data-testid="ticket-people" />
                  <p class="mt-1 text-xs text-gray-500">
                    {{ Number(ticket.peoplePerTicket) > 1
                      ? `Mesa o pack para ${ticket.peoplePerTicket}: cada compra emite ${ticket.peoplePerTicket} QR, uno por invitado. Precio y cantidad son por mesa.`
                      : '1 = entrada normal. Para una mesa, pon cuántas personas entran con ella.' }}
                  </p>
               </div>
               <div v-if="functionOptions.length > 1" class="col-span-2">
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Función</label>
                  <select v-model="ticket.eventDateId" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none bg-white">
                    <option value="">Todas las funciones</option>
                    <option v-for="opt in functionOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
                  </select>
               </div>
               <div v-if="form.tickets.length > 1" class="col-span-2">
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Venta</label>
                  <select v-model="ticket.opensAfterId" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none bg-white" data-testid="ticket-opens-after">
                    <option value="">Se vende desde ya</option>
                    <option v-for="opt in chainOptions(form.tickets, ticket)" :key="opt.id" :value="opt.id">Se abre al agotarse {{ opt.name || 'la otra entrada' }}</option>
                  </select>
                  <p v-if="ticket.opensAfterId" class="mt-1 text-xs text-gray-500">En la página aparece como «Se abre al agotarse…» y se pone a la venta sola cuando se venden todas las de la anterior.</p>
               </div>
               <div class="col-span-2 sm:col-span-1">
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Ingreso hasta <span class="normal-case font-normal">(opcional)</span></label>
                  <input v-model="ticket.entryUntil" type="time" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none bg-white" data-testid="ticket-entry-until" />
                  <p v-if="ticket.entryUntil" class="mt-1 text-xs text-gray-500">Pasada esa hora la puerta ve «fuera de horario» y decide si entra. Una hora antes del inicio cuenta como la madrugada siguiente.</p>
               </div>
             </div>
           </div>

           <button @click="addTicket" class="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:border-black hover:text-black transition-colors flex items-center justify-center gap-2">
             <Plus size="20" /> Agregar Ticket
           </button>

           <CheckoutFieldsEditor v-model="form.general.checkoutFields" />
        </div>

        <!-- Step 4: Review -->
        <div v-show="currentStep === 4" class="space-y-6">
           <div class="bg-gray-50 p-4 sm:p-6 rounded-xl border border-gray-200">
             <img v-if="form.general.imageUrl" :src="form.general.imageUrl" alt="" class="w-full h-40 object-cover rounded-lg mb-4" />
             <h3 class="font-bold text-lg mb-1 break-words">{{ form.general.name }}</h3>
             <p v-if="slugPreview" class="text-xs text-gray-500 mb-3 break-all">{{ publicUrl }}</p>
             <div class="rich-text text-gray-600 text-sm mb-4" v-html="descriptionPreview"></div>
             
             <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8 pt-4 border-t border-gray-200">
               <div>
                 <p class="text-xs font-bold text-gray-500 uppercase mb-2">Ubicaciones</p>
                 <ul class="text-sm space-y-1">
                   <li v-for="loc in form.locations" :key="loc.id">
                     <span class="font-medium">{{ loc.isNewVenue ? loc.newVenueName : (props.initialVenues?.find(v => v.id === loc.venueId)?.name || 'Ubicación') }}</span>
                     <span class="text-gray-500 ml-1">({{ loc.dates.length }} fechas)</span>
                   </li>
                 </ul>
               </div>

               <div>
                 <p class="text-xs font-bold text-gray-500 uppercase mb-2">Entradas</p>
                 <ul class="text-sm space-y-1">
                   <li v-for="t in form.tickets" :key="t.id">
                     {{ t.name }}: {{ t.quantity ?? 'Sin límite' }} x ${{ t.price }}
                     <span v-if="functionOptions.length > 1" class="text-gray-500"> · {{ functionLabelFor(t.eventDateId) }}</span>
                     <span v-if="chainSummary(form.tickets, t)" class="text-gray-500"> · {{ chainSummary(form.tickets, t) }}</span>
                     <span v-if="t.entryUntil" class="text-gray-500"> · Ingreso hasta {{ t.entryUntil }}</span>
                   </li>
                 </ul>
               </div>
             </div>
           </div>

           <div v-if="canNotify && notifyAttendees" class="p-4 rounded-xl border border-gray-200 space-y-2">
             <p class="text-sm font-medium text-gray-800">Aviso a {{ attendeeLabel }}</p>
             <p class="text-xs text-gray-500">Se enviará un correo al guardar. Si cambiaste fechas, horarios o el lugar, se les avisa automáticamente aunque no marques la opción.</p>
             <textarea v-model="notifyMessage" rows="2" maxlength="1500" placeholder="Mensaje opcional para los asistentes (ej: se agregó un nuevo artista)" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none text-sm"></textarea>
           </div>

           <!-- Reseñas (events.review_settings.enabled): toggle al final de la edición -->
           <div class="flex items-start justify-between gap-4 p-4 rounded-xl border border-gray-200" data-testid="reviews-toggle">
             <div class="min-w-0">
               <p id="reviewsToggleLabel" class="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><Star size="16" /> Pedir reseñas a los asistentes</p>
               <p class="text-xs text-gray-500 mt-1">
                 24 h después de cada función les enviamos un correo para calificar de 1 a 5 estrellas, comentar y subir fotos.
                 El premio por calificar y la revisión de fotos se configuran en
                 <a :href="`/dashboard/events/${props.eventId}#resenas`" class="underline hover:text-black">Reseñas</a>.
               </p>
             </div>
             <button
               type="button"
               role="switch"
               :aria-checked="form.reviews.enabled ? 'true' : 'false'"
               aria-labelledby="reviewsToggleLabel"
               :disabled="isSubmitting"
               class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:opacity-50"
               :class="form.reviews.enabled ? 'bg-black' : 'bg-gray-300'"
               @click="form.reviews.enabled = !form.reviews.enabled"
             >
               <span class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" :class="form.reviews.enabled ? 'translate-x-5' : 'translate-x-0.5'"></span>
             </button>
           </div>

           <div v-if="submitSuccess" class="p-4 bg-green-50 text-green-600 rounded-lg text-sm border border-green-100 font-bold text-center">
             ¡Evento actualizado exitosamente! Redirigiendo...
           </div>
        </div>

      </div>
    </div>

    <!-- Footer Actions -->
    <div class="p-4 sm:p-6 border-t border-gray-100 bg-gray-50 rounded-b-xl flex flex-wrap justify-between items-center gap-3">
      <button 
        v-if="currentStep > 1" 
        @click="prevStep"
        class="px-4 sm:px-6 py-2.5 sm:py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-100 transition flex items-center gap-2"
        :disabled="isSubmitting"
      >
        <ChevronLeft size="18" /> Anterior
      </button>
      <div v-else>
        <a :href="`/dashboard/events/${props.eventId}`" class="text-sm text-gray-500 hover:text-black">Cancelar</a>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2 sm:gap-3 ml-auto">
        <span v-if="isDirty && !isSubmitting" class="hidden sm:inline text-xs text-gray-500">Cambios sin guardar</span>

        <button
          v-if="currentStep < 4"
          @click="submitEvent()"
          class="px-4 sm:px-5 py-2.5 sm:py-2 rounded-lg border border-gray-300 bg-white text-gray-800 font-medium hover:bg-gray-100 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          :disabled="isSubmitting || !isDirty"
        >
          <span v-if="isSubmitting" class="animate-spin w-4 h-4 border-2 border-gray-300 border-t-gray-800 rounded-full"></span>
          {{ isSubmitting ? 'Guardando...' : 'Guardar' }}
        </button>

        <button 
          v-if="currentStep < 4" 
          @click="nextStep"
          class="px-5 sm:px-8 py-2.5 sm:py-2 rounded-lg bg-black text-white font-medium hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          :disabled="!canNext || isSubmitting"
        >
          Siguiente <ChevronRight size="18" />
        </button>

        <label
          v-if="currentStep === 4 && canNotify"
          class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none"
          title="Envía un correo a quienes ya tienen entradas"
        >
          <input v-model="notifyAttendees" type="checkbox" class="w-4 h-4 rounded border-gray-300" :disabled="isSubmitting" />
          Avisar a {{ attendeeLabel }}
        </label>

        <button 
          v-if="currentStep === 4" 
          @click="submitEvent({ exit: true })"
          class="px-5 sm:px-8 py-2.5 sm:py-2 rounded-lg bg-black text-white font-medium hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          :disabled="isSubmitting"
        >
          <span v-if="isSubmitting" class="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full"></span>
          {{ isSubmitting ? 'Guardando...' : 'Guardar Cambios' }}
        </button>
      </div>
    </div>
  </div>
</template>
