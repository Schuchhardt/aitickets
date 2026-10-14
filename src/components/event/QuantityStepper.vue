<script setup>
// Stepper de cantidad (A8: el número sale hacia arriba y entra el nuevo desde abajo, o al revés al restar).
import { ref, watch } from "vue";

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 10 },
  // "una entrada General": se usa en los aria-label ("Agregar una entrada General")
  itemLabel: { type: String, default: "una entrada" },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue", "limit"]);

const direction = ref("up");
watch(
  () => props.modelValue,
  (next, prev) => {
    direction.value = next >= prev ? "up" : "down";
  },
);

const showLimit = ref(false);
let limitTimer = null;

function change(delta) {
  const next = props.modelValue + delta;
  if (next < props.min) return;
  if (next > props.max) {
    showLimit.value = true;
    clearTimeout(limitTimer);
    limitTimer = setTimeout(() => (showLimit.value = false), 2000);
    emit("limit");
    return;
  }
  emit("update:modelValue", next);
}
</script>

<template>
  <div class="stepper" role="group" :aria-label="`Cantidad de ${itemLabel.replace(/^una? /, '')}`">
    <button
      type="button"
      class="stepper-btn"
      :disabled="disabled || modelValue <= min"
      :aria-label="`Quitar ${itemLabel}`"
      @click="change(-1)"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
    </button>
    <span class="stepper-value ev-tabular" aria-live="polite">
      <Transition :name="`num-${direction}`" mode="out-in">
        <span :key="modelValue" class="stepper-num">{{ modelValue }}</span>
      </Transition>
    </span>
    <span class="stepper-plus-wrap">
      <button
        type="button"
        class="stepper-btn stepper-plus"
        :disabled="disabled"
        :aria-disabled="modelValue >= max ? 'true' : undefined"
        :class="{ 'is-maxed': modelValue >= max }"
        :aria-label="`Agregar ${itemLabel}`"
        @click="change(1)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
      <Transition name="tip">
        <span v-if="showLimit" class="stepper-tip" role="status">Máximo {{ max }} por compra</span>
      </Transition>
    </span>
  </div>
</template>

<style scoped>
.stepper {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.stepper-btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  background: var(--surface-0);
  color: var(--text-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color var(--dur-1), transform var(--dur-1) var(--ease-out), opacity var(--dur-2);
  position: relative;
}
/* Objetivo táctil ≥ 44 px sin agrandar el botón */
.stepper-btn::after {
  content: "";
  position: absolute;
  inset: -4px;
}
.stepper-btn:hover:not(:disabled) {
  border-color: var(--text-1);
}
.stepper-btn:active:not(:disabled) {
  transform: scale(0.94);
}
/* "+" activo en negro: es la acción principal de la fila */
.stepper-plus:not(:disabled):not(.is-maxed) {
  background: var(--text-1);
  border-color: var(--text-1);
  color: #fff;
}
.stepper-plus:hover:not(:disabled):not(.is-maxed) {
  background: #2a2a2f;
}
.stepper-btn:disabled,
.stepper-btn.is-maxed {
  opacity: 0.35;
  cursor: not-allowed;
}
.stepper-btn:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}
.stepper-value {
  width: 28px;
  height: 24px;
  overflow: hidden;
  display: inline-flex;
  justify-content: center;
  font-weight: 600;
  font-size: 16px;
  line-height: 24px;
}
.stepper-num {
  display: inline-block;
}
.stepper-plus-wrap {
  position: relative;
  display: inline-flex;
}
.stepper-tip {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  white-space: nowrap;
  background: var(--text-1);
  color: #fff;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  z-index: 5;
}
.num-up-enter-active,
.num-up-leave-active,
.num-down-enter-active,
.num-down-leave-active {
  transition: transform var(--dur-2) var(--ease-out), opacity var(--dur-2) var(--ease-out);
}
.num-up-enter-from { transform: translateY(60%); opacity: 0; }
.num-up-leave-to { transform: translateY(-60%); opacity: 0; }
.num-down-enter-from { transform: translateY(-60%); opacity: 0; }
.num-down-leave-to { transform: translateY(60%); opacity: 0; }
.tip-enter-active,
.tip-leave-active {
  transition: opacity var(--dur-2);
}
.tip-enter-from,
.tip-leave-to {
  opacity: 0;
}
</style>
