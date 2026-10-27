<script setup>
// Modal del video de demostración (SPEC_landing_productores §7). Lo abre cualquier botón con data-video-open de la
// página (hero y "Ver el video completo"), así esos botones pueden quedar en el HTML estático; por eso la página lo
// hidrata con client:load (si no, un clic temprano abriría el MP4 suelto). <dialog> nativo: Esc
// cierra, el foco queda atrapado adentro y vuelve al botón al cerrar. El <video> recién se monta al abrir: antes no se
// descarga nada. L15: al abrir y al cerrar, el fondo hace fade y el video escala .96 ↔ 1 (--dur-3); con "reducir
// movimiento" cierra de inmediato.
// Con `webmSrc` ofrece primero el WebM (VP9, más liviano) y el MP4 de respaldo, como LandingCoverVideo.
// Analítica: con `progressEvent` (lp_video_progress en /organizadores, §11; su_video_progress en stand-up) manda { pct } al pasar por 25, 50, 75 y 100%
// del video, una vez por hito en la página. La apertura la mide el tracking de cada landing (data-cta="video").
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { trackEvent } from '../../composables/useGoogleAnalytics.js'

const props = defineProps({
  src: { type: String, required: true },
  /** Versión WebM del mismo video (opcional) */
  webmSrc: { type: String, required: false },
  poster: { type: String, required: false },
  title: { type: String, required: true },
  /** Subtítulos en español (.vtt), si existen */
  captions: { type: String, required: false },
  /** Evento de analítica del avance del video ({ pct: 25 | 50 | 75 | 100 }) */
  progressEvent: { type: String, required: false },
})

const dialog = ref(null)
const open = ref(false)
const closing = ref(false)
let opener = null
let closeTimer = null
// Respaldo por si no llega animationend (pestaña en segundo plano): un poco más que --dur-3
const CLOSE_FALLBACK_MS = 400

async function show(trigger) {
  opener = trigger || document.activeElement
  open.value = true
  await nextTick()
  if (!dialog.value?.open) dialog.value?.showModal()
}
function finishClose() {
  clearTimeout(closeTimer)
  dialog.value?.removeEventListener('animationend', finishClose)
  closing.value = false
  if (dialog.value?.open) dialog.value.close()
}
function close() {
  const el = dialog.value
  if (!el?.open || closing.value) return
  el.querySelector('video')?.pause()
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    finishClose()
    return
  }
  // Primero la animación de salida; el <dialog> se cierra al terminar
  closing.value = true
  el.addEventListener('animationend', finishClose)
  closeTimer = setTimeout(finishClose, CLOSE_FALLBACK_MS)
}
// Esc: también con la animación de salida
function onCancel(e) {
  e.preventDefault()
  close()
}
// Al cerrarse: se desmonta el video y el foco vuelve a quien abrió
function onClosed() {
  clearTimeout(closeTimer)
  dialog.value?.removeEventListener('animationend', finishClose)
  closing.value = false
  open.value = false
  opener?.focus?.()
  opener = null
}
const PROGRESS_MARKS = [25, 50, 75, 100]
const reached = new Set()
function trackProgress(pct) {
  if (!props.progressEvent || reached.has(pct)) return
  reached.add(pct)
  trackEvent(props.progressEvent, { pct })
}
function onTimeUpdate(e) {
  const v = e.target
  if (!v.duration || !Number.isFinite(v.duration)) return
  const pct = (v.currentTime / v.duration) * 100
  // El 100% lo marca `ended` (timeupdate rara vez llega justo al final)
  for (const mark of PROGRESS_MARKS) if (mark < 100 && pct >= mark) trackProgress(mark)
}

function onBackdrop(e) {
  if (e.target === dialog.value) close()
}
function onDocumentClick(e) {
  // Cmd/Ctrl/Shift + clic o clic medio: se respeta abrir el MP4 en otra pestaña
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const trigger = e.target?.closest?.('[data-video-open]')
  if (!trigger) return
  e.preventDefault()
  show(trigger)
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  clearTimeout(closeTimer)
})
</script>

<template>
  <dialog
    ref="dialog"
    class="vm"
    :class="{ 'is-closing': closing }"
    :aria-label="props.title"
    data-testid="video-modal"
    @cancel="onCancel"
    @close="onClosed"
    @click="onBackdrop"
  >
    <div v-if="open" class="vm-body">
      <button type="button" class="vm-close" aria-label="Cerrar video" @click="close">
        <X :size="18" aria-hidden="true" />
      </button>
      <video
        class="vm-video"
        :src="props.webmSrc ? undefined : props.src"
        :poster="props.poster || undefined"
        controls
        autoplay
        playsinline
        preload="none"
        @timeupdate="onTimeUpdate"
        @ended="trackProgress(100)"
      >
        <template v-if="props.webmSrc">
          <source :src="props.webmSrc" type="video/webm" />
          <source :src="props.src" type="video/mp4" />
        </template>
        <track v-if="props.captions" kind="captions" srclang="es" label="Español" :src="props.captions" default />
      </video>
    </div>
  </dialog>
</template>

<style scoped>
.vm {
  width: 100%;
  max-width: 960px;
  margin: auto;
  padding: 56px 16px 16px;
  border: 0;
  background: transparent;
  overflow: visible;
}
/* ::backdrop no hereda las variables en todos los navegadores: duración y curva escritas (= --dur-3, --ease-out) */
.vm::backdrop {
  background: rgba(10, 10, 11, 0.8);
}
.vm[open]::backdrop {
  animation: vm-fade 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
/* Otra keyframe (y no vm-fade en reverse): cambiar solo la dirección de una animación terminada no la reinicia y el
   fondo saltaría a opacidad 0 en el primer cuadro */
.vm.is-closing::backdrop {
  animation: vm-fade-out 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.vm[open] .vm-body {
  animation: vm-in var(--dur-3) var(--ease-out) both;
}
.vm.is-closing .vm-body {
  animation: vm-out var(--dur-3) var(--ease-out) both;
}
.vm-body {
  position: relative;
}
.vm-video {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: var(--r-lg);
  background: #141416;
}
.vm-close {
  position: absolute;
  right: 0;
  top: -52px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
}
.vm-close:hover {
  background: rgba(255, 255, 255, 0.2);
}
.vm-close:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
@keyframes vm-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes vm-out {
  to {
    opacity: 0;
    transform: scale(0.96);
  }
}
@keyframes vm-fade {
  from {
    opacity: 0;
  }
}
@keyframes vm-fade-out {
  to {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .vm[open] .vm-body,
  .vm.is-closing .vm-body,
  .vm[open]::backdrop,
  .vm.is-closing::backdrop {
    animation-duration: 1ms;
  }
}
</style>
