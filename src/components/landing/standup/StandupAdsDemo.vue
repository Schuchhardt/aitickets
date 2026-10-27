<script setup>
// Card de anuncios de la landing de stand-up (SPEC_landing_standup §4.4 y S13). Los anuncios existen (Meta vía Zernio,
// netlify/lib/zernio-ads.mjs): presupuesto diario, días, ciudad con radio y rango de edad; Meta cobra el gasto directo
// en la cuenta publicitaria de la productora. Segmentar por intereses ("Comedia y stand-up") no existe: va con "Pronto".
// Es una demostración: no se crea nada y no se muestran alcances ni resultados estimados. Al impulsar se mide
// su_ads_demo { budget, days }. En mobile: un solo slider (presupuesto) y "Impulsar N días · total".
import SoonBadge from '../../ui/SoonBadge.vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { useAdsDemo } from '../../../composables/useAdsDemo.js'
import { formatCLP } from '../producerLanding.js'

const { budget, days, launched, total, daysLabel, launchButton, pauseButton, setLaunched } = useAdsDemo({
  budget: 10000,
  days: 3,
  onLaunch: (params) => trackEvent('su_ads_demo', params),
})
</script>

<template>
  <div class="sad" data-testid="standup-ads-demo">
    <div class="sad-copy">
      <p class="sad-badge">QUEDAN 23 ENTRADAS · FALTAN 3 DÍAS</p>
      <h3 class="sad-title">¿Necesitas un empujón? <span class="sad-serif">Impulsa con anuncios.</span></h3>
      <p class="sad-text">
        Lanza una campaña en Instagram y Facebook desde tu panel, para tu ciudad y la edad de tu público. Tú decides
        cuánto invertir y la pausas cuando quieras. Meta cobra el gasto directo en tu cuenta publicitaria.
      </p>
    </div>

    <div class="sad-form-card">
      <div v-if="!launched" class="sad-form">
        <div>
          <p class="sad-row"><label for="sad-budget">Presupuesto diario</label><span class="ev-tabular">{{ formatCLP(budget) }}</span></p>
          <input id="sad-budget" v-model.number="budget" type="range" min="3000" max="50000" step="1000" class="su-range" :aria-valuetext="formatCLP(budget)" />
        </div>
        <div class="sad-wide">
          <p class="sad-row"><label for="sad-days">Días</label><span class="ev-tabular">{{ days }}</span></p>
          <input id="sad-days" v-model.number="days" type="range" min="1" max="7" step="1" class="su-range" :aria-valuetext="daysLabel" />
        </div>
        <ul class="sad-chips sad-wide" aria-label="Público">
          <li>Santiago + 25 km</li>
          <li>20–45 años</li>
          <li>Comedia y stand-up <SoonBadge /></li>
        </ul>
        <button ref="launchButton" type="button" class="sad-cta" data-testid="standup-ads-launch" @click="setLaunched(true)">
          <span class="sad-wide">Impulsar · <span class="ev-tabular">{{ formatCLP(total) }}</span> en total</span>
          <span class="sad-narrow">Impulsar {{ daysLabel }} · <span class="ev-tabular">{{ formatCLP(total) }}</span></span>
        </button>
      </div>
      <div v-else class="sad-on" role="status">
        <span class="sad-check su-pop" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>
        </span>
        <p class="sad-on-title">Campaña activa · {{ daysLabel }}</p>
        <p class="sad-on-sub"><span class="ev-tabular">{{ formatCLP(total) }}</span> en total</p>
        <button ref="pauseButton" type="button" class="sad-pause" @click="setLaunched(false)">Pausar</button>
      </div>
      <p class="sad-example">Demostración: aquí no se crea ningún anuncio.</p>
    </div>
  </div>
</template>

<style scoped>
.sad {
  display: grid;
  gap: 18px;
  padding: 20px;
  border-radius: 22px;
  background: var(--sb-paper);
  color: var(--sb-ground);
}
.sad-badge {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 999px;
  background: #ffe9d6;
  color: var(--warning-text);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
}
.sad-title {
  margin-top: 12px;
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 20px;
  font-weight: 700;
  line-height: 26px;
  letter-spacing: -0.02em;
}
.sad-serif {
  font-family: "Fraunces", Georgia, serif;
  font-style: italic;
  font-weight: 400;
  color: var(--sb-ink-3);
}
.sad-text {
  margin-top: 10px;
  font-size: 15px;
  line-height: 23px;
  color: var(--sb-ink-2);
}
.sad-form-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border-radius: 18px;
  background: #fff;
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
  font-weight: 600;
}
.sad-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sad-chips li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--sb-paper);
  font-size: 12px;
}
.sad-chips :deep(.soon) {
  height: 18px;
  background: #e6ddd2;
  color: var(--sb-ink-2);
}
.sad-cta {
  min-height: 48px;
  border: 0;
  border-radius: 999px;
  background: var(--sb-ground);
  color: var(--sb-text-1);
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: transform var(--dur-1) var(--ease-out);
}
.sad-cta:hover {
  transform: translateY(-1px);
}
.sad-cta:active {
  transform: scale(0.98);
}
.sad-cta:focus-visible,
.sad-pause:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px #fff, 0 0 0 6px var(--sb-ground);
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
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--brand-lime);
}
.sad-on-title {
  font-weight: 600;
}
.sad-on-sub {
  font-size: 14px;
  color: var(--sb-ink-3);
}
.sad-pause {
  padding: 2px 4px;
  border: 0;
  border-radius: 4px;
  background: none;
  font: inherit;
  font-size: 13px;
  color: var(--sb-ink-3);
  text-decoration: underline;
  cursor: pointer;
}
.sad-example {
  font-size: 11px;
  line-height: 16px;
  color: var(--sb-ink-3);
}
@media (min-width: 900px) {
  .sad {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: center;
    gap: 28px;
    padding: 24px;
    border-radius: 24px;
  }
  .sad-title {
    font-size: 26px;
    line-height: 32px;
  }
  .sad-wide {
    display: revert;
  }
  .sad-chips.sad-wide {
    display: flex;
  }
  .sad-narrow {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sad-cta {
    transition-duration: 1ms;
  }
}
</style>
