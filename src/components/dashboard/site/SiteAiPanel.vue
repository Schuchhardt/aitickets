<script setup>
// "Editar con IA" del sitio: el productor describe el cambio y /api/sites/ai devuelve los cambios, que SiteEditor aplica
// al borrador (se ven al tiro en la vista previa y se pueden deshacer). Nada se guarda hasta "Guardar cambios".
import { computed, nextTick, ref } from 'vue'
import { Sparkles, Undo2, X } from 'lucide-vue-next'
import { SECTION_INFO } from '../../../lib/siteTemplates'
import { apiRequest } from './siteApi.js'

const props = defineProps({
  /** Devuelve el borrador actual { template, theme, title, tagline, about, sections }. */
  getDraft: { type: Function, required: true },
  /** Sección a editar (o null para todo el sitio). */
  target: { type: Object, default: null },
  canUndo: { type: Boolean, default: false },
})
const emit = defineEmits(['apply', 'undo', 'clear-target'])

const instruction = ref('')
const loading = ref(false)
const summary = ref('')
const error = ref('')
const textarea = ref(null)

const SITE_IDEAS = [
  'Escribe los textos del sitio a partir de mis próximos eventos',
  'Agrega preguntas frecuentes sobre cómo comprar y recibir la entrada',
  'Hazlo más elegante y sobrio',
  'Agrega un llamado a la acción para comprar antes de que se agote',
  'Cambia los colores a tonos verdes',
]
const SECTION_IDEAS = ['Hazlo más corto y directo', 'Escríbelo con más energía', 'Hazlo más formal']
const ideas = computed(() => (props.target ? SECTION_IDEAS : SITE_IDEAS))
const targetName = computed(() => (props.target ? props.target.data?.title || SECTION_INFO[props.target.type]?.name : ''))

function focus() {
  nextTick(() => textarea.value?.focus())
}
defineExpose({ focus })

async function run() {
  if (loading.value || instruction.value.trim().length < 3) return
  loading.value = true
  error.value = ''
  summary.value = ''
  try {
    const data = await apiRequest('/api/sites/ai', {
      method: 'POST',
      body: { instruction: instruction.value.trim(), draft: props.getDraft(), section_id: props.target?.id || null },
    })
    emit('apply', data.changes || {})
    summary.value = data.summary || 'Listo, revisa los cambios en la vista previa.'
    instruction.value = ''
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white shadow-sm p-4 md:p-6 space-y-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="font-bold flex items-center gap-2"><Sparkles size="18" class="text-violet-600" /> Editar con IA</h3>
      <button v-if="canUndo" type="button" class="inline-flex items-center gap-1 text-sm text-gray-700 underline" @click="emit('undo'); summary = ''">
        <Undo2 size="14" /> Deshacer
      </button>
    </div>
    <p class="text-sm text-gray-600">Pídele cambios a tu sitio con tus palabras. Los verás en la vista previa antes de guardar.</p>

    <div v-if="target" class="inline-flex items-center gap-2 rounded-full bg-violet-100 text-violet-900 text-xs font-semibold pl-3 pr-1 py-1">
      Solo la sección: {{ targetName }}
      <button type="button" class="rounded-full p-0.5 hover:bg-violet-200" title="Editar todo el sitio" @click="emit('clear-target')"><X size="12" /></button>
    </div>

    <textarea
      ref="textarea"
      v-model="instruction"
      rows="3"
      maxlength="1500"
      :placeholder="target ? 'Ej: hazlo más corto y agrega una pregunta sobre la edad mínima' : 'Ej: escribe una portada para mi temporada de teatro y agrega preguntas frecuentes'"
      class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white outline-none focus:ring-2 focus:ring-violet-500"
      :disabled="loading"
      @keydown.meta.enter.prevent="run"
      @keydown.ctrl.enter.prevent="run"
    ></textarea>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="idea in ideas"
        :key="idea"
        type="button"
        class="text-xs rounded-full border border-gray-300 bg-white px-3 py-1 text-gray-700 hover:border-violet-400 disabled:opacity-50"
        :disabled="loading"
        @click="instruction = idea; focus()"
      >{{ idea }}</button>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm min-w-0" :class="error ? 'text-red-600' : 'text-gray-700'" role="status">
        {{ loading ? 'La IA está trabajando en tu sitio…' : error || summary }}
      </p>
      <button
        type="button"
        class="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 shrink-0"
        :disabled="loading || instruction.trim().length < 3"
        @click="run"
      >
        <Sparkles size="16" /> {{ loading ? 'Generando…' : 'Aplicar' }}
      </button>
    </div>
  </section>
</template>
