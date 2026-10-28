<script setup>
// Card de anuncios de "Tu fecha en Instagram" (SPEC_landing_musica §4.8, card 2): papel con texto tinta. Misma lógica
// que la demo de stand-up (useAdsDemo: presupuesto × días, estado activo y foco), con la piel del afiche. Los anuncios
// existen (Meta vía Zernio, netlify/lib/zernio-ads.mjs): presupuesto diario, días (AD_LIMITS, llegan por props), ciudad
// con radio, edad e intereses de Meta (hasta 3; el chip "Gustos musicales" es el ejemplo); Meta cobra el gasto directo.
// Es una demostración: no crea nada ni muestra alcances o resultados estimados.
// Mobile: un solo slider (presupuesto) y los días fijos en 3. Analítica: mu_ads_demo { budget, days }. M15: pop del check.
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { useAdsDemo } from '../../../composables/useAdsDemo.js'
import { formatCLP } from '../producerLanding.js'
import { ADS_DEMO } from './musicaLanding.js'

const props = defineProps({
  /** AD_LIMITS.minDays y AD_LIMITS.maxDays de zernio-ads.mjs */
  minDays: { type: Number, required: true },
  maxDays: { type: Number, required: true },
})

const { budget, days, launched, total, daysLabel, launchButton, pauseButton, setLaunched } = useAdsDemo({
  budget: ADS_DEMO.budget,
  days: ADS_DEMO.days,
  onLaunch: (params) => trackEvent('mu_ads_demo', params),
})
const demoMaxDays = Math.min(ADS_DEMO.daysMax, props.maxDays)
</script>

<template>
  <div class="ad" data-testid="music-ads-demo">
    <p class="mu-mono ad-badge">Quedan 38 entradas · Faltan 3 días</p>
    <h3 class="mu-h3 ad-title">¿Necesitas un empujón? <span class="mu-red">Impulsa con anuncios.</span></h3>
    <p class="ad-text">
      Lanza un anuncio en Instagram y Facebook desde tu panel, para Chile o para tu ciudad, y según los gustos musicales de
      tu público. Tú defines cuánto invertir
      por día y por cuántos días, y lo pausas cuando quieras. Meta cobra el gasto directo en tu cuenta publicitaria y ves
      cuántas entradas vendió cada anuncio.
    </p>

    <div class="ad-form-card">
      <div v-if="!launched" class="ad-form">
        <div>
          <p class="ad-row"><label for="mu-ad-budget">Presupuesto diario</label><span class="mu-mono">{{ formatCLP(budget) }}</span></p>
          <input
            id="mu-ad-budget"
            v-model.number="budget"
            type="range"
            :min="ADS_DEMO.budgetMin"
            :max="ADS_DEMO.budgetMax"
            :step="ADS_DEMO.budgetStep"
            class="mu-range"
            :aria-valuetext="formatCLP(budget)"
          />
        </div>
        <div class="ad-wide">
          <p class="ad-row"><label for="mu-ad-days">Días</label><span class="mu-mono">{{ days }}</span></p>
          <input id="mu-ad-days" v-model.number="days" type="range" :min="props.minDays" :max="demoMaxDays" step="1" class="mu-range" :aria-valuetext="daysLabel" />
          <p class="mu-example ad-note">En tu panel, hasta {{ props.maxDays }} días.</p>
        </div>
        <ul class="ad-chips" aria-label="Público">
          <li class="ad-chip">Santiago · 25 km</li>
          <li class="ad-chip">18–45 años</li>
          <li class="ad-chip">Gustos musicales</li>
        </ul>
        <button ref="launchButton" type="button" class="mu-btn mu-btn-ink ad-cta" data-testid="music-ads-launch" @click="setLaunched(true)">
          <span class="ad-wide">Impulsar · <span class="ev-tabular">{{ formatCLP(total) }}</span> en total</span>
          <span class="ad-narrow">Impulsar {{ daysLabel }} · <span class="ev-tabular">{{ formatCLP(total) }}</span></span>
        </button>
      </div>
      <div v-else class="ad-on" role="status">
        <span class="ad-check" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>
        </span>
        <p class="ad-on-title">Anuncio activo · {{ daysLabel }}</p>
        <p class="ad-on-sub"><span class="ev-tabular">{{ formatCLP(total) }}</span> en total</p>
        <button ref="pauseButton" type="button" class="ad-pause" @click="setLaunched(false)">Pausar</button>
      </div>
      <p class="mu-example ad-example">Demostración: aquí no se crea ningún anuncio.</p>
    </div>
  </div>
</template>

<style scoped>
.ad {
  padding: 20px;
  border-radius: 4px;
  background: var(--mu-paper);
  color: var(--mu-ink);
  --text-1: var(--mu-ink);
  --text-2: var(--mu-ink-2);
  --surface-2: var(--mu-paper-2);
}
.ad-badge {
  display: inline-flex;
  padding: 4px 8px;
  border: 1.5px solid var(--mu-ink);
  font-size: 11px;
  font-weight: 700;
}
.ad-title {
  margin-top: 14px;
}
.ad-title .mu-red {
  color: var(--mu-red-ink);
}
.ad-text {
  margin-top: 10px;
  font-size: 15px;
  line-height: 23px;
  color: var(--mu-ink-2);
}
.ad-form-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
  padding: 16px;
  border: 1.5px solid var(--mu-ink);
  border-radius: 4px;
  background: #fff;
}
.ad-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ad-row {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
}
.ad-note {
  margin-top: 2px;
  color: var(--mu-ink-3);
}
.ad-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ad-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 3px 9px;
  border-radius: 4px;
  background: var(--mu-paper);
  font-size: 12px;
}
.ad-cta {
  min-height: 48px;
  font-size: 15px;
}
.ad-wide {
  display: none;
}
.ad-on {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  text-align: center;
}
.ad-check {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--brand-lime);
  color: var(--mu-ink);
  animation: mu-stamp-pop 320ms var(--ease-spring) both;
  --mu-stamp-rot: 0deg;
}
.ad-on-title {
  font-weight: 600;
}
.ad-on-sub {
  font-size: 14px;
  color: var(--mu-ink-3);
}
.ad-pause {
  min-height: 44px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: none;
  font: inherit;
  font-size: 14px;
  color: var(--mu-ink-2);
  text-decoration: underline;
  cursor: pointer;
}
.ad-pause:focus-visible {
  outline: 2px solid var(--mu-ink);
  outline-offset: 2px;
}
.ad-example {
  color: var(--mu-ink-3);
}
@media (min-width: 1024px) {
  .ad {
    padding: 28px;
  }
  .ad-wide {
    display: revert;
  }
  .ad-narrow {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ad-check {
    animation: none;
  }
}
</style>
