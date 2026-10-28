<script setup>
// Card de anuncios de "La última semana" (SPEC_landing_fiestas §4.5): piel sticker sobre la misma lógica de las demos
// de stand-up, música y clubs (useAdsDemo: presupuesto × días, estado activo y foco). Los anuncios existen (Meta vía
// Zernio, netlify/lib/zernio-ads.mjs): presupuesto diario, días, ciudad con radio y edad desde AD_LIMITS.defaultAgeMin
// (AD_LIMITS llega por props) e intereses de Meta (hasta 3; "Reggaetón" es el ejemplo); Meta cobra el gasto directo.
// Es una demostración: no crea nada ni muestra alcances o resultados estimados, y la pieza
// de ejemplo no muestra alcohol (§0.11). Mobile: un solo slider (presupuesto) y los días fijos en 3.
// Analítica: fi_ads_demo { budget, days }.
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { useAdsDemo } from '../../../composables/useAdsDemo.js'
import { formatCLP } from '../producerLanding.js'
import { PARTY_ADS_DEMO } from './fiestasLanding.js'

const props = defineProps({
  /** AD_LIMITS de zernio-ads.mjs */
  minDays: { type: Number, required: true },
  maxDays: { type: Number, required: true },
  minAge: { type: Number, required: true },
  radiusKm: { type: Number, required: true },
})

const { budget, days, launched, total, daysLabel, launchButton, pauseButton, setLaunched } = useAdsDemo({
  budget: PARTY_ADS_DEMO.budget,
  days: PARTY_ADS_DEMO.days,
  onLaunch: (params) => trackEvent('fi_ads_demo', params),
})
const demoMaxDays = Math.min(PARTY_ADS_DEMO.daysMax, props.maxDays)
</script>

<template>
  <div class="pad fi-card" data-testid="party-ads-demo">
    <p class="fi-tag fi-tag-amarillo pad-badge">Preventa 3 · Quedan 64</p>
    <h3 class="fi-h3 pad-title">¿Se frenó la venta? Impúlsala.</h3>
    <p class="pad-text">
      Lanza un anuncio en Instagram y Facebook desde tu panel, para tu ciudad, desde los {{ props.minAge }} años y por gustos. Tú
      defines cuánto invertir por día y por cuántos días, y lo pausas cuando quieras. Meta cobra el gasto directo en tu
      cuenta publicitaria y ves cuántas entradas vendió cada anuncio.
    </p>

    <div class="pad-form-card">
      <div v-if="!launched" class="pad-form">
        <div>
          <p class="pad-row"><label for="fi-ad-budget">Presupuesto diario</label><span class="fi-tabular">{{ formatCLP(budget) }}</span></p>
          <input
            id="fi-ad-budget"
            v-model.number="budget"
            type="range"
            :min="PARTY_ADS_DEMO.budgetMin"
            :max="PARTY_ADS_DEMO.budgetMax"
            :step="PARTY_ADS_DEMO.budgetStep"
            class="fi-range"
            :aria-valuetext="formatCLP(budget)"
          />
        </div>
        <div class="pad-wide">
          <p class="pad-row"><label for="fi-ad-days">Días</label><span class="fi-tabular">{{ days }}</span></p>
          <input id="fi-ad-days" v-model.number="days" type="range" :min="props.minDays" :max="demoMaxDays" step="1" class="fi-range" :aria-valuetext="daysLabel" />
          <p class="fi-note pad-note">En tu panel, hasta {{ props.maxDays }} días.</p>
        </div>
        <ul class="pad-chips" aria-label="Público">
          <li class="pad-chip">Santiago · {{ props.radiusKm }} km</li>
          <li class="pad-chip">{{ props.minAge }}–{{ PARTY_ADS_DEMO.ageMax }} años</li>
          <li class="pad-chip">Reggaetón</li>
        </ul>
        <button ref="launchButton" type="button" class="fi-btn fi-btn-tinta pad-cta" data-testid="party-ads-launch" @click="setLaunched(true)">
          <span class="pad-wide">Impulsar · <span class="fi-tabular">{{ formatCLP(total) }}</span> en total</span>
          <span class="pad-narrow">Impulsar {{ daysLabel }} · <span class="fi-tabular">{{ formatCLP(total) }}</span></span>
        </button>
      </div>
      <div v-else class="pad-on" role="status">
        <span class="pad-check" aria-hidden="true">✓</span>
        <p class="pad-on-title">Anuncio activo · {{ daysLabel }}</p>
        <p class="pad-on-sub"><span class="fi-tabular">{{ formatCLP(total) }}</span> en total</p>
        <button ref="pauseButton" type="button" class="pad-pause" @click="setLaunched(false)">Pausar</button>
      </div>
      <p class="fi-example">Demostración: aquí no se crea ningún anuncio.</p>
    </div>
  </div>
</template>

<style scoped>
.pad {
  min-width: 0;
  padding: 20px;
  transform: rotate(1deg);
}
.pad-badge {
  text-transform: none;
  letter-spacing: 0.02em;
}
.pad-title {
  margin-top: 14px;
}
.pad-text {
  margin-top: 10px;
  font-size: 15px;
  line-height: 23px;
  color: var(--fi-text-2);
}
.pad-form-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
  padding: 16px;
  border: 2px solid var(--fi-tinta);
  border-radius: 14px;
  background: #fff;
}
.pad-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.pad-row {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 700;
}
.pad-note {
  margin-top: 2px;
}
.pad-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pad-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 3px 10px;
  border: 2px solid var(--fi-tinta);
  border-radius: 999px;
  background: var(--fi-crema);
  font-size: 12px;
  font-weight: 600;
}
.pad-cta {
  min-height: 48px;
  font-size: 15px;
}
.pad-wide {
  display: none;
}
.pad-on {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  text-align: center;
}
.pad-check {
  width: 48px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--fi-tinta);
  border-radius: 50%;
  background: var(--brand-lime);
  color: var(--fi-tinta);
  font-size: 22px;
  font-weight: 700;
  box-shadow: 3px 3px 0 var(--fi-tinta);
  animation: fi-pop 320ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.pad-on-title {
  font-weight: 700;
}
.pad-on-sub {
  font-size: 14px;
  color: var(--fi-text-3);
}
.pad-pause {
  min-height: 44px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--fi-tinta);
  text-decoration: underline;
  cursor: pointer;
}
.pad-pause:focus-visible {
  outline: 3px solid var(--fi-cobalto);
  outline-offset: 2px;
}
@media (min-width: 1024px) {
  .pad {
    padding: 24px;
  }
  .pad-wide {
    display: revert;
  }
  .pad-narrow {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pad-check {
    animation: none;
  }
}
</style>
