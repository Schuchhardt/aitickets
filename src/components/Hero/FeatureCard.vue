<template>
    <div
      class="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-6 hover:transform hover:-translate-y-1 transition-all duration-300 hover:bg-white/10"
    >
      <div class="flex items-center mb-4">
        <div class="flex items-center justify-center bg-ait-accent/20 w-10 h-10 rounded-full mr-4">
          <component :is="icon" class="h-5 w-5 text-ait-accent" />
        </div>
        <h3 class="text-white text-lg font-semibold font-['Unbounded']">{{ title }}</h3>
      </div>
      <p class="text-white/70 text-sm font-['Prompt']">
        {{ text }}
      </p>
    </div>
  </template>
  
  <script setup>
  import { defineProps } from 'vue';
  
  const props = defineProps({
    icon: { type: [Object, Function], required: true },
    title: { type: String, required: true },
    text: { type: String, required: true }
  });
  </script>