<script setup>
// Encabezado de una sección: antetítulo, título y (con lead) un texto. Editables en la vista previa en vivo.
import { inject } from "vue";

defineProps({
  section: { type: Object, required: true },
  /** Título si la sección no tiene uno (p. ej. el de la plantilla). */
  fallbackTitle: { type: String, default: "" },
  titlePlaceholder: { type: String, default: "Título de la sección" },
  /** Muestra data.text como bajada. */
  lead: { type: Boolean, default: false },
  leadPlaceholder: { type: String, default: "Un texto corto (opcional)" },
});
const sn = inject("sn");
</script>

<template>
  <div v-if="section.data.eyebrow || section.data.title || fallbackTitle || sn.live || (lead && section.data.text)" class="sn-head">
    <span v-if="section.data.eyebrow || sn.live" class="sn-eyebrow" v-bind="sn.ed(`${section.id}.eyebrow`, 'Antetítulo', { optional: true })">{{ section.data.eyebrow }}</span>
    <h2 v-if="section.data.title || fallbackTitle || sn.live" class="sn-h2">
      <span v-bind="sn.ed(`${section.id}.title`, titlePlaceholder)">{{ section.data.title || fallbackTitle }}</span>
    </h2>
    <p v-if="lead && (section.data.text || sn.live)" class="sn-lead sn-head-lead" v-bind="sn.ed(`${section.id}.text`, leadPlaceholder, { multiline: true, optional: true })">{{ section.data.text }}</p>
  </div>
</template>
