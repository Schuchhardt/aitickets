<script setup>
// Ajuste de la portada del evento (events.cover_settings) con vista previa a escala de desktop y mobile.
// Se puede arrastrar la imagen hacia arriba/abajo para encuadrarla, o usar los controles.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Monitor, Smartphone, RotateCcw } from 'lucide-vue-next'
import { COVER_LIMITS, DEFAULT_COVER_SETTINGS, normalizeCoverSettings } from '../../lib/eventCover'

const props = defineProps({
  imageUrl: { type: String, required: true },
  eventName: { type: String, default: '' },
  modelValue: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue'])

// Ancho de referencia de cada dispositivo (px) para dibujar la vista previa a escala
const VIEWPORT = { desktop: 1280, mobile: 390 }
const DEVICES = [
  { key: 'desktop', label: 'Desktop', icon: Monitor },
  { key: 'mobile', label: 'Mobile', icon: Smartphone },
]

const settings = computed(() => normalizeCoverSettings(props.modelValue))
const update = (device, patch) => {
  emit('update:modelValue', { ...settings.value, [device]: { ...settings.value[device], ...patch } })
}
const reset = (device) => update(device, { ...DEFAULT_COVER_SETTINGS[device] })

// Escala de cada vista previa según el ancho disponible
const desktopBox = ref(null)
const mobileBox = ref(null)
const widths = ref({ desktop: 640, mobile: 220 })
let observer = null
onMounted(() => {
  observer = new ResizeObserver(() => {
    widths.value = {
      desktop: desktopBox.value?.clientWidth || widths.value.desktop,
      mobile: mobileBox.value?.clientWidth || widths.value.mobile,
    }
  })
  if (desktopBox.value) observer.observe(desktopBox.value)
  if (mobileBox.value) observer.observe(mobileBox.value)
})
onBeforeUnmount(() => observer?.disconnect())
const scale = (device) => widths.value[device] / VIEWPORT[device]

const frameStyle = (device) => ({
  width: `${VIEWPORT[device]}px`,
  height: `${settings.value[device].height}px`,
  transform: `scale(${scale(device)})`,
  transformOrigin: 'top left',
})
const boxStyle = (device) => ({ height: `${settings.value[device].height * scale(device)}px` })

// Arrastrar para encuadrar: mover hacia abajo muestra la parte de arriba de la imagen
let drag = null
const onPointerDown = (device, e) => {
  if (settings.value[device].fit !== 'cover') return
  drag = { device, startY: e.clientY, startPos: settings.value[device].position_y, h: settings.value[device].height * scale(device) }
  e.currentTarget.setPointerCapture?.(e.pointerId)
}
const onPointerMove = (e) => {
  if (!drag) return
  const delta = ((e.clientY - drag.startY) / Math.max(drag.h, 1)) * 100
  update(drag.device, { position_y: Math.round(Math.min(100, Math.max(0, drag.startPos - delta))) })
}
const onPointerUp = () => { drag = null }
</script>

<template>
  <div class="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-6" data-testid="cover-adjuster">
    <div>
      <p class="text-sm font-medium text-gray-900">Ajustar portada</p>
      <p class="text-xs text-gray-500">
        Así se verá arriba de todo en la página del evento. Arrastra la imagen para encuadrarla o usa los controles;
        cada dispositivo se ajusta por separado.
      </p>
    </div>

    <div v-for="d in DEVICES" :key="d.key" class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <component :is="d.icon" size="16" /> {{ d.label }}
        </p>
        <button type="button" class="flex items-center gap-1 text-xs text-gray-500 hover:text-black" @click="reset(d.key)">
          <RotateCcw size="12" /> Restablecer
        </button>
      </div>

      <div :class="d.key === 'mobile' ? 'flex flex-col sm:flex-row gap-4 items-start' : 'space-y-3'">
        <!-- Vista previa a escala -->
        <div
          :ref="d.key === 'desktop' ? (el) => (desktopBox = el) : (el) => (mobileBox = el)"
          class="relative overflow-hidden rounded-lg border border-gray-300 bg-white shrink-0 select-none touch-none"
          :class="[
            d.key === 'mobile' ? 'w-[220px]' : 'w-full',
            settings[d.key].fit === 'cover' ? 'cursor-ns-resize' : '',
          ]"
          :style="boxStyle(d.key)"
          @pointerdown="onPointerDown(d.key, $event)"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <div class="absolute top-0 left-0 overflow-hidden bg-gray-900" :style="frameStyle(d.key)">
            <img
              v-if="settings[d.key].fit === 'contain'"
              :src="imageUrl" alt="" aria-hidden="true" draggable="false"
              class="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-60"
            />
            <img
              :src="imageUrl" alt="" draggable="false"
              class="relative w-full h-full pointer-events-none"
              :style="{
                objectFit: settings[d.key].fit,
                objectPosition: `center ${settings[d.key].position_y}%`,
              }"
            />
            <template v-if="d.key === 'desktop'">
              <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
              <p class="absolute bottom-10 left-12 right-12 text-4xl font-bold text-white font-['Unbounded'] truncate">
                {{ eventName || 'Nombre del evento' }}
              </p>
            </template>
          </div>
        </div>

        <!-- Controles -->
        <div class="grid gap-3 w-full" :class="d.key === 'desktop' ? 'sm:grid-cols-3' : ''">
          <label class="block text-xs text-gray-600">
            Alto: <span class="font-semibold text-gray-900">{{ settings[d.key].height }}px</span>
            <input
              type="range" class="w-full accent-black"
              :min="COVER_LIMITS[d.key].min" :max="COVER_LIMITS[d.key].max" step="10"
              :value="settings[d.key].height"
              @input="update(d.key, { height: Number($event.target.value) })"
            />
          </label>
          <label class="block text-xs" :class="settings[d.key].fit === 'cover' ? 'text-gray-600' : 'text-gray-400'">
            Posición vertical:
            <span class="font-semibold" :class="settings[d.key].fit === 'cover' ? 'text-gray-900' : ''">
              {{ settings[d.key].position_y <= 10 ? 'arriba' : settings[d.key].position_y >= 90 ? 'abajo' : settings[d.key].position_y === 50 ? 'centro' : `${settings[d.key].position_y}%` }}
            </span>
            <input
              type="range" class="w-full accent-black" min="0" max="100" step="1"
              :disabled="settings[d.key].fit !== 'cover'"
              :value="settings[d.key].position_y"
              @input="update(d.key, { position_y: Number($event.target.value) })"
            />
          </label>
          <div class="text-xs text-gray-600">
            Ajuste
            <div class="mt-1 inline-flex w-full rounded-lg border border-gray-300 bg-white p-0.5">
              <button
                type="button"
                class="flex-1 rounded-md px-2 py-1 transition"
                :class="settings[d.key].fit === 'cover' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100'"
                @click="update(d.key, { fit: 'cover' })"
              >Llenar</button>
              <button
                type="button"
                class="flex-1 rounded-md px-2 py-1 transition"
                :class="settings[d.key].fit === 'contain' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100'"
                @click="update(d.key, { fit: 'contain' })"
              >Imagen completa</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
