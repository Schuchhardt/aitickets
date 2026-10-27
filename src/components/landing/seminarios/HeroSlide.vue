<script setup>
// Una lámina del hero (SPEC_landing_seminarios §4.1), sin pie: la usan la pantalla de la foto (desktop) y el carrusel
// (mobile). Las medidas van en unidades del contenedor (cqw): la misma lámina se lee a 300 px dentro del telón y a ancho
// completo en el carrusel. Datos de ejemplo de seminariosLanding.js: el programa del Día 1 con el keynote elegido, los
// inscritos por tipo de entrada (248 de 260) y el contador real del escáner ("{n} / {m} entradas validadas").
// [data-se-target]: la cifra o el bloque al que apunta el puntero (HeroScreen).
import { computed } from 'vue'
import { HERO_REGISTERED, ISSUED_TICKETS, SEMINAR_CAPACITY, formatById, registeredTotal } from './seminariosLanding.js'

const props = defineProps({
  /** 'programa' | 'inscritos' | 'acreditacion' */
  slide: { type: String, required: true },
  validated: { type: Number, required: true },
})

const blocks = formatById('congreso').days[0].blocks.filter((b) => ['09:00', '09:15', '10:30'].includes(b.time))
const total = registeredTotal()
const shares = computed(() => HERO_REGISTERED.map((r) => ({ ...r, pct: (r.count / SEMINAR_CAPACITY) * 100 })))
</script>

<template>
  <div class="hs" :data-slide="props.slide">
    <template v-if="props.slide === 'programa'">
      <p class="hs-kicker">Programa · Día 1</p>
      <ul class="hs-program">
        <li v-for="b in blocks" :key="b.key" class="hs-row" :class="{ 'is-focus': b.focus, 'is-pause': b.kind === 'pause' }" :data-se-target="b.focus ? '' : undefined">
          <span class="hs-time">{{ b.time }}</span><span>{{ b.title }}</span>
        </li>
      </ul>
    </template>

    <template v-else-if="props.slide === 'inscritos'">
      <p class="hs-kicker">Inscritos</p>
      <p class="hs-big"><span data-se-target>{{ total }}</span> <span class="hs-of">de {{ SEMINAR_CAPACITY }} · ejemplo</span></p>
      <div class="hs-bar" aria-hidden="true">
        <span v-for="(s, i) in shares" :key="s.id" class="hs-seg" :class="`is-${i}`" :style="{ width: `${s.pct}%` }"></span>
      </div>
      <ul class="hs-legend">
        <li v-for="(s, i) in shares" :key="s.id"><span class="hs-key" :class="`is-${i}`" aria-hidden="true"></span>{{ s.name }} · {{ s.count }}</li>
      </ul>
    </template>

    <template v-else>
      <p class="hs-kicker">Acreditación</p>
      <p class="hs-big"><span data-se-target>{{ props.validated }} / {{ ISSUED_TICKETS }}</span></p>
      <p class="hs-sub">entradas validadas</p>
      <p class="hs-kicker hs-desk">08:47 · Mesa 2</p>
    </template>
  </div>
</template>

<style scoped>
.hs {
  container-type: inline-size;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 3cqw;
  padding: 5cqw 6cqw;
  color: var(--se-grafito);
  font-family: var(--se-font);
}
.hs-kicker {
  font-size: max(9px, 3.6cqw);
  line-height: 1.3;
  font-weight: 600;
  font-stretch: 75%;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--se-text-3);
}
.hs-program {
  display: flex;
  flex-direction: column;
}
.hs-row {
  display: grid;
  grid-template-columns: 16cqw minmax(0, 1fr);
  gap: 3cqw;
  padding: 2.4cqw 2cqw;
  border-bottom: 1px solid var(--se-filete);
  font-family: "Prompt", system-ui, sans-serif;
  font-size: max(10px, 4.2cqw);
  line-height: 1.25;
}
.hs-row.is-focus {
  background: var(--se-cordon-claro);
  box-shadow: inset 3px 0 0 var(--se-cordon);
}
.hs-row.is-pause {
  color: var(--se-text-3);
}
.hs-time {
  font-family: var(--se-font);
  font-weight: 600;
  font-stretch: 75%;
  font-variant-numeric: tabular-nums;
  color: var(--se-text-3);
}
.hs-big {
  font-size: 12cqw;
  line-height: 1;
  font-weight: 800;
  font-stretch: 125%;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.hs-of,
.hs-sub {
  font-size: max(10px, 4.2cqw);
  font-weight: 600;
  font-stretch: 75%;
  letter-spacing: 0.02em;
  color: var(--se-text-2);
}
.hs-bar {
  display: flex;
  height: 4.4cqw;
  min-height: 6px;
  border: 1px solid var(--se-grafito);
  background: var(--se-papel);
}
.hs-seg,
.hs-key {
  display: block;
  height: 100%;
}
/* Cuatro tipos por trama (nunca solo color) */
.is-0 {
  background: var(--se-cordon);
}
.is-1 {
  background: var(--se-grafito);
}
.is-2 {
  background: repeating-linear-gradient(135deg, var(--se-cordon) 0 3px, #ffffff 3px 6px);
}
.is-3 {
  background: repeating-linear-gradient(90deg, var(--se-grafito) 0 1px, #ffffff 1px 4px);
}
.hs-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 1.6cqw 4cqw;
  font-family: "Prompt", system-ui, sans-serif;
  font-size: max(9px, 3.4cqw);
  line-height: 1.3;
  color: var(--se-text-2);
}
.hs-legend li {
  display: inline-flex;
  align-items: center;
  gap: 1.6cqw;
}
.hs-key {
  width: 3cqw;
  min-width: 6px;
  height: 3cqw;
  min-height: 6px;
  border: 1px solid var(--se-grafito);
}
.hs-desk {
  margin-top: auto;
}
</style>
