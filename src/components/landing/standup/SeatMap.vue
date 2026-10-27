<script setup>
// "Mira cómo se llena" (SPEC_landing_standup §4.5 y S14): mapa de sala ilustrativo con el escenario arriba y un pasillo
// central. Al entrar en pantalla los asientos se venden en un orden aleatorio estable (4 cada 40 ms) y, al llenarse,
// aparece "Función agotada" con pop. Hay dos grillas (la de desktop, rows × cols, y la de mobile, mobileRows ×
// mobileCols) y el CSS muestra una según el ancho (768 px), con su propio contador y su propio aria-label: así el HTML
// del servidor (que no sabe el ancho) ya trae "96 de 96" en mobile y "200 de 200" en desktop. La animación cuenta sobre
// la grilla visible y se reajusta si el ancho cruza el corte (rotar el teléfono). DOM liviano: spans sin sombras; el
// lima de cada asiento es un ::after que solo anima opacity y transform.
// La raíz es display: contents: el mapa (grid-area "plan") y el contador ("count") se ubican en la grilla de la sección,
// junto al texto estático ("copy"), así el H2 no queda dentro de la isla.
// Sin JS, sin IntersectionObserver o con "reducir movimiento" se ve la sala llena (estado final). Con movimiento, el
// estado inicial vacío lo pone el CSS (html.lp-motion) hasta que el componente monta, para que no parpadee.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { seatRanks } from './standupLanding.js'

const props = defineProps({
  rows: { type: Number, required: true },
  cols: { type: Number, required: true },
  aisleIndex: { type: Number, required: true },
  mobileRows: { type: Number, required: true },
  mobileCols: { type: Number, required: true },
  mobileAisleIndex: { type: Number, required: true },
})

const desktop = { total: props.rows * props.cols, cols: props.cols + 1, ranks: seatRanks(props.rows, props.cols, props.aisleIndex) }
const mobile = {
  total: props.mobileRows * props.mobileCols,
  cols: props.mobileCols + 1,
  ranks: seatRanks(props.mobileRows, props.mobileCols, props.mobileAisleIndex),
}

const planEl = ref(null)
const mounted = ref(false)
const isMobile = ref(false)
const plan = computed(() => (isMobile.value ? mobile : desktop))
// Asientos vendidos de la grilla visible; cada grilla muestra hasta su total (sin JS: las dos llenas)
const sold = ref(desktop.total)
const soldIn = (grid) => Math.min(sold.value, grid.total)
const soldOut = computed(() => sold.value >= plan.value.total)
const labelFor = (grid) => `Mapa de la sala: ${soldIn(grid)} de ${grid.total} asientos vendidos`

const STEP = 4
const TICK_MS = 40
let timer = 0
let filling = false
let observer = null
let media = null

function fill() {
  clearInterval(timer)
  filling = true
  timer = setInterval(() => {
    sold.value = Math.min(plan.value.total, sold.value + STEP)
    if (sold.value >= plan.value.total) {
      clearInterval(timer)
      filling = false
    }
  }, TICK_MS)
}

// Si el ancho cruza 768 px con la sala ya llena, la otra grilla también se ve llena (y el badge sigue)
function onMediaChange() {
  isMobile.value = !media.matches
  if (sold.value > 0 && !filling) sold.value = plan.value.total
}

onMounted(() => {
  media = window.matchMedia('(min-width: 768px)')
  isMobile.value = !media.matches
  media.addEventListener?.('change', onMediaChange)
  sold.value = plan.value.total
  const motion = document.documentElement.classList.contains('lp-motion')
  if (motion && 'IntersectionObserver' in window) {
    sold.value = 0
    observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        fill()
      },
      { threshold: 0.25 },
    )
    observer.observe(planEl.value)
  }
  mounted.value = true
})
onBeforeUnmount(() => {
  clearInterval(timer)
  observer?.disconnect()
  media?.removeEventListener?.('change', onMediaChange)
})
</script>

<template>
  <div class="seat-map" :class="{ 'is-mounted': mounted }" data-testid="seat-map">
    <div ref="planEl" class="seat-plan">
      <p class="seat-stage" aria-hidden="true">ESCENARIO</p>
      <div class="seat-grid seat-grid-desktop" role="img" :aria-label="labelFor(desktop)" :style="{ '--seat-cols': desktop.cols }">
        <span v-for="(rank, i) in desktop.ranks" :key="i" class="seat" :class="{ 'is-aisle': rank < 0, 'is-sold': rank >= 0 && rank < sold }"></span>
      </div>
      <div class="seat-grid seat-grid-mobile" role="img" :aria-label="labelFor(mobile)" :style="{ '--seat-cols': mobile.cols }">
        <span v-for="(rank, i) in mobile.ranks" :key="i" class="seat" :class="{ 'is-aisle': rank < 0, 'is-sold': rank >= 0 && rank < sold }"></span>
      </div>
    </div>

    <div class="seat-count">
      <p class="seat-number seat-number-desktop">
        <span class="seat-n ev-tabular">{{ soldIn(desktop) }}</span>
        <span class="seat-of">de {{ desktop.total }} entradas</span>
      </p>
      <p class="seat-number seat-number-mobile">
        <span class="seat-n ev-tabular">{{ soldIn(mobile) }}</span>
        <span class="seat-of">de {{ mobile.total }} entradas</span>
      </p>
      <p v-if="soldOut" class="seat-badge" :class="{ 'su-pop': mounted }">Función agotada · 100% vendido</p>
    </div>
  </div>
</template>

<style scoped>
.seat-map {
  display: contents;
}
.seat-plan {
  grid-area: plan;
}
.seat-count {
  grid-area: count;
}
.seat-stage {
  width: 70%;
  height: 26px;
  margin: 0 auto 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(244, 237, 228, 0.14);
  border-top: 0;
  border-radius: 0 0 200px 200px / 0 0 26px 26px;
  background: rgba(244, 237, 228, 0.08);
  font-size: 11px;
  letter-spacing: 0.3em;
  color: var(--sb-text-3);
}
.seat-grid {
  display: grid;
  grid-template-columns: repeat(var(--seat-cols), minmax(0, 1fr));
  gap: 5px;
}
.seat-grid-desktop {
  display: none;
}
/* El asiento libre (::before) es estático; el vendido (::after, lima) entra con opacity y scale .86 → 1 */
.seat {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: 6px 6px 3px 3px;
}
.seat::before,
.seat::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  transform: scale(0.86);
}
.seat::before {
  background: rgba(244, 237, 228, 0.1);
}
.seat::after {
  background: var(--brand-lime);
  opacity: 0;
  transition: opacity 260ms ease, transform 260ms var(--ease-spring);
}
.seat.is-aisle {
  visibility: hidden;
}
.seat.is-sold::after {
  opacity: 1;
  transform: none;
}
/* Antes de montar, con movimiento: la sala se ve vacía (el SSR la trae llena para quien no tiene JS) */
.lp-motion .seat-map:not(.is-mounted) .seat.is-sold::after {
  opacity: 0;
  transform: scale(0.86);
}
.lp-motion .seat-map:not(.is-mounted) .seat-badge,
.lp-motion .seat-map:not(.is-mounted) .seat-n {
  opacity: 0;
}
.seat-number {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.seat-n {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 56px;
  font-weight: 700;
  line-height: 60px;
  letter-spacing: -0.04em;
}
.seat-of {
  font-size: 16px;
  color: var(--sb-text-3);
}
.seat-number-desktop {
  display: none;
}
.seat-badge {
  display: inline-flex;
  margin-top: 16px;
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--brand-lime);
  color: var(--sb-ground);
  font-size: 15px;
  font-weight: 600;
}
@media (min-width: 768px) {
  .seat-grid-desktop {
    display: grid;
    gap: 6px;
  }
  .seat-grid-mobile,
  .seat-number-mobile {
    display: none;
  }
  .seat-number-desktop {
    display: flex;
  }
}
@media (min-width: 1024px) {
  .seat-count {
    align-self: start;
  }
  .seat-n {
    font-size: 88px;
    line-height: 88px;
  }
  .seat-of {
    font-size: 18px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .seat::after {
    transition-duration: 1ms;
  }
}
</style>
