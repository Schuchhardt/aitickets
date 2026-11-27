<script setup>
// Portada: título, frase, botón y la imagen o el video de fondo. Diseños (data.layout o el de la plantilla): split
// (texto al lado de la imagen), overlay (imagen o video de fondo) y centered (centrada sobre la imagen).
import { computed, inject } from "vue";
import SnAction from "./SnAction.vue";
import SnMedia from "./SnMedia.vue";

const props = defineProps({ section: { type: Object, required: true } });
const sn = inject("sn");

const d = computed(() => props.section.data);
const layout = computed(() => d.value.layout || sn.info.value.hero);
const heroBanner = computed(() => sn.banners.value.find((b) => b.placement === "hero") || null);
const image = computed(() => d.value.image_url || sn.state.theme.hero_image_url || heroBanner.value?.image_url || sn.events.value[0]?.image_url || "");
const video = computed(() => d.value.video || null);
const hasMedia = computed(() => !!(video.value || image.value));
const subtitle = computed(() => d.value.subtitle || sn.state.tagline);
</script>

<template>
  <section
    :id="section.id"
    class="sn-hero"
    :class="[`sn-hero--${layout}`, { 'no-media': !hasMedia }]"
    data-section="hero"
    :data-section-id="section.id"
    data-section-label="Portada"
  >
    <template v-if="layout === 'split'">
      <div class="sn-wrap sn-hero-grid" :class="{ 'has-media': hasMedia }">
        <div>
          <span v-if="d.eyebrow || sn.live" class="sn-eyebrow" v-bind="sn.ed(`${section.id}.eyebrow`, 'Antetítulo', { optional: true })">{{ d.eyebrow }}</span>
          <h1 class="sn-h1"><span v-bind="sn.ed(`${section.id}.title`, 'Título de la portada')">{{ d.title || sn.state.name }}</span></h1>
          <p v-if="subtitle || sn.live" class="sn-lead sn-hero-sub" v-bind="sn.ed(`${section.id}.subtitle`, 'Una frase que cuente qué hacen', { multiline: true })">{{ subtitle }}</p>
          <div class="sn-hero-actions">
            <SnAction :section="section" default-label="Ver eventos" />
            <a v-if="heroBanner?.link_url" :href="heroBanner.link_url" rel="noopener" class="sn-btn sn-btn--ghost">Destacado</a>
          </div>
        </div>
        <SnMedia v-if="hasMedia" :image="image" :video="video" :alt="heroBanner?.alt || sn.state.name" img-class="sn-hero-img" background eager />
      </div>
    </template>
    <template v-else>
      <SnMedia v-if="hasMedia" :image="image" :video="video" :alt="heroBanner?.alt || sn.state.name" img-class="sn-hero-bg" sizes="100vw" background eager />
      <div class="sn-hero-shade"></div>
      <div class="sn-wrap sn-hero-body">
        <span v-if="d.eyebrow || sn.live" class="sn-eyebrow" v-bind="sn.ed(`${section.id}.eyebrow`, 'Antetítulo', { optional: true })">{{ d.eyebrow }}</span>
        <h1 class="sn-h1"><span v-bind="sn.ed(`${section.id}.title`, 'Título de la portada')">{{ d.title || sn.state.name }}</span></h1>
        <p v-if="subtitle || sn.live" class="sn-lead sn-hero-sub" v-bind="sn.ed(`${section.id}.subtitle`, 'Una frase que cuente qué hacen', { multiline: true })">{{ subtitle }}</p>
        <div class="sn-hero-actions">
          <SnAction :section="section" default-label="Ver eventos" />
          <a v-if="heroBanner?.link_url" :href="heroBanner.link_url" rel="noopener" class="sn-btn sn-btn--ghost">Destacado</a>
        </div>
      </div>
    </template>
  </section>
</template>
