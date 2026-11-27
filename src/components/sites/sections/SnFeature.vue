<script setup>
// Imagen y texto: foto o video al lado de un texto, con botón opcional (enlace o ventana con más información).
import { computed, inject } from "vue";
import SnAction from "./SnAction.vue";
import SnMedia from "./SnMedia.vue";

const props = defineProps({ section: { type: Object, required: true } });
const sn = inject("sn");
const d = computed(() => props.section.data);
const hasMedia = computed(() => !!(d.value.image_url || d.value.video));
</script>

<template>
  <section :id="section.id" class="sn-section" data-section="feature" :data-section-id="section.id" data-section-label="Imagen y texto">
    <div class="sn-wrap sn-feature" :class="{ 'sn-feature--right': d.align === 'right', 'sn-feature--solo': !hasMedia && !sn.live }">
      <div class="sn-feature-media">
        <SnMedia v-if="hasMedia" :image="d.image_url" :video="d.video" :alt="d.title || ''" img-class="sn-feature-img" />
        <div v-else-if="sn.live" class="sn-media-ph">Sube una foto o un video desde el panel</div>
      </div>
      <div class="sn-feature-body">
        <span v-if="d.eyebrow || sn.live" class="sn-eyebrow" v-bind="sn.ed(`${section.id}.eyebrow`, 'Antetítulo', { optional: true })">{{ d.eyebrow }}</span>
        <h2 v-if="d.title || sn.live" class="sn-h2"><span v-bind="sn.ed(`${section.id}.title`, 'Título del bloque')">{{ d.title }}</span></h2>
        <p v-if="d.text || sn.live" class="sn-feature-text" v-bind="sn.ed(`${section.id}.text`, 'Cuenta aquí lo que quieras destacar.', { multiline: true })">{{ d.text }}</p>
        <div v-if="d.button_label || sn.live" class="sn-hero-actions"><SnAction :section="section" /></div>
      </div>
    </div>
  </section>
</template>
