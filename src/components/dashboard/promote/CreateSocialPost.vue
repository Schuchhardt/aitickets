<script setup>
import { ref, computed, watch } from 'vue'
import {
  ArrowLeft, ArrowRight, Check, Image, Instagram, Facebook,
  Sparkles, Upload, X, Loader2, Calendar, Clock, Send, Eye, Wand2
} from 'lucide-vue-next'

const props = defineProps({
  eventsJson: { type: String, default: '[]' },
  accountsJson: { type: String, default: '[]' },
  preSelectedEventId: { type: String, default: '' },
})

const events = ref(JSON.parse(props.eventsJson))
const accounts = ref(JSON.parse(props.accountsJson))

const currentStep = ref(1)
const totalSteps = 4

// Form state
const selectedEventId = ref(props.preSelectedEventId ? parseInt(props.preSelectedEventId) : null)
const postContent = ref('')
const imageUrls = ref([])
const selectedPlatforms = ref([])
const scheduledFor = ref('')
const isScheduled = ref(false)

// Loading states
const isGeneratingText = ref(false)
const isGeneratingImage = ref(false)
const isUploading = ref(false)
const isSubmitting = ref(false)
const isPublishing = ref(false)

const selectedEvent = computed(() => events.value.find(e => e.id === selectedEventId.value))

const connectedPlatforms = computed(() => {
  const platformIds = [...new Set(accounts.value.filter(a => a.status === 'active').map(a => a.platform))]
  return platformIds
})

const platformOptions = [
  { id: 'instagram', name: 'Instagram', icon: Instagram, maxChars: 2200 },
  { id: 'facebook', name: 'Facebook', icon: Facebook, maxChars: 63206 },
]

const availablePlatforms = computed(() =>
  platformOptions.filter(p => connectedPlatforms.value.includes(p.id))
)

const charLimit = computed(() => {
  if (!selectedPlatforms.value.length) return 2200
  return Math.min(...selectedPlatforms.value.map(p => {
    const opt = platformOptions.find(o => o.id === p)
    return opt?.maxChars || 2200
  }))
})

// Step validation
const isStep1Valid = computed(() => !!selectedEventId.value)
const isStep2Valid = computed(() => postContent.value.trim().length >= 10 && selectedPlatforms.value.length > 0)
const isStep3Valid = computed(() => true) // Preview is always valid
const isCurrentStepValid = computed(() => {
  switch (currentStep.value) {
    case 1: return isStep1Valid.value
    case 2: return isStep2Valid.value
    case 3: return isStep3Valid.value
    default: return true
  }
})

// Navigation
const nextStep = () => {
  if (currentStep.value < totalSteps && isCurrentStepValid.value) {
    currentStep.value++
  }
}
const prevStep = () => {
  if (currentStep.value > 1) currentStep.value--
}

// Image Upload
const fileInput = ref(null)
const triggerUpload = () => fileInput.value?.click()

const handleFileUpload = async (e) => {
  const file = e.target.files[0]
  if (!file) return
  
  if (imageUrls.value.length >= 4) {
    alert('Máximo 4 imágenes por post')
    return
  }

  isUploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('/api/promote/upload-image', { method: 'POST', body: formData })
    const data = await res.json()
    if (res.ok && data.url) {
      imageUrls.value.push(data.url)
    } else {
      alert(data.message || 'Error al subir imagen')
    }
  } catch (err) {
    alert('Error al subir imagen')
  } finally {
    isUploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

const removeImage = (index) => {
  imageUrls.value.splice(index, 1)
}

// AI Generation
const generateText = async (tone = '') => {
  if (!selectedEventId.value) return
  isGeneratingText.value = true
  try {
    const res = await fetch('/api/promote/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: selectedEventId.value, type: 'text', tone }),
    })
    const data = await res.json()
    if (res.ok && data.content) {
      postContent.value = data.content
    } else {
      alert(data.message || 'Error al generar texto')
    }
  } catch (err) {
    alert('Error al generar texto con IA')
  } finally {
    isGeneratingText.value = false
  }
}

const generateImage = async () => {
  if (!selectedEventId.value) return
  if (imageUrls.value.length >= 4) {
    alert('Máximo 4 imágenes por post')
    return
  }
  isGeneratingImage.value = true
  try {
    const res = await fetch('/api/promote/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: selectedEventId.value, type: 'image' }),
    })
    const data = await res.json()
    if (res.ok && data.imageUrl) {
      imageUrls.value.push(data.imageUrl)
    } else {
      alert(data.message || 'Error al generar imagen')
    }
  } catch (err) {
    alert('Error al generar imagen con IA')
  } finally {
    isGeneratingImage.value = false
  }
}

// Submit
const handleSubmitAndPublish = async () => {
  isSubmitting.value = true
  try {
    // 1. Create draft
    const createRes = await fetch('/api/promote/posts/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: selectedEventId.value,
        content: postContent.value,
        imageUrls: imageUrls.value,
        platforms: selectedPlatforms.value,
        scheduledFor: isScheduled.value && scheduledFor.value ? new Date(scheduledFor.value).toISOString() : null,
      }),
    })

    const createData = await createRes.json()
    if (!createRes.ok) {
      alert(createData.message || 'Error al crear post')
      return
    }

    // 2. Publish via Zernio
    isPublishing.value = true
    const publishRes = await fetch('/api/promote/posts/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: createData.id }),
    })

    const publishData = await publishRes.json()
    if (publishRes.ok) {
      window.location.href = '/dashboard/promote?published=true'
    } else {
      alert(publishData.message || 'Error al publicar. El post fue guardado como borrador.')
      window.location.href = '/dashboard/promote'
    }
  } catch (err) {
    alert('Error al publicar el post')
  } finally {
    isSubmitting.value = false
    isPublishing.value = false
  }
}

const handleSaveDraft = async () => {
  isSubmitting.value = true
  try {
    const res = await fetch('/api/promote/posts/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: selectedEventId.value,
        content: postContent.value,
        imageUrls: imageUrls.value,
        platforms: selectedPlatforms.value,
        scheduledFor: isScheduled.value && scheduledFor.value ? new Date(scheduledFor.value).toISOString() : null,
      }),
    })

    const data = await res.json()
    if (res.ok) {
      window.location.href = '/dashboard/promote'
    } else {
      alert(data.message || 'Error al guardar borrador')
    }
  } catch (err) {
    alert('Error al guardar el borrador')
  } finally {
    isSubmitting.value = false
  }
}

const toneOptions = [
  { value: '', label: 'Automático' },
  { value: 'profesional y elegante', label: 'Profesional' },
  { value: 'divertido y juvenil', label: 'Divertido' },
  { value: 'urgente y exclusivo', label: 'Urgente' },
  { value: 'informativo y detallado', label: 'Informativo' },
]
const selectedTone = ref('')
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-center gap-4 mb-8">
      <a href="/dashboard/promote" class="p-2 rounded-lg hover:bg-gray-100 transition">
        <ArrowLeft :size="20" class="text-gray-600" />
      </a>
      <div>
        <h1 class="text-3xl font-bold font-[Unbounded]">Crear Post</h1>
        <p class="text-gray-600">Publica contenido en tus redes sociales conectadas.</p>
      </div>
    </div>

    <!-- Step Indicator -->
    <div class="flex items-center justify-center gap-2 mb-8">
      <div v-for="step in totalSteps" :key="step" class="flex items-center gap-2">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors"
          :class="step <= currentStep ? 'bg-black text-white' : 'bg-gray-200 text-gray-500'"
        >
          <Check v-if="step < currentStep" :size="16" />
          <span v-else>{{ step }}</span>
        </div>
        <span
          v-if="step < totalSteps"
          class="w-12 h-0.5 transition-colors"
          :class="step < currentStep ? 'bg-black' : 'bg-gray-200'"
        ></span>
      </div>
    </div>

    <div class="max-w-3xl mx-auto">
      <!-- Step 1: Select Event -->
      <div v-if="currentStep === 1" class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 class="text-xl font-bold mb-1">Selecciona un Evento</h2>
        <p class="text-gray-500 text-sm mb-6">Elige el evento que deseas promocionar.</p>

        <div v-if="events.length === 0" class="text-center py-12">
          <Calendar :size="48" class="mx-auto mb-4 text-gray-300" />
          <h3 class="text-lg font-bold mb-2">No tienes eventos publicados</h3>
          <p class="text-gray-500 mb-4">Primero publica un evento para poder promocionarlo.</p>
          <a href="/dashboard/events/create" class="inline-flex items-center gap-2 bg-black text-white px-5 py-2.5 rounded-lg hover:bg-gray-800 transition font-medium">
            Crear Evento
          </a>
        </div>

        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            v-for="event in events"
            :key="event.id"
            @click="selectedEventId = event.id"
            class="text-left p-4 rounded-xl border-2 transition-all hover:shadow-md"
            :class="selectedEventId === event.id ? 'border-black bg-gray-50' : 'border-gray-100 hover:border-gray-300'"
          >
            <div class="aspect-video rounded-lg bg-gray-100 mb-3 overflow-hidden">
              <img v-if="event.image_url" :src="event.image_url" class="w-full h-full object-cover" :alt="event.title || event.name" />
              <div v-else class="w-full h-full flex items-center justify-center text-gray-300">
                <Calendar :size="32" />
              </div>
            </div>
            <h3 class="font-bold text-sm line-clamp-1">{{ event.title || event.name }}</h3>
            <p v-if="event.start_date" class="text-xs text-gray-500 mt-1">
              {{ new Date(event.start_date).toLocaleDateString('es-CL') }}
            </p>
          </button>
        </div>
      </div>

      <!-- Step 2: Compose Post -->
      <div v-if="currentStep === 2" class="space-y-6">
        <!-- Content Editor -->
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 class="text-xl font-bold mb-1">Compone tu Post</h2>
          <p class="text-gray-500 text-sm mb-6">Escribe el contenido o genera con IA.</p>

          <!-- AI Text Generation -->
          <div class="mb-4 p-4 bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl border border-purple-100">
            <div class="flex items-center gap-2 mb-3">
              <Sparkles :size="18" class="text-purple-600" />
              <span class="font-bold text-sm text-purple-800">Generar con IA</span>
            </div>
            <div class="flex flex-wrap gap-2">
              <select v-model="selectedTone" class="text-sm border border-purple-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-purple-300 focus:outline-none">
                <option v-for="t in toneOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
              <button
                @click="generateText(selectedTone)"
                :disabled="isGeneratingText"
                class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
              >
                <Loader2 v-if="isGeneratingText" :size="14" class="animate-spin" />
                <Wand2 v-else :size="14" />
                {{ isGeneratingText ? 'Generando...' : 'Generar Texto' }}
              </button>
            </div>
          </div>

          <!-- Text Area -->
          <div class="relative">
            <textarea
              v-model="postContent"
              placeholder="Escribe el contenido de tu post..."
              class="w-full h-40 border border-gray-200 rounded-xl p-4 text-sm resize-none focus:ring-2 focus:ring-black focus:border-black focus:outline-none"
              :maxlength="charLimit"
            ></textarea>
            <div class="absolute bottom-3 right-3 text-xs" :class="postContent.length > charLimit * 0.9 ? 'text-red-500' : 'text-gray-400'">
              {{ postContent.length }} / {{ charLimit }}
            </div>
          </div>
        </div>

        <!-- Image Section -->
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 class="font-bold mb-4">Imágenes</h3>

          <!-- Uploaded images preview -->
          <div v-if="imageUrls.length > 0" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div v-for="(url, index) in imageUrls" :key="index" class="relative aspect-square rounded-lg overflow-hidden bg-gray-100 group">
              <img :src="url" class="w-full h-full object-cover" />
              <button
                @click="removeImage(index)"
                class="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
              >
                <X :size="14" />
              </button>
            </div>
          </div>

          <div class="flex flex-wrap gap-3">
            <!-- Upload button -->
            <button
              @click="triggerUpload"
              :disabled="isUploading || imageUrls.length >= 4"
              class="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
            >
              <Loader2 v-if="isUploading" :size="16" class="animate-spin" />
              <Upload v-else :size="16" />
              {{ isUploading ? 'Subiendo...' : 'Subir Imagen' }}
            </button>
            <input ref="fileInput" type="file" accept="image/*" @change="handleFileUpload" class="hidden" />

            <!-- AI Image Generation -->
            <button
              @click="generateImage"
              :disabled="isGeneratingImage || imageUrls.length >= 4"
              class="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition disabled:opacity-50"
            >
              <Loader2 v-if="isGeneratingImage" :size="16" class="animate-spin" />
              <Sparkles v-else :size="16" />
              {{ isGeneratingImage ? 'Generando...' : 'Generar con IA' }}
            </button>
          </div>
          <p class="text-xs text-gray-400 mt-2">Máximo 4 imágenes. JPG, PNG, WebP. 5MB máx. cada una.</p>
        </div>

        <!-- Platform Selection -->
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 class="font-bold mb-4">Plataformas</h3>

          <div v-if="availablePlatforms.length === 0" class="text-center py-6">
            <p class="text-gray-500 text-sm mb-3">No tienes cuentas de redes sociales conectadas.</p>
            <a href="/dashboard/promote" class="text-sm text-purple-600 hover:text-purple-700 font-medium">
              Conectar cuentas →
            </a>
          </div>

          <div v-else class="flex flex-wrap gap-3">
            <button
              v-for="platform in availablePlatforms"
              :key="platform.id"
              @click="selectedPlatforms.includes(platform.id) ? selectedPlatforms = selectedPlatforms.filter(p => p !== platform.id) : selectedPlatforms.push(platform.id)"
              class="flex items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all"
              :class="selectedPlatforms.includes(platform.id) ? 'border-black bg-gray-50' : 'border-gray-100 hover:border-gray-300'"
            >
              <component :is="platform.icon" :size="20" />
              <span class="font-medium text-sm">{{ platform.name }}</span>
              <Check v-if="selectedPlatforms.includes(platform.id)" :size="16" class="text-green-600" />
            </button>
          </div>
        </div>

        <!-- Schedule -->
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold">Programar publicación</h3>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" v-model="isScheduled" class="sr-only peer" />
              <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-black"></div>
            </label>
          </div>

          <div v-if="isScheduled" class="flex gap-4">
            <input
              v-model="scheduledFor"
              type="datetime-local"
              class="flex-1 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-black focus:border-black focus:outline-none"
              :min="new Date().toISOString().slice(0, 16)"
            />
          </div>
          <p v-if="!isScheduled" class="text-sm text-gray-400">El post se publicará inmediatamente.</p>
        </div>
      </div>

      <!-- Step 3: Preview -->
      <div v-if="currentStep === 3" class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 class="text-xl font-bold mb-1">Vista Previa</h2>
        <p class="text-gray-500 text-sm mb-6">Así se verá tu post en redes sociales.</p>

        <!-- Mock social post -->
        <div class="max-w-md mx-auto border border-gray-200 rounded-xl overflow-hidden">
          <!-- Post header -->
          <div class="flex items-center gap-3 p-4">
            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
              {{ selectedEvent?.title?.[0] || selectedEvent?.name?.[0] || 'E' }}
            </div>
            <div>
              <p class="font-bold text-sm">{{ selectedEvent?.title || selectedEvent?.name || 'Tu evento' }}</p>
              <p class="text-xs text-gray-400">Ahora</p>
            </div>
          </div>

          <!-- Post image -->
          <div v-if="imageUrls.length > 0" class="aspect-square bg-gray-100">
            <img :src="imageUrls[0]" class="w-full h-full object-cover" />
          </div>

          <!-- Post content -->
          <div class="p-4">
            <p class="text-sm whitespace-pre-wrap">{{ postContent }}</p>
          </div>

          <!-- Post meta -->
          <div class="px-4 pb-4 flex items-center gap-3 text-xs text-gray-400">
            <span v-for="p in selectedPlatforms" :key="p" class="flex items-center gap-1 capitalize">
              <Instagram v-if="p === 'instagram'" :size="12" />
              <Facebook v-if="p === 'facebook'" :size="12" />
              {{ p }}
            </span>
            <span v-if="isScheduled && scheduledFor" class="flex items-center gap-1">
              <Clock :size="12" />
              {{ new Date(scheduledFor).toLocaleString('es-CL') }}
            </span>
          </div>
        </div>

        <!-- Multiple images indicator -->
        <div v-if="imageUrls.length > 1" class="flex justify-center gap-2 mt-4">
          <div v-for="(url, i) in imageUrls" :key="i" class="w-12 h-12 rounded-lg overflow-hidden border-2 border-gray-200">
            <img :src="url" class="w-full h-full object-cover" />
          </div>
        </div>
      </div>

      <!-- Step 4: Publish -->
      <div v-if="currentStep === 4" class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center">
        <h2 class="text-xl font-bold mb-1">{{ isScheduled ? 'Programar Post' : 'Publicar Post' }}</h2>
        <p class="text-gray-500 text-sm mb-8">
          {{ isScheduled ? 'Tu post se publicará en la fecha programada.' : 'Tu post se publicará ahora en las plataformas seleccionadas.' }}
        </p>

        <!-- Summary -->
        <div class="max-w-sm mx-auto text-left space-y-3 mb-8">
          <div class="flex items-center justify-between text-sm">
            <span class="text-gray-500">Evento</span>
            <span class="font-medium">{{ selectedEvent?.title || selectedEvent?.name }}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-gray-500">Plataformas</span>
            <span class="font-medium capitalize">{{ selectedPlatforms.join(', ') }}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-gray-500">Imágenes</span>
            <span class="font-medium">{{ imageUrls.length }}</span>
          </div>
          <div v-if="isScheduled && scheduledFor" class="flex items-center justify-between text-sm">
            <span class="text-gray-500">Programado para</span>
            <span class="font-medium">{{ new Date(scheduledFor).toLocaleString('es-CL') }}</span>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            @click="handleSaveDraft"
            :disabled="isSubmitting"
            class="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
          >
            Guardar Borrador
          </button>
          <button
            @click="handleSubmitAndPublish"
            :disabled="isSubmitting"
            class="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 transition disabled:opacity-50"
          >
            <Loader2 v-if="isSubmitting" :size="16" class="animate-spin" />
            <Send v-else :size="16" />
            {{ isSubmitting ? (isPublishing ? 'Publicando...' : 'Guardando...') : (isScheduled ? 'Programar' : 'Publicar Ahora') }}
          </button>
        </div>
      </div>

      <!-- Navigation Buttons -->
      <div class="flex justify-between mt-8">
        <button
          v-if="currentStep > 1"
          @click="prevStep"
          class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition"
        >
          <ArrowLeft :size="16" />
          Anterior
        </button>
        <div v-else></div>

        <button
          v-if="currentStep < totalSteps"
          @click="nextStep"
          :disabled="!isCurrentStepValid"
          class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Siguiente
          <ArrowRight :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>
