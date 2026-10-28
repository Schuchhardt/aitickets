<script setup>
// Card "La serie de la semana" (SPEC_landing_clubs §4.3, card 1): los 7 días hasta el viernes con la cadencia real
// (DEFAULT_CADENCE de socialSeriesCadence.ts, llega por props; weekSeries usa la misma regla que planSlots). Con una
// noche semanal se está en la banda diaria: historia todos los días, post hasta D-feed_posts_to_days y la historia del
// día a las event_day_time. Cada pieza es una cápsula LED (historia = fluor, post = blanco). La serie sale en Instagram
// y, si se conectan, en Facebook y TikTok; el reel usa el video vertical de la noche. C9: las cápsulas aparecen con pop
// (stagger 50 ms) al hidratarse (client:visible).
// Mobile: la tira de 7 días tiene scroll horizontal.
import { onMounted, ref } from 'vue'
import { weekSeries } from './clubsLanding.js'

const props = defineProps({
  /** DEFAULT_CADENCE (socialSeriesCadence.ts) */
  cadence: { type: Object, required: true },
})

const days = weekSeries(props.cadence)
const stories = days.filter((d) => d.story).length
const posts = days.filter((d) => d.post).length
const playing = ref(false)
onMounted(() => {
  playing.value = document.documentElement.classList.contains('lp-motion')
})
</script>

<template>
  <div class="sw cl-card" :class="{ 'is-playing': playing }" data-testid="club-series">
    <div class="sw-head">
      <h3 class="sw-title">La serie de la semana</h3>
      <p class="cl-example">ejemplo</p>
    </div>
    <ul class="sw-chips" aria-label="Redes">
      <li v-for="net in ['Instagram', 'Facebook', 'TikTok', 'Reel con tu video']" :key="net" class="sw-chip is-on"><span class="sw-chip-dot" aria-hidden="true"></span>{{ net }}</li>
    </ul>
    <ol class="sw-days" aria-label="Piezas programadas por día">
      <li v-for="(d, i) in days" :key="d.day" class="sw-day" :class="{ 'is-night': d.day === 0 }">
        <span class="sw-wd">{{ d.weekday }}</span>
        <span v-if="d.story" class="sw-slot sw-story" :style="{ '--i': i * 2 }">
          <span class="lp-sr-only">Historia a las</span> {{ d.time }}
        </span>
        <span v-if="d.post" class="sw-slot sw-post" :style="{ '--i': i * 2 + 1 }">
          <span class="lp-sr-only">y</span> post
        </span>
      </li>
    </ol>
    <p class="sw-legend">
      <strong>{{ stories }} historias · {{ posts }} posts esta semana</strong>
      · hora: la de más visitas de tu evento, o {{ props.cadence.default_time }}
    </p>
  </div>
</template>

<style scoped>
.sw {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 18px;
}
.sw-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.sw-title {
  font-size: 17px;
  line-height: 24px;
  font-weight: 700;
}
.sw-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sw-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 3px 10px;
  border: 1px solid var(--cl-line-strong);
  border-radius: 10px;
  font-size: 13px;
  color: var(--cl-text-3);
}
.sw-chip.is-on {
  border-color: var(--brand-lime);
  color: var(--cl-text-1);
  font-weight: 600;
}
.sw-chip-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--brand-lime);
}
.sw-days {
  display: grid;
  grid-template-columns: repeat(7, minmax(64px, 1fr));
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
  scroll-snap-type: x proximity;
}
.sw-day {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 6px;
  border: 1px solid var(--cl-line);
  border-radius: 12px;
  background: var(--cl-noche-2);
  scroll-snap-align: start;
}
.sw-day.is-night {
  border-color: var(--cl-line-glow);
}
.sw-wd {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--cl-text-3);
  text-align: center;
}
.sw-day.is-night .sw-wd {
  color: var(--cl-text-1);
}
.sw-slot {
  display: block;
  padding: 3px 0;
  border-radius: 999px;
  font-size: 11px;
  line-height: 15px;
  font-weight: 700;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.sw-story {
  background: var(--cl-fluor);
  color: var(--cl-ink);
  box-shadow: 0 0 10px rgba(255, 79, 184, 0.45);
}
.sw-post {
  background: #fff;
  color: var(--cl-ink);
}
.sw-legend {
  font-size: 13px;
  line-height: 19px;
  color: var(--cl-text-3);
}
.sw-legend strong {
  font-weight: 600;
  color: var(--cl-text-1);
}
/* En mobile angosto la leyenda va al lado de la historia (ClubDiffusion): aquí queda solo para lectores de pantalla */
@media (max-width: 479px) {
  .sw-legend {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }
}
@media (min-width: 1024px) {
  .sw {
    padding: 22px;
  }
  .sw-days {
    overflow: visible;
  }
}
/* C9: pop de las cápsulas al hidratarse */
.sw.is-playing .sw-slot {
  animation: cl-pop 320ms var(--ease-spring) calc(var(--i) * 50ms) both;
}
</style>
