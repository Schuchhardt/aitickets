<script setup>
// La serie en el tiempo (SPEC_landing_musica §4.8, card 1): de D-14 al día del show, una marca por pieza calculada con
// la cadencia real (seriesMarks + DEFAULT_CADENCE, que la página pasa por props): historias = barras rojas altas,
// posts de feed = barras de papel bajas, como un ecualizador. La leyenda cuenta las piezas y dice la hora (la de más
// visitas del evento o default_time; la del día del show, event_day_time). Hoy la serie publica solo en Instagram:
// Facebook, TikTok y reels van con "Pronto". No necesita JS: se renderiza en el servidor (sin client:*); M14 (pop de
// las barras con 40 ms por día) cuelga del [data-lp-reveal] de la sección.
import SoonBadge from '../../ui/SoonBadge.vue'
import { seriesCounts, seriesMarks } from './musicaLanding.js'

const props = defineProps({
  /** DEFAULT_CADENCE de src/lib/socialSeriesCadence.ts */
  cadence: { type: Object, required: true },
})

const marks = seriesMarks(props.cadence)
const counts = seriesCounts(marks)
const labeled = new Set([14, props.cadence.sparse_start_days, props.cadence.daily_from_days, 3, 0])
const soon = ['Facebook', 'TikTok', 'Reels']
</script>

<template>
  <div class="st" data-testid="music-series">
    <p class="mu-mono st-title">La serie en el tiempo · ejemplo</p>
    <div class="st-scroll">
      <ol class="st-days" aria-label="Publicaciones de los últimos 14 días antes del show">
        <li v-for="(m, i) in marks" :key="m.day" class="st-day" :style="{ '--i': i }">
          <span class="lp-sr-only">{{ m.label }}: {{ [m.story && 'historia', m.post && 'post'].filter(Boolean).join(' y ') || 'nada' }}</span>
          <span class="st-bars" aria-hidden="true">
            <span v-if="m.story" class="st-bar st-story"></span>
            <span v-if="m.post" class="st-bar st-post"></span>
          </span>
          <span class="mu-mono st-label" :class="{ 'is-show': m.day === 0 }" aria-hidden="true">{{ labeled.has(m.day) ? m.label : '' }}</span>
        </li>
      </ol>
    </div>
    <p class="mu-mono st-legend">
      <span class="st-key st-key-story" aria-hidden="true"></span>{{ counts.stories }} historias ·
      <span class="st-key st-key-post" aria-hidden="true"></span>{{ counts.posts }} posts · hora: la de más visitas de tu
      evento, o {{ props.cadence.default_time }}. El día del show, a las {{ props.cadence.event_day_time }}.
    </p>
    <ul class="st-nets" aria-label="Redes">
      <li class="mu-chip st-net st-net-on"><span class="st-net-dot" aria-hidden="true">●</span> Instagram</li>
      <li v-for="net in soon" :key="net" class="mu-chip st-net">{{ net }} <SoonBadge dark /></li>
    </ul>
  </div>
</template>

<style scoped>
.st {
  padding: 20px;
  border: 1px solid var(--mu-line);
  border-radius: 4px;
  background: var(--mu-stage);
}
.st-title {
  font-size: 12px;
  color: var(--mu-text-3);
}
.st-scroll {
  margin: 16px -20px 0;
  padding: 0 20px;
  overflow-x: auto;
  scrollbar-width: thin;
}
.st-days {
  display: grid;
  grid-template-columns: repeat(15, minmax(22px, 1fr));
  gap: 4px;
  min-width: 420px;
  border-bottom: 1px solid var(--mu-line-strong);
}
.st-day {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.st-bars {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  height: 72px;
}
.st-bar {
  width: 6px;
  transform-origin: bottom;
}
.st-story {
  height: 64px;
  background: var(--mu-red);
}
.st-post {
  height: 28px;
  background: var(--mu-paper);
}
.st-label {
  height: 26px;
  padding-top: 8px;
  font-size: 10px;
  line-height: 12px;
  white-space: nowrap;
  color: var(--mu-text-3);
}
.st-label.is-show {
  color: var(--mu-text-1);
  font-weight: 700;
}
.st-legend {
  margin-top: 14px;
  font-size: 12px;
  line-height: 20px;
  color: var(--mu-text-2);
}
.st-key {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
}
.st-key-story {
  background: var(--mu-red);
}
.st-key-post {
  background: var(--mu-paper);
}
.st-nets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 16px;
}
.st-net-on {
  border-color: var(--brand-lime);
  color: var(--mu-text-1);
}
.st-net-dot {
  color: var(--brand-lime);
  font-size: 10px;
}
@media (min-width: 1024px) {
  .st {
    padding: 24px;
  }
  .st-scroll {
    margin: 18px 0 0;
    padding: 0;
    overflow: visible;
  }
  .st-days {
    min-width: 0;
  }
}
/* M14: las barras aparecen con pop de scaleY, 40 ms por día */
.lp-motion [data-lp-reveal]:not(.is-in) .st-bar {
  transform: scaleY(0);
}
.lp-motion .is-in .st-bar {
  animation: mu-pop-y 420ms var(--ease-spring) calc(var(--i) * 40ms + 200ms) both;
}
</style>
