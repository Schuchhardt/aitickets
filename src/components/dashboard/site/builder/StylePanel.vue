<script setup>
// Estilo del sitio en el editor visual: estilo visual (plantilla de nicho), tipo de menú (barra superior, centrada o
// lateral), colores, tipografía, logo e imagen de portada general.
import { computed } from 'vue'
import { TEMPLATE_INFO, SITE_NAV_STYLES, fontStack } from '../../../../lib/siteTemplates'
import MediaField from './MediaField.vue'

const props = defineProps({
  form: { type: Object, required: true },
  templates: { type: Array, required: true },
  fonts: { type: Array, required: true },
  imagesFull: { type: Boolean, default: false },
})
const emit = defineEmits(['select-template', 'error'])

const COLOR_FIELDS = [
  { key: 'primary', label: 'Principal' },
  { key: 'accent', label: 'Acento' },
  { key: 'background', label: 'Fondo' },
  { key: 'text', label: 'Texto' },
]
const defaults = computed(() => TEMPLATE_INFO[props.form.template]?.defaults || TEMPLATE_INFO.clasico.defaults)
const colorValue = (key) => props.form.theme[key] || defaults.value[key]
function resetColors() {
  for (const f of COLOR_FIELDS) delete props.form.theme[f.key]
  delete props.form.theme.font
  delete props.form.theme.dark
}
const nav = computed(() => props.form.layout.nav || 'top')
function setNav(value) {
  props.form.layout.nav = value
}
const setThemeImage = (key, url) => {
  if (url) props.form.theme[key] = url
  else delete props.form.theme[key]
}
</script>

<template>
  <div class="space-y-6" data-testid="site-style-panel">
    <section class="space-y-2">
      <h3 class="text-xs font-bold uppercase tracking-wide text-gray-500">Menú</h3>
      <div class="grid grid-cols-1 gap-1.5">
        <button
          v-for="n in SITE_NAV_STYLES"
          :key="n.value"
          type="button"
          class="flex items-center gap-3 rounded-lg border px-3 py-2 text-left"
          :class="nav === n.value ? 'border-violet-600 bg-violet-50' : 'border-gray-200 bg-white hover:border-gray-400'"
          :aria-pressed="nav === n.value"
          @click="setNav(n.value)"
        >
          <span class="relative h-9 w-12 shrink-0 overflow-hidden rounded border border-gray-300 bg-white" aria-hidden="true">
            <span v-if="n.value === 'sidebar'" class="absolute inset-y-0 left-0 w-3 bg-gray-300"></span>
            <span v-else-if="n.value === 'centered'" class="absolute inset-x-0 top-0 flex h-3 flex-col items-center justify-center gap-px bg-gray-200"><span class="h-0.5 w-3 bg-gray-500"></span><span class="h-px w-6 bg-gray-400"></span></span>
            <span v-else class="absolute inset-x-0 top-0 flex h-2.5 items-center justify-between bg-gray-200 px-1"><span class="h-0.5 w-2 bg-gray-500"></span><span class="h-px w-4 bg-gray-400"></span></span>
          </span>
          <span>
            <span class="block text-sm font-semibold">{{ n.label }}</span>
            <span class="block text-xs text-gray-500">{{ n.description }}</span>
          </span>
        </button>
      </div>
      <label v-if="nav !== 'sidebar'" class="flex items-center gap-2 text-sm">
        <input v-model="form.layout.sticky" type="checkbox" class="h-4 w-4 accent-violet-600" />
        Menú fijo arriba al hacer scroll
      </label>
    </section>

    <section class="space-y-2">
      <h3 class="text-xs font-bold uppercase tracking-wide text-gray-500">Estilo visual</h3>
      <p class="text-xs text-gray-500">Cambia la tipografía, las formas y los colores. Mantiene tus secciones.</p>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="key in templates"
          :key="key"
          type="button"
          class="overflow-hidden rounded-lg border-2 text-left"
          :class="form.template === key ? 'border-violet-600' : 'border-gray-200 hover:border-gray-400'"
          :aria-pressed="form.template === key"
          @click="emit('select-template', key)"
        >
          <div class="flex h-12 items-center justify-between px-2" :style="{ background: TEMPLATE_INFO[key].defaults.background, color: TEMPLATE_INFO[key].defaults.text }">
            <span class="text-lg leading-none" :style="{ fontFamily: fontStack(TEMPLATE_INFO[key].defaults.font) }">Aa</span>
            <span class="flex gap-1">
              <span class="h-3.5 w-6 rounded-full" :style="{ background: TEMPLATE_INFO[key].defaults.primary }"></span>
              <span class="h-3.5 w-3.5 rounded-full" :style="{ background: TEMPLATE_INFO[key].defaults.accent }"></span>
            </span>
          </div>
          <p class="truncate px-2 py-1 text-xs font-semibold">{{ TEMPLATE_INFO[key].name }}</p>
        </button>
      </div>
    </section>

    <section class="space-y-2">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-bold uppercase tracking-wide text-gray-500">Colores y tipografía</h3>
        <button type="button" class="text-xs text-gray-500 underline" @click="resetColors">Usar los del estilo</button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <label v-for="field in COLOR_FIELDS" :key="field.key" class="block min-w-0">
          <span class="mb-1 block text-xs font-semibold text-gray-600">{{ field.label }}</span>
          <span class="flex min-w-0 items-center gap-2 rounded-lg border border-gray-300 bg-white px-2 py-1">
            <input type="color" class="h-7 w-8 shrink-0 cursor-pointer bg-transparent" :value="colorValue(field.key)" @input="form.theme[field.key] = $event.target.value" />
            <span class="truncate font-mono text-xs text-gray-600">{{ colorValue(field.key) }}</span>
          </span>
        </label>
      </div>
      <label class="block">
        <span class="mb-1 block text-xs font-semibold text-gray-600">Tipografía de títulos</span>
        <select v-model="form.theme.font" class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500">
          <option :value="undefined">La del estilo ({{ defaults.font }})</option>
          <option v-for="f in fonts" :key="f" :value="f">{{ f }}</option>
        </select>
      </label>
    </section>

    <section class="space-y-3">
      <h3 class="text-xs font-bold uppercase tracking-wide text-gray-500">Logo e imagen</h3>
      <MediaField :model-value="form.theme.logo_url || ''" kind="logo" label="Logo" aspect="3 / 1" hint="PNG con fondo transparente se ve mejor." @update:model-value="(u) => setThemeImage('logo_url', u)" @error="(m) => emit('error', m)" />
      <MediaField :model-value="form.theme.hero_image_url || ''" kind="hero" label="Imagen de portada general" aspect="16 / 9" hint="Se usa si la portada no tiene imagen propia." @update:model-value="(u) => setThemeImage('hero_image_url', u)" @error="(m) => emit('error', m)" />
    </section>
  </div>
</template>
