<script setup>
import { defineProps, defineEmits } from "vue";

const props = defineProps({
  currentStep: Number,
  eventName: String,
});

const emit = defineEmits(["close"]);
</script>

<template>
  <div class="relative flex flex-col p-4 border-b w-full">
    <!-- Botón de Cerrar -->
    <button @click="emit('close')" class="absolute right-4 top-4 text-gray-600 hover:text-black text-2xl cursor-pointer">
      ✕
    </button>

    <!-- Título -->
    <h2 class="text-xl font-bold text-center w-full p-4">{{ eventName }}</h2>

    <!-- Pasos -->
    <div class="flex justify-center md:justify-between w-full mt-4 md:mt-0 md:w-auto space-x-4 md:space-x-8">
      <div class="text-gray-500 text-sm md:text-base text-center font-[Prompt]" :class="{ 'text-black font-bold': currentStep === 1 }">
        Seleccionar tickets
      </div>
      <span class="hidden md:block text-gray-400">→</span>
      <div class="text-gray-500 text-sm md:text-base text-center font-[Prompt]" :class="{ 'text-black font-bold': currentStep === 2 }">
        Información de los tickets
      </div>
      <span class="hidden md:block text-gray-400">→</span>
      <div class="text-gray-500 text-sm md:text-base text-center font-[Prompt]" :class="{ 'text-black font-bold': currentStep === 3 }">
        Información de pago
      </div>
    </div>
  </div>
</template>