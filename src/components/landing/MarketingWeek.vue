<script setup>
// Demo del calendario de difusión automática (SPEC_landing_productores §5.4b). Muestra lo que hace el producto
// (src/lib/socialSeries.ts): historias y posts de feed automáticos en Instagram, la misma serie en Facebook y TikTok si
// se conectan, y el reel con el video del evento (switch apagado de partida: necesita un video vertical corto). Las
// horas vienen de DEFAULT_CADENCE.
// Movimiento (§5.4b, con html.lp-motion de LandingMotion.astro): cuando la sección entra en pantalla, las publicaciones
// aparecen día por día (70 ms por día, 40 ms entre publicaciones del mismo día); al prender un switch, sus publicaciones
// entran igual. El contador interpola como el total de la calculadora y, como ahí, el lector de pantalla lee solo el valor
// final desde una región aparte (sin los números intermedios). Analítica (§11): lp_mk_toggle { type, on } por switch.
import { computed, reactive } from 'vue'
import AnimatedNumber from '../event/AnimatedNumber.vue'
import { marketingPostCount, marketingWeek } from './producerLanding.js'
import { trackEvent } from '../../composables/useGoogleAnalytics.js'

const props = defineProps({
  eventName: { type: String, required: true },
  /** Hora de las publicaciones de la semana y de la historia del día de la función (HH:MM) */
  dailyTime: { type: String, required: true },
  eventDayTime: { type: String, required: true },
})

const on = reactive({ story: true, post: true, reel: false })
const week = computed(() => marketingWeek(on, { daily: props.dailyTime, eventDay: props.eventDayTime }))
const count = computed(() => marketingPostCount(week.value))

const toggles = [
  // La semana del ejemplo es la última antes de la función: ahí la historia ya es diaria (antes, cada pocos días)
  { key: 'story', label: 'Historia con cuenta regresiva' },
  { key: 'post', label: 'Publicación diaria la última semana' },
  { key: 'reel', label: 'Reel con el video del evento' },
]
const networks = [
  { label: 'Instagram', connected: true },
  { label: 'Facebook', connected: true },
  { label: 'TikTok', connected: true },
]

function flip(key) {
  on[key] = !on[key]
  trackEvent('lp_mk_toggle', { type: key, on: on[key] })
}

// Retraso de la entrada de cada publicación: después del fade de la card, en cascada por día y por publicación
const slotDelay = (dayIndex, slotIndex) => `${200 + dayIndex * 70 + slotIndex * 40}ms`

const slotText = (slot) => (slot.state === 'past' ? 'Publicado ✓' : slot.state === 'today' ? `Hoy ${slot.time}` : slot.time)
</script>

<template>
  <div class="mw lp-card" data-testid="marketing-week">
    <div class="mw-head">
      <p class="mw-title">Esta semana · {{ props.eventName }}</p>
      <ul class="mw-nets" aria-label="Redes">
        <li v-for="n in networks" :key="n.label" class="lp-chip" :class="{ 'mw-net-on': n.connected }">
          <span class="mw-dot" :class="{ 'is-on': n.connected }" aria-hidden="true"></span>
          {{ n.label }}<span v-if="n.connected" class="lp-sr-only"> (conectada)</span>
        </li>
      </ul>
    </div>

    <ol class="mw-grid" aria-label="Publicaciones programadas de la semana">
      <li v-for="(d, di) in week" :key="d.num" class="mw-day" :class="{ 'is-today': d.isToday }">
        <p class="mw-day-head"><span>{{ d.dow }}</span><span>{{ d.num }}</span></p>
        <p v-if="d.isShow" class="mw-show">FUNCIÓN</p>
        <TransitionGroup name="mw-slot" tag="ul" class="mw-slots">
          <li v-for="(s, si) in d.slots" :key="s.kind" class="mw-slot" :class="`is-${s.state}`" :style="{ '--mw-d': slotDelay(di, si) }">
            <span class="mw-slot-kind">{{ s.label }}</span>
            <span class="mw-slot-status">{{ slotText(s) }}</span>
          </li>
        </TransitionGroup>
      </li>
    </ol>

    <div class="mw-foot">
      <button
        v-for="t in toggles"
        :key="t.key"
        type="button"
        role="switch"
        class="mw-switch"
        :aria-checked="on[t.key] ? 'true' : 'false'"
        :data-testid="`marketing-toggle-${t.key}`"
        @click="flip(t.key)"
      >
        <span class="mw-track" :class="{ 'is-on': on[t.key] }" aria-hidden="true"><span class="mw-knob"></span></span>
        {{ t.label }}
      </button>
      <p class="mw-count" aria-hidden="true"><AnimatedNumber :value="count" format="plain" /> publicaciones esta semana</p>
      <p class="lp-sr-only" aria-live="polite">{{ count }} publicaciones esta semana</p>
    </div>
    <p class="lp-small mw-note">
      Se publican a la hora en que más visitas tiene tu evento ({{ props.dailyTime }} mientras no hay datos). Apruebas la
      serie una vez, con vista previa de cada pieza, y sale igual en tu Instagram, tu página de Facebook y tu TikTok. Quien
      responde una historia o comenta una publicación con la palabra clave recibe el link de compra por DM, con su propio
      seguimiento en las métricas.
    </p>
    <p class="lp-example mw-example">Datos de ejemplo</p>
  </div>
</template>

<style scoped>
.mw {
  padding: 24px;
}
.mw-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.mw-title {
  font-weight: 600;
}
.mw-nets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.mw-net-on {
  color: var(--text-1);
}
.mw-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c4c4c8;
}
.mw-dot.is-on {
  background: var(--lp-lime-ink);
}
.mw-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  margin-top: 18px;
}
.mw-day {
  min-height: 150px;
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface-0);
}
.mw-day.is-today {
  border-color: var(--brand-lime);
  background: var(--lp-lime-wash);
}
.mw-day-head {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
}
.is-today .mw-day-head {
  color: var(--lp-lime-deep);
}
.mw-show {
  padding: 3px 4px;
  border-radius: 5px;
  background: var(--brand-ink);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
}
.mw-slots {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.mw-slot {
  display: flex;
  flex-direction: column;
  padding: 5px 6px;
  border-radius: 7px;
  background: var(--surface-1);
  font-size: 11px;
  line-height: 14px;
}
.mw-slot.is-past {
  background: var(--lp-lime-tint);
  color: var(--lp-lime-deep);
}
.mw-slot.is-today {
  background: var(--brand-lime);
  color: var(--brand-ink);
}
.mw-slot-kind {
  font-weight: 600;
}
.mw-slot-status {
  opacity: 0.85;
}
/* Entrada de las publicaciones: al revelar la sección y al prender un switch (los slots nuevos vuelven a animar).
   html.lp-motion y [data-lp-reveal] están fuera del componente: el scope solo se agrega a .mw-slot. */
@keyframes mw-slot-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.96);
  }
}
.lp-motion [data-lp-reveal]:not(.is-in) .mw-slot {
  opacity: 0;
}
.lp-motion .is-in .mw-slot {
  animation: mw-slot-in 360ms var(--ease-spring) var(--mw-d, 0ms) both;
}
.mw-slot-leave-active {
  transition: opacity var(--dur-2) var(--ease-out);
}
/* Al salir, sin la animación de entrada: si no, Vue espera su duración (con retraso) antes de sacar el slot */
.lp-motion .is-in .mw-slot.mw-slot-leave-active {
  animation: none;
}
.mw-slot-leave-to {
  opacity: 0;
}
.mw-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 18px;
}
.mw-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px 0 6px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-pill);
  background: var(--surface-0);
  font-family: inherit;
  font-size: 13px;
  color: var(--text-1);
  cursor: pointer;
}
.mw-switch:disabled {
  cursor: not-allowed;
  color: var(--text-2);
}
.mw-switch:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px #fff, 0 0 0 6px var(--brand-lime);
}
.mw-track {
  position: relative;
  width: 30px;
  height: 18px;
  border-radius: var(--r-pill);
  background: #d4d4d8;
  transition: background-color var(--dur-2);
}
.mw-track.is-on {
  background: var(--brand-ink);
}
.mw-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform var(--dur-2) var(--ease-in-out);
}
.mw-track.is-on .mw-knob {
  transform: translateX(12px);
}
.mw-count {
  margin-left: auto;
  font-size: 13px;
  color: var(--text-2);
}
.mw-note {
  margin-top: 12px;
}
.mw-example {
  margin-top: 6px;
}
@media (prefers-reduced-motion: reduce) {
  .mw-slot-leave-active,
  .mw-track,
  .mw-knob {
    transition-duration: 1ms;
  }
}
</style>
