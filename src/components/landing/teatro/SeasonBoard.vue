<script setup>
// "La temporada" (SPEC_landing_teatro §4.4, firma de la página): cartelera de 16 funciones (jueves a domingo, 5 al 29
// de noviembre) que avanza con un fader de consola de luces (LightFader) y, al lado, lo que pasa en esa semana. Los
// estados de la cartelera y los contadores salen de SEASON_STEPS (teatroLanding.js); los textos del panel llegan por
// props desde la página (armados con legal.mjs, reviews.mjs y DEFAULT_KEYWORD), con "Pronto" en lo que no existe.
// - SSR / sin JS: el paso 4 ("Bajó el telón"); la lista <ol> con los cinco momentos va en un <noscript> de
//   TheatreSeason.astro (fuera de la isla: no ocupa espacio con JS ni se quita al hidratar, sin salto de layout).
// - Con JS y movimiento: al hidratar (antes de verse, la página usa rootMargin) vuelve al paso 0; al entrar al 35 % el
//   fader se mueve solo de 0 a 1 en 900 ms, una vez, como invitación (si la persona lo tocó antes, no). T12: las
//   celdas cambian de estado con stagger de 30 ms en orden de calendario (fade + scale .94 → 1; "Agotada" entra con un
//   barrido de terciopelo) y los contadores interpolan en 400 ms; el panel hace crossfade + translateY ±10 px.
// - Con "reducir movimiento": se queda en el paso 4, sin moverse solo y sin animaciones.
// Mobile (§4.4): cartelera, fader y el panel debajo (el fader va entre los dos en el DOM; en desktop la grilla lo baja a
// ancho completo bajo ambos). Bajo 640 px cada celda muestra solo el número y un punto de estado (sb-pip).
// Accesibilidad: la cartelera es una <table> con caption, cabeceras de día y el texto completo de cada celda para
// lectores; el panel se anuncia en una región aria-live con pausa (useDelayedAnnouncement).
// Analítica: te_season_step { step, auto }, una vez por paso y origen.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BarChart3,
  CalendarClock,
  CircleSlash,
  Copy,
  LayoutGrid,
  Mail,
  MessageSquareQuote,
  Send,
  Smartphone,
  Star,
  Tag,
  Ticket,
  Activity,
  Wallet,
} from 'lucide-vue-next'
import SoonBadge from '../../ui/SoonBadge.vue'
import LightFader from './LightFader.vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { useDelayedAnnouncement } from '../../../composables/usePriceCalculator.js'
import {
  SEASON_LAST_STEP,
  SEASON_STEPS,
  SEASON_WEEKDAYS,
  STATE_LABELS,
  formatRating,
  seasonCells,
  seasonCounters,
} from './teatroLanding.js'

const props = defineProps({
  /** Panel de cada paso, en el orden de SEASON_STEPS: [{ title, items: [{ icon, title, text, soon? }] }] */
  moments: { type: Array, required: true },
})

const ICONS = {
  ticket: Ticket,
  activity: Activity,
  mail: Mail,
  star: Star,
  wallet: Wallet,
  quote: MessageSquareQuote,
  tag: Tag,
  phone: Smartphone,
  chart: BarChart3,
  soldout: CircleSlash,
  schedule: CalendarClock,
  grid: LayoutGrid,
  send: Send,
  copy: Copy,
}
const fader = SEASON_STEPS.map((s) => ({ label: s.label, short: s.short }))
const WEEKDAY_LONG = { JUE: 'Jueves', VIE: 'Viernes', SÁB: 'Sábado', DOM: 'Domingo' }

const step = ref(SEASON_LAST_STEP)
const animate = ref(false)
const auto = ref(false)
const touched = ref(false)
const root = ref(null)

const cells = computed(() => seasonCells(step.value))
const weeks = computed(() => [0, 1, 2, 3].map((w) => cells.value.slice(w * 4, w * 4 + 4)))
const target = computed(() => seasonCounters(step.value))
const moment = computed(() => props.moments[step.value])

// Contadores que interpolan (T12, 400 ms); el valor final es siempre el exacto
const shownDone = ref(target.value.done)
const shownSold = ref(target.value.sold)
let frame = 0
let observer = null
let autoTimer = 0
const tracked = new Set()

function interpolate(to) {
  cancelAnimationFrame(frame)
  if (!animate.value) {
    shownDone.value = to.done
    shownSold.value = to.sold
    return
  }
  const from = { done: shownDone.value, sold: shownSold.value }
  const start = performance.now()
  const tick = (now) => {
    const t = Math.min(1, (now - start) / 400)
    const e = 1 - Math.pow(1 - t, 3)
    shownDone.value = Math.round(from.done + (to.done - from.done) * e)
    shownSold.value = Math.round(from.sold + (to.sold - from.sold) * e)
    if (t < 1) frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
}

function track(i, isAuto) {
  const key = `${i}:${isAuto}`
  if (tracked.has(key)) return
  tracked.add(key)
  trackEvent('te_season_step', { step: i, auto: isAuto })
}

// Solo se anuncia y se mide lo que movió la persona o la invitación automática (no el paso 0 al hidratar)
const announcedStep = ref(null)
watch(target, interpolate)
watch(step, (i) => {
  if (!touched.value && !auto.value) return
  track(i, auto.value)
  announcedStep.value = i
})

function onUserInput() {
  touched.value = true
  auto.value = false
  clearTimeout(autoTimer)
}

const announced = useDelayedAnnouncement(announcedStep, (i) => {
  const m = props.moments[i]
  return `${m.title}. ${m.items.map((it) => it.title).join(' ')}`
})

onMounted(() => {
  const motion = document.documentElement.classList.contains('lp-motion')
  if (!motion || !('IntersectionObserver' in window)) return
  // Con movimiento: la temporada parte en el estreno y el fader invita a moverse una vez
  step.value = 0
  shownDone.value = target.value.done
  shownSold.value = target.value.sold
  animate.value = true
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer.disconnect()
      if (touched.value) return
      autoTimer = setTimeout(() => {
        if (touched.value || step.value !== 0) return
        auto.value = true
        step.value = 1
        setTimeout(() => (auto.value = false), 950)
      }, 400)
    },
    { threshold: 0.35 },
  )
  observer.observe(root.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  cancelAnimationFrame(frame)
  clearTimeout(autoTimer)
})

const reviewsText = computed(() => {
  const r = target.value.reviews
  return r ? `${formatRating(r.avg)} · ${r.count}` : '—'
})
</script>

<template>
  <div ref="root" class="sb" :class="{ 'is-animated': animate }" data-testid="theatre-season">
    <div class="sb-grid">
      <div class="sb-board">
        <div class="sb-board-top">
          <dl class="sb-counters">
            <div class="sb-counter">
              <dt>Funciones realizadas</dt>
              <dd><span class="te-display sb-num" data-testid="theatre-season-done">{{ shownDone }}</span><span class="sb-of"> de {{ target.total }}</span></dd>
            </div>
            <div class="sb-counter">
              <dt>Entradas vendidas</dt>
              <dd><span class="te-display sb-num">{{ shownSold.toLocaleString('es-CL') }}</span></dd>
            </div>
            <div class="sb-counter">
              <dt>Reseñas</dt>
              <dd>
                <span class="sb-star" aria-hidden="true">★</span>
                <span class="te-display sb-num sb-num-reviews">{{ reviewsText }}</span>
              </dd>
            </div>
          </dl>
          <p class="te-example sb-example">Temporada de ejemplo</p>
        </div>

        <table class="sb-table">
          <caption class="lp-sr-only">Temporada de ejemplo, 16 funciones</caption>
          <thead>
            <tr>
              <th v-for="d in SEASON_WEEKDAYS" :key="d" scope="col" class="sb-dow">
                <span aria-hidden="true">{{ d }}</span><span class="lp-sr-only">{{ WEEKDAY_LONG[d] }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(week, w) in weeks" :key="w">
              <td v-for="cell in week" :key="cell.id" class="sb-td">
                <span
                  :key="`${cell.state}-${cell.payout}`"
                  class="sb-cell"
                  :class="[`is-${cell.state}`, { 'has-payout': cell.payout, 'is-low': cell.low }]"
                  :style="{ '--i': cell.index }"
                  :data-state="cell.state"
                >
                  <span v-if="cell.state === 'soldout'" class="sb-velvet" aria-hidden="true"></span>
                  <span class="lp-sr-only">{{ cell.text }}</span>
                  <span class="sb-cell-top" aria-hidden="true">
                    <span class="te-display sb-day">{{ cell.day }}</span>
                    <span v-if="cell.state === 'done'" class="sb-check">✓</span>
                    <span v-if="cell.payout" class="sb-dot"></span>
                    <span v-if="cell.state !== 'done'" class="sb-pip"></span>
                  </span>
                  <span class="sb-time" aria-hidden="true">{{ cell.time }}</span>
                  <span class="sb-state" aria-hidden="true">
                    <s v-if="cell.state === 'soldout'">{{ STATE_LABELS.soldout }}</s>
                    <template v-else>{{ STATE_LABELS[cell.state] }}</template>
                  </span>
                  <span class="sb-bar" aria-hidden="true"><span class="sb-fill" :style="{ transform: `scaleX(${cell.fill.toFixed(3)})` }"></span></span>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        <ul class="sb-legend" aria-label="Estados de las funciones">
          <li><span class="sb-key is-available"></span>Disponible</li>
          <li><span class="sb-key is-last"></span>Últimas</li>
          <li><span class="sb-key is-soldout"></span>Agotada</li>
          <li><span class="sb-key is-done"></span>Realizada</li>
          <li><span class="sb-dot sb-dot-key"></span>Lista para retirar</li>
        </ul>
      </div>

      <div class="sb-fader">
        <LightFader v-model="step" :steps="fader" :auto="auto" @input="onUserInput" />
      </div>

      <div class="sb-panel">
        <Transition name="sb-panel" mode="out-in">
          <div :key="step" class="sb-panel-in">
            <p class="te-meta te-gold sb-panel-kicker">Esta semana</p>
            <p class="te-display sb-panel-title" data-testid="theatre-season-title">{{ moment.title }}</p>
            <ul class="sb-items">
              <li v-for="item in moment.items" :key="item.title" class="sb-item">
                <span class="sb-icon" aria-hidden="true"><component :is="ICONS[item.icon]" :size="20" :stroke-width="1.5" /></span>
                <p>
                  <strong class="sb-item-title">{{ item.title }}</strong>
                  <SoonBadge v-if="item.soon" dark class="sb-soon" />
                  <span v-if="item.text" class="sb-item-text">{{ item.text }}</span>
                </p>
              </li>
            </ul>
          </div>
        </Transition>
      </div>
    </div>
    <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
  </div>
</template>

<style scoped>
.sb-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
}
.sb-board-top {
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
}
.sb-example {
  text-align: right;
}
.sb-counters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.sb-counter {
  display: flex;
  flex-direction: column-reverse;
  justify-content: flex-end;
  gap: 2px;
}
.sb-counter dt {
  font-size: 11px;
  line-height: 15px;
  color: var(--te-text-3);
}
.sb-counter dd {
  display: flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}
.sb-num {
  font-size: 28px;
  line-height: 32px;
}
.sb-num-reviews {
  font-size: 20px;
}
.sb-of {
  font-size: 12px;
  color: var(--te-text-3);
}
/* ★ y ✓ en Prompt: en Bodoni bajarían el subconjunto de símbolos (landing-teatro.css) */
.sb-star,
.sb-check {
  font-family: 'Prompt', system-ui, sans-serif;
  color: var(--te-oro);
}
.sb-table {
  width: 100%;
  margin-top: 16px;
  border-collapse: separate;
  border-spacing: 6px;
  table-layout: fixed;
}
.sb-dow {
  padding-bottom: 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: var(--te-text-3);
  text-align: left;
}
.sb-td {
  padding: 0;
  vertical-align: top;
}
.sb-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 64px;
  padding: 6px 7px 10px;
  border: 1px solid var(--te-line-strong);
  border-radius: 8px;
  background: var(--te-sala-2);
  overflow: hidden;
}
.sb-cell-top {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 4px;
}
.sb-day {
  font-size: 22px;
  line-height: 26px;
}
.sb-check {
  font-size: 12px;
}
.sb-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: auto;
  border-radius: 50%;
  background: var(--brand-lime);
}
/* Punto de estado (solo mobile, donde la celda no muestra el texto): marfil disponible, contorno dorado en
   "Últimas" y un trazo marfil (tachado) en "Agotada" */
.sb-pip {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: auto;
  border-radius: 50%;
  background: rgba(240, 232, 216, 0.6);
}
.sb-cell.is-last .sb-pip {
  border: 1.5px solid var(--te-oro);
  background: transparent;
}
.sb-cell.is-soldout .sb-pip {
  width: 10px;
  height: 2px;
  border-radius: 1px;
  background: var(--te-text-1);
}
.sb-time,
.sb-state {
  position: relative;
  z-index: 1;
  display: none;
  font-size: 11px;
  line-height: 15px;
  color: var(--te-text-2);
}
.sb-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: rgba(240, 232, 216, 0.06);
}
.sb-fill {
  display: block;
  height: 100%;
  background: var(--te-oro);
  transform-origin: left center;
}
.sb-cell.is-last {
  border-color: var(--te-oro);
}
.sb-cell.is-last .sb-state {
  color: var(--te-oro);
}
.sb-cell.is-soldout {
  border-color: transparent;
}
.sb-velvet {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: var(--te-velvet);
}
.sb-cell.is-soldout .sb-state,
.sb-cell.is-soldout .sb-day {
  color: var(--te-text-1);
}
.sb-cell.is-soldout .sb-fill {
  background: rgba(240, 232, 216, 0.5);
}
/* Semana 3: el jueves que se afloja va con la barra en marfil al 40 % (no en dorado) */
.sb-cell.is-low .sb-fill {
  background: rgba(240, 232, 216, 0.4);
}
/* "Realizada" atenuada: se apagan el fondo, el borde y la barra, no el texto (que queda en --te-text-3, AA) */
.sb-cell.is-done {
  border-color: var(--te-line);
  background: transparent;
}
.sb-cell.is-done .sb-day,
.sb-cell.is-done .sb-time,
.sb-cell.is-done .sb-state {
  color: var(--te-text-3);
}
.sb-cell.is-done .sb-fill {
  opacity: 0.45;
}
.sb-cell.is-done.has-payout {
  border-color: var(--te-line-strong);
}
.sb-cell.is-done.has-payout .sb-day {
  color: var(--te-text-2);
}
/* Leyenda de estados (en mobile la celda muestra solo el número y el punto) */
.sb-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 10px;
  font-size: 12px;
  line-height: 18px;
  color: var(--te-text-3);
}
.sb-legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sb-key {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid var(--te-line-strong);
  background: var(--te-sala-2);
}
.sb-key.is-last {
  border-color: var(--te-oro);
}
.sb-key.is-soldout {
  border-color: transparent;
  background: var(--te-velvet);
}
.sb-key.is-done {
  border-color: var(--te-line);
  background: transparent;
}
.sb-dot-key {
  margin-left: 0;
}

/* Panel "Esta semana" */
.sb-panel {
  min-height: 300px;
  padding: 22px 20px;
  border-top: 1px solid rgba(212, 175, 106, 0.6);
  border-radius: 10px;
  background: var(--te-sala-2);
}
.sb-panel-title {
  margin-top: 6px;
  font-size: 28px;
  line-height: 34px;
}
.sb-items {
  display: grid;
  gap: 16px;
  margin-top: 18px;
}
.sb-item {
  display: flex;
  gap: 12px;
  font-size: 15px;
  line-height: 23px;
  color: var(--te-text-2);
}
.sb-icon {
  flex: 0 0 auto;
  display: inline-flex;
  margin-top: 2px;
  color: var(--te-oro);
}
.sb-item-title {
  font-weight: 600;
  color: var(--te-text-1);
}
.sb-item-text {
  display: block;
  margin-top: 2px;
}
.sb-soon {
  margin-left: 6px;
}
@media (min-width: 640px) {
  .sb-pip {
    display: none;
  }
  .sb-time,
  .sb-state {
    display: block;
  }
  .sb-time {
    margin-top: 2px;
    color: var(--te-text-3);
  }
  .sb-state {
    margin-top: auto;
  }
  .sb-cell {
    height: 96px;
    padding: 8px 10px 12px;
  }
  .sb-day {
    font-size: 24px;
    line-height: 28px;
  }
  .sb-num {
    font-size: 40px;
    line-height: 44px;
  }
  .sb-num-reviews {
    font-size: 28px;
  }
  .sb-counter dt {
    font-size: 12px;
  }
  .sb-board-top {
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
  }
  .sb-counters {
    flex: 1 1 auto;
    gap: 20px;
  }
}
@media (min-width: 1024px) {
  /* Cartelera a la izquierda, panel a la derecha y, abajo, el fader a ancho completo */
  .sb-grid {
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 40px;
    align-items: start;
  }
  .sb-board {
    grid-area: 1 / 1;
  }
  .sb-panel {
    grid-area: 1 / 2;
  }
  .sb-fader {
    grid-area: 2 / 1 / 3 / -1;
  }
  .sb-panel {
    min-height: 100%;
    padding: 28px 28px 32px;
  }
  .sb-item {
    font-size: 16px;
    line-height: 25px;
  }
}

/* ---- Movimiento (solo con JS y sin "reducir movimiento": is-animated) ---- */
.sb-fill {
  transition: transform 400ms var(--ease-out);
}
@keyframes sb-cell-in {
  from {
    opacity: 0;
    transform: scale(0.94);
  }
}
@keyframes sb-velvet-in {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0);
  }
}
/* T12: cada celda que cambia de estado se vuelve a crear (key) y entra con stagger de 30 ms en orden de calendario */
.sb.is-animated .sb-cell {
  animation: sb-cell-in 260ms var(--ease-out) calc(var(--i) * 30ms) both;
}
.sb.is-animated .sb-velvet {
  animation: sb-velvet-in 240ms var(--ease-out) calc(var(--i) * 30ms + 60ms) both;
}
.sb-panel-enter-active,
.sb-panel-leave-active {
  transition: opacity 260ms var(--ease-out), transform 260ms var(--ease-out);
}
.sb-panel-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.sb-panel-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
@media (prefers-reduced-motion: reduce) {
  .sb-fill,
  .sb-panel-enter-active,
  .sb-panel-leave-active {
    transition-duration: 1ms;
  }
}
</style>
