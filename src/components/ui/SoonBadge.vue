<script setup>
// Etiqueta "Pronto" del rediseño: marca lo que todavía no existe en el producto (backend, API o BD) para no mostrarlo
// nunca como si funcionara. Pill gris de 12 px; `dark` para fondos oscuros. Sirve también en Astro sin hidratar.
defineProps({
  dark: { type: Boolean, required: false },
})
</script>

<template>
  <span class="soon" :class="{ 'soon-dark': dark }" data-testid="soon-badge">Pronto</span>
</template>

<style scoped>
.soon {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  color: var(--text-2);
  font-family: "Prompt", system-ui, sans-serif;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0;
  text-transform: none;
  white-space: nowrap;
  vertical-align: middle;
}
.soon-dark {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.78);
}
</style>
