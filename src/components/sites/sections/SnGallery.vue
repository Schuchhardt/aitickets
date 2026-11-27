<script setup>
// Galería: grilla (cada foto se abre en grande en una ventana con carrusel), carrusel o logos (auspiciadores, prensa).
import { computed, inject } from "vue";
import SnHead from "./SnHead.vue";
import SnCarousel from "./SnCarousel.vue";
import { cdnImage, cdnSrcset } from "../../../lib/imageCdn.js";

const props = defineProps({ section: { type: Object, required: true } });
const sn = inject("sn");
const items = computed(() => (props.section.data.items || []).filter((i) => i.image_url));
const layout = computed(() => props.section.data.layout || "grid");
const lightboxId = computed(() => `${props.section.id}-fotos`);
</script>

<template>
  <section :id="section.id" class="sn-section" data-section="gallery" :data-section-id="section.id" data-section-label="Galería">
    <div class="sn-wrap">
      <SnHead :section="section" :title-placeholder="layout === 'logos' ? 'Auspician / Prensa' : 'Galería'" />
      <div v-if="!items.length && sn.live" class="sn-media-ph">Sube fotos desde el panel de la sección</div>

      <ul v-else-if="layout === 'logos'" class="sn-logos">
        <li v-for="(item, i) in items" :key="i">
          <img :src="cdnImage(item.image_url, 480)" :alt="item.caption || ''" loading="lazy" decoding="async" />
        </li>
      </ul>

      <SnCarousel v-else-if="layout === 'carousel'" variant="full" :label="section.data.title || 'Galería'">
        <figure v-for="(item, i) in items" :key="i" class="sn-slide">
          <img :src="cdnImage(item.image_url, 1440)" :srcset="cdnSrcset(item.image_url)" sizes="(min-width: 1152px) 1152px, 100vw" :alt="item.caption || ''" :loading="i === 0 ? 'eager' : 'lazy'" decoding="async" />
          <figcaption v-if="item.caption">{{ item.caption }}</figcaption>
        </figure>
      </SnCarousel>

      <template v-else>
        <div class="sn-gallery">
          <figure v-for="(item, i) in items" :key="i">
            <button type="button" class="sn-gallery-open" :data-sn-open="lightboxId" :data-sn-slide="i" :aria-label="`Ver foto ${i + 1} en grande`">
              <img :src="cdnImage(item.image_url, 750)" :srcset="cdnSrcset(item.image_url, [480, 750, 1080])" sizes="(min-width: 1024px) 33vw, 50vw" :alt="item.caption || ''" loading="lazy" decoding="async" />
            </button>
            <figcaption v-if="item.caption">{{ item.caption }}</figcaption>
          </figure>
        </div>
        <dialog v-if="items.length" :id="lightboxId" class="sn-dialog sn-lightbox" :aria-label="section.data.title || 'Fotos'">
          <div class="sn-dialog-box">
            <button type="button" class="sn-dialog-close" data-sn-close aria-label="Cerrar">×</button>
            <SnCarousel variant="full" :label="section.data.title || 'Fotos'">
              <figure v-for="(item, i) in items" :key="i" class="sn-slide">
                <img :src="cdnImage(item.image_url, 1920)" :alt="item.caption || ''" loading="lazy" decoding="async" />
                <figcaption v-if="item.caption">{{ item.caption }}</figcaption>
              </figure>
            </SnCarousel>
          </div>
        </dialog>
      </template>
    </div>
  </section>
</template>
