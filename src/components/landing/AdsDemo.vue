<script setup>
// Card de anuncios de la landing (SPEC_landing_productores §5.4b). Los anuncios existen (Meta vía Zernio,
// netlify/lib/zernio-ads.mjs): presupuesto diario, días y público de todo Chile o una ciudad, y Meta cobra el gasto
// directo en la cuenta publicitaria de la productora. Aquí es solo una demostración: no se crea nada ni se estiman
// alcances o resultados. Analítica (§11): lp_ads_demo { budget, days } al apretar "Impulsar".
import { computed, nextTick, ref } from 'vue'
import { formatCLP } from './producerLanding.js'
import { trackEvent } from '../../composables/useGoogleAnalytics.js'

const budget = ref(10000)
const days = ref(3)
const launched = ref(false)
const total = computed(() => budget.value * days.value)

// El botón con foco se desmonta al cambiar de estado: el foco pasa al botón del otro estado (no cae al <body>)
const launchButton = ref(null)
const pauseButton = ref(null)
async function setLaunched(value) {
  launched.value = value
  if (value) trackEvent('lp_ads_demo', { budget: budget.value, days: days.value })
  await nextTick()
  const next = value ? pauseButton.value : launchButton.value
  next?.focus()
}
</script>

<template>
  <div class="ads" data-testid="ads-demo">
    <p class="lp-eyebrow ads-eyebrow">Opcional · Anuncios</p>
    <p class="ads-title">¿Faltan entradas? Impulsa la función.</p>
    <p class="ads-text">
      Campañas en Instagram y Facebook desde tu panel, para todo Chile o tu ciudad. Tú defines el presupuesto diario y los
      días, y la pausas cuando quieras. Meta cobra el gasto directo en tu cuenta publicitaria.
    </p>

    <div v-if="!launched" class="ads-form">
      <div>
        <p class="ads-row"><label for="ads-budget">Presupuesto diario</label><span class="ev-tabular">{{ formatCLP(budget) }}</span></p>
        <input id="ads-budget" v-model.number="budget" type="range" min="3000" max="50000" step="1000" class="ads-range" :aria-valuetext="formatCLP(budget)" />
      </div>
      <div>
        <p class="ads-row"><label for="ads-days">Días</label><span class="ev-tabular">{{ days }}</span></p>
        <input id="ads-days" v-model.number="days" type="range" min="1" max="7" step="1" class="ads-range" :aria-valuetext="`${days} días`" />
      </div>
      <button ref="launchButton" type="button" class="ev-btn lp-btn-lime ads-cta" data-testid="ads-demo-launch" @click="setLaunched(true)">
        Impulsar · <span class="ev-tabular">{{ formatCLP(total) }}</span>
      </button>
    </div>
    <div v-else class="ads-on" role="status">
      <p>✓ Campaña activa · {{ days }} {{ days === 1 ? 'día' : 'días' }} · {{ formatCLP(total) }}</p>
      <button ref="pauseButton" type="button" class="ads-pause" @click="setLaunched(false)">Pausar</button>
    </div>
    <p class="lp-example">Demostración: aquí no se crea ningún anuncio.</p>
  </div>
</template>

<style scoped>
.ads {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 24px;
  border-radius: 20px;
  background: var(--brand-ink);
  color: #fff;
}
.ads-eyebrow {
  color: var(--lp-on-dark-3);
}
.ads-title {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 20px;
  line-height: 26px;
  font-weight: 700;
}
.ads-text {
  font-size: 14px;
  line-height: 21px;
  color: var(--lp-on-dark-2);
}
.ads-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ads-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.ads-row span {
  font-weight: 600;
}
.ads-range {
  width: 100%;
  height: 28px;
  margin: 0;
  accent-color: var(--brand-lime);
  cursor: pointer;
}
.ads-range:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 4px;
  border-radius: 4px;
}
.ads-cta {
  min-height: 46px;
}
.ads-on {
  padding: 14px;
  border-radius: var(--r-md);
  background: rgba(154, 230, 0, 0.12);
  border: 1px solid rgba(154, 230, 0, 0.4);
  font-size: 14px;
  animation: ev-fade-up var(--dur-3) var(--ease-out) both;
}
.ads-pause {
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 13px;
  color: var(--lp-on-dark-2);
  text-decoration: underline;
  cursor: pointer;
}
.ads-pause:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.lp-example {
  color: var(--lp-on-dark-3);
}
@media (prefers-reduced-motion: reduce) {
  .ads-on {
    animation-duration: 1ms;
  }
}
</style>
