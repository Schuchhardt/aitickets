<script setup>
// A19: círculo lima que aparece con micro-rebote y luego se traza el check.
defineProps({ size: { type: Number, default: 52 } });
</script>

<template>
  <div class="success-check" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <svg :width="size * 0.46" :height="size * 0.46" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path class="success-check-path" d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  </div>
</template>

<style scoped>
.success-check {
  border-radius: 50%;
  background: var(--brand-lime);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ev-pop 320ms var(--ease-spring) both;
}
.success-check-path {
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
  animation: ev-draw 240ms var(--ease-out) 160ms forwards;
}
</style>
