<script setup>
// Foto de una sección del sitio: vista previa, subir/cambiar y quitar. Se achica en el navegador y el servidor la optimiza
// (uploadSiteImage). Con full (límite de fotos del sitio alcanzado) no deja subir una nueva, pero sí cambiar la actual.
import { ref } from 'vue'
import { ImagePlus, Trash2 } from 'lucide-vue-next'
import { uploadSiteImage } from '../siteApi.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  kind: { type: String, default: 'gallery' },
  label: { type: String, default: 'Foto' },
  hint: { type: String, default: '' },
  full: { type: Boolean, default: false },
  /** Proporción de la miniatura (CSS aspect-ratio). */
  aspect: { type: String, default: '4 / 3' },
  compact: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'error'])
const uploading = ref(false)
const input = ref(null)

async function onFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  uploading.value = true
  try {
    emit('update:modelValue', await uploadSiteImage(file, props.kind))
  } catch (e) {
    emit('error', e.message)
  } finally {
    uploading.value = false
  }
}
const blocked = () => props.full && !props.modelValue
</script>

<template>
  <div :class="compact ? 'flex items-center gap-3' : 'space-y-1.5'">
    <span v-if="!compact" class="block text-xs font-semibold text-gray-600">{{ label }}</span>
    <div :class="compact ? 'w-16 shrink-0' : 'w-full'">
      <button
        type="button"
        class="relative w-full overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-50 hover:border-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
        :style="{ aspectRatio: aspect }"
        :disabled="uploading || blocked()"
        :aria-label="modelValue ? `Cambiar ${label.toLowerCase()}` : `Subir ${label.toLowerCase()}`"
        @click="input?.click()"
      >
        <img v-if="modelValue" :src="modelValue" alt="" class="absolute inset-0 h-full w-full object-cover" />
        <span v-else class="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-gray-500">
          <ImagePlus size="18" />
          <span v-if="!compact">{{ uploading ? 'Subiendo…' : blocked() ? 'Límite de fotos alcanzado' : 'Subir foto' }}</span>
        </span>
        <span v-if="uploading && modelValue" class="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-semibold">Subiendo…</span>
      </button>
    </div>
    <div class="flex items-center gap-3 text-xs" :class="compact ? 'flex-col items-start gap-1' : ''">
      <span v-if="compact" class="font-semibold text-gray-600">{{ label }}</span>
      <button v-if="modelValue" type="button" class="underline text-gray-600" :disabled="uploading" @click="input?.click()">Cambiar</button>
      <button v-if="modelValue" type="button" class="inline-flex items-center gap-1 text-gray-500 hover:text-red-600" @click="emit('update:modelValue', '')"><Trash2 size="12" /> Quitar</button>
      <span v-if="hint && !compact" class="text-gray-500">{{ hint }}</span>
    </div>
    <input ref="input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" @change="onFile" />
  </div>
</template>
