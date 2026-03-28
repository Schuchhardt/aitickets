<script setup>
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: "" },
});
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
    <div class="mb-4">
      <h3 class="font-bold text-lg text-gray-900">{{ title }}</h3>
      <p v-if="subtitle" class="text-sm text-gray-500 mt-1">{{ subtitle }}</p>
    </div>
    <slot />
  </div>
</template>
