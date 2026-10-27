<script setup>
// El escáner de la puerta (SPEC_landing_fiestas §4.7): un teléfono con la interfaz del escáner en tonos de noche, sin
// señal ("Sin conexión · 3 por sincronizar") y el contador "N / M entradas validadas". "Escanear siguiente" recorre
// cuatro casos con los textos reales de ValidateQR.vue (scanMessage): una válida pendiente de sincronizar, una entrada
// Alumno (la puerta pide la credencial), un pantallazo que ya entró ("❌ Este ticket ya fue validado", banner rojo del
// producto) y una cortesía. El contador sube con cada válida. Resultado en aria-live. Sin JS: los cuatro casos como
// lista (con JS, la lista queda solo para lectores de pantalla).
// F12: el banner baja y el ❌ se sacude (con "reducir movimiento", sin sacudida). Analítica: fi_scan_demo {case}.
import { computed, onMounted, ref } from 'vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { PARTY_CAPACITY, SCAN_CASES, SCAN_PENDING, SCAN_START, scanMessage } from './fiestasLanding.js'

const index = ref(0)
const validated = ref(SCAN_START)
const pending = ref(SCAN_PENDING)
const hydrated = ref(false)
const scans = ref(0)
const current = computed(() => SCAN_CASES[index.value])

onMounted(() => {
  hydrated.value = true
})

function next() {
  index.value = (index.value + 1) % SCAN_CASES.length
  const c = SCAN_CASES[index.value]
  if (c.kind === 'ok') {
    validated.value += 1
    pending.value += 1
  }
  scans.value += 1
  trackEvent('fi_scan_demo', { case: c.id })
}
</script>

<template>
  <div class="ds" data-testid="party-scanner">
    <div class="ds-phone">
      <div class="ds-screen">
        <p class="ds-offline">Sin conexión · <span class="fi-tabular">{{ pending }}</span> por sincronizar</p>
        <p class="ds-count"><span class="fi-tabular" data-testid="party-scanner-count">{{ validated }} / {{ PARTY_CAPACITY }}</span> entradas validadas</p>
        <div class="ds-viewfinder" aria-hidden="true">
          <span class="ds-corner ds-c1"></span><span class="ds-corner ds-c2"></span><span class="ds-corner ds-c3"></span><span class="ds-corner ds-c4"></span>
          <span class="ds-qr"></span>
        </div>
        <div :key="scans" class="ds-result" :class="current.kind === 'used' ? 'is-used' : 'is-ok'" data-testid="party-scanner-result">
          <p class="ds-msg">{{ scanMessage(current) }}</p>
          <p v-if="current.type" class="ds-type">Tipo de entrada: <strong>{{ current.type }}</strong></p>
          <p v-if="current.note" class="ds-note">{{ current.note }}</p>
        </div>
        <button type="button" class="fi-btn fi-btn-crema ds-next" data-testid="party-scanner-next" @click="next">Escanear siguiente</button>
      </div>
    </div>
    <p class="lp-sr-only" aria-live="polite">{{ scans ? scanMessage(current) : '' }}</p>
    <ol class="ds-list" :class="{ 'lp-sr-only': hydrated }" aria-label="Casos del escáner, ejemplo">
      <li v-for="c in SCAN_CASES" :key="c.id">
        {{ scanMessage(c) }}<template v-if="c.type"> · {{ c.type }}</template><template v-if="c.note"> · {{ c.note }}</template>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.ds {
  min-width: 0;
}
.ds-phone {
  width: 260px;
  height: 520px;
  margin: 0 auto;
  padding: 10px;
  border: 3px solid #3a333f;
  border-radius: 40px;
  background: #000;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}
.ds-screen {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  padding: 22px 14px 16px;
  border-radius: 30px;
  background: var(--fi-noche-2);
  color: var(--fi-crema);
}
.ds-offline {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fi-amarillo);
}
.ds-count {
  font-size: 13px;
  color: var(--fi-text-night-2);
}
.ds-count .fi-tabular {
  font-weight: 700;
  color: var(--fi-crema);
}
.ds-viewfinder {
  position: relative;
  flex: 1 1 auto;
  min-height: 110px;
  border-radius: 16px;
  background: #0b090d;
}
.ds-corner {
  position: absolute;
  width: 26px;
  height: 26px;
  border: 3px solid var(--fi-crema);
}
.ds-c1 {
  top: 14px;
  left: 14px;
  border-right: 0;
  border-bottom: 0;
}
.ds-c2 {
  top: 14px;
  right: 14px;
  border-left: 0;
  border-bottom: 0;
}
.ds-c3 {
  bottom: 14px;
  left: 14px;
  border-right: 0;
  border-top: 0;
}
.ds-c4 {
  bottom: 14px;
  right: 14px;
  border-left: 0;
  border-top: 0;
}
.ds-qr {
  position: absolute;
  inset: 32%;
  background: repeating-conic-gradient(var(--fi-crema) 0 25%, transparent 0 50%) 0 0 / 12px 12px;
  opacity: 0.35;
  border-radius: 4px;
}
.ds-result {
  padding: 10px 12px;
  border-radius: 12px;
  animation: fi-drop 200ms var(--ease-out) both;
}
.ds-result.is-ok {
  background: var(--brand-lime);
  color: var(--fi-tinta);
}
.ds-result.is-used {
  background: var(--fi-error);
  color: #fff;
  animation: fi-drop 200ms var(--ease-out) both, fi-shake 240ms linear 200ms;
}
.ds-msg {
  font-size: 13px;
  line-height: 18px;
  font-weight: 700;
}
.ds-type,
.ds-note {
  margin-top: 4px;
  font-size: 12px;
  line-height: 16px;
}
.ds-next {
  width: 100%;
  min-height: 48px;
  font-size: 15px;
}
.ds-list {
  margin-top: 16px;
  padding-left: 18px;
  list-style: decimal;
  font-size: 14px;
  line-height: 21px;
  color: var(--fi-text-night-2);
}
@media (min-width: 1024px) {
  .ds-phone {
    width: 300px;
    height: 600px;
  }
  .ds-msg {
    font-size: 14px;
    line-height: 19px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ds-result,
  .ds-result.is-used {
    animation: none;
  }
}
</style>
