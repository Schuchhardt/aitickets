<script setup>
// Pasar lista en la pizarra (SPEC_landing_talleres §4.5, firma secundaria): la lista de un taller de 10 cupos que se va
// marcando como si escanearan cada QR en la puerta. Los estados son los reales del escáner (ValidateQR.vue): la sexta
// persona se encuentra buscando su nombre y la octava muestra un QR repetido ("Entrada ya validada"), que no suma.
// - SSR / sin JS / "reducir movimiento": el estado final, 9 de 10, con los dos casos especiales a la vista.
// - Con JS y movimiento: al hidratar vuelve a 0 y, solo mientras se ve, valida una fila cada 900 ms (TL13: check lima
//   con clip-path, hora con fade, el contador cambia; la búsqueda escribe "vale" letra a letra). Llega a 9 de 10 y se
//   detiene; "↻ Repetir" vuelve a empezar. El botón queda montado (con aria-disabled mientras corre) para que el foco
//   no se pierda al apretarlo.
// Accesibilidad: es una <table> con caption; el contador no se anuncia en cada paso (aria-live="off").
// Analítica: tl_roll_replay al repetir.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { ROLL_DEMO, ROLL_FINAL, rollState } from './talleresLanding.js'

const count = ref(ROLL_FINAL)
const typed = ref('')
const motion = ref(false)
const visible = ref(false)
const root = ref(null)

const state = computed(() => rollState(count.value))
const total = ROLL_DEMO.rows.length
const done = computed(() => count.value >= ROLL_FINAL)
const hidden = total - ROLL_DEMO.mobileVisible
const initial = (name) => name.charAt(0)
// La fila que se acaba de encontrar buscando su nombre (resaltada solo en ese paso)
const foundRow = computed(() => (motion.value && state.value.last?.search ? state.value.last.row : ''))
const lastLine = computed(() => {
  const last = state.value.last
  if (!last) return 'Escanea el primer QR'
  const row = ROLL_DEMO.rows.find((r) => r.id === last.row)
  if (last.repeat) return `Entrada ya validada · ${last.time}`
  return last.search ? '✓ Presente · buscada por nombre' : `✓ Presente · ${row.name}`
})

let timer = 0
let typeTimer = 0
let observer = null

function typeSearch(text) {
  clearInterval(typeTimer)
  typed.value = ''
  let i = 0
  typeTimer = setInterval(() => {
    typed.value = text.slice(0, ++i)
    if (i >= text.length) clearInterval(typeTimer)
  }, 60)
}
function tick() {
  clearTimeout(timer)
  if (!visible.value || done.value) return
  timer = setTimeout(() => {
    count.value += 1
    const step = state.value.last
    if (step?.search) typeSearch(step.search)
    else typed.value = ''
    tick()
  }, ROLL_DEMO.intervalMs)
}
function replay() {
  if (!done.value) return
  trackEvent('tl_roll_replay')
  count.value = 0
  typed.value = ''
  tick()
}

onMounted(() => {
  motion.value = document.documentElement.classList.contains('lp-motion')
  if (!motion.value || !('IntersectionObserver' in window)) return
  count.value = 0
  observer = new IntersectionObserver(
    (entries) => {
      visible.value = entries.some((e) => e.isIntersecting)
      if (visible.value) tick()
      else clearTimeout(timer)
    },
    { threshold: 0.3 },
  )
  observer.observe(root.value)
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  clearInterval(typeTimer)
  observer?.disconnect()
})
</script>

<template>
  <div ref="root" class="cr" :class="{ 'cr-motion': motion }" data-testid="workshop-roll">
    <div class="cr-head">
      <p class="cr-when">{{ ROLL_DEMO.when }} · ejemplo</p>
      <p class="cr-count">
        <span class="tl-num cr-count-n" aria-live="off" data-testid="workshop-roll-count">{{ state.checked }}</span>
        <span>de {{ total }} presentes</span>
      </p>
      <div class="cr-search" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="11" cy="11" r="7" /><path d="M20 20 L 16 16" /></svg>
        <span :class="{ 'cr-placeholder': !typed }">{{ typed || 'Buscar por nombre' }}</span>
      </div>
      <p class="cr-last" aria-hidden="true" :class="{ 'is-repeat': state.last?.repeat }">{{ lastLine }}</p>
    </div>

    <table class="cr-table">
      <caption class="lp-sr-only">Lista de ejemplo, {{ state.checked }} de {{ total }} presentes</caption>
      <thead class="lp-sr-only">
        <tr><th scope="col">Nombre</th><th scope="col">Entrada</th><th scope="col">Estado</th></tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, i) in ROLL_DEMO.rows"
          :key="row.id"
          class="cr-row"
          :class="{ 'is-present': state.present[row.id], 'is-found': foundRow === row.id, 'cr-extra': i >= ROLL_DEMO.mobileVisible }"
        >
          <th scope="row" class="cr-name">
            <span class="cr-initial" aria-hidden="true">{{ initial(row.name) }}</span>
            {{ row.name }}
          </th>
          <td class="cr-ticket">{{ row.ticket }}</td>
          <td class="cr-status">
            <template v-if="state.present[row.id]">
              <span class="cr-check" aria-hidden="true"><svg viewBox="0 0 22 22"><path d="M3 12 L 9 18 L 20 4" /></svg></span>
              <span class="lp-sr-only">Presente, </span>
              <span class="tl-hand cr-time">{{ state.present[row.id].time }}</span>
              <span v-if="state.present[row.id].search" class="cr-tag">buscada por nombre</span>
            </template>
            <span v-else class="lp-sr-only">Todavía no llega</span>
            <span v-if="state.repeats[row.id]" class="cr-repeat">Entrada ya validada · {{ state.repeats[row.id] }}</span>
          </td>
        </tr>
        <tr class="cr-more" aria-hidden="true"><td colspan="3">y {{ hidden }} más</td></tr>
      </tbody>
    </table>

    <button v-if="motion" type="button" class="cr-replay" :aria-disabled="done ? 'false' : 'true'" @click="replay">↻ Repetir</button>
  </div>
</template>

<style scoped>
.cr {
  position: relative;
  padding: 20px 16px 16px;
  border-radius: 6px;
  background-color: var(--tl-pizarra-2);
  background-image: repeating-linear-gradient(to bottom, transparent 0 43px, rgba(238, 242, 236, 0.1) 43px 44px);
  color: var(--tl-tiza);
}
.cr-when {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--tl-tiza-2);
}
.cr-count {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-top: 4px;
  font-size: 16px;
  color: var(--tl-tiza-2);
}
.cr-count-n {
  font-size: 56px;
  line-height: 1;
  color: var(--tl-tiza);
}
.cr-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(238, 242, 236, 0.25);
  border-radius: 8px;
  font-size: 15px;
}
.cr-search svg {
  fill: none;
  stroke: var(--tl-tiza-2);
  stroke-width: 2;
  stroke-linecap: round;
}
.cr-placeholder {
  color: var(--tl-tiza-2);
}
.cr-last {
  min-height: 22px;
  margin-top: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--brand-lime);
}
.cr-last.is-repeat {
  color: rgba(238, 242, 236, 0.7);
}
.cr-table {
  width: 100%;
  margin-top: 8px;
  border-collapse: collapse;
}
.cr-row th,
.cr-row td {
  height: 44px;
  padding: 0 6px;
  border-bottom: 1px solid rgba(238, 242, 236, 0.1);
  font-size: 15px;
  text-align: left;
  vertical-align: middle;
}
.cr-name {
  font-weight: 500;
  white-space: nowrap;
}
.cr-initial {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-right: 8px;
  border: 1px solid rgba(238, 242, 236, 0.35);
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
}
.cr-ticket {
  font-size: 13px;
  color: var(--tl-tiza-2);
}
.cr-status {
  white-space: nowrap;
}
.cr-check {
  display: inline-block;
  width: 20px;
  height: 20px;
  vertical-align: middle;
}
.cr-check svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: var(--brand-lime);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.cr-time {
  margin-left: 4px;
  font-size: 22px;
  color: var(--tl-tiza);
}
.cr-tag {
  display: block;
  font-size: 12px;
  color: var(--tl-tiza-2);
}
.cr-repeat {
  display: block;
  font-size: 12px;
  color: rgba(238, 242, 236, 0.7);
}
.cr-row.is-found th,
.cr-row.is-found td {
  background: rgba(255, 228, 92, 0.16);
}
.cr-more td {
  padding: 10px 6px 0;
  font-size: 13px;
  color: var(--tl-tiza-2);
}
.cr-replay {
  margin-top: 12px;
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid rgba(238, 242, 236, 0.4);
  border-radius: 8px;
  background: transparent;
  color: var(--tl-tiza);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.cr-replay[aria-disabled='true'] {
  opacity: 0.45;
  cursor: default;
}
.cr-replay:focus-visible {
  outline: 2px solid var(--brand-lime);
  outline-offset: 2px;
}
/* Mobile: 6 filas y "y 4 más" */
@media (max-width: 767px) {
  .cr-extra {
    display: none;
  }
  .cr-ticket {
    display: none;
  }
}
@media (min-width: 768px) {
  .cr {
    padding: 24px 24px 20px;
  }
  .cr-more {
    display: none;
  }
}

/* TL13 */
.cr-motion .is-present .cr-check svg {
  animation: tl-draw 260ms var(--ease-out) both;
}
.cr-motion .is-present .cr-time {
  animation: tl-fade 300ms var(--ease-out) 120ms both;
}
.cr-motion .cr-count-n {
  display: inline-block;
}
@media (prefers-reduced-motion: reduce) {
  .cr-motion .is-present .cr-check svg,
  .cr-motion .is-present .cr-time {
    animation: none;
  }
}
</style>
