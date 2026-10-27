<script setup>
// Demo del correo "¿Cómo estuvo?" (SPEC_landing_productores §5.5b). Igual que el producto
// (docs/runbooks/resenas-e-invitaciones.md): las estrellas solo preseleccionan y la reseña se manda con el botón; el
// premio opcional es un código GRACIAS-XXXXXX. Usa las mismas estrellas que la página del evento (event/StarRating.vue).
// L20: en esta demo la estrella en hover crece a 1.15 en 160 ms con la curva spring, las elegidas se rellenan de lima
// (la página del evento sigue en ámbar: solo se pisa dentro de .rv) y el agradecimiento entra con el mismo fade de los
// mensajes del chat (300 ms). Analítica (§11): lp_review_demo { stars } al enviar.
import { ref } from 'vue'
import StarRating from '../event/StarRating.vue'
import { trackEvent } from '../../composables/useGoogleAnalytics.js'

const props = defineProps({
  eventName: { type: String, required: true },
  /** Premio por calificar: % y prefijo del código, desde netlify/lib/reviews.mjs (REWARD_LIMITS, REWARD_CODE_PREFIX) */
  rewardPercent: { type: Number, required: true },
  rewardCodePrefix: { type: String, required: true },
})

const rating = ref(0)
const sent = ref(false)

function send() {
  if (!rating.value) return
  sent.value = true
  trackEvent('lp_review_demo', { stars: rating.value })
}
function reset() {
  rating.value = 0
  sent.value = false
}
</script>

<template>
  <div class="rv lp-tile" data-testid="review-demo">
    <p class="rv-kicker">Correo · después de la función</p>
    <p class="rv-title">¿Cómo estuvo {{ eventName }}?</p>
    <div v-if="!sent" class="rv-form">
      <StarRating v-model="rating" :readonly="false" :size="26" label="Tu calificación" show-label />
      <button
        type="button"
        class="ev-btn ev-btn-primary rv-send"
        :disabled="!rating"
        data-testid="review-demo-send"
        @click="send"
      >Enviar reseña</button>
    </div>
    <div v-else class="rv-thanks" role="status">
      <p class="rv-thanks-title">¡Gracias por tu nota!</p>
      <p class="rv-thanks-text">Te regalamos {{ props.rewardPercent }}% para el próximo evento:</p>
      <p class="rv-code">{{ props.rewardCodePrefix }}7K2QXM</p>
      <button type="button" class="rv-reset" @click="reset">Volver a probar</button>
    </div>
  </div>
</template>

<style scoped>
.rv {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px;
  border-radius: 20px;
}
.rv-kicker {
  font-size: 12px;
  color: var(--text-2);
}
.rv-title {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 16px;
  line-height: 22px;
  font-weight: 700;
}
.rv-form {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}
.rv-send {
  min-height: 40px;
  padding: 0 14px;
  font-size: 14px;
}
.rv-thanks {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  animation: ev-fade-up 300ms var(--ease-out) both;
}
.rv :deep(.pick) {
  transition-duration: 160ms;
  transition-timing-function: var(--ease-spring);
}
.rv :deep(.pick:hover) {
  transform: scale(1.15);
}
/* Después del hover: al hacer clic el pointer sigue encima y si no se perdería el "press" de StarRating */
.rv :deep(.pick:active) {
  transform: scale(0.94);
}
.rv :deep(.pick.is-on svg) {
  fill: var(--brand-lime);
  stroke: var(--brand-ink);
}
.rv-thanks-title {
  font-size: 15px;
  font-weight: 600;
}
.rv-thanks-text {
  font-size: 13px;
  color: var(--text-2);
}
.rv-code {
  padding: 6px 10px;
  border: 1.5px dashed var(--text-1);
  border-radius: var(--r-sm);
  background: var(--surface-0);
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.rv-reset {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 12px;
  color: var(--text-2);
  text-decoration: underline;
  cursor: pointer;
}
.rv-reset:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .rv-thanks {
    animation-duration: 1ms;
  }
  .rv :deep(.pick) {
    transition-duration: 1ms;
  }
}
</style>
