<template>
  <div class="mt-6 bg-gray-50 rounded-lg shadow-lg p-6">
    <h3 class="text-lg font-bold font-[Unbounded] text-gray-800 mb-4">Detalles del Evento</h3>
    <div class="space-y-3 text-gray-700 font-[Prompt]">
      <p><span class="font-semibold">Evento:</span> {{ event?.name }}</p>
      <p><span class="font-semibold">Fecha:</span> {{ formattedDate(event) }}</p>
      <p><span class="font-semibold">Hora:</span> {{ formattedTime(event) }}</p>
      <div>
        <span class="font-semibold">Dirección exacta:</span>
        <div v-if="event?.secret_location" class="mt-1">
          <p class="text-gray-600">{{ event.secret_location }}</p>
        </div>
        <span v-else class="text-gray-600">{{ event?.address || 'Dirección no disponible' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { formatLocalDate, formatLocalTime } from "../utils/dateHelpers.js";

const props = defineProps({
  event: Object
});

// Formatear fecha del evento usando zona horaria local del usuario (ejecutado en el cliente)
const formattedDate = (event) => {
  if (!event?.start_date) return "Fecha no disponible";
  return formatLocalDate(event.start_date, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
};

// Formatear hora del evento usando zona horaria local del usuario (ejecutado en el cliente)
const formattedTime = (event) => {
  if (!event?.start_date) return "Hora no disponible";
  return formatLocalTime(event.start_date) + " hrs";
};
</script>