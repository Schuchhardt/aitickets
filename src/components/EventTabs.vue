<script setup>
import { ref, onMounted } from "vue";

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
  window.addEventListener("scroll", handleScroll);
});

const getTime = (time) => {
  const optionsTime = { hour: "2-digit", minute: "2-digit", hour12: false };
  
  return new Date(`1970-01-01T${time}`).toLocaleTimeString("es-ES", optionsTime);
}
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
    <div id="descripcion" class="event-section mt-6">
      <h2 class="text-2xl font-bold mb-4 font-['Unbounded']">Descripción</h2>
      <transition name="fade-slide">
        <div v-html="showFullDescription ? event.description : event.description.slice(0, 200) + '...'" class="text-gray-600"></div>
      </transition>
      <button v-if="event.description.length > 200" @click="showFullDescription = !showFullDescription" aria-label="Mostrar/ocultar descripción completa"
        class="text-blue-500 mt-2 cursor-pointer">
        {{ showFullDescription ? "Ver menos" : "Ver más" }}
      </button>
    </div>


    <!-- Sección de Fecha -->
    <div id="fecha" class="event-section mt-10">
      <h2 class="text-2xl font-bold mb-4 font-['Unbounded']">Fecha y hora</h2>
      <div class="flex space-x-4">
        <div class="bg-gray-100 p-4 rounded-lg text-center w-1/2" v-for="(date, index) in event.dates" :key="index">
          <span class="text-gray-900 font-semibold block">
            {{ new Date(date.date).toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "long" }) }}
          </span>
          <span class="text-gray-600 text-sm">
            {{ getTime(date.start_time) }} hrs - {{ getTime(date.end_time) }} hrs
          </span>
        </div>
      </div>
    </div>


    <!-- Sección de Ubicación con Mapa -->
    <div id="lugar" class="event-section mt-10">
      <h2 class="text-2xl font-bold mb-4 font-['Unbounded']">Ubicación</h2>
      <p class="text-gray-600">
        {{ event.location }} 
        <a :href="'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(event.location)" target="_blank"
          class="text-blue-500 cursor-pointer">Ver ubicación</a>
      </p>
      <iframe class="w-full h-64 mt-4 rounded-lg shadow-md"
        :src="'https://www.google.com/maps/embed/v1/place?key=' + googleMapsApiKey + '&q=' + encodeURIComponent(event.location)"
        allowfullscreen>
      </iframe>
    </div>

    <!-- Sección de Preguntas Frecuentes con animación -->
    <div id="preguntas" v-if="event.faqs && event.faqs.length > 0" class="event-section mt-10">
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
