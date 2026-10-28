<script setup>
// "Una compra, ocho personas" (SPEC_landing_seminarios §4.4): la orden de una empresa con 8 pases completos. Total
// pagado = 8 × lo que paga el público por un pase (priceQuote → fees.mjs: $525.696). Cada entrada con su "Ver QR"
// (src/pages/ticket/[id].astro; aquí no navega) y, en las tres primeras, a quién se la reenvió quien compró.
// "Poner cada entrada a nombre de su titular": la fila 2 se despliega con el titular nuevo y el aviso real del cambio
// (transfer_ticket de tools/postsale.ts: QR nuevo a su correo y el anterior deja de servir), que hoy hace tu equipo desde
// el asistente de IA. Si el evento pide el nombre de cada asistente (events.checkout_fields.attendee_names), la empresa
// los escribe al comprar y a cada uno le llega su QR (CheckoutExtras.vue, tickets-email.mjs): va como nota, sin "Pronto".
// Mobile: filas 1–3 y "Ver las 8". C9: las filas entran con stagger de 50 ms; la fila se despliega con clip-path +
// translateY y el QR viejo se tacha con un filete que crece (scaleX). Con "reducir movimiento", sin animaciones.
// Analítica: se_team_assign (al activar el titular).
import { computed, ref } from 'vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { formatCLP } from '../producerLanding.js'
import { MAX_PER_ORDER_AI, TEAM_ORDER, teamOrderTotal } from './seminariosLanding.js'

const props = defineProps({
  /** DEFAULT_MAX_PER_PURCHASE (Reservation/pricing.js) */
  maxPerPurchase: { type: Number, required: true },
})

const assigned = ref(false)
const showAll = ref(false)
const total = formatCLP(teamOrderTotal())
const rows = computed(() =>
  Array.from({ length: TEAM_ORDER.qty }, (_, i) => ({
    n: i + 1,
    to: TEAM_ORDER.recipients[i] ?? null,
    holder: assigned.value && i === TEAM_ORDER.holder.index,
  })),
)

function onAssign(e) {
  assigned.value = e.target.checked
  if (assigned.value) {
    showAll.value = showAll.value || TEAM_ORDER.holder.index >= 3
    trackEvent('se_team_assign', {})
  }
}
</script>

<template>
  <div class="to se-card" data-testid="seminar-team-order">
    <div class="to-head">
      <p class="se-example">ejemplo</p>
      <p class="se-h3 to-title">Una compra, ocho personas</p>
      <p class="to-buyer">Comprador: <strong>{{ TEAM_ORDER.buyer }}</strong> · {{ TEAM_ORDER.area }}</p>
      <p class="to-sum">
        <span class="se-tabular">{{ TEAM_ORDER.qty }} × {{ TEAM_ORDER.ticket }}</span>
        <span>Total pagado <strong class="se-tabular" data-testid="seminar-team-total">{{ total }}</strong></span>
      </p>
    </div>

    <ol class="to-rows" :class="{ 'is-all': showAll }">
      <li v-for="r in rows" :key="r.n" class="to-row" :style="{ '--i': r.n - 1 }">
        <div class="to-line">
          <span class="se-tabular">Entrada {{ r.n }} de {{ TEAM_ORDER.qty }}</span>
          <span v-if="r.to && !r.holder" class="se-meta to-to">→ {{ r.to }}</span>
          <span class="to-qr" :class="{ 'is-old': r.holder }">Ver QR</span>
        </div>
        <div v-if="r.holder" class="to-holder" role="status">
          <p><strong>{{ TEAM_ORDER.holder.name }}</strong> · {{ TEAM_ORDER.holder.email }}</p>
          <p>→ QR nuevo enviado. El anterior deja de servir.</p>
          <p class="se-meta">Lo hace tu equipo desde tu asistente de IA.</p>
        </div>
      </li>
    </ol>
    <button v-if="!showAll" type="button" class="to-more se-focus" @click="showAll = true">Ver las {{ TEAM_ORDER.qty }}</button>

    <label class="se-toggle to-toggle">
      <input type="checkbox" :checked="assigned" data-testid="seminar-team-assign" @change="onAssign" />
      Poner cada entrada a nombre de su titular
    </label>
    <p class="se-note to-names" data-testid="seminar-team-names">
      ¿Quieres los nombres desde el principio? Activa "Nombre de cada asistente" en tu evento: la empresa escribe el nombre y
      el correo de cada persona al comprar y a cada una le llega su QR.
    </p>
    <p class="se-note to-note">
      Hasta {{ props.maxPerPurchase }} entradas por compra si no lo cambias; se sube hasta {{ MAX_PER_ORDER_AI }} desde tu asistente de IA.
    </p>
  </div>
</template>

<style scoped>
.to {
  padding: 18px;
  border-color: var(--se-grafito);
}
.to-title {
  margin-top: 6px;
}
.to-buyer {
  margin-top: 8px;
  font-size: 15px;
}
.to-sum {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 16px;
  margin-top: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--se-grafito);
  font-size: 15px;
}
.to-rows {
  margin-top: 4px;
}
.to-row {
  border-bottom: 1px solid var(--se-filete);
}
@media (max-width: 767px) {
  .to-rows:not(.is-all) .to-row:nth-child(n + 4) {
    display: none;
  }
}
.to-line {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  font-size: 14px;
}
.to-to {
  color: var(--se-cordon-ink);
}
.to-qr {
  position: relative;
  margin-left: auto;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.to-qr::after {
  content: "";
  position: absolute;
  left: -2px;
  right: -2px;
  top: 50%;
  height: 2px;
  background: var(--se-grafito);
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 300ms var(--se-ease);
}
.to-qr.is-old {
  color: var(--se-text-3);
}
.to-qr.is-old::after {
  transform: scaleX(1);
}
.to-holder {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0 0 10px;
  padding: 10px 12px;
  border-left: 3px solid var(--se-cordon);
  background: var(--se-cordon-claro);
  font-size: 14px;
  animation: to-open 320ms var(--se-ease) both;
}
@keyframes to-open {
  from {
    clip-path: inset(0 0 100% 0);
    transform: translateY(-6px);
  }
  to {
    clip-path: inset(0 0 0 0);
    transform: none;
  }
}
.to-more {
  min-height: 44px;
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}
.to-toggle {
  margin-top: 12px;
}
.to-names,
.to-note {
  margin-top: 10px;
}
@media (min-width: 768px) {
  .to {
    padding: 24px;
  }
  .to-more {
    display: none;
  }
}
/* C9: las filas entran con stagger de 50 ms (solo con movimiento). En Vue, todo lo que sigue a :global() se descarta: el
   selector completo va dentro (las clases to- son de este componente). */
:global(.lp-motion [data-lp-reveal]:not(.is-in) .to-row) {
  opacity: 0;
  transform: translateY(8px);
}
:global(.lp-motion .is-in .to-row) {
  transition: opacity 300ms var(--se-ease), transform 300ms var(--se-ease);
  transition-delay: calc(var(--i) * 50ms);
}
@media (prefers-reduced-motion: reduce) {
  .to-holder {
    animation: none;
  }
  .to-qr::after {
    transition: none;
  }
}
</style>
