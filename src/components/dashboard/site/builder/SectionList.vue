<script setup>
// Lista de secciones del editor visual: seleccionar (abre sus ajustes y la muestra en la vista previa), ordenar,
// ocultar y agregar nuevas (catálogo de componentes: portada, eventos, pestañas, personas, galería/carrusel, video...).
import { computed, ref } from 'vue'
import { ArrowDown, ArrowUp, Eye, EyeOff, Menu, Plus, X } from 'lucide-vue-next'
import { SECTION_INFO, SECTION_TYPES } from '../../../../lib/siteTemplates'
import { SECTION_ICONS } from './sectionIcons.js'

const props = defineProps({
  form: { type: Object, required: true },
  selectedId: { type: String, default: null },
})
const emit = defineEmits(['select', 'add'])

const sections = computed(() => props.form.sections)
const adding = ref(false)
const canAdd = (type) => !SECTION_INFO[type].single || !sections.value.some((s) => s.type === type)
const sectionLabel = (s) => s.data.title || (s.type === 'hero' ? props.form.title || 'Portada' : SECTION_INFO[s.type].name)

function move(index, delta) {
  const target = index + delta
  if (target < 0 || target >= sections.value.length) return
  const [item] = sections.value.splice(index, 1)
  sections.value.splice(target, 0, item)
}
function toggleHidden(s) {
  if (s.hidden) delete s.hidden
  else s.hidden = true
}
function add(type) {
  adding.value = false
  emit('add', type)
}
</script>

<template>
  <div class="space-y-3" data-testid="site-section-list">
    <ol class="space-y-1.5">
      <li
        v-for="(s, index) in sections"
        :key="s.id"
        class="group flex items-center gap-1 rounded-lg border px-1.5 py-1.5 transition-colors"
        :class="selectedId === s.id ? 'border-violet-500 bg-violet-50' : 'border-gray-200 bg-white hover:border-gray-400'"
      >
        <div class="flex flex-col">
          <button type="button" class="p-0.5 text-gray-400 hover:text-black disabled:opacity-25" :disabled="index === 0" title="Subir" @click="move(index, -1)"><ArrowUp size="13" /></button>
          <button type="button" class="p-0.5 text-gray-400 hover:text-black disabled:opacity-25" :disabled="index === sections.length - 1" title="Bajar" @click="move(index, 1)"><ArrowDown size="13" /></button>
        </div>
        <button type="button" class="flex min-w-0 flex-1 items-center gap-2 px-1 text-left" @click="emit('select', s.id)">
          <component :is="SECTION_ICONS[s.type]" size="16" class="shrink-0 text-gray-500" />
          <span class="min-w-0">
            <span class="block text-[10px] font-bold uppercase tracking-wide text-gray-500">{{ SECTION_INFO[s.type].name }}</span>
            <span class="block truncate text-sm" :class="s.hidden ? 'text-gray-400 line-through' : 'text-gray-900'">{{ sectionLabel(s) }}</span>
          </span>
        </button>
        <Menu v-if="s.nav" size="13" class="shrink-0 text-violet-500" aria-label="En el menú" />
        <button type="button" class="p-1 text-gray-400 hover:text-black" :title="s.hidden ? 'Mostrar' : 'Ocultar'" @click="toggleHidden(s)">
          <component :is="s.hidden ? EyeOff : Eye" size="15" />
        </button>
      </li>
    </ol>

    <button
      type="button"
      class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-400 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-white"
      :aria-expanded="adding"
      @click="adding = !adding"
    >
      <component :is="adding ? X : Plus" size="16" /> {{ adding ? 'Cerrar' : 'Agregar sección' }}
    </button>
    <div v-if="adding" class="grid grid-cols-1 gap-1.5" data-testid="site-section-catalog">
      <button
        v-for="type in SECTION_TYPES.filter(canAdd)"
        :key="type"
        type="button"
        class="flex items-start gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left hover:border-violet-500"
        @click="add(type)"
      >
        <component :is="SECTION_ICONS[type]" size="16" class="mt-0.5 shrink-0 text-violet-600" />
        <span>
          <span class="block text-sm font-semibold">{{ SECTION_INFO[type].name }}</span>
          <span class="block text-xs text-gray-500">{{ SECTION_INFO[type].description }}</span>
        </span>
      </button>
    </div>
  </div>
</template>
