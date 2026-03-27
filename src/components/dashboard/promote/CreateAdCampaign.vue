<script setup>
import { ref, computed, watch } from 'vue'
import {
  ArrowLeft, ArrowRight, Check, Target, DollarSign, Image,
  Type, MapPin, Users, Calendar, Sparkles, Loader2, AlertCircle,
  ExternalLink
} from 'lucide-vue-next'

const props = defineProps({
  eventsJson: { type: String, default: '[]' },
  adConnectionsJson: { type: String, default: '[]' },
  preSelectedEventId: { type: String, default: '' },
})

const events = ref(JSON.parse(props.eventsJson))
const adConnections = ref(JSON.parse(props.adConnectionsJson))
// Auto-select first connection if only one
const adConnection = computed(() => adConnections.value.find(c => c.id === form.value.adConnectionId) || null)

const step = ref(1)
const totalSteps = 5
const submitting = ref(false)
const generating = ref(false)
const error = ref('')
const success = ref(false)

// Form data
const form = ref({
  eventId: props.preSelectedEventId ? parseInt(props.preSelectedEventId) : null,
  adConnectionId: adConnections.value.length === 1 ? adConnections.value[0].id : null,
  name: '',
  objective: 'OUTCOME_TRAFFIC',
  dailyBudget: 5000,
  totalBudget: null,
  startDate: '',
  endDate: '',
  adCopy: '',
  headline: '',
  imageUrls: [],
  callToAction: 'LEARN_MORE',
  destinationUrl: '',
  targetAudience: {
    age_min: 18,
    age_max: 65,
    genders: [],
    locations: [],
    interests: [],
  },
})

const selectedEvent = computed(() => events.value.find(e => e.id === form.value.eventId))

watch(() => form.value.eventId, (id) => {
  if (id) {
    const ev = events.value.find(e => e.id === id)
    if (ev) {
      form.value.name = `Campaña - ${ev.title || ev.name}`
      form.value.destinationUrl = `https://aitickets.cl/eventos/${ev.slug || ev.id}`
      if (ev.image_url) {
        form.value.imageUrls = [ev.image_url]
      }
    }
  }
})

const objectives = [
  { value: 'OUTCOME_TRAFFIC', label: 'Tráfico', desc: 'Envía personas a tu sitio web o evento' },
  { value: 'OUTCOME_AWARENESS', label: 'Reconocimiento', desc: 'Alcanza la mayor cantidad de personas posible' },
  { value: 'OUTCOME_ENGAGEMENT', label: 'Interacción', desc: 'Obtén más likes, comentarios y compartidos' },
]

const ctaOptions = [
  { value: 'LEARN_MORE', label: 'Más información' },
  { value: 'SHOP_NOW', label: 'Comprar ahora' },
  { value: 'SIGN_UP', label: 'Registrarse' },
  { value: 'GET_TICKETS', label: 'Obtener entradas' },
  { value: 'BOOK_NOW', label: 'Reservar ahora' },
]

const canProceed = computed(() => {
  switch (step.value) {
    case 1: return !!form.value.eventId && adConnections.value.length > 0 && !!form.value.adConnectionId
    case 2: return !!form.value.adCopy && !!form.value.destinationUrl
    case 3: return form.value.targetAudience.age_min >= 13
    case 4: return form.value.dailyBudget >= 1000 && !!form.value.name
    case 5: return true
    default: return false
  }
})

const generateAdCopy = async () => {
  if (!selectedEvent.value) return
  generating.value = true
  try {
    const ev = selectedEvent.value
    const res = await fetch('/api/promote/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'text',
        eventId: ev.id,
        eventName: ev.title || ev.name,
        eventDescription: ev.description || '',
        tone: 'promotional',
      }),
    })
    const data = await res.json()
    if (res.ok && data.content) {
      form.value.adCopy = data.content
      // Extract first line as headline if empty
      if (!form.value.headline) {
        const firstLine = data.content.split('\n')[0].replace(/[#*]/g, '').trim()
        form.value.headline = firstLine.substring(0, 40)
      }
    }
  } catch (e) {
    console.error('Generate error:', e)
  } finally {
    generating.value = false
  }
}

const generateImage = async () => {
  if (!selectedEvent.value) return
  generating.value = true
  try {
    const ev = selectedEvent.value
    const res = await fetch('/api/promote/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'image',
        eventId: ev.id,
        eventName: ev.title || ev.name,
        eventDescription: ev.description || '',
      }),
    })
    const data = await res.json()
    if (res.ok && data.imageUrl) {
      form.value.imageUrls = [data.imageUrl, ...form.value.imageUrls].slice(0, 3)
    }
  } catch (e) {
    console.error('Generate image error:', e)
  } finally {
    generating.value = false
  }
}

const removeImage = (index) => {
  form.value.imageUrls.splice(index, 1)
}

const submit = async () => {
  submitting.value = true
  error.value = ''
  try {
    const res = await fetch('/api/promote/ads/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: form.value.eventId,
        adConnectionId: form.value.adConnectionId,
        name: form.value.name,
        objective: form.value.objective,
        dailyBudget: form.value.dailyBudget,
        totalBudget: form.value.totalBudget || null,
        startDate: form.value.startDate || null,
        endDate: form.value.endDate || null,
        adCopy: form.value.adCopy,
        headline: form.value.headline,
        imageUrls: form.value.imageUrls,
        callToAction: form.value.callToAction,
        destinationUrl: form.value.destinationUrl,
        targetAudience: form.value.targetAudience,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      success.value = true
    } else {
      error.value = data.message || 'Error al crear la campaña'
    }
  } catch (e) {
    error.value = 'Error de conexión'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-8">
      <a href="/dashboard/promote/ads" class="text-gray-400 hover:text-gray-600 transition">
        <ArrowLeft :size="20" />
      </a>
      <div>
        <h1 class="text-2xl font-bold font-[Unbounded]">Crear Campaña</h1>
        <p class="text-sm text-gray-500 mt-1">Paso {{ step }} de {{ totalSteps }}</p>
      </div>
    </div>

    <!-- Progress Bar -->
    <div class="flex gap-2 mb-8">
      <div
        v-for="s in totalSteps"
        :key="s"
        class="h-1.5 flex-1 rounded-full transition-colors"
        :class="s <= step ? 'bg-black' : 'bg-gray-200'"
      />
    </div>

    <!-- Success State -->
    <div v-if="success" class="text-center py-12">
      <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Check :size="32" class="text-green-600" />
      </div>
      <h2 class="text-xl font-bold mb-2">¡Campaña creada!</h2>
      <p class="text-gray-500 mb-6">Tu campaña fue creada en estado pausado. Actívala desde el panel de campañas.</p>
      <a
        href="/dashboard/promote/ads"
        class="inline-flex items-center gap-2 bg-black text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition font-medium"
      >
        Ver Campañas
      </a>
    </div>

    <!-- No Connection Warning -->
    <div v-else-if="adConnections.length === 0" class="text-center py-12">
      <div class="w-16 h-16 bg-yellow-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <AlertCircle :size="32" class="text-yellow-600" />
      </div>
      <h2 class="text-xl font-bold mb-2">Conecta tu cuenta de Meta Ads</h2>
      <p class="text-gray-500 mb-6">Primero necesitas vincular tu cuenta de Meta Business para crear campañas.</p>
      <a
        href="/dashboard/promote/ads"
        class="inline-flex items-center gap-2 bg-[#1877F2] text-white px-6 py-3 rounded-lg hover:bg-[#1565C0] transition font-medium"
      >
        Ir a conectar
      </a>
    </div>

    <div v-else>
      <!-- Step 1: Select Event -->
      <div v-show="step === 1">
        <h2 class="text-lg font-semibold mb-1">Selecciona un evento</h2>
        <p class="text-gray-500 text-sm mb-6">Elige el evento que quieres promocionar con Meta Ads.</p>

        <div v-if="events.length === 0" class="text-center py-8 bg-gray-50 rounded-xl">
          <p class="text-gray-500">No tienes eventos publicados.</p>
          <a href="/dashboard/events/create" class="text-blue-600 text-sm mt-2 inline-block">Crear un evento</a>
        </div>

        <div v-else class="grid gap-3">
          <button
            v-for="event in events"
            :key="event.id"
            @click="form.eventId = event.id"
            class="flex items-center gap-4 p-4 rounded-xl border-2 transition text-left w-full"
            :class="form.eventId === event.id ? 'border-black bg-gray-50' : 'border-gray-100 hover:border-gray-300'"
          >
            <img
              v-if="event.image_url"
              :src="event.image_url"
              :alt="event.title || event.name"
              class="w-16 h-16 rounded-lg object-cover shrink-0"
            />
            <div class="w-16 h-16 bg-gray-200 rounded-lg shrink-0 flex items-center justify-center" v-else>
              <Image :size="24" class="text-gray-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-semibold truncate">{{ event.title || event.name }}</p>
              <p v-if="event.event_dates?.[0]" class="text-sm text-gray-500">
                {{ new Date(event.event_dates[0].date).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }) }}
              </p>
            </div>
            <div
              class="w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center"
              :class="form.eventId === event.id ? 'border-black bg-black' : 'border-gray-300'"
            >
              <Check v-if="form.eventId === event.id" :size="12" class="text-white" />
            </div>
          </button>
        </div>

        <!-- Ad Account Selector (shown when multiple accounts) -->
        <div v-if="adConnections.length > 1" class="mt-6">
          <h3 class="text-sm font-medium text-gray-700 mb-3">Cuenta de anuncios</h3>
          <div class="grid gap-2">
            <button
              v-for="conn in adConnections"
              :key="conn.id"
              @click="form.adConnectionId = conn.id"
              class="flex items-center gap-3 p-3 rounded-xl border-2 transition text-left w-full"
              :class="form.adConnectionId === conn.id ? 'border-black bg-gray-50' : 'border-gray-100 hover:border-gray-300'"
            >
              <div class="w-10 h-10 bg-gradient-to-br from-[#1877F2] to-[#0866FF] rounded-lg flex items-center justify-center shrink-0">
                <svg class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-sm truncate">{{ conn.account_name }}</p>
                <p class="text-xs text-gray-400">{{ conn.meta_ad_account_id }}</p>
              </div>
              <div
                class="w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center"
                :class="form.adConnectionId === conn.id ? 'border-black bg-black' : 'border-gray-300'"
              >
                <Check v-if="form.adConnectionId === conn.id" :size="12" class="text-white" />
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- Step 2: Creative -->
      <div v-show="step === 2">
        <h2 class="text-lg font-semibold mb-1">Contenido del anuncio</h2>
        <p class="text-gray-500 text-sm mb-6">Escribe o genera con IA el texto y las imágenes de tu anuncio.</p>

        <!-- Ad Copy -->
        <div class="mb-5">
          <div class="flex items-center justify-between mb-2">
            <label class="block text-sm font-medium text-gray-700">Texto del anuncio *</label>
            <button
              @click="generateAdCopy"
              :disabled="generating"
              class="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 font-medium"
            >
              <Sparkles :size="12" />
              {{ generating ? 'Generando...' : 'Generar con IA' }}
            </button>
          </div>
          <textarea
            v-model="form.adCopy"
            rows="4"
            class="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Describe tu evento de forma atractiva para captar la atención..."
          />
        </div>

        <!-- Headline -->
        <div class="mb-5">
          <label class="block text-sm font-medium text-gray-700 mb-2">Título del anuncio</label>
          <input
            v-model="form.headline"
            type="text"
            maxlength="40"
            class="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Título corto y llamativo"
          />
          <p class="text-xs text-gray-400 mt-1">{{ form.headline.length }}/40</p>
        </div>

        <!-- Destination URL -->
        <div class="mb-5">
          <label class="block text-sm font-medium text-gray-700 mb-2">URL de destino *</label>
          <input
            v-model="form.destinationUrl"
            type="url"
            class="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="https://aitickets.cl/eventos/mi-evento"
          />
        </div>

        <!-- Call to Action -->
        <div class="mb-5">
          <label class="block text-sm font-medium text-gray-700 mb-2">Botón de acción</label>
          <select
            v-model="form.callToAction"
            class="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10 bg-white"
          >
            <option v-for="cta in ctaOptions" :key="cta.value" :value="cta.value">{{ cta.label }}</option>
          </select>
        </div>

        <!-- Images -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="block text-sm font-medium text-gray-700">Imágenes</label>
            <button
              @click="generateImage"
              :disabled="generating"
              class="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 font-medium"
            >
              <Sparkles :size="12" />
              {{ generating ? 'Generando...' : 'Generar con IA' }}
            </button>
          </div>
          <div class="flex flex-wrap gap-3">
            <div
              v-for="(img, i) in form.imageUrls"
              :key="i"
              class="relative w-24 h-24 rounded-xl overflow-hidden group"
            >
              <img :src="img" class="w-full h-full object-cover" />
              <button
                @click="removeImage(i)"
                class="absolute inset-0 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-sm"
              >
                &times;
              </button>
            </div>
          </div>
          <p class="text-xs text-gray-400 mt-2">Tamaño recomendado: 1080x1080px. Facebook e Instagram.</p>
        </div>
      </div>

      <!-- Step 3: Targeting -->
      <div v-show="step === 3">
        <h2 class="text-lg font-semibold mb-1">Audiencia</h2>
        <p class="text-gray-500 text-sm mb-6">Define a quién quieres llegar con tu anuncio.</p>

        <!-- Age Range -->
        <div class="mb-5">
          <label class="block text-sm font-medium text-gray-700 mb-2">Rango de edad</label>
          <div class="flex items-center gap-3">
            <input
              v-model.number="form.targetAudience.age_min"
              type="number"
              min="13"
              max="65"
              class="w-24 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-center focus:outline-none focus:ring-2 focus:ring-black/10"
            />
            <span class="text-gray-400">a</span>
            <input
              v-model.number="form.targetAudience.age_max"
              type="number"
              min="13"
              max="65"
              class="w-24 px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-center focus:outline-none focus:ring-2 focus:ring-black/10"
            />
            <span class="text-sm text-gray-500">años</span>
          </div>
        </div>

        <!-- Gender -->
        <div class="mb-5">
          <label class="block text-sm font-medium text-gray-700 mb-2">Género</label>
          <div class="flex gap-3">
            <button
              @click="form.targetAudience.genders = []"
              class="px-4 py-2 rounded-lg border text-sm font-medium transition"
              :class="form.targetAudience.genders.length === 0 ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-300'"
            >
              Todos
            </button>
            <button
              @click="form.targetAudience.genders = [1]"
              class="px-4 py-2 rounded-lg border text-sm font-medium transition"
              :class="form.targetAudience.genders.includes(1) && form.targetAudience.genders.length === 1 ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-300'"
            >
              Hombres
            </button>
            <button
              @click="form.targetAudience.genders = [2]"
              class="px-4 py-2 rounded-lg border text-sm font-medium transition"
              :class="form.targetAudience.genders.includes(2) && form.targetAudience.genders.length === 1 ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-300'"
            >
              Mujeres
            </button>
          </div>
        </div>

        <!-- Location -->
        <div class="mb-5">
          <label class="block text-sm font-medium text-gray-700 mb-2">Ubicación</label>
          <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
            <MapPin :size="16" class="inline mr-1" />
            Por defecto se mostrará en todo Chile. El targeting avanzado por ciudades estará disponible próximamente.
          </div>
        </div>

        <!-- Objective -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Objetivo de campaña</label>
          <div class="space-y-3">
            <button
              v-for="obj in objectives"
              :key="obj.value"
              @click="form.objective = obj.value"
              class="flex items-start gap-3 w-full p-4 rounded-xl border-2 transition text-left"
              :class="form.objective === obj.value ? 'border-black bg-gray-50' : 'border-gray-100 hover:border-gray-300'"
            >
              <div
                class="w-5 h-5 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center"
                :class="form.objective === obj.value ? 'border-black bg-black' : 'border-gray-300'"
              >
                <Check v-if="form.objective === obj.value" :size="12" class="text-white" />
              </div>
              <div>
                <p class="font-medium text-sm">{{ obj.label }}</p>
                <p class="text-xs text-gray-500 mt-0.5">{{ obj.desc }}</p>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- Step 4: Budget & Schedule -->
      <div v-show="step === 4">
        <h2 class="text-lg font-semibold mb-1">Presupuesto y duración</h2>
        <p class="text-gray-500 text-sm mb-6">Define cuánto invertir y durante cuánto tiempo.</p>

        <!-- Campaign Name -->
        <div class="mb-5">
          <label class="block text-sm font-medium text-gray-700 mb-2">Nombre de la campaña *</label>
          <input
            v-model="form.name"
            type="text"
            class="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Ej: Campaña Festival de Verano"
          />
        </div>

        <!-- Daily Budget -->
        <div class="mb-5">
          <label class="block text-sm font-medium text-gray-700 mb-2">Presupuesto diario (CLP) *</label>
          <div class="relative">
            <span class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              v-model.number="form.dailyBudget"
              type="number"
              min="1000"
              step="500"
              class="w-full pl-8 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            />
          </div>
          <p class="text-xs text-gray-400 mt-1">Mínimo: $1.000 CLP/día</p>
        </div>

        <!-- Total Budget (optional) -->
        <div class="mb-5">
          <label class="block text-sm font-medium text-gray-700 mb-2">Presupuesto total (opcional)</label>
          <div class="relative">
            <span class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              v-model.number="form.totalBudget"
              type="number"
              min="0"
              step="1000"
              class="w-full pl-8 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
              placeholder="Sin límite"
            />
          </div>
        </div>

        <!-- Dates -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Fecha inicio</label>
            <input
              v-model="form.startDate"
              type="date"
              class="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Fecha fin</label>
            <input
              v-model="form.endDate"
              type="date"
              class="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
            />
          </div>
        </div>
      </div>

      <!-- Step 5: Review -->
      <div v-show="step === 5">
        <h2 class="text-lg font-semibold mb-1">Revisar campaña</h2>
        <p class="text-gray-500 text-sm mb-6">Revisa los detalles antes de crear la campaña.</p>

        <div class="space-y-4">
          <!-- Event -->
          <div class="bg-white rounded-xl border border-gray-100 p-4">
            <p class="text-xs font-medium text-gray-400 uppercase mb-2">Evento</p>
            <p class="font-semibold">{{ selectedEvent?.title || selectedEvent?.name }}</p>
          </div>

          <!-- Creative Preview -->
          <div class="bg-white rounded-xl border border-gray-100 p-4">
            <p class="text-xs font-medium text-gray-400 uppercase mb-3">Anuncio</p>
            <!-- Ad Preview Card -->
            <div class="border border-gray-200 rounded-xl overflow-hidden max-w-sm">
              <img
                v-if="form.imageUrls[0]"
                :src="form.imageUrls[0]"
                class="w-full h-48 object-cover"
              />
              <div class="p-4">
                <p class="font-semibold text-sm mb-1">{{ form.headline || form.name }}</p>
                <p class="text-xs text-gray-600 line-clamp-3">{{ form.adCopy }}</p>
                <div class="mt-3 flex items-center justify-between">
                  <span class="text-xs text-gray-400">{{ form.destinationUrl }}</span>
                  <span class="bg-gray-100 text-gray-600 text-xs px-3 py-1 rounded font-medium">
                    {{ ctaOptions.find(c => c.value === form.callToAction)?.label || 'Más información' }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Targeting -->
          <div class="bg-white rounded-xl border border-gray-100 p-4">
            <p class="text-xs font-medium text-gray-400 uppercase mb-2">Audiencia</p>
            <div class="flex flex-wrap gap-2 text-sm">
              <span class="bg-gray-100 px-3 py-1 rounded-lg text-gray-700">
                {{ form.targetAudience.age_min }}-{{ form.targetAudience.age_max }} años
              </span>
              <span class="bg-gray-100 px-3 py-1 rounded-lg text-gray-700">
                {{ form.targetAudience.genders.length === 0 ? 'Todos los géneros' : form.targetAudience.genders.includes(1) ? 'Hombres' : 'Mujeres' }}
              </span>
              <span class="bg-gray-100 px-3 py-1 rounded-lg text-gray-700">Chile</span>
              <span class="bg-gray-100 px-3 py-1 rounded-lg text-gray-700">
                {{ objectives.find(o => o.value === form.objective)?.label }}
              </span>
            </div>
          </div>

          <!-- Budget -->
          <div class="bg-white rounded-xl border border-gray-100 p-4">
            <p class="text-xs font-medium text-gray-400 uppercase mb-2">Presupuesto</p>
            <div class="flex flex-wrap gap-4 text-sm">
              <div>
                <span class="text-gray-500">Diario:</span>
                <span class="font-semibold ml-1">${{ form.dailyBudget?.toLocaleString('es-CL') }} CLP</span>
              </div>
              <div v-if="form.totalBudget">
                <span class="text-gray-500">Total:</span>
                <span class="font-semibold ml-1">${{ form.totalBudget?.toLocaleString('es-CL') }} CLP</span>
              </div>
              <div v-if="form.startDate">
                <span class="text-gray-500">Desde:</span>
                <span class="font-semibold ml-1">{{ new Date(form.startDate).toLocaleDateString('es-CL') }}</span>
              </div>
              <div v-if="form.endDate">
                <span class="text-gray-500">Hasta:</span>
                <span class="font-semibold ml-1">{{ new Date(form.endDate).toLocaleDateString('es-CL') }}</span>
              </div>
            </div>
          </div>

          <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
            <AlertCircle :size="16" class="inline mr-1" />
            La campaña se creará en estado <strong>pausado</strong>. Podrás activarla desde el panel de campañas cuando estés listo.
          </div>
        </div>

        <p v-if="error" class="text-red-500 text-sm mt-4 flex items-center gap-1">
          <AlertCircle :size="14" />
          {{ error }}
        </p>
      </div>

      <!-- Navigation -->
      <div class="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
        <button
          v-if="step > 1"
          @click="step--"
          class="flex items-center gap-2 text-gray-600 hover:text-black transition font-medium"
        >
          <ArrowLeft :size="16" />
          Atrás
        </button>
        <div v-else></div>

        <button
          v-if="step < totalSteps"
          @click="step++"
          :disabled="!canProceed"
          class="flex items-center gap-2 bg-black text-white px-6 py-2.5 rounded-lg hover:bg-gray-800 transition font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Siguiente
          <ArrowRight :size="16" />
        </button>

        <button
          v-if="step === totalSteps"
          @click="submit"
          :disabled="submitting"
          class="flex items-center gap-2 bg-black text-white px-6 py-2.5 rounded-lg hover:bg-gray-800 transition font-medium disabled:opacity-60"
        >
          <Loader2 v-if="submitting" :size="16" class="animate-spin" />
          <Target v-else :size="16" />
          {{ submitting ? 'Creando...' : 'Crear Campaña' }}
        </button>
      </div>
    </div>
  </div>
</template>
