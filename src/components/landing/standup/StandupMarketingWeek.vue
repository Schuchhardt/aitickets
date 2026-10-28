<script setup>
// Calendario semanal de "Marketing en piloto automático" en la landing de stand-up (SPEC_landing_standup §4.4, S11 y
// S12). Misma semana y misma cadencia real que la demo de /organizadores (marketingWeek de producerLanding.js, horas de
// DEFAULT_CADENCE): la serie de src/lib/socialSeries.ts en Instagram, Facebook y TikTok, y el reel con el video del
// evento (switch apagado de partida: necesita un video vertical corto). Por eso los posts no son "lun · mié · vie 12:00" ni las
// historias "19:00" como en el prototipo: se muestra lo que hace el producto. Como en la spec, hay función el viernes y
// el sábado (SHOW_DAYS): el sábado también lleva su historia de la mañana, porque la serie se replanifica hacia la
// siguiente función cuando pasa una.
// En mobile solo se ven los switches y el contador, junto a la historia de ejemplo; el calendario y la nota, desde 900 px.
import { computed, reactive } from 'vue'
import AnimatedNumber from '../../event/AnimatedNumber.vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { MK_SHOW, marketingPostCount, marketingWeek } from '../producerLanding.js'

const props = defineProps({
  eventName: { type: String, required: true },
  /** Hora de inicio de la función de ejemplo (HH:MM) */
  showTime: { type: String, required: true },
  /** Hora de las publicaciones de la semana y de la historia del día de la función (HH:MM) */
  dailyTime: { type: String, required: true },
  eventDayTime: { type: String, required: true },
})

/** Funciones de la semana de ejemplo: viernes y sábado */
const SHOW_DAYS = [MK_SHOW, MK_SHOW + 1]

const on = reactive({ story: true, post: true, reel: false })
const week = computed(() => marketingWeek(on, { daily: props.dailyTime, eventDay: props.eventDayTime }, SHOW_DAYS))
const count = computed(() => marketingPostCount(week.value))

const toggles = [
  { key: 'story', label: 'Historia con cuenta regresiva' },
  { key: 'post', label: 'Post diario la última semana' },
  { key: 'reel', label: 'Reel con el video del evento' },
]
const networks = [
  { label: 'Instagram', connected: true },
  { label: 'Facebook', connected: true },
  { label: 'TikTok', connected: true },
]

function flip(key) {
  on[key] = !on[key]
  trackEvent('su_mk_toggle', { type: key, on: on[key] })
}

// S11: después del fade de la card, en cascada (70 ms por día, 40 ms por publicación del mismo día)
const slotDelay = (dayIndex, slotIndex) => `${200 + dayIndex * 70 + slotIndex * 40}ms`
const slotText = (slot) => (slot.state === 'past' ? 'Publicado ✓' : slot.state === 'today' ? `Hoy ${slot.time}` : slot.time)
</script>

<template>
  <div class="smw" data-testid="standup-marketing-week">
    <div class="smw-head">
      <p class="smw-title">Esta semana · {{ props.eventName }}</p>
      <ul class="smw-nets" aria-label="Redes">
        <li v-for="n in networks" :key="n.label" class="smw-net" :class="{ 'is-on': n.connected }">
          <span class="smw-dot" aria-hidden="true"></span>
          {{ n.label }}<template v-if="n.connected"> · conectado</template>
        </li>
      </ul>
    </div>

    <ol class="smw-grid" aria-label="Publicaciones programadas de la semana">
      <li v-for="(d, di) in week" :key="d.num" class="smw-day" :class="{ 'is-today': d.isToday }">
        <p class="smw-day-head"><span>{{ d.dow }}</span><span>{{ d.num }}</span></p>
        <p v-if="d.isShow" class="smw-show">FUNCIÓN {{ props.showTime }}</p>
        <TransitionGroup name="smw-slot" tag="ul" class="smw-slots">
          <li v-for="(s, si) in d.slots" :key="s.kind" class="smw-slot" :class="`is-${s.state}`" :style="{ '--smw-d': slotDelay(di, si) }">
            <span class="smw-slot-kind">{{ s.label }}</span>
            <span class="smw-slot-status">{{ slotText(s) }}</span>
          </li>
        </TransitionGroup>
      </li>
    </ol>

    <div class="smw-foot">
      <button
        v-for="t in toggles"
        :key="t.key"
        type="button"
        role="switch"
        class="smw-switch"
        :aria-checked="on[t.key] ? 'true' : 'false'"
        :data-testid="`standup-marketing-toggle-${t.key}`"
        @click="flip(t.key)"
      >
        <span class="smw-track" :class="{ 'is-on': on[t.key] }" aria-hidden="true"><span class="smw-knob"></span></span>
        <span class="smw-switch-label">{{ t.label }}</span>
      </button>
      <p class="smw-count" aria-hidden="true"><AnimatedNumber :value="count" format="plain" /> publicaciones esta semana</p>
      <p class="lp-sr-only" aria-live="polite">{{ count }} publicaciones esta semana</p>
    </div>
    <p class="smw-note">
      Se publican a la hora en que más visitas tiene tu evento ({{ props.dailyTime }} mientras no hay datos). Apruebas la
      serie una vez, con vista previa de cada pieza, y sale igual en Instagram, Facebook y TikTok. A quien responde una
      historia o comenta un post con la palabra clave le llega el link de compra por DM, con su propio seguimiento: ves
      cuántas entradas vendió.
    </p>
    <p class="su-example smw-example">Datos de ejemplo</p>
  </div>
</template>

<style scoped>
.smw {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.smw-head,
.smw-grid,
.smw-note,
.smw-example {
  display: none;
}
.smw-foot {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.smw-switch {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 6px 12px 6px 8px;
  border: 1px solid rgba(244, 237, 228, 0.16);
  border-radius: 14px;
  background: transparent;
  color: var(--sb-text-1);
  font-family: inherit;
  font-size: 13px;
  line-height: 17px;
  text-align: left;
  cursor: pointer;
}
.smw-switch:disabled {
  cursor: not-allowed;
  color: var(--sb-text-3);
}
.smw-switch:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--sb-ground), 0 0 0 6px var(--brand-lime);
}
.smw-switch-label {
  flex: 1;
}
.smw-track {
  position: relative;
  flex: 0 0 auto;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: rgba(244, 237, 228, 0.2);
  transition: background-color 200ms;
}
.smw-track.is-on {
  background: var(--brand-lime);
}
.smw-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 200ms var(--ease-in-out);
}
.smw-track.is-on .smw-knob {
  transform: translateX(14px);
}
.smw-count {
  font-size: 13px;
  color: var(--sb-text-3);
}

/* Calendario completo desde 900 px (card con fondo surface) */
@media (min-width: 900px) {
  .smw {
    gap: 0;
    padding: 24px;
    border: 1px solid rgba(244, 237, 228, 0.1);
    border-radius: 24px;
    background: var(--sb-surface);
  }
  .smw-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .smw-title {
    font-family: "Unbounded", system-ui, sans-serif;
    font-size: 16px;
    font-weight: 700;
  }
  .smw-nets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .smw-net {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border: 1px solid rgba(244, 237, 228, 0.2);
    border-radius: 999px;
    font-size: 13px;
    color: var(--sb-text-3);
  }
  .smw-net.is-on {
    border-color: rgba(154, 230, 0, 0.4);
    color: var(--sb-text-1);
  }
  .smw-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgba(244, 237, 228, 0.3);
  }
  .is-on .smw-dot {
    background: var(--brand-lime);
  }
  .smw-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 8px;
    margin-top: 20px;
  }
  .smw-day {
    min-height: 150px;
    padding: 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid rgba(244, 237, 228, 0.08);
    border-radius: 14px;
    background: rgba(244, 237, 228, 0.03);
  }
  .smw-day.is-today {
    border-color: rgba(154, 230, 0, 0.45);
    background: rgba(154, 230, 0, 0.06);
  }
  .smw-day-head {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--sb-text-3);
  }
  .is-today .smw-day-head {
    color: var(--brand-lime);
  }
  .smw-show {
    padding: 3px 4px;
    border-radius: 6px;
    background: var(--sb-accent-serif);
    color: var(--sb-ground);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-align: center;
  }
  .smw-slots {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .smw-slot {
    display: flex;
    flex-direction: column;
    padding: 6px 7px;
    border-radius: 8px;
    background: rgba(244, 237, 228, 0.07);
    color: #d9d0c5;
    font-size: 11px;
    line-height: 14px;
  }
  .smw-slot.is-past {
    background: rgba(154, 230, 0, 0.16);
    color: #cfea9c;
  }
  .smw-slot.is-today {
    background: var(--brand-lime);
    color: var(--sb-ground);
  }
  .smw-slot-kind {
    font-weight: 600;
  }
  .smw-slot-status {
    opacity: 0.85;
  }
  .smw-foot {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 20px;
  }
  .smw-switch {
    min-height: 40px;
    padding: 0 14px 0 8px;
    border-radius: 999px;
    font-size: 14px;
  }
  .smw-count {
    margin-left: auto;
    font-size: 14px;
  }
  .smw-note {
    display: block;
    margin-top: 14px;
    font-size: 13px;
    line-height: 20px;
    color: var(--sb-text-3);
  }
  .smw-example {
    display: block;
    margin-top: 6px;
  }
}

/* S11: publicaciones que entran al revelar la sección y al prender un switch */
@keyframes smw-slot-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.96);
  }
}
.lp-motion [data-lp-reveal]:not(.is-in) .smw-slot {
  opacity: 0;
}
.lp-motion .is-in .smw-slot {
  animation: smw-slot-in 360ms var(--ease-spring) var(--smw-d, 0ms) both;
}
.smw-slot-leave-active {
  transition: opacity var(--dur-2) var(--ease-out);
}
.lp-motion .is-in .smw-slot.smw-slot-leave-active {
  animation: none;
}
.smw-slot-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .smw-slot-leave-active,
  .smw-track,
  .smw-knob {
    transition-duration: 1ms;
  }
}
</style>
