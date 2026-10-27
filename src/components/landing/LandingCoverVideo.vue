<script setup>
// Portada en video de los mockups de la landing (hero y "Antes, durante y después", SPEC_landing_productores §5.1,
// §5.5b y §9). Se comporta como la portada real (event/AutoplayVideo.vue: sin sonido, en loop y solo mientras está en
// pantalla), pero cuidando el LCP: primero se ve el póster como imagen y el <video> recién se monta después de `load`
// y en un momento ocioso, con preload="none". Con Save-Data, "reducir movimiento" o si el video falla, queda el póster.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Volume2, VolumeX } from 'lucide-vue-next'

const props = defineProps({
  src: { type: String, required: true },
  poster: { type: String, required: true },
  posterWidth: { type: Number, default: undefined },
  posterHeight: { type: Number, default: undefined },
  /** Texto alternativo del póster y aria-label del video. Vacío = decorativo (aria-hidden). */
  label: { type: String, required: false },
  /** Muestra el botón para activar el sonido; si no, un parlante tachado decorativo */
  sound: { type: Boolean, required: false },
  /** Póster prioritario (arriba del pliegue): sin lazy-load */
  priority: { type: Boolean, required: false },
  /** Esquina del botón de sonido: 'bottom' (por defecto) o 'top' */
  soundPosition: { type: String, required: false },
})
const emit = defineEmits(['sound'])

const position = computed(() => (props.soundPosition === 'top' ? 'top' : 'bottom'))
const video = ref(null)
const active = ref(false)
const muted = ref(true)
let observer = null
let idleHandle = null

function play() {
  const v = video.value
  if (!v) return
  v.muted = muted.value
  const p = v.play()
  if (p?.catch) p.catch(() => {})
}

function start() {
  active.value = true
  requestAnimationFrame(() => {
    const v = video.value
    if (!v) return
    // Safari exige muted como propiedad antes de play()
    v.muted = true
    v.defaultMuted = true
    observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) play()
        else v.pause()
      },
      { threshold: 0.25 },
    )
    observer.observe(v)
  })
}

function scheduleStart() {
  const idle = window.requestIdleCallback || ((cb) => window.setTimeout(cb, 200))
  idleHandle = idle(start)
}
function onLoad() {
  scheduleStart()
}

function toggleSound() {
  const v = video.value
  muted.value = !muted.value
  if (v) {
    v.muted = muted.value
    if (!muted.value && v.paused) play()
  }
  emit('sound', !muted.value)
}

onMounted(() => {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const saveData = navigator.connection?.saveData === true
  if (reduced || saveData || !('IntersectionObserver' in window)) return
  if (document.readyState === 'complete') scheduleStart()
  else window.addEventListener('load', onLoad, { once: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('load', onLoad)
  if (idleHandle != null) (window.cancelIdleCallback || window.clearTimeout)(idleHandle)
  observer?.disconnect()
})
</script>

<template>
  <div class="lcv" :aria-hidden="props.label ? undefined : 'true'">
    <img
      class="lcv-media"
      :src="props.poster"
      :alt="props.label || ''"
      :width="props.posterWidth"
      :height="props.posterHeight"
      :loading="props.priority ? 'eager' : 'lazy'"
      :fetchpriority="props.priority ? 'high' : undefined"
      decoding="async"
    />
    <video
      v-if="active"
      ref="video"
      class="lcv-media"
      :src="props.src"
      :poster="props.poster"
      muted
      loop
      playsinline
      preload="none"
      disablepictureinpicture
      :aria-label="props.label || undefined"
      @error="active = false"
    ></video>

    <button
      v-if="props.sound && active"
      type="button"
      class="lcv-sound"
      :class="`lcv-${position}`"
      :aria-label="muted ? 'Activar sonido' : 'Silenciar'"
      :aria-pressed="muted ? 'false' : 'true'"
      data-testid="cover-sound"
      @click="toggleSound"
    >
      <VolumeX v-if="muted" :size="18" aria-hidden="true" />
      <Volume2 v-else :size="18" aria-hidden="true" />
    </button>
    <span v-else-if="!props.sound" class="lcv-sound lcv-sound-deco" :class="`lcv-${position}`" aria-hidden="true">
      <VolumeX :size="14" />
    </span>
  </div>
</template>

<style scoped>
.lcv {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #24163f;
}
.lcv-media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lcv-sound {
  position: absolute;
  right: 14px;
  z-index: 2;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
}
.lcv-sound:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.lcv-top {
  top: 14px;
}
.lcv-bottom {
  bottom: 14px;
}
.lcv-sound-deco {
  right: 10px;
  width: 28px;
  height: 28px;
  cursor: default;
}
.lcv-sound-deco.lcv-bottom {
  bottom: 10px;
}
</style>
