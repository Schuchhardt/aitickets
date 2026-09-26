<script setup>
import { computed } from "vue";
import { isValidEmail } from "./pricing.js";
import { LEGAL } from "../../lib/legal";

const props = defineProps({
  buyerInfo: Object,
});
const emit = defineEmits(["update:buyerInfo"]);

const updateBuyerInfo = (field, value) => {
  const updated = { ...props.buyerInfo, [field]: value };
  emit("update:buyerInfo", updated);
};

const emailError = computed(() => {
  const email = (props.buyerInfo.email || "").trim();
  return email && !isValidEmail(email) ? "Revisa el formato del correo." : "";
});

const confirmEmailError = computed(() => {
  const email = (props.buyerInfo.email || "").trim().toLowerCase();
  const confirm = (props.buyerInfo.confirmEmail || "").trim().toLowerCase();
  return confirm && email !== confirm ? "Los correos no coinciden." : "";
});
</script>

<template>
  <div class="font-[Prompt] p-4">
    <h3 class="text-lg font-semibold mb-1">Información del comprador</h3>
    <p class="text-gray-600 text-sm mb-4">Te enviaremos las entradas a este correo.</p>
    <div class="grid grid-cols-1 gap-3">
      <label class="block">
        <span class="sr-only">Nombre</span>
        <input
          :value="props.buyerInfo.firstName"
          @input="updateBuyerInfo('firstName', $event.target.value)"
          type="text"
          name="given-name"
          autocomplete="given-name"
          maxlength="80"
          placeholder="Nombre*"
          class="border p-3 rounded-md w-full text-base"
          required
        />
      </label>
      <label class="block">
        <span class="sr-only">Apellidos</span>
        <input
          :value="props.buyerInfo.lastName"
          @input="updateBuyerInfo('lastName', $event.target.value)"
          type="text"
          name="family-name"
          autocomplete="family-name"
          maxlength="80"
          placeholder="Apellidos*"
          class="border p-3 rounded-md w-full text-base"
          required
        />
      </label>
      <label class="block">
        <span class="sr-only">Correo electrónico</span>
        <input
          :value="props.buyerInfo.email"
          @input="updateBuyerInfo('email', $event.target.value)"
          type="email"
          name="email"
          autocomplete="email"
          inputmode="email"
          maxlength="254"
          placeholder="Correo electrónico*"
          class="border p-3 rounded-md w-full text-base"
          :class="{ 'border-red-500': emailError }"
          required
        />
        <span v-if="emailError" class="text-red-600 text-xs">{{ emailError }}</span>
      </label>
      <label class="block">
        <span class="sr-only">Confirmar correo electrónico</span>
        <input
          :value="props.buyerInfo.confirmEmail"
          @input="updateBuyerInfo('confirmEmail', $event.target.value)"
          type="email"
          name="email-confirm"
          autocomplete="off"
          inputmode="email"
          maxlength="254"
          placeholder="Confirmar correo electrónico*"
          class="border p-3 rounded-md w-full text-base"
          :class="{ 'border-red-500': confirmEmailError }"
          required
        />
        <span v-if="confirmEmailError" class="text-red-600 text-xs">{{ confirmEmailError }}</span>
      </label>
      <label class="block">
        <span class="sr-only">Teléfono (opcional)</span>
        <input
          :value="props.buyerInfo.phone"
          @input="updateBuyerInfo('phone', $event.target.value)"
          type="tel"
          name="phone"
          autocomplete="tel"
          maxlength="30"
          placeholder="Teléfono (opcional) +56 9 1234 5678"
          class="border p-3 rounded-md w-full text-base"
        />
      </label>
    </div>
    <div class="flex items-start mt-4">
      <input
        id="terms-accepted"
        data-testid="resv-terms-checkbox"
        :checked="props.buyerInfo.termsAccepted"
        @change="updateBuyerInfo('termsAccepted', $event.target.checked)"
        type="checkbox"
        class="mr-3 mt-0.5 cursor-pointer w-5 h-5 shrink-0 accent-black"
        aria-describedby="terms-retracto"
        required
      />
      <label for="terms-accepted" class="text-gray-600 text-sm leading-5">
        Acepto los
        <a href="/terms" class="text-black underline font-medium" target="_blank" rel="noopener">Términos y Condiciones</a>
        y la
        <a href="/privacy" class="text-black underline font-medium" target="_blank" rel="noopener">Política de Privacidad</a>,
        y entiendo que esta compra no tiene derecho de retracto.
        <span class="text-red-500"> (Requerido)</span>
      </label>
    </div>
    <p id="terms-retracto" class="text-xs text-gray-500 mt-2 ml-8 leading-4">{{ LEGAL.retractoNotice }}</p>
  </div>
</template>
