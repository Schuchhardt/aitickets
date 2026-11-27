<script setup>
import { inject } from "vue";
import SnHead from "./SnHead.vue";

defineProps({ section: { type: Object, required: true } });
const sn = inject("sn");
</script>

<template>
  <section :id="section.id" class="sn-section sn-section--alt" data-section="highlights" :data-section-id="section.id" data-section-label="Destacados">
    <div class="sn-wrap">
      <SnHead :section="section" />
      <div class="sn-grid3">
        <div v-for="(item, i) in section.data.items || []" :key="i" class="sn-hl">
          <span class="sn-hl-num">{{ String(i + 1).padStart(2, "0") }}</span>
          <h3 v-if="item.title || sn.live" class="sn-h3" v-bind="sn.ed(`${section.id}.items.${i}.title`, 'Título del punto')">{{ item.title }}</h3>
          <p v-if="item.text || sn.live" v-bind="sn.ed(`${section.id}.items.${i}.text`, 'Una o dos frases', { multiline: true })">{{ item.text }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
