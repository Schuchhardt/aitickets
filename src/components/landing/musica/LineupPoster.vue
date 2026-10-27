<script setup>
// El cartel, con un link por banda (SPEC_landing_musica §4.5): afiche de papel con el cartel de ejemplo (cada nombre
// es un botón) y el panel "Ventas por link" con una barra por link y la venta directa (DIRECT_CHANNEL de
// eventAnalytics.ts, llega por props). Elegir un nombre en el afiche o una fila resalta su barra en rojo (M10: crece en
// 400 ms) y muestra su link de ejemplo con "Copiar", que copia el texto y avisa que es un ejemplo. El link se ve sin
// pasar el mouse (mobile): por defecto queda elegida la primera banda.
// Analítica: mu_lineup_select { band } y mu_link_copy.
import { computed, ref } from 'vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { showInfo } from '../../../lib/toastBus.js'
import { LINEUP, LINEUP_DIRECT_TICKETS, LINEUP_POSTER_META, lineupLink, lineupScales } from './musicaLanding.js'

const props = defineProps({
  /** Etiqueta del canal sin seguimiento (DIRECT_CHANNEL) */
  directLabel: { type: String, required: true },
  /** Franja de fotocopia arriba del afiche: { src, sources } */
  photo: { type: Object, required: true },
})

const scales = lineupScales()
const selected = ref(LINEUP[0].id)
const selectedRow = computed(() => LINEUP.find((r) => r.id === selected.value))
const link = computed(() => lineupLink(selectedRow.value))
const posterRows = [1, 2, 3].map((level) => LINEUP.filter((r) => r.poster === level))

function select(id) {
  if (selected.value === id) return
  selected.value = id
  trackEvent('mu_lineup_select', { band: id })
}

async function copy() {
  try {
    await navigator.clipboard?.writeText(`https://${link.value}`)
  } catch {
    // Sin permiso de portapapeles: el aviso igual explica que es un ejemplo
  }
  trackEvent('mu_link_copy')
  showInfo('Es un ejemplo: crea los tuyos en el panel')
}
</script>

<template>
  <div class="lu" data-testid="music-lineup">
    <div class="lu-poster-wrap">
      <div class="lu-poster">
        <span class="lu-tape lu-tape-1" aria-hidden="true"></span>
        <span class="lu-tape lu-tape-2" aria-hidden="true"></span>
        <div class="mu-copy lu-strip" aria-hidden="true">
          <picture>
            <source v-for="s in props.photo.sources" :key="s.type" :type="s.type" :srcset="s.srcset" sizes="(min-width: 1024px) 560px, 100vw" />
            <img class="mu-photo-img" :src="props.photo.src" alt="" width="896" height="1152" loading="lazy" decoding="async" />
          </picture>
        </div>
        <p class="mu-mono lu-meta">{{ LINEUP_POSTER_META }}</p>
        <ul class="lu-names" aria-label="Cartel de ejemplo">
          <li v-for="(row, level) in posterRows" :key="level" :class="`lu-level lu-level-${level + 1}`">
            <template v-for="(band, j) in row" :key="band.id">
              <span v-if="j > 0" class="lu-sep" aria-hidden="true"> · </span>
              <span v-if="level === 2" class="lu-closing">Cierre: </span>
              <button
                type="button"
                class="lu-name"
                :aria-pressed="selected === band.id ? 'true' : 'false'"
                :data-testid="`music-lineup-name-${band.id}`"
                @click="select(band.id)"
              >{{ band.name }}</button>
            </template>
          </li>
        </ul>
      </div>
    </div>

    <div class="lu-panel">
      <p class="mu-mono lu-panel-title">Ventas por link · ejemplo</p>
      <ul class="lu-rows">
        <li v-for="(row, i) in LINEUP" :key="row.id">
          <button
            type="button"
            class="lu-row"
            :aria-pressed="selected === row.id ? 'true' : 'false'"
            :data-selected="selected === row.id ? 'true' : 'false'"
            @click="select(row.id)"
          >
            <span class="lu-row-top">
              <span class="lu-row-name">{{ row.name }}</span>
              <span class="mu-mono lu-row-n">{{ row.tickets }}</span>
            </span>
            <span class="lu-track" aria-hidden="true">
              <span :key="selected === row.id ? `${row.id}-on` : row.id" class="lu-bar" :style="{ transform: `scaleX(${scales.rows[i]})` }"></span>
            </span>
          </button>
        </li>
        <li class="lu-row lu-row-direct">
          <span class="lu-row-top">
            <span class="lu-row-name">{{ props.directLabel }}</span>
            <span class="mu-mono lu-row-n">{{ LINEUP_DIRECT_TICKETS }}</span>
          </span>
          <span class="lu-track" aria-hidden="true">
            <span class="lu-bar" :style="{ transform: `scaleX(${scales.direct})` }"></span>
          </span>
        </li>
      </ul>
      <div class="lu-link">
        <p class="mu-mono lu-link-label">Link de {{ selectedRow.name }}</p>
        <p class="lu-link-row">
          <code class="lu-url" data-testid="music-lineup-link">{{ link }}</code>
          <button type="button" class="mu-btn mu-btn-lime lu-copy" @click="copy">Copiar</button>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lu {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 32px;
}
.lu-poster {
  position: relative;
  padding: 0 18px 24px;
  background: var(--mu-paper);
  color: var(--mu-ink);
  text-align: center;
}
.lu-tape {
  position: absolute;
  z-index: 1;
  width: 84px;
  height: 26px;
  background: var(--mu-paper-2);
  opacity: 0.8;
}
.lu-tape-1 {
  top: -10px;
  left: -14px;
  transform: rotate(-32deg);
}
.lu-tape-2 {
  top: -10px;
  right: -14px;
  transform: rotate(28deg);
}
.lu-strip {
  height: 120px;
  margin: 0 -18px;
}
.lu-strip :deep(.mu-photo-img) {
  object-position: 50% 30%;
}
.lu-meta {
  margin-top: 18px;
  font-size: 11px;
  color: var(--mu-ink-2);
}
.lu-names {
  margin-top: 14px;
  font-family: var(--mu-display);
  text-transform: uppercase;
}
.lu-level + .lu-level {
  margin-top: 8px;
}
.lu-level-1 {
  font-size: clamp(40px, 13vw, 56px);
  line-height: 1;
}
.lu-level-2 {
  font-size: 30px;
  line-height: 36px;
}
.lu-level-3 {
  font-size: 24px;
  line-height: 30px;
}
.lu-sep,
.lu-closing {
  color: var(--mu-ink-3);
}
.lu-name {
  padding: 0 2px;
  border: 0;
  border-radius: 2px;
  background: none;
  font: inherit;
  line-height: inherit;
  text-transform: inherit;
  color: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 6px;
  text-decoration-color: rgba(17, 16, 19, 0.2);
  transition: color var(--dur-2) var(--ease-out);
}
.lu-name:hover,
.lu-name[aria-pressed="true"] {
  color: var(--mu-red-ink);
  text-decoration-color: currentColor;
}
.lu-name:focus-visible {
  outline: 3px solid var(--mu-ink);
  outline-offset: 2px;
}
.lu-panel {
  padding: 20px;
  border-radius: 4px;
  background: var(--mu-stage-3);
}
.lu-panel-title {
  color: var(--mu-text-3);
}
.lu-rows {
  margin-top: 12px;
}
.lu-row {
  width: 100%;
  display: block;
  padding: 10px 0;
  border: 0;
  border-top: 1px solid var(--mu-line);
  background: none;
  font-family: inherit;
  text-align: left;
  color: var(--mu-text-2);
  cursor: pointer;
}
.lu-row-direct {
  cursor: default;
}
.lu-row-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  line-height: 20px;
}
.lu-row-n {
  color: var(--mu-text-1);
  font-weight: 700;
}
.lu-track {
  display: block;
  height: 6px;
  margin-top: 6px;
  background: rgba(242, 240, 235, 0.08);
}
.lu-bar {
  display: block;
  height: 100%;
  background: var(--mu-text-1);
  transform-origin: left;
}
.lu-row[data-selected="true"] {
  color: var(--mu-text-1);
}
.lu-row[data-selected="true"] .lu-bar {
  background: var(--mu-red);
  animation: mu-grow-x 400ms var(--ease-out) both;
}
.lu-row:focus-visible {
  outline: 2px solid var(--brand-lime);
  outline-offset: 2px;
}
.lu-link {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--mu-line-strong);
}
.lu-link-label {
  font-size: 12px;
  color: var(--mu-text-3);
}
.lu-link-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.lu-url {
  flex: 1 1 220px;
  min-width: 0;
  font-family: var(--mu-mono);
  font-size: 13px;
  line-height: 20px;
  color: var(--mu-text-1);
  overflow-wrap: anywhere;
}
.lu-copy {
  min-height: 44px;
  padding: 0 16px;
  font-size: 14px;
}
@media (min-width: 1024px) {
  .lu {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
    gap: 56px;
  }
  .lu-poster {
    transform: rotate(-1deg);
    padding: 0 28px 32px;
  }
  .lu-strip {
    margin: 0 -28px;
  }
  .lu-level-1 {
    font-size: 96px;
    line-height: 92px;
  }
  .lu-level-2 {
    font-size: 48px;
    line-height: 54px;
  }
  .lu-level-3 {
    font-size: 28px;
    line-height: 34px;
  }
  .lu-panel {
    padding: 28px;
  }
}
/* M10: el afiche entra con rotate(-3deg → -1deg) + fade (con el [data-lp-reveal] de la sección). En Vue el scope va
 * solo en el último selector: los ancestros (.lp-motion, .is-in) no llevan :global. */
@media (min-width: 1024px) {
  .lp-motion [data-lp-reveal]:not(.is-in) .lu-poster {
    opacity: 0;
  }
  .lp-motion .is-in .lu-poster {
    animation: mu-poster-in 700ms var(--ease-out) both;
  }
}
@media (prefers-reduced-motion: reduce) {
  .lu-row[data-selected="true"] .lu-bar {
    animation: none;
  }
  .lu-name {
    transition-duration: 1ms;
  }
}
</style>
