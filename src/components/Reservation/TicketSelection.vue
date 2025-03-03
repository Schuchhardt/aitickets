<script setup>
import { defineProps, defineEmits, ref } from "vue";

const props = defineProps({
  event: Object,
  selectedTickets: Object, // Se recibe desde el padre
});

const emit = defineEmits(["update:selectedTickets"]);
const selectedTickets = ref({});

const updateSelection = (ticketId, quantity) => {
  selectedTickets.value[ticketId] = quantity;
  emit("update:selectedTickets", selectedTickets.value);
};

const isSuperFan = (ticket) => {
  return ticket.price > 0 && ticket.price === Math.max(...props.event.tickets.map(t => t.price));
};

const increaseTicket = (ticket) => {
  updateSelection(ticket.id, Math.min((selectedTickets.value[ticket.id] || 0) + 1, ticket.max_quantity));
};

const decreaseTicket = (ticket) => {
  updateSelection(ticket.id, Math.max((selectedTickets.value[ticket.id] || 0) - 1, 0));
};

const formatDate = (datetime) => {
  return datetime ? new Date(datetime).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "long" }) : "";
};

const formatTime = (datetime) => {
  return datetime ? new Date(datetime).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
};

const formatPrice = (price) => {
  return price !== null && price !== undefined ? price.toLocaleString("es-ES") : "";
};
</script>

<template>
  <div v-if="event.tickets && event.tickets.length" class="w-full font-[Prompt]">
    <h3 class="text-lg font-semibold text-center mb-4 font-[Prompt]">Selecciona tus tickets</h3>
    <div class="w-full">
      <div class="text-center pb-4">
        <p class="text-gray-500 text-sm">Fecha</p>
        <p class="text-lg font-semibold">
          <template v-if="event.start_date || event.end_date">
            {{ formatDate(event.start_date) }}<span v-if="event.start_date && event.end_date"> - </span>{{ formatDate(event.end_date) }}
          </template>
        </p>
        <p class="text-gray-500 text-sm">
          <template v-if="event.start_date || event.end_date">
            {{ formatTime(event.start_date) }}<span v-if="event.start_date && event.end_date"> - </span>{{ formatTime(event.end_date) }}
          </template>
        </p>
      </div>

      <div class="grid grid-cols-1 gap-4 w-full">
        <div
          v-for="ticket in event.tickets"
          :key="ticket.id"
          class="border p-4 rounded-lg flex justify-between items-center w-full"
        >
          <div>
            <div v-if="isSuperFan(ticket)" class="bg-green-200 text-green-800 text-xs font-bold px-2 py-1 rounded-full inline-block mb-2">
              Super Fan
            </div>
            <div v-if="!isSuperFan(ticket)" class="bg-gray-200 text-xs font-bold px-2 py-1 rounded-full inline-block mb-2">
              Fan
            </div>
            <p class="font-medium">{{ ticket.ticket_name }}</p>
            <p v-if="ticket.price !== null && ticket.price !== undefined" class="text-gray-500">
              {{ ticket.price > 0 ? `$${formatPrice(ticket.price)}` : "Gratis" }}
            </p>
          </div>

        <!-- Botón Añadir / Controles de cantidad alineados al centro -->
        <div class="flex justify-center items-center">
          <button 
            v-if="!selectedTickets[ticket.id]" 
            @click="increaseTicket(ticket)" 
            class="border px-4 py-1 rounded-lg text-black hover:bg-gray-100"
          >
            Añadir
          </button>
          <div v-else class="flex items-center justify-center space-x-2 border rounded-lg px-2 py-1">
            <button @click="decreaseTicket(ticket)" class="px-2 py-1">-</button>
            <span class="w-6 text-center">{{ selectedTickets[ticket.id] || 0 }}</span>
            <button @click="increaseTicket(ticket)" class="px-2 py-1">+</button>
          </div>
        </div>

        </div>
      </div>
    </div>
  </div>
</template>
