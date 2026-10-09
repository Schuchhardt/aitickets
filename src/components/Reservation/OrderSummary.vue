<script setup>
import { ref, computed } from "vue";
import {
  FEE_INCLUDED_NOTE,
  SERVICE_FEE_LABEL,
  SERVICE_FEE_TAX_LABEL,
  buildSelectedLines,
  isFeeAbsorbed,
  computeTotalsWithDiscount,
  discountLineLabel,
  formatCLP,
  normalizeDiscountCode,
} from "./pricing.js";

const props = defineProps({
  selectedTickets: Object,
  event: Object,
  // Código aplicado: { code, kind, value, label } o null (lo guarda ReservationModal)
  discount: { type: Object, default: null },
});
const emit = defineEmits(["update:discount"]);

const discountCode = ref("");
const errorMessage = ref("");
const applying = ref(false);

const selectedTicketList = computed(() => buildSelectedLines(props.selectedTickets, props.event?.tickets, props.event?.dates));
const totals = computed(() => computeTotalsWithDiscount(selectedTicketList.value, props.discount, { feeAbsorbed: isFeeAbsorbed(props.event) }));
// La demo no valida códigos (no hay compra real)
const canUseDiscount = computed(() => !props.event?.is_demo && selectedTicketList.value.length > 0 && totals.value.grossSubtotal > 0);

const applyDiscount = async () => {
  errorMessage.value = "";
  const code = normalizeDiscountCode(discountCode.value);
  if (!code) {
    errorMessage.value = "Ingresa un código válido (3 a 30 letras, números, guiones o guion bajo).";
    return;
  }
  applying.value = true;
  try {
    const response = await fetch("/api/discount-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: props.event.id,
        code,
        tickets: selectedTicketList.value.map((t) => ({ id: t.id, quantity: t.quantity })),
      }),
    });
    let data = {};
    try { data = await response.json(); } catch { /* sin cuerpo */ }
    if (!response.ok || !data.valid) {
      throw new Error(data.message || "El código de descuento no es válido o ha expirado.");
    }
    emit("update:discount", { code: data.code, kind: data.kind, value: data.value, label: data.label });
    discountCode.value = "";
  } catch (error) {
    errorMessage.value = error.message || "No pudimos validar el código. Intenta nuevamente.";
  } finally {
    applying.value = false;
  }
};

const removeDiscount = () => {
  errorMessage.value = "";
  emit("update:discount", null);
};
</script>

<template>
  <div class="border p-4 rounded-lg bg-gray-50 font-[Prompt]">
    <h3 class="font-semibold text-lg mb-2 text-center" v-if="selectedTicketList.length !== 0">Tu pedido</h3>

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

    <div v-if="canUseDiscount" class="mb-3">
      <div v-if="discount" class="flex items-center justify-between gap-2 text-sm bg-lime-50 border border-lime-200 rounded-md px-3 py-2">
        <span>
          Código <strong class="font-mono">{{ discount.code }}</strong> aplicado
          <span v-if="discount.label" class="text-gray-600">({{ discount.label }})</span>
        </span>
        <button type="button" class="text-gray-600 underline hover:text-black" data-testid="resv-discount-remove" @click="removeDiscount">Quitar</button>
      </div>
      <form v-else class="flex items-center gap-2" @submit.prevent="applyDiscount">
        <label for="resv-discount-code" class="sr-only">Código de descuento</label>
        <input
          id="resv-discount-code"
          v-model="discountCode"
          data-testid="resv-discount-input"
          type="text"
          maxlength="30"
          autocomplete="off"
          autocapitalize="characters"
          placeholder="Código de descuento"
          class="border p-2 rounded-md w-full text-base uppercase bg-white"
        />
        <button
          type="submit"
          data-testid="resv-discount-apply"
          class="px-4 py-2 rounded-md text-white whitespace-nowrap disabled:opacity-60"
          :class="discountCode ? 'bg-black' : 'bg-gray-400'"
          :disabled="applying || !discountCode"
        >
          {{ applying ? "..." : "Aplicar" }}
        </button>
      </form>
      <p v-if="errorMessage" class="text-red-600 text-sm mt-1" role="alert">{{ errorMessage }}</p>
    </div>

    <div v-if="selectedTicketList.length" class="text-sm text-gray-600 border-t pt-2 space-y-1">
      <div class="flex justify-between">
        <span>Subtotal</span>
        <span>{{ totals.grossSubtotal > 0 ? formatCLP(totals.grossSubtotal) : "Gratis" }}</span>
      </div>
      <div v-if="totals.discountAmount > 0" class="flex justify-between text-lime-700" data-testid="resv-discount-line">
        <span>{{ discountLineLabel(discount?.code) }}</span>
        <span>-{{ formatCLP(totals.discountAmount) }}</span>
      </div>
      <div v-if="totals.feeAbsorbed && totals.subtotal > 0" class="flex justify-between" data-testid="resv-fee-included">
        <span>{{ FEE_INCLUDED_NOTE }}</span>
        <span>Incluido</span>
      </div>
      <template v-else>
        <div v-if="totals.subtotal > 0" class="flex justify-between">
          <span>{{ SERVICE_FEE_LABEL }}</span>
          <span>{{ formatCLP(totals.feeNet) }}</span>
        </div>
        <div v-if="totals.feeIva > 0" class="flex justify-between">
          <span>{{ SERVICE_FEE_TAX_LABEL }}</span>
          <span>{{ formatCLP(totals.feeIva) }}</span>
        </div>
      </template>
    </div>
    <div v-if="selectedTicketList.length" class="flex justify-between font-bold border-t pt-2 mt-2">
      <span>Total ({{ totals.quantity }} entrada<span v-if="totals.quantity > 1">s</span>)</span>
      <span>{{ totals.total > 0 ? `${formatCLP(totals.total)} CLP` : "Gratis" }}</span>
    </div>
  </div>
</template>
