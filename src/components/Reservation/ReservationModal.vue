<script setup>
import { ref, computed, defineProps, defineEmits, onMounted, onUnmounted, watch } from "vue";
import { eventBus } from '../../utils/eventbus.js';
import { useGoogleAnalytics } from "../../composables/useGoogleAnalytics.js";
import HeaderSteps from "./HeaderSteps.vue";
import TicketSelection from "./TicketSelection.vue";
import OrderSummary from "./OrderSummary.vue";
import BuyerInfo from "./BuyerInfo.vue";
import PaymentStep from "./PaymentStep.vue";

const props = defineProps({ event: Object });
const emit = defineEmits(["close"]);

const currentStep = ref(1);
const selectedTickets = ref({});
const buyerInfo = ref({ firstName: "", lastName: "", email: "", phone: "", termsAccepted: false });
const discount = ref(0);
const { trackBeginCheckout } = useGoogleAnalytics();

onMounted(() => {
  const storedTickets = localStorage.getItem(`selectedTickets_event_${props.event.id}`);
  if (storedTickets) selectedTickets.value = JSON.parse(storedTickets);

  const storedBuyer = localStorage.getItem(`buyerInfo_event_${props.event.id}`);
  if (storedBuyer) buyerInfo.value = JSON.parse(storedBuyer);

  const storedStep = localStorage.getItem(`currentStep_event_${props.event.id}`);
  if (storedStep) currentStep.value = parseInt(storedStep);

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
watch(selectedTickets, () => {
  localStorage.setItem(`selectedTickets_event_${props.event.id}`, JSON.stringify(selectedTickets.value));
}, { deep: true });

watch(buyerInfo, () => {
  localStorage.setItem(`buyerInfo_event_${props.event.id}`, JSON.stringify(buyerInfo.value));
}, { deep: true });

watch(currentStep, () => {
  localStorage.setItem(`currentStep_event_${props.event.id}`, currentStep.value.toString());
});

// ==== CALCULOS ====
const calculateSubtotal = computed(() => {
  return Object.keys(selectedTickets.value).reduce((sum, ticketId) => {
    const ticket = props.event.tickets.find((t) => t.id == ticketId);
    return sum + (ticket ? ticket.price * selectedTickets.value[ticketId] : 0);
  }, 0);
});

const calculateTotal = computed(() => {
  const discountAmount = discount.value ? (calculateSubtotal.value * discount.value) / 100 : 0;
  return calculateSubtotal.value - discountAmount;
});

// ==== NAVEGACIÓN ====
const applyDiscount = (discountValue) => {
  discount.value = discountValue;
};

const canProceed = computed(() => {
  if (currentStep.value === 1) {
    return Object.values(selectedTickets.value).some((qty) => qty > 0);
  } else if (currentStep.value === 2) {
    return (
      buyerInfo.value.firstName.trim() !== "" &&
      buyerInfo.value.lastName.trim() !== "" &&
      buyerInfo.value.email.trim() !== "" &&
      buyerInfo.value.phone.trim() !== "" &&
      buyerInfo.value.termsAccepted !== false
    );
  }
  return true;
});

const nextStep = () => {
  if (canProceed.value && currentStep.value < 3) {
    // Track begin_checkout when moving from ticket selection to buyer info (step 1 to 2)
    if (currentStep.value === 1) {
      const totalQuantity = Object.values(selectedTickets.value).reduce((sum, qty) => sum + qty, 0);
      const totalPrice = calculateTotal.value;
      
      trackBeginCheckout(
        props.event.id,
        props.event.title,
        totalQuantity,
        totalPrice
      );
    }
    
    currentStep.value++;
  }
};

const prevStep = () => {
  if (currentStep.value > 1) {
    currentStep.value--;
  }
};

const closeModal = (event) => {
  if (event.target.id === "modal-overlay") {
    emit("close");
  }
};

function handleRemoteTicketSelection(data) {
  selectedTickets.value = {
    ...selectedTickets.value,
    [data.ticket_type_id]: data.quantity
  };
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
    class="fixed inset-0 bg-black flex items-center justify-center z-[55] overflow-y-auto md:p-4"
    @click="closeModal"
  >
    <div
      class="bg-white rounded-lg shadow-xl max-w-3xl w-full md:w-auto md:max-w-5xl md:flex md:flex-col md:items-start max-h-[90vh] overflow-y-auto"
      @click.stop
    >
      <HeaderSteps :eventName="event.name" :currentStep="currentStep" @close="emit('close')" />

      <div v-if="currentStep === 1 || currentStep === 2" class="grid grid-cols-1 md:grid-cols-2 gap-6 p-2 w-full md:min-w-[732px] md:max-w-[800px] mx-auto">
        <div class="w-full">
          <TicketSelection
            v-if="currentStep === 1"
            :event="event"
            v-model:selectedTickets="selectedTickets"
            class="w-full"
          />
          <BuyerInfo v-if="currentStep === 2" v-model:buyerInfo="buyerInfo" class="w-full" />
        </div>

        <div class="bg-gray-50 p-6 w-full rounded-[10px]">
          <OrderSummary
            :selectedTickets="selectedTickets"
            :event="event"
            :totalAmount="calculateTotal"
            @apply-discount="applyDiscount"
            class="w-full"
          />
        </div>
      </div>

      <div v-if="currentStep === 3" class="p-6 w-full">
        <PaymentStep
          :selectedTickets="selectedTickets"
          :buyerInfo="buyerInfo"
          :totalAmount="calculateTotal"
          :discount="discount"
          :event="event"
        />
      </div>

      <div class="w-full flex justify-between p-6 border-t bg-white md:rounded-b-lg">
        <button v-if="currentStep > 1" @click="prevStep" aria-label="atras" class="cursor-pointer text-gray-600 hover:text-black">Atrás</button>
        <button
          v-if="currentStep < 3"
          @click="nextStep"
          :disabled="!canProceed"
          class="px-6 py-2 rounded-md"
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
