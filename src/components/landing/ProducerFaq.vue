<script setup>
import { Plus } from 'lucide-vue-next'

defineProps({
  items: { type: Array, required: true }, // [{ q, a }]
  title: { type: String, required: false },
})
</script>

<template>
  <section class="py-24 font-[Prompt] bg-white text-gray-900">
    <div class="container mx-auto px-4 md:px-8 max-w-3xl">
      <h2 class="text-3xl md:text-4xl font-bold mb-10 font-[Unbounded] text-center">{{ title || 'Preguntas frecuentes' }}</h2>
      <div class="divide-y divide-gray-200 border-y border-gray-200">
        <details v-for="item in items" :key="item.q" class="group py-5">
          <summary class="flex cursor-pointer list-none items-start justify-between gap-4 font-semibold">
            <span>{{ item.q }}</span>
            <Plus class="h-5 w-5 shrink-0 transition-transform group-open:rotate-45" />
          </summary>
          <p class="mt-3 text-sm leading-relaxed text-gray-600">{{ item.a }}</p>
        </details>
      </div>
    </div>
  </section>
</template>
