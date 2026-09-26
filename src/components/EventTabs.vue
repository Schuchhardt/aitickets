<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { formatFunctionDate, formatFunctionTimeRange } from "../utils/dateHelpers.js";

// Props con la información del evento
const props = defineProps({
  event: Object,
});

// Leer API Key de Google Maps desde las variables de entorno
const googleMapsApiKey = import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY;

// Estado para el toggle "Ver más" en la descripción
const showFullDescription = ref(false);

// Estado de cada pregunta en "Preguntas Frecuentes"
const faqs = props.event?.faqs ? ref(props.event.faqs.map( (faq) => {
  return {...faq, open: false} }
)) : [] ;

// Alternar la apertura de una pregunta con animación
const toggleFAQ = (index) => {
  faqs.value[index].open = !faqs.value[index].open;
};

// Detectar el scroll y resaltar la sección activa
const activeSection = ref("descripcion");

// Función para manejar el scroll
const handleScroll = () => {
  const sections = document.querySelectorAll(".event-section");
  let currentSection = "descripcion";

  sections.forEach((section) => {
    const rect = section.getBoundingClientRect();
    if (rect.top <= 150 && rect.bottom >= 150) {
      currentSection = section.id;
    }
  });

  activeSection.value = currentSection;
};

// Escuchar el scroll cuando se monta el componente
onMounted(() => {
  window.addEventListener("scroll", handleScroll, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener("scroll", handleScroll);
});

// La descripción llega YA sanitizada desde el servidor (sanitizeRichText, contrato R3).
// No se corta el HTML (podría romper etiquetas): se colapsa visualmente con max-height.
const DESCRIPTION_LIMIT = 1200;
const description = computed(() => props.event?.description || "");
const isLongDescription = computed(() => description.value.replace(/<[^>]+>/g, "").length > DESCRIPTION_LIMIT);

// Dirección para el mapa: recinto (event_dates -> venues) o texto libre del evento
const mapQuery = computed(() => {
  const venue = props.event?.venue;
  if (venue) {
    return [venue.name, venue.address, venue.city].filter(Boolean).join(", ");
  }
  return props.event?.location || "";
});

// ¿Las funciones son en recintos distintos?
const hasMultipleVenues = computed(() => {
  const names = new Set((props.event?.dates || []).map((d) => d.venue?.name).filter(Boolean));
  return names.size > 1;
});
</script>

<template>
  <div class="lg:col-span-2 font-['Prompt']" v-if="event">
    <!-- Tabs de navegación (solo en desktop) -->
    <div id="event-tabs" class="hidden lg:flex border-b border-gray-300 space-x-4 bg-white py-2">
      <a href="#descripcion" class="py-2 px-4 text-sm font-semibold cursor-pointer font-['Unbounded']"
        :class="activeSection === 'descripcion' ? 'border-b-2 border-black text-black' : 'text-gray-500'">
        Descripción
      </a>
      <a href="#fecha" class="py-2 px-4 text-sm font-semibold cursor-pointer font-['Unbounded']"
        :class="activeSection === 'fecha' ? 'border-b-2 border-black text-black' : 'text-gray-500'">
        Fecha
      </a>
      <a href="#lugar" class="py-2 px-4 text-sm font-semibold cursor-pointer font-['Unbounded']"
        :class="activeSection === 'lugar' ? 'border-b-2 border-black text-black' : 'text-gray-500'">
        Ubicación
      </a>
      <a href="#preguntas" class="py-2 px-4 text-sm font-semibold cursor-pointer font-['Unbounded']"
        :class="activeSection === 'preguntas' ? 'border-b-2 border-black text-black' : 'text-gray-500'">
        Preguntas Frecuentes
      </a>
    </div>


    <!-- Sección de Descripción con soporte para "Ver más" -->
    <div id="descripcion" class="event-section scroll-mt-24 mt-6">
      <h2 class="text-2xl font-bold mb-4 font-['Unbounded']">Descripción</h2>
      <transition name="fade-slide">
        <div
          v-html="description"
          class="event-description text-gray-600"
          :class="isLongDescription && !showFullDescription ? 'max-h-96 overflow-hidden relative description-collapsed' : ''"
        ></div>
      </transition>
      <button v-if="isLongDescription" @click="showFullDescription = !showFullDescription" aria-label="Mostrar/ocultar descripción completa"
        class="text-blue-500 mt-2 cursor-pointer">
        {{ showFullDescription ? "Ver menos" : "Ver más" }}
      </button>
    </div>


    <!-- Sección de Fecha -->
    <div id="fecha" class="event-section scroll-mt-24 mt-10">
      <h2 class="text-2xl font-bold mb-4 font-['Unbounded']">Fecha y hora</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="bg-gray-100 p-4 rounded-lg text-center" v-for="(date, index) in event.dates" :key="date.id || index">
          <span class="text-gray-900 font-semibold block capitalize">
            {{ formatFunctionDate(date) }}
          </span>
          <span class="text-gray-600 text-sm">
            {{ formatFunctionTimeRange(date) }}
          </span>
          <span v-if="hasMultipleVenues && date.venue?.name" class="block text-gray-500 text-xs mt-1">
            {{ date.venue.name }}
          </span>
        </div>
      </div>
      <p v-if="!event.timezone || event.timezone === 'America/Santiago'" class="text-gray-400 text-xs mt-2">Horario de Chile continental.</p>
    </div>


    <!-- Sección de Ubicación con Mapa -->
    <div id="lugar" class="event-section scroll-mt-24 mt-10">
      <h2 class="text-2xl font-bold mb-4 font-['Unbounded']">
        {{ event.has_secret_location ? 'Ubicación aproximada' : 'Ubicación' }}
      </h2>
      <p class="text-gray-600">
        {{ event.location }}
        <a v-if="!event.has_secret_location && mapQuery" :href="'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapQuery)" target="_blank" rel="noopener noreferrer"
          class="text-blue-500 cursor-pointer">Ver ubicación</a>
      </p>
      <p v-if="event.has_secret_location" class="text-amber-600 text-sm mt-2 italic">
        La ubicación exacta será mostrada en la entrada el día del evento.
      </p>
      <iframe v-if="googleMapsApiKey && mapQuery" class="w-full h-64 mt-4 rounded-lg shadow-md"
        :src="'https://www.google.com/maps/embed/v1/place?key=' + googleMapsApiKey + '&q=' + encodeURIComponent(mapQuery)"
        :title="'Mapa de ' + mapQuery"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        allowfullscreen>
      </iframe>
    </div>

    <!-- Sección de Preguntas Frecuentes con animación -->
    <div id="preguntas" v-if="event.faqs && event.faqs.length > 0" class="event-section scroll-mt-24 mt-10">
      <h2 class="text-2xl font-bold mb-4 font-['Unbounded']">Preguntas Frecuentes</h2>
      <div v-for="(faq, index) in faqs" :key="index" class="border-b border-gray-300 py-3">
        <button @click="toggleFAQ(index)" class="flex justify-between items-center w-full text-left cursor-pointer" aria-label="Mostrar/ocultar respuesta">
          <span class="text-gray-900 font-medium">{{ index + 1 }}. {{ faq.question }}</span>
          <span class="text-gray-500">{{ faq.open ? "▲" : "▼" }}</span>
        </button>
        <transition name="fade-slide">
          <p v-if="faq.open" class="mt-2 text-gray-600">{{ faq.answer }}</p>
        </transition>
      </div>
      
      <!-- Imagen del evento al final de preguntas frecuentes -->
      <div class="mt-6 flex justify-center">
        <img :src="event.image_url" :alt="event.name" loading="lazy" decoding="async" class="rounded-lg shadow-md max-w-full h-auto object-cover" style="height: 100%;" />
      </div>
    </div>

    <!-- Categorías o temáticas del evento -->
    <div class="mt-10" v-if="event.tags && event.tags.length > 0">
      <h2 class="text-2xl font-bold mb-4 font-['Unbounded']">Categorías y temáticas del evento</h2>
      <div class="flex flex-wrap gap-2">
        <span v-for="(cat, idx) in event.tags" :key="idx"
          class="px-3 py-1 bg-gray-100 rounded-full text-gray-600 text-sm">
          {{ cat }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.description-collapsed {
  -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent);
  mask-image: linear-gradient(to bottom, black 70%, transparent);
}
.event-description :deep(p) { margin-bottom: 0.75rem; }
.event-description :deep(ul) { list-style: disc; padding-left: 1.25rem; margin-bottom: 0.75rem; }
.event-description :deep(ol) { list-style: decimal; padding-left: 1.25rem; margin-bottom: 0.75rem; }
.event-description :deep(h2), .event-description :deep(h3) { font-weight: 700; color: #111827; margin: 1rem 0 0.5rem; }
.event-description :deep(a) { color: #2563eb; text-decoration: underline; }
.event-description :deep(blockquote) { border-left: 3px solid #e5e7eb; padding-left: 0.75rem; font-style: italic; }
</style>
