<script setup>
// Portada en video de los mockups de la landing (hero y "Antes, durante y después", SPEC_landing_productores §5.1,
// §5.5b y §9). Se comporta como la portada real (event/AutoplayVideo.vue: sin sonido, en loop y solo mientras está en
// pantalla), pero cuidando el LCP: primero se ve el póster como imagen y el <video> recién se monta después de `load`
// y en un momento ocioso, con preload="none". Con Save-Data, "reducir movimiento" o si el video falla, queda el póster.
// L17: sin video (Save-Data o error), el póster hace un zoom lento (Ken Burns) que solo corre mientras se ve; con
// "reducir movimiento", quieto.
// §9 (LCP): si llegan posterSources, el póster va en un <picture> con AVIF/WebP a varios anchos; `posterSizes` dice qué
// ancho ocupa la imagen ya recortada por object-fit: cover, para que el navegador no baje más de lo que se ve.
// `pausable`: botón para pausar y reanudar el loop (WCAG 2.2.2), para videos de fondo que no tienen botón de sonido.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Pause, Play, Volume2, VolumeX } from 'lucide-vue-next'

const props = defineProps({
  src: { type: String, required: true },
  poster: { type: String, required: true },
  posterWidth: { type: Number, default: undefined },
  posterHeight: { type: Number, default: undefined },
  /** Versiones optimizadas del póster, cada una { type, srcset }; el JPG queda de respaldo */
  posterSources: { type: Array, required: false },
  /** Atributo sizes de esas versiones (por ejemplo '480px') */
  posterSizes: { type: String, required: false },
  /** Texto alternativo del póster y aria-label del video. Vacío = decorativo (aria-hidden). */
  label: { type: String, required: false },
  /** Muestra el botón para activar el sonido; si no, un parlante tachado decorativo */
  sound: { type: Boolean, required: false },
  /** Póster prioritario (arriba del pliegue): sin lazy-load */
  priority: { type: Boolean, required: false },
  /** Esquina del botón de sonido: 'bottom' (por defecto) o 'top'; sin sonido, 'none' oculta también el parlante tachado
   *  (video de fondo a pantalla completa, como el hero de /ticketera-stand-up) */
  soundPosition: { type: String, required: false },
  /** Muestra el botón de pausa del video (abajo a la derecha; la página lo puede reubicar con .lcv-pause) */
  pausable: { type: Boolean, required: false },
})
const emit = defineEmits(['sound'])

const position = computed(() => (props.soundPosition === 'top' ? 'top' : 'bottom'))
const root = ref(null)
const video = ref(null)
const active = ref(false)
const muted = ref(true)
// Pausado a mano: el IntersectionObserver no lo vuelve a reproducir al entrar en pantalla
const paused = ref(false)
// Ken Burns del póster cuando no hay video, pausado fuera de pantalla
const kenBurns = ref(false)
const visible = ref(false)
let observer = null
let posterObserver = null
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
        if (entry.isIntersecting && !paused.value) play()
        else v.pause()
      },
      { threshold: 0.25 },
    )
    observer.observe(v)
  })
}

function startKenBurns() {
  if (kenBurns.value || !root.value) return
  kenBurns.value = true
  posterObserver = new IntersectionObserver(([entry]) => {
    visible.value = entry.isIntersecting
  })
  posterObserver.observe(root.value)
}
function onVideoError() {
  active.value = false
  observer?.disconnect()
  startKenBurns()
}

function scheduleStart() {
  const idle = window.requestIdleCallback || ((cb) => window.setTimeout(cb, 200))
  idleHandle = idle(start)
}
function onLoad() {
  scheduleStart()
}

function togglePause() {
  const v = video.value
  paused.value = !paused.value
  if (!v) return
  if (paused.value) v.pause()
  else play()
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
  if (reduced || !('IntersectionObserver' in window)) return
  if (saveData) {
    startKenBurns()
    return
  }
  if (document.readyState === 'complete') scheduleStart()
  else window.addEventListener('load', onLoad, { once: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('load', onLoad)
  if (idleHandle != null) (window.cancelIdleCallback || window.clearTimeout)(idleHandle)
  observer?.disconnect()
  posterObserver?.disconnect()
})
</script>

<template>
  <div ref="root" class="lcv" :aria-hidden="props.label ? undefined : 'true'">
    <picture>
      <source
        v-for="source in props.posterSources || []"
        :key="source.type"
        :type="source.type"
        :srcset="source.srcset"
        :sizes="props.posterSizes || '100vw'"
      />
      <img
        class="lcv-media"
        :class="{ 'lcv-kb': kenBurns, 'is-visible': visible }"
        :src="props.poster"
        :alt="props.label || ''"
        :width="props.posterWidth"
        :height="props.posterHeight"
        :loading="props.priority ? 'eager' : 'lazy'"
        :fetchpriority="props.priority ? 'high' : undefined"
        decoding="async"
      />
    </picture>
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
      @error="onVideoError"
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
    <button
      v-if="props.pausable && active"
      type="button"
      class="lcv-sound lcv-pause"
      :aria-label="paused ? 'Reproducir el video de fondo' : 'Pausar el video de fondo'"
      data-testid="cover-pause"
      @click="togglePause"
    >
      <Play v-if="paused" :size="16" aria-hidden="true" />
      <Pause v-else :size="16" aria-hidden="true" />
    </button>
    <span v-if="!props.sound && props.soundPosition !== 'none'" class="lcv-sound lcv-sound-deco" :class="`lcv-${position}`" aria-hidden="true">
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
/* L17: zoom lento alternado del póster (9 s), solo mientras está en pantalla */
@keyframes lcv-kb {
  from {
    transform: scale(1.02);
  }
  to {
    transform: scale(1.12) translate(-2%, -1%);
  }
}
.lcv-kb {
  animation: lcv-kb 9s ease-in-out infinite alternate paused;
}
.lcv-kb.is-visible {
  animation-play-state: running;
}
@media (prefers-reduced-motion: reduce) {
  .lcv-kb {
    animation: none;
  }
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
.lcv-pause {
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
