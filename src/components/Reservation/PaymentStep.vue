<script setup>
import { defineProps } from "vue";

const props = defineProps({
  totalAmount: Number,
});

const getPaymentLink = () => {
  return props.totalAmount > 0
    ? `https://payment-provider.com/pay?amount=${props.totalAmount}`
    : "#";
};
</script>

<template>
  <div class="text-center">
    <h3 class="text-lg font-semibold mb-4">Completa tu registro</h3>
    <p class="text-gray-600 mb-4">Revisa tu pedido antes de continuar.</p>
    <div class="border p-4 rounded-lg mb-4">
      <p class="text-lg font-bold">Total a pagar:</p>
      <p class="text-xl" :class="{ 'text-green-600': totalAmount > 0, 'text-blue-600': totalAmount === 0 }">
        {{ totalAmount > 0 ? `$${totalAmount.toLocaleString("es-ES")}` : "Evento gratuito" }}
      </p>
    </div>
    <a
      :href="getPaymentLink()"
      class="bg-black text-white px-6 py-2 rounded-md inline-block"
    >
      {{ totalAmount > 0 ? "Ir a pagar" : "Finalizar registro" }}
    </a>
  </div>
</template>
