<script setup>
// "Así lo ve tu público" (SPEC_landing_fiestas §4.3, dentro de PresaleStairs): el checkout simplificado de la fiesta de
// ejemplo con los rótulos reales según el día de la simulación (CheckoutStepChoose.vue): la etapa agotada "Agotada" con
// su pulsera cortada, la que está a la venta con su precio y el cargo (SERVICE_FEE_NOTE de fees.mjs), y las que abren
// después atenuadas con "Disponible desde el {formatSaleStart}". Una etapa que cerró con cupo al abrir la siguiente ya
// no aparece (eventPage.ts solo atenúa agotadas y por abrir). Arriba, el rótulo de la card (cardLabel): "Últimas
// entradas" cuando a la etapa a la venta le queda menos del 30%. Mobile: solo la que está a la venta y la siguiente.
import { computed } from 'vue'
import { formatCLP } from '../producerLanding.js'
import { formatSaleStart } from '../../event/eventView.js'
import { SERVICE_FEE_NOTE } from '../../../../netlify/lib/fees.mjs'
import { PARTY_NAME, STAGE_OPEN_DAYS, buyerRows } from './fiestasLanding.js'

const props = defineProps({
  stages: { type: Array, required: true },
  /** Fotograma del día (playPresale) o null antes de abrir la preventa */
  frame: { type: Object, default: null },
  /** Apertura de cada etapa por defecto (ISO), en el orden de STAGE_OPEN_DAYS */
  openings: { type: Array, required: true },
  /** Fecha y hora de la fiesta ("Sáb 28 nov · 23:00") */
  dateLabel: { type: String, required: true },
})

const view = computed(() => buyerRows(props.stages, props.frame))
const openingOf = (row) => props.openings[STAGE_OPEN_DAYS.indexOf(props.stages[row.i].opensDay)]
// Mobile: la que está a la venta (o, si no hay, la próxima por abrir) y la siguiente
const firstShown = computed(() => {
  const rows = view.value.rows
  const on = rows.findIndex((r) => r.status === 'available')
  const next = on >= 0 ? on : rows.findIndex((r) => r.status === 'upcoming')
  return next >= 0 ? next : Math.max(0, rows.length - 2)
})
</script>

<template>
  <div class="bp" data-testid="party-buyer-preview">
    <p class="fi-meta bp-kicker">Así lo ve tu público</p>
    <p class="bp-title">{{ PARTY_NAME }}</p>
    <p class="fi-meta bp-date">{{ dateLabel }}</p>
    <p class="bp-label">
      <span v-if="view.label" class="fi-state" :class="{ 'fi-state-out': view.label === 'Agotado' }" data-testid="party-buyer-label">{{ view.label }}</span>
    </p>
    <ul class="bp-rows">
      <li
        v-for="(row, n) in view.rows"
        :key="row.name"
        class="bp-row"
        :class="{ 'fi-dim': row.status === 'upcoming', 'is-extra': n < firstShown || n > firstShown + 1 }"
        :data-status="row.status"
      >
        <div class="bp-info">
          <p class="bp-price fi-tabular">{{ formatCLP(row.price) }}</p>
          <p class="bp-name">{{ row.name }}</p>
          <p v-if="row.status === 'sold_out'" class="bp-sub">
            <span class="fi-band fi-band-mini is-cut" :class="`fi-band--${row.color}`" style="--tilt: 0deg" aria-hidden="true">
              <span class="fi-band-strip"><span class="fi-band-half fi-band-a"></span><span class="fi-band-half fi-band-b"></span></span>
            </span>
            Agotada
          </p>
          <p v-else-if="row.status === 'upcoming'" class="bp-sub">Disponible desde el {{ formatSaleStart(openingOf(row)) }}</p>
          <p v-else class="bp-sub">{{ SERVICE_FEE_NOTE }}</p>
        </div>
        <span v-if="row.status === 'available'" class="bp-stepper" aria-hidden="true"><span>−</span><span>0</span><span>+</span></span>
      </li>
    </ul>
    <p v-if="!view.rows.some((r) => r.status === 'available') && frame && !view.rows.every((r) => r.status === 'sold_out')" class="bp-none">
      Sin entradas a la venta hasta el lunes
    </p>
  </div>
</template>

<style scoped>
.bp {
  padding: 18px;
  border: 2px solid var(--fi-tinta);
  border-radius: 18px;
  background: var(--fi-crema);
  color: var(--fi-tinta);
  box-shadow: 4px 4px 0 var(--fi-tinta);
}
.bp .fi-meta {
  color: var(--fi-text-3);
}
.bp-title {
  margin-top: 6px;
  font-family: var(--fi-display);
  font-size: 26px;
  line-height: 28px;
}
.bp-date {
  margin-top: 4px;
}
.bp-label {
  min-height: 26px;
  margin-top: 10px;
}
.bp-rows {
  margin-top: 8px;
  border-top: 2px solid var(--fi-tinta);
}
.bp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  transition: opacity 200ms var(--ease-out);
}
.bp-price {
  font-weight: 700;
  font-size: 16px;
}
.bp-name {
  font-size: 14px;
  font-weight: 600;
}
.bp-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  font-size: 12px;
  line-height: 16px;
  color: var(--fi-text-3);
}
.bp-row[data-status='sold_out'] .bp-sub {
  font-weight: 700;
  color: var(--fi-tinta);
}
.bp-stepper {
  flex: 0 0 auto;
  display: inline-flex;
  gap: 12px;
  padding: 4px 12px;
  border: 2px solid var(--fi-tinta);
  border-radius: 999px;
  font-weight: 700;
}
.bp-none {
  margin-top: 10px;
  font-size: 13px;
  font-weight: 700;
}
@media (max-width: 767px) {
  .bp-row.is-extra {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bp-row {
    transition: none;
  }
}
</style>
