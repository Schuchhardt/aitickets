<script setup>
// "La escalera" (SPEC_landing_fiestas §4.3, la firma): armas tus etapas (cuántas, precio y cupo) y juegas la preventa.
// Las etapas son pulseras apiladas en escalones (cada una más alta y más a la derecha, el ancho según el cupo) con una
// barra de llenado; al tocar una se abre su editor (precio ±$1.000 de $1.000 a $60.000 con parseAmount y tope
// CALC_PRICE.inputMax, cupo ±25 de 25 a 500, y su apertura fija: D-26, D-19, D-12 y D-5, cada una un lunes a las 20:00).
// La simulación es playPresale (fiestasLanding.js, pura y con test): una etapa a la venta a la vez y, si una se agota
// antes de que abra la siguiente, la página se detiene y pregunta "¿Abrimos la 2?". Adelantar = la siguiente abre ese
// día con lo que queda de la demanda; esperar = sin entradas a la venta hasta el lunes. Para no tener que decidir, la etapa
// se encadena a la anterior y se abre sola al agotarse (opens_after_ticket_id, netlify/lib/tickets.mjs); adelantar una
// etapa con fecha sigue siendo desde el asistente de IA o por WhatsApp (tools/tickets.ts: sales_start).
// "Tú recibes" = Σ priceQuote(precio, 'buyer', vendidas).total (fees.mjs). Al final, si se agota la General, la historia
// "Agotado" de la serie (pieceText variante sold_out, por props).
// Movimiento (F7, F8): barras de llenado por día (260 ms), la pulsera agotada se corta y sale una ráfaga de confeti. Con
// "reducir movimiento" la preventa avanza por pasos ("Siguiente día") y sin ráfagas. Sin JS: la escalera por defecto, su
// resumen y una tabla (que con JS queda solo para lectores de pantalla).
// Analítica: fi_stairs_play, fi_stairs_count {n}, fi_stairs_edit {stage, field} (con pausa, sin el valor),
// fi_stairs_choice {stage, choice}, fi_stairs_end {sold, total}.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BuyerPreview from './BuyerPreview.vue'
import { CALC_PRICE, formatCLP, parseAmount, priceQuote } from '../producerLanding.js'
import { useDelayedAnnouncement } from '../../../composables/usePriceCalculator.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { burstConfetti, prefersReducedMotion } from './fiestasLanding.client.js'
import {
  PRESALE_DAY_MS,
  STAGE_COUNTS,
  STAGE_OPEN_DAYS,
  STAGE_PRICE,
  STAGE_QTY,
  defaultStages,
  pauseCopy,
  playPresale,
  presaleCounter,
} from './fiestasLanding.js'

const props = defineProps({
  /** partySchedule(): openings (ISO) y openingLabels ("Abre lun 2 nov, 20:00") de cada etapa */
  openings: { type: Array, required: true },
  openingLabels: { type: Array, required: true },
  /** "Sáb 28 nov · 23:00" */
  dateLabel: { type: String, required: true },
  /** Historia "Agotado" de la serie (pieceText, variante sold_out) */
  soldOutBig: { type: String, required: true },
  soldOutMessage: { type: String, required: true },
})

const count = ref(4)
const stages = ref(defaultStages(4))
const editing = ref(-1)
const choices = ref([])
const frameIndex = ref(-1)
const phase = ref('idle') // idle | running | paused | done
const stepMode = ref(false)
const hydrated = ref(false)
const isMobile = ref(false)
const priceText = ref('')

const result = computed(() => playPresale(stages.value, choices.value))
const frame = computed(() => (frameIndex.value >= 0 ? result.value.frames[frameIndex.value] ?? null : null))
const sold = computed(() => frame.value?.sold ?? stages.value.map(() => 0))
const status = computed(() => frame.value?.status ?? stages.value.map(() => 'upcoming'))
const totalCap = computed(() => stages.value.reduce((s, st) => s + st.capacity, 0))
const soldTotal = computed(() => sold.value.reduce((s, n) => s + n, 0))
const youGet = computed(() => stages.value.reduce((s, st, i) => s + priceQuote(st.price, 'buyer', sold.value[i]).total, 0))
const fullGet = computed(() => stages.value.reduce((s, st) => s + priceQuote(st.price, 'buyer', st.capacity).total, 0))
const isLast = computed(() => result.value.done && frameIndex.value === result.value.frames.length - 1)
const counter = computed(() => (isLast.value ? presaleCounter(frame.value, result.value) : presaleCounter(frame.value, null)))
const pause = computed(() => (phase.value === 'paused' ? result.value.pause : null))
const copy = computed(() => (pause.value ? pauseCopy(stages.value, pause.value) : null))
const maxCap = computed(() => Math.max(...stages.value.map((s) => s.capacity)))

// ---- Editor de etapas ----
const rootEl = ref(null)
const bandEl = ref([])
const advanceButton = ref(null)
const playButton = ref(null)
const dialog = ref(null)

function setCount(n) {
  if (count.value === n) return
  count.value = n
  stages.value = defaultStages(n)
  editing.value = -1
  reset()
  trackEvent('fi_stairs_count', { n })
}
function toggleEdit(i) {
  editing.value = editing.value === i ? -1 : i
  if (editing.value >= 0) {
    priceText.value = stages.value[i].price.toLocaleString('es-CL')
    if (isMobile.value) nextTick(() => dialog.value?.showModal?.())
  } else {
    dialog.value?.close?.()
  }
}
function closeEditor() {
  const i = editing.value
  dialog.value?.close?.()
  editing.value = -1
  if (i >= 0) nextTick(() => bandEl.value[i]?.focus())
}
let editTimer = null
function edited(i, field) {
  reset()
  clearTimeout(editTimer)
  editTimer = setTimeout(() => trackEvent('fi_stairs_edit', { stage: stages.value[i].name, field }), 800)
}
function stepPrice(i, dir) {
  const s = stages.value[i]
  s.price = Math.min(STAGE_PRICE.max, Math.max(STAGE_PRICE.min, s.price + dir * STAGE_PRICE.step))
  priceText.value = s.price.toLocaleString('es-CL')
  edited(i, 'price')
}
function stepQty(i, dir) {
  const s = stages.value[i]
  s.capacity = Math.min(STAGE_QTY.max, Math.max(STAGE_QTY.min, s.capacity + dir * STAGE_QTY.step))
  edited(i, 'capacity')
}
function onPriceInput(i, e) {
  // Mismo tope que los botones (STAGE_PRICE.max): lo que se escribe arriba de eso queda en el tope
  const value = Math.min(STAGE_PRICE.max, parseAmount(e.target.value, CALC_PRICE.inputMax))
  if (value >= STAGE_PRICE.min) {
    stages.value[i].price = value
    edited(i, 'price')
  }
}
function onPriceBlur(i) {
  priceText.value = stages.value[i].price.toLocaleString('es-CL')
}
const cheaperThanPrevious = (i) => i > 0 && stages.value[i].price < stages.value[i - 1].price

// ---- Simulación ----
let timer = null
// Etapas que ya reventaron su confeti en esta corrida: al decidir en la pausa el mismo día se vuelve a mostrar y no debe
// repetir la ráfaga de la que se agotó (una por etapa)
const burst = new Set()
const stop = () => {
  clearTimeout(timer)
  timer = null
}
function reset() {
  stop()
  burst.clear()
  choices.value = []
  frameIndex.value = -1
  phase.value = 'idle'
}
function settle() {
  const r = result.value
  if (frameIndex.value < r.frames.length - 1) return false
  if (r.pause) {
    phase.value = 'paused'
    stop()
    nextTick(() => advanceButton.value?.focus())
    return true
  }
  if (r.done) {
    phase.value = 'done'
    stop()
    trackEvent('fi_stairs_end', { sold: r.sold, total: r.total })
    return true
  }
  return false
}
function showFrame(i) {
  frameIndex.value = i
  const fresh = (result.value.frames[i]?.soldOut ?? []).filter((stage) => !burst.has(stage))
  if (fresh.length) {
    // La pulsera agotada se corta (CSS) y sale una ráfaga desde ella (una por etapa)
    fresh.forEach((stage) => burst.add(stage))
    nextTick(() => burstConfetti(bandEl.value[fresh.at(-1)], rootEl.value))
  }
}
function tick() {
  if (settle()) return
  showFrame(frameIndex.value + 1)
  if (settle()) return
  timer = setTimeout(tick, PRESALE_DAY_MS)
}
function play() {
  if (phase.value === 'done') reset()
  if (phase.value === 'idle') trackEvent('fi_stairs_play', {})
  editing.value = -1
  dialog.value?.close?.()
  phase.value = 'running'
  if (stepMode.value) {
    nextDay()
    return
  }
  stop()
  timer = setTimeout(tick, frameIndex.value < 0 ? 0 : PRESALE_DAY_MS)
}
function nextDay() {
  if (settle()) return
  showFrame(frameIndex.value + 1)
  settle()
}
function choose(choice) {
  const p = result.value.pause
  if (!p) return
  trackEvent('fi_stairs_choice', { stage: stages.value[p.stage].name, choice })
  choices.value = [...choices.value, choice]
  phase.value = 'running'
  // El día de la pausa se vuelve a mostrar completo (con lo que se vendió después de decidir). El botón con foco se
  // desmonta: el foco pasa a "Siguiente día" (por pasos) o a la pulsera de la etapa siguiente (corrida automática)
  showFrame(frameIndex.value)
  if (stepMode.value) {
    nextTick(() => playButton.value?.focus())
    settle()
    return
  }
  nextTick(() => bandEl.value[p.next]?.focus())
  if (!settle()) timer = setTimeout(tick, PRESALE_DAY_MS)
}

// Anuncio solo en pausas y al final (§4.3, accesibilidad)
const milestone = computed(() => (phase.value === 'paused' || phase.value === 'done' ? `${phase.value}:${choices.value.length}` : ''))
const announced = useDelayedAnnouncement(
  milestone,
  (key) => {
    if (!key) return ''
    if (key.startsWith('paused') && copy.value) return `${copy.value.title} ${copy.value.question}`
    const r = result.value
    return `${r.allSoldOut ? 'Agotado. ' : ''}Vendiste ${r.sold.toLocaleString('es-CL')} de ${r.total.toLocaleString('es-CL')}. Tú recibes ${formatCLP(r.revenue)}.`
  },
  150,
)
const statusLine = computed(() => {
  if (!frame.value) return 'La preventa abre el lunes a las 20:00.'
  if (frame.value.waiting || (!frame.value.status.includes('available') && phase.value !== 'done' && !pause.value)) return 'Sin entradas a la venta hasta el lunes'
  if (pause.value) return `${copy.value.title}`
  const onSale = frame.value.status.indexOf('available')
  return onSale >= 0 ? `A la venta: ${stages.value[onSale].name}` : ''
})

let mq = null
const onMq = () => (isMobile.value = mq.matches)
onMounted(() => {
  hydrated.value = true
  stepMode.value = prefersReducedMotion()
  mq = window.matchMedia('(max-width: 767px)')
  onMq()
  mq.addEventListener?.('change', onMq)
})
onBeforeUnmount(() => {
  stop()
  clearTimeout(editTimer)
  mq?.removeEventListener?.('change', onMq)
})
watch(isMobile, () => {
  if (editing.value >= 0 && isMobile.value) nextTick(() => dialog.value?.showModal?.())
  if (!isMobile.value) dialog.value?.close?.()
})

const bandWidth = (s) => `${Math.round(48 + (s.capacity / maxCap.value) * 40)}%`
const bandText = (s) => `${s.name} · ${formatCLP(s.price)} · ${s.capacity}`
</script>

<template>
  <div ref="rootEl" class="ps" :class="{ 'is-hydrated': hydrated }" data-testid="party-stairs">
    <p class="fi-tag fi-tag-amarillo ps-example">ejemplo · ritmo de ventas inventado, no una predicción</p>

    <div class="ps-grid">
      <div class="ps-left">
        <div class="ps-controls">
          <div class="fi-seg ps-seg" role="radiogroup" aria-label="Cuántas etapas">
            <button
              v-for="n in STAGE_COUNTS"
              :key="n"
              type="button"
              role="radio"
              class="fi-seg-btn"
              :class="{ 'is-on': count === n }"
              :aria-checked="count === n ? 'true' : 'false'"
              :data-testid="`party-stairs-count-${n}`"
              @click="setCount(n)"
            >
              {{ n }} etapas
            </button>
          </div>
          <div class="ps-counter-box">
            <p class="ps-counter fi-display" data-testid="party-stairs-counter">{{ counter }}</p>
            <p class="ps-status" data-testid="party-stairs-status">{{ statusLine }}</p>
          </div>
        </div>

        <div class="ps-stairs" role="group" aria-label="Simulación de una preventa por etapas, ejemplo">
          <div v-for="(s, i) in stages" :key="`${count}-${i}`" class="ps-step" :style="{ '--step': i, '--w': bandWidth(s) }">
            <button
              :ref="(el) => (bandEl[i] = el)"
              type="button"
              class="ps-band fi-band"
              :class="[`fi-band--${s.color}`, { 'is-cut': status[i] === 'sold_out', 'is-closed': status[i] === 'closed', 'is-on': status[i] === 'available' }]"
              style="--tilt: -1deg"
              :aria-expanded="editing === i ? 'true' : 'false'"
              :aria-controls="isMobile ? 'fi-stage-dialog' : `fi-stage-editor-${i}`"
              :aria-label="`${s.name}: ${formatCLP(s.price)}, cupo ${s.capacity}, ${sold[i]} vendidas. Editar`"
              :data-testid="`party-stairs-band-${i}`"
              @click="toggleEdit(i)"
            >
              <span class="fi-band-strip">
                <span v-for="half in ['a', 'b']" :key="half" class="fi-band-half" :class="`fi-band-${half}`">
                  <span class="ps-fill" :style="{ transform: `scaleX(${sold[i] / s.capacity})` }"></span>
                  <span class="fi-band-text ps-band-text">{{ bandText(s) }}</span>
                </span>
              </span>
              <span class="fi-band-tab">N° 000{{ i + 1 }}</span>
            </button>

            <div v-if="editing === i && !isMobile" :id="`fi-stage-editor-${i}`" class="ps-editor">
              <div class="ps-editor-row">
                <span class="ps-editor-label">Precio</span>
                <button type="button" class="ps-step-btn" :aria-label="`Bajar precio de ${s.name}`" @click="stepPrice(i, -1)">−</button>
                <input
                  v-model="priceText"
                  class="fi-field ps-input"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  :aria-label="`Precio de ${s.name}`"
                  @input="onPriceInput(i, $event)"
                  @blur="onPriceBlur(i)"
                />
                <button type="button" class="ps-step-btn" :aria-label="`Subir precio de ${s.name}`" @click="stepPrice(i, 1)">+</button>
              </div>
              <div class="ps-editor-row">
                <span class="ps-editor-label">Cupo</span>
                <button type="button" class="ps-step-btn" :aria-label="`Bajar cupo de ${s.name}`" @click="stepQty(i, -1)">−</button>
                <output class="ps-out fi-tabular" :aria-label="`Cupo de ${s.name}`">{{ s.capacity }}</output>
                <button type="button" class="ps-step-btn" :aria-label="`Subir cupo de ${s.name}`" @click="stepQty(i, 1)">+</button>
              </div>
              <p class="fi-meta ps-opens">{{ props.openingLabels[STAGE_OPEN_DAYS.indexOf(s.opensDay)] }}</p>
              <p v-if="cheaperThanPrevious(i)" class="ps-warn">Ojo: esta etapa es más barata que la anterior</p>
            </div>
          </div>

          <!-- La pausa: "Preventa 1: agotada en 4 días. ¿Abrimos la 2?" -->
          <div v-if="pause" class="ps-pause" data-testid="party-stairs-pause">
            <p class="ps-pause-title">{{ copy.title }}</p>
            <p class="ps-pause-q fi-display">{{ copy.question }}</p>
            <div class="ps-pause-btns">
              <button ref="advanceButton" type="button" class="fi-btn fi-btn-crema" data-testid="party-stairs-advance" @click="choose('advance')">
                {{ copy.advance }}
              </button>
              <button type="button" class="fi-btn fi-btn-line" data-testid="party-stairs-wait" @click="choose('wait')">{{ copy.wait }}</button>
            </div>
            <p class="ps-pause-note">
              Para no tener que elegir, encadena cada etapa a la anterior al crear el evento: se abre sola cuando se agota.
              Adelantar una con fecha lo haces desde tu asistente de IA o escribiéndonos por WhatsApp.
            </p>
          </div>

          <!-- Final: la historia "Agotado" de la serie, o cuánto se vendió -->
          <div v-else-if="phase === 'done'" class="ps-end" :class="{ 'is-sold-out': result.allSoldOut }" data-testid="party-stairs-end">
            <template v-if="result.allSoldOut">
              <p class="ps-end-big fi-display">{{ props.soldOutBig }}</p>
              <p class="ps-end-msg">{{ props.soldOutMessage }}</p>
            </template>
            <p v-else class="ps-end-big fi-display">Vendiste {{ result.sold.toLocaleString('es-CL') }} de {{ result.total.toLocaleString('es-CL') }}</p>
          </div>
        </div>
      </div>

      <div class="ps-right">
        <BuyerPreview :stages="stages" :frame="frame" :openings="props.openings" :date-label="props.dateLabel" />
      </div>
    </div>

    <div class="ps-foot">
      <button
        v-if="phase !== 'paused'"
        ref="playButton"
        type="button"
        class="fi-btn fi-btn-crema ps-play"
        data-testid="party-stairs-play"
        :disabled="phase === 'running' && !stepMode"
        @click="phase === 'running' && stepMode ? nextDay() : play()"
      >
        <template v-if="phase === 'done'"><span aria-hidden="true">↻</span> Otra vez</template>
        <template v-else-if="stepMode">Siguiente día</template>
        <template v-else-if="phase === 'running'">La preventa está corriendo…</template>
        <template v-else><span aria-hidden="true">▶</span> Abrir la preventa</template>
      </button>
      <dl class="ps-summary">
        <div>
          <dt>Vendidas</dt>
          <dd class="fi-tabular" data-testid="party-stairs-sold">{{ soldTotal.toLocaleString('es-CL') }} de {{ totalCap.toLocaleString('es-CL') }}</dd>
        </div>
        <div class="ps-get">
          <dt>Tú recibes</dt>
          <dd class="fi-display fi-tabular" data-testid="party-stairs-you">{{ formatCLP(frame ? youGet : 0) }}</dd>
        </div>
        <p class="fi-meta ps-summary-note">si tu público paga el cargo · si se vende todo, {{ formatCLP(fullGet) }}</p>
      </dl>
    </div>

    <table class="ps-table" :class="{ 'lp-sr-only': hydrated }">
      <caption class="lp-sr-only">Etapas de la preventa de ejemplo y lo que recibes si se vende todo</caption>
      <thead>
        <tr>
          <th scope="col">Etapa</th>
          <th scope="col">Precio</th>
          <th scope="col">Cupo</th>
          <th scope="col">Apertura</th>
          <th scope="col">Recibes si se vende todo</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(s, i) in stages" :key="s.name">
          <th scope="row">{{ s.name }}</th>
          <td class="fi-tabular">{{ formatCLP(s.price) }}</td>
          <td class="fi-tabular">{{ s.capacity }}</td>
          <td>{{ props.openingLabels[STAGE_OPEN_DAYS.indexOf(s.opensDay)] }}</td>
          <td class="fi-tabular">{{ formatCLP(priceQuote(s.price, 'buyer', s.capacity).total) }}</td>
        </tr>
      </tbody>
    </table>

    <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>

    <!-- Mobile: el editor de la etapa como hoja inferior -->
    <dialog id="fi-stage-dialog" ref="dialog" class="ps-dialog" aria-labelledby="fi-stage-dialog-title" @close="editing >= 0 && isMobile && (editing = -1)">
      <template v-if="editing >= 0 && isMobile">
        <p id="fi-stage-dialog-title" class="fi-h3">{{ stages[editing].name }}</p>
        <div class="ps-editor-row">
          <span class="ps-editor-label">Precio</span>
          <button type="button" class="ps-step-btn" :aria-label="`Bajar precio de ${stages[editing].name}`" @click="stepPrice(editing, -1)">−</button>
          <input
            v-model="priceText"
            class="fi-field ps-input"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            :aria-label="`Precio de ${stages[editing].name}`"
            @input="onPriceInput(editing, $event)"
            @blur="onPriceBlur(editing)"
          />
          <button type="button" class="ps-step-btn" :aria-label="`Subir precio de ${stages[editing].name}`" @click="stepPrice(editing, 1)">+</button>
        </div>
        <div class="ps-editor-row">
          <span class="ps-editor-label">Cupo</span>
          <button type="button" class="ps-step-btn" :aria-label="`Bajar cupo de ${stages[editing].name}`" @click="stepQty(editing, -1)">−</button>
          <output class="ps-out fi-tabular">{{ stages[editing].capacity }}</output>
          <button type="button" class="ps-step-btn" :aria-label="`Subir cupo de ${stages[editing].name}`" @click="stepQty(editing, 1)">+</button>
        </div>
        <p class="fi-meta ps-opens">{{ props.openingLabels[STAGE_OPEN_DAYS.indexOf(stages[editing].opensDay)] }}</p>
        <p v-if="cheaperThanPrevious(editing)" class="ps-warn">Ojo: esta etapa es más barata que la anterior</p>
        <button type="button" class="fi-btn fi-btn-tinta ps-dialog-close" @click="closeEditor">Listo</button>
      </template>
    </dialog>
  </div>
</template>

<style scoped>
.ps {
  position: relative;
  padding: 20px 16px 22px;
  border-radius: 24px;
  background: var(--fi-cobalto-2);
  color: var(--fi-crema);
}
.ps-example {
  position: absolute;
  top: -14px;
  right: 14px;
  max-width: calc(100% - 28px);
  text-transform: none;
  letter-spacing: 0.02em;
}
.ps-grid {
  display: grid;
  gap: 24px;
  margin-top: 8px;
}
.ps-left {
  position: relative;
  min-width: 0;
}
.ps-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
}
.ps-seg .fi-seg-btn {
  min-height: 44px;
}
.ps-counter-box {
  text-align: right;
}
.ps-counter {
  font-size: 44px;
  line-height: 46px;
  color: var(--fi-amarillo);
  text-transform: uppercase;
}
.ps-status {
  min-height: 20px;
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  color: var(--fi-crema);
}
.ps-stairs {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 22px;
  min-height: 220px;
}
.ps-step {
  min-width: 0;
  margin-left: calc(var(--step) * 12px);
}
.ps-band {
  width: calc(100% - var(--step) * 12px);
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
  --band-h: 34px;
  height: 44px;
}
.ps-band:focus-visible {
  outline: 3px solid var(--fi-amarillo);
  outline-offset: 4px;
  border-radius: 999px;
}
.ps-band .fi-band-strip {
  height: var(--band-h);
}
.ps-band.is-on .fi-band-half {
  box-shadow: inset 0 0 0 3px var(--fi-amarillo);
}
.ps-band.is-closed {
  opacity: 0.45;
}
.ps-fill {
  position: absolute;
  inset: 0;
  background: rgba(22, 17, 13, 0.24);
  transform-origin: left center;
  transition: transform 260ms linear;
}
.fi-band--tinta .ps-fill {
  background: rgba(255, 244, 228, 0.28);
}
.ps-band-text {
  position: relative;
  font-size: 12px;
  letter-spacing: 0.08em;
}
.ps-editor {
  margin-top: 10px;
  padding: 14px;
  border: 2px solid var(--fi-tinta);
  border-radius: 16px;
  background: var(--fi-crema);
  color: var(--fi-tinta);
}
.ps-editor-row {
  display: grid;
  grid-template-columns: 64px 44px minmax(0, 1fr) 44px;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.ps-editor-row:first-child {
  margin-top: 0;
}
.ps-editor-label {
  font-size: 14px;
  font-weight: 700;
}
.ps-step-btn {
  width: 44px;
  height: 44px;
  border: 2px solid var(--fi-tinta);
  border-radius: 50%;
  background: var(--fi-crema-2);
  color: var(--fi-tinta);
  font: inherit;
  font-size: 20px;
  font-weight: 700;
  cursor: pointer;
}
.ps-step-btn:focus-visible {
  outline: 3px solid var(--fi-cobalto);
  outline-offset: 2px;
}
.ps-input,
.ps-out {
  text-align: center;
}
.ps-out {
  font-size: 18px;
  font-weight: 700;
}
.ps-opens {
  margin-top: 10px;
  color: var(--fi-text-3);
}
.ps-warn {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--fi-naranja-ink);
}
.ps-pause,
.ps-end {
  /* Sticker crema dentro de la sección cobalto: los tokens puente vuelven a los de crema */
  --surface-2: #fff;
  --text-1: var(--fi-tinta);
  --text-2: var(--fi-text-2);
  --text-3: var(--fi-text-3);
  position: relative;
  z-index: 5;
  margin-top: 6px;
  padding: 18px;
  border: 3px solid var(--fi-tinta);
  border-radius: 24px;
  background: var(--fi-crema);
  color: var(--fi-tinta);
  box-shadow: 6px 6px 0 var(--fi-tinta);
  transform: rotate(-1deg);
}
.ps-pause-title {
  font-size: 15px;
  font-weight: 700;
}
.ps-pause-q {
  margin-top: 2px;
  font-size: 34px;
  line-height: 38px;
}
.ps-pause-btns {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}
.ps-pause .fi-btn-line {
  color: var(--fi-tinta);
  border-color: var(--fi-tinta);
}
.ps-pause .fi-btn:focus-visible {
  outline-color: var(--fi-cobalto);
}
.ps-pause-note {
  margin-top: 12px;
  font-size: 13px;
  line-height: 18px;
  color: var(--fi-text-2);
}
.ps-end {
  text-align: center;
}
.ps-end.is-sold-out {
  background: var(--fi-amarillo);
}
.ps-end-big {
  font-size: 36px;
  line-height: 40px;
}
.ps-end-msg {
  margin-top: 4px;
  font-weight: 600;
}
.ps-right {
  min-width: 0;
}
.ps-foot {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 24px;
  padding-top: 18px;
  border-top: 2px dashed rgba(255, 244, 228, 0.35);
}
.ps-play {
  align-self: stretch;
}
.ps-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 24px;
}
.ps-summary dt {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-3);
}
.ps-summary dd {
  font-size: 18px;
  font-weight: 700;
}
.ps-get dd {
  font-size: 40px;
  line-height: 44px;
  color: var(--fi-amarillo);
}
.ps-summary-note {
  flex-basis: 100%;
}
.ps-table {
  width: 100%;
  margin-top: 20px;
  border-collapse: collapse;
  font-size: 14px;
}
.ps-table th,
.ps-table td {
  padding: 8px 6px;
  border-bottom: 1px solid rgba(255, 244, 228, 0.25);
  text-align: left;
}
.ps-dialog {
  width: 100%;
  max-width: 100%;
  margin: auto 0 0;
  padding: 22px 20px calc(22px + env(safe-area-inset-bottom));
  border: 0;
  border-top: 3px solid var(--fi-tinta);
  border-radius: 24px 24px 0 0;
  background: var(--fi-crema);
  color: var(--fi-tinta);
}
.ps-dialog::backdrop {
  background: rgba(18, 15, 20, 0.5);
}
.ps-dialog .ps-editor-row {
  margin-top: 14px;
}
.ps-dialog-close {
  width: 100%;
  margin-top: 18px;
}
@media (max-width: 767px) {
  .ps-band {
    width: 100%;
  }
}
@media (min-width: 768px) {
  .ps {
    padding: 30px 28px 26px;
  }
  .ps-example {
    right: 24px;
  }
  .ps-stairs {
    flex-direction: column-reverse;
    gap: 10px;
    min-height: 300px;
    justify-content: flex-start;
  }
  /* Escalones: cada etapa más alta y más a la derecha que la anterior, el ancho según el cupo */
  .ps-step {
    margin-left: calc(var(--step) * 14%);
  }
  .ps-band {
    width: var(--w);
    min-width: 200px;
  }
  .ps-editor {
    max-width: 420px;
  }
  .ps-pause-btns {
    flex-direction: row;
    flex-wrap: wrap;
  }
  /* Desktop: el sticker se pega encima de la escalera */
  .ps-pause,
  .ps-end {
    position: absolute;
    top: 50%;
    left: 6%;
    right: 6%;
    margin-top: 0;
    padding: 22px 26px;
    transform: translateY(-50%) rotate(-1.5deg);
  }
  .ps-pause-q {
    font-size: 44px;
    line-height: 48px;
  }
  .ps-foot {
    flex-direction: row;
    align-items: center;
    gap: 28px;
  }
  .ps-play {
    align-self: center;
  }
}
@media (min-width: 1024px) {
  .ps-grid {
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 32px;
    align-items: start;
  }
  .ps-counter {
    font-size: 56px;
    line-height: 58px;
  }
  .ps-get dd {
    font-size: 48px;
    line-height: 52px;
  }
}
/* La pausa entra como un sticker que se pega (F2) */
.ps-pause,
.ps-end {
  animation: ps-stick 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
@keyframes ps-stick {
  from {
    opacity: 0;
    transform: scale(1.2) rotate(-10deg);
  }
}
@keyframes ps-stick-over {
  from {
    opacity: 0;
    transform: translateY(-50%) scale(1.2) rotate(-10deg);
  }
}
@media (min-width: 768px) {
  .ps-pause,
  .ps-end {
    animation-name: ps-stick-over;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ps-fill {
    transition: none;
  }
  .ps-pause,
  .ps-end {
    animation: none;
  }
}
</style>
