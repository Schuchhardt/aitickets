<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import iconShare from "../images/icon-share.png"; // Icono de compartir
import iconArrow from "../images/icon-arrow-black.png"; // Icono de flecha en botón de reserva
import iconTicket from "../images/icon-tickets.png"; // Icono de ticket
import ShareEventModal from "./ShareEventModal.vue";
import ReserveModal from "./Reservation/ReservationModal.vue";
import { eventBus } from '../utils/eventBus.js';

defineProps({
  event: Object,
});

const showModal = ref(false);
const showReserveModal = ref(false);

const openReserveModal = () => {
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
</script>

<template>
  <div class="font-['Unbounded'] font-bold" v-if="event">
    <!-- Botón de compartir en Mobile (debajo del EventHeader) -->
    <div class="lg:hidden flex justify-center mt-4">
      <button @click="showModal = true" class="w-11/12 flex items-center justify-center py-2 border border-gray-300 rounded-full text-gray-600 bg-gray-100 cursor-pointer">
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
        <span class="text-xl">{{ event.price || "Gratis" }}</span>
      </div>

      <!-- Botones -->
      <button @click="openReserveModal"  class="w-full bg-black text-white py-3 rounded-full flex items-center justify-center mt-4 cursor-pointer">
        Reservar ticket
        <img :src="iconArrow.src" alt="Arrow" class="w-4 h-4 ml-2" />
      </button>

      <button @click="showModal = true" class="w-full mt-3 border border-gray-400 py-2 rounded-full text-gray-700 flex items-center justify-center cursor-pointer">
        <img :src="iconShare.src" alt="Compartir" class="w-5 h-5 mr-2" />
        Compartir evento
      </button>
    </div>

    <!-- Precio Sticky en Mobile -->
    <div class="lg:hidden fixed bottom-0 left-0 w-full bg-lime-400 py-4 px-6 flex justify-between items-center shadow-md">
      <span class="text-lg text-gray-900">{{ event.price || "Gratis" }}</span>
      <button @click="openReserveModal"  class="bg-black text-white py-2 px-6 rounded-full flex items-center cursor-pointer">
        Reservar ticket
      </button>
    </div>
 
    <ShareEventModal :show="showModal" :event="event" @close="showModal = false"/>
    <ReserveModal v-if="showReserveModal" :event="event" @close="closeReserveModal" />

  </div>
</template>
