<script setup>
import { ref, defineProps, computed } from "vue";

const props = defineProps({
  selectedTickets: Object,
  buyerInfo: Object,
  totalAmount: Number,
  discount: Number,
  event: Object, // Se necesita para obtener los nombres y precios de los tickets
});

const isLoading = ref(false);
const errorMessage = ref("");

const selectedTicketList = computed(() => {
  return Object.keys(props.selectedTickets)
    .filter(ticketId => props.selectedTickets[ticketId] > 0)
    .map(ticketId => {
      const ticket = props.event.tickets.find(t => t.id == ticketId);
      return {
        id: ticketId,
        name: ticket?.ticket_name,
        quantity: props.selectedTickets[ticketId],
        price: ticket?.price || 0,
        total: (ticket?.price || 0) * props.selectedTickets[ticketId],
      };
    });
});

const calculateFee = computed(() => {
  return props.totalAmount > 0 ? props.totalAmount * 0.1 : 0; // 10% de fee si hay pago
});

const calculateDiscount = computed(() => {
  return props.discount ? (props.totalAmount * props.discount) / 100 : 0;
});

const finalTotal = computed(() => {
  return props.totalAmount + calculateFee.value - calculateDiscount.value;
});

const handlePayment = async () => {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const response = await fetch("/api/purchase-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buyer: props.buyerInfo,
        tickets: selectedTicketList.value,
        total: finalTotal.value,
        discount: props.discount,
        eventId: props.event.id
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Error en la compra");
    }

    if (data.paymentLink) {
      window.location.href = data.paymentLink; // Redirigir a pago
    } else if (data.ticketId) {
      window.location.href = `/ticket/${data.ticketId}`; // Redirigir al ticket
    }
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <div class="text-center">
    <h3 class="text-lg font-semibold mb-4">Completa tu registro</h3>
    <p class="text-gray-600 mb-4">Revisa tu pedido antes de continuar.</p>

    <div class="border p-4 rounded-lg mb-4">
      <p class="text-lg font-bold">Total a pagar:</p>
      <p class="text-xl" :class="{ 'text-green-600': totalAmount > 0, 'text-blue-600': totalAmount === 0 }">
        {{ totalAmount > 0 ? `$${finalTotal.toLocaleString("es-ES")}` : "Evento gratuito" }}
      </p>
    </div>

    <div class="border p-4 rounded-lg text-left mb-4">
      <h4 class="font-semibold mb-2">Detalles del comprador:</h4>
      <p><strong>Nombre:</strong> {{ buyerInfo.firstName }} {{ buyerInfo.lastName }}</p>
      <p><strong>Email:</strong> {{ buyerInfo.email }}</p>
      <p><strong>Teléfono:</strong> {{ buyerInfo.phone }}</p>
    </div>

    <div class="border p-4 rounded-lg text-left mb-4">
      <h4 class="font-semibold mb-2">Entradas seleccionadas:</h4>
      <ul>
        <li v-for="ticket in selectedTicketList" :key="ticket.id" class="flex justify-between">
          <span>{{ ticket.quantity }} x {{ ticket.name }}</span>
          <span class="font-medium" v-if="ticket.total !== 0">
            ${{ ticket.total.toLocaleString("es-ES") }}
          </span>
          <span class="font-medium" v-if="ticket.total == 0">
            Gratis
          </span>
        </li>
      </ul>
    </div>

    <p v-if="errorMessage" class="text-red-600 mb-4">{{ errorMessage }}</p>

    <button
      @click="handlePayment"
      :disabled="isLoading"
      class="bg-black text-white px-6 py-2 rounded-md inline-block cursor-pointer"
    >
      {{ isLoading ? "Procesando..." : totalAmount > 0 ? "Ir a pagar" : "Finalizar registro" }}
    </button>
  </div>
</template>
