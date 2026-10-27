<script setup>
// Card de anuncios de "Difusión" (SPEC_landing_seminarios §4.5): piel sobria sobre la misma lógica de las demos de
// stand-up, música, clubs y fiestas (useAdsDemo: presupuesto × días, estado activo y foco). Los anuncios existen (Meta vía
// Zernio, netlify/lib/zernio-ads.mjs): presupuesto diario, días, ciudad con radio y edad desde AD_LIMITS.defaultAgeMin
// (AD_LIMITS llega por props); Meta cobra el gasto directo. Segmentar por profesión o intereses ("Recursos humanos") no
// existe: chip deshabilitado con "Pronto". Es una demostración: no crea nada ni muestra alcances o resultados estimados.
// Mobile: un solo slider (presupuesto) y los días fijos en 3. Analítica: se_ads_demo { budget, days }.
import SoonBadge from '../../ui/SoonBadge.vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { useAdsDemo } from '../../../composables/useAdsDemo.js'
import { formatCLP } from '../producerLanding.js'
import { SEMINAR_ADS_DEMO } from './seminariosLanding.js'

const props = defineProps({
  /** AD_LIMITS de zernio-ads.mjs */
  minDays: { type: Number, required: true },
  maxDays: { type: Number, required: true },
  minAge: { type: Number, required: true },
  radiusKm: { type: Number, required: true },
})

const { budget, days, launched, total, daysLabel, launchButton, pauseButton, setLaunched } = useAdsDemo({
  budget: SEMINAR_ADS_DEMO.budget,
  days: SEMINAR_ADS_DEMO.days,
  onLaunch: (params) => trackEvent('se_ads_demo', params),
})
const demoMaxDays = Math.min(SEMINAR_ADS_DEMO.daysMax, props.maxDays)
</script>

<template>
  <div class="sad se-card" data-testid="seminar-ads-demo">
    <p class="se-meta sad-badge">Quedan 38 · Faltan 9 días</p>
    <h3 class="se-h3 sad-title">¿Faltan inscritos? Impúlsalo.</h3>
    <p class="sad-text">
      Lanza un anuncio en Instagram y Facebook desde tu panel, para tu ciudad y desde los {{ props.minAge }} años. Defines
      cuánto invertir por día y por cuántos días, y lo pausas cuando quieras. Meta cobra el gasto directo en tu cuenta
      publicitaria y ves cuántas entradas vendió cada anuncio.
    </p>

    <div class="sad-form-card">
      <div v-if="!launched" class="sad-form">
        <div>
          <p class="sad-row"><label for="se-ad-budget">Presupuesto diario</label><span class="se-tabular">{{ formatCLP(budget) }}</span></p>
          <input
            id="se-ad-budget"
            v-model.number="budget"
            type="range"
            :min="SEMINAR_ADS_DEMO.budgetMin"
            :max="SEMINAR_ADS_DEMO.budgetMax"
            :step="SEMINAR_ADS_DEMO.budgetStep"
            class="se-range"
            :aria-valuetext="formatCLP(budget)"
          />
        </div>
        <div class="sad-wide">
          <p class="sad-row"><label for="se-ad-days">Días</label><span class="se-tabular">{{ days }}</span></p>
          <input id="se-ad-days" v-model.number="days" type="range" :min="props.minDays" :max="demoMaxDays" step="1" class="se-range" :aria-valuetext="daysLabel" />
          <p class="se-note">Hasta {{ props.maxDays }} días.</p>
        </div>
        <ul class="sad-chips" aria-label="Público">
          <li class="sad-chip">Santiago · {{ props.radiusKm }} km</li>
          <li class="sad-chip">{{ props.minAge }}–{{ SEMINAR_ADS_DEMO.ageMax }} años</li>
          <li class="sad-chip is-disabled" aria-disabled="true">Recursos humanos <SoonBadge /></li>
        </ul>
        <button ref="launchButton" type="button" class="se-btn se-btn-solid sad-cta" data-testid="seminar-ads-launch" @click="setLaunched(true)">
          <span>Impulsar · <span class="se-tabular">{{ formatCLP(total) }}</span> en total</span>
          <span class="se-btn-arrow" aria-hidden="true">→</span>
        </button>
      </div>
      <div v-else class="sad-on" role="status">
        <span class="sad-check" aria-hidden="true">✓</span>
        <p class="sad-on-title">Anuncio activo · {{ daysLabel }}</p>
        <p class="sad-on-sub"><span class="se-tabular">{{ formatCLP(total) }}</span> en total</p>
        <button ref="pauseButton" type="button" class="sad-pause se-focus" @click="setLaunched(false)">Pausar</button>
      </div>
      <p class="se-example">Demostración: aquí no se crea ningún anuncio.</p>
    </div>
  </div>
</template>

<style scoped>
.sad {
  min-width: 0;
  padding: 20px;
}
.sad-badge {
  display: inline-block;
  padding: 4px 8px;
  border: 1px solid var(--se-grafito);
  border-radius: 2px;
  color: var(--se-grafito);
}
.sad-title {
  margin-top: 14px;
}
.sad-text {
  margin-top: 10px;
  font-size: 15px;
  line-height: 23px;
  color: var(--se-text-2);
}
.sad-form-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
  padding: 16px;
  border: 1px solid var(--se-filete);
  border-radius: 4px;
  background: var(--se-papel);
}
.sad-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sad-row {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 700;
}
.sad-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sad-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 3px 10px;
  border: 1px solid var(--se-grafito);
  border-radius: 2px;
  background: #ffffff;
  font-size: 12px;
  font-weight: 600;
}
.sad-chip.is-disabled {
  border-style: dashed;
  color: var(--se-text-3);
}
.sad-cta {
  font-size: 15px;
}
.sad-wide {
  display: none;
}
.sad-on {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  text-align: center;
}
.sad-check {
  width: 48px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--se-cordon-ink);
  color: #ffffff;
  font-size: 22px;
  font-weight: 700;
}
.sad-on-title {
  font-weight: 700;
}
.sad-on-sub {
  font-size: 14px;
  color: var(--se-text-3);
}
.sad-pause {
  min-height: 44px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--se-grafito);
  text-decoration: underline;
  cursor: pointer;
}
@media (min-width: 1024px) {
  .sad {
    padding: 24px;
  }
  .sad-wide {
    display: block;
  }
}
</style>
