<script setup>
// Contenedor que anima su alto cuando cambia el contenido (A18: la card pasa del formulario al éxito sin
// saltos). Mide con ResizeObserver y transiciona `height`; con prefers-reduced-motion cambia de inmediato.
import { ref, onMounted, onBeforeUnmount } from "vue";

const inner = ref(null);
const height = ref(null);
let observer = null;

onMounted(() => {
  if (!inner.value || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(([entry]) => {
    height.value = Math.ceil(entry.target.getBoundingClientRect().height);
  });
  observer.observe(inner.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div class="auto-height" :style="height !== null ? { height: `${height}px` } : null">
    <div ref="inner" class="auto-height-inner"><slot /></div>
  </div>
</template>

<style scoped>
.auto-height {
  overflow: hidden;
  transition: height var(--dur-3) var(--ease-in-out);
  /* El foco visible de los controles no se corta en los bordes */
  margin: -8px;
  padding: 8px;
  box-sizing: content-box;
}
.auto-height-inner {
  position: relative;
}
</style>
