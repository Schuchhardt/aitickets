<script setup>
import { onMounted, onBeforeUnmount, reactive } from 'vue';
import { toastBus } from '../../lib/toastBus.js';

const state = reactive({ list: [] });
let id = 0;

function push(message, type = 'info', ttl = 3000) {
  const item = { id: ++id, message, type, ttl };
  state.list.push(item);
  
  setTimeout(() => {
    const idx = state.list.findIndex(i => i.id === item.id);
    if (idx !== -1) state.list.splice(idx, 1);
  }, ttl);
}

function handler({ message, type = 'info', duration = 3000 }) {
  push(message, type, duration);
}

onMounted(() => toastBus.on('toast', handler));
onBeforeUnmount(() => toastBus.off('toast', handler));
</script>

<template>
  <div class="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
    <div
      v-for="t in state.list"
      :key="t.id"
      class="rounded-lg px-4 py-3 shadow-lg text-white animate-slideInUp pointer-events-auto min-w-[280px] max-w-md"
      :class="{
        'bg-lime-600': t.type === 'success',
        'bg-red-600': t.type === 'error',
        'bg-gray-800': t.type === 'info',
      }"
      role="status" 
      aria-live="polite"
    >
      <div class="flex items-start gap-2">
        <!-- Iconos según el tipo -->
        <svg 
          v-if="t.type === 'success'" 
          class="w-5 h-5 flex-shrink-0 mt-0.5" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
        </svg>
        
        <svg 
          v-else-if="t.type === 'error'" 
          class="w-5 h-5 flex-shrink-0 mt-0.5" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
        
        <svg 
          v-else 
          class="w-5 h-5 flex-shrink-0 mt-0.5" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        
        <span class="flex-1 text-sm font-medium font-[Prompt]">{{ t.message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes slideInUp { 
  from { 
    transform: translateY(12px); 
    opacity: 0; 
  } 
  to { 
    transform: translateY(0); 
    opacity: 1; 
  } 
}
.animate-slideInUp { 
  animation: slideInUp 0.18s ease-out; 
}
</style>
