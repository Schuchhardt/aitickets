<script setup>
// La noche en vivo (SPEC_landing_clubs §4.5, firma): panel de una noche de ejemplo que se mueve con un crossfader de
// 22:00 a 05:00 en pasos de 15 min. Cada posición sale de nightState (clubsLanding.js): letrero LED de la puerta, aforo
// (Doto 96 px y 30 LED), llegadas cada 15 min de las últimas 3 h y ingresados / emitidos por tipo de entrada, como
// get_checkin_stats ("Aforo en vivo", tools/access.ts); a la derecha, la respuesta del asistente de IA con los mismos
// datos (aiAnswer). El mismo aforo se ve en el panel (pestaña Puerta, LiveCapacityPanel.vue). Lo que no existe va con
// "Pronto": validar la hora de ingreso de la lista. El cobro de la noche: término + PAYOUT_RELEASE_HOURS
// (LIVE_PAYOUT), con "*" de términos.
// C11: al entrar en pantalla la noche corre sola una vez de 22:00 a 01:30 en 4 s y se detiene; después manda la
// persona ("↻ Repetir"). Con "reducir movimiento" (o sin JS: SSR) queda quieta en 01:30, sin corrida ni botón.
// A11y: role="group"; los números se anuncian al soltar la perilla (useDelayedAnnouncement); el crossfader lleva
// aria-valuetext "01:30, 455 personas adentro". Mobile: el crossfader va pegado arriba (sticky, top 64 px).
// Analítica: cl_night_scrub { hour } al soltar (una vez por hora entera, con pausa), cl_night_replay.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import SoonBadge from '../../ui/SoonBadge.vue'
import Crossfader from './Crossfader.vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { useDelayedAnnouncement } from '../../../composables/usePriceCalculator.js'
import { TERMS_NOTE } from '../../../data/producerFaq'
import {
  ARRIVALS_MAX,
  CLUB_TICKETS,
  LIST_CLOSES_AT,
  LIVE_PAYOUT,
  NIGHT_CAPACITY,
  NIGHT_PEAK_STEP,
  aiAnswer,
  nightState,
  nightValueText,
} from './clubsLanding.js'

const step = ref(NIGHT_PEAK_STEP)
const state = computed(() => nightState(step.value))
const answer = computed(() => aiAnswer(state.value))
const released = ref(NIGHT_PEAK_STEP)
const announced = useDelayedAnnouncement(released, (s) => {
  const st = nightState(s)
  return `${st.time}: ${aiAnswer(st)}`
})
const leds = Array.from({ length: 30 }, (_, i) => i)
const num = (n) => n.toLocaleString('es-CL')

const motion = ref(false)
const root = ref(null)
let timer = 0
let observer = null

function stopRun() {
  clearInterval(timer)
  timer = 0
}
/** Corrida automática: 22:00 → 01:30 en 4 s (C11) */
function run() {
  stopRun()
  step.value = 0
  const every = 4000 / NIGHT_PEAK_STEP
  timer = setInterval(() => {
    if (step.value >= NIGHT_PEAK_STEP) return stopRun()
    step.value += 1
  }, every)
}
function replay() {
  run()
  trackEvent('cl_night_replay', {})
}

const scrubbed = new Set()
let scrubTimer = 0
function onRelease(value) {
  stopRun()
  released.value = value
  clearTimeout(scrubTimer)
  scrubTimer = setTimeout(() => {
    const hour = nightState(value).time.slice(0, 2)
    if (scrubbed.has(hour)) return
    scrubbed.add(hour)
    trackEvent('cl_night_scrub', { hour })
  }, 600)
}
function onInput(value) {
  stopRun()
  step.value = value
}

onMounted(() => {
  motion.value = document.documentElement.classList.contains('lp-motion')
  if (!motion.value || !('IntersectionObserver' in window)) return
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer.disconnect()
      run()
    },
    { threshold: 0.35 },
  )
  observer.observe(root.value)
})
onBeforeUnmount(() => {
  stopRun()
  clearTimeout(scrubTimer)
  observer?.disconnect()
})
</script>

<template>
  <div ref="root" class="nl" role="group" aria-label="Panel de una noche de ejemplo" data-testid="club-night">
    <div class="nl-fader">
      <Crossfader :model-value="step" :valuetext="nightValueText(state)" @update:model-value="onInput" @release="onRelease" />
    </div>

    <div class="nl-panel cl-card cl-card-glow">
      <div class="nl-panel-head">
        <p class="cl-example">Noche de ejemplo · aforo {{ num(NIGHT_CAPACITY) }}</p>
        <button v-if="motion" type="button" class="nl-replay" data-testid="club-night-replay" @click="replay">↻ Repetir</button>
      </div>

      <div class="cl-sign nl-sign">
        <p :key="state.sign" class="cl-sign-text is-switching" aria-live="off" data-testid="club-night-sign">{{ state.sign }}</p>
      </div>

      <div class="nl-aforo">
        <p class="nl-count" data-testid="club-night-inside">{{ num(state.inside) }}</p>
        <p class="nl-of">de {{ num(NIGHT_CAPACITY) }} · {{ state.pct }}%</p>
      </div>
      <div class="nl-leds" aria-hidden="true">
        <span v-for="i in leds" :key="i" class="nl-led" :class="{ 'is-on': i < state.segments }"></span>
      </div>
      <p v-if="!state.opened" class="nl-note">
        Lista free {{ num(state.byKind[0].issued) }} / {{ num(CLUB_TICKETS.lista.capacity) }} inscritos · Mesas
        {{ state.tablesSold }} / {{ state.tablesTotal }} vendidas
      </p>
      <p v-else-if="!state.final" class="nl-note">Mesas {{ state.tablesSold }} / {{ state.tablesTotal }} vendidas</p>

      <div class="nl-mid">
        <div class="nl-arrivals">
          <p class="cl-meta">Llegadas cada 15 min</p>
          <ol class="nl-bars" aria-hidden="true">
            <li v-for="(n, i) in state.arrivals" :key="i" :class="{ 'is-now': i === state.arrivals.length - 1 }">
              <span :style="{ transform: `scaleY(${n / ARRIVALS_MAX})` }"></span>
            </li>
          </ol>
          <p class="nl-bars-axis" aria-hidden="true"><span>−3 h</span><span>ahora</span></p>
        </div>
        <div class="nl-types">
          <p class="cl-meta">Por tipo de entrada</p>
          <ul>
            <li v-for="row in state.byKind" :key="row.kind" class="nl-type">
              <p class="nl-type-row">
                <span>{{ row.name }}</span>
                <span class="cl-tabular"><strong>{{ num(row.inside) }}</strong> / {{ num(row.issued) }}</span>
              </p>
              <span class="nl-type-bar" aria-hidden="true"><span :style="{ transform: `scaleX(${row.issued ? row.inside / row.issued : 0})` }"></span></span>
              <p v-if="row.kind === 'lista' && state.listClosed" class="nl-type-note">
                Inscripción cerrada {{ LIST_CLOSES_AT }} · Validar la hora de ingreso de la lista <SoonBadge dark />
              </p>
            </li>
          </ul>
        </div>
      </div>

      <div v-if="state.final" class="nl-final" data-testid="club-night-final">
        <p>Ingresaron {{ num(state.inside) }} de {{ num(state.issuedTotal) }} · Lo de esta noche queda disponible el {{ LIVE_PAYOUT }}*</p>
        <a :href="TERMS_NOTE.href" class="cl-link nl-terms">{{ TERMS_NOTE.text }}</a>
      </div>
    </div>

    <div class="nl-ai">
      <p class="cl-meta">Pregúntale a tu IA</p>
      <p class="nl-bubble nl-user">¿Cuánta gente hay adentro?</p>
      <p class="nl-bubble nl-bot" data-testid="club-night-ai">{{ answer }}</p>
      <ul class="nl-chips" aria-label="De dónde sale cada dato">
        <li>Contador en el escáner</li>
        <li>Aforo por tipo y llegadas: tu asistente de IA</li>
        <li>Aforo en vivo en tu panel</li>
      </ul>
    </div>

    <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
  </div>
</template>

<style scoped>
.nl {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
/* Mobile: el crossfader queda pegado arriba (bajo el header) mientras se recorre el panel */
.nl-fader {
  position: sticky;
  top: 64px;
  z-index: 3;
  margin-inline: -8px;
  padding: 4px 16px 8px;
  border: 1px solid var(--cl-line);
  border-radius: 16px;
  background: rgba(7, 6, 11, 0.92);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}
.nl-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 16px;
}
.nl-panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.nl-replay {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--cl-line-strong);
  border-radius: 10px;
  background: none;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--cl-text-2);
  cursor: pointer;
}
.nl-replay:focus-visible {
  outline: 2px solid var(--cl-uv-soft);
  outline-offset: 2px;
}
.nl-sign {
  min-height: 84px;
  box-shadow: 0 0 40px rgba(255, 79, 184, 0.12);
}
.nl-aforo {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 14px;
}
.nl-count {
  font-family: var(--cl-led);
  font-weight: 800;
  font-size: 72px;
  line-height: 0.95;
  color: var(--cl-fluor);
  font-variant-numeric: tabular-nums;
  text-shadow: var(--cl-glow);
}
.nl-of {
  font-size: 15px;
  font-weight: 600;
  color: var(--cl-text-2);
  font-variant-numeric: tabular-nums;
}
.nl-leds {
  display: grid;
  grid-template-columns: repeat(30, minmax(0, 1fr));
  gap: 3px;
}
.nl-led {
  height: 12px;
  border-radius: 3px;
  background: var(--cl-fluor);
  box-shadow: 0 0 6px rgba(255, 79, 184, 0.6);
  opacity: 0.12;
  transition: opacity 160ms var(--ease-out);
}
.nl-led.is-on {
  opacity: 1;
}
.nl-note {
  font-size: 14px;
  font-weight: 600;
  color: var(--cl-text-2);
  font-variant-numeric: tabular-nums;
}
.nl-mid {
  display: grid;
  gap: 16px;
}
.nl-bars {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  align-items: end;
  gap: 4px;
  height: 64px;
  margin-top: 8px;
}
.nl-bars li {
  height: 100%;
  display: flex;
  align-items: flex-end;
}
.nl-bars span {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 3px 3px 0 0;
  background: var(--cl-uv);
  transform-origin: bottom center;
  transition: transform 200ms var(--ease-out);
}
.nl-bars li.is-now span {
  background: var(--cl-fluor);
  box-shadow: 0 0 10px rgba(255, 79, 184, 0.6);
}
.nl-bars-axis {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 12px;
  color: var(--cl-text-3);
}
.nl-types ul {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.nl-type-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
}
.nl-type-row strong {
  font-weight: 700;
  color: var(--cl-text-1);
}
.nl-type-bar {
  display: block;
  height: 3px;
  margin-top: 4px;
  border-radius: 2px;
  background: var(--cl-led-off);
  overflow: hidden;
}
.nl-type-bar span {
  display: block;
  height: 100%;
  background: var(--cl-uv-soft);
  transform-origin: left center;
  transition: transform 200ms var(--ease-out);
}
.nl-type-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin-top: 4px;
  font-size: 12px;
  line-height: 17px;
  color: var(--cl-text-3);
}
.nl-final {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--cl-servicio);
  color: var(--cl-ink);
  font-weight: 600;
  font-size: 15px;
  line-height: 22px;
}
.nl-terms {
  font-size: 12px;
  font-weight: 500;
  color: var(--cl-ink);
  text-decoration-color: rgba(20, 18, 28, 0.35);
}
.nl-ai {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.nl-bubble {
  max-width: 92%;
  padding: 12px 14px;
  border-radius: 16px;
  font-size: 15px;
  line-height: 23px;
}
.nl-user {
  align-self: flex-end;
  border-bottom-right-radius: 4px;
  background: var(--cl-text-1);
  color: var(--cl-ink);
  font-weight: 600;
}
.nl-bot {
  align-self: flex-start;
  border: 1px solid var(--cl-line);
  border-bottom-left-radius: 4px;
  background: var(--cl-noche-3);
  color: var(--cl-text-1);
  font-variant-numeric: tabular-nums;
}
.nl-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.nl-chips li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 3px 10px;
  border: 1px solid var(--cl-line-strong);
  border-radius: 10px;
  font-size: 12px;
  color: var(--cl-text-2);
}
@media (min-width: 640px) {
  .nl-mid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 20px;
  }
}
/* Desktop: panel (1,25) e IA (1) arriba y el crossfader a todo el ancho abajo */
@media (min-width: 1024px) {
  .nl {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    grid-template-areas: "panel ai" "fader fader";
    gap: 24px 32px;
    align-items: start;
  }
  .nl-panel {
    grid-area: panel;
    padding: 24px;
  }
  .nl-ai {
    grid-area: ai;
    padding-top: 8px;
  }
  .nl-fader {
    grid-area: fader;
    position: static;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .nl-count {
    font-size: 96px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .nl-led,
  .nl-bars span,
  .nl-type-bar span {
    transition: none;
  }
}
</style>
