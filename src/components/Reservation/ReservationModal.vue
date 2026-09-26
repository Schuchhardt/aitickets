<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { eventBus } from '../../utils/eventbus.js';
import { trackBeginCheckout } from "../../composables/useGoogleAnalytics.js";
import HeaderSteps from "./HeaderSteps.vue";
import TicketSelection from "./TicketSelection.vue";
import OrderSummary from "./OrderSummary.vue";
import BuyerInfo from "./BuyerInfo.vue";
import PaymentStep from "./PaymentStep.vue";
import { buildSelectedLines, computeTotals, isValidEmail, maxPerPurchase } from "./pricing.js";

const props = defineProps({ event: Object });
const emit = defineEmits(["close"]);

const emptyBuyer = () => ({ firstName: "", lastName: "", email: "", confirmEmail: "", phone: "", termsAccepted: false });

const currentStep = ref(1);
const selectedTickets = ref({});
const buyerInfo = ref(emptyBuyer());

const storageKey = (name) => `${name}_event_${props.event.id}`;
const readStorage = (name) => {
  try {
    const raw = localStorage.getItem(storageKey(name));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const writeStorage = (name, value) => {
  try { localStorage.setItem(storageKey(name), JSON.stringify(value)); } catch { /* storage no disponible */ }
};

onMounted(() => {
  const storedTickets = readStorage("selectedTickets");
  if (storedTickets && typeof storedTickets === "object") {
    // Solo entradas que siguen a la venta en la página
    const valid = {};
    for (const [id, qty] of Object.entries(storedTickets)) {
      const ticket = (props.event.tickets || []).find((t) => String(t.id) === String(id));
      if (ticket && Number(qty) > 0) valid[id] = Math.min(Number(qty), maxPerPurchase(ticket));
    }
    selectedTickets.value = valid;
  }

  const storedBuyer = readStorage("buyerInfo");
  if (storedBuyer && typeof storedBuyer === "object") buyerInfo.value = { ...emptyBuyer(), ...storedBuyer, termsAccepted: false };

  const storedStep = Number(readStorage("currentStep"));
  if ([1, 2, 3].includes(storedStep)) currentStep.value = storedStep;
  if (!Object.keys(selectedTickets.value).length) currentStep.value = 1;

  eventBus.on('ticket-selection', handleRemoteTicketSelection);
  eventBus.on('proceed-to-next-step', handleRemoteGoToNextStep);
  eventBus.on('fill-buyer-info', handleRemoteFillBuyerInfo);
});

onUnmounted(() => {
  eventBus.off('ticket-selection', handleRemoteTicketSelection);
  eventBus.off('proceed-to-next-step', handleRemoteGoToNextStep);
  eventBus.off('fill-buyer-info', handleRemoteFillBuyerInfo);
});

// ==== PERSISTIR EN LOCALSTORAGE AUTOMÁTICAMENTE ====
watch(selectedTickets, () => writeStorage("selectedTickets", selectedTickets.value), { deep: true });
watch(buyerInfo, () => writeStorage("buyerInfo", { ...buyerInfo.value, termsAccepted: false }), { deep: true });
watch(currentStep, () => writeStorage("currentStep", currentStep.value));

// ==== CALCULOS (solo para mostrar; el servidor recalcula) ====
const totals = computed(() => computeTotals(buildSelectedLines(selectedTickets.value, props.event.tickets, props.event.dates)));

// ==== NAVEGACIÓN ====
const buyerIsValid = computed(() => {
  const b = buyerInfo.value;
  const email = (b.email || "").trim();
  return (
    (b.firstName || "").trim() !== "" &&
    (b.lastName || "").trim() !== "" &&
    isValidEmail(email) &&
    email.toLowerCase() === (b.confirmEmail || "").trim().toLowerCase() &&
    b.termsAccepted === true
  );
});

const canProceed = computed(() => {
  if (currentStep.value === 1) return totals.value.quantity > 0;
  if (currentStep.value === 2) return buyerIsValid.value;
  return true;
});

const nextStep = () => {
  if (canProceed.value && currentStep.value < 3) {
    // begin_checkout al pasar de la selección de entradas a los datos del comprador
    if (currentStep.value === 1) {
      trackBeginCheckout(props.event.id, props.event.name || props.event.title, totals.value.quantity, totals.value.total);
    }
    currentStep.value++;
  }
};

const prevStep = () => {
  if (currentStep.value > 1) currentStep.value--;
};

const closeModal = (event) => {
  if (event.target.id === "modal-overlay") handleClose();
};

const handleClose = () => {
  eventBus.emit('close-modal');
  eventBus.emit('assistant-show');
  emit("close");
};

function handleRemoteTicketSelection(data) {
  const ticket = (props.event.tickets || []).find((t) => String(t.id) === String(data?.ticket_type_id));
  if (!ticket) return;
  const qty = Math.min(Math.max(Number(data.quantity) || 1, 1), maxPerPurchase(ticket));
  selectedTickets.value = { ...selectedTickets.value, [ticket.id]: qty };
}

function handleRemoteFillBuyerInfo(data) {
  buyerInfo.value = {
    firstName: data.first_name || "",
    lastName: data.last_name || "",
    email: data.email || "",
    confirmEmail: data.email || "",
    phone: data.phone || "",
    termsAccepted: false
  };
}

function handleRemoteGoToNextStep() {
  nextStep();
}
</script>

<template>
  <div
    id="modal-overlay"
    class="fixed inset-0 flex items-stretch md:items-center justify-center z-[55] md:p-4"
    @click="closeModal"
  >
    <div
      class="bg-white md:rounded-lg shadow-xl w-full md:max-w-5xl flex flex-col h-full md:h-auto md:max-h-[90vh]"
      role="dialog"
      aria-modal="true"
      @click.stop
    >
      <HeaderSteps :eventName="event.name" :currentStep="currentStep" @close="handleClose" />
      <p v-if="event.is_demo" class="bg-purple-50 text-purple-900 text-xs sm:text-sm text-center px-4 py-2 border-b border-purple-100">
        Modo demostración: el flujo es real, pero al final no se crea ninguna orden ni se cobra nada.
      </p>

      <div class="flex-1 overflow-y-auto">
        <div v-if="currentStep === 1 || currentStep === 2" class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 p-2 w-full md:min-w-[732px] md:max-w-[800px] mx-auto">
          <div class="w-full">
            <TicketSelection
              v-if="currentStep === 1"
              :event="event"
              v-model:selectedTickets="selectedTickets"
              class="w-full"
            />
            <BuyerInfo v-if="currentStep === 2" v-model:buyerInfo="buyerInfo" class="w-full" />
          </div>

          <div class="bg-gray-50 p-4 md:p-6 w-full rounded-[10px]">
            <OrderSummary :selectedTickets="selectedTickets" :event="event" class="w-full" />
          </div>
        </div>

        <div v-if="currentStep === 3" class="p-4 md:p-6 w-full">
          <PaymentStep :selectedTickets="selectedTickets" :buyerInfo="buyerInfo" :event="event" />
        </div>
      </div>

      <div class="w-full flex justify-between items-center gap-4 p-4 md:p-6 border-t bg-white md:rounded-b-lg">
        <button v-if="currentStep > 1" @click="prevStep" aria-label="atras" class="cursor-pointer text-gray-600 hover:text-black py-2">Atrás</button>
        <span v-else></span>
        <button
          v-if="currentStep < 3"
          @click="nextStep"
          :disabled="!canProceed"
          class="px-6 py-3 rounded-md"
          :class="{
            'bg-lime-500 text-white cursor-pointer': canProceed,
            'bg-gray-300 text-gray-500 cursor-not-allowed': !canProceed
          }"
          aria-label="continuar"
        >
          Continuar
        </button>
      </div>
    </div>
  </div>
</template>

<style>
#modal-overlay {
  background-color: rgb(0 0 0 / 80%);
}
</style>
