<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { Calendar, MapPin, Ticket, CheckCircle, Image as ImageIcon, Plus, Trash2, ChevronRight, ChevronLeft, UploadCloud } from 'lucide-vue-next'
import CoverAdjuster from './CoverAdjuster.vue'

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
  }
})

// Aviso a los asistentes (solo eventos publicados). Los cambios de fecha/horario o lugar se avisan
// automáticamente; para otros cambios el productor decide explícitamente.
const notifyAttendees = ref(false)
const notifyMessage = ref('')

const currentStep = ref(1)
const steps = [
  { number: 1, title: 'Información', icon: ImageIcon },
  { number: 2, title: 'Ubicación y Fechas', icon: Calendar },
  { number: 3, title: 'Entradas', icon: Ticket },
  { number: 4, title: 'Revisión', icon: CheckCircle },
]

// Form Data State - Init from Prop
const form = ref(JSON.parse(JSON.stringify(props.initialFormState)));

// Validation per step
const isStep1Valid = computed(() => {
  return form.value.general.name.length > 3 && form.value.general.description.length > 10
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

// Actions
const nextStep = () => {
  if (canNext.value && currentStep.value < 4) currentStep.value++
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
  if (file.size > 5 * 1024 * 1024) {
    uploadError.value = 'La imagen no debe superar los 5MB.'
    return
  }

  uploadingImage.value = true
  uploadError.value = ''

  try {
    const formData = new FormData()
    formData.append('file', file)

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

const submitEvent = async () => {
  isSubmitting.value = true
  submitError.value = ''
  
  try {
    // Add eventId to payload
    const payload = {
      ...form.value,
      eventId: props.eventId,
      notifyAttendees: props.eventStatus === 'published' && notifyAttendees.value,
      notifyMessage: props.eventStatus === 'published' ? notifyMessage.value.trim() : '',
    }

    const response = await fetch('/api/events/update', {
      method: 'POST', // or PUT depending on implementation
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    
    const result = await response.json()
    
    if (!response.ok) throw new Error(result.message || 'Error al actualizar evento')
    
    submitSuccess.value = true
    setTimeout(() => {
      window.location.href = `/dashboard/events/${props.eventId}`
    }, 1500)
    
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
    <div class="border-b border-gray-100 p-6">
      <div class="flex items-center justify-between max-w-2xl mx-auto">
        <div v-for="(step, index) in steps" :key="step.number" class="flex flex-col items-center relative z-10">
          <div 
            class="w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all duration-300"
            :class="[
              currentStep >= step.number ? 'bg-black text-white' : 'bg-gray-100 text-gray-400',
              currentStep === step.number ? 'ring-4 ring-black/10' : ''
            ]"
          >
            <component :is="step.icon" size="18" />
          </div>
          <span 
            class="text-xs font-medium mt-2 absolute -bottom-6 w-32 text-center"
            :class="currentStep >= step.number ? 'text-black' : 'text-gray-400'"
          >
            {{ step.title }}
          </span>
        </div>
        
        <!-- Progress Bar Background (Simple visual hack) -->
        <div class="absolute top-10 left-0 w-full h-0.5 bg-gray-100 -z-0 hidden md:block"></div> 
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 p-8 overflow-y-auto">
      <div class="max-w-3xl mx-auto">
        
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
            <textarea v-model="form.general.description" rows="4" placeholder="¿De qué trata tu evento?" class="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-black outline-none"></textarea>
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
            <div v-if="form.general.imageUrl" class="relative w-full h-64 rounded-xl overflow-hidden group border border-gray-200">
               <img :src="form.general.imageUrl" class="w-full h-full object-cover" />
               <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                 <button @click="triggerFileInput" class="px-4 py-2 bg-white rounded-lg text-sm font-medium hover:bg-gray-100 transition">Cambiar</button>
                 <button @click="removeImage" class="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"><Trash2 size="18"/></button>
               </div>
            </div>

            <!-- Empty State / Dropzone -->
            <div 
              v-else
              class="border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center text-center transition-all cursor-pointer"
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
                <p class="text-xs text-gray-500">Soporta JPG, PNG, WEBP (Max 5MB)</p>
              </div>
            </div>

            <CoverAdjuster
              v-if="form.general.imageUrl"
              v-model="form.general.coverSettings"
              :imageUrl="form.general.imageUrl"
              :eventName="form.general.name"
            />

            <p v-if="uploadError" class="mt-2 text-sm text-red-600 flex items-center gap-1">
              <span class="w-1 h-1 bg-red-600 rounded-full"></span> {{ uploadError }}
            </p>
          </div>
        </div>

        <!-- Step 2: Locations & Dates -->
        <div v-show="currentStep === 2" class="space-y-8">
           <div v-for="(loc, locIndex) in form.locations" :key="loc.id" class="p-6 bg-gray-50 rounded-xl border border-gray-200 relative">
             <button @click="removeLocation(locIndex)" v-if="form.locations.length > 1" class="absolute top-4 right-4 text-gray-400 hover:text-red-500">
               <Trash2 size="18" />
             </button>

             <h3 class="font-bold mb-4 flex items-center gap-2">
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
               <div v-for="(date, dateIndex) in loc.dates" :key="date.id" class="flex gap-3 items-center">
                 <input v-model="date.date" type="date" class="flex-1 px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
                 <input v-model="date.startTime" type="time" class="w-24 px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
                 <span class="text-gray-400">-</span>
                 <input v-model="date.endTime" type="time" class="w-24 px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none" />
                 
                 <button @click="removeDate(locIndex, dateIndex)" v-if="loc.dates.length > 1" class="text-gray-400 hover:text-red-500">
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
           <div v-for="(ticket, index) in form.tickets" :key="ticket.id" class="p-6 bg-gray-50 rounded-xl border border-gray-200 relative flex gap-6 items-start">
             <button @click="removeTicket(index)" v-if="form.tickets.length > 1" class="absolute top-4 right-4 text-gray-400 hover:text-red-500">
               <Trash2 size="18" />
             </button>

             <div class="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                <Ticket size="24" class="text-gray-400" />
             </div>

             <div class="flex-1 grid grid-cols-2 gap-4">
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
           <div class="bg-gray-50 p-6 rounded-xl border border-gray-200">
             <h3 class="font-bold text-lg mb-2">{{ form.general.name }}</h3>
             <p class="text-gray-600 text-sm mb-4">{{ form.general.description }}</p>
             
             <div class="grid grid-cols-2 gap-8 pt-4 border-t border-gray-200">
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

           <div v-if="props.eventStatus === 'published'" class="p-4 rounded-xl border border-gray-200 space-y-3">
             <label class="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
               <input v-model="notifyAttendees" type="checkbox" class="w-4 h-4 mt-0.5 rounded border-gray-300" />
               <span>
                 <span class="font-medium">Avisar a los asistentes</span>
                 <span class="block text-gray-500 text-xs">Envía un correo a quienes ya tienen entradas. Si cambiaste fechas, horarios o el lugar, se les avisa automáticamente aunque no marques esta opción.</span>
               </span>
             </label>
             <textarea v-model="notifyMessage" rows="2" maxlength="1500" placeholder="Mensaje opcional para los asistentes (ej: se agregó un nuevo artista)" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none text-sm"></textarea>
           </div>

           <div v-if="submitError" class="p-4 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100">
             {{ submitError }}
           </div>
           
           <div v-if="submitSuccess" class="p-4 bg-green-50 text-green-600 rounded-lg text-sm border border-green-100 font-bold text-center">
             ¡Evento actualizado exitosamente! Redirigiendo...
           </div>
        </div>

      </div>
    </div>

    <!-- Footer Actions -->
    <div class="p-6 border-t border-gray-100 bg-gray-50 rounded-b-xl flex justify-between items-center">
      <button 
        v-if="currentStep > 1" 
        @click="prevStep"
        class="px-6 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-100 transition flex items-center gap-2"
        :disabled="isSubmitting"
      >
        <ChevronLeft size="18" /> Anterior
      </button>
      <div v-else>
        <a :href="`/dashboard/events/${props.eventId}`" class="text-sm text-gray-500 hover:text-black">Cancelar</a>
      </div>

      <button 
        v-if="currentStep < 4" 
        @click="nextStep"
        class="px-8 py-2 rounded-lg bg-black text-white font-medium hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        :disabled="!canNext"
      >
        Siguiente <ChevronRight size="18" />
      </button>

      <button 
        v-if="currentStep === 4" 
        @click="submitEvent"
        class="px-8 py-2 rounded-lg bg-black text-white font-medium hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        :disabled="isSubmitting"
      >
        <span v-if="isSubmitting" class="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full"></span>
        {{ isSubmitting ? 'Guardando...' : 'Guardar Cambios' }}
      </button>
    </div>
  </div>
</template>
