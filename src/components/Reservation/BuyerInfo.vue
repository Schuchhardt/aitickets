<script setup>
import { defineEmits, defineProps } from "vue";

const props = defineProps({
  buyerInfo: Object,
});
const emit = defineEmits(["update:buyerInfo"]);

const updateBuyerInfo = (field, value) => {
  const updated = { ...props.buyerInfo, [field]: value };
  emit("update:buyerInfo", updated);
};
</script>

<template>
  <div class="font-[Prompt] p-4">
    <h3 class="text-lg font-semibold mb-4">Información de los tickets</h3>
    <p class="text-gray-600 mb-4">Información del comprador</p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <input
        :value="props.buyerInfo.firstName"
        @input="updateBuyerInfo('firstName', $event.target.value)"
        type="text"
        placeholder="Nombre*"
        class="border p-2 rounded-md w-full col-span-2"
        required
      />
      <input
        :value="props.buyerInfo.lastName"
        @input="updateBuyerInfo('lastName', $event.target.value)"
        type="text"
        placeholder="Apellidos*"
        class="border p-2 rounded-md w-full col-span-2"
        required
      />
      <input
        :value="props.buyerInfo.email"
        @input="updateBuyerInfo('email', $event.target.value)"
        type="email"
        placeholder="Correo electrónico*"
        class="border p-2 rounded-md w-full col-span-2"
        required
      />
      <input
        :value="props.buyerInfo.confirmEmail"
        @input="updateBuyerInfo('confirmEmail', $event.target.value)"
        type="email"
        placeholder="Confirmar correo electrónico*"
        class="border p-2 rounded-md w-full col-span-2"
        required
      />
      <div class="flex items-center border p-2 rounded-md w-full col-span-2">
        <input
          :value="props.buyerInfo.phone"
          @input="updateBuyerInfo('phone', $event.target.value)"
          type="tel"
          name="phone"
          placeholder="+56 9 12 345 678*"
          class="w-full"
          required
        />
      </div>
    </div>
    <div class="flex items-center mt-4">
      <input
        :checked="props.buyerInfo.termsAccepted"
        @change="updateBuyerInfo('termsAccepted', $event.target.checked)"
        type="checkbox"
        class="mr-3 cursor-pointer w-10 h-10 accent-black"
        required
      />
      <label class="text-gray-600 text-sm leading-5">
        Acepto los
        <a href="/terms" class="text-black underline font-medium" target="_blank">Términos del Servicio</a>
        y
        <a href="/privacy" class="text-black underline font-medium" target="_blank">Políticas de Privacidad</a>
        <span class="text-red-500"> (Requerido)</span>
      </label>
    </div>
  </div>
</template>
