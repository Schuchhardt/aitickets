<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import iconShare from "../images/icon-share.png"; // Icono de compartir
import iconArrow from "../images/icon-arrow-black.png"; // Icono de flecha en botón de reserva
import iconTicket from "../images/icon-tickets.png"; // Icono de ticket
import ShareEventModal from "./ShareEventModal.vue";
import ReservationModal from "./Reservation/ReservationModal.vue";
import { eventBus } from '../utils/eventbus.js';

defineProps({
  event: Object,
});

const showModal = ref(false);
const showReserveModal = ref(false);

const openReserveModal = () => {
  console.log('Opening reserve modal');
  showReserveModal.value = true;
};

const closeReserveModal = () => {
  showReserveModal.value = false;
};

onMounted(() => {
  eventBus.on('open-modal', handleOpenModal);
});

onUnmounted(() => {
  eventBus.off('open-modal', handleOpenModal);
});

function handleOpenModal() {
  showReserveModal.value = true;
}
// format price with thousands separator (dot)
const formatPrice = (price) => {
  return price !== null && price !== undefined ? price.toLocaleString("es-CL") : "";
};
// get lowest ticket price and maximum price
// and return the price of the event
// if all tickets have the same price, return the price
// if all tickets has price equals to zero, return "Gratis"
// if tickets have different prices, return the range in string format
const getEventPrice = (tickets) => {
  if (!tickets || tickets.length === 0) return "Gratis";
  const prices = tickets.map((ticket) => ticket.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  if (minPrice === maxPrice) {
    return minPrice === 0 ? "Gratis" : `$${formatPrice(minPrice)}`;
  }
  return `Desde $${formatPrice(minPrice)} hasta $${formatPrice(maxPrice)}`;
};
</script>

<template>
  <div class="font-['Unbounded'] font-bold" v-if="event">
    <!-- Botón de compartir en Mobile (debajo del EventHeader) -->
    <div class="lg:hidden flex justify-center mt-4">
      <button @click="showModal = true" aria-label="Compartir evento" class="w-11/12 flex items-center justify-center py-2 border border-gray-300 rounded-full text-gray-600 bg-gray-100 cursor-pointer relative z-10 pointer-events-auto">
        <img :src="iconShare.src" alt="Compartir" class="w-5 h-5 mr-2" />
        Compartir evento
      </button>
    </div>

    <!-- Tarjeta de Acciones en Desktop -->
    <div class="hidden lg:block bg-gray-100 p-6 rounded-xl shadow-md text-center">
      <!-- Precio -->
      <div class="flex items-center justify-between text-lg text-gray-900">
        <span class="flex items-center">
          <img :src="iconTicket.src" alt="ticket icon" class="w-5 h-5 mr-2" />
          Precio
        </span>
        <span class="text-xl">{{ getEventPrice(event.tickets) }}</span>
      </div>

      <!-- Botones -->
      <button @click="openReserveModal" aria-label="Comprar entrada" class="w-full bg-black text-white py-3 rounded-full flex items-center justify-center mt-4 cursor-pointer relative z-10 pointer-events-auto">
        Comprar entrada
        <img :src="iconArrow.src" alt="Arrow" class="w-4 h-4 ml-2" />
      </button>

      <button @click="showModal = true" aria-label="Compartir evento" class="w-full mt-3 border border-gray-400 py-2 rounded-full text-gray-700 flex items-center justify-center cursor-pointer relative z-10 pointer-events-auto">
        <img :src="iconShare.src" alt="Compartir" class="w-5 h-5 mr-2" />
        Compartir evento
      </button>
    </div>

    <!-- Precio Sticky en Mobile -->
    <div class="lg:hidden fixed bottom-0 left-0 w-full bg-lime-400 py-4 px-6 flex justify-between items-center shadow-md">
            <span class="text-lg text-gray-900">{{ getEventPrice(event.tickets) }}</span>
      <button @click="openReserveModal" aria-label="Comprar entrada" class="bg-black text-white py-2 px-6 rounded-full flex items-center cursor-pointer relative z-10 pointer-events-auto">
        Comprar entrada
      </button>
    </div>
 
    <ShareEventModal :show="showModal" :event="event" @close="showModal = false"/>
    <ReservationModal v-if="showReserveModal" :event="event" @close="closeReserveModal" />

  </div>
</template>
