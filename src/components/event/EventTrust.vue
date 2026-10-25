<script setup>
// Identificación del organizador en la página del evento: razón social y RUT (Ley 19.496), sello "Productor
// verificado" (identidad aprobada con Didit) y, en eventos masivos, el estado de la autorización de la
// Delegación Presidencial (Ley 21.659). Datos: eventData.organization y eventData.permit (src/lib/eventPage.ts).
import { computed } from "vue";

const props = defineProps({
  event: { type: Object, required: true },
});

const org = computed(() => props.event.organization || null);
const legalLine = computed(() => {
  const o = org.value;
  if (!o?.legal_name && !o?.legal_rut) return "";
  return [o.legal_name, o.legal_rut ? `RUT ${o.legal_rut}` : ""].filter(Boolean).join(" · ");
});
const permit = computed(() => props.event.permit || null);
const visible = computed(() => Boolean(legalLine.value || org.value?.verified || permit.value));
</script>

<template>
  <div v-if="visible" class="trust" data-testid="event-trust">
    <p v-if="legalLine" class="legal">Organiza: {{ legalLine }}</p>
    <div v-if="org?.verified || permit" class="badges">
      <span v-if="org?.verified" class="badge ok" data-testid="producer-verified" title="AI Tickets verificó la identidad de este productor">
        <span aria-hidden="true">✓</span> Productor verificado
      </span>
      <span
        v-if="permit"
        class="badge"
        :class="permit.status === 'approved' ? 'ok' : 'pending'"
        data-testid="event-permit-status"
      >
        {{ permit.status === "approved" ? "Autorización aprobada" : "Autorización en trámite" }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.trust {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.legal {
  font-size: 12px;
  line-height: 16px;
  color: var(--text-2);
  overflow-wrap: anywhere;
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-1);
}
.badge.ok {
  color: #15803d;
  background: rgba(22, 163, 74, 0.1);
}
.badge.pending {
  color: var(--warning-text);
}
</style>
