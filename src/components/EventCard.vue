<script setup>
import iconCalendar from "../images/icon-calendar-dark.png";
import iconLocation from "../images/icon-pin-dark.png";

defineProps({
  event: Object,
});

const formatFullDate = (dateArray) => {
  if (!dateArray.length) return "No hay fechas disponibles";

  const optionsDate = { day: "numeric", month: "long" };
  const optionsTime = { hour: "2-digit", minute: "2-digit", hour12: false };

  const start = dateArray[0];
  const end = dateArray[dateArray.length - 1];

  const startDate = new Date(start.date).toLocaleDateString("es-ES", optionsDate);
  const endDate = new Date(end.date).toLocaleDateString("es-ES", optionsDate);

  const startTime = new Date(`1970-01-01T${start.start_time}`).toLocaleTimeString("es-ES", optionsTime);
  const endTime = new Date(`1970-01-01T${end.end_time}`).toLocaleTimeString("es-ES", optionsTime);

  return `Del ${startDate} al ${endDate}, desde las ${startTime} a las ${endTime} hrs`;
};
</script>

<template>
  <div class="bg-white rounded-xl shadow-md overflow-hidden transition-transform duration-200 hover:scale-[1.02]">
    
    <!-- Imagen del evento -->
    <img :src="event.image_url" :alt="event.title" class="w-full h-48 object-cover" />

    <!-- Contenido -->
    <div class="p-4 flex flex-col space-y-3">
      <h3 class="text-lg font-bold text-gray-900 font-['Unbounded']">{{ event.name }}</h3>

      <!-- Fecha -->
      <div class="flex items-center space-x-2 text-gray-600 text-sm" v-if="event.dates">
        <img :src="iconCalendar.src" alt="Calendario" class="w-4 h-4" />
        <p>{{ formatFullDate(event.dates) }}</p>
      </div>

      <!-- Ubicación -->
      <div class="flex items-center space-x-2 text-gray-600 text-sm">
        <img :src="iconLocation.src" alt="Ubicación" class="w-4 h-4" />
        <p>{{ event.location }}</p>
      </div>

      <!-- Botón de detalles -->
      <div class="flex justify-center mt-4">
        <a :href="`/eventos/${event.slug}`"
          class="px-5 py-2 text-lg font-bold text-black bg-lime-400 rounded-full transition hover:bg-lime-500 font-['Unbounded']">
          Ver detalles
        </a>
      </div>
    </div>

  </div>
</template>
