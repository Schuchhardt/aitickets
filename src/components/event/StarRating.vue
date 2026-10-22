<script setup>
// Estrellas de calificación: solo lectura (promedio con fracción, p. ej. 4,6) o para elegir de 1 a 5 (radiogroup
// accesible: flechas del teclado, hover con vista previa y la etiqueta "Excelente", "Muy bueno"...).
import { computed, ref } from "vue";
import { RATING_LABELS } from "../../../netlify/lib/reviews.mjs";

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  readonly: { type: Boolean, default: true },
  size: { type: Number, default: 18 },
  label: { type: String, default: "Calificación" },
  showLabel: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue"]);

const hover = ref(0);
const shown = computed(() => (props.readonly ? Number(props.modelValue) || 0 : hover.value || Number(props.modelValue) || 0));
const pct = computed(() => Math.max(0, Math.min(100, (shown.value / 5) * 100)));
const caption = computed(() => RATING_LABELS[Math.round(shown.value)] || "");

const buttons = ref([]);
function pick(n) {
  emit("update:modelValue", n);
}
function onKey(e, n) {
  let next = null;
  if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, n + 1);
  else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, n - 1);
  if (next == null) return;
  e.preventDefault();
  pick(next);
  buttons.value[next - 1]?.focus();
}
const STAR = "M12 2.5l2.94 6.06 6.66.92-4.85 4.66 1.18 6.62L12 17.6l-5.93 3.16 1.18-6.62L2.4 9.48l6.66-.92L12 2.5z";
</script>

<template>
  <span v-if="readonly" class="stars" :style="{ '--s': `${size}px` }" role="img" :aria-label="`${label}: ${shown.toLocaleString('es-CL')} de 5 estrellas`">
    <span class="row base" aria-hidden="true">
      <svg v-for="i in 5" :key="i" viewBox="0 0 24 24"><path :d="STAR" /></svg>
    </span>
    <span class="row fill" :style="{ width: `${pct}%` }" aria-hidden="true">
      <svg v-for="i in 5" :key="i" viewBox="0 0 24 24"><path :d="STAR" /></svg>
    </span>
  </span>
  <div v-else class="picker">
    <div class="picker-row" role="radiogroup" :aria-label="label" @mouseleave="hover = 0">
      <button
        v-for="n in 5"
        :key="n"
        :ref="(el) => (buttons[n - 1] = el)"
        type="button"
        role="radio"
        class="pick"
        :class="{ 'is-on': n <= shown }"
        :style="{ '--s': `${size}px` }"
        :aria-checked="modelValue === n"
        :aria-label="`${n} ${n === 1 ? 'estrella' : 'estrellas'}: ${RATING_LABELS[n]}`"
        :tabindex="(modelValue || 1) === n ? 0 : -1"
        :data-testid="`star-${n}`"
        @click="pick(n)"
        @mouseenter="hover = n"
        @keydown="onKey($event, n)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="STAR" /></svg>
      </button>
    </div>
    <p v-if="showLabel" class="caption" aria-live="polite">{{ caption || "Toca una estrella" }}</p>
  </div>
</template>

<style scoped>
.stars {
  position: relative;
  display: inline-block;
  line-height: 0;
  vertical-align: middle;
}
.row {
  display: inline-flex;
  gap: 2px;
  white-space: nowrap;
}
.row svg {
  width: var(--s);
  height: var(--s);
  flex: 0 0 auto;
}
.base svg {
  fill: var(--surface-2);
}
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  overflow: hidden;
}
.fill svg {
  fill: #f5b301;
}
.picker {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.picker-row {
  display: inline-flex;
  gap: 4px;
}
.pick {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--s) + 12px);
  height: calc(var(--s) + 12px);
  border-radius: var(--r-sm);
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: transform var(--dur-1) var(--ease-out);
  -webkit-tap-highlight-color: transparent;
}
.pick svg {
  width: var(--s);
  height: var(--s);
  fill: var(--surface-2);
  stroke: rgba(0, 0, 0, 0.12);
  stroke-width: 0.6;
  transition: fill var(--dur-1) var(--ease-out);
}
.pick.is-on svg {
  fill: #f5b301;
  stroke: #d99a00;
}
.pick:hover {
  transform: scale(1.12);
}
.pick:active {
  transform: scale(0.94);
}
.pick:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--brand-lime);
}
.caption {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-2);
  min-height: 20px;
}
@media (prefers-reduced-motion: reduce) {
  .pick {
    transition: none;
  }
}
</style>
