<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue";
import iconShare from "../images/icon-share.png"; // Icono de compartir
import iconArrow from "../images/icon-arrow-black.png"; // Icono de flecha en botón de reserva
import iconTicket from "../images/icon-tickets.png"; // Icono de ticket
import ShareEventModal from "./ShareEventModal.vue";
import ReservationModal from "./Reservation/ReservationModal.vue";
import PurchasedTicketsModal from "./PurchasedTicketsModal.vue";
import { eventBus } from '../utils/eventbus.js';

const props = defineProps({
  event: Object,
});

const showModal = ref(false);
const showReserveModal = ref(false);
const showPurchasedTickets = ref(false);
const eventOrders = ref([]);
const hasPurchasedTickets = ref(false);

// Función para verificar entradas compradas (solo en el cliente)
const checkPurchasedTickets = () => {
  if (!props.event?.id) return;
  
  try {
    const stored = localStorage.getItem(`purchase_event_${props.event.id}`);
    if (stored) {
      const orders = JSON.parse(stored);
      eventOrders.value = Array.isArray(orders) ? orders : [orders];
      hasPurchasedTickets.value = eventOrders.value.length > 0;
    } else {
      hasPurchasedTickets.value = false;
    }
  } catch (error) {
    console.error('Error checking purchased tickets:', error);
    hasPurchasedTickets.value = false;
  }
};

const openReserveModal = () => {
  console.log('Opening reserve modal');
  showReserveModal.value = true;
};

const closeReserveModal = () => {
  showReserveModal.value = false;
};

const openPurchasedTickets = () => {
  showPurchasedTickets.value = true;
};

const closePurchasedTickets = () => {
  showPurchasedTickets.value = false;
};

onMounted(() => {
  // Verificar entradas compradas solo en el cliente
  checkPurchasedTickets();
  
  eventBus.on('open-modal', handleOpenModal);
  eventBus.on('purchase-completed', handlePurchaseCompleted);
});

onUnmounted(() => {
  eventBus.off('open-modal', handleOpenModal);
  eventBus.off('purchase-completed', handlePurchaseCompleted);
});

function handleOpenModal() {
  showReserveModal.value = true;
}

function handlePurchaseCompleted() {
  // Re-verificar las entradas compradas cuando se complete una compra
  checkPurchasedTickets();
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
      <button 
        v-if="!hasPurchasedTickets"
        @click="openReserveModal" 
        aria-label="Comprar entrada" 
        class="w-full bg-black text-white py-3 rounded-full flex items-center justify-center mt-4 cursor-pointer relative z-10 pointer-events-auto"
      >
        Comprar entrada
        <img :src="iconArrow.src" alt="Arrow" class="w-4 h-4 ml-2" />
      </button>

      <template v-else>
        <button 
          @click="openPurchasedTickets" 
          aria-label="Ver entradas compradas" 
          class="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-full flex items-center justify-center mt-4 cursor-pointer relative z-10 pointer-events-auto"
        >
          Ver entradas compradas
          <img :src="iconTicket.src" alt="Ticket" class="w-4 h-4 ml-2" />
        </button>

        <button 
          @click="openReserveModal" 
          aria-label="Comprar más entradas" 
          class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-full flex items-center justify-center mt-3 cursor-pointer relative z-10 pointer-events-auto"
        >
          Comprar más entradas
          <img :src="iconArrow.src" alt="Arrow" class="w-4 h-4 ml-2" />
        </button>
      </template>

      <button @click="showModal = true" aria-label="Compartir evento" class="w-full mt-3 border border-gray-400 py-2 rounded-full text-gray-700 flex items-center justify-center cursor-pointer relative z-10 pointer-events-auto">
        <img :src="iconShare.src" alt="Compartir" class="w-5 h-5 mr-2" />
        Compartir evento
      </button>
    </div>

    <!-- Precio Sticky en Mobile -->
    <div v-if="!hasPurchasedTickets" class="lg:hidden fixed bottom-0 left-0 w-full bg-lime-400 py-4 px-6 flex justify-between items-center shadow-md">
      <span class="text-lg text-gray-900">{{ getEventPrice(event.tickets) }}</span>
      <button 
        @click="openReserveModal" 
        aria-label="Comprar entrada" 
        class="bg-black text-white py-2 px-6 rounded-full flex items-center cursor-pointer relative z-10 pointer-events-auto"
      >
        Comprar entrada
      </button>
    </div>

    <!-- Sticky con múltiples botones cuando ya compró -->
    <div v-else class="lg:hidden fixed bottom-0 left-0 w-full bg-lime-400 py-3 px-4 shadow-md">
      <div class="flex flex-col gap-2">
        <div class="flex justify-between items-center">
          <span class="text-sm text-gray-900 font-medium">{{ getEventPrice(event.tickets) }}</span>
          <span class="text-xs text-gray-700">Ya tienes {{ eventOrders.length }} orden(es)</span>
        </div>
        <div class="flex gap-2">
          <button 
            @click="openPurchasedTickets" 
            aria-label="Ver entradas compradas" 
            class="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 px-3 rounded-full text-sm font-medium cursor-pointer relative z-10 pointer-events-auto"
          >
            Ver entradas
          </button>
          <button 
            @click="openReserveModal" 
            aria-label="Comprar más entradas" 
            class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-3 rounded-full text-sm font-medium cursor-pointer relative z-10 pointer-events-auto"
          >
            Comprar más
          </button>
        </div>
      </div>
    </div>
 
    <ShareEventModal :show="showModal" :event="event" @close="showModal = false"/>
    <ReservationModal v-if="showReserveModal" :event="event" @close="closeReserveModal" />
    <PurchasedTicketsModal 
      :show="showPurchasedTickets" 
      :eventOrders="eventOrders" 
      :event="event"
      @close="closePurchasedTickets" 
    />

  </div>
</template>
