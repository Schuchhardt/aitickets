<script setup>
// Skeleton para lo que el panel carga en el navegador (en vez de "Cargando…"). Usa .ait-skeleton de
// DashboardLayout.astro. variant: "list" (filas con avatar y acción), "lines" (texto) o "media" (miniaturas).
defineProps({
  rows: { type: Number, default: 3 },
  variant: { type: String, default: 'list' },
  label: { type: String, default: 'Cargando' },
})
</script>

<template>
  <div role="status" :aria-label="label" aria-live="polite">
    <span class="sr-only">{{ label }}…</span>
    <div v-if="variant === 'media'" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3" aria-hidden="true">
      <div v-for="i in rows" :key="i" class="ait-skeleton aspect-square rounded-lg"></div>
    </div>
    <div v-else-if="variant === 'lines'" class="space-y-2.5" aria-hidden="true">
      <div
        v-for="i in rows"
        :key="i"
        class="ait-skeleton h-3.5 rounded-md"
        :class="i === rows ? 'w-2/3' : i % 2 ? 'w-full' : 'w-5/6'"
      ></div>
    </div>
    <div v-else class="divide-y divide-gray-50" aria-hidden="true">
      <div v-for="i in rows" :key="i" class="flex items-center gap-3 py-3">
        <div class="ait-skeleton h-9 w-9 rounded-full shrink-0"></div>
        <div class="flex-1 min-w-0 space-y-2">
          <div class="ait-skeleton h-3.5 rounded-md" :class="i % 2 ? 'w-1/2' : 'w-2/5'"></div>
          <div class="ait-skeleton h-3 rounded-md w-1/4"></div>
        </div>
        <div class="ait-skeleton h-8 w-20 rounded-lg shrink-0"></div>
      </div>
    </div>
  </div>
</template>
