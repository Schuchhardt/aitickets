<script setup>
// Demo de invitación al nivel 2 (SPEC_landing_talleres §4.7): elegir a quién invitar (las audiencias del panel,
// INVITE_AUDIENCES de reviews.mjs, que la página pasa por props sin la de "Solo quienes calificaron" para que quepan), el
// contador de personas de ejemplo y la vista previa del correo con el texto por defecto de invitationCopy
// (invitations.ts, replicado en talleresLanding.js con un test que compara). "Enviar invitación" no envía nada: muestra
// "✓ Invitación programada · ejemplo".
// TL16: el contador interpola entre audiencias (300 ms) y el check hace pop. Con "reducir movimiento", sin animaciones.
// Analítica: tl_invite_audience { audience }.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { formatRating } from '../../event/eventView.js'
import { INVITE_DEMO, invitationBody } from './talleresLanding.js'

const props = defineProps({
  /** [{ value, label }] con los textos de INVITE_AUDIENCES */
  audiences: { type: Array, required: true },
})

const audience = ref(props.audiences[0].value)
const shown = ref(INVITE_DEMO.counts[audience.value])
const sent = ref(false)
const body = invitationBody(INVITE_DEMO.from, INVITE_DEMO.to)
let reduced = true
let frame = 0

onMounted(() => {
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
})
onBeforeUnmount(() => cancelAnimationFrame(frame))

watch(audience, (value) => {
  sent.value = false
  trackEvent('tl_invite_audience', { audience: value })
  const to = INVITE_DEMO.counts[value]
  cancelAnimationFrame(frame)
  if (reduced) {
    shown.value = to
    return
  }
  const from = shown.value
  const start = performance.now()
  const step = (now) => {
    const t = Math.min(1, (now - start) / 300)
    shown.value = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)))
    if (t < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
})
</script>

<template>
  <div class="tl-card tl-card-plain inv" data-testid="workshop-invite">
    <p class="tl-card-head tl-card-label">Invitación · ejemplo</p>
    <div class="tl-card-body inv-body">
      <p class="inv-route">
        <span><span class="inv-k">De:</span> {{ INVITE_DEMO.from }}</span>
        <span><span class="inv-k">A:</span> {{ INVITE_DEMO.to }} · {{ INVITE_DEMO.toWhen }}</span>
      </p>

      <fieldset class="inv-field">
        <legend class="tl-control-label">¿A quiénes?</legend>
        <div class="tl-seg inv-seg">
          <label v-for="a in props.audiences" :key="a.value" class="tl-seg-opt">
            <input v-model="audience" type="radio" name="inv-audience" :value="a.value" :data-testid="`workshop-invite-${a.value}`" />
            <span>{{ a.label }}</span>
          </label>
        </div>
      </fieldset>

      <p class="inv-count">
        <span class="tl-num inv-count-n" data-testid="workshop-invite-count">{{ shown }}</span> personas
        <span class="lp-sr-only" aria-live="polite">{{ INVITE_DEMO.counts[audience] }} personas</span>
      </p>

      <div class="inv-mail">
        <p class="inv-mail-text">{{ body }}</p>
        <span class="tl-btn tl-btn-sm inv-mail-btn" aria-hidden="true">Ver el taller</span>
        <p class="inv-rating">★ {{ formatRating(INVITE_DEMO.rating) }} · {{ INVITE_DEMO.reviews }} reseñas · ejemplo</p>
      </div>

      <div class="inv-send">
        <!-- aria-disabled y no disabled: el botón conserva el foco después del clic -->
        <button type="button" class="tl-btn tl-btn-lime" :aria-disabled="sent ? 'true' : 'false'" @click="sent = true">Enviar invitación</button>
        <p class="inv-sent" role="status">
          <span v-if="sent" class="inv-sent-in">✓ Invitación programada · ejemplo</span>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inv-body {
  display: grid;
  gap: 18px;
  padding-top: 20px;
}
.inv-route {
  display: grid;
  gap: 4px;
  font-size: 15px;
  line-height: 22px;
}
.inv-k {
  font-weight: 600;
  color: var(--tl-grafito-3);
}
.inv-field {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.inv-seg {
  margin-top: 10px;
}
.inv-seg :deep(span) {
  white-space: normal;
  padding-block: 8px;
}
.inv-count {
  font-size: 16px;
  color: var(--tl-grafito-2);
}
.inv-count-n {
  font-size: 44px;
  line-height: 1;
  color: var(--tl-grafito);
}
.inv-mail {
  padding: 16px;
  border: 1px solid var(--tl-line-strong);
  border-radius: 8px;
  background: var(--tl-papel);
}
.inv-mail-text {
  font-size: 15px;
  line-height: 23px;
}
.inv-mail-btn {
  margin-top: 12px;
  pointer-events: none;
}
.inv-rating {
  margin-top: 12px;
  font-size: 13px;
  color: var(--tl-grafito-3);
}
.inv-send {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}
.inv-send .tl-btn[aria-disabled='true'] {
  cursor: default;
}
.inv-send .tl-btn[aria-disabled='true']:is(:hover, :active) {
  transform: none;
  box-shadow: var(--tl-sombra-boton) var(--tl-sombra-boton) 0 var(--tl-grafito);
}
.inv-sent {
  min-height: 24px;
  font-size: 15px;
  font-weight: 600;
}
.inv-sent-in {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--brand-lime);
}
.lp-motion .inv-sent-in {
  animation: tl-pop-sticker 300ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
@media (prefers-reduced-motion: reduce) {
  .inv-sent-in {
    animation: none;
  }
}
</style>
