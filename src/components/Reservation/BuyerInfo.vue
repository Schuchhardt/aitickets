<script setup>
import { defineEmits, ref, computed } from "vue";

const emit = defineEmits(["update:buyerInfo"]);
const buyerInfo = ref({
  firstName: "",
  lastName: "",
  email: "",
  confirmEmail: "",
  phone: "",
  country: "Chile",
  termsAccepted: false,
});

const updateBuyerInfo = (field, value) => {
  buyerInfo.value[field] = value;
  emit("update:buyerInfo", buyerInfo.value);
};

const isChile = computed(() => buyerInfo.value.country === "Chile");
</script>

<template>
  <div>
    <h3 class="text-lg font-semibold mb-4">Información de los tickets</h3>
    <p class="text-gray-600 mb-4">Información del comprador</p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <input
        v-model="buyerInfo.firstName"
        @input="updateBuyerInfo('firstName', $event.target.value)"
        type="text"
        placeholder="Nombre*"
        class="border p-2 rounded-md w-full"
        required
      />
      <input
        v-model="buyerInfo.lastName"
        @input="updateBuyerInfo('lastName', $event.target.value)"
        type="text"
        placeholder="Apellidos*"
        class="border p-2 rounded-md w-full"
        required
      />
      <input
        v-model="buyerInfo.email"
        @input="updateBuyerInfo('email', $event.target.value)"
        type="email"
        placeholder="Correo electrónico*"
        class="border p-2 rounded-md w-full col-span-2"
        required
      />
      <input
        v-model="buyerInfo.confirmEmail"
        @input="updateBuyerInfo('confirmEmail', $event.target.value)"
        type="email"
        placeholder="Confirmar correo electrónico*"
        class="border p-2 rounded-md w-full col-span-2"
        required
      />
      <div v-if="isChile" class="flex items-center border p-2 rounded-md w-full col-span-2">
        <!-- <span class="mr-2">🇨🇱 +56</span> -->
        <input
          v-model="buyerInfo.phone"
          @input="updateBuyerInfo('phone', $event.target.value)"
          type="tel"
          placeholder="9 12 345 678"
          class="w-full"
          required
        />
      </div>
      <div v-else class="border p-2 rounded-md w-full col-span-2">
        <input
          v-model="buyerInfo.phone"
          @input="updateBuyerInfo('phone', $event.target.value)"
          type="tel"
          placeholder="Teléfono"
          class="w-full"
          required
        />
      </div>
      <select
        v-model="buyerInfo.country"
        @change="updateBuyerInfo('country', $event.target.value)"
        class="border p-2 rounded-md w-full col-span-2"
      >
        <option>Chile</option>
        <option>Otro</option>
      </select>
    </div>
    <div class="flex items-center mt-4">
      <input
        v-model="buyerInfo.termsAccepted"
        @change="updateBuyerInfo('termsAccepted', $event.target.checked)"
        type="checkbox"
        class="mr-2"
        required
      />
      <label class="text-gray-600 text-sm">
        Acepto los
        <a href="/terms" class="text-blue-600 underline">Términos del Servicio</a>
        y
        <a href="/privacy" class="text-blue-600 underline">Políticas de Privacidad</a>
        <span class="text-red-500">(Requerido)</span>
      </label>
    </div>
  </div>
</template>
