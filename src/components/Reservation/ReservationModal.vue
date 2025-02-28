<script setup>
import { ref, computed, defineProps, defineEmits } from "vue";
import HeaderSteps from "./HeaderSteps.vue";
import TicketSelection from "./TicketSelection.vue";
import OrderSummary from "./OrderSummary.vue";
import BuyerInfo from "./BuyerInfo.vue";
import PaymentStep from "./PaymentStep.vue";

const props = defineProps({
  event: Object,
});

const emit = defineEmits(["close"]);

const currentStep = ref(1);
const selectedTickets = ref({});
const buyerInfo = ref({ firstName: "", lastName: "", email: "" });

const totalAmount = computed(() => {
  return Object.keys(selectedTickets.value).reduce((sum, ticketId) => {
    const ticket = props.event.tickets.find(t => t.id == ticketId);
    return sum + (ticket ? ticket.price * selectedTickets.value[ticketId] : 0);
  }, 0);
});

const nextStep = () => { if (currentStep.value < 3) currentStep.value++; };
const prevStep = () => { if (currentStep.value > 1) currentStep.value--; };
const closeModal = (event) => { if (event.target.id === "modal-overlay") emit("close"); };
</script>

<template>
  <div id="modal-overlay" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 md:p-0" @click="closeModal">
    <div class="bg-white rounded-lg shadow-xl max-w-3xl w-full md:w-auto md:max-w-5xl md:flex md:flex-col md:items-start" @click.stop>
      <HeaderSteps :eventName="event.name" :currentStep="currentStep" @close="emit('close')" />
      
      <div v-if="currentStep === 1 || currentStep === 2" class="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
        <div class="w-full">
          <TicketSelection v-if="currentStep === 1" :event="event" v-model:selectedTickets="selectedTickets" class="w-full" />
          <BuyerInfo v-if="currentStep === 2" v-model:buyerInfo="buyerInfo" class="w-full" />
        </div>
        
        <div class="bg-gray-50 border-l p-6 w-full">
          <OrderSummary :selectedTickets="selectedTickets" :event="event" :totalAmount="totalAmount" class="w-full" />
        </div>
      </div>
      
      <div v-if="currentStep === 3" class="p-6 w-full">
        <PaymentStep :totalAmount="totalAmount" />
      </div>
      
      <!-- Navegación -->
      <div class="w-full flex justify-between p-6 border-t bg-white md:rounded-b-lg">
        <button v-if="currentStep > 1" @click="prevStep" class="text-gray-600 hover:text-black">Atrás</button>
        <button v-if="currentStep < 3" @click="nextStep" class="bg-lime-500 text-white px-6 py-2 rounded-md">Continuar</button>
      </div>
    </div>
  </div>
</template>
