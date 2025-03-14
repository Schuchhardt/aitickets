<script setup>
import { defineProps, ref, computed } from "vue";

const props = defineProps({
  selectedTickets: Object,
  event: Object,
  totalAmount: Number,
});

const discountCode = ref("");
const appliedDiscount = ref(false);
const discountPercentage = ref(0);
const errorMessage = ref("");

const hasPaidTickets = computed(() => {
  return Object.keys(props.selectedTickets).some(ticketId => {
    const ticket = props.event.tickets.find(t => t.id == ticketId);
    return ticket?.price > 0;
  });
});

const serviceFee = computed(() => {
  return hasPaidTickets.value ? props.totalAmount * 0.1 : 0;
});

const discountAmount = computed(() => {
  return props.totalAmount * (discountPercentage.value / 100);
});

const finalTotal = computed(() => props.totalAmount + serviceFee.value - discountAmount.value);

const selectedTicketList = computed(() => {
  return Object.keys(props.selectedTickets)
    .filter(ticketId => props.selectedTickets[ticketId] > 0)
    .map(ticketId => {
      const ticket = props.event.tickets.find(t => t.id == ticketId);
      return {
        name: ticket?.ticket_name,
        quantity: props.selectedTickets[ticketId],
        price: ticket?.price,
        total: ticket?.price * props.selectedTickets[ticketId],
      };
    });
});

const applyDiscount = async () => {
  errorMessage.value = "";
  try {
    const response = await fetch("/api/discount-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: discountCode.value }),
    });
    
    if (!response.ok) {
      throw new Error("El código de descuento no es válido o ha expirado.");
    }
    
    const data = await response.json();
    discountPercentage.value = data.discountAmount;
    appliedDiscount.value = true;
  } catch (error) {
    errorMessage.value = error.message;
  }
};
</script>

<template>
  <div class="border p-4 rounded-lg bg-gray-50 font-[Prompt]">
    <h3 class="font-semibold text-lg mb-2 text-center" v-if="selectedTicketList.length !== 0">Tu pedido</h3>
    <div class="flex items-center mb-2" v-if="selectedTicketList.length !== 0 && hasPaidTickets" v-show="false">
      <input 
        v-model="discountCode" 
        type="text" 
        placeholder="Código de descuento" 
        class="border p-2 rounded-md w-full mr-2"
      />
      <button 
        class="bg-gray-400 text-white px-4 py-2 rounded-md" 
        :disabled="appliedDiscount || !discountCode"
        @click="applyDiscount"
      >
        Aplicar
      </button>
    </div>
    <p v-if="errorMessage" class="text-red-500 text-sm">{{ errorMessage }}</p>
    <p v-if="selectedTicketList.length === 0" class="text-gray-500 text-sm mb-4">
      Por favor, elija una hora y un tipo de ticket para continuar.
    </p>
    <ul v-else class="mb-4">
      <li v-for="ticket in selectedTicketList" :key="ticket.name" class="flex justify-between">
        <span>
          {{ ticket.quantity }} x {{ ticket.name }}
        </span>
        <span class="font-medium" v-if="ticket.total !== 0">
          ${{ ticket.price.toLocaleString("es-CL") }} CLP
        </span>
        <span class="font-medium" v-if="ticket.total == 0">
          Gratis
        </span>
      </li>
    </ul>
    <div v-if="selectedTicketList.length" class="text-sm text-gray-600 border-t pt-2">
      <div class="flex justify-between">
        <span>Subtotal</span>
        <span v-if="totalAmount !== 0">${{ totalAmount.toLocaleString("es-CL") }} CLP</span>
        <span class="font-medium" v-if="totalAmount == 0">
          Gratis
        </span>
      </div>
      <div v-if="hasPaidTickets" class="flex justify-between">
        <span>Tasa del servicio</span>
        <span>${{ serviceFee.toLocaleString("es-CL") }} CLP</span>
      </div>
      <div v-if="appliedDiscount" class="flex justify-between text-green-600">
        <span>Descuento ({{ discountPercentage }}%)</span>
        <span>- ${{ discountAmount.toLocaleString("es-CL") }} CLP</span>
      </div>
    </div>
    <div v-if="selectedTicketList.length" class="flex justify-between text-l font-bold border-t pt-2 mt-2">
      <span>Total ({{ selectedTicketList.reduce((sum, t) => sum + t.quantity, 0) }} ticket<span v-if="selectedTicketList.reduce((sum, t) => sum + t.quantity, 0) > 1">s</span>) </span>
      <span v-if="finalTotal !== 0">${{ finalTotal.toLocaleString("es-CL") }} CLP</span>
      <span v-if="finalTotal == 0" class="ml-4"> Gratis</span>
    </div>
  </div>
</template>
