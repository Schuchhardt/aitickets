<script setup>
// Video del evento (src/lib/eventVideo.ts): la portada arriba de la página (reemplaza la imagen, EventDetail.vue)
// y el video opcional de la galería (EventGallery.vue).
// Se reproduce solo, sin sonido y en loop mientras está en pantalla (IntersectionObserver) y se pausa al salir o
// al cambiar de pestaña. El botón con el ícono del parlante activa o silencia el sonido. Con "reducir movimiento"
// del sistema no arranca solo: muestra el botón de reproducir. Si el video no carga emite "failed" (la portada
// vuelve a la imagen).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  video: { type: Object, required: true },
  eventName: { type: String, default: '' },
  // Ocupa todo el contenedor (la portada lo dimensiona); si no, marco propio con la proporción del video
  fill: { type: Boolean, default: false },
  // Portada: autoplay nativo (arranca antes de hidratar la página) y precarga completa
  eager: { type: Boolean, default: false },
  // Esquina del botón de sonido: abajo o arriba a la derecha (en la portada ancha el título tapa la parte de abajo)
  soundPosition: { type: String, default: 'bottom' },
  testId: { type: String, default: 'event-video' },
})
const emit = defineEmits(['failed'])

const el = ref(null)
const mounted = ref(false)
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

function onError() {
  failed.value = true
  emit('failed')
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
  mounted.value = true
  // Con autoplay nativo puede venir reproduciéndose desde antes de hidratar
  playing.value = !v.paused
  if (v.error) onError()
  autoplay.value = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!autoplay.value) v.pause()
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(onIntersect, { threshold: 0.4 })
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
  <div v-if="!failed" class="av" :class="fill ? 'av-fill' : 'av-frame'" :style="fill ? undefined : frameStyle" :data-testid="testId">
    <video
      ref="el"
      class="av-video"
      :src="video.url"
      :poster="video.poster_url || undefined"
      muted
      loop
      playsinline
      :autoplay="eager || undefined"
      :preload="eager ? 'auto' : 'metadata'"
      disablepictureinpicture
      :aria-label="eventName ? `Video de ${eventName}` : 'Video del evento'"
      @play="playing = true"
      @pause="playing = false"
      @volumechange="muted = el?.muted ?? true"
      @error="onError"
    ></video>

    <button v-if="mounted && !playing" type="button" class="av-btn av-play" aria-label="Reproducir video" @click="togglePlay">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
    </button>

    <button
      type="button"
      class="av-btn av-sound"
      :class="soundPosition === 'top' ? 'av-top' : 'av-bottom'"
      :aria-label="muted ? 'Activar sonido' : 'Silenciar'"
      :aria-pressed="muted ? 'false' : 'true'"
      :title="muted ? 'Activar sonido' : 'Silenciar'"
      :data-testid="`${testId}-sound`"
      @click.stop="toggleSound"
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
  </div>
</template>

<style scoped>
.av {
  position: relative;
  overflow: hidden;
  background: #000;
}
.av-frame {
  margin: 0 auto 16px;
  border-radius: 12px;
}
.av-fill {
  position: absolute;
  inset: 0;
}
.av-video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.av-fill .av-video {
  object-fit: cover;
  object-position: var(--video-pos, 50% 50%);
}
.av-btn {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 9999px;
  color: #fff;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  cursor: pointer;
  transition: background-color 150ms ease;
}
.av-btn:hover {
  background: rgba(0, 0, 0, 0.75);
}
.av-btn:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.av-play {
  inset: 0;
  margin: auto;
  width: 64px;
  height: 64px;
}
.av-sound {
  right: 12px;
  width: 44px;
  height: 44px;
}
.av-bottom {
  bottom: 12px;
}
.av-top {
  top: 12px;
}
</style>
