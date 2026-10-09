<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue";
import iconShare from "../images/icon-share.png"; // Icono de compartir
import iconArrow from "../images/icon-arrow-black.png"; // Icono de flecha en botón de reserva
import iconTicket from "../images/icon-tickets.png"; // Icono de ticket
import iconCalendar from "../images/icon-calendar-dark.png"; // Icono de calendario
import ShareEventModal from "./ShareEventModal.vue";
import ReservationModal from "./Reservation/ReservationModal.vue";
import PurchasedTicketsModal from "./PurchasedTicketsModal.vue";
import { eventBus } from '../utils/eventbus.js';
import { feeNoteFor } from "./Reservation/pricing.js";

const props = defineProps({
  event: Object,
  // Sitio de productor: en un dominio propio (fuera de aitickets.cl) "Comprar" lleva al checkout en
  // aitickets.cl (event.purchase_url, con ?comprar=1), donde funcionan Turnstile y el pago.
  siteMode: { type: Boolean, default: false },
});

// Se calcula en el cliente (onMounted) para no romper la hidratación
const externalPurchaseUrl = ref("");
const isAiticketsHost = (host) =>
  host === "aitickets.cl" || host.endsWith(".aitickets.cl") || host === "localhost" || host === "127.0.0.1" || host.endsWith(".netlify.app");

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
  if (externalPurchaseUrl.value) {
    window.location.href = externalPurchaseUrl.value;
    return;
  }
  eventBus.emit('open-modal'); // Emitir evento al abrir el modal (para el asistente de IA)
  eventBus.emit('assistant-hide'); // Evento específico para ocultar el asistente
  showReserveModal.value = true;
};

const closeReserveModal = () => {
  eventBus.emit('close-modal'); // Notificar que el modal se está cerrando
  eventBus.emit('assistant-show'); // Evento específico para mostrar el asistente
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

  if (props.siteMode && props.event?.purchase_url && !isAiticketsHost(window.location.hostname.toLowerCase())) {
    externalPurchaseUrl.value = props.event.purchase_url;
  }
  
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

// Verificar si el evento ya ha terminado
const isEventFinished = computed(() => {
  if (!props.event?.end_date) return false;
  const endDate = new Date(props.event.end_date);
  const now = new Date();
  return endDate < now;
});

// format price with thousands separator (dot)
const formatPrice = (price) => {
  return price !== null && price !== undefined ? Number(price).toLocaleString("es-CL") : "";
};

// Cargo por servicio al comprador: 8% del subtotal + IVA del cargo (netlify/lib/fees.mjs)

// Entradas a la venta (el servidor ya filtra por ventana de venta y stock)
const onSaleTickets = computed(() => (props.event?.tickets || []).filter(
  (t) => t.remaining === null || t.remaining === undefined || t.remaining > 0
));

// Estado de venta: on_sale | sold_out | upcoming | closed
const saleState = computed(() => {
  // Vista previa de un evento no publicado: se muestran precios, pero no se puede comprar
  if (props.event?.is_preview && props.event?.status !== "published") return "preview";
  if (onSaleTickets.value.length > 0) return "on_sale";
  return props.event?.sale_state && props.event.sale_state !== "on_sale" ? props.event.sale_state : "closed";
});

const canBuy = computed(() => saleState.value === "on_sale");

const hasPaidTickets = computed(() => onSaleTickets.value.some((t) => Number(t.price) > 0));

// Texto de precio / estado
const priceLabel = computed(() => {
  switch (saleState.value) {
    case "sold_out":
      return "Agotado";
    case "upcoming":
      return "Próximamente";
    case "closed":
      return "Venta cerrada";
    case "preview":
      if (!onSaleTickets.value.length) return "Sin entradas a la venta";
  }
  const prices = onSaleTickets.value.map((t) => Number(t.price) || 0);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  if (maxPrice === 0) return "Gratis";
  if (minPrice === maxPrice) return `$${formatPrice(minPrice)}`;
  if (minPrice === 0) {
    const minPaid = Math.min(...prices.filter((p) => p > 0));
    return `Gratis o desde $${formatPrice(minPaid)}`;
  }
  return `Desde $${formatPrice(minPrice)}`;
});

const feeNote = computed(() =>
  canBuy.value && hasPaidTickets.value
    ? feeNoteFor(props.event)
    : ""
);

// Fecha de inicio de venta (para "Próximamente")
const saleStartsLabel = computed(() => {
  if (saleState.value !== "upcoming" || !props.event?.sale_starts_at) return "";
  const d = new Date(props.event.sale_starts_at);
  if (Number.isNaN(d.getTime())) return "";
  return "Venta desde el " + d.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: props.event?.timezone || "America/Santiago",
  }) + " hrs";
});

// "¡Quedan N!" cuando el stock total restante es bajo (solo si todas las entradas tienen stock limitado)
const LOW_STOCK_THRESHOLD = 20;
const remainingTotal = computed(() => {
  const tickets = onSaleTickets.value;
  if (!tickets.length || tickets.some((t) => t.remaining === null || t.remaining === undefined)) return null;
  return tickets.reduce((sum, t) => sum + Number(t.remaining || 0), 0);
});
const lowStockLabel = computed(() =>
  canBuy.value && remainingTotal.value !== null && remainingTotal.value <= LOW_STOCK_THRESHOLD
    ? `¡Quedan ${remainingTotal.value}!`
    : ""
);

const unavailableLabel = computed(() => {
  switch (saleState.value) {
    case "sold_out":
      return "Entradas agotadas";
    case "upcoming":
      return "Venta próximamente";
    case "preview":
      return "Vista previa · compra al publicar";
    default:
      return "Venta cerrada";
  }
});

const stripHtml = (html) => (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// Función para agregar evento al calendario
const addToCalendar = () => {
  if (!props.event) return;
  
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };
  
  const firstFunction = (props.event.dates || []).find((d) => d.start_iso);
  const start = firstFunction?.start_iso || props.event.start_date;
  const end = firstFunction?.end_iso || props.event.end_date || start;
  if (!start) return;

  const eventUrl = `${window.location.origin}/eventos/${props.event.slug}`;
  const title = encodeURIComponent(props.event.name || props.event.title || 'Evento');
  const description = encodeURIComponent(`${stripHtml(props.event.description).slice(0, 500)}\n\n${eventUrl}`);
  const location = encodeURIComponent(props.event.location || '');
  const startDate = formatDate(start);
  const endDate = formatDate(end);
  
  // URL para Google Calendar
  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDate}/${endDate}&details=${description}&location=${location}`;
  
  // Abrir Google Calendar
  window.open(googleUrl, '_blank');
};
</script>

<template>
  <div class="font-['Unbounded'] font-bold" v-if="event">
    <!-- Botones de acción en Mobile (debajo del EventHeader) -->
    <div class="lg:hidden flex flex-col items-center mt-4 space-y-3">
      <!-- Mostrar solo para eventos finalizados -->
      <template v-if="isEventFinished">
        <div class="w-11/12 flex flex-col items-center py-4 border-2 border-gray-400 rounded-xl text-center bg-gray-50">
          <button disabled class="w-full py-3 rounded-full text-gray-600 bg-gray-200 cursor-not-allowed font-bold text-lg">
            Evento finalizado
          </button>
          <p class="mt-3 text-gray-600 text-sm">Te vemos en el próximo</p>
        </div>
      </template>
      
      <!-- Mostrar botones normales para eventos activos -->
      <template v-else>
        <button @click="showModal = true" aria-label="Compartir evento" class="w-11/12 flex items-center justify-center py-2 border border-gray-300 rounded-full text-gray-600 bg-gray-100 cursor-pointer relative z-5 pointer-events-auto">
          <img :src="iconShare.src" alt="Compartir" class="w-5 h-5 mr-2" />
          Compartir evento
        </button>
        
        <button @click="addToCalendar" aria-label="Añadir al calendario" class="w-11/12 flex items-center justify-center py-2 border border-gray-300 rounded-full text-gray-600 bg-gray-100 cursor-pointer relative z-5 pointer-events-auto">
          <img :src="iconCalendar.src" alt="Calendario" class="w-5 h-5 mr-2" />
          Añadir al calendario
        </button>
      </template>
    </div>

    <!-- Tarjeta de Acciones en Desktop -->
    <div class="hidden lg:block bg-gray-100 p-6 rounded-xl shadow-md text-center">
      <!-- Para eventos finalizados -->
      <template v-if="isEventFinished">
        <div class="flex flex-col items-center py-4">
          <button disabled class="w-full py-4 rounded-full text-gray-600 bg-gray-200 cursor-not-allowed font-bold text-xl">
            Evento finalizado
          </button>
          <p class="mt-4 text-gray-600 text-base">Te vemos en el próximo</p>
        </div>
      </template>

      <!-- Para eventos activos -->
      <template v-else>
        <!-- Precio -->
        <div class="flex items-center justify-between text-lg text-gray-900">
          <span class="flex items-center">
            <img :src="iconTicket.src" alt="ticket icon" class="w-5 h-5 mr-2" />
            Precio
          </span>
          <span class="text-xl">{{ priceLabel }}</span>
        </div>
        <p v-if="feeNote" class="text-right text-xs font-normal font-['Prompt'] text-gray-500 mt-1">{{ feeNote }}</p>
        <p v-if="lowStockLabel" class="text-right text-sm text-red-600 mt-1">{{ lowStockLabel }}</p>
        <p v-if="saleStartsLabel" class="text-right text-xs font-normal font-['Prompt'] text-gray-600 mt-1">{{ saleStartsLabel }}</p>

        <!-- Botones -->
        <button
          v-if="!canBuy && !hasPurchasedTickets"
          disabled
          class="w-full py-3 rounded-full mt-4 text-gray-600 bg-gray-200 cursor-not-allowed"
        >
          {{ unavailableLabel }}
        </button>

        <button 
          v-else-if="!hasPurchasedTickets"
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
            v-if="canBuy"
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

        <button @click="addToCalendar" aria-label="Añadir al calendario" class="w-full mt-3 border border-gray-400 py-2 rounded-full text-gray-700 flex items-center justify-center cursor-pointer relative z-10 pointer-events-auto">
          <img :src="iconCalendar.src" alt="Calendario" class="w-5 h-5 mr-2" />
          Añadir al calendario
        </button>
      </template>
    </div>

    <!-- Precio Sticky en Mobile -->
    <div v-if="isEventFinished" class="lg:hidden fixed bottom-0 left-0 w-full bg-gray-300 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] px-6 flex flex-col items-center shadow-md z-50">
      <button disabled class="w-full py-3 rounded-full text-gray-600 bg-gray-200 cursor-not-allowed font-bold text-base">
        Evento finalizado
      </button>
      <p class="mt-2 text-gray-600 text-sm">Te vemos en el próximo</p>
    </div>

    <div v-else-if="!hasPurchasedTickets" class="lg:hidden fixed bottom-0 left-0 w-full pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] px-4 flex justify-between items-center gap-3 shadow-md z-50" :class="canBuy ? 'bg-lime-400' : 'bg-gray-300'">
      <div class="flex flex-col min-w-0">
        <span class="text-lg text-gray-900">{{ priceLabel }}</span>
        <span v-if="feeNote" class="text-xs font-normal font-['Prompt'] text-gray-800">{{ feeNote }}</span>
        <span v-if="lowStockLabel" class="text-xs text-red-700">{{ lowStockLabel }}</span>
        <span v-if="saleStartsLabel" class="text-xs font-normal font-['Prompt'] text-gray-700">{{ saleStartsLabel }}</span>
      </div>
      <button
        v-if="!canBuy"
        disabled
        class="shrink-0 whitespace-nowrap bg-gray-200 text-gray-600 py-3 px-5 rounded-full cursor-not-allowed"
      >
        {{ unavailableLabel }}
      </button>
      <button 
        v-else
        @click="openReserveModal" 
        aria-label="Comprar entrada" 
        class="shrink-0 whitespace-nowrap bg-black text-white py-3 px-5 rounded-full flex items-center cursor-pointer relative z-10 pointer-events-auto"
      >
        Comprar entrada
      </button>
    </div>

    <!-- Sticky con múltiples botones cuando ya compró -->
    <div v-else-if="!isEventFinished" class="lg:hidden fixed bottom-0 left-0 w-full bg-lime-400 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] px-4 shadow-md z-50">
      <div class="flex flex-col gap-2">
        <div class="flex justify-between items-center">
          <span class="text-sm text-gray-900 font-medium">{{ priceLabel }}</span>
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
            v-if="canBuy"
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
