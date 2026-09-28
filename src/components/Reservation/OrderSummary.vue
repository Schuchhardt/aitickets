<script setup>
import { ref, computed } from "vue";
import { SERVICE_FEE_LABEL, SERVICE_FEE_TAX_LABEL, buildSelectedLines, computeTotals, formatCLP } from "./pricing.js";

const props = defineProps({
  selectedTickets: Object,
  event: Object,
});

// TODO: cupones de descuento. /api/discount-code no existe todavía y el servidor no aplica descuentos,
// así que la UI queda oculta (no se renderiza) y el descuento NO se resta del total mostrado.
const SHOW_DISCOUNT_CODE = false;
const discountCode = ref("");
const appliedDiscount = ref(false);
const discountPercentage = ref(0);
const errorMessage = ref("");

const selectedTicketList = computed(() => buildSelectedLines(props.selectedTickets, props.event?.tickets, props.event?.dates));
const totals = computed(() => computeTotals(selectedTicketList.value));

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

    <template v-if="SHOW_DISCOUNT_CODE">
      <div class="flex items-center mb-2" v-if="selectedTicketList.length !== 0 && totals.subtotal > 0">
        <input v-model="discountCode" type="text" placeholder="Código de descuento" class="border p-2 rounded-md w-full mr-2" />
        <button class="bg-gray-400 text-white px-4 py-2 rounded-md" :disabled="appliedDiscount || !discountCode" @click="applyDiscount">
          Aplicar
        </button>
      </div>
      <p v-if="errorMessage" class="text-red-500 text-sm">{{ errorMessage }}</p>
    </template>

    <p v-if="selectedTicketList.length === 0" class="text-gray-500 text-sm mb-4">
      Elige un tipo de entrada para continuar.
    </p>
    <ul v-else class="mb-4 space-y-1">
      <li v-for="ticket in selectedTicketList" :key="ticket.id" class="flex justify-between gap-2">
        <span>
            {{ ticket.quantity }} x {{ ticket.name }}
            <span v-if="ticket.functionLabel" class="block text-xs text-gray-500">{{ ticket.functionLabel }}</span>
          </span>
        <span class="font-medium whitespace-nowrap">{{ ticket.total > 0 ? formatCLP(ticket.total) : "Gratis" }}</span>
      </li>
    </ul>

    <div v-if="selectedTicketList.length" class="text-sm text-gray-600 border-t pt-2 space-y-1">
      <div class="flex justify-between">
        <span>Subtotal</span>
        <span>{{ totals.subtotal > 0 ? formatCLP(totals.subtotal) : "Gratis" }}</span>
      </div>
      <div v-if="totals.subtotal > 0" class="flex justify-between">
        <span>{{ SERVICE_FEE_LABEL }}</span>
        <span>{{ formatCLP(totals.feeNet) }}</span>
      </div>
      <div v-if="totals.feeIva > 0" class="flex justify-between">
        <span>{{ SERVICE_FEE_TAX_LABEL }}</span>
        <span>{{ formatCLP(totals.feeIva) }}</span>
      </div>
    </div>
    <div v-if="selectedTicketList.length" class="flex justify-between font-bold border-t pt-2 mt-2">
      <span>Total ({{ totals.quantity }} entrada<span v-if="totals.quantity > 1">s</span>)</span>
      <span>{{ totals.total > 0 ? `${formatCLP(totals.total)} CLP` : "Gratis" }}</span>
    </div>
  </div>
</template>
