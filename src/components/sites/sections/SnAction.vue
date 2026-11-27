<script setup>
// Botón de una sección: un enlace ("#eventos", "contacto", URL externa) o, con button_action "modal", una ventana con
// más información (modal_title y modal_text). La ventana es un <dialog> que abre src/lib/siteInteractions.js.
import { computed, inject } from "vue";

const props = defineProps({
  section: { type: Object, required: true },
  defaultLabel: { type: String, default: "" },
  ghost: { type: Boolean, default: false },
});
const sn = inject("sn");

const d = computed(() => props.section.data);
const label = computed(() => d.value.button_label || props.defaultLabel);
const isModal = computed(() => d.value.button_action === "modal");
const href = computed(() => sn.hrefFor(d.value.button_url));
const external = computed(() => /^https?:\/\//.test(d.value.button_url || ""));
const dialogId = computed(() => `${props.section.id}-ventana`);
const show = computed(() => !!label.value || sn.live);
</script>

<template>
  <template v-if="show">
    <button v-if="isModal" type="button" class="sn-btn" :class="{ 'sn-btn--ghost': ghost }" :data-sn-open="dialogId" aria-haspopup="dialog">
      <span v-bind="sn.ed(`${section.id}.button_label`, 'Texto del botón')">{{ label }}</span>
    </button>
    <a
      v-else
      :href="href"
      class="sn-btn"
      :class="{ 'sn-btn--ghost': ghost }"
      :target="external ? '_blank' : undefined"
      :rel="external ? 'noopener noreferrer' : undefined"
    ><span v-bind="sn.ed(`${section.id}.button_label`, 'Texto del botón')">{{ label }}</span></a>
    <dialog v-if="isModal" :id="dialogId" class="sn-dialog" :aria-label="d.modal_title || label">
      <div class="sn-dialog-box">
        <button type="button" class="sn-dialog-close" data-sn-close aria-label="Cerrar">×</button>
        <h3 class="sn-h3 sn-dialog-title"><span v-bind="sn.ed(`${section.id}.modal_title`, 'Título de la ventana')">{{ d.modal_title }}</span></h3>
        <p class="sn-dialog-text" v-bind="sn.ed(`${section.id}.modal_text`, 'Escribe aquí la información (horarios, condiciones, cómo reservar...)', { multiline: true })">{{ d.modal_text }}</p>
        <a v-if="sn.site.contact_form_enabled" :href="`${sn.base}/contacto`" class="sn-btn sn-dialog-cta">Escríbenos</a>
      </div>
    </dialog>
  </template>
</template>
