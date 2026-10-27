<script setup>
// La mesa de acreditación (SPEC_landing_seminarios §4.7, firma 2): arriba la credencial que se imprime y cuelga del
// cordón, a la izquierda las tres mesas y la fila; al centro, el escáner en tonos claros con los textos reales de ValidateQR.vue
// (deskMessage, mismatchWarning): "Mesa 2", el contador "{n} / {m} entradas validadas" y, sin señal, "Sin conexión · N
// por sincronizar". "Acreditar siguiente" recorre cinco casos:
//   1. Carolina Muñoz · Solo día 1 → validada (banner lima). Credencial ASISTENTE.
//   2. Diego Fuentes · Estudiante → validada sin señal "(pendiente de sincronizar)"; la mesa pide la credencial.
//   3. Andrea Soto · Solo día 2, escaneada el Día 1 → el aviso amarillo de otra función con "✓ Validar Entrada" /
//      "✗ Cancelar" (los botones reales); validarla deja " · Ojo: entrada para {función}".
//   4. Rodrigo Pérez sin QR → "▼ Buscar asistente (validación manual / reenviar entradas)", el campo "Buscar por nombre o
//      correo..." escribe "Rodrigo" solo y aparece su fila con "✓ Validar" y "✉️ Reenviar entradas" → validada a mano.
//   5. Paula Ríos · Cortesía → validada. Credencial EXPOSITORA.
// Después del 5, "↻ Otra vez". El contador y la mesa 2 suben con cada válida (210 → 214 = 71 + 68 + 75). Resultado en
// aria-live. Sin JS: los cinco casos como lista (con JS, la lista queda para lectores de pantalla).
// En desktop la raíz ocupa dos columnas de la grilla de la sección (1fr 300px) y repite esas columnas adentro; no puede
// ser display: contents porque client:visible observa la raíz de la isla. La credencial sale del flujo y cuelga sobre
// la columna 3 de la sección, desde su borde superior (§4.7 "Arriba, colgando del borde de la sección"): el cordón se
// alarga hacia arriba y la sección lo recorta en su borde. No baja desde el rótulo, como dice la spec: el rótulo, el H2 y
// la bajada ocupan la columna 1 y un cordón desde ahí los cruzaría. Se balancea al entrar en pantalla (C4, solo
// desktop) y con cada caso. En mobile va arriba, en el flujo, y solo se mueve al cambiar de caso (C12).
// Movimiento: C11 el banner baja y el aviso dibuja su borde; C12 la credencial se imprime y se balancea (C4); C13 la
// primera silueta de la fila sale hacia la mesa y las demás avanzan (FLIP). Con "reducir movimiento", el caso 4 aparece
// ya escrito y nada se anima. Analítica: se_scan_demo {case}.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import Credential from './Credential.vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { motionOn, swing } from './seminariosLanding.client.js'
import { DESK_CASES, DESK_PENDING, DESK_QUEUE, DESK_START, DESK_TABLES, ISSUED_TICKETS, SEMINAR_NAME, deskMessage, mismatchWarning } from './seminariosLanding.js'

const props = defineProps({
  /** Rótulo de la función del Día 2 como lo dice el escáner ("Vie 4 dic · 09:00", formatFunctionLabel) */
  fnLabel: { type: String, required: true },
})

const TYPE_MS = 90
const step = ref(-1) // -1: antes del primer caso
const phase = ref('idle') // idle | confirm | search | done
const validated = ref(DESK_START)
const live = ref(DESK_TABLES.find((t) => t.live).start)
const pending = ref(DESK_PENDING)
const queue = ref(Array.from({ length: DESK_QUEUE }, (_, i) => i))
const result = ref('')
const resultKind = ref('ok')
const typed = ref('')
const searchOpen = ref(false)
const hydrated = ref(false)
const printKey = ref(0)
const credRef = ref(null)
const nextButton = ref(null)
const screen = ref(null)
/** El botón que tiene el foco se deshabilita mientras se resuelve el caso: el foco pasa al botón del caso */
const focusIn = (testid) => nextTick(() => screen.value?.querySelector(`[data-testid="${testid}"]`)?.focus())
const current = computed(() => (step.value >= 0 ? DESK_CASES[step.value] : null))
const shown = computed(() => current.value ?? DESK_CASES[0])
const finished = computed(() => step.value === DESK_CASES.length - 1 && phase.value === 'done')
const busy = computed(() => phase.value === 'confirm' || phase.value === 'search')
const offline = computed(() => current.value?.offline && phase.value !== 'idle')
const matches = computed(() => (typed.value.length >= 3 ? [current.value] : []))
const tables = computed(() => DESK_TABLES.map((t) => ({ ...t, n: t.live ? live.value : t.start })))
const day = (c) => `${SEMINAR_NAME} · ${c?.type === 'Solo día 2' ? 'Día 2' : 'Día 1'}`

let typeTimer = null
let credIo = null
onMounted(() => {
  hydrated.value = true
  // C4 al entrar en pantalla (desktop): una vez; después se balancea con cada caso (print)
  const el = credRef.value?.$el
  if (!el || !('IntersectionObserver' in window) || !window.matchMedia('(min-width: 1024px)').matches) return
  credIo = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return
      swing(entry.target)
      credIo.disconnect()
    },
    { threshold: 0.4 },
  )
  credIo.observe(el)
})
onBeforeUnmount(() => {
  clearTimeout(typeTimer)
  credIo?.disconnect()
})

function print() {
  printKey.value += 1
  nextTick(() => {
    const el = credRef.value?.$el
    if (!el || !motionOn()) return
    el.classList.add('is-printing')
    setTimeout(() => {
      el.classList.remove('is-printing')
      swing(el)
    }, 450)
  })
}
function accept(c, message) {
  validated.value += 1
  live.value += 1
  if (c.offline) pending.value += 1
  result.value = message
  resultKind.value = 'ok'
  phase.value = 'done'
  print()
}
function advance() {
  if (finished.value) return reset()
  step.value += 1
  const c = DESK_CASES[step.value]
  queue.value = queue.value.slice(1)
  result.value = ''
  searchOpen.value = false
  typed.value = ''
  trackEvent('se_scan_demo', { case: c.id })
  if (c.kind === 'ok') return accept(c, deskMessage(c))
  if (c.kind === 'mismatch') {
    phase.value = 'confirm'
    focusIn('seminar-desk-validate')
    return
  }
  // Sin QR: se abre la búsqueda y se escribe el nombre solo (con "reducir movimiento", ya escrito)
  phase.value = 'search'
  searchOpen.value = true
  if (!motionOn()) {
    typed.value = c.search
    focusIn('seminar-desk-manual')
    return
  }
  const type = (i) => {
    typed.value = c.search.slice(0, i)
    if (i < c.search.length) typeTimer = setTimeout(() => type(i + 1), TYPE_MS)
    else focusIn('seminar-desk-manual')
  }
  type(1)
}
function confirmMismatch() {
  accept(current.value, deskMessage(current.value, props.fnLabel))
  nextTick(() => nextButton.value?.focus())
}
function cancelMismatch() {
  phase.value = 'done'
  result.value = ''
  nextTick(() => nextButton.value?.focus())
}
function validateManual() {
  accept(current.value, deskMessage(current.value))
  nextTick(() => nextButton.value?.focus())
}
const resent = ref(false)
function resend() {
  resent.value = true
}
function reset() {
  step.value = -1
  phase.value = 'idle'
  validated.value = DESK_START
  live.value = DESK_TABLES.find((t) => t.live).start
  pending.value = DESK_PENDING
  queue.value = Array.from({ length: DESK_QUEUE }, (_, i) => i)
  result.value = ''
  typed.value = ''
  searchOpen.value = false
  resent.value = false
}
</script>

<template>
  <div class="ad" data-testid="seminar-desk">
    <!-- Izquierda: credencial (en desktop cuelga arriba, sobre la columna 3), mesas y fila -->
    <div class="ad-side">
      <div class="ad-cred" aria-hidden="true">
        <Credential
          :key="printKey"
          ref="credRef"
          :name="shown.name"
          :org="shown.org"
          :type="shown.credential"
          :day="day(shown)"
          :cord="140"
          responsive
          :class="{ 'is-waiting': step < 0 }"
        />
      </div>
      <ul class="ad-tables" aria-label="Acreditadas por mesa (ejemplo)">
        <li v-for="t in tables" :key="t.id" class="ad-table" :class="{ 'is-live': t.live }">
          <span class="se-meta">Mesa {{ t.id }}</span>
          <span class="ad-table-n se-tabular">{{ t.n }}</span>
        </li>
      </ul>
      <div class="ad-queue-wrap">
        <p class="se-meta">La fila</p>
        <TransitionGroup name="ad-q" tag="ul" class="ad-queue" aria-hidden="true">
          <li v-for="q in queue" :key="q" class="ad-person"></li>
        </TransitionGroup>
      </div>
    </div>

    <!-- Centro: el escáner -->
    <div class="ad-center">
      <div class="ad-phone">
        <div ref="screen" class="ad-screen">
          <div class="ad-top">
            <p class="ad-desk">Mesa 2</p>
            <p class="ad-count"><span class="se-tabular" data-testid="seminar-desk-count">{{ validated }} / {{ ISSUED_TICKETS }}</span> entradas validadas</p>
            <p v-if="offline" class="ad-offline">Sin conexión · <span class="se-tabular">{{ pending }}</span> por sincronizar</p>
          </div>
          <div class="ad-viewfinder" aria-hidden="true">
            <span class="ad-c ad-c1"></span><span class="ad-c ad-c2"></span><span class="ad-c ad-c3"></span><span class="ad-c ad-c4"></span>
          </div>

          <!-- Caso 3: confirmar con el aviso de otra función -->
          <div v-if="phase === 'confirm'" class="ad-confirm" data-testid="seminar-desk-confirm">
            <p class="ad-confirm-title">Confirmar validación</p>
            <p><strong>Nombre:</strong> {{ current.name }}</p>
            <p><strong>Ticket:</strong> {{ current.type }}</p>
            <p class="ad-warning" role="alert">{{ mismatchWarning(props.fnLabel) }}</p>
            <div class="ad-confirm-btns">
              <button type="button" class="ad-ok se-focus" data-testid="seminar-desk-validate" @click="confirmMismatch">✓ Validar Entrada</button>
              <button type="button" class="ad-cancel se-focus" @click="cancelMismatch">✗ Cancelar</button>
            </div>
          </div>

          <!-- Caso 4: búsqueda por nombre -->
          <div v-if="searchOpen" class="ad-search" data-testid="seminar-desk-search">
            <p class="ad-search-toggle">▲ Ocultar búsqueda de asistentes</p>
            <input class="ad-search-input" :value="typed" placeholder="Buscar por nombre o correo..." readonly tabindex="-1" aria-label="Buscar por nombre o correo" />
            <div v-if="matches.length && phase === 'search'" class="ad-match">
              <p><strong>{{ current.name }}</strong> · {{ current.type }}</p>
              <div class="ad-match-btns">
                <button type="button" class="ad-ok se-focus" data-testid="seminar-desk-manual" @click="validateManual">✓ Validar</button>
                <button type="button" class="ad-resend se-focus" @click="resend">✉️ Reenviar entradas</button>
              </div>
              <p v-if="resent" class="ad-note">Le llega otra vez su entrada al correo.</p>
            </div>
          </div>
          <p v-else-if="phase !== 'confirm'" class="ad-search-toggle is-closed">▼ Buscar asistente (validación manual / reenviar entradas)</p>

          <div v-if="result" :key="`${step}-${result}`" class="ad-result" :class="`is-${resultKind}`" data-testid="seminar-desk-result">
            <p>{{ result }}</p>
            <p v-if="current?.type" class="ad-type">Tipo de entrada: <strong>{{ current.type }}</strong></p>
            <p v-if="current?.note" class="ad-note">{{ current.note }}</p>
          </div>

          <button ref="nextButton" type="button" class="se-btn se-btn-solid ad-next" :disabled="busy || !hydrated" data-testid="seminar-desk-next" @click="advance">
            <span>{{ finished ? '↻ Otra vez' : 'Acreditar siguiente' }}</span>
            <span class="se-btn-arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      <p class="lp-sr-only" aria-live="polite">{{ result }}</p>
      <ol class="ad-list" :class="{ 'lp-sr-only': hydrated }" aria-label="Casos de la mesa de acreditación, ejemplo">
        <li v-for="(c, i) in DESK_CASES" :key="c.id">
          {{ c.kind === 'mismatch' ? `${mismatchWarning(props.fnLabel)} → ` : '' }}{{ deskMessage(c, i === 2 ? props.fnLabel : '') }} · {{ c.type }}<template v-if="c.note"> · {{ c.note }}</template>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.ad {
  display: grid;
  gap: 32px;
}
.ad-side,
.ad-center {
  min-width: 0;
}
.ad-side {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.ad-cred {
  display: flex;
  justify-content: center;
  padding-top: 140px;
}
.ad-cred :deep(.is-waiting .se-cred-card) {
  opacity: 0.8;
}
.ad-tables {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid rgba(255, 255, 255, 0.3);
}
.ad-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
}
.ad-table-n {
  font-size: 32px;
  line-height: 36px;
  font-weight: 800;
  font-stretch: 125%;
}
.ad-table.is-live .ad-table-n {
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 6px;
}
.ad-queue {
  display: flex;
  gap: 6px;
  min-height: 26px;
  margin-top: 8px;
}
.ad-person {
  width: 18px;
  height: 26px;
  border-radius: 9px 9px 3px 3px;
  background: rgba(255, 255, 255, 0.78);
}
.ad-person::before {
  content: "";
  display: block;
  width: 10px;
  height: 10px;
  margin: -6px auto 0;
  border-radius: 50%;
  background: inherit;
}
.ad-q-move {
  transition: transform 300ms var(--se-ease);
}
.ad-q-leave-active {
  position: absolute;
  transition: transform 300ms var(--se-ease), opacity 300ms var(--se-ease);
}
.ad-q-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}
.ad-phone {
  width: 260px;
  height: 520px;
  margin: 0 auto;
  padding: 10px;
  border-radius: 36px;
  background: var(--se-grafito);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.3);
}
.ad-screen {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  padding: 14px 12px 12px;
  overflow: hidden;
  border-radius: 28px;
  background: #f3f4f6;
  color: #111827;
  font-size: 12px;
  line-height: 16px;
}
.ad-desk {
  font-weight: 700;
  font-size: 14px;
}
.ad-count {
  color: #4b5563;
}
.ad-offline {
  align-self: flex-start;
  margin-top: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e5e7eb;
  font-weight: 600;
}
.ad-viewfinder {
  position: relative;
  flex: 0 0 96px;
  margin: 2px 24px;
  border-radius: 8px;
  background: #1f2937;
}
.ad-c {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 3px solid #ffffff;
}
.ad-c1 {
  top: 10px;
  left: 10px;
  border-right: 0;
  border-bottom: 0;
}
.ad-c2 {
  top: 10px;
  right: 10px;
  border-left: 0;
  border-bottom: 0;
}
.ad-c3 {
  bottom: 10px;
  left: 10px;
  border-right: 0;
  border-top: 0;
}
.ad-c4 {
  bottom: 10px;
  right: 10px;
  border-left: 0;
  border-top: 0;
}
.ad-confirm,
.ad-search {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 2px solid #3b82f6;
  border-radius: 6px;
  background: #ffffff;
}
.ad-confirm-title {
  font-weight: 700;
}
.ad-warning {
  margin-top: 4px;
  padding: 6px;
  border: 1px solid #facc15;
  border-radius: 4px;
  background: var(--se-aviso);
  color: var(--se-aviso-ink);
  animation: ad-draw 360ms var(--se-ease) both;
}
@keyframes ad-draw {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}
.ad-confirm-btns,
.ad-match-btns {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
.ad-ok,
.ad-cancel,
.ad-resend {
  flex: 1 1 auto;
  min-height: 36px;
  padding: 0 6px;
  border: 0;
  border-radius: 4px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: #ffffff;
  cursor: pointer;
}
.ad-ok {
  background: #16a34a;
}
.ad-cancel {
  background: #6b7280;
}
.ad-resend {
  background: #e5e7eb;
  color: #111827;
}
.ad-search-toggle {
  font-size: 11px;
  color: #2563eb;
}
.ad-search-toggle.is-closed {
  margin-top: auto;
}
.ad-search-input {
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #ffffff;
  font: inherit;
  color: #111827;
}
.ad-match {
  padding-top: 4px;
  border-top: 1px solid #e5e7eb;
}
.ad-result {
  padding: 8px;
  border-radius: 4px;
  font-weight: 600;
  animation: ad-drop 200ms var(--se-ease) both;
}
.ad-result.is-ok {
  background: var(--brand-lime);
  color: var(--se-grafito);
}
.ad-type {
  margin-top: 2px;
  font-weight: 400;
}
.ad-note {
  margin-top: 2px;
  font-weight: 400;
  font-size: 11px;
}
@keyframes ad-drop {
  from {
    opacity: 0;
    transform: translateY(-12px);
  }
}
.ad-next {
  width: 100%;
  min-height: 48px;
  margin-top: auto;
  font-size: 14px;
}
.ad-next:disabled {
  opacity: 0.5;
  cursor: default;
}
.ad-list {
  margin-top: 16px;
  padding-left: 20px;
  list-style: decimal;
  font-size: 14px;
  line-height: 22px;
}
@media (min-width: 1024px) {
  /* Cuelga sobre el centro de la columna 3 de la sección (1fr 300px 1fr, 40 px de separación), sobre la mesa */
  .ad-cred {
    position: absolute;
    right: calc((100% - 380px) / 4 - 130px);
    bottom: calc(100% + 24px);
    z-index: 1;
    padding-top: 0;
  }
  /* El cordón sigue hacia arriba hasta el borde de la sección (la sección lo recorta): las dos bandas del SVG */
  .ad-cred::before {
    content: "";
    position: absolute;
    left: 50%;
    bottom: calc(100% + 140px);
    width: 60px;
    height: 1200px;
    transform: translateX(-50%);
    background: linear-gradient(
      to right,
      transparent 4px,
      var(--se-cordon) 4px 18px,
      transparent 18px 42px,
      color-mix(in srgb, var(--se-cordon) 86%, transparent) 42px 56px,
      transparent 56px
    );
  }
  .ad {
    grid-column: span 2;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 40px;
    align-items: start;
  }
  .ad-phone {
    width: 300px;
    height: 600px;
  }
  .ad-screen {
    padding: 18px 14px 14px;
    font-size: 13px;
    line-height: 18px;
  }
  .ad-viewfinder {
    flex-basis: 120px;
  }
  .ad-table {
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
    padding: 12px 0;
  }
  .ad-tables {
    grid-template-columns: 1fr;
  }
}
@media (min-width: 1024px) and (max-width: 1239px) {
  .ad-cred {
    transform: scale(0.82);
    transform-origin: 50% 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ad-warning,
  .ad-result {
    animation: none;
  }
  .ad-q-move,
  .ad-q-leave-active {
    transition: none;
  }
}
</style>
