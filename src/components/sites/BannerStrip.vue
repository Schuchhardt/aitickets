<script setup>
// Banners del sitio (imágenes con enlace opcional). placement: hero (grande), top_bar (franja), inline.
import { computed } from "vue";

const props = defineProps({
  banners: { type: Array, required: false }, // SiteBanner[]
  placement: { type: String, default: "hero" },
});

const items = computed(() => (props.banners || []).filter((b) => b.placement === props.placement));
const isHero = computed(() => props.placement === "hero");
</script>

<template>
  <section v-if="items.length" :class="isHero ? 'w-full' : 'max-w-6xl mx-auto px-5 lg:px-8 my-8'" :aria-label="isHero ? 'Destacados' : 'Anuncios'">
    <div
      :class="isHero
        ? 'flex overflow-x-auto snap-x snap-mandatory'
        : 'grid gap-4 sm:grid-cols-2'"
    >
      <component
        :is="banner.link_url ? 'a' : 'div'"
        v-for="(banner, i) in items"
        :key="banner.id"
        :href="banner.link_url || undefined"
        :rel="banner.link_url ? 'noopener' : undefined"
        :class="isHero ? 'block snap-start shrink-0 w-full' : 'block rounded-xl overflow-hidden'"
      >
        <img
          :src="banner.image_url"
          :alt="banner.alt || ''"
          :class="isHero ? 'w-full h-[220px] sm:h-[340px] lg:h-[420px] object-cover' : 'w-full h-40 object-cover'"
          :loading="isHero && i === 0 ? 'eager' : 'lazy'"
          :fetchpriority="isHero && i === 0 ? 'high' : 'auto'"
          decoding="async"
        />
      </component>
    </div>
  </section>
</template>
