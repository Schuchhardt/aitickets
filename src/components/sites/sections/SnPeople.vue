<script setup>
// Personas (elenco, artistas, expositores, profes): grilla o carrusel de tarjetas. Si la persona tiene bio, la tarjeta
// abre una ventana con la bio completa (<dialog>, src/lib/siteInteractions.js).
import { computed, inject } from "vue";
import SnHead from "./SnHead.vue";
import SnCarousel from "./SnCarousel.vue";
import { itemIsFilled } from "../../../lib/siteTemplates";
import { cdnImage, cdnSrcset } from "../../../lib/imageCdn.js";

const props = defineProps({ section: { type: Object, required: true } });
const sn = inject("sn");
const people = computed(() =>
  (props.section.data.items || []).map((item, index) => ({ item, index })).filter(({ item }) => sn.live || itemIsFilled("people", item))
);
const carousel = computed(() => props.section.data.layout === "carousel");
const dialogId = (i) => `${props.section.id}-persona-${i}`;
const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
const SIZES = "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw";
</script>

<template>
  <section :id="section.id" class="sn-section" data-section="people" :data-section-id="section.id" data-section-label="Personas">
    <div class="sn-wrap">
      <SnHead :section="section" title-placeholder="Elenco, artistas, expositores..." />
      <component :is="carousel ? SnCarousel : 'div'" v-bind="carousel ? { label: section.data.title || 'Personas' } : { class: 'sn-people' }">
        <article v-for="{ item, index } in people" :key="index" class="sn-person">
          <button v-if="item.text || sn.live" type="button" class="sn-person-media" :data-sn-open="dialogId(index)" :aria-label="`Ver bio de ${item.name || 'esta persona'}`">
            <img v-if="item.image_url" :src="cdnImage(item.image_url, 480)" :srcset="cdnSrcset(item.image_url, [320, 480, 750])" :sizes="SIZES" :alt="item.name || ''" loading="lazy" decoding="async" />
            <span v-else class="sn-person-initials" aria-hidden="true">{{ initials(item.name) }}</span>
          </button>
          <div v-else class="sn-person-media">
            <img v-if="item.image_url" :src="cdnImage(item.image_url, 480)" :srcset="cdnSrcset(item.image_url, [320, 480, 750])" :sizes="SIZES" :alt="item.name || ''" loading="lazy" decoding="async" />
            <span v-else class="sn-person-initials" aria-hidden="true">{{ initials(item.name) }}</span>
          </div>
          <h3 class="sn-person-name" v-bind="sn.ed(`${section.id}.items.${index}.name`, 'Nombre')">{{ item.name }}</h3>
          <p v-if="item.role || sn.live" class="sn-person-role" v-bind="sn.ed(`${section.id}.items.${index}.role`, 'Rol (actriz, DJ, expositora...)')">{{ item.role }}</p>
          <button v-if="item.text || sn.live" type="button" class="sn-link" :data-sn-open="dialogId(index)">{{ item.text ? "Ver bio" : "Escribir bio" }}</button>
          <dialog :id="dialogId(index)" class="sn-dialog" :aria-label="item.name || 'Bio'">
            <div class="sn-dialog-box sn-person-dialog">
              <button type="button" class="sn-dialog-close" data-sn-close aria-label="Cerrar">×</button>
              <img v-if="item.image_url" :src="cdnImage(item.image_url, 750)" :alt="item.name || ''" class="sn-person-dialog-img" loading="lazy" decoding="async" />
              <div>
                <h3 class="sn-h3">{{ item.name }}</h3>
                <p v-if="item.role" class="sn-person-role">{{ item.role }}</p>
                <p class="sn-dialog-text" v-bind="sn.ed(`${section.id}.items.${index}.text`, 'Bio: trayectoria, obras, lo que la hace especial.', { multiline: true })">{{ item.text }}</p>
                <a v-if="item.link_url" :href="item.link_url" target="_blank" rel="noopener noreferrer nofollow" class="sn-link">Ver más</a>
              </div>
            </div>
          </dialog>
        </article>
      </component>
    </div>
  </section>
</template>
