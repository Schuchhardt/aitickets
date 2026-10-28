<script setup>
// "El programa" (SPEC_landing_seminarios §4.3, firma 1): eliges el formato (charla, seminario de un día o congreso de dos
// días) y si es con entrada o gratis; ves el programa por día, decides en la matriz de acceso qué entrada vale qué día y,
// a la derecha, cómo queda en tu panel y lo que ve tu público, con los rótulos de la página real.
// La regla del producto: cada tipo de entrada sirve para UNA función (cupo propio) o para TODAS (pase completo, cupo
// compartido); nunca para dos de tres. Por eso la matriz tiene un radio por columna (Día 1, Día 2, Todos los días).
// La card de ejemplo dice exactamente lo que diría la real: seminariosLanding.js arma un evento sintético
// (previewEvent) y le pide el estado, el rótulo y los chips a cardState / cardLabel / cardFunctionChips (eventView.js);
// el precio es el final con el cargo (priceQuote → fees.mjs), "por entrada, incluye cargo" como la card, y la fila del
// checkout lleva SERVICE_FEE_NOTE o "Disponible desde el {formatSaleStart}" si la entrada espera la preventa.
// Lo que no existe va con "Pronto": la agenda con expositores y salas.
// - SSR / sin JS: el congreso con entrada, el programa, la matriz de solo lectura con ✓ y la card de ejemplo; los
//   controles quedan deshabilitados hasta hidratar.
// - Mobile: el formato en scroll horizontal, el programa en pestañas por día, la matriz como una card por tipo de entrada
//   con un segmented (Día 1 · Día 2 · Todos) y "En tu panel" / "Lo que ve tu público" colapsables (el segundo abierto).
//   Las pestañas (y los roles tablist / tabpanel) existen solo hidratado y bajo 1024 px: sin JS se ven los dos días, y
//   en desktop las columnas no se anuncian como paneles de pestañas que no se ven.
// Movimiento: C6 el puntero marca el bloque (al pasar el mouse o enfocarlo con el teclado; por defecto, el keynote), C7 los bloques cambian con
// FLIP y la fila elegida pinta su fondo con clip-path, C8 el rótulo de la card se desliza 12 px. Con "reducir
// movimiento", sin FLIP ni puntero.
// Accesibilidad: la matriz es una <table> con <caption> visible y radios con aria-label ("Pase completo: todos los
// días"); los cambios se anuncian con pausa ("2 funciones, 4 tipos de entrada, aforo 260").
// Analítica: se_program_format {format}, se_program_mode {mode}, se_matrix_change {ticket, scope} (con pausa) y
// se_program_toggle {option, on}.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SoonBadge from '../../ui/SoonBadge.vue'
import { formatCLP } from '../producerLanding.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { useDelayedAnnouncement } from '../../../composables/usePriceCalculator.js'
import { SERVICE_FEE_NOTE } from '../../../../netlify/lib/fees.mjs'
import { PAYOUT_RELEASE_HOURS } from '../../../../netlify/lib/legal.mjs'
import { TERMS_NOTE } from '../../../data/producerFaq'
import {
  DEFAULT_FORMAT,
  FORMATS,
  SCOPE_ALL,
  agendaText,
  buyerCard,
  dayReleaseText,
  matrixColumns,
  panelSummary,
  presaleToggleLabel,
  programModel,
} from './seminariosLanding.js'
import { formatShortDate } from '../../event/eventView.js'

const props = defineProps({
  /** Día 1 de la jornada de ejemplo (YYYY-MM-DD, calculado al construir: la página es prerender) */
  date: { type: String, required: true },
})

const modes = [
  { value: 'paid', label: 'Con entrada' },
  { value: 'free', label: 'Inscripción gratis' },
]
const format = ref(DEFAULT_FORMAT)
const mode = ref('paid')
const student = ref(true)
const presale = ref(false)
const almostFull = ref(false)
const scopes = ref({})
const picked = ref(null)
const day = ref('d1')
const hydrated = ref(false)
/** Pestañas por día: solo hidratado y bajo 1024 px (en desktop se ven las dos columnas) */
const tabs = ref(false)
const pointer = ref(null)
const panelOpen = ref(true)

const model = computed(() => programModel(format.value, mode.value, { student: student.value, presale: presale.value, scopes: scopes.value }, props.date))
const columns = computed(() => matrixColumns(model.value))
const summary = computed(() => panelSummary(model.value))
const card = computed(() => buyerCard(model.value, { almostFull: almostFull.value, date: props.date }))
const agenda = computed(() => agendaText(model.value))
const multi = computed(() => model.value.functions.length > 1)
const hasStudent = computed(() => mode.value === 'paid' && format.value !== 'charla')
const pickedRow = computed(() => card.value.rows.find((r) => r.id === picked.value) ?? null)
const releaseText = computed(() =>
  multi.value ? dayReleaseText : `Lo de tu ${format.value === 'charla' ? 'charla' : 'seminario'} queda disponible ${PAYOUT_RELEASE_HOURS} h después de que termina`,
)
const announced = useDelayedAnnouncement(() => summary.value.announce, (text) => text)

/** "JUE 3 DIC" de la columna del día */
const dayHead = (fn) => `${fn.label} · ${formatShortDate(fn.date)}`
const scopeAria = (t, col) => `${t.name}: ${col.id === SCOPE_ALL ? 'todos los días' : col.label.toLowerCase()}`

function setFormat(id) {
  if (format.value === id) return
  format.value = id
  scopes.value = {}
  picked.value = null
  day.value = 'd1'
  trackEvent('se_program_format', { format: id })
}
function setMode(value) {
  if (mode.value === value) return
  mode.value = value
  scopes.value = {}
  picked.value = null
  trackEvent('se_program_mode', { mode: value })
}
const toggles = { student, presale, almost_full: almostFull }
function toggle(option) {
  const target = toggles[option]
  target.value = !target.value
  // Al activar la preventa se elige la entrada principal, la que la espera: el checkout muestra "Disponible desde el …"
  if (option === 'presale' && target.value) picked.value = model.value.tickets.find((t) => t.main)?.id ?? picked.value
  trackEvent('se_program_toggle', { option, on: target.value })
}
/** Elegir una fila sin cambiar su alcance (un radio ya marcado no dispara change: con una sola columna, siempre) */
function pick(t) {
  if (hydrated.value) picked.value = t.id
}
let matrixTimer = null
function setScope(t, scope) {
  scopes.value = { ...scopes.value, [t.id]: scope }
  picked.value = t.id
  clearTimeout(matrixTimer)
  matrixTimer = setTimeout(() => trackEvent('se_matrix_change', { ticket: t.id, scope }), 600)
}

/** Radiogroups de botones (formato, modo, día, alcance en mobile): las flechas cambian la opción y mueven el foco */
function onSegKey(e, options, current, set) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
  e.preventDefault()
  const i = options.findIndex((o) => o === current)
  const next = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length
  set(options[next])
  nextTick(() => e.currentTarget?.parentElement?.children[next]?.focus())
}

// C6: el puntero se mueve al bloque que pasa el mouse; si no, al bloque destacado (keynote) del día
const columnsRef = ref({})
function pointAt(dayId, key) {
  const col = columnsRef.value[dayId]
  const row = col?.querySelector(`[data-key="${CSS.escape(key)}"]`)
  if (!row) return
  pointer.value = { day: dayId, top: row.offsetTop + row.offsetHeight / 2 }
}
function pointFocus() {
  const fn = model.value.functions.find((f) => f.id === day.value) ?? model.value.functions[0]
  const focus = fn.blocks.find((b) => b.focus)
  if (focus) nextTick(() => setTimeout(() => pointAt(fn.id, focus.key), 340))
}
watch([format, day], pointFocus)

let mobileQuery = null
const syncTabs = () => {
  tabs.value = Boolean(mobileQuery?.matches)
}
onMounted(() => {
  hydrated.value = true
  mobileQuery = window.matchMedia('(max-width: 1023px)')
  syncTabs()
  mobileQuery.addEventListener?.('change', syncTabs)
  if (mobileQuery.matches) panelOpen.value = false
  pointFocus()
})
onBeforeUnmount(() => {
  clearTimeout(matrixTimer)
  mobileQuery?.removeEventListener?.('change', syncTabs)
})
</script>

<template>
  <div class="pb se-card" data-testid="seminar-program">
    <p class="se-example pb-example">ejemplo</p>
    <div class="pb-grid">
      <!-- Izquierda: formato, programa y matriz -->
      <div class="pb-left">
        <div class="pb-controls">
          <div class="se-seg pb-seg" role="radiogroup" aria-label="Formato">
            <button
              v-for="f in FORMATS"
              :key="f.id"
              type="button"
              role="radio"
              class="se-seg-btn"
              :class="{ 'is-on': format === f.id }"
              :aria-checked="format === f.id ? 'true' : 'false'"
              :tabindex="format === f.id ? 0 : -1"
              :disabled="!hydrated"
              :data-testid="`seminar-format-${f.id}`"
              @click="setFormat(f.id)"
              @keydown="onSegKey($event, FORMATS.map((x) => x.id), format, setFormat)"
            >{{ f.label }}</button>
          </div>
          <div class="se-seg pb-seg" role="radiogroup" aria-label="Inscripción">
            <button
              v-for="m in modes"
              :key="m.value"
              type="button"
              role="radio"
              class="se-seg-btn"
              :class="{ 'is-on': mode === m.value }"
              :aria-checked="mode === m.value ? 'true' : 'false'"
              :tabindex="mode === m.value ? 0 : -1"
              :disabled="!hydrated"
              :data-testid="`seminar-mode-${m.value}`"
              @click="setMode(m.value)"
              @keydown="onSegKey($event, modes.map((x) => x.value), mode, setMode)"
            >{{ m.label }}</button>
          </div>
          <div class="pb-toggles">
            <label v-if="hasStudent" class="se-toggle"><input type="checkbox" :checked="student" :disabled="!hydrated" @change="toggle('student')" /> + Entrada estudiante</label>
            <label v-if="mode === 'paid'" class="se-toggle"><input type="checkbox" :checked="presale" :disabled="!hydrated" data-testid="seminar-presale" @change="toggle('presale')" /> {{ presaleToggleLabel(props.date) }}</label>
            <label v-if="mode === 'free'" class="se-toggle"><input type="checkbox" :checked="almostFull" :disabled="!hydrated" @change="toggle('almost_full')" /> Casi lleno</label>
          </div>
          <p v-if="presale && mode === 'paid'" class="se-note">La fecha de inicio y cierre de cada entrada se programa hoy desde tu asistente de IA o escribiéndonos por WhatsApp.</p>
        </div>

        <!-- El programa (ProgramGrid): una columna por día; en mobile, pestañas -->
        <div v-if="multi && tabs" class="se-seg pb-days" role="tablist" aria-label="Día del programa">
          <button
            v-for="fn in model.functions"
            :id="`se-day-tab-${fn.id}`"
            :key="fn.id"
            type="button"
            role="tab"
            class="se-seg-btn"
            :class="{ 'is-on': day === fn.id }"
            :aria-selected="day === fn.id ? 'true' : 'false'"
            :aria-controls="`se-day-${fn.id}`"
            :tabindex="day === fn.id ? 0 : -1"
            @click="day = fn.id"
            @keydown="onSegKey($event, model.functions.map((x) => x.id), day, (v) => (day = v))"
          >{{ fn.label }}</button>
        </div>
        <div class="pb-program" :class="{ 'is-multi': multi }">
          <div
            v-for="fn in model.functions"
            :id="`se-day-${fn.id}`"
            :key="fn.id"
            :ref="(el) => (columnsRef[fn.id] = el)"
            class="pb-day"
            :class="{ 'is-shown': day === fn.id || !multi || !tabs }"
            :role="multi && tabs ? 'tabpanel' : undefined"
            :aria-labelledby="multi && tabs ? `se-day-tab-${fn.id}` : undefined"
          >
            <p class="se-meta se-program-head">{{ dayHead(fn) }} · {{ fn.start }} – {{ fn.end }}</p>
            <TransitionGroup name="pb-block" tag="ul" class="se-program-list">
              <li
                v-for="b in fn.blocks"
                :key="b.key"
                :data-key="b.key"
                class="se-program-row se-focus"
                :class="{ 'is-pause': b.kind === 'pause', 'is-focus': b.focus }"
                tabindex="0"
                @mouseenter="pointAt(fn.id, b.key)"
                @focus="pointAt(fn.id, b.key)"
              >
                <span class="se-program-time">{{ b.time }}</span>
                <span>{{ b.title }}</span>
              </li>
            </TransitionGroup>
            <span v-if="pointer && pointer.day === fn.id" class="pb-pointer" :style="{ transform: `translateY(${pointer.top}px)` }" aria-hidden="true"></span>
          </div>
        </div>

        <!-- La matriz de acceso (AccessMatrix) -->
        <div class="pb-matrix">
          <table class="pb-table" data-testid="seminar-matrix">
            <caption class="se-h3 pb-caption">Qué entrada vale qué día</caption>
            <thead>
              <tr>
                <th scope="col" class="se-meta">Tipo de entrada</th>
                <th v-for="col in columns" :key="col.id" scope="col" class="se-meta pb-col">{{ col.label }}</th>
              </tr>
            </thead>
            <tbody>
              <!-- Clic en la fila (o en su radio, también con Espacio: el click sube hasta acá) la elige para el checkout -->
              <tr v-for="t in model.tickets" :key="t.id" :class="{ 'is-picked': picked === t.id }" :data-testid="`seminar-matrix-row-${t.id}`" @click="pick(t)">
                <th scope="row" class="pb-ticket">
                  <span class="pb-ticket-name">{{ t.name }}</span>
                  <span class="pb-ticket-meta se-tabular">{{ t.price ? formatCLP(t.price) : 'Gratis' }} · {{ t.capacity }}</span>
                </th>
                <td v-for="col in columns" :key="col.id" class="pb-cell">
                  <span v-if="!hydrated" class="pb-check">{{ t.scope === col.id ? '✓' : '' }}<span v-if="t.scope === col.id" class="lp-sr-only"> {{ scopeAria(t, col) }}</span></span>
                  <label v-else class="pb-radio">
                    <input
                      type="radio"
                      :name="`se-scope-${t.id}`"
                      :value="col.id"
                      :checked="t.scope === col.id"
                      :aria-label="scopeAria(t, col)"
                      :data-testid="`seminar-scope-${t.id}-${col.id}`"
                      @change="setScope(t, col.id)"
                    />
                  </label>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- Mobile: una card por tipo de entrada -->
          <ul class="pb-cards" aria-label="Qué entrada vale qué día">
            <li v-for="t in model.tickets" :key="t.id" class="pb-tcard" :class="{ 'is-picked': picked === t.id }">
              <p class="pb-ticket-name">{{ t.name }} <span class="pb-ticket-meta se-tabular">{{ t.price ? formatCLP(t.price) : 'Gratis' }} · {{ t.capacity }}</span></p>
              <div class="se-seg pb-scope" role="radiogroup" :aria-label="`${t.name}: para qué día`">
                <button
                  v-for="col in columns"
                  :key="col.id"
                  type="button"
                  role="radio"
                  class="se-seg-btn"
                  :class="{ 'is-on': t.scope === col.id }"
                  :aria-checked="t.scope === col.id ? 'true' : 'false'"
                  :tabindex="t.scope === col.id ? 0 : -1"
                  :disabled="!hydrated"
                  @click="setScope(t, col.id)"
                  @keydown="onSegKey($event, columns.map((c) => c.id), t.scope, (v) => setScope(t, v))"
                >{{ col.id === SCOPE_ALL ? 'Todos' : col.label }}</button>
              </div>
            </li>
          </ul>

          <p class="se-note pb-rule">Una entrada sirve para un día o para todos. El pase completo entra una vez cada día con el mismo QR.</p>
        </div>
      </div>

      <!-- Derecha: en tu panel, lo que ve tu público y la agenda -->
      <div class="pb-right">
        <details class="pb-box" :open="panelOpen" @toggle="panelOpen = $event.target.open">
          <summary class="se-meta pb-summary">En tu panel</summary>
          <ul class="pb-panel">
            <li>1 evento</li>
            <li>
              <span data-testid="seminar-panel-functions">{{ summary.functions }}</span>
              <ul class="pb-sub">
                <li v-for="line in summary.functionLines" :key="line">{{ line }}</li>
              </ul>
            </li>
            <li>
              {{ summary.tickets }}
              <ul class="pb-sub">
                <li v-for="t in summary.ticketLines" :key="t.name">{{ t.name }} · {{ t.scope }}</li>
              </ul>
            </li>
            <li class="se-tabular" data-testid="seminar-panel-capacity">{{ summary.capacity }}</li>
          </ul>
          <p class="se-note pb-release">{{ releaseText }}*. <a :href="TERMS_NOTE.href" class="se-link">{{ TERMS_NOTE.text }}</a></p>
        </details>

        <details class="pb-box" open>
          <summary class="se-meta pb-summary">Lo que ve tu público</summary>
          <div class="pb-card" role="group" aria-label="Card de la página del evento, ejemplo" data-testid="seminar-buyer-card">
            <Transition name="pb-label" mode="out-in">
              <p v-if="card.label" :key="card.label" class="pb-label" :class="`is-${card.tone}`" data-testid="seminar-card-label">{{ card.label }}</p>
            </Transition>
            <template v-if="card.free">
              <div class="pb-form" aria-hidden="true">
                <span class="pb-input">Nombre</span>
                <span class="pb-input">Correo</span>
                <span class="pb-buy">{{ card.cta }}</span>
              </div>
            </template>
            <template v-else>
              <p class="pb-price se-tabular">{{ card.from ? 'Desde ' : '' }}{{ formatCLP(card.price) }}</p>
              <p class="pb-price-note">por entrada, incluye cargo</p>
              <ul v-if="card.chips.length" class="pb-chips" aria-label="Próximas funciones">
                <li v-for="chip in card.chips" :key="chip" class="pb-chip se-tabular">{{ chip }}</li>
              </ul>
              <span class="pb-buy" aria-hidden="true">{{ card.cta }}</span>
            </template>
            <div v-if="pickedRow" class="pb-checkout" data-testid="seminar-checkout-row">
              <p class="se-meta">En el checkout</p>
              <p class="pb-row-head"><span>{{ pickedRow.name }}</span><span class="se-tabular">{{ pickedRow.price ? formatCLP(pickedRow.price) : 'Gratis' }}</span></p>
              <p class="pb-row-sub">{{ pickedRow.opens ?? (pickedRow.price ? SERVICE_FEE_NOTE : 'Sin cargo') }}</p>
            </div>
            <p class="se-example">ejemplo · elige una fila de la matriz para verla en el checkout</p>
          </div>
        </details>

        <div class="pb-box pb-agenda">
          <p class="se-meta pb-summary-static">La agenda</p>
          <div class="pb-desc">
            <template v-for="d in agenda" :key="d.heading">
              <h3 class="pb-desc-h">{{ d.heading }}</h3>
              <ul class="pb-desc-list">
                <li v-for="item in d.items" :key="item">{{ item }}</li>
              </ul>
            </template>
          </div>
          <p class="se-note">El programa va en la descripción, con títulos y listas. El asistente de tu página lo usa para responder "¿a qué hora es el panel?".</p>
          <p class="se-soon-chip pb-soon">Agenda con expositores y salas <SoonBadge /></p>
        </div>
      </div>
    </div>
    <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>
  </div>
</template>

<style scoped>
.pb {
  position: relative;
  padding: 16px;
  border-color: var(--se-grafito);
}
.pb-example {
  margin-bottom: 10px;
}
.pb-grid {
  display: grid;
  gap: 28px;
}
.pb-left,
.pb-right {
  min-width: 0;
}
.pb-controls {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}
.pb-seg {
  max-width: 100%;
}
.pb-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 0 20px;
}
.pb-days {
  margin-top: 24px;
}
.pb-program {
  display: grid;
  gap: 20px;
  margin-top: 16px;
}
.pb-day {
  position: relative;
  display: none;
}
.pb-day.is-shown {
  display: block;
}
.pb-pointer {
  position: absolute;
  top: 0;
  left: -18px;
  width: 10px;
  height: 10px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--se-cordon);
  box-shadow: 0 0 0 4px rgba(0, 135, 127, 0.18);
  transition: transform 500ms ease-out;
  pointer-events: none;
}
.pb-block-move {
  transition: transform 320ms var(--se-ease);
}
.pb-block-enter-active {
  transition: opacity 320ms var(--se-ease), transform 320ms var(--se-ease);
}
.pb-block-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.pb-block-leave-active {
  display: none;
}
.pb-matrix {
  margin-top: 32px;
}
.pb-table {
  display: none;
  width: 100%;
  border-collapse: collapse;
}
.pb-caption {
  margin-bottom: 12px;
  text-align: left;
  caption-side: top;
}
.pb-table th,
.pb-table td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--se-filete);
  text-align: left;
}
.pb-table thead th {
  border-bottom: 1px solid var(--se-grafito);
}
.pb-col,
.pb-cell {
  width: 88px;
  text-align: center !important;
}
.pb-table tbody tr {
  position: relative;
  cursor: pointer;
  background-image: linear-gradient(var(--se-cordon-claro), var(--se-cordon-claro));
  background-repeat: no-repeat;
  background-size: 0% 100%;
  transition: background-size 200ms var(--se-ease);
}
/* C7: la fila elegida pinta su fondo de izquierda a derecha */
.pb-table tbody tr.is-picked {
  background-size: 100% 100%;
  box-shadow: inset 3px 0 0 var(--se-cordon);
}
.pb-ticket {
  font-weight: 400;
}
.pb-ticket-name {
  display: block;
  font-family: var(--se-font);
  font-weight: 700;
  font-size: 15px;
}
.pb-ticket-meta {
  font-size: 13px;
  color: var(--se-text-3);
  font-weight: 500;
}
.pb-radio {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  cursor: pointer;
}
.pb-radio input {
  width: 20px;
  height: 20px;
  accent-color: var(--se-cordon-ink);
  cursor: pointer;
}
.pb-radio input:focus-visible {
  outline: 3px solid var(--se-cordon-ink);
  outline-offset: 3px;
}
.pb-check {
  font-weight: 700;
  color: var(--se-cordon-ink);
}
.pb-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pb-tcard {
  padding: 12px;
  border: 1px solid var(--se-filete);
  border-radius: 4px;
}
.pb-tcard.is-picked {
  border-color: var(--se-cordon);
  box-shadow: inset 3px 0 0 var(--se-cordon);
  background: var(--se-cordon-claro);
}
.pb-tcard .pb-ticket-name {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  margin-bottom: 8px;
}
.pb-rule {
  margin-top: 14px;
  max-width: 560px;
}
.pb-box {
  padding: 14px 0;
  border-top: 1px solid var(--se-grafito);
}
.pb-box + .pb-box {
  margin-top: 8px;
}
.pb-summary,
.pb-summary-static {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  color: var(--se-grafito);
  cursor: pointer;
  list-style: none;
}
.pb-summary::-webkit-details-marker {
  display: none;
}
.pb-summary::after {
  content: "+";
  font-family: "Prompt", system-ui, sans-serif;
  font-size: 18px;
}
details[open] > .pb-summary::after {
  content: "−";
}
.pb-summary:focus-visible {
  outline: 3px solid var(--se-cordon-ink);
  outline-offset: 2px;
}
.pb-summary-static {
  cursor: default;
}
.pb-panel {
  display: flex;
  flex-direction: column;
  margin-top: 8px;
  font-size: 15px;
}
.pb-panel > li {
  padding: 8px 0;
  border-bottom: 1px solid var(--se-filete);
  font-weight: 600;
}
.pb-sub {
  margin-top: 4px;
  font-weight: 400;
  font-size: 14px;
  color: var(--se-text-2);
}
.pb-release {
  margin-top: 10px;
}
.pb-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding: 16px;
  border: 1px solid var(--se-filete);
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(21, 25, 28, 0.08);
}
.pb-label {
  align-self: flex-start;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--se-text-2);
}
.pb-label.is-warning {
  color: #92400e;
}
.pb-label-enter-active,
.pb-label-leave-active {
  transition: opacity 200ms var(--se-ease), transform 200ms var(--se-ease);
}
.pb-label-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.pb-label-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}
.pb-price {
  font-size: 26px;
  line-height: 30px;
  font-weight: 800;
}
.pb-price-note {
  margin-top: -6px;
  font-size: 13px;
  color: var(--se-text-3);
}
.pb-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pb-chip {
  padding: 6px 10px;
  border: 1px solid var(--se-filete);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
}
.pb-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pb-input {
  display: flex;
  align-items: center;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--se-filete);
  border-radius: 8px;
  font-size: 14px;
  color: var(--se-text-3);
}
.pb-buy {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border-radius: 999px;
  background: var(--se-grafito);
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
}
.pb-checkout {
  padding: 10px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 8px;
}
.pb-row-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 4px;
  font-weight: 600;
}
.pb-row-sub {
  font-size: 13px;
  color: var(--se-text-3);
}
.pb-desc {
  margin: 8px 0 10px;
  padding: 12px 14px;
  border: 1px solid var(--se-filete);
  border-radius: 4px;
  background: var(--se-papel);
  font-size: 14px;
  line-height: 21px;
}
.pb-desc-h {
  font-weight: 700;
  font-size: 15px;
}
.pb-desc-h + .pb-desc-list {
  margin-bottom: 10px;
}
.pb-desc-list {
  padding-left: 18px;
  list-style: disc;
  color: var(--se-text-2);
}
.pb-soon {
  margin-top: 10px;
}
@media (min-width: 1024px) {
  .pb {
    padding: 28px;
  }
  .pb-example {
    position: absolute;
    top: 10px;
    right: 14px;
    margin: 0;
  }
  .pb-grid {
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
    gap: 40px;
  }
  .pb-days {
    display: none;
  }
  .pb-program.is-multi {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .pb-day {
    display: block;
  }
  .pb-table {
    display: table;
  }
  .pb-cards {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pb-pointer {
    display: none;
  }
  .pb-block-move,
  .pb-block-enter-active,
  .pb-label-enter-active,
  .pb-label-leave-active,
  .pb-table tbody tr {
    transition: none;
  }
}
</style>
