<script setup>
import { computed, inject } from "vue";
import SnHead from "./SnHead.vue";
import SnCarousel from "./SnCarousel.vue";

const props = defineProps({ section: { type: Object, required: true } });
const sn = inject("sn");
const carousel = computed(() => props.section.data.layout === "carousel");
</script>

<template>
  <section :id="section.id" class="sn-section sn-section--alt" data-section="testimonials" :data-section-id="section.id" data-section-label="Opiniones">
    <div class="sn-wrap">
      <SnHead :section="section" title-placeholder="Lo que dicen" />
      <component :is="carousel ? SnCarousel : 'div'" v-bind="carousel ? { label: section.data.title || 'Opiniones' } : { class: 'sn-quotes' }">
        <figure v-for="(item, i) in section.data.items || []" :key="i" class="sn-quote">
          <blockquote v-bind="sn.ed(`${section.id}.items.${i}.quote`, 'Una opinión real de tu público o de la prensa', { multiline: true })">{{ item.quote }}</blockquote>
          <figcaption v-if="item.author || sn.live">— <span v-bind="sn.ed(`${section.id}.items.${i}.author`, 'Quién lo dice')">{{ item.author }}</span></figcaption>
        </figure>
      </component>
    </div>
  </section>
</template>
