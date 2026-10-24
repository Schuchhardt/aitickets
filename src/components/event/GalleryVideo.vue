<script setup>
// Video de portada de la galería (events.gallery_video, src/lib/eventGallery.ts), arriba de las fotos.
// Se reproduce solo, sin sonido y en loop mientras al menos la mitad está en pantalla (IntersectionObserver) y
// se pausa al salir o al cambiar de pestaña. El botón con el ícono del parlante activa o silencia el sonido.
// Con "reducir movimiento" del sistema no arranca solo: muestra el botón de reproducir.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  video: { type: Object, required: true },
  eventName: { type: String, default: '' },
})

const el = ref(null)
const muted = ref(true)
const playing = ref(false)
const failed = ref(false)
const autoplay = ref(true)
let visible = false
let observer = null

const ratio = computed(() => {
  const { width, height } = props.video
  return width && height ? width / height : 16 / 9
})
// Verticales (celular) no más altos que el 80 % de la pantalla; horizontales a todo el ancho
const frameStyle = computed(() => ({
  aspectRatio: String(ratio.value),
  width: `min(100%, calc(80svh * ${ratio.value.toFixed(4)}))`,
}))

function play() {
  const v = el.value
  if (!v || failed.value) return
  const p = v.play()
  if (p?.catch) p.catch(() => { playing.value = false })
}

function onIntersect(entries) {
  visible = entries.some((e) => e.isIntersecting)
  if (visible && autoplay.value) play()
  else if (!visible) el.value?.pause()
}

function onVisibility() {
  if (document.hidden) el.value?.pause()
  else if (visible && autoplay.value) play()
}

function toggleSound() {
  const v = el.value
  if (!v) return
  v.muted = !v.muted
  muted.value = v.muted
  // Activar el sonido es un gesto del usuario: si estaba en pausa, que se escuche
  if (!v.muted) {
    autoplay.value = true
    if (v.paused) play()
  }
}

function togglePlay() {
  const v = el.value
  if (!v) return
  if (v.paused) {
    autoplay.value = true
    play()
  } else {
    autoplay.value = false
    v.pause()
  }
}

onMounted(() => {
  const v = el.value
  if (!v) return
  // La política de autoplay exige muted como propiedad (el atributo del SSR no siempre basta)
  v.muted = true
  autoplay.value = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(onIntersect, { threshold: 0.5 })
    observer.observe(v)
  } else if (autoplay.value) {
    visible = true
    play()
  }
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <figure v-if="!failed" class="relative mx-auto mb-4 overflow-hidden rounded-xl bg-black" :style="frameStyle" data-testid="gallery-video">
    <video
      ref="el"
      class="block w-full h-full object-contain"
      :src="video.url"
      :poster="video.poster_url || undefined"
      muted
      loop
      playsinline
      preload="metadata"
      disablepictureinpicture
      :aria-label="eventName ? `Video de ${eventName}` : 'Video del evento'"
      @play="playing = true"
      @pause="playing = false"
      @volumechange="muted = el?.muted ?? true"
      @error="failed = true"
    ></video>

    <button
      v-if="!playing"
      type="button"
      class="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      aria-label="Reproducir video"
      @click="togglePlay"
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
    </button>

    <button
      type="button"
      class="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      :aria-label="muted ? 'Activar sonido' : 'Silenciar'"
      :aria-pressed="muted ? 'false' : 'true'"
      :title="muted ? 'Activar sonido' : 'Silenciar'"
      data-testid="gallery-video-sound"
      @click="toggleSound"
    >
      <!-- Parlante tachado (sin sonido) / parlante con ondas (con sonido) -->
      <svg v-if="muted" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
        <path d="m22 9-6 6M16 9l6 6" />
      </svg>
      <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    </button>
  </figure>
</template>
