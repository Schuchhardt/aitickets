<script setup>
// Vista previa y ajuste de la portada del evento (events.cover_settings), con pestañas Desktop / Mobile.
// Con `editable` se puede arrastrar la imagen hacia arriba/abajo para encuadrarla y se muestran los controles.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Monitor, Smartphone, RotateCcw } from 'lucide-vue-next'
import { COVER_LIMITS, DEFAULT_COVER_SETTINGS, normalizeCoverSettings } from '../../lib/eventCover'

const props = defineProps({
  imageUrl: { type: String, required: true },
  eventName: { type: String, default: '' },
  modelValue: { type: Object, default: null },
  editable: { type: Boolean, default: true },
})
const emit = defineEmits(['update:modelValue'])

// Ancho de referencia de cada dispositivo (px) para dibujar la vista previa a escala
const VIEWPORT = { desktop: 1280, mobile: 390 }
const DEVICES = [
  { key: 'desktop', label: 'Desktop', icon: Monitor },
  { key: 'mobile', label: 'Mobile', icon: Smartphone },
]
const device = ref('desktop')

const settings = computed(() => normalizeCoverSettings(props.modelValue))
const current = computed(() => settings.value[device.value])
const update = (patch) => {
  emit('update:modelValue', { ...settings.value, [device.value]: { ...current.value, ...patch } })
}
const reset = () => update({ ...DEFAULT_COVER_SETTINGS[device.value] })

// Escala de la vista previa según el ancho disponible
const box = ref(null)
const width = ref(640)
let observer = null
const measure = () => { if (box.value?.clientWidth) width.value = box.value.clientWidth }
onMounted(() => {
  observer = new ResizeObserver(measure)
  if (box.value) observer.observe(box.value)
})
watch(device, () => nextTick(measure))
onBeforeUnmount(() => observer?.disconnect())
const scale = computed(() => width.value / VIEWPORT[device.value])

const frameStyle = computed(() => ({
  width: `${VIEWPORT[device.value]}px`,
  height: `${current.value.height}px`,
  transform: `scale(${scale.value})`,
  transformOrigin: 'top left',
}))
const boxStyle = computed(() => ({ height: `${current.value.height * scale.value}px` }))
const canDrag = computed(() => props.editable && current.value.fit === 'cover')

// Arrastrar para encuadrar: mover hacia abajo muestra la parte de arriba de la imagen
let drag = null
const onPointerDown = (e) => {
  if (!canDrag.value) return
  drag = { startY: e.clientY, startPos: current.value.position_y, h: current.value.height * scale.value }
  e.currentTarget.setPointerCapture?.(e.pointerId)
}
const onPointerMove = (e) => {
  if (!drag) return
  const delta = ((e.clientY - drag.startY) / Math.max(drag.h, 1)) * 100
  update({ position_y: Math.round(Math.min(100, Math.max(0, drag.startPos - delta))) })
}
const onPointerUp = () => { drag = null }

const positionLabel = computed(() => {
  const y = current.value.position_y
  return y <= 10 ? 'arriba' : y >= 90 ? 'abajo' : y === 50 ? 'centro' : `${y}%`
})
</script>

<template>
  <div class="space-y-3" data-testid="cover-adjuster">
    <div class="flex items-center justify-between gap-3">
      <div class="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="tablist">
        <button
          v-for="d in DEVICES" :key="d.key"
          type="button" role="tab" :aria-selected="device === d.key"
          class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition"
          :class="device === d.key ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-black'"
          @click="device = d.key"
        >
          <component :is="d.icon" size="15" /> {{ d.label }}
        </button>
      </div>
      <button v-if="editable" type="button" class="flex items-center gap-1 text-xs text-gray-500 hover:text-black" @click="reset">
        <RotateCcw size="12" /> Restablecer
      </button>
    </div>

    <!-- Vista previa a escala -->
    <div :class="device === 'mobile' ? 'flex justify-center rounded-lg bg-gray-100 py-4' : ''">
      <div
        ref="box"
        class="relative overflow-hidden rounded-lg border border-gray-300 bg-white select-none"
        :class="[
          device === 'mobile' ? 'w-[240px] max-w-full' : 'w-full',
          canDrag ? 'cursor-ns-resize touch-none' : '',
        ]"
        :style="boxStyle"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div class="absolute top-0 left-0 overflow-hidden bg-gray-900" :style="frameStyle">
          <img
            v-if="current.fit === 'contain'"
            :src="imageUrl" alt="" aria-hidden="true" draggable="false"
            class="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-60"
          />
          <img
            :src="imageUrl" alt="" draggable="false"
            class="relative w-full h-full pointer-events-none"
            :style="{ objectFit: current.fit, objectPosition: `center ${current.position_y}%` }"
          />
          <template v-if="device === 'desktop'">
            <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
            <p class="absolute bottom-10 left-12 right-12 text-4xl font-bold text-white font-['Unbounded'] truncate">
              {{ eventName || 'Nombre del evento' }}
            </p>
          </template>
        </div>
      </div>
    </div>

    <!-- Controles -->
    <div v-if="editable" class="grid gap-3 sm:grid-cols-3">
      <label class="block text-xs text-gray-600">
        Alto: <span class="font-semibold text-gray-900">{{ current.height }}px</span>
        <input
          type="range" class="w-full accent-black"
          :min="COVER_LIMITS[device].min" :max="COVER_LIMITS[device].max" step="10"
          :value="current.height"
          @input="update({ height: Number($event.target.value) })"
        />
      </label>
      <label class="block text-xs" :class="current.fit === 'cover' ? 'text-gray-600' : 'text-gray-400'">
        Posición vertical:
        <span class="font-semibold" :class="current.fit === 'cover' ? 'text-gray-900' : ''">{{ positionLabel }}</span>
        <input
          type="range" class="w-full accent-black" min="0" max="100" step="1"
          :disabled="current.fit !== 'cover'"
          :value="current.position_y"
          @input="update({ position_y: Number($event.target.value) })"
        />
      </label>
      <div class="text-xs text-gray-600">
        Ajuste
        <div class="mt-1 inline-flex w-full rounded-lg border border-gray-300 bg-white p-0.5">
          <button
            type="button" class="flex-1 rounded-md px-2 py-1.5 sm:py-1 transition"
            :class="current.fit === 'cover' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100'"
            @click="update({ fit: 'cover' })"
          >Llenar</button>
          <button
            type="button" class="flex-1 rounded-md px-2 py-1.5 sm:py-1 transition"
            :class="current.fit === 'contain' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100'"
            @click="update({ fit: 'contain' })"
          >Imagen completa</button>
        </div>
      </div>
      <p class="sm:col-span-3 text-xs text-gray-400">
        Arrastra la imagen para encuadrarla. Desktop y Mobile se ajustan por separado.
      </p>
    </div>
  </div>
</template>
