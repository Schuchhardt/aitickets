<script setup>
// Próximos eventos publicados (siempre al día): tarjetas, afiches o lista de fechas. Ancla fija #eventos.
import { computed, inject } from "vue";
import SnHead from "./SnHead.vue";
import { formatEventDateRange } from "../../../utils/dateHelpers.js";
import { cdnImage, cdnSrcset } from "../../../lib/imageCdn.js";

const props = defineProps({ section: { type: Object, required: true } });
const sn = inject("sn");

const layout = computed(() => props.section.data.layout || sn.info.value.events);
const events = computed(() => sn.events.value);
const eventHref = (event) => `${sn.base}/eventos/${event.slug}`;
const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
function dayParts(event) {
  const date = event.dates?.[0]?.date || (event.start_date ? String(event.start_date).slice(0, 10) : "");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? { day: String(Number(m[3])), month: MONTHS[Number(m[2]) - 1] } : { day: "", month: "" };
}
const SIZES = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";
</script>

<template>
  <section id="eventos" class="sn-section" data-section="events" :data-section-id="section.id" data-section-label="Próximos eventos">
    <div class="sn-wrap">
      <SnHead :section="section" :fallback-title="sn.info.value.copy.eventsTitle" lead lead-placeholder="Un texto sobre tu cartelera (opcional)" />
      <div data-testid="site-event-grid">
        <p v-if="!events.length" class="sn-empty">{{ sn.info.value.copy.emptyEvents }}</p>

        <div v-else-if="layout === 'list'" class="sn-events-list">
          <a v-for="event in events" :key="event.id" :href="eventHref(event)" class="sn-erow">
            <span class="sn-erow-date" aria-hidden="true">
              <span class="sn-erow-day">{{ dayParts(event).day }}</span>
              <span class="sn-erow-month">{{ dayParts(event).month }}</span>
            </span>
            <span class="min-w-0">
              <span class="sn-erow-name block">{{ event.name }}</span>
              <span class="sn-muted block text-sm mt-1">
                {{ formatEventDateRange(event) }}<template v-if="event.location"> · {{ event.location }}</template>
              </span>
            </span>
            <span class="sn-btn sn-btn--sm sn-erow-cta">{{ sn.info.value.buyLabel }}</span>
          </a>
        </div>

        <div v-else-if="layout === 'posters'" class="sn-events-posters">
          <a v-for="(event, i) in events" :key="event.id" :href="eventHref(event)" class="sn-poster">
            <div class="relative">
              <img v-if="event.image_url" :src="cdnImage(event.image_url, 750)" :srcset="cdnSrcset(event.image_url)" :sizes="SIZES" :alt="event.name" class="sn-poster-img" :loading="i < 3 ? 'eager' : 'lazy'" decoding="async" />
              <div v-else class="sn-poster-img"></div>
              <span class="sn-poster-date">{{ dayParts(event).day }} {{ dayParts(event).month }}</span>
            </div>
            <div class="sn-poster-body">
              <h3 class="sn-ecard-name">{{ event.name }}</h3>
              <p class="sn-ecard-date mt-1">{{ formatEventDateRange(event) }}</p>
              <p v-if="event.location" class="sn-ecard-place mt-1">{{ event.location }}</p>
            </div>
          </a>
        </div>

        <div v-else class="sn-events-cards">
          <a v-for="(event, i) in events" :key="event.id" :href="eventHref(event)" class="sn-ecard">
            <img v-if="event.image_url" :src="cdnImage(event.image_url, 750)" :srcset="cdnSrcset(event.image_url)" :sizes="SIZES" :alt="event.name" class="sn-ecard-img" :loading="i < 3 ? 'eager' : 'lazy'" decoding="async" />
            <div v-else class="sn-ecard-img"></div>
            <div class="sn-ecard-body">
              <span class="sn-ecard-date">{{ formatEventDateRange(event) }}</span>
              <h3 class="sn-ecard-name">{{ event.name }}</h3>
              <p v-if="event.location" class="sn-ecard-place">{{ event.location }}</p>
              <div class="sn-ecard-cta"><span class="sn-btn sn-btn--sm">{{ sn.info.value.buyLabel }}</span></div>
            </div>
          </a>
        </div>
      </div>
    </div>
  </section>
</template>
