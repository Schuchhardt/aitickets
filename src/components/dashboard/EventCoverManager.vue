<script setup>
// Portada del evento en el detalle del panel: vista previa Desktop/Mobile, ajuste del encuadre,
// subir otra imagen o generarla con IA (también a partir de la actual). Guarda en /api/events/cover.
import { computed, ref } from 'vue'
import { Sparkles, UploadCloud, SlidersHorizontal, Trash2, Image as ImageIcon } from 'lucide-vue-next'
import CoverAdjuster from '../events/CoverAdjuster.vue'

const props = defineProps({
  eventId: { type: Number, required: true },
  eventName: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  coverSettings: { type: Object, default: null },
})

const image = ref(props.imageUrl || '')
const settings = ref(props.coverSettings)
const savedSettings = ref(JSON.stringify(props.coverSettings))
const adjusting = ref(false)
const busy = ref('')
const error = ref('')
const notice = ref('')

// IA
const aiOpen = ref(false)
const aiGuide = ref('')
const aiUseCurrent = ref(true)
const candidate = ref('')

const previewUrl = computed(() => candidate.value || image.value)
const dirty = computed(() => JSON.stringify(settings.value) !== savedSettings.value)

const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || 'Ocurrió un error')
  return data
}

const run = async (label, fn) => {
  busy.value = label
  error.value = ''
  notice.value = ''
  try { await fn() } catch (e) { error.value = e.message } finally { busy.value = '' }
}

const saveImage = (url) => run('save', async () => {
  await post('/api/events/cover', { eventId: props.eventId, imageUrl: url })
  image.value = url
  candidate.value = ''
  aiOpen.value = false
  notice.value = url ? 'Portada actualizada.' : 'Portada eliminada.'
  if (!url) { settings.value = null; savedSettings.value = 'null' }
})

const saveSettings = () => run('settings', async () => {
  await post('/api/events/cover', { eventId: props.eventId, coverSettings: settings.value })
  savedSettings.value = JSON.stringify(settings.value)
  adjusting.value = false
  notice.value = 'Ajuste guardado.'
})

const cancelAdjust = () => {
  settings.value = JSON.parse(savedSettings.value)
  adjusting.value = false
}

// Subir imagen
const fileInput = ref(null)
const onFile = async (e) => {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) { error.value = 'Solo se permiten imágenes.'; return }
  if (file.size > 5 * 1024 * 1024) { error.value = 'La imagen no debe superar los 5MB.'; return }
  await run('upload', async () => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/events/upload-image', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'Error al subir la imagen')
    await post('/api/events/cover', { eventId: props.eventId, imageUrl: data.url })
    image.value = data.url
    candidate.value = ''
    notice.value = 'Portada actualizada.'
  })
}

const generate = () => run('ai', async () => {
  const data = await post('/api/events/ai', {
    action: 'cover',
    eventId: props.eventId,
    guide: aiGuide.value,
    useCurrentAsReference: Boolean(image.value) && aiUseCurrent.value,
  })
  candidate.value = data.url
})

const remove = () => {
  if (confirm('¿Quitar la imagen de portada?')) saveImage('')
}
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" data-testid="event-cover">
    <div class="p-4 sm:p-6 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
      <h3 class="font-bold text-lg flex items-center gap-2"><ImageIcon size="18" /> Portada</h3>
      <div class="flex flex-wrap gap-2">
        <button v-if="image && !candidate && !adjusting" type="button" :disabled="!!busy" @click="adjusting = true"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          <SlidersHorizontal size="15" /> Ajustar
        </button>
        <button type="button" :disabled="!!busy" @click="fileInput?.click()"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          <UploadCloud size="15" /> {{ busy === 'upload' ? 'Subiendo...' : image ? 'Cambiar' : 'Subir' }}
        </button>
        <button type="button" :disabled="!!busy" @click="aiOpen = !aiOpen; adjusting = false"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg disabled:opacity-50"
          :class="aiOpen ? 'bg-black text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'">
          <Sparkles size="15" /> {{ image ? 'Editar / generar con IA' : 'Generar con IA' }}
        </button>
        <button v-if="image && !candidate" type="button" :disabled="!!busy" title="Quitar portada" @click="remove"
          class="p-2 sm:p-1.5 text-gray-400 hover:text-red-600 rounded-lg disabled:opacity-50">
          <Trash2 size="16" />
        </button>
      </div>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFile" />
    </div>

    <div class="p-4 sm:p-6 space-y-4">
      <!-- Panel IA -->
      <div v-if="aiOpen" class="rounded-xl border border-purple-100 bg-purple-50/50 p-4 space-y-3">
        <label class="block text-sm font-medium text-gray-800">
          Indicaciones (opcional)
          <textarea v-model="aiGuide" rows="2" maxlength="1000"
            :placeholder="image ? 'Ej: más nocturna, tonos neón, agrega humo en el escenario' : 'Ej: escenario íntimo con luz cálida, público de espaldas, estilo fotográfico'"
            class="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm outline-none focus:ring-2 focus:ring-black"></textarea>
        </label>
        <label v-if="image" class="flex items-center gap-2 text-sm text-gray-700">
          <input v-model="aiUseCurrent" type="checkbox" class="w-4 h-4 rounded border-gray-300" />
          Partir de la portada actual (editarla en vez de crear una nueva)
        </label>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" :disabled="!!busy" @click="generate"
            class="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-900 disabled:opacity-60">
            <span v-if="busy === 'ai'" class="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full"></span>
            <Sparkles v-else size="15" />
            {{ busy === 'ai' ? 'Generando (puede tardar ~1 min)...' : candidate ? 'Generar otra' : 'Generar imagen' }}
          </button>
          <template v-if="candidate">
            <button type="button" :disabled="!!busy" @click="saveImage(candidate)"
              class="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-60">
              Usar como portada
            </button>
            <button type="button" :disabled="!!busy" @click="candidate = ''"
              class="px-4 py-2 text-sm font-medium text-gray-600 hover:text-black">Descartar</button>
          </template>
        </div>
        <p v-if="candidate" class="text-xs text-purple-700">Vista previa de la imagen generada: aún no se guarda.</p>
      </div>

      <CoverAdjuster
        v-if="previewUrl"
        v-model="settings"
        :imageUrl="previewUrl"
        :eventName="eventName"
        :editable="adjusting && !candidate"
      />
      <button v-else type="button" @click="fileInput?.click()"
        class="w-full border-2 border-dashed border-gray-300 rounded-xl p-6 sm:p-10 flex flex-col items-center text-center hover:border-gray-400 hover:bg-gray-50 transition">
        <UploadCloud size="28" class="text-gray-400 mb-3" />
        <span class="font-medium text-gray-900">Este evento no tiene portada</span>
        <span class="text-xs text-gray-500 mt-1">Sube una imagen (JPG, PNG o WEBP, máx. 5MB) o genérala con IA.</span>
      </button>

      <div v-if="adjusting && !candidate" class="flex flex-wrap items-center gap-2">
        <button type="button" :disabled="!!busy || !dirty" @click="saveSettings"
          class="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-900 disabled:opacity-50">
          {{ busy === 'settings' ? 'Guardando...' : 'Guardar ajuste' }}
        </button>
        <button type="button" :disabled="!!busy" @click="cancelAdjust" class="px-4 py-2 text-sm font-medium text-gray-600 hover:text-black">Cancelar</button>
      </div>

      <p v-if="error" class="text-sm text-red-600" role="alert">{{ error }}</p>
      <p v-else-if="notice" class="text-sm text-green-700" role="status">{{ notice }}</p>
    </div>
  </section>
</template>
