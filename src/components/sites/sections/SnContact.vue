<script setup>
import { inject } from "vue";

defineProps({ section: { type: Object, required: true } });
const sn = inject("sn");
</script>

<template>
  <section :id="section.id" class="sn-section" data-section="contact" :data-section-id="section.id" data-section-label="Contacto">
    <div class="sn-wrap">
      <div class="sn-contact">
        <h2 class="sn-h2"><span v-bind="sn.ed(`${section.id}.title`, sn.info.value.copy.contactTitle)">{{ section.data.title || sn.info.value.copy.contactTitle }}</span></h2>
        <p v-bind="sn.ed(`${section.id}.text`, sn.info.value.copy.contactText, { multiline: true })">{{ section.data.text || sn.info.value.copy.contactText }}</p>
        <a :href="`${sn.base}/contacto`" class="sn-btn">Escríbenos</a>
      </div>
    </div>
  </section>
</template>
