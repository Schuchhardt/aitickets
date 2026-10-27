<script setup>
// Card de anuncios de "Tu noche en historias" (SPEC_landing_clubs §4.3, card 2): piel de luz negra sobre la misma lógica
// de las demos de stand-up y música (useAdsDemo: presupuesto × días, estado activo y foco). Los anuncios existen (Meta
// vía Zernio, netlify/lib/zernio-ads.mjs): presupuesto diario, días, ciudad con radio y edad (AD_LIMITS llega por props:
// días, radio de ciudad más chico y edad mínima por defecto); Meta cobra el gasto directo. Segmentar por gustos ("Música
// electrónica") no existe: chip deshabilitado con "Pronto". Es una demostración: no crea nada ni muestra alcances o
// resultados estimados, y la pieza de ejemplo no muestra alcohol (§0.10).
// Mobile: un solo slider (presupuesto) y los días fijos en 3. Analítica: cl_ads_demo { budget, days }.
import SoonBadge from '../../ui/SoonBadge.vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { useAdsDemo } from '../../../composables/useAdsDemo.js'
import { formatCLP } from '../producerLanding.js'
import { CLUB_ADS_DEMO } from './clubsLanding.js'

const props = defineProps({
  /** AD_LIMITS de zernio-ads.mjs */
  minDays: { type: Number, required: true },
  maxDays: { type: Number, required: true },
  minAge: { type: Number, required: true },
  radiusKm: { type: Number, required: true },
})

const { budget, days, launched, total, daysLabel, launchButton, pauseButton, setLaunched } = useAdsDemo({
  budget: CLUB_ADS_DEMO.budget,
  days: CLUB_ADS_DEMO.days,
  onLaunch: (params) => trackEvent('cl_ads_demo', params),
})
const demoMaxDays = Math.min(CLUB_ADS_DEMO.daysMax, props.maxDays)
</script>

<template>
  <div class="ad cl-card" data-testid="club-ads-demo">
    <p class="cl-meta ad-badge">Quedan 3 mesas · Faltan 2 días</p>
    <h3 class="ad-title">¿Viernes flojo? Impúlsalo con anuncios.</h3>
    <p class="ad-text">
      Lanza un anuncio en Instagram y Facebook desde tu panel, para tu ciudad y para mayores de {{ props.minAge }}. Tú
      defines cuánto invertir por día y por cuántos días, y lo pausas cuando quieras. Meta cobra el gasto directo en tu
      cuenta publicitaria y ves cuántas entradas vendió cada anuncio.
    </p>

    <div class="ad-form-card">
      <div v-if="!launched" class="ad-form">
        <div>
          <p class="ad-row"><label for="cl-ad-budget">Presupuesto diario</label><span class="cl-tabular">{{ formatCLP(budget) }}</span></p>
          <input
            id="cl-ad-budget"
            v-model.number="budget"
            type="range"
            :min="CLUB_ADS_DEMO.budgetMin"
            :max="CLUB_ADS_DEMO.budgetMax"
            :step="CLUB_ADS_DEMO.budgetStep"
            class="cl-range"
            :aria-valuetext="formatCLP(budget)"
          />
        </div>
        <div class="ad-wide">
          <p class="ad-row"><label for="cl-ad-days">Días</label><span class="cl-tabular">{{ days }}</span></p>
          <input id="cl-ad-days" v-model.number="days" type="range" :min="props.minDays" :max="demoMaxDays" step="1" class="cl-range" :aria-valuetext="daysLabel" />
          <p class="cl-note ad-note">En tu panel, hasta {{ props.maxDays }} días.</p>
        </div>
        <ul class="ad-chips" aria-label="Público">
          <li class="ad-chip">Santiago · {{ props.radiusKm }} km</li>
          <li class="ad-chip">{{ props.minAge }}–{{ CLUB_ADS_DEMO.ageMax }} años</li>
          <li class="ad-chip is-disabled" aria-disabled="true">Música electrónica <SoonBadge dark /></li>
        </ul>
        <button ref="launchButton" type="button" class="cl-btn cl-btn-lime ad-cta" data-testid="club-ads-launch" @click="setLaunched(true)">
          <span class="ad-wide">Impulsar · <span class="cl-tabular">{{ formatCLP(total) }}</span> en total</span>
          <span class="ad-narrow">Impulsar {{ daysLabel }} · <span class="cl-tabular">{{ formatCLP(total) }}</span></span>
        </button>
      </div>
      <div v-else class="ad-on" role="status">
        <span class="ad-check" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>
        </span>
        <p class="ad-on-title">Anuncio activo · {{ daysLabel }}</p>
        <p class="ad-on-sub"><span class="cl-tabular">{{ formatCLP(total) }}</span> en total</p>
        <button ref="pauseButton" type="button" class="ad-pause" @click="setLaunched(false)">Pausar</button>
      </div>
      <p class="cl-example">Demostración: aquí no se crea ningún anuncio.</p>
    </div>
  </div>
</template>

<style scoped>
.ad {
  min-width: 0;
  padding: 18px;
}
.ad-badge {
  display: inline-flex;
  padding: 4px 10px;
  border: 1px solid var(--cl-line-glow);
  border-radius: 999px;
  font-size: 11px;
  color: var(--cl-text-1);
}
.ad-title {
  margin-top: 14px;
  font-size: 22px;
  line-height: 28px;
  font-weight: 700;
}
.ad-text {
  margin-top: 10px;
  font-size: 15px;
  line-height: 23px;
  color: var(--cl-text-2);
}
.ad-form-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
  padding: 16px;
  border: 1px solid var(--cl-line);
  border-radius: 12px;
  background: var(--cl-noche-2);
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
  border-radius: 10px;
  background: var(--cl-noche-3);
  font-size: 12px;
}
.ad-chip.is-disabled {
  color: var(--cl-text-3);
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
  border-radius: 12px;
  background: var(--brand-lime);
  color: var(--cl-ink);
  animation: cl-pop 320ms var(--ease-spring) both;
}
.ad-on-title {
  font-weight: 600;
}
.ad-on-sub {
  font-size: 14px;
  color: var(--cl-text-3);
}
.ad-pause {
  min-height: 44px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: none;
  font: inherit;
  font-size: 14px;
  color: var(--cl-text-2);
  text-decoration: underline;
  cursor: pointer;
}
.ad-pause:focus-visible {
  outline: 2px solid var(--cl-uv-soft);
  outline-offset: 2px;
}
@media (min-width: 1024px) {
  .ad {
    padding: 22px;
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
