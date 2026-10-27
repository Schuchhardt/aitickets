<script setup>
// Demo de tandas de la preventa (SPEC_landing_musica §4.4 y M9): tres talones apilados (Preventa 1, Preventa 2 y
// General), cada uno un tipo de entrada con su precio y su cupo. Al entrar en pantalla se llena la barra de Preventa 1
// (1,2 s), cae el sello AGOTADA y se llena Preventa 2 hasta lo vendido ("Quedan 38"); General queda atenuada con su
// fecha de apertura. "↻ Repetir" vuelve a correr la demo (mu_tiers_replay). Debajo, "Así lo ve tu público": el
// checkout simplificado con la tanda agotada tachada y un selector de cantidad que respeta el máximo por compra
// (DEFAULT_MAX_PER_PURCHASE). Precios sin cargo, con SERVICE_FEE_NOTE de fees.mjs.
// Sin JS (SSR) y con "reducir movimiento" se ve el estado final, con el sello puesto y sin "Repetir". Si ya se ve al
// hidratar, también queda en el estado final (vaciar las barras y quitar el sello sería un parpadeo) y "Repetir" la
// corre; la isla hidrata 200 px antes de entrar en pantalla para que eso sea la excepción. La apertura
// automática de la siguiente tanda no existe: aquí cada tanda es su propio tipo de entrada (§0.6).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { formatCLP } from '../producerLanding.js'
import { DEFAULT_MAX_PER_PURCHASE, SERVICE_FEE_NOTE } from '../../Reservation/pricing.js'
import { TIERS, currentTier, tierState } from './musicaLanding.js'

const tiers = TIERS.map((t) => ({ ...t, state: tierState(t) }))
const selling = currentTier()

// phase: 'final' (estado final, SSR y sin movimiento) | 'idle' (barras vacías) | 'first' | 'stamp' | 'second'
const phase = ref('final')
const canAnimate = ref(false)
const root = ref(null)
let observer = null
let timers = []

const fills = computed(() =>
  tiers.map((t, i) => {
    if (phase.value === 'final') return t.state.fill
    if (i === 0) return phase.value === 'idle' ? 0 : 1
    if (i === 1) return phase.value === 'second' ? t.state.fill : 0
    return 0
  }),
)
const stampOn = computed(() => phase.value === 'final' || phase.value === 'stamp' || phase.value === 'second')
const firstSold = computed(() => stampOn.value)
const secondLabel = computed(() => (phase.value === 'final' || phase.value === 'second' ? tiers[1].state.label : `Quedan ${tiers[1].capacity}`))

function clear() {
  timers.forEach(clearTimeout)
  timers = []
}
function play() {
  clear()
  phase.value = 'idle'
  // Dos frames para que el navegador pinte las barras vacías antes de llenarlas
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      phase.value = 'first'
      timers.push(setTimeout(() => (phase.value = 'stamp'), 1200))
      timers.push(setTimeout(() => (phase.value = 'second'), 1600))
    }),
  )
}
function replay() {
  trackEvent('mu_tiers_replay')
  play()
}

const qty = ref(2)
const max = selling ? Math.min(DEFAULT_MAX_PER_PURCHASE, selling.capacity - selling.sold) : 0

onMounted(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || !('IntersectionObserver' in window)) return
  canAnimate.value = true
  const rect = root.value.getBoundingClientRect()
  if (rect.top < window.innerHeight && rect.bottom > 0) return
  phase.value = 'idle'
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer.disconnect()
      play()
    },
    { threshold: 0.4 },
  )
  observer.observe(root.value)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  clear()
})
</script>

<template>
  <div ref="root" class="ts" data-testid="music-tiers">
    <div class="ts-head">
      <p class="mu-example ts-label">Ejemplo</p>
      <button v-if="canAnimate" type="button" class="ts-replay" data-testid="music-tiers-replay" @click="replay">
        <span aria-hidden="true">↻</span> Repetir
      </button>
    </div>

    <ol class="ts-stack">
      <li v-for="(tier, i) in tiers" :key="tier.name" class="mu-ticket ts-ticket" :class="`is-${tier.state.kind}`">
        <div class="ts-body">
          <p class="ts-row">
            <span class="mu-display ts-name">{{ tier.name }}</span>
            <span class="mu-mono ts-price">{{ formatCLP(tier.price) }}</span>
          </p>
          <div class="ts-track" aria-hidden="true">
            <span class="ts-bar" :class="{ 'is-instant': phase === 'idle' }" :style="{ transform: `scaleX(${fills[i]})` }"></span>
          </div>
          <p class="mu-mono ts-meta">
            {{ tier.capacity }} entradas
            <template v-if="i === 0"> · <span>{{ firstSold ? 'Agotada' : 'A la venta' }}</span></template>
            <template v-else-if="i === 1"> · <span data-testid="music-tiers-left">{{ secondLabel }}</span></template>
            <template v-else> · {{ tier.state.label }}</template>
          </p>
        </div>
        <div class="mu-ticket-stub ts-stub" aria-hidden="true">
          <span class="mu-mono">{{ String(i + 1).padStart(2, '0') }}</span>
        </div>
        <span v-if="i === 0" class="ts-stamp" aria-hidden="true">
          <Transition name="ts-stamp">
            <span v-if="stampOn" class="mu-stamp mu-stamp-ink" style="--mu-stamp-rot: -9deg" data-testid="music-tiers-stamp">Agotada</span>
          </Transition>
        </span>
      </li>
    </ol>

    <div class="ts-public">
      <p class="mu-mono ts-public-title">Así lo ve tu público</p>
      <ul class="ts-public-list">
        <li class="ts-public-row is-soldout">
          <span><s>{{ tiers[0].name }}</s></span>
          <span class="mu-mono">Agotada</span>
        </li>
        <li v-if="selling" class="ts-public-row">
          <span>
            {{ selling.name }} · <span class="ev-tabular">{{ formatCLP(selling.price) }}</span>
            <span class="ts-public-fee">{{ SERVICE_FEE_NOTE }}</span>
          </span>
          <span class="ts-qty" role="group" :aria-label="`Cantidad de ${selling.name}`">
            <button type="button" class="ts-qty-btn" :disabled="qty <= 1" aria-label="Quitar una entrada" @click="qty--">−</button>
            <span class="mu-mono ts-qty-n" aria-live="polite">{{ qty }}</span>
            <button type="button" class="ts-qty-btn" :disabled="qty >= max" aria-label="Agregar una entrada" @click="qty++">+</button>
          </span>
        </li>
      </ul>
      <p class="mu-example ts-public-note">Máximo {{ DEFAULT_MAX_PER_PURCHASE }} por compra si no lo cambias</p>
    </div>
  </div>
</template>

<style scoped>
.ts-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  margin-bottom: 10px;
}
.ts-label {
  color: var(--mu-ink);
}
.ts-replay {
  min-height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 4px;
  background: var(--mu-ink);
  color: var(--mu-paper);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.ts-replay:focus-visible {
  outline: 2px solid var(--mu-ink);
  outline-offset: 3px;
}
.ts-stack {
  display: grid;
  gap: 10px;
}
.ts-ticket {
  --stub: 56px;
  --notch: 8px;
  position: relative;
}
.ts-body {
  padding: 14px 14px 12px 16px;
}
.ts-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.ts-name {
  font-size: 26px;
  line-height: 28px;
}
.ts-price {
  font-weight: 700;
}
.ts-track {
  height: 8px;
  margin-top: 10px;
  background: rgba(17, 16, 19, 0.12);
  overflow: hidden;
}
.ts-bar {
  display: block;
  height: 100%;
  background: var(--mu-ink);
  transform-origin: left;
  transition: transform 1200ms var(--ease-out);
}
.ts-bar.is-instant {
  transition: none;
}
.ts-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--mu-ink-2);
}
.ts-ticket.is-upcoming {
  opacity: 0.55;
}
.ts-stub {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--mu-ink-3);
}
.ts-stamp {
  position: absolute;
  top: 50%;
  left: 52%;
  transform: translate(-50%, -50%);
}
.ts-stamp .mu-stamp {
  font-size: 30px;
}
.ts-stamp-enter-active {
  animation: mu-stamp-pop 220ms var(--ease-spring) both;
}
.ts-public {
  margin-top: 20px;
  padding: 16px;
  border-radius: 4px;
  background: var(--mu-ink);
  color: var(--mu-text-1);
}
.ts-public-title {
  font-size: 12px;
  color: var(--mu-text-3);
}
.ts-public-list {
  margin-top: 10px;
}
.ts-public-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--mu-line);
  font-size: 14px;
  line-height: 20px;
}
.ts-public-row.is-soldout {
  color: var(--mu-text-3);
}
.ts-public-fee {
  display: block;
  font-size: 12px;
  color: var(--mu-text-3);
}
.ts-qty {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ts-qty-btn {
  width: 44px;
  height: 44px;
  border: 1px solid var(--mu-line-strong);
  border-radius: 4px;
  background: none;
  color: var(--mu-text-1);
  font-size: 18px;
  cursor: pointer;
}
.ts-qty-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ts-qty-btn:focus-visible {
  outline: 2px solid var(--brand-lime);
  outline-offset: 2px;
}
.ts-qty-n {
  min-width: 20px;
  text-align: center;
  font-weight: 700;
}
.ts-public-note {
  margin-top: 6px;
}
@media (min-width: 1024px) {
  .ts-name {
    font-size: 30px;
    line-height: 32px;
  }
  .ts-ticket {
    --stub: 64px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ts-bar {
    transition: none;
  }
  .ts-stamp-enter-active {
    animation: none;
  }
}
</style>
