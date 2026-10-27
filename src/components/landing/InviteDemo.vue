<script setup>
// Demo de "Invitar a los asistentes al próximo evento" (SPEC_landing_productores §5.5b). En el producto
// (/api/events/invitations) se omite a quienes ya compraron y a quienes se dieron de baja; aquí son cifras de ejemplo.
// Analítica (§11): lp_invite_demo al apretar el botón (una vez).
import { ref } from 'vue'
import { trackEvent } from '../../composables/useGoogleAnalytics.js'

const sent = ref(false)

function invite() {
  if (sent.value) return
  sent.value = true
  trackEvent('lp_invite_demo')
}
</script>

<template>
  <div class="inv">
    <button type="button" class="ev-btn ev-btn-primary inv-btn" :aria-pressed="sent ? 'true' : 'false'" data-testid="invite-demo" @click="invite">
      {{ sent ? '✓ Invitación enviada a 214' : 'Invitar a los asistentes al próximo evento' }}
    </button>
    <p class="inv-note" aria-live="polite">
      {{ sent ? 'Se omitieron 31 que ya compraron y 6 que se dieron de baja.' : 'Ejemplo con 251 asistentes.' }}
    </p>
  </div>
</template>

<style scoped>
.inv {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.inv-btn {
  min-height: 44px;
  padding: 0 18px;
  font-size: 15px;
  text-align: left;
}
.inv-note {
  font-size: 13px;
  color: var(--text-2);
}
</style>
