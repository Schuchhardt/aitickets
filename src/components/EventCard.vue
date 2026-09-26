<script setup>
import iconCalendar from "../images/icon-calendar-dark.png";
import iconLocation from "../images/icon-pin-dark.png";
import { formatEventDateRange } from "../utils/dateHelpers.js";

defineProps({
  event: Object,
  // Las primeras tarjetas (sobre el pliegue) cargan la imagen con prioridad
  priority: Boolean,
});
</script>

<template>
  <div class="bg-white rounded-xl shadow-md overflow-hidden transition-transform duration-200 hover:scale-[1.02]">

    <!-- Imagen del evento -->
    <a :href="`/eventos/${event.slug}`" tabindex="-1" aria-hidden="true">
      <img
        :src="event.image_url"
        :alt="event.name"
        class="w-full h-48 object-cover"
        width="400"
        height="192"
        :loading="priority ? 'eager' : 'lazy'"
        :fetchpriority="priority ? 'high' : 'auto'"
        decoding="async"
      />
    </a>

    <!-- Contenido -->
    <div class="p-4 flex flex-col space-y-3">
      <h2 class="text-lg font-bold text-gray-900 font-['Unbounded']">
        <a :href="`/eventos/${event.slug}`" class="hover:underline">{{ event.name }}</a>
      </h2>

      <!-- Fecha (zona horaria del evento, America/Santiago) -->
      <div class="flex items-center space-x-2 text-gray-600 text-sm" v-if="event.start_date || event.dates?.length">
        <img :src="iconCalendar.src" alt="" class="w-4 h-4" />
        <p>{{ formatEventDateRange(event) }}</p>
      </div>

      <!-- Ubicación -->
      <div class="flex items-center space-x-2 text-gray-600 text-sm" v-if="event.location">
        <img :src="iconLocation.src" alt="" class="w-4 h-4" />
        <p>{{ event.location }}</p>
      </div>

      <!-- Botón de detalles -->
      <div class="flex justify-center mt-4">
        <a :href="`/eventos/${event.slug}`"
          class="px-5 py-2 text-lg font-bold text-black bg-lime-400 rounded-full transition hover:bg-lime-500 font-['Unbounded']">
          Ir al evento
        </a>
      </div>
    </div>

  </div>
</template>
