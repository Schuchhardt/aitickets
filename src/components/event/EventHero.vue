<script setup>
// Bloque superior de la página del evento: badge, título, organizador, fecha y lugar (§4.5, §4.7).
// El póster va aparte (EventPoster) para poder ubicarlo en otra columna del grid.
import { computed } from "vue";
import {
  formatLongDate,
  formatTimeRange,
  miniCalendar,
  upcomingFunctions,
  placesOf,
  multiplePlacesLabel,
  initialsOf,
} from "./eventView.js";

const props = defineProps({
  event: { type: Object, required: true },
  // [{ label, tone: 'lime'|'warning'|'neutral', pulse? }]
  badges: { type: Array, default: () => [] },
});
const emit = defineEmits(["show-functions", "show-location"]);

const normalize = (v) => String(v || "").trim().toLowerCase();
const kicker = computed(() => (normalize(props.event.title) && normalize(props.event.title) !== normalize(props.event.name) ? props.event.title : ""));

const functions = computed(() => {
  const upcoming = upcomingFunctions(props.event);
  return upcoming.length ? upcoming : props.event.dates || [];
});
const first = computed(() => functions.value[0] || null);
const cal = computed(() => (first.value ? miniCalendar(first.value.date) : null));
const longDate = computed(() => (first.value ? formatLongDate(first.value.date) : ""));
const timeRange = computed(() => (first.value ? formatTimeRange(first.value) : ""));
const moreFunctions = computed(() => Math.max(0, functions.value.length - 1));

const places = computed(() => placesOf(functions.value));
const placesLabel = computed(() => multiplePlacesLabel(places.value));
const venue = computed(() => first.value?.venue || props.event.venue || null);
const placeName = computed(() => {
  if (props.event.has_secret_location && !venue.value?.name) return "Ubicación por confirmar";
  return venue.value?.name || props.event.location || "";
});
const placeAddress = computed(() => {
  if (!venue.value) return "";
  const parts = [venue.value.address, venue.value.city].filter(Boolean);
  const text = parts.join(", ");
  return text && text !== placeName.value ? text : "";
});

const organizer = computed(() => props.event.organization?.name || "");
const organizerUrl = computed(() => props.event.organization?.website || "");
</script>

<template>
  <div class="hero">
    <div v-if="badges.length" class="badges hero-in" style="--i: 0">
      <span v-for="b in badges" :key="b.label" class="badge" :class="`badge-${b.tone}`">
        <span v-if="b.pulse" class="dot" aria-hidden="true"><span class="dot-pulse"></span></span>
        {{ b.label }}
      </span>
    </div>

    <p v-if="kicker" class="kicker hero-in" style="--i: 1">{{ kicker }}</p>
    <h1 class="title hero-in" style="--i: 1">{{ event.name }}</h1>

    <div v-if="organizer" class="organizer hero-in" style="--i: 2">
      <span class="avatar" aria-hidden="true">{{ initialsOf(organizer) }}</span>
      <span>Organiza
        <a v-if="organizerUrl" :href="organizerUrl" target="_blank" rel="noopener" class="organizer-name ev-link">{{ organizer }}</a>
        <strong v-else class="organizer-name">{{ organizer }}</strong>
      </span>
    </div>

    <div class="meta">
      <div v-if="first" class="meta-row hero-in" style="--i: 3">
        <div v-if="cal" class="cal" aria-hidden="true">
          <span class="cal-month">{{ cal.month }}</span>
          <span class="cal-day">{{ cal.day }}</span>
        </div>
        <div class="meta-text">
          <p class="meta-main">{{ longDate }}</p>
          <p v-if="timeRange" class="meta-sub">{{ timeRange }}</p>
          <button v-if="moreFunctions > 0" type="button" class="ev-link more" @click="emit('show-functions')">
            y {{ moreFunctions }} {{ moreFunctions === 1 ? "función más" : "funciones más" }} →
          </button>
        </div>
      </div>
      <p v-else class="meta-row hero-in meta-sub" style="--i: 3">Fecha por confirmar</p>

      <button v-if="placeName || placesLabel" type="button" class="meta-row place hero-in" style="--i: 4" @click="emit('show-location')">
        <span class="pin" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
        </span>
        <span class="meta-text">
          <span class="meta-main">{{ placesLabel || placeName }}</span>
          <span v-if="!placesLabel && placeAddress" class="meta-sub">{{ placeAddress }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.hero {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-family: "Prompt", system-ui, sans-serif;
  color: var(--text-1);
}
.hero-in {
  animation: ev-fade-up var(--dur-3) var(--ease-out) both;
  animation-delay: calc(80ms + var(--i, 0) * 40ms);
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  padding: 4px 10px;
  border-radius: var(--r-pill);
}
.badge-lime {
  background: var(--brand-lime);
  color: var(--text-1);
}
.badge-neutral {
  background: var(--surface-0);
  color: var(--text-1);
  box-shadow: inset 0 0 0 1px var(--border);
}
.badge-warning {
  padding-left: 0;
  color: var(--warning-text);
  font-weight: 500;
}
.dot {
  position: relative;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warning);
}
/* A23: pulso suave, máximo 3 veces */
.dot-pulse {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--warning);
  animation: ev-pulse 1.2s ease-out 3;
}
.kicker {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-2);
  margin-bottom: -8px;
}
.title {
  font-family: "Unbounded", system-ui, sans-serif;
  font-weight: 700;
  font-size: 30px;
  line-height: 34px;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
  text-wrap: balance;
}
.organizer {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-2);
}
.organizer-name {
  color: var(--text-1);
  font-weight: 500;
}
.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--text-1);
  font-size: 10px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
}
.meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
}
.place {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  border-radius: var(--r-sm);
}
.place:hover .meta-main {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.place:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 4px;
}
.cal {
  width: 48px;
  height: 48px;
  border-radius: var(--r-md);
  background: var(--surface-0);
  box-shadow: inset 0 0 0 1px var(--border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 auto;
}
.cal-month {
  width: 100%;
  text-align: center;
  font-size: 11px;
  line-height: 18px;
  font-weight: 600;
  letter-spacing: 0.06em;
  background: var(--surface-1);
  color: var(--text-2);
}
.cal-day {
  font-size: 18px;
  line-height: 28px;
  font-weight: 600;
}
.pin {
  width: 48px;
  height: 48px;
  border-radius: var(--r-md);
  background: var(--surface-0);
  box-shadow: inset 0 0 0 1px var(--border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.meta-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.meta-main {
  font-size: 18px;
  line-height: 22px;
  font-weight: 600;
}
.meta-sub {
  font-size: 14px;
  line-height: 20px;
  color: var(--text-2);
}
.more {
  align-self: flex-start;
  font-size: 14px;
  margin-top: 2px;
  padding: 2px 0;
}
@media (min-width: 1024px) {
  .title {
    font-size: 40px;
    line-height: 46px;
  }
  .meta-main {
    font-size: 20px;
    line-height: 24px;
  }
}
</style>
