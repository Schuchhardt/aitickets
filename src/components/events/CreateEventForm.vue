<script setup>
import { supabase } from '../../lib/supabaseClient'
import { ref, computed } from 'vue'
import { Calendar, MapPin, Ticket, CheckCircle, Image as ImageIcon, Plus, Trash2, ChevronRight, ChevronLeft, UploadCloud } from 'lucide-vue-next'

const props = defineProps({
  initialVenues: {
    type: Array,
    default: () => []
  }
})

const currentStep = ref(1)
const steps = [
  { number: 1, title: 'Información', icon: ImageIcon },
  { number: 2, title: 'Ubicación y Fechas', icon: Calendar },
  { number: 3, title: 'Entradas', icon: Ticket },
  { number: 4, title: 'Revisión', icon: CheckCircle },
]

// Form Data State
const form = ref({
  // Step 1
  general: {
    name: '',
    description: '',
    imageUrl: '',
    category: '',
  },
  // Step 2: List of Locations (Venue + Dates)
  locations: [
    // { venueId: '', isNewVenue: false, newVenueName: '', dates: [{ date: '', startTime: '', endTime: '' }] }
  ],
  // Step 3
  tickets: [
    // { name: 'General', price: 0, quantity: 100, description: '' }
  ]
})

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
  return form.value.tickets.length > 0 && form.value.tickets.every(t => t.name && t.price >= 0 && t.quantity > 0)
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

// Logic Step 2 (Locations)
const addLocation = () => {
  form.value.locations.push({
    id: Date.now(),
    venueId: '',
    isNewVenue: false,
    newVenueName: '',
    newVenueAddress: '',
    newVenueCity: '',
    dates: [{ id: Date.now(), date: '', startTime: '21:00', endTime: '04:00' }]
  })
}

const removeLocation = (index) => {
  form.value.locations.splice(index, 1)
}

const addDate = (locationIndex) => {
  form.value.locations[locationIndex].dates.push({ id: Date.now(), date: '', startTime: '21:00', endTime: '04:00' })
}

const removeDate = (locationIndex, dateIndex) => {
  form.value.locations[locationIndex].dates.splice(dateIndex, 1)
}

// Logic Step 3 (Tickets)
const addTicket = () => {
  form.value.tickets.push({ id: Date.now(), name: '', price: 0, quantity: 100, description: '' })
}

const removeTicket = (index) => {
  form.value.tickets.splice(index, 1)
}

// Submit
const isSubmitting = ref(false)
const submitError = ref('')
const submitSuccess = ref(false)

const submitEvent = async () => {
  isSubmitting.value = true
  submitError.value = ''
  
  try {
    const response = await fetch('/api/events/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form.value)
    })
    
    const result = await response.json()
    
    if (!response.ok) throw new Error(result.message || 'Error al crear evento')
    
    submitSuccess.value = true
    setTimeout(() => {
      window.location.href = `/dashboard/events/${result.id}`
    }, 2000)
    
  } catch (e) {
    submitError.value = e.message
  } finally {
    isSubmitting.value = false
  }
}

// Initialize with one location if empty
if (form.value.locations.length === 0) addLocation()
if (form.value.tickets.length === 0) addTicket()

</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm min-h-[600px] flex flex-col">
    <!-- Steps Header -->
    <div class="border-b border-gray-100 p-6">
      <div class="flex items-center justify-between max-w-2xl mx-auto">
        <div v-for="(step, index) in steps" :keyিতা="step.number" class="flex flex-col items-center relative z-10">
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
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
            <textarea v-model="form.general.description" rows="4" placeholder="¿De qué trata tu evento?" class="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-black outline-none"></textarea>
          </div>

           <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Imagen del Evento (Cover)</label>
            
            <input 
              type="file" 
              id="eventImageInput" 
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
                     {{ t.name }}: {{ t.quantity }} x ${{ t.price }}
                   </li>
                 </ul>
               </div>
             </div>
           </div>

           <div v-if="submitError" class="p-4 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100">
             {{ submitError }}
           </div>
           
           <div v-if="submitSuccess" class="p-4 bg-green-50 text-green-600 rounded-lg text-sm border border-green-100 font-bold text-center">
             ¡Evento creado exitosamente! Redirigiendo...
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
      <div v-else></div> <!-- Spacer -->

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
        {{ isSubmitting ? 'Creando...' : 'Publicar Evento' }}
      </button>
    </div>
  </div>
</template>
