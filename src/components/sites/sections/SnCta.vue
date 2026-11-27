<script setup>
import { inject } from "vue";
import SnAction from "./SnAction.vue";

defineProps({ section: { type: Object, required: true } });
const sn = inject("sn");
</script>

<template>
  <section :id="section.id" class="sn-section" data-section="cta" :data-section-id="section.id" data-section-label="Llamado a la acción">
    <div class="sn-wrap">
      <div class="sn-cta">
        <div>
          <h2 class="sn-h2"><span v-bind="sn.ed(`${section.id}.title`, 'Un mensaje que invite a actuar')">{{ section.data.title }}</span></h2>
          <p v-if="section.data.text || sn.live" v-bind="sn.ed(`${section.id}.text`, 'Un texto corto (opcional)', { multiline: true, optional: true })">{{ section.data.text }}</p>
        </div>
        <SnAction :section="section" default-label="Ver eventos" />
      </div>
    </div>
  </section>
</template>
