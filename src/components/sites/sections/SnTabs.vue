<script setup>
// Pestañas (programa por día, niveles, disciplinas, salas...). Accesibles (role=tablist) y activadas por
// src/lib/siteInteractions.js; sin JavaScript se ve la primera.
import { computed, inject } from "vue";
import SnHead from "./SnHead.vue";
import SnMedia from "./SnMedia.vue";
import { itemIsFilled } from "../../../lib/siteTemplates";

const props = defineProps({ section: { type: Object, required: true } });
const sn = inject("sn");
// En el sitio público solo las pestañas completas; en la vista previa todas (con su índice real para editarlas)
const tabs = computed(() =>
  (props.section.data.items || []).map((item, index) => ({ item, index })).filter(({ item }) => sn.live || itemIsFilled("tabs", item))
);
const tabId = (i) => `${props.section.id}-tab-${i}`;
const panelId = (i) => `${props.section.id}-panel-${i}`;
</script>

<template>
  <section :id="section.id" class="sn-section" data-section="tabs" :data-section-id="section.id" data-section-label="Pestañas">
    <div class="sn-wrap">
      <SnHead :section="section" />
      <div class="sn-tabs" data-sn-tabs>
        <div class="sn-tablist" role="tablist" :aria-label="section.data.title || 'Pestañas'">
          <button
            v-for="({ item, index }, pos) in tabs"
            :id="tabId(index)"
            :key="index"
            type="button"
            role="tab"
            class="sn-tab"
            :aria-selected="pos === 0 ? 'true' : 'false'"
            :aria-controls="panelId(index)"
            :tabindex="pos === 0 ? 0 : -1"
          ><span v-bind="sn.ed(`${section.id}.items.${index}.title`, `Pestaña ${pos + 1}`)">{{ item.title }}</span></button>
        </div>
        <div
          v-for="({ item, index }, pos) in tabs"
          :id="panelId(index)"
          :key="index"
          role="tabpanel"
          class="sn-tabpanel"
          :class="{ 'has-media': !!item.image_url }"
          :aria-labelledby="tabId(index)"
          tabindex="0"
          :hidden="pos !== 0"
        >
          <p class="sn-tabpanel-text" v-bind="sn.ed(`${section.id}.items.${index}.text`, 'Contenido de la pestaña: horarios, actividades, detalles...', { multiline: true })">{{ item.text }}</p>
          <SnMedia v-if="item.image_url" :image="item.image_url" :alt="item.title || ''" img-class="sn-tabpanel-img" />
        </div>
      </div>
    </div>
  </section>
</template>
