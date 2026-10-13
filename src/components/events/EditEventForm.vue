<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { Calendar, MapPin, Ticket, CheckCircle, Image as ImageIcon, Plus, Trash2, ChevronRight, ChevronLeft, UploadCloud } from 'lucide-vue-next'
import RichTextEditor from './RichTextEditor.vue'
import { plainTextLength, sanitizeClient } from '../../lib/richTextClient'
import { prepareImageForUpload, MAX_UPLOAD_BYTES, MAX_SOURCE_BYTES } from '../../lib/clientImage'

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
  return form.value.general.name.length > 3 && plainTextLength(form.value.general.description) > 10
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

// Logic Step 3 (Tickets)
const addTicket = () => {
  form.value.tickets.push({ id: newTempId(), name: '', price: 0, quantity: 100, description: '', eventDateId: '' })
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

// Submit
const isSubmitting = ref(false)
const submitError = ref('')
const submitSuccess = ref(false)
const savedNotice = ref(false)

const STEP_ERRORS = {
  1: 'Revisa la información: el nombre debe tener más de 3 caracteres y la descripción más de 10.',
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
    
    if (!response.ok) throw new Error(result.message || 'Error al actualizar evento')
    
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
          </div>
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
             </div>
           </div>

           <button @click="addLocation" class="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:border-black hover:text-black transition-colors flex items-center justify-center gap-2">
             <Plus size="20" /> Agregar otra Ubicación
           </button>
        </div>

        <!-- Step 3: Tickets -->
        <div v-show="currentStep === 3" class="space-y-6">
           <p v-if="functionOptions.length > 1" class="text-sm text-gray-600 bg-blue-50 border border-blue-100 rounded-lg p-3">
             Para vender cupos separados por función, crea un tipo de entrada por función. Una entrada con "Todas las funciones" comparte su cupo entre todas las fechas.
           </p>
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
               <div v-if="functionOptions.length > 1" class="col-span-2">
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Función</label>
                  <select v-model="ticket.eventDateId" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none bg-white">
                    <option value="">Todas las funciones</option>
                    <option v-for="opt in functionOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
                  </select>
               </div>
             </div>
           </div>

           <button @click="addTicket" class="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:border-black hover:text-black transition-colors flex items-center justify-center gap-2">
             <Plus size="20" /> Agregar Ticket
           </button>
        </div>

        <!-- Step 4: Review -->
        <div v-show="currentStep === 4" class="space-y-6">
           <div class="bg-gray-50 p-4 sm:p-6 rounded-xl border border-gray-200">
             <img v-if="form.general.imageUrl" :src="form.general.imageUrl" alt="" class="w-full h-40 object-cover rounded-lg mb-4" />
             <h3 class="font-bold text-lg mb-2 break-words">{{ form.general.name }}</h3>
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
