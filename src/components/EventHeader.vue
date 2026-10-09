<script setup>
import iconCalendarLight from "../images/icon-calendar-light.png";
import iconPinLight from "../images/icon-pin-light.png";
import iconCalendarDark from "../images/icon-calendar-dark.png";
import iconPinDark from "../images/icon-pin-dark.png";
import { formatEventDateRange } from "../utils/dateHelpers.js";
import { normalizeCoverSettings } from "../lib/eventCover";

import { computed } from "vue";

const props = defineProps({
  event: Object,
  // Página del evento: portada a todo el ancho, arriba de todo (sin navbar). Fuera de ella (orden, entrada)
  // se muestra como tarjeta.
  hero: { type: Boolean, default: false },
  // Link de vuelta sobre la portada (solo hero). null = sin link.
  backHref: { type: String, default: null },
  backLabel: { type: String, default: "Eventos" },
});

// title y name suelen ser iguales (el dashboard guarda ambos): mostrar title solo si aporta algo
const normalize = (v) => String(v || "").trim().toLowerCase();
const showTitle = computed(() => !!normalize(props.event?.title) && normalize(props.event?.title) !== normalize(props.event?.name));

// Ajuste de portada por dispositivo (events.cover_settings, editable en el panel)
const cover = computed(() => normalizeCoverSettings(props.event?.cover_settings));
const coverStyle = computed(() => ({
  "--cover-h-m": `${cover.value.mobile.height}px`,
  "--cover-h-d": `${cover.value.desktop.height}px`,
  "--cover-pos-m": `center ${cover.value.mobile.position_y}%`,
  "--cover-pos-d": `center ${cover.value.desktop.position_y}%`,
}));
const fitClass = computed(() => [
  cover.value.mobile.fit === "contain" ? "fit-m-contain" : "fit-m-cover",
  cover.value.desktop.fit === "contain" ? "fit-d-contain" : "fit-d-cover",
]);
const anyContain = computed(() => cover.value.mobile.fit === "contain" || cover.value.desktop.fit === "contain");
</script>

<template>
  <div v-if="event">
    <!-- Portada: con degradado y texto encima en desktop; en mobile el texto va debajo -->
    <div
      class="event-cover relative w-full overflow-hidden bg-gray-900"
      :class="[hero ? 'is-hero' : 'rounded-xl', fitClass]"
      :style="coverStyle"
      data-testid="event-cover"
    >
      <!-- Fondo difuminado para el modo "imagen completa" -->
      <img
        v-if="anyContain && event.image_url"
        :src="event.image_url"
        alt=""
        aria-hidden="true"
        class="cover-backdrop absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-60"
      />
      <img
        v-if="event.image_url"
        :src="event.image_url"
        :alt="event.name"
        class="cover-img relative w-full h-full"
        fetchpriority="high"
        loading="eager"
        decoding="async"
        width="1600"
        height="600"
      />
      <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent hidden lg:block"></div>
      <div v-if="hero" class="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent"></div>

      <!-- Vuelta al listado (la página del evento no tiene navbar) -->
      <a
        v-if="hero && backHref"
        :href="backHref"
        class="absolute top-4 left-4 lg:top-6 lg:left-6 inline-flex items-center gap-1.5 rounded-full bg-black/45 backdrop-blur px-3.5 py-1.5 text-sm font-medium text-white hover:bg-black/65 transition font-['Prompt']"
      >
        <span aria-hidden="true">←</span> {{ backLabel }}
      </a>

      <!-- Texto sobre la imagen en desktop -->
      <div class="absolute inset-x-0 bottom-0 hidden lg:block">
        <div class="text-white font-['Prompt']" :class="hero ? 'max-w-6xl mx-auto px-12 pb-10' : 'px-6 pb-6'">
          <span v-if="showTitle" class="uppercase text-xs font-medium tracking-wide opacity-80">{{ event.title }}</span>
          <h1 class="font-bold font-['Unbounded']" :class="hero ? 'text-4xl' : 'text-3xl'">{{ event.name }}</h1>
          <div class="flex flex-wrap items-center text-sm mt-2 opacity-90 gap-x-4 gap-y-1">
            <!-- Fecha -->
            <div class="flex items-start flex-wrap">
              <img :src="iconCalendarLight.src" alt="" class="w-5 h-5 mr-1.5 flex-shrink-0" />
              <span class="leading-tight">{{ formatEventDateRange(event) }}</span>
            </div>
            <!-- Ubicación -->
            <div class="flex items-center">
              <img :src="iconPinLight.src" alt="" class="w-5 h-5 mr-1.5 flex-shrink-0" />
              <span>{{ event.location }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Texto debajo de la imagen en mobile -->
    <div class="lg:hidden text-center mt-4 font-['Prompt']" :class="hero ? 'px-6' : ''">
      <span v-if="showTitle" class="uppercase text-xs font-medium tracking-wide text-gray-600">{{ event.title }}</span>
      <!-- Un solo h1 por página (el de desktop); en mobile se repite el nombre como texto -->
      <p class="text-2xl font-bold text-gray-900 font-['Unbounded']">{{ event.name }}</p>

      <div class="flex flex-col items-center text-gray-600 text-sm mt-2 space-y-2">
        <!-- Fecha -->
        <div class="flex items-start text-center">
          <img :src="iconCalendarDark.src" alt="" class="w-5 h-5 mr-2 mt-1" />
          <span class="block">{{ formatEventDateRange(event) }}</span>
        </div>
        <!-- Ubicación -->
        <div class="flex items-start text-center">
          <img :src="iconPinDark.src" alt="" class="w-5 h-5 mr-2 mt-1" />
          <span class="block">{{ event.location }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Fuera de la página del evento (orden, entrada) se mantiene el alto fijo de siempre */
.event-cover { height: 20rem; }
.event-cover .cover-img { object-fit: cover; }
@media (min-width: 1024px) {
  .event-cover { height: 400px; }
}

.event-cover.is-hero { height: var(--cover-h-m); }
.event-cover.is-hero .cover-img { object-position: var(--cover-pos-m); }
.event-cover.is-hero.fit-m-contain .cover-img { object-fit: contain; }
.event-cover.is-hero.fit-m-cover .cover-backdrop { display: none; }
@media (min-width: 1024px) {
  .event-cover.is-hero { height: var(--cover-h-d); }
  .event-cover.is-hero .cover-img { object-position: var(--cover-pos-d); object-fit: cover; }
  .event-cover.is-hero.fit-d-contain .cover-img { object-fit: contain; }
  .event-cover.is-hero.fit-d-cover .cover-backdrop { display: none; }
  .event-cover.is-hero.fit-d-contain .cover-backdrop { display: block; }
}
</style>
