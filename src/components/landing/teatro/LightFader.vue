<script setup>
// Fader de consola de luces (SPEC_landing_teatro §4.4): un <input type="range"> nativo de 0 a 4 (teclado y lectores de
// pantalla nativos: flechas, aria-valuetext con el nombre del momento), estilizado como el fader de una consola: riel
// horizontal de 6 px con muescas, perilla rectangular con línea dorada (44 × 44 px de objetivo táctil) y las cinco
// etiquetas debajo (abreviadas en mobile). A la izquierda, un foco cuya intensidad sube con el valor.
// T11: la perilla se desplaza con transform (300 ms; 900 ms en el movimiento automático, clase is-auto que pone la
// cartelera) y el foco cambia su opacidad. Emite update:modelValue y "input" (la persona lo movió).
import { computed } from 'vue'
import { LampCeiling } from 'lucide-vue-next'

const props = defineProps({
  modelValue: { type: Number, required: true },
  /** [{ label, short }] en orden */
  steps: { type: Array, required: true },
  auto: { type: Boolean, required: false },
})
const emit = defineEmits(['update:modelValue', 'input'])

const max = computed(() => props.steps.length - 1)
const pct = computed(() => (props.modelValue / max.value) * 100)

function onInput(e) {
  emit('update:modelValue', Number(e.target.value))
  emit('input')
}
</script>

<template>
  <div class="lf" :class="{ 'is-auto': props.auto }" :style="{ '--pct': pct, '--lamp': 0.3 + 0.7 * (props.modelValue / max) }">
    <span class="lf-lamp" aria-hidden="true"><LampCeiling :size="22" :stroke-width="1.5" /></span>
    <div class="lf-track-wrap">
      <div class="lf-rail" aria-hidden="true">
        <span v-for="(s, i) in props.steps" :key="s.label" class="lf-notch" :style="{ left: `${(i / max) * 100}%` }"></span>
        <span class="lf-knob-pos"><span class="lf-knob"><span class="lf-knob-line"></span></span></span>
      </div>
      <input
        class="lf-input"
        type="range"
        min="0"
        :max="max"
        step="1"
        :value="props.modelValue"
        :aria-valuetext="props.steps[props.modelValue].label"
        aria-label="Momento de la temporada"
        data-testid="theatre-fader"
        @input="onInput"
      />
      <ol class="lf-labels" aria-hidden="true">
        <li
          v-for="(s, i) in props.steps"
          :key="s.label"
          class="lf-label"
          :class="{ 'is-on': i === props.modelValue }"
          :style="{ left: `${(i / max) * 100}%` }"
        >
          <span class="lf-long">{{ s.label }}</span>
          <span class="lf-short">{{ s.short }}</span>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.lf {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.lf-lamp {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-top: 0;
  border: 1px solid var(--te-line-strong);
  border-radius: 8px;
  color: var(--te-oro);
}
.lf-lamp :deep(svg) {
  opacity: var(--lamp);
  filter: drop-shadow(0 6px 10px rgba(255, 233, 184, calc(var(--lamp) * 0.6)));
  transition: opacity 300ms var(--ease-out);
}
.lf-track-wrap {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  /* Margen para que la perilla y las etiquetas de los extremos no se corten */
  margin-inline: 22px;
  padding-bottom: 34px;
}
.lf-rail {
  position: relative;
  height: 44px;
}
.lf-rail::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 19px;
  height: 6px;
  border-radius: 3px;
  background: var(--te-sala);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6), 0 0 0 1px var(--te-line-strong);
}
.lf-notch {
  position: absolute;
  top: 8px;
  width: 1px;
  height: 28px;
  background: var(--te-line-strong);
}
/* La perilla se mueve con transform: el contenedor mide lo mismo que el riel, así que translateX en % es la posición */
.lf-knob-pos {
  position: absolute;
  inset: 0;
  transform: translateX(calc(var(--pct) * 1%));
  transition: transform 300ms var(--ease-out);
  pointer-events: none;
}
.lf.is-auto .lf-knob-pos {
  transition-duration: 900ms;
}
.lf-knob {
  position: absolute;
  top: 0;
  left: -14px;
  width: 28px;
  height: 44px;
  border-radius: 4px;
  background: linear-gradient(180deg, #2a3550 0%, #1a2238 100%);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(240, 232, 216, 0.18);
}
.lf-knob-line {
  position: absolute;
  left: 4px;
  right: 4px;
  top: 21px;
  height: 2px;
  background: var(--te-oro);
}
/* El input nativo queda encima, transparente: recibe el puntero y el teclado; la perilla dibujada lo sigue */
.lf-input {
  position: absolute;
  left: -22px;
  right: -22px;
  top: 0;
  width: calc(100% + 44px);
  height: 44px;
  margin: 0;
  opacity: 0;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
}
.lf-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 44px;
  height: 44px;
}
.lf-input::-moz-range-thumb {
  width: 44px;
  height: 44px;
}
.lf-track-wrap:has(.lf-input:focus-visible) .lf-knob {
  outline: 2px solid var(--te-oro);
  outline-offset: 3px;
}
.lf-labels {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 22px;
}
.lf-label {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--te-text-3);
  transition: color 300ms var(--ease-out);
}
.lf-label:first-child {
  transform: translateX(-22px);
}
.lf-label:last-child {
  transform: translateX(calc(-100% + 22px));
}
.lf-label.is-on {
  color: var(--te-oro);
}
.lf-long {
  display: none;
}
@media (min-width: 768px) {
  .lf-label {
    font-size: 12px;
  }
  .lf-long {
    display: inline;
  }
  .lf-short {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .lf-knob-pos,
  .lf-lamp :deep(svg),
  .lf-label {
    transition-duration: 1ms;
  }
}
</style>
