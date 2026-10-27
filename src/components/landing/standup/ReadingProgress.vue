<script setup>
// Barra de progreso de lectura (SPEC_landing_standup §3 y S16): 2 px lima fija arriba, transform: scaleX(progreso).
// Se actualiza una vez por frame mientras hay scroll. Decorativa: los lectores de pantalla no la anuncian.
// color: otro color para la barra (la landing de música la usa en rojo de sala, SPEC_landing_musica §3).
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  color: { type: String, required: false },
})

const progress = ref(0)
let frame = 0

function measure() {
  frame = 0
  const max = document.documentElement.scrollHeight - window.innerHeight
  progress.value = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
}
function onScroll() {
  if (!frame) frame = requestAnimationFrame(measure)
}

onMounted(() => {
  measure()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  cancelAnimationFrame(frame)
})
</script>

<template>
  <div class="rp" aria-hidden="true" :style="{ transform: `scaleX(${progress.toFixed(4)})`, background: props.color }"></div>
</template>

<style scoped>
.rp {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 50;
  width: 100%;
  height: 2px;
  background: var(--brand-lime);
  transform: scaleX(0);
  transform-origin: left;
  pointer-events: none;
}
</style>
