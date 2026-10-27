<script setup>
// Crossfader de la noche en vivo (SPEC_landing_clubs §1 y §4.5): <input type="range"> nativo con piel de mezclador de
// DJ. Riel horizontal con las horas en punto (Prompt 600 13 px: Doto no baja de 28 px), perilla rectangular de 28×44
// (44×52 en mobile) con una línea fluor al centro y la hora actual en Doto 28 px fluor sobre la perilla. Teclado nativo
// (flechas = 15 min, Home/End) y PageUp/PageDown = 1 h. Emite update:modelValue al mover y `release` al soltar (o en
// cada paso del teclado): ahí se anuncia el valor y se mide.
import { computed } from 'vue'
import { NIGHT_STEPS, stepTime } from './clubsLanding.js'

const props = defineProps({
  modelValue: { type: Number, required: true },
  valuetext: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue', 'release'])

/** Horas en punto: 22:00, 23:00 … 05:00 (cada 4 pasos) */
const marks = Array.from({ length: NIGHT_STEPS / 4 + 1 }, (_, i) => ({ step: i * 4, label: stepTime(i * 4) }))
const pct = computed(() => props.modelValue / NIGHT_STEPS)

function set(value, release = false) {
  const v = Math.max(0, Math.min(NIGHT_STEPS, value))
  emit('update:modelValue', v)
  if (release) emit('release', v)
}
function onKeydown(e) {
  if (e.key !== 'PageUp' && e.key !== 'PageDown') return
  e.preventDefault()
  set(props.modelValue + (e.key === 'PageUp' ? 4 : -4), true)
}
</script>

<template>
  <div class="cf" :style="{ '--p': pct }">
    <label for="cl-night-fader" class="lp-sr-only">Hora de la noche</label>
    <div class="cf-rail">
      <span class="cf-value" aria-hidden="true">{{ stepTime(props.modelValue) }}</span>
      <input
        id="cl-night-fader"
        type="range"
        class="cf-input"
        min="0"
        :max="NIGHT_STEPS"
        step="1"
        :value="props.modelValue"
        :aria-valuetext="props.valuetext"
        data-testid="club-night-fader"
        @input="set(Number($event.target.value))"
        @change="set(Number($event.target.value), true)"
        @keydown="onKeydown"
      />
    </div>
    <ol class="cf-marks" aria-hidden="true">
      <li v-for="m in marks" :key="m.step" :style="{ '--m': m.step / NIGHT_STEPS }">{{ m.label }}</li>
    </ol>
  </div>
</template>

<style scoped>
.cf {
  --thumb-w: 44px;
  --thumb-h: 52px;
  position: relative;
  padding: 44px calc(var(--thumb-w) / 2) 0;
}
.cf-rail {
  position: relative;
  margin-inline: calc(var(--thumb-w) / -2);
}
/* La hora actual, siempre sobre la perilla (y sin salirse del riel en los extremos) */
.cf-value {
  position: absolute;
  bottom: calc(100% + 4px);
  left: clamp(44px, calc(var(--thumb-w) / 2 + var(--p) * (100% - var(--thumb-w))), calc(100% - 44px));
  transform: translateX(-50%);
  font-family: var(--cl-led);
  font-weight: 800;
  font-size: 28px;
  line-height: 32px;
  color: var(--cl-fluor);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}
.cf-input {
  display: block;
  width: 100%;
  height: var(--thumb-h);
  margin: 0;
  background: transparent;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}
.cf-input:focus-visible {
  outline: 2px solid var(--cl-uv-soft);
  outline-offset: 4px;
  border-radius: 8px;
}
/* Riel: ranura negra con marcas cada 15 min */
.cf-input::-webkit-slider-runnable-track {
  height: 10px;
  border: 1px solid var(--cl-line-strong);
  border-radius: 6px;
  background:
    linear-gradient(90deg, rgba(255, 79, 184, 0.55), rgba(138, 92, 255, 0.55)) 0 0 / calc(var(--p) * 100%) 100% no-repeat,
    #000;
}
.cf-input::-moz-range-track {
  height: 10px;
  border: 1px solid var(--cl-line-strong);
  border-radius: 6px;
  background: #000;
}
.cf-input::-moz-range-progress {
  height: 10px;
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(255, 79, 184, 0.55), rgba(138, 92, 255, 0.55));
}
/* Perilla rectangular con línea fluor al centro */
.cf-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: var(--thumb-w);
  height: var(--thumb-h);
  margin-top: calc((10px - var(--thumb-h)) / 2 - 1px);
  border: 1px solid var(--cl-line-strong);
  border-radius: 8px;
  background:
    linear-gradient(var(--cl-fluor), var(--cl-fluor)) 50% 50% / 3px 70% no-repeat,
    linear-gradient(180deg, #3a3550, #1a1726);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6), 0 0 14px rgba(255, 79, 184, 0.35);
}
.cf-input::-moz-range-thumb {
  width: var(--thumb-w);
  height: var(--thumb-h);
  border: 1px solid var(--cl-line-strong);
  border-radius: 8px;
  background:
    linear-gradient(var(--cl-fluor), var(--cl-fluor)) 50% 50% / 3px 70% no-repeat,
    linear-gradient(180deg, #3a3550, #1a1726);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6), 0 0 14px rgba(255, 79, 184, 0.35);
}
.cf-marks {
  position: relative;
  height: 20px;
  margin-top: 6px;
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--cl-text-3);
}
.cf-marks li {
  position: absolute;
  left: calc(var(--m) * 100%);
  transform: translateX(-50%);
}
/* A 390 px no caben las ocho horas: solo las pares */
@media (max-width: 639px) {
  .cf-marks li:nth-child(even) {
    display: none;
  }
}
@media (min-width: 768px) {
  .cf {
    --thumb-w: 28px;
    --thumb-h: 44px;
  }
}
</style>
