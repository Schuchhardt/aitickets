<script setup>
// Video subido de una sección (portada de fondo, Video, Imagen y texto). Mismas reglas que el video del evento: MP4,
// WEBM o MOV, peso y duración máximos, subida directa a Storage con barra de progreso y póster (uploadSiteVideo).
import { ref } from 'vue'
import { Film, Trash2 } from 'lucide-vue-next'
import { uploadSiteVideo } from '../siteApi.js'
import { SITE_VIDEO_MAX_BYTES, SITE_VIDEO_MAX_SECONDS } from '../../../../lib/siteTemplates'

const props = defineProps({
  modelValue: { type: Object, default: null },
  label: { type: String, default: 'Video' },
  hint: { type: String, default: '' },
  /** Límite de videos del sitio alcanzado (se puede cambiar el actual, no agregar uno nuevo). */
  full: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'error'])
const busy = ref(false)
const progress = ref(0)
const input = ref(null)

async function onFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  busy.value = true
  progress.value = 0
  try {
    emit('update:modelValue', await uploadSiteVideo(file, { onProgress: (p) => (progress.value = p) }))
  } catch (e) {
    emit('error', e.message)
  } finally {
    busy.value = false
  }
}
const mb = Math.round(SITE_VIDEO_MAX_BYTES / (1024 * 1024))
const minutes = Math.round(SITE_VIDEO_MAX_SECONDS / 60)
</script>

<template>
  <div class="space-y-1.5">
    <span class="block text-xs font-semibold text-gray-600">{{ label }}</span>
    <video v-if="modelValue && !busy" :key="modelValue.url" :src="modelValue.url" :poster="modelValue.poster_url || undefined" controls muted playsinline preload="metadata" class="w-full max-h-48 rounded-lg bg-black"></video>
    <button
      v-else
      type="button"
      class="w-full rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-center hover:border-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
      :disabled="busy || full"
      @click="input?.click()"
    >
      <Film size="18" class="mx-auto text-gray-400" />
      <span class="mt-1 block text-xs font-medium text-gray-700">{{ busy ? `Subiendo video… ${progress}%` : full ? 'Límite de videos del sitio alcanzado' : 'Subir video' }}</span>
      <span class="block text-[11px] text-gray-500">MP4 (recomendado), WEBM o MOV · máx. {{ mb }} MB y {{ minutes }} min</span>
    </button>
    <div v-if="busy" class="h-1.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" aria-label="Subida del video">
      <div class="h-full bg-violet-600 transition-all" :style="{ width: `${progress}%` }"></div>
    </div>
    <div v-if="modelValue && !busy" class="flex items-center gap-3 text-xs">
      <button type="button" class="underline text-gray-600" @click="input?.click()">Cambiar</button>
      <button type="button" class="inline-flex items-center gap-1 text-gray-500 hover:text-red-600" @click="emit('update:modelValue', null)"><Trash2 size="12" /> Quitar</button>
    </div>
    <p v-if="hint" class="text-[11px] text-gray-500">{{ hint }}</p>
    <input ref="input" type="file" accept="video/mp4,video/webm,video/quicktime" class="hidden" @change="onFile" />
  </div>
</template>
