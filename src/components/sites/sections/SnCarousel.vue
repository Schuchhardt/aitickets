<script setup>
// Carrusel con scroll-snap (se desliza con el dedo) y flechas (src/lib/siteInteractions.js). Cada hijo del slot es
// una diapositiva.
defineProps({
  label: { type: String, default: "Carrusel" },
  /** Clase de ancho de las diapositivas: sn-carousel--full (una a la vez), --cards (varias). */
  variant: { type: String, default: "cards" },
});
</script>

<template>
  <div class="sn-carousel" :class="`sn-carousel--${variant}`" data-sn-carousel role="region" :aria-label="label" aria-roledescription="carrusel">
    <div class="sn-carousel-track" tabindex="0">
      <slot />
    </div>
    <div class="sn-carousel-nav">
      <button type="button" class="sn-carousel-btn" data-sn-prev aria-label="Anterior" disabled>‹</button>
      <button type="button" class="sn-carousel-btn" data-sn-next aria-label="Siguiente">›</button>
    </div>
  </div>
</template>
