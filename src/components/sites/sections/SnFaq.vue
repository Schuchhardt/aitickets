<script setup>
import { inject } from "vue";
import SnHead from "./SnHead.vue";

defineProps({ section: { type: Object, required: true } });
const sn = inject("sn");
</script>

<template>
  <section :id="section.id" class="sn-section" data-section="faq" :data-section-id="section.id" data-section-label="Preguntas frecuentes">
    <div class="sn-wrap">
      <SnHead :section="section" fallback-title="Preguntas frecuentes" />
      <div class="sn-faq">
        <details v-for="(item, i) in section.data.items || []" :key="i" :open="sn.live || undefined">
          <summary><span v-bind="sn.ed(`${section.id}.items.${i}.question`, 'Pregunta')">{{ item.question }}</span></summary>
          <p v-bind="sn.ed(`${section.id}.items.${i}.answer`, 'Respuesta', { multiline: true })">{{ item.answer }}</p>
        </details>
      </div>
    </div>
  </section>
</template>
