<script setup>
// La pulsera con tu nombre (SPEC_landing_fiestas §4.12): una pulsera grande con "FIESTA DISQUETE · PREVENTA 1 · N° 0001"
// y un campo "Ponle nombre a tu fiesta" (máx. 24 caracteres) que la reescribe en vivo en mayúsculas (bandText). Es solo
// decorativa: el texto no se envía ni se guarda (ni en analítica ni en localStorage) y el CTA no lo lleva a ninguna
// parte. SSR / sin JS: la pulsera con el nombre de ejemplo y el campo invisible (visibility: hidden, fuera del orden de
// tabulación) pero ocupando su alto, así la pulsera no salta al hidratar (CLS, §7). F18: sin animación por letra.
// Analítica: fi_band_name (una vez, sin el texto).
import { computed, onMounted, ref } from 'vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { BAND_NAME_MAX, bandText } from './fiestasLanding.js'

const name = ref('')
const hydrated = ref(false)
const text = computed(() => bandText(name.value))
const repeated = computed(() => Array.from({ length: 6 }, () => text.value).join(' · '))
let tracked = false

onMounted(() => {
  hydrated.value = true
})
function onInput() {
  if (tracked || !name.value.trim()) return
  tracked = true
  trackEvent('fi_band_name', {})
}
</script>

<template>
  <div class="bn" data-testid="party-band-namer">
    <label class="bn-field" :class="{ 'is-pending': !hydrated }">
      <span class="bn-label">Ponle nombre a tu fiesta</span>
      <input
        v-model="name"
        class="fi-field bn-input"
        type="text"
        :maxlength="BAND_NAME_MAX"
        autocomplete="off"
        spellcheck="false"
        placeholder="Disquete"
        data-testid="party-band-input"
        @input="onInput"
      />
    </label>
    <div class="fi-band fi-band--amarillo bn-band" style="--tilt: -2deg" aria-hidden="true">
      <span class="fi-band-strip">
        <span class="fi-band-half fi-band-a"><span class="fi-band-text bn-text">{{ repeated }}</span></span>
        <span class="fi-band-half fi-band-b"><span class="fi-band-text bn-text">{{ repeated }}</span></span>
      </span>
      <span class="fi-band-tab bn-tab">N° 0001</span>
    </div>
    <p class="lp-sr-only" data-testid="party-band-text">{{ text }} · N° 0001</p>
  </div>
</template>

<style scoped>
.bn {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.bn-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 360px;
}
.bn-field.is-pending {
  visibility: hidden;
}
.bn-label {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fi-ink-on-naranja);
}
.bn-input {
  background: var(--fi-crema);
  text-transform: uppercase;
}
.bn-band {
  --band-h: 64px;
  margin-inline: -8px;
}
.bn-band .fi-band-half {
  box-shadow: inset 0 0 0 3px var(--fi-tinta);
}
.bn-text {
  padding-left: 22px;
  font-family: var(--fi-display);
  font-weight: 400;
  font-size: 26px;
  letter-spacing: 0.04em;
}
.bn-tab {
  width: 72px;
  height: 72px;
  font-size: 12px;
  border: 3px solid var(--fi-tinta);
}
@media (max-width: 767px) {
  .bn-band {
    --band-h: 48px;
  }
  .bn-text {
    font-size: 20px;
  }
  .bn-tab {
    width: 56px;
    height: 56px;
    font-size: 10px;
  }
}
</style>
