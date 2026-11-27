<script setup>
// Video: subido por el productor (se reproduce solo y sin sonido al aparecer, con controles) o de YouTube / Vimeo.
import { computed, inject } from "vue";
import SnHead from "./SnHead.vue";
import SnMedia from "./SnMedia.vue";
import { videoEmbedUrl } from "../../../lib/siteTemplates";

const props = defineProps({ section: { type: Object, required: true } });
const sn = inject("sn");
const embed = computed(() => (props.section.data.video ? null : videoEmbedUrl(props.section.data.url)));
</script>

<template>
  <section :id="section.id" class="sn-section" data-section="video" :data-section-id="section.id" data-section-label="Video">
    <div class="sn-wrap">
      <SnHead :section="section" lead />
      <div v-if="section.data.video" class="sn-video-file">
        <SnMedia :video="section.data.video" img-class="sn-video-el" />
      </div>
      <div v-else-if="embed" class="sn-video">
        <iframe
          :src="embed"
          :title="section.data.title || 'Video'"
          loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"
        ></iframe>
      </div>
      <div v-else-if="sn.live" class="sn-media-ph">Sube un video o pega un enlace de YouTube o Vimeo desde el panel</div>
    </div>
  </section>
</template>
