<script setup>
// Panel de ejemplo del "Con AI Tickets" en el comparador de academias (SPEC_landing_academias §3.3): entradas de la
// muestra, barras por curso (cada curso con su link con seguimiento: las métricas por canal del evento) y dos mini
// cards. AC8: con movimiento, las barras crecen de scaleX(0) a su valor (900 ms, stagger 90 ms) cuando `active` pasa a
// true; sin movimiento quedan en su valor. La lista de asistentes es el CSV de órdenes del evento (nombre, correo y
// el link que trajo cada compra); separarla por función todavía no existe: va con "Pronto".
import SoonBadge from '../../ui/SoonBadge.vue'
import { courseScales } from './academiasLanding.js'

const props = defineProps({
  // { name, when, venue, sold, capacity, courses: [{ name, tickets }], revenueLabel, payoutNote }
  dashboard: { type: Object, required: true },
  active: { type: Boolean, required: true },
  animated: { type: Boolean, required: true },
})

const scales = courseScales(props.dashboard.courses)
</script>

<template>
  <div class="cb" :class="{ 'is-animated': props.animated, 'is-active': props.active }">
    <div class="cb-head">
      <div>
        <p class="cb-label">Tu panel · ejemplo</p>
        <p class="cb-name">{{ props.dashboard.name }}</p>
        <p class="cb-meta">{{ props.dashboard.when }} · {{ props.dashboard.venue }}</p>
      </div>
      <p class="cb-count">
        <span class="cb-count-n ev-tabular">{{ props.dashboard.sold }}</span>
        <span class="cb-label">de {{ props.dashboard.capacity }} entradas</span>
      </p>
    </div>

    <div>
      <p class="cb-label cb-courses-title">Por curso</p>
      <ul class="cb-courses">
        <li v-for="(c, i) in props.dashboard.courses" :key="c.name" class="cb-course">
          <span class="cb-course-name">{{ c.name }}</span>
          <span class="cb-track" aria-hidden="true">
            <span class="cb-bar" :style="{ '--cb-scale': scales[i].toFixed(3), '--cb-d': `${200 + i * 90}ms` }"></span>
          </span>
          <span class="cb-course-n ev-tabular">{{ c.tickets }}</span>
        </li>
      </ul>
    </div>

    <div class="cb-cards">
      <div class="cb-card">
        <p class="cb-label">Recaudado</p>
        <p class="cb-money ev-tabular">{{ props.dashboard.revenueLabel }}</p>
        <p class="cb-note">{{ props.dashboard.payoutNote }}</p>
      </div>
      <div class="cb-card cb-card-export">
        <p class="cb-label">Lista de asistentes</p>
        <p class="cb-action">Descargar <span aria-hidden="true">↓</span></p>
        <p class="cb-note">Con nombre, correo y curso</p>
        <p class="cb-note cb-soon">Por función <SoonBadge dark /></p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cb {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border-radius: 22px;
  background: var(--ac-ink);
  color: var(--ac-on-ink-1);
}
.cb-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.cb-label {
  font-size: 12px;
  color: var(--ac-on-ink-3);
}
.cb-name {
  margin-top: 2px;
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 15px;
  font-weight: 700;
}
.cb-meta {
  display: none;
  font-size: 14px;
  color: var(--ac-on-ink-2);
}
.cb-count {
  text-align: right;
}
.cb-count-n {
  display: block;
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
}
.cb-courses-title {
  margin-bottom: 4px;
}
.cb-course {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr) 28px;
  gap: 10px;
  align-items: center;
  margin-top: 8px;
  font-size: 13px;
}
.cb-track {
  height: 6px;
  border-radius: 3px;
  background: rgba(251, 247, 240, 0.1);
  overflow: hidden;
}
.cb-bar {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--brand-lime);
  transform: scaleX(var(--cb-scale));
  transform-origin: left;
}
.cb-course-n {
  text-align: right;
}
/* AC8: barras que crecen al mostrarse el panel */
.cb.is-animated .cb-bar {
  transform: scaleX(0);
  transition: transform 900ms var(--ease-out) var(--cb-d);
}
.cb.is-animated.is-active .cb-bar {
  transform: scaleX(var(--cb-scale));
}
.cb-cards {
  margin-top: auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.cb-card {
  padding: 12px;
  border-radius: 14px;
  background: rgba(251, 247, 240, 0.06);
}
.cb-money {
  margin-top: 2px;
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 15px;
  font-weight: 700;
}
.cb-action {
  margin-top: 4px;
  font-size: 14px;
  font-weight: 600;
}
.cb-note {
  margin-top: 2px;
  font-size: 12px;
  line-height: 16px;
  color: var(--ac-on-ink-2);
}
.cb-soon {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
@media (min-width: 768px) {
  .cb {
    gap: 18px;
    padding: 28px;
    border-radius: 28px;
  }
  .cb-name {
    margin-top: 4px;
    font-size: 19px;
  }
  .cb-meta {
    display: block;
  }
  .cb-count-n {
    font-size: 30px;
  }
  .cb-label {
    font-size: 12px;
  }
  .cb-courses-title {
    font-size: 13px;
    margin-bottom: 6px;
  }
  .cb-course {
    grid-template-columns: 130px minmax(0, 1fr) 34px;
    gap: 12px;
    margin-top: 9px;
    font-size: 14px;
  }
  .cb-track {
    height: 8px;
    border-radius: 4px;
  }
  .cb-cards {
    gap: 12px;
  }
  .cb-card {
    padding: 14px;
    border-radius: 16px;
  }
  .cb-money {
    font-size: 18px;
  }
  .cb-action {
    font-size: 15px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cb.is-animated .cb-bar {
    transform: scaleX(var(--cb-scale));
    transition: none;
  }
}
</style>
