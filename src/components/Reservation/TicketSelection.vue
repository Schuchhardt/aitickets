<script setup>
import { ref, watch, computed } from "vue";
import { useGoogleAnalytics } from "../../composables/useGoogleAnalytics.js";
import { formatLocalTime, formatLocalDate } from "../../utils/dateHelpers.js";
import { SERVICE_FEE_NOTE, maxPerPurchase, formatCLP, formatFunctionLabel, findTicketFunction } from "./pricing.js";

const props = defineProps({
  event: Object,
  selectedTickets: Object,
});

const emit = defineEmits(["update:selectedTickets"]);
// Copia local sincronizada con el v-model (para reflejar selecciones restauradas o hechas por el asistente)
const selectedTickets = ref({ ...(props.selectedTickets || {}) });
watch(() => props.selectedTickets, (value) => { selectedTickets.value = { ...(value || {}) }; }, { deep: true });

const tooltipTicketId = ref(null);
const { trackAddToCart } = useGoogleAnalytics();

const updateSelection = (ticketId, quantity) => {
  const next = { ...selectedTickets.value };
  if (quantity > 0) next[ticketId] = quantity;
  else delete next[ticketId];
  selectedTickets.value = next;
  emit("update:selectedTickets", next);
};

// max_quantity ya viene limitado por el stock desde la página del evento; remaining null = ilimitado
const ticketLimit = (ticket) => {
  const max = maxPerPurchase(ticket);
  return ticket.remaining == null ? max : Math.max(0, Math.min(max, Number(ticket.remaining)));
};
const isSoldOut = (ticket) => ticketLimit(ticket) <= 0;

const isSuperFan = (ticket) => {
  return ticket.price > 0 && ticket.price === Math.max(...props.event.tickets.map(t => t.price));
};

const increaseTicket = (ticket) => {
  const currentQuantity = selectedTickets.value[ticket.id] || 0;
  if (currentQuantity < ticketLimit(ticket)) {
    updateSelection(ticket.id, currentQuantity + 1);
    tooltipTicketId.value = null;
    trackAddToCart(props.event.id, props.event.name || props.event.title, 1, ticket.price || 0);
  } else {
    tooltipTicketId.value = ticket.id;
    setTimeout(() => {
      if (tooltipTicketId.value === ticket.id) tooltipTicketId.value = null;
    }, 2000);
  }
};

const decreaseTicket = (ticket) => {
  updateSelection(ticket.id, Math.max((selectedTickets.value[ticket.id] || 0) - 1, 0));
};

// R1: entradas agrupadas por función (event_date_id). NULL = válida para cualquier función.
const ticketGroups = computed(() => {
  const tickets = props.event?.tickets || [];
  const dates = (props.event?.dates || []).filter((d) => d?.id != null);
  const groups = [];
  for (const d of dates) {
    const items = tickets.filter((t) => findTicketFunction(t, dates)?.id === d.id);
    if (items.length) groups.push({ key: `fn-${d.id}`, label: formatFunctionLabel(d), items });
  }
  const anyFunction = tickets.filter((t) => !findTicketFunction(t, dates));
  if (anyFunction.length) {
    groups.push({ key: "any", label: dates.length > 1 ? "Válida para cualquier función" : "", items: anyFunction });
  }
  // Un solo grupo sin función específica: sin encabezado (evento de una sola fecha)
  if (groups.length === 1 && groups[0].key === "any") groups[0].label = "";
  return groups;
});

const formatTime = (datetime) => {
  return datetime ? formatLocalTime(datetime) : "";
};

const formatFullDate = (dateArray) => {
  if (!dateArray || !dateArray.length) return "";
  const start = dateArray[0];
  const end = dateArray[dateArray.length - 1];
  const startDate = formatLocalDate(start.date);
  const endDate = formatLocalDate(end.date);
  return startDate !== endDate ? `Del ${startDate} al ${endDate}` : `${startDate}`;
};
</script>

<template>
  <div v-if="event.tickets && event.tickets.length" class="w-full font-[Prompt]">
    <div class="w-full">
      <div v-if="(event.dates && event.dates.length) || event.start_date" class="text-center p-2 mb-4 bg-gray-50 rounded-[10px]">
        <p class="text-gray-500 text-sm">Fecha</p>
        <p class="text-lg font-semibold">{{ formatFullDate(event.dates) }}</p>
        <p class="text-gray-500 text-sm" v-if="event.start_date">
          {{ formatTime(event.start_date) }}<span v-if="event.end_date"> - </span>{{ formatTime(event.end_date) }}
        </p>
      </div>

      <div v-for="group in ticketGroups" :key="group.key" class="mb-4 last:mb-0">
      <p v-if="group.label" class="text-sm font-semibold text-gray-700 mb-2">{{ group.label }}</p>
      <div class="grid grid-cols-1 gap-3 w-full">
        <div
          v-for="ticket in group.items"
          :key="ticket.id"
          class="border p-4 rounded-lg flex justify-between items-center gap-3 w-full"
          :class="{ 'opacity-60': isSoldOut(ticket) }"
        >
          <div class="min-w-0">
            <div v-if="isSuperFan(ticket)" class="bg-green-200 text-green-800 text-xs font-bold px-2 py-1 rounded-full inline-block mb-2">
              Super Fan
            </div>
            <div v-else class="bg-gray-200 text-xs font-bold px-2 py-1 rounded-full inline-block mb-2">
              Fan
            </div>
            <p class="font-medium break-words">{{ ticket.ticket_name }}</p>
            <p v-if="ticket.price !== null && ticket.price !== undefined" class="text-gray-700">
              {{ ticket.price > 0 ? formatCLP(ticket.price) : "Gratis" }}
              <span v-if="ticket.price > 0" class="block sm:inline text-gray-500 text-xs">{{ SERVICE_FEE_NOTE }}</span>
            </p>
            <p v-if="ticket.remaining != null && ticket.remaining > 0 && ticket.remaining <= 10" class="text-orange-600 text-xs mt-1">
              ¡Quedan {{ ticket.remaining }}!
            </p>
          </div>

          <div class="flex justify-center items-center shrink-0">
            <span v-if="isSoldOut(ticket)" class="text-sm font-semibold text-gray-500 px-2">Agotada</span>
            <button
              v-else-if="!selectedTickets[ticket.id]"
              @click="increaseTicket(ticket)"
              aria-label="Añadir entrada"
              class="border px-4 py-2 rounded-lg text-black hover:bg-gray-100 cursor-pointer"
            >
              Añadir
            </button>
            <div v-else class="flex items-center justify-center space-x-1 border rounded-lg px-1 py-1">
              <button aria-label="Disminuir cantidad de entradas" @click="decreaseTicket(ticket)" class="w-10 h-10 md:w-9 md:h-9 cursor-pointer text-lg">-</button>
              <span class="w-6 text-center">{{ selectedTickets[ticket.id] || 0 }}</span>
              <button
                aria-label="Aumentar cantidad de entradas"
                @click="increaseTicket(ticket)"
                class="w-10 h-10 md:w-9 md:h-9 relative cursor-pointer text-lg"
              >
                +
                <transition name="fade">
                  <span
                    v-if="tooltipTicketId === ticket.id"
                    class="absolute top-full right-0 mt-2 bg-gray-900 text-white text-xs rounded px-2 py-1 z-50 whitespace-nowrap"
                  >
                    Máximo {{ ticketLimit(ticket) }} por compra
                  </span>
                </transition>
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  </div>
  <p v-else class="text-center text-gray-500 font-[Prompt] p-4">No hay entradas a la venta en este momento.</p>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.fade-enter-to,
.fade-leave-from {
  opacity: 1;
}
</style>
