<script setup>
import TicketQR from "./TicketQR.vue";

const props = defineProps({
  ticket: Object,
  event: Object,
});

// Formatear fecha del evento
const formattedDate = (event) => {
  if (!event.start_date) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Santiago",
  }).format(new Date(event.start_date));
};

// Formatear hora del evento
const formattedTime = (event) => {
  if (!event.start_date) return "Hora no disponible";
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Santiago",
  }).format(new Date(event.start_date)) + " hrs";
};
</script>

<template>
  <div class="bg-white p-6 rounded-lg shadow-lg w-full max-w-md text-center mx-auto lg:col-span-1">
    <div v-if="ticket.qr_code" class="mt-2 flex flex-col items-center">
      <TicketQR :code="ticket.qr_code" client:idle />
      <p class="text-gray-500 text-sm mt-2">Muestra este código al ingresar</p>
    </div>
    <h2 class="text-3xl font-bold mb-4 font-[Unbounded]">{{ event.name }}</h2>

    <p class="text-gray-600 font-bold font-[Prompt]">{{ ticket.ticket_name || ticket.name }}</p>
    <p class="text-gray-500 font-[Prompt]">{{ formattedDate(event) }} </p>
    <p class="text-gray-500 font-[Prompt]">{{ formattedTime(event) }}</p>

    <a :href="ticket.pdf_url" download="ticket.pdf" class="block bg-lime-500 text-white text-center py-2 rounded-lg mt-4 hover:bg-lime-600 transition">
      Descargar ticket
    </a>
  </div>
</template>
