<script setup>
import TicketQR from "./TicketQR.vue";
import { computed } from "vue";

const props = defineProps({
  ticket: Object,
  event: Object,
});

// ✅ Formatear fecha del evento
const formattedDate = computed(() => {
  if (!props.ticket.event_date) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Santiago",
  }).format(new Date(props.event.start_date));
});

// ✅ Formatear hora del evento
const formattedTime = computed(() => {
  if (!props.ticket.event_date) return "Hora no disponible";
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Santiago",
  }).format(new Date(props.event.start_date)) + " hrs";
});
</script>

<template>
  <div class="bg-white p-6 rounded-lg shadow-lg w-full max-w-md text-center mx-auto lg:col-span-1">
    <div v-if="ticket.qr_code" class="mt-6 flex flex-col items-center">
      <TicketQR :code="ticket.qr_code" client:idle />
      <p class="text-gray-500 text-sm mt-2">Muestra este código al ingresar</p>
    </div>
    <p class="text-2xl font-bold font-[Prompt]">Evento</p>
    <h2 class="text-3xl font-bold mb-4 font-[Unbounded]">{{ event.name }}</h2>

    <p class="text-gray-600 font-bold font-[Prompt]">{{ ticket.ticket_name }}</p>
    <p class="text-gray-500 font-[Prompt]">{{ formattedDate }} </p>
    <p class="text-gray-500 font-[Prompt]">{{ formattedTime }}</p>

    <div class="mt-4 text-center font-[Prompt]">
      <p><strong>Nombre:</strong> {{ ticket.attendee_name }}</p>
      <p><strong>Email:</strong> {{ ticket.attendee_email }}</p>
    </div>


    <a href="/" class="mt-6 inline-block bg-black text-white px-6 py-2 rounded-md font-[Prompt]">
      Volver al inicio
    </a>
  </div>
</template>
