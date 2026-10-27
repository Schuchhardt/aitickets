<script setup>
// Reloj de la noche del header de clubs (SPEC_landing_clubs §3, C16), en lugar de la barra de lectura de las otras
// landings: va de 22:00 (arriba) a 06:00 (final de la página) en pasos de 15 min según el scroll. Entre las 05:00 y el
// final la cápsula pasa a blanco servicio con texto tinta ("se prendieron las luces"). Es estado, no animación: cambia
// sin transición, también con "reducir movimiento". Doto a 18 px: única excepción a la regla de 28 px (cuatro dígitos
// sueltos y aria-hidden: el progreso no es información).
import { onBeforeUnmount, onMounted, ref } from 'vue'

const START = 22 * 60
const STEPS = 32 // 22:00 → 06:00
const LIGHTS_ON = 28 // 05:00

const step = ref(0)
const pad = (n) => String(n).padStart(2, '0')
const label = (s) => {
  const m = START + s * 15
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`
}

let frame = 0
function update() {
  frame = 0
  const max = document.documentElement.scrollHeight - window.innerHeight
  const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
  step.value = Math.round(progress * STEPS)
}
const onScroll = () => {
  if (!frame) frame = requestAnimationFrame(update)
}
onMounted(() => {
  update()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
})
</script>

<template>
  <span class="nc" :class="{ 'is-service': step >= LIGHTS_ON }" aria-hidden="true" data-testid="club-night-clock">{{ label(step) }}</span>
</template>

<style scoped>
.nc {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 96px;
  height: 32px;
  border: 1px solid var(--cl-line-glow);
  border-radius: 999px;
  background: #000;
  font-family: var(--cl-led);
  font-weight: 800;
  font-size: 18px;
  line-height: 1;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--cl-fluor);
}
.nc.is-service {
  border-color: var(--cl-servicio-2);
  background: var(--cl-servicio);
  color: var(--cl-ink);
}
@media (max-width: 380px) {
  .nc {
    width: 80px;
  }
}
</style>
