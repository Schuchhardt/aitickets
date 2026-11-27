<script setup>
// Imagen (optimizada por Netlify Image CDN con srcset) o video subido de una sección. Los videos se reproducen solos y
// sin sonido mientras están en pantalla (src/lib/siteInteractions.js), con controles para activar el sonido.
import { computed } from "vue";
import { cdnImage, cdnSrcset } from "../../../lib/imageCdn.js";

const props = defineProps({
  image: { type: String, default: "" },
  video: { type: Object, default: null },
  alt: { type: String, default: "" },
  sizes: { type: String, default: "(min-width: 1024px) 50vw, 100vw" },
  imgClass: { type: String, default: "" },
  /** Video de fondo: sin controles, en loop. */
  background: { type: Boolean, default: false },
  eager: { type: Boolean, default: false },
});

const poster = computed(() => props.video?.poster_url || props.image || undefined);
const ratio = computed(() => (props.video?.width && props.video?.height ? `${props.video.width} / ${props.video.height}` : undefined));
</script>

<template>
  <video
    v-if="video"
    :class="imgClass"
    :src="video.url"
    :poster="poster"
    :style="background ? undefined : { aspectRatio: ratio }"
    :controls="!background"
    :autoplay="background || undefined"
    muted
    loop
    playsinline
    :preload="eager ? 'auto' : 'metadata'"
    data-sn-autoplay
  ></video>
  <img
    v-else-if="image"
    :class="imgClass"
    :src="cdnImage(image, 1080)"
    :srcset="cdnSrcset(image)"
    :sizes="sizes"
    :alt="alt"
    :loading="eager ? 'eager' : 'lazy'"
    :fetchpriority="eager ? 'high' : undefined"
    decoding="async"
  />
</template>
