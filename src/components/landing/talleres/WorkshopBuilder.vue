<script setup>
// "Arma tu taller" (SPEC_landing_talleres §4.3, firma de la página): una ficha con cinco controles (qué enseñas, cómo
// es, cupos por fecha, si cobras y cuántos inscritos van) que arma en vivo la página de inscripción en un teléfono y,
// debajo, la lista de lo que AI Tickets hace en ese caso.
// La página de ejemplo dice exactamente lo que diría la real: talleresLanding.js arma un evento sintético (fakeEvent) y
// le pide el rótulo a cardState / cardLabel y el estado de cada fecha a checkoutFunctions (eventView.js); el precio
// final es el de priceQuote (fees.mjs: $28.000 → $30.666). Los botones y la lista de espera son los de la card real
// (RsvpForm / NotifyForm). Lo que no existe va con "Pronto" (builderNotes).
// - SSR / sin JS: Cerámica, un día, con pago, 7 de 10 ("Últimas entradas") y sus notas; los controles se ocultan con un
//   <noscript> de WorkshopBuild.astro (la página se lee igual, sin controles que no funcionan).
// - Con JS y movimiento: al hidratar (antes de verse, la página usa rootMargin) los inscritos vuelven a 0 y, al entrar
//   al 35 %, el slider sube solo hasta el valor inicial en 900 ms, una vez (TL9); si la persona tocó algo antes, no.
//   TL10: el teléfono hace crossfade + translateY 8 px al cambiar de taller, formato, cobro o al llenarse; el rótulo
//   hace pop; las notas entran con stagger 60 ms.
// - Con "reducir movimiento": queda en el estado inicial, sin moverse solo y sin animaciones.
// Accesibilidad: controles nativos (fieldset + radios, range, botones del stepper con aria-label); el teléfono es una
// región con aria-label y sus botones son aria-hidden y no enfocables; lo que muestra la página (con los cupos) se
// anuncia con pausa, solo después de que la persona toca algo.
// Analítica: tl_builder_change { control, value } (debounce 600 ms) y tl_builder_full (una vez, al llenar el taller).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SoonBadge from '../../ui/SoonBadge.vue'
import { formatCLP, priceQuote } from '../producerLanding.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { useDelayedAnnouncement } from '../../../composables/usePriceCalculator.js'
import {
  BUILDER_INITIAL,
  BUILDER_PRICE,
  BUILDER_SEATS,
  FORMATS,
  WORKSHOP_PRESETS,
  builderNotes,
  presetById,
  presetPrice,
  previewModel,
} from './talleresLanding.js'

const props = defineProps({
  /** { text, href } de TERMS_NOTE (producerFaq.ts): la página lo pasa para no cargar ese módulo en el navegador */
  termsNote: { type: Object, required: true },
})

const initialPreset = presetById(BUILDER_INITIAL.preset)
const presetId = ref(initialPreset.id)
const format = ref(BUILDER_INITIAL.format)
const seats = ref(initialPreset.seats)
const paid = ref(initialPreset.price > 0)
const price = ref(presetPrice(initialPreset, BUILDER_INITIAL.format))
const enrolled = ref(initialPreset.seats - BUILDER_INITIAL.enrolledGap)
const touched = ref(false)
const motion = ref(false)
const root = ref(null)

const preset = computed(() => presetById(presetId.value))
const model = computed(() =>
  previewModel({ preset: preset.value, format: format.value, paid: paid.value, price: price.value, seats: seats.value, enrolled: enrolled.value }),
)
const notes = computed(() => builderNotes({ format: format.value, paid: paid.value, enrolled: enrolled.value, seats: seats.value }))
const buyerPays = computed(() => formatCLP(priceQuote(price.value).buyerPays))
const boxes = computed(() => Math.min(seats.value, BUILDER_SEATS.visibleBoxes))
const moreBoxes = computed(() => Math.max(0, seats.value - BUILDER_SEATS.visibleBoxes))
// El teléfono cambia de "página" (TL10) con cambios de estructura, no con cada paso del slider
const phoneKey = computed(() => `${presetId.value}-${format.value}-${paid.value}-${model.value.soldOut}`)
const showWaitlist = computed(() => model.value.soldOut && format.value !== 'weekly')

// Se anuncia solo lo que cambia la persona (no la subida automática del TL9) y con los cupos, que el stepper no anuncia
const announcement = computed(() => (touched.value ? { m: model.value, seats: seats.value } : null))
const announced = useDelayedAnnouncement(
  announcement,
  ({ m, seats: n }) => `${n} cupos. La página muestra: ${m.label ? m.label.text : m.finalPrice}.`,
)

// ---- Analítica (debounce por control) ----
const timers = {}
let fullTracked = false
function track(control, value) {
  clearTimeout(timers[control])
  timers[control] = setTimeout(() => trackEvent('tl_builder_change', { control, value }), 600)
}
function touch() {
  touched.value = true
  stopAuto()
}

// ---- Controles ----
function choosePreset(id) {
  touch()
  presetId.value = id
  const p = presetById(id)
  seats.value = p.seats
  paid.value = p.price > 0
  price.value = presetPrice(p, format.value)
  enrolled.value = p.seats - BUILDER_INITIAL.enrolledGap
  track('preset', id)
}
function chooseFormat(id) {
  touch()
  format.value = id
  if (paid.value) price.value = presetPrice(preset.value, id)
  track('format', id)
}
function changeSeats(delta) {
  touch()
  seats.value = Math.min(BUILDER_SEATS.max, Math.max(BUILDER_SEATS.min, seats.value + delta))
  enrolled.value = Math.min(enrolled.value, seats.value)
  track('seats', seats.value)
}
function choosePaid(value) {
  touch()
  if (value && !paid.value) price.value = presetPrice(preset.value, format.value)
  paid.value = value
  track('paid', value)
}
function onPrice() {
  touch()
  track('price', price.value)
}
function onEnrolled() {
  touch()
  track('enrolled', enrolled.value)
}
// Lleno por los inscritos o por bajar los cupos (changeSeats puede dejar enrolled igual y llenar el taller)
watch(
  () => model.value.soldOut,
  (soldOut) => {
    if (!touched.value || fullTracked || !soldOut) return
    fullTracked = true
    trackEvent('tl_builder_full')
  },
)

// ---- TL9: subida automática de los inscritos, una vez ----
let observer = null
let frame = 0
function stopAuto() {
  cancelAnimationFrame(frame)
  observer?.disconnect()
  observer = null
}
function autoFill() {
  const to = initialPreset.seats - BUILDER_INITIAL.enrolledGap
  const start = performance.now()
  const step = (now) => {
    const t = Math.min(1, (now - start) / 900)
    enrolled.value = Math.round(to * (1 - Math.pow(1 - t, 3)))
    if (t < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
}
onMounted(() => {
  motion.value = document.documentElement.classList.contains('lp-motion')
  if (!motion.value || !('IntersectionObserver' in window)) return
  enrolled.value = 0
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer?.disconnect()
      observer = null
      if (!touched.value) autoFill()
    },
    { threshold: 0.35 },
  )
  observer.observe(root.value)
})
onBeforeUnmount(() => {
  stopAuto()
  Object.values(timers).forEach(clearTimeout)
})
</script>

<template>
  <div ref="root" class="wb" :class="{ 'wb-motion': motion }" data-testid="workshop-builder">
    <div class="tl-card tl-card-plain wb-form">
      <p class="tl-card-head tl-card-label">Tu taller · ejemplo</p>
      <div class="tl-card-body wb-controls">
        <fieldset class="wb-field">
          <legend class="tl-control-label">¿Qué enseñas?</legend>
          <div class="tl-seg wb-scroll">
            <label v-for="p in WORKSHOP_PRESETS" :key="p.id" class="tl-seg-opt">
              <input
                type="radio"
                name="wb-preset"
                :value="p.id"
                :checked="presetId === p.id"
                :data-testid="`workshop-preset-${p.id}`"
                @change="choosePreset(p.id)"
              />
              <span>{{ p.label }}</span>
            </label>
          </div>
        </fieldset>

        <fieldset class="wb-field">
          <legend class="tl-control-label">¿Cómo es?</legend>
          <div class="tl-seg">
            <label v-for="f in FORMATS" :key="f.id" class="tl-seg-opt">
              <input
                type="radio"
                name="wb-format"
                :value="f.id"
                :checked="format === f.id"
                :data-testid="`workshop-format-${f.id}`"
                @change="chooseFormat(f.id)"
              />
              <span>{{ f.label }}</span>
            </label>
          </div>
        </fieldset>

        <div class="wb-field">
          <p id="wb-seats-label" class="tl-control-label">Cupos por fecha</p>
          <div class="tl-stepper wb-stepper" role="group" aria-labelledby="wb-seats-label">
            <button type="button" class="tl-step-btn" aria-label="Quitar un cupo" :disabled="seats <= BUILDER_SEATS.min" @click="changeSeats(-1)">−</button>
            <output class="tl-num tl-step-value" aria-live="off" data-testid="workshop-seats">{{ seats }}</output>
            <button type="button" class="tl-step-btn" aria-label="Agregar un cupo" :disabled="seats >= BUILDER_SEATS.max" @click="changeSeats(1)">+</button>
          </div>
          <div class="tl-boxes wb-boxes" aria-hidden="true">
            <span v-for="i in boxes" :key="i" class="tl-box">
              <svg v-if="i <= enrolled" viewBox="0 0 18 18"><path d="M3 9 L 7 13 L 15 2" /></svg>
            </span>
            <span v-if="moreBoxes" class="tl-box-more">+{{ moreBoxes }}</span>
          </div>
        </div>

        <fieldset class="wb-field">
          <legend class="tl-control-label">¿Cobras?</legend>
          <div class="tl-seg">
            <label class="tl-seg-opt">
              <input type="radio" name="wb-paid" :checked="!paid" data-testid="workshop-free" @change="choosePaid(false)" />
              <span>Gratis</span>
            </label>
            <label class="tl-seg-opt">
              <input type="radio" name="wb-paid" :checked="paid" data-testid="workshop-paid" @change="choosePaid(true)" />
              <span>Con pago</span>
            </label>
          </div>
          <div v-if="paid" class="wb-price">
            <label class="wb-price-label" for="wb-price">
              <span>Valor</span>
              <span class="tl-num wb-price-value">{{ formatCLP(price) }}</span>
            </label>
            <input
              id="wb-price"
              v-model.number="price"
              type="range"
              class="tl-range"
              :min="BUILDER_PRICE.min"
              :max="BUILDER_PRICE.max"
              :step="BUILDER_PRICE.step"
              :aria-valuetext="formatCLP(price)"
              data-testid="workshop-price"
              @input="onPrice"
            />
            <p class="wb-hint">
              Quien se inscribe paga <strong data-testid="workshop-buyer-pays">{{ buyerPays }}</strong> ·
              <a href="#precio" class="tl-link">¿y si lo absorbo yo? →</a>
            </p>
          </div>
        </fieldset>

        <div class="wb-field">
          <label class="wb-price-label" for="wb-enrolled">
            <span class="tl-control-label">Inscritos hasta ahora</span>
            <span class="tl-num wb-price-value">{{ enrolled }} de {{ seats }}</span>
          </label>
          <input
            id="wb-enrolled"
            v-model.number="enrolled"
            type="range"
            class="tl-range"
            min="0"
            :max="seats"
            step="1"
            :aria-valuetext="`${enrolled} de ${seats} cupos`"
            data-testid="workshop-enrolled"
            @input="onEnrolled"
          />
          <p class="tl-hand wb-move" aria-hidden="true">muévelo y mira qué pasa →</p>
        </div>
      </div>
    </div>

    <div class="wb-side">
      <p class="tl-example wb-phone-tag">Página de tu taller · ejemplo</p>
      <div class="wb-phone" role="region" aria-label="Vista previa de la página de inscripción" data-testid="workshop-phone">
        <Transition name="wb-swap" mode="out-in">
          <div :key="phoneKey" class="wb-page">
            <div class="wb-cover tl-grid">
              <p class="tl-display wb-cover-title">{{ preset.title }}</p>
              <p class="wb-cover-host">con {{ preset.host }}</p>
            </div>
            <div class="wb-page-body">
              <p class="wb-row"><span class="wb-row-k">Cuándo</span> {{ model.dateLine }}</p>
              <p class="wb-row"><span class="wb-row-k">Dónde</span> {{ preset.place }} · {{ preset.city }}</p>
              <p
                v-if="model.label"
                :key="model.label.text"
                class="wb-label"
                :class="`is-${model.label.tone}`"
                data-testid="workshop-label"
              >{{ model.label.text }}</p>

              <template v-if="format === 'course'">
                <p class="wb-dates">{{ model.courseLine }}</p>
                <div class="wb-ticket">
                  <span>{{ model.ticketName }}</span>
                  <span class="tl-num" data-testid="workshop-final">{{ model.finalPrice }}</span>
                </div>
              </template>
              <template v-else-if="format === 'weekly'">
                <ul class="wb-fns">
                  <li v-for="fn in model.functions" :key="fn.id" class="wb-fn">
                    <span>{{ fn.label }}</span>
                    <span class="wb-fn-status" :class="`is-${fn.status}`">{{ fn.text }}</span>
                  </li>
                </ul>
                <p class="wb-more">{{ model.moreDates }}</p>
                <p class="wb-from"><span class="tl-num" data-testid="workshop-final">{{ model.finalPrice }}</span></p>
              </template>
              <p v-else class="wb-from"><span class="tl-num" data-testid="workshop-final">{{ model.finalPrice }}</span></p>

              <div v-if="showWaitlist" class="wb-wait" aria-hidden="true" data-testid="workshop-waitlist">
                <span class="wb-input">tu@email.com</span>
                <span class="tl-btn tl-btn-sm wb-cta">{{ model.waitlistCta }}</span>
              </div>
              <span v-else class="tl-btn tl-btn-lime tl-btn-sm wb-cta" aria-hidden="true">{{ model.cta }}</span>
            </div>
          </div>
        </Transition>
      </div>
      <p class="lp-sr-only" aria-live="polite">{{ announced }}</p>

      <div class="wb-notes">
        <p class="tl-eyebrow">Lo que AI Tickets hace por ti</p>
        <TransitionGroup tag="ul" name="wb-note" class="wb-note-list" data-testid="workshop-notes">
          <li v-for="(n, i) in notes" :key="n.id" class="wb-note" :style="{ '--i': i }" :data-note="n.id">
            <span class="tl-tick" aria-hidden="true"><svg viewBox="0 0 26 26"><path d="M5 14 L 11 20 L 23 4" /></svg></span>
            <span>
              <strong>{{ n.text }}<template v-if="n.star">*</template></strong>
              <SoonBadge v-if="n.soon" class="wb-soon" />
              <span v-if="n.hint" class="wb-note-hint">{{ n.hint }}</span>
            </span>
          </li>
        </TransitionGroup>
        <p class="tl-terms"><a :href="props.termsNote.href">{{ props.termsNote.text }}</a></p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wb {
  display: grid;
  gap: 32px;
}
.wb-controls {
  display: grid;
  gap: 24px;
}
.wb-field {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.wb-field .tl-seg,
.wb-stepper,
.wb-boxes {
  margin-top: 10px;
}
/* Mobile: los chips de "¿Qué enseñas?" en scroll horizontal */
.wb-scroll {
  flex-wrap: nowrap;
  margin-inline: -20px;
  padding: 2px 20px 6px;
  overflow-x: auto;
  scrollbar-width: none;
}
.wb-scroll::-webkit-scrollbar {
  display: none;
}
.wb-price {
  margin-top: 16px;
}
.wb-price-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 15px;
  font-weight: 600;
}
.wb-price-value {
  font-size: 22px;
}
.wb-hint {
  font-size: 14px;
  line-height: 20px;
  color: var(--tl-grafito-2);
}
.wb-move {
  margin-top: 2px;
}

/* ---- Teléfono: en mobile solo la card (radio 12, borde grafito); en desktop, marco 300 × 620 ---- */
.wb-phone-tag {
  margin-bottom: 10px;
}
.wb-phone {
  overflow: hidden;
  border: 2px solid var(--tl-grafito);
  border-radius: 12px;
  background: var(--tl-ficha);
}
.wb-cover {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-height: 140px;
  padding: 16px;
  background-color: var(--tl-papel);
  border-bottom: 1px solid var(--tl-line);
}
.wb-cover-title {
  font-size: 26px;
  line-height: 28px;
}
.wb-cover-host {
  margin-top: 4px;
  font-size: 14px;
  color: var(--tl-grafito-2);
}
.wb-page-body {
  display: grid;
  gap: 10px;
  padding: 16px;
}
.wb-row {
  font-size: 14px;
  line-height: 20px;
}
.wb-row-k {
  display: inline-block;
  min-width: 56px;
  font-weight: 600;
  color: var(--tl-grafito-3);
}
/* Rótulo de la card real: en minúsculas en el texto, en mayúsculas por CSS */
.wb-label {
  justify-self: start;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.wb-label.is-warning {
  background: var(--tl-destacador);
}
.wb-label.is-neutral,
.wb-label.is-positive {
  background: var(--tl-papel-2);
}
.wb-dates {
  font-size: 14px;
  line-height: 20px;
}
.wb-ticket {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--tl-line-strong);
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
}
.wb-fns {
  display: grid;
  border-top: 1px solid var(--tl-line);
}
.wb-fn {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--tl-line);
  font-size: 14px;
}
.wb-fn-status {
  font-size: 12px;
  font-weight: 600;
  color: var(--tl-grafito-3);
}
.wb-fn-status.is-few {
  color: var(--tl-grafito);
}
.wb-fn-status.is-sold_out {
  text-decoration: line-through;
}
.wb-more {
  font-size: 13px;
  font-weight: 600;
  color: var(--tl-tinta);
}
.wb-from {
  font-size: 24px;
  line-height: 28px;
}
.wb-cta {
  width: 100%;
  pointer-events: none;
}
.wb-wait {
  display: grid;
  gap: 8px;
}
.wb-input {
  display: block;
  padding: 10px 12px;
  border: 1px solid var(--tl-line-strong);
  border-radius: 8px;
  background: var(--tl-papel);
  font-size: 14px;
  color: var(--tl-grafito-3);
}

/* ---- Lo que AI Tickets hace por ti ---- */
.wb-notes {
  margin-top: 28px;
}
.wb-note-list {
  display: grid;
  gap: 12px;
  margin-top: 12px;
}
.wb-note {
  display: flex;
  gap: 12px;
  font-size: 16px;
  line-height: 24px;
}
.wb-note strong {
  font-weight: 500;
}
.wb-soon {
  margin-left: 6px;
}
.wb-note-hint {
  display: block;
  font-size: 13px;
  line-height: 18px;
  color: var(--tl-grafito-3);
}

@media (min-width: 768px) {
  .wb-scroll {
    flex-wrap: wrap;
    margin-inline: 0;
    padding-inline: 0;
    overflow: visible;
  }
}
@media (min-width: 1024px) {
  .wb {
    grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    gap: 56px;
    align-items: start;
  }
  .wb-phone-tag,
  .wb-phone {
    margin-inline: auto;
  }
  .wb-phone-tag {
    width: 300px;
  }
  .wb-phone {
    width: 300px;
    height: 620px;
    border-radius: 36px;
    box-shadow: 6px 6px 0 var(--tl-grafito);
    padding-top: 22px;
  }
  .wb-notes {
    margin-top: 32px;
  }
}

/* ---- TL10 ---- */
.wb-motion .wb-swap-enter-active,
.wb-motion .wb-swap-leave-active {
  transition: opacity 220ms var(--ease-out), transform 220ms var(--ease-out);
}
.wb-motion .wb-swap-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.wb-motion .wb-swap-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
.wb-motion .wb-label {
  animation: wb-pop 200ms var(--ease-out);
}
@keyframes wb-pop {
  from {
    transform: scale(0.96);
  }
}
.wb-motion .wb-note-enter-active {
  transition: opacity 240ms var(--ease-out) calc(var(--i) * 60ms), transform 240ms var(--ease-out) calc(var(--i) * 60ms);
}
.wb-motion .wb-note-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.wb-motion .wb-note-leave-active {
  display: none;
}
.wb-motion .wb-note-move {
  transition: transform 220ms var(--ease-out);
}
@media (prefers-reduced-motion: reduce) {
  .wb-label {
    animation: none;
  }
}
</style>
