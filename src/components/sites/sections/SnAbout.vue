<script setup>
// "Sobre nosotros": usa content.about (HTML saneado). En la vista previa en vivo se muestra y edita como texto plano
// (un solo nodo de texto con párrafos por saltos de línea).
import { inject } from "vue";
import SnHead from "./SnHead.vue";

defineProps({ section: { type: Object, required: true } });
const sn = inject("sn");
</script>

<template>
  <section :id="section.id" class="sn-section" data-section="about" :data-section-id="section.id" data-section-label="Sobre nosotros">
    <div class="sn-wrap sn-about">
      <SnHead :section="section" fallback-title="Sobre nosotros" />
      <div
        v-if="sn.live"
        class="sn-prose sn-prose--plain"
        v-bind="sn.ed('site.about', 'Cuenta quiénes son, qué tipo de eventos hacen y desde cuándo. Separa los párrafos con una línea en blanco.', { multiline: true })"
      >{{ sn.state.aboutText }}</div>
      <div v-else class="sn-prose" v-html="sn.state.aboutHtml"></div>
    </div>
  </section>
</template>
