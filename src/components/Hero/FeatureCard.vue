<template>
    <div
      ref="card"
      class="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-6 transition-all duration-300 shadow-[0_4px_20px_rgba(255,255,255,0.05)] hover:-translate-y-1 hover:bg-white/20 hover:border-white/40 hover:shadow-[0_6px_24px_rgba(255,255,255,0.08)]"
      @mouseenter="triggerAnimation"
    >
      <div class="flex items-center mb-4">
        <div class="flex items-center justify-center bg-lime-400/20 w-10 h-10 rounded-full mr-4">
          <component :is="icon" class="h-5 w-5 text-lime-400" />
        </div>
        <h3 class="text-white text-lg font-semibold font-['Unbounded']">{{ title }}</h3>
      </div>
      <p class="text-white/90 text-sm font-['Prompt']">
        {{ text }}
      </p>
    </div>
  </template>
  
  <script setup>
  import { defineProps, ref } from 'vue';
  
  const props = defineProps({
    icon: { type: [Object, Function], required: true },
    title: { type: String, required: true },
    text: { type: String, required: true }
  });
  
  const card = ref(null);
  
  function triggerAnimation() {
    const el = card.value;
    if (!el) return;
  
    el.classList.remove('animate__animated', 'animate__pulse'); // Reset
    void el.offsetWidth; // Force reflow
    el.classList.add('animate__animated', 'animate__pulse');
  }
  </script>
  