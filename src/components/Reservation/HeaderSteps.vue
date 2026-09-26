<script setup>
defineProps({
  currentStep: Number,
  eventName: String,
});

const emit = defineEmits(["close"]);
</script>

<template>
  <div class="relative flex flex-col p-4 border-b w-full">
    <!-- Botón de Cerrar -->
    <button @click="emit('close')" aria-label="Cerrar" class="absolute right-3 top-3 w-10 h-10 text-gray-600 hover:text-black text-2xl cursor-pointer">
      ✕
    </button>

    <!-- Título -->
    <h2 class="text-lg md:text-xl font-bold text-center w-full px-10 py-2 md:p-4 break-words">{{ eventName }}</h2>

    <!-- Pasos -->
    <div class="flex justify-between w-full mt-2 md:mt-0 gap-2">
      <div class="text-gray-500 text-xs md:text-sm text-center md:text-end font-[Prompt]" :class="{ 'text-black font-bold': currentStep === 1, 'font-normal': currentStep !== 1 }">
        1. Entradas
      </div>
      <span class="hidden md:block text-gray-400">→</span>
      <div class="text-gray-500 text-xs md:text-sm text-center font-[Prompt]" :class="{ 'text-black font-bold': currentStep === 2, 'font-normal': currentStep !== 2 }">
        2. Tus datos
      </div>
      <span class="hidden md:block text-gray-400">→</span>
      <div class="text-gray-500 text-xs md:text-sm text-center md:text-start font-[Prompt]" :class="{ 'text-black font-bold': currentStep === 3, 'font-normal': currentStep !== 3 }">
        3. Confirmar
      </div>
    </div>
  </div>
</template>
