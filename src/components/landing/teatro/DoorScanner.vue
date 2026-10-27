<script setup>
// Escáner de la puerta (SPEC_landing_teatro §4.6, segunda llamada): teléfono de 240 × 480 que alterna entre dos
// estados reales de ValidateQR.vue: (a) "✓ Válida" con el tipo de entrada, la función y el nombre, y (b) el aviso
// "Esta entrada es para otra función" con la opción de validarla igual (R1). Los botones del aviso son parte del dibujo
// (no hacen nada); el botón ↻ cambia de estado a mano.
// T15: alterna cada 2,6 s (crossfade + translateY 8 px) solo mientras se ve. Sin JS o con "reducir movimiento" queda
// fijo en el aviso de otra función, con el botón. Analítica: te_scanner_toggle.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { PLAY_DEMO, SCANNER_DEMO } from './teatroLanding.js'

const state = ref('other')
// Solo se anuncia el cambio que hace la persona con ↻ (el loop automático no habla cada 2,6 s)
const announced = ref('')
const root = ref(null)
let timer = 0
let observer = null
let playing = false

function flip() {
  state.value = state.value === 'valid' ? 'other' : 'valid'
}
function stop() {
  clearInterval(timer)
  timer = 0
}
function start() {
  stop()
  timer = setInterval(flip, SCANNER_DEMO.intervalMs)
}
function toggle() {
  flip()
  announced.value =
    state.value === 'valid'
      ? `Válida. ${SCANNER_DEMO.valid.ticket}, ${SCANNER_DEMO.valid.when}, ${SCANNER_DEMO.valid.name}.`
      : `Esta entrada es para otra función: ${SCANNER_DEMO.otherFunction.when}. Puedes validarla igual o no validarla.`
  trackEvent('te_scanner_toggle')
  if (playing) start()
}

onMounted(() => {
  const motion = document.documentElement.classList.contains('lp-motion')
  if (!motion || !('IntersectionObserver' in window)) return
  state.value = 'valid'
  observer = new IntersectionObserver((entries) => {
    playing = entries.some((e) => e.isIntersecting)
    if (playing) start()
    else stop()
  })
  observer.observe(root.value)
})
onBeforeUnmount(() => {
  stop()
  observer?.disconnect()
})
</script>

<template>
  <div ref="root" class="ds" data-testid="theatre-scanner">
    <div class="ds-phone">
      <div class="ds-screen">
        <p class="ds-top">
          <span class="ds-top-title">Validar entradas</span>
          <span class="ds-top-sub">{{ PLAY_DEMO.title }} · {{ SCANNER_DEMO.valid.when }}</span>
        </p>
        <div class="ds-viewfinder" aria-hidden="true">
          <span class="ds-corner ds-c1"></span>
          <span class="ds-corner ds-c2"></span>
          <span class="ds-corner ds-c3"></span>
          <span class="ds-corner ds-c4"></span>
        </div>
        <div class="ds-result">
          <Transition name="ds-swap" mode="out-in">
            <div v-if="state === 'valid'" key="valid" class="ds-card ds-valid" data-testid="theatre-scanner-valid">
              <p class="ds-valid-title"><span aria-hidden="true">✓</span> Válida</p>
              <p class="ds-line">{{ SCANNER_DEMO.valid.ticket }} · {{ SCANNER_DEMO.valid.when }}</p>
              <p class="ds-line">{{ SCANNER_DEMO.valid.name }}</p>
            </div>
            <div v-else key="other" class="ds-card ds-other" data-testid="theatre-scanner-other">
              <p class="ds-other-title">Esta entrada es para otra función: {{ SCANNER_DEMO.otherFunction.when }}</p>
              <p class="ds-actions" aria-hidden="true">
                <span class="ds-fake-btn ds-fake-primary">Validar igual</span>
                <span class="ds-fake-btn">No validar</span>
              </p>
            </div>
          </Transition>
        </div>
      </div>
    </div>
    <button type="button" class="ds-toggle" aria-label="Cambiar el estado del escáner de ejemplo" data-testid="theatre-scanner-toggle" @click="toggle">
      <RefreshCw :size="18" :stroke-width="1.5" aria-hidden="true" />
    </button>
    <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
  </div>
</template>

<style scoped>
.ds {
  position: relative;
  display: inline-flex;
  align-items: flex-end;
  gap: 12px;
}
.ds-phone {
  width: 240px;
  height: 480px;
  padding: 7px;
  border-radius: 32px;
  background: #000;
  box-shadow: 0 30px 70px rgba(7, 10, 18, 0.6);
}
.ds-screen {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  border-radius: 26px;
  padding: 28px 14px 16px;
  background: #0f1626;
  color: var(--te-text-1);
  text-align: left;
}
.ds-top {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ds-top-title {
  font-size: 14px;
  font-weight: 600;
}
.ds-top-sub {
  font-size: 11px;
  color: var(--te-text-3);
}
.ds-viewfinder {
  position: relative;
  width: 150px;
  height: 150px;
  margin: 24px auto 0;
  border-radius: 12px;
  background: radial-gradient(ellipse at 50% 40%, rgba(240, 232, 216, 0.08), transparent 70%), #0a0f1b;
}
.ds-corner {
  position: absolute;
  width: 22px;
  height: 22px;
  border-color: var(--te-oro);
  border-style: solid;
  border-width: 0;
}
.ds-c1 {
  top: 8px;
  left: 8px;
  border-top-width: 2px;
  border-left-width: 2px;
}
.ds-c2 {
  top: 8px;
  right: 8px;
  border-top-width: 2px;
  border-right-width: 2px;
}
.ds-c3 {
  bottom: 8px;
  left: 8px;
  border-bottom-width: 2px;
  border-left-width: 2px;
}
.ds-c4 {
  bottom: 8px;
  right: 8px;
  border-bottom-width: 2px;
  border-right-width: 2px;
}
.ds-result {
  margin-top: auto;
  min-height: 132px;
  display: flex;
  align-items: flex-end;
}
.ds-card {
  width: 100%;
  padding: 14px;
  border-radius: 12px;
}
.ds-valid {
  background: var(--brand-lime);
  color: var(--te-ink);
}
.ds-valid-title {
  font-size: 20px;
  font-weight: 700;
}
.ds-line {
  margin-top: 4px;
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
}
.ds-other {
  border: 1.5px solid var(--te-oro);
  background: var(--te-programa);
  color: var(--te-ink);
}
.ds-other-title {
  font-size: 13px;
  line-height: 19px;
  font-weight: 600;
}
.ds-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.ds-fake-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  border: 1px solid rgba(22, 26, 36, 0.3);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}
.ds-fake-primary {
  border-color: var(--te-ink);
  background: var(--te-ink);
  color: var(--te-programa);
}
.ds-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid rgba(212, 175, 106, 0.6);
  border-radius: 8px;
  background: var(--te-sala-2);
  color: var(--te-text-1);
  cursor: pointer;
}
.ds-toggle:hover {
  border-color: var(--te-oro);
}
.ds-toggle:focus-visible {
  outline: 2px solid var(--te-oro);
  outline-offset: 2px;
}
.ds-swap-enter-active,
.ds-swap-leave-active {
  transition: opacity 260ms var(--ease-out), transform 260ms var(--ease-out);
}
.ds-swap-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.ds-swap-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
@media (prefers-reduced-motion: reduce) {
  .ds-swap-enter-active,
  .ds-swap-leave-active {
    transition-duration: 1ms;
  }
}
</style>
