<script setup>
// Modal del video de demostración (SPEC_landing_productores §7). Lo abre cualquier botón con data-video-open de la
// página (hero y "Ver el video completo"), así esos botones pueden quedar en el HTML estático; por eso la página lo
// hidrata con client:load (si no, un clic temprano abriría el MP4 suelto). <dialog> nativo: Esc
// cierra, el foco queda atrapado adentro y vuelve al botón al cerrar. El <video> recién se monta al abrir: antes no se
// descarga nada.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps({
  src: { type: String, required: true },
  poster: { type: String, required: false },
  title: { type: String, required: true },
  /** Subtítulos en español (.vtt), si existen */
  captions: { type: String, required: false },
})

const dialog = ref(null)
const open = ref(false)
let opener = null

async function show(trigger) {
  opener = trigger || document.activeElement
  open.value = true
  await nextTick()
  if (!dialog.value?.open) dialog.value?.showModal()
}
function close() {
  dialog.value?.querySelector('video')?.pause()
  if (dialog.value?.open) dialog.value.close()
}
// close() o Esc: se desmonta el video y el foco vuelve a quien abrió
function onClosed() {
  open.value = false
  opener?.focus?.()
  opener = null
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
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <dialog ref="dialog" class="vm" :aria-label="props.title" data-testid="video-modal" @close="onClosed" @click="onBackdrop">
    <div v-if="open" class="vm-body">
      <button type="button" class="vm-close" aria-label="Cerrar video" @click="close">
        <X :size="18" aria-hidden="true" />
      </button>
      <video class="vm-video" :src="props.src" :poster="props.poster || undefined" controls autoplay playsinline preload="none">
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
.vm::backdrop {
  background: rgba(10, 10, 11, 0.8);
}
.vm[open] .vm-body {
  animation: vm-in var(--dur-3) var(--ease-out) both;
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
@media (prefers-reduced-motion: reduce) {
  .vm[open] .vm-body {
    animation-duration: 1ms;
  }
}
</style>
