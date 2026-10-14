<script setup>
// Barra inferior en mobile (§4.6): monto final + una sola acción. Aparece con slide-up (A20).
defineProps({
  visible: { type: Boolean, default: false },
  price: { type: String, default: "" },
  note: { type: String, default: "" },
  noteWarning: { type: Boolean, default: false },
  cta: { type: String, required: true },
});
const emit = defineEmits(["action"]);
</script>

<template>
  <Transition name="bar">
    <div v-if="visible" class="bar ev-motion" data-testid="mobile-sticky-bar">
      <div class="bar-info">
        <p class="bar-price ev-tabular">{{ price }}</p>
        <p v-if="note" class="bar-note" :class="{ 'is-warning': noteWarning }">{{ note }}</p>
      </div>
      <button type="button" class="ev-btn ev-btn-primary bar-cta" @click="emit('action')">{{ cta }}</button>
    </div>
  </Transition>
</template>

<style scoped>
/* Sticky dentro de .ev-page (EventDetail.vue): flota abajo mientras se recorre el evento y se detiene al
   final de la página, antes del footer (fixed se montaba sobre el newsletter del footer) */
.bar {
  position: sticky;
  bottom: 0;
  z-index: 40;
  min-height: 72px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.92);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-family: "Prompt", system-ui, sans-serif;
}
.bar-info {
  min-width: 0;
}
.bar-price {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 17px;
  line-height: 22px;
  font-weight: 700;
  color: var(--text-1);
  white-space: nowrap;
}
.bar-note {
  font-size: 12px;
  line-height: 16px;
  color: var(--text-2);
}
.bar-note.is-warning {
  color: var(--warning-text);
}
.bar-cta {
  min-width: 160px;
  flex: 0 0 auto;
}
.bar-enter-active {
  transition: transform var(--dur-3) var(--ease-out);
}
.bar-leave-active {
  transition: transform 240ms var(--ease-in-out);
}
.bar-enter-from,
.bar-leave-to {
  transform: translateY(100%);
}
@media (min-width: 1024px) {
  .bar {
    display: none;
  }
}
</style>
