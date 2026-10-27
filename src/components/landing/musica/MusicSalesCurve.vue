<script setup>
// La curva de un concierto (SPEC_landing_musica §4.3, firma de la página): gráfico SVG de una venta de ejemplo (pico en
// la preventa, meseta y segunda ola la última semana) con un cabezal que se mueve al momento activo, y los seis
// momentos como lista ordenada (legible sin JS). Sin scroll-jacking:
// - Desktop (≥ 1024 px): el gráfico queda sticky a la izquierda y el momento activo es el que cruza la franja central
//   de la pantalla (IntersectionObserver con rootMargin -45 % arriba y abajo).
// - Mobile: el gráfico arriba (no sticky, 180 px de alto) con seis marcadores numerados que se pueden tocar, y los
//   momentos en un carrusel horizontal con scroll-snap; la card visible mueve el cabezal y tocar un marcador desplaza
//   el carrusel. Indicador "3 / 6".
// El gráfico va en dos proporciones (desktop y mobile) que se alternan con CSS: sin JS se ve el correcto.
// Los textos de los momentos llegan por props desde la página (armados con DEFAULT_CADENCE y legal.mjs). Movimiento:
// M7 la curva se dibuja al entrar (stroke-dashoffset), el cabezal se desplaza en 500 ms y el contador interpola; M8
// cada momento entra al 25 %. El reveal lo maneja la isla (data-drawn / data-seen) y no LandingMotion: las clases que
// LandingMotion pone antes de hidratar no calzarían con el HTML del servidor. Solo anima con html.lp-motion (JS y sin
// "reducir movimiento"); sin JS o con "reducir movimiento" todo queda en su estado final y el cabezal salta. Lo que ya
// se ve al hidratar (client:visible) no se vuelve a animar: queda dibujado, sin parpadeo.
// Analítica: mu_curve_step { step } (1-6), una vez por paso, también el primero.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SoonBadge from '../../ui/SoonBadge.vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import {
  CURVE_MOMENTS,
  CURVE_TICKS,
  CURVE_TOTAL,
  curvePath,
  curveScales,
  curveValue,
} from './musicaLanding.js'

const props = defineProps({
  /** [{ tag, title, text, chips: [{ label, soon? }] }], en el orden de CURVE_MOMENTS */
  moments: { type: Array, required: true },
})

const CHARTS = [
  // labelX: dónde va "Entradas por día" (en mobile, corrido para no quedar bajo los marcadores 1 y 2)
  { key: 'wide', w: 640, h: 380, pad: { top: 40, right: 22, bottom: 44, left: 22 }, font: 13, labelX: 22 },
  { key: 'narrow', w: 640, h: 330, pad: { top: 44, right: 34, bottom: 60, left: 34 }, font: 22, labelX: 140 },
].map((c) => {
  const s = curveScales(c.w, c.h, c.pad)
  return {
    ...c,
    line: curvePath(c.w, c.h, { pad: c.pad }),
    area: curvePath(c.w, c.h, { pad: c.pad, fill: true }),
    baseline: s.baseline,
    // "Show" va alineado a la derecha de su marca para no pisar "+48 h"
    ticks: CURVE_TICKS.map((t, i) => ({ ...t, x: s.x(t.day), anchor: i === 0 ? 'start' : i === CURVE_TICKS.length - 1 || t.day === 0 ? 'end' : 'middle' })),
    points: CURVE_MOMENTS.map((m) => ({ x: s.x(m.day), y: s.y(curveValue(m.day)) })),
  }
})
const narrow = CHARTS[1]

const active = ref(0)
const shown = ref(CURVE_MOMENTS[0].sold)
const list = ref(null)
const items = ref([])
const chart = ref(null)
// Reveal propio (M7, M8): motion = hay html.lp-motion. drawn / seenItems: 'false' (todavía no entra, oculto),
// 'true' (entró al 25 %: anima) o 'static' (ya se veía al hidratar: estado final, sin animación)
const motion = ref(false)
const drawn = ref('false')
const seenItems = ref(CURVE_MOMENTS.map(() => 'false'))
let observer = null
let revealer = null
let media = null
let reduced = false
let frame = 0
const seen = new Set()

/** Marcadores de mobile, en % del ancho y alto del gráfico chico */
const markers = narrow.points.map((p) => ({ left: (p.x / narrow.w) * 100, top: (p.y / narrow.h) * 100 }))

function animateCount(to) {
  cancelAnimationFrame(frame)
  const from = shown.value
  if (reduced || from === to) {
    shown.value = to
    return
  }
  const start = performance.now()
  const step = (now) => {
    const t = Math.min(1, (now - start) / 500)
    shown.value = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)))
    if (t < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
}

// Cada paso se mide una vez. El observer lo llama antes de cambiar active: el paso 1 es el valor inicial y el watch
// no corre para él.
function trackStep(i) {
  if (seen.has(i)) return
  seen.add(i)
  trackEvent('mu_curve_step', { step: i + 1 })
}

watch(active, (i) => {
  animateCount(CURVE_MOMENTS[i].sold)
  trackStep(i)
})

function observe() {
  observer?.disconnect()
  const wide = media.matches
  observer = new IntersectionObserver(
    (entries) => {
      // El momento activo: en desktop, el que cruza la franja central; en el carrusel, el más visible
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)
      if (!visible.length) return
      const i = items.value.indexOf(visible[0].target)
      if (i < 0) return
      trackStep(i)
      active.value = i
    },
    wide ? { rootMargin: '-45% 0px -45% 0px', threshold: 0 } : { root: list.value, threshold: [0.6, 0.9] },
  )
  items.value.forEach((el) => el && observer.observe(el))
}

function goTo(i) {
  active.value = i
  const el = items.value[i]
  if (!el || !list.value) return
  const padding = parseFloat(getComputedStyle(list.value).paddingLeft) || 0
  list.value.scrollTo({ left: el.offsetLeft - padding, behavior: reduced ? 'auto' : 'smooth' })
}

/** Ya está en pantalla (o la pasó hacia arriba) al hidratar */
function inView(el) {
  const r = el.getBoundingClientRect()
  return r.top < window.innerHeight && r.left < window.innerWidth && r.right > 0
}

function observeReveal() {
  if (!document.documentElement.classList.contains('lp-motion')) return
  // Lo que ya se ve queda en su estado final ('static', que el CSS no anima): se marca en el mismo render que activa
  // el movimiento
  if (inView(chart.value)) drawn.value = 'static'
  items.value.forEach((el, i) => {
    if (el && inView(el)) seenItems.value[i] = 'static'
  })
  motion.value = true
  revealer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting && entry.boundingClientRect.top > 0) continue
        if (entry.target === chart.value) drawn.value = 'true'
        else {
          const i = items.value.indexOf(entry.target)
          if (i >= 0) seenItems.value[i] = 'true'
        }
        revealer.unobserve(entry.target)
      }
    },
    { threshold: 0.25 },
  )
  if (drawn.value === 'false') revealer.observe(chart.value)
  items.value.forEach((el, i) => el && seenItems.value[i] === 'false' && revealer.observe(el))
}

onMounted(() => {
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!('IntersectionObserver' in window)) return
  media = window.matchMedia('(min-width: 1024px)')
  observe()
  observeReveal()
  media.addEventListener?.('change', observe)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  revealer?.disconnect()
  media?.removeEventListener?.('change', observe)
  cancelAnimationFrame(frame)
})

const headStyle = (chart) => {
  const p = chart.points[active.value]
  return { line: { transform: `translate(${p.x}px, 0)` }, dot: { transform: `translate(${p.x}px, ${p.y}px)` } }
}
const heads = computed(() => CHARTS.map((c) => headStyle(c)))
const counter = computed(() => `${active.value + 1} / ${CURVE_MOMENTS.length}`)
</script>

<template>
  <div class="sc" :data-motion="motion ? 'on' : undefined" data-testid="music-curve">
    <div class="sc-chart-col">
      <figure ref="chart" class="sc-chart" :data-drawn="drawn">
        <p class="mu-mono sc-tag">Curva de ejemplo</p>
        <div
          v-for="(chart, c) in CHARTS"
          :key="chart.key"
          :class="['sc-svg-wrap', `sc-svg-${chart.key}`]"
        >
          <svg
            :viewBox="`0 0 ${chart.w} ${chart.h}`"
            role="img"
            aria-label="Curva de venta de ejemplo: un pico en la preventa, una meseta y un segundo pico la última semana antes del show"
            class="sc-svg"
          >
            <text :x="chart.labelX" :y="chart.pad.top - 18" class="sc-axis-label" :font-size="chart.font">Entradas por día</text>
            <line :x1="chart.pad.left" :x2="chart.w - chart.pad.right" :y1="chart.baseline" :y2="chart.baseline" class="sc-base" />
            <g v-for="t in chart.ticks" :key="t.label">
              <line :x1="t.x" :x2="t.x" :y1="chart.baseline" :y2="chart.baseline + 6" class="sc-base" />
              <text :x="t.x" :y="chart.baseline + chart.font + 12" :text-anchor="t.anchor" class="sc-tick" :font-size="chart.font">{{ t.label }}</text>
            </g>
            <path :d="chart.area" class="sc-area" />
            <path :d="chart.line" class="sc-line" pathLength="1" />
            <g class="sc-head" :style="heads[c].line">
              <line x1="0" x2="0" :y1="chart.pad.top - 6" :y2="chart.baseline" class="sc-head-line" />
            </g>
            <g class="sc-head" :style="heads[c].dot">
              <circle r="15" class="sc-halo" />
              <circle r="5" class="sc-dot" />
            </g>
          </svg>
          <div v-if="chart.key === 'narrow'" class="sc-markers">
            <button
              v-for="(m, i) in markers"
              :key="i"
              type="button"
              class="sc-marker mu-mono"
              :style="{ left: `${m.left}%`, top: `${m.top}%` }"
              :aria-label="`Momento ${i + 1}: ${props.moments[i].tag}`"
              :aria-current="active === i ? 'step' : undefined"
              :data-active="active === i ? 'true' : 'false'"
              @click="goTo(i)"
            >{{ i + 1 }}</button>
          </div>
        </div>
        <figcaption class="mu-mono sc-count">
          Vendidas <span class="sc-count-n">{{ shown }}</span> de {{ CURVE_TOTAL }} · ejemplo
        </figcaption>
      </figure>
    </div>

    <div class="sc-moments-col">
      <p class="mu-mono sc-progress" aria-hidden="true">{{ counter }}</p>
      <ol ref="list" class="sc-moments">
        <li
          v-for="(m, i) in props.moments"
          :key="m.tag"
          :ref="(el) => (items[i] = el)"
          class="sc-moment"
          :data-active="active === i ? 'true' : 'false'"
          :data-seen="seenItems[i]"
        >
          <p class="mu-mono sc-day">{{ m.tag }}</p>
          <h3 class="mu-h3 sc-title">{{ m.title }}</h3>
          <p class="sc-text">{{ m.text }}</p>
          <ul class="sc-chips" :aria-label="`Herramientas: ${m.tag}`">
            <li v-for="chip in m.chips" :key="chip.label" class="mu-chip sc-chip">
              {{ chip.label }}<SoonBadge v-if="chip.soon" dark />
            </li>
          </ul>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.sc {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 28px;
}
.sc-chart {
  position: relative;
  padding: 16px 0 0;
}
.sc-tag {
  position: absolute;
  top: 0;
  right: 0;
  font-size: 11px;
  color: var(--mu-text-3);
}
.sc-svg-wrap {
  position: relative;
}
.sc-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}
.sc-svg-wide {
  display: none;
}
.sc-axis-label,
.sc-tick {
  font-family: var(--mu-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  fill: var(--mu-text-3);
}
.sc-base {
  stroke: var(--mu-line-strong);
  stroke-width: 1;
}
.sc-area {
  fill: var(--mu-red);
  fill-opacity: 0.12;
}
.sc-line {
  fill: none;
  stroke: var(--mu-red);
  stroke-width: 3;
  stroke-linejoin: round;
  stroke-linecap: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 0;
}
.sc-head {
  transition: transform 500ms var(--ease-out);
}
.sc-head-line {
  stroke: var(--mu-text-1);
  stroke-opacity: 0.4;
  stroke-width: 1.5;
}
.sc-halo {
  fill: var(--mu-red);
  fill-opacity: 0.25;
}
.sc-dot {
  fill: var(--mu-red);
  stroke: var(--mu-stage);
  stroke-width: 2;
}
.sc-markers {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
/* Marcadores tocables: objetivo de 44 × 44, se ve un cuadrado de 24 sobre el punto de la curva */
.sc-marker {
  position: absolute;
  z-index: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -44px 0 0 -22px;
  padding: 9px 0 0;
  border: 0;
  background: none;
  font-size: 12px;
  font-weight: 700;
  color: var(--mu-ink);
  cursor: pointer;
  pointer-events: auto;
}
.sc-marker::before {
  content: "";
  position: absolute;
  z-index: -1;
  left: 10px;
  top: 6px;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: var(--mu-paper);
}
.sc-marker[data-active="true"]::before {
  background: var(--mu-red);
}
.sc-marker:focus-visible {
  outline: 2px solid var(--brand-lime);
  outline-offset: -4px;
}
.sc-count {
  margin-top: 14px;
  color: var(--mu-text-2);
}
.sc-count-n {
  color: var(--mu-text-1);
  font-weight: 700;
}
.sc-progress {
  margin-bottom: 12px;
  color: var(--mu-text-3);
}
/* Mobile: carrusel horizontal con scroll-snap, card al 86 % */
.sc-moments {
  position: relative;
  display: flex;
  gap: 12px;
  margin-inline: -20px;
  padding: 0 20px 8px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-padding-inline: 20px;
  scrollbar-width: none;
}
.sc-moments::-webkit-scrollbar {
  display: none;
}
.sc-moment {
  flex: 0 0 86%;
  scroll-snap-align: start;
  padding: 20px;
  border: 1px solid var(--mu-line);
  border-radius: 4px;
  background: var(--mu-stage-2);
  transition: border-color 240ms var(--ease-out);
}
.sc-moment[data-active="true"] {
  border-color: var(--mu-red);
}
.sc-day {
  color: var(--mu-red);
}
.sc-title {
  margin-top: 10px;
}
.sc-text {
  margin-top: 12px;
  font-size: 15px;
  line-height: 24px;
  color: var(--mu-text-2);
}
.sc-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 16px;
}
.sc-chip {
  transition: border-color 240ms var(--ease-out), color 240ms var(--ease-out);
}
.sc-moment[data-active="true"] .sc-chip {
  border-color: rgba(242, 240, 235, 0.45);
  color: var(--mu-text-1);
}
@media (min-width: 1024px) {
  .sc {
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    align-items: start;
    gap: 64px;
  }
  .sc-chart-col {
    position: sticky;
    top: 96px;
  }
  .sc-svg-wide {
    display: block;
  }
  .sc-svg-narrow,
  .sc-progress {
    display: none;
  }
  .sc-moments {
    display: block;
    margin: 0;
    padding: 0;
    overflow: visible;
  }
  .sc-moment {
    padding: 0 0 0 24px;
    margin-bottom: 22vh;
    border: 0;
    border-left: 2px solid var(--mu-line);
    background: none;
  }
  .sc-moment:last-child {
    margin-bottom: 10vh;
  }
  .sc-moment[data-active="true"] {
    border-left-color: var(--mu-red);
  }
  .sc-text {
    font-size: 17px;
    line-height: 27px;
  }
}

/* M7: la curva se dibuja al entrar (1,4 s) y el relleno aparece detrás; M8: cada momento entra con fade +
 * translateY 24 px. Solo con data-motion="on" (html.lp-motion al montar la isla). data-drawn / data-seen="static"
 * (ya se veía al hidratar) no calza con ninguna regla: queda en su estado final, sin parpadeo. */
@keyframes sc-draw {
  from {
    stroke-dashoffset: 1;
  }
}
@keyframes sc-area-in {
  from {
    opacity: 0;
  }
}
.sc[data-motion="on"] .sc-chart[data-drawn="false"] .sc-line {
  stroke-dashoffset: 1;
}
.sc[data-motion="on"] .sc-chart[data-drawn="false"] .sc-area {
  opacity: 0;
}
.sc[data-motion="on"] .sc-chart[data-drawn="true"] .sc-line {
  animation: sc-draw 1400ms var(--ease-in-out) both;
}
.sc[data-motion="on"] .sc-chart[data-drawn="true"] .sc-area {
  animation: sc-area-in 900ms ease 700ms both;
}
.sc[data-motion="on"] .sc-moment[data-seen="false"] {
  opacity: 0;
}
.sc[data-motion="on"] .sc-moment[data-seen="true"] {
  animation: mu-up-24 700ms var(--ease-out) both;
}
@media (prefers-reduced-motion: reduce) {
  .sc-head,
  .sc-moment,
  .sc-chip {
    transition-duration: 1ms;
  }
}
</style>
