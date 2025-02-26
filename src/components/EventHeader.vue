<script setup>
// import { Image } from 'astro:assets';

// Importar imágenes desde `src/images/`
import iconCalendarLight from "../images/icon-calendar-light.png";
import iconPinLight from "../images/icon-pin-light.png";
import iconCalendarDark from "../images/icon-calendar-dark.png";
import iconPinDark from "../images/icon-pin-dark.png";

// Props con los datos del evento
defineProps({
  event: Object,
});

// Función para formatear la fecha con hora
const formatFullDate = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const startDateStr = start.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
  });
  const endDateStr = end.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
  });

  const startTime = start.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const endTime = end.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return `Del ${startDateStr} al ${endDateStr}, desde las ${startTime} a las ${endTime} hrs`;
};
</script>

<template>
  <div v-if="event">
    <!-- 🖼️ Imagen con degradado en desktop y sin degradado en mobile -->
    <div class="relative w-full rounded-xl overflow-hidden" >
      <img :src="event.image_url" :alt="event.name" class="w-full h-80 object-cover lg:h-[400px]" />
      <div class="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent hidden lg:block"></div>

      <!-- 📌 Texto sobre la imagen en desktop -->
      <div class="absolute bottom-6 left-6 text-white hidden lg:block font-['Prompt']">
        <span class="uppercase text-xs font-medium tracking-wide opacity-80">{{ event.title }}</span>
        <h2 class="text-3xl font-bold font-['Unbounded']">{{ event.name }}</h2>
        <div class="flex flex-wrap items-center text-sm mt-2 opacity-90 space-x-4">
          <!-- 📅 Fecha -->
          <div class="flex items-center">
            <img :src="iconCalendarLight.src" alt="calendar icon" class="w-5 h-5 mr-2" />
            <span>{{ formatFullDate(event.start_date, event.end_date) }}</span>
          </div>
          <!-- 📍 Ubicación -->
          <div class="flex items-center">
            <img :src="iconPinLight.src" alt="location icon" class="w-5 h-5 mr-2" />
            <span>{{ event.location }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 📌 Texto debajo de la imagen en mobile -->
    <div class="lg:hidden text-center mt-4 font-['Prompt']">
      <span class="uppercase text-xs font-medium tracking-wide text-gray-600">{{ event.title }}</span>
      <h2 class="text-2xl font-bold text-gray-900 font-['Unbounded']">{{ event.name }}</h2>
      <div class="flex flex-col items-center text-gray-600 text-sm mt-2 space-y-2">
        <!-- 📅 Fecha -->
        <div class="flex items-center">
          <img :src="iconCalendarDark.src" alt="calendar icon" class="w-5 h-5 mr-2" />
          <span>{{ formatFullDate(event.start_date, event.end_date) }}</span>
        </div>
        <!-- 📍 Ubicación -->
        <div class="flex items-center">
          <img :src="iconPinDark.src" alt="location icon" class="w-5 h-5 mr-2" />
          <span>{{ event.location }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
