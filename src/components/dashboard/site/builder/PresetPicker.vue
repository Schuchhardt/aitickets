<script setup>
// Plantillas completas (src/lib/sitePresets.ts): cada una trae copy, diseño de secciones, tipo de menú y paleta, según el
// tipo de página (compañía, sala, festival...). Primero las del estilo actual del sitio. Aplicar reemplaza secciones,
// estilo y menú (se puede deshacer); se mantienen logo, imagen de portada y "Sobre nosotros".
import { computed, ref } from 'vue'
import { Check } from 'lucide-vue-next'
import { presetGroups } from '../../../../lib/sitePresets'
import { SECTION_INFO, SITE_NAV_STYLES, TEMPLATE_INFO, fontStack } from '../../../../lib/siteTemplates'

const props = defineProps({
  templates: { type: Array, required: true },
  current: { type: String, default: '' },
  currentTemplate: { type: String, default: '' },
})
const emit = defineEmits(['apply'])

const groups = computed(() => {
  const all = presetGroups(props.templates)
  return [...all.filter((g) => g.template === props.currentTemplate), ...all.filter((g) => g.template !== props.currentTemplate)]
})
const showAll = ref(false)
const visibleGroups = computed(() => (showAll.value ? groups.value : groups.value.slice(0, 1)))

const palette = (p) => ({ ...TEMPLATE_INFO[p.template].defaults, ...(p.theme || {}) })
const navName = (p) => SITE_NAV_STYLES.find((n) => n.value === (p.layout.nav || 'top'))?.label || 'Barra superior'
const COMPONENT_LABELS = { tabs: 'Pestañas', people: 'Personas', gallery: 'Galería', video: 'Video', feature: 'Imagen y texto', testimonials: 'Opiniones', faq: 'Preguntas' }
function chips(p) {
  const out = new Set()
  for (const s of p.sections) {
    if (s.type === 'gallery' && s.data.layout === 'carousel') out.add('Carrusel')
    else if (s.type === 'gallery' && s.data.layout === 'logos') out.add('Logos')
    else if (s.type === 'people' && s.data.layout === 'carousel') out.add('Carrusel')
    else if (COMPONENT_LABELS[s.type]) out.add(COMPONENT_LABELS[s.type])
    if (s.data.button_action === 'modal' || s.type === 'people') out.add('Ventanas')
  }
  return [...out].slice(0, 5)
}
const sectionNames = (p) => p.sections.map((s) => s.data.nav_label || s.data.title || SECTION_INFO[s.type].name).join(' · ')
</script>

<template>
  <div class="space-y-5" data-testid="site-preset-picker">
    <p class="text-sm text-gray-600">Cada plantilla combina textos, secciones, menú y colores pensados para un tipo de página. Después edita lo que quieras o pídeselo a la IA.</p>
    <div v-for="group in visibleGroups" :key="group.template" class="space-y-2">
      <p class="text-xs font-bold uppercase tracking-wide text-gray-500">{{ group.name }}</p>
      <article
        v-for="p in group.presets"
        :key="p.key"
        class="overflow-hidden rounded-xl border bg-white"
        :class="current === p.key ? 'border-violet-600 ring-1 ring-violet-600' : 'border-gray-200'"
      >
        <div class="flex h-16 items-stretch" :style="{ background: palette(p).background, color: palette(p).text }">
          <div class="flex flex-1 flex-col justify-center px-3">
            <span class="truncate text-lg leading-tight" :style="{ fontFamily: fontStack(palette(p).font) }">{{ p.name }}</span>
            <span class="text-[10px] uppercase tracking-widest opacity-70">{{ navName(p) }}</span>
          </div>
          <div class="flex items-center gap-1 pr-3">
            <span class="h-6 w-6 rounded-full border border-black/10" :style="{ background: palette(p).primary }"></span>
            <span class="h-6 w-6 rounded-full border border-black/10" :style="{ background: palette(p).accent }"></span>
          </div>
        </div>
        <div class="space-y-2 p-3">
          <p class="text-xs text-gray-600">{{ p.description }}</p>
          <div class="flex flex-wrap gap-1">
            <span v-for="c in chips(p)" :key="c" class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-700">{{ c }}</span>
          </div>
          <p class="line-clamp-2 text-[11px] text-gray-500">{{ sectionNames(p) }}</p>
          <button
            type="button"
            class="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold"
            :class="current === p.key ? 'bg-violet-100 text-violet-800' : 'bg-gray-900 text-white hover:bg-black'"
            :data-preset="p.key"
            @click="emit('apply', p.key)"
          >
            <Check v-if="current === p.key" size="14" /> {{ current === p.key ? 'Plantilla actual (volver a aplicar)' : 'Usar esta plantilla' }}
          </button>
        </div>
      </article>
    </div>
    <button type="button" class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50" @click="showAll = !showAll">
      {{ showAll ? 'Ver solo las de mi estilo' : 'Ver plantillas de otros nichos' }}
    </button>
  </div>
</template>
