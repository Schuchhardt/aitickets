<script setup>
// Asistente del editor visual (primera pestaña): el productor pide cambios con sus palabras y /api/sites/ai devuelve los
// cambios, que SiteBuilder aplica al borrador (se ven al tiro en la vista previa y se pueden deshacer). Puede hacer todo
// lo del editor: plantillas, estilo, colores, menú, logo y portada, secciones (agregar, quitar, ordenar, ocultar,
// textos, diseño, botones con ventana) y fotos y videos, incluidos los que el productor adjunta aquí (se suben con las
// mismas reglas y optimización que en el resto del editor). Recuerda la conversación para seguir con "más corto",
// "deshaz lo del menú"... Nada se guarda hasta "Guardar".
import { computed, nextTick, ref } from 'vue'
import { ArrowUp, Film, ImagePlus, Sparkles, Undo2, X, Crosshair } from 'lucide-vue-next'
import { SECTION_INFO, TEMPLATE_INFO } from '../../../lib/siteTemplates'
import { SITE_PRESETS } from '../../../lib/sitePresets'
import { apiRequest, uploadSiteImage, uploadSiteVideo } from './siteApi.js'

const props = defineProps({
  /** Devuelve el borrador actual { template, theme, title, tagline, about, sections, layout }. */
  getDraft: { type: Function, required: true },
  /** Sección a la que se limita el próximo pedido (o null para todo el sitio). */
  target: { type: Object, default: null },
  /** Sección seleccionada en la vista previa o la lista (se puede enfocar con un clic). */
  selected: { type: Object, default: null },
  canUndo: { type: Boolean, default: false },
  template: { type: String, default: 'clasico' },
  /** { images, videos, maxImages, maxVideos } */
  media: { type: Object, default: () => ({ images: 0, videos: 0, maxImages: 60, maxVideos: 3 }) },
})
const emit = defineEmits(['apply', 'undo', 'clear-target', 'set-target', 'error'])

const instruction = ref('')
const loading = ref(false)
const messages = ref([]) // { role: 'user' | 'assistant' | 'error', text, attachments?, warning? }
const textarea = ref(null)
const scroller = ref(null)
const attachments = ref([]) // { type, url, poster_url?, ... , preview }
const uploading = ref('')
const progress = ref(0)
const imageInput = ref(null)
const videoInput = ref(null)

const templateName = computed(() => TEMPLATE_INFO[props.template]?.name || '')
const sectionName = (s) => s?.data?.title || SECTION_INFO[s?.type]?.name || ''

const CAPABILITIES = [
  'Armar el sitio con una plantilla para tu tipo de productora',
  'Escribir y ajustar textos, preguntas, pestañas y botones',
  'Agregar, quitar, ordenar u ocultar secciones y ponerlas en el menú',
  'Cambiar estilo, colores, tipografía y tipo de menú',
  'Poner tus fotos y videos donde quieras (adjúntalos aquí)',
]

// Con la conversación empezada se muestran menos sugerencias (más espacio para el chat)
const visibleIdeas = computed(() => (messages.value.length ? ideas.value.slice(0, 2) : ideas.value))
const ideas = computed(() => {
  if (props.target) {
    const s = props.target
    const base = ['Hazlo más corto y directo', 'Escríbelo con más energía', 'Hazlo más formal']
    if (s.type === 'gallery') return ['Muéstrala como carrusel', ...base.slice(0, 1)]
    if (s.type === 'people') return ['Muéstralas en carrusel', 'Ponla en el menú como "Equipo"']
    if (s.type === 'cta') return ['Que el botón abra una ventana para cotizar', ...base.slice(0, 2)]
    if (s.type === 'hero') return ['Usa la foto de mi próximo evento', 'Escribe una frase más llamativa', 'Pon la imagen de fondo']
    return base
  }
  const presets = SITE_PRESETS.filter((p) => p.template === props.template).slice(0, 2)
  return [
    ...presets.map((p) => `Usa la plantilla "${p.name}" y adapta los textos a mi productora`),
    'Escribe los textos del sitio a partir de mis próximos eventos',
    'Agrega pestañas con el programa por día',
    'Pon el menú a la izquierda y déjalo más sobrio',
    'Agrega un botón que abra una ventana para cotizar eventos privados',
  ].slice(0, 5)
})

function focus() {
  nextTick(() => textarea.value?.focus())
}
defineExpose({ focus })

function scrollDown() {
  nextTick(() => {
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// --- Adjuntos (mismas reglas que el resto del editor) ---
const pendingImages = computed(() => attachments.value.filter((a) => a.type === 'image').length)
const pendingVideos = computed(() => attachments.value.filter((a) => a.type === 'video').length)
async function onImages(event) {
  const files = [...(event.target.files || [])]
  event.target.value = ''
  const room = Math.min(12 - pendingImages.value, props.media.maxImages - props.media.images - pendingImages.value)
  if (room <= 0) {
    emit('error', `Tu sitio llegó al máximo de ${props.media.maxImages} fotos.`)
    return
  }
  uploading.value = 'image'
  try {
    for (const file of files.slice(0, room)) {
      const url = await uploadSiteImage(file, 'gallery')
      attachments.value.push({ type: 'image', url, preview: url })
    }
    if (files.length > room) emit('error', `Solo se adjuntaron ${room} foto${room === 1 ? '' : 's'} (límite de fotos).`)
  } catch (e) {
    emit('error', e.message)
  } finally {
    uploading.value = ''
  }
}
async function onVideo(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (props.media.videos + pendingVideos.value >= props.media.maxVideos) {
    emit('error', `Tu sitio llegó al máximo de ${props.media.maxVideos} videos.`)
    return
  }
  uploading.value = 'video'
  progress.value = 0
  try {
    const video = await uploadSiteVideo(file, { onProgress: (p) => (progress.value = p) })
    attachments.value.push({ type: 'video', ...video, preview: video.poster_url || '' })
  } catch (e) {
    emit('error', e.message)
  } finally {
    uploading.value = ''
  }
}

// --- Enviar ---
async function run(text = instruction.value) {
  const value = String(text || '').trim()
  if (loading.value || uploading.value || value.length < 3) return
  const sent = attachments.value.map(({ preview, ...a }) => a)
  const shown = attachments.value.slice()
  messages.value.push({ role: 'user', text: value, attachments: shown, section: props.target ? sectionName(props.target) : '' })
  instruction.value = ''
  attachments.value = []
  loading.value = true
  scrollDown()
  const history = messages.value
    .filter((m, i, all) => m.role === 'user' && all[i + 1]?.role === 'assistant')
    .map((m) => ({ instruction: m.text, summary: messages.value[messages.value.indexOf(m) + 1].text }))
    .slice(-6)
  try {
    const data = await apiRequest('/api/sites/ai', {
      method: 'POST',
      body: { instruction: value, draft: props.getDraft(), section_id: props.target?.id || null, history, attachments: sent },
    })
    emit('apply', data.changes || {})
    messages.value.push({ role: 'assistant', text: data.summary || 'Listo, revisa los cambios en la vista previa.', warning: data.warning || '' })
  } catch (e) {
    messages.value.push({ role: 'error', text: e.message })
    // Los adjuntos no se pierden si falla
    if (!attachments.value.length) attachments.value = shown
  } finally {
    loading.value = false
    scrollDown()
    focus()
  }
}
function onKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    run()
  }
}
const lastAssistant = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i--) if (messages.value[i].role === 'assistant') return i
  return -1
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-gradient-to-b from-violet-50/60 to-white" data-testid="site-ai-panel">
    <div class="flex items-center justify-between gap-2 border-b border-violet-100 px-4 py-3">
      <h3 class="flex items-center gap-2 font-bold"><Sparkles size="18" class="text-violet-600" /> Asistente</h3>
      <button v-if="canUndo" type="button" class="inline-flex items-center gap-1 text-xs text-gray-700 underline" @click="emit('undo')">
        <Undo2 size="13" /> Deshacer
      </button>
    </div>

    <div ref="scroller" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
      <div v-if="!messages.length" class="space-y-3 rounded-xl border border-violet-100 bg-white p-4 text-sm">
        <p class="font-semibold">Pídeme cualquier cambio con tus palabras.</p>
        <p class="text-gray-600">Lo verás al tiro en la vista previa y puedes deshacerlo. Nada se publica hasta que guardes.</p>
        <ul class="space-y-1 text-gray-600">
          <li v-for="c in CAPABILITIES" :key="c" class="flex gap-2"><span class="text-violet-500">•</span> {{ c }}</li>
        </ul>
        <p v-if="templateName" class="text-xs text-gray-500">Tu estilo actual: {{ templateName }}.</p>
      </div>

      <template v-for="(m, i) in messages" :key="i">
        <div v-if="m.role === 'user'" class="ml-6 space-y-1.5 rounded-2xl rounded-br-sm bg-violet-600 px-3 py-2 text-sm text-white">
          <p v-if="m.section" class="text-[11px] font-semibold text-violet-200">Solo: {{ m.section }}</p>
          <p class="whitespace-pre-line">{{ m.text }}</p>
          <div v-if="m.attachments?.length" class="flex flex-wrap gap-1">
            <span v-for="(a, j) in m.attachments" :key="j" class="relative block h-10 w-10 overflow-hidden rounded bg-violet-800">
              <img v-if="a.preview" :src="a.preview" alt="" class="h-full w-full object-cover" />
              <Film v-if="a.type === 'video'" size="14" class="absolute bottom-0.5 right-0.5 text-white" />
            </span>
          </div>
        </div>
        <div v-else-if="m.role === 'assistant'" class="mr-6 space-y-1.5 rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-3 py-2 text-sm">
          <p class="whitespace-pre-line">{{ m.text }}</p>
          <p v-if="m.warning" class="text-xs text-amber-700">{{ m.warning }}</p>
          <button v-if="i === lastAssistant && canUndo" type="button" class="inline-flex items-center gap-1 text-xs font-medium text-violet-700 underline" @click="emit('undo')">
            <Undo2 size="12" /> Deshacer este cambio
          </button>
        </div>
        <p v-else class="mr-6 rounded-2xl rounded-bl-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{{ m.text }}</p>
      </template>
      <p v-if="loading" class="mr-6 inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm text-gray-600 shadow-sm" role="status">
        <Sparkles size="14" class="animate-pulse text-violet-600" /> Trabajando en tu sitio…
      </p>
    </div>

    <div class="space-y-2 border-t border-gray-200 bg-white px-3 py-3">
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="idea in visibleIdeas"
          :key="idea"
          type="button"
          class="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-left text-[11px] leading-snug text-gray-700 hover:border-violet-400 disabled:opacity-50"
          :disabled="loading"
          @click="run(idea)"
        >{{ idea }}</button>
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <span v-if="target" class="inline-flex items-center gap-1.5 rounded-full bg-violet-100 py-1 pl-2.5 pr-1 text-xs font-semibold text-violet-900" data-testid="ai-target">
          Solo: {{ sectionName(target) }}
          <button type="button" class="rounded-full p-0.5 hover:bg-violet-200" title="Pedir cambios para todo el sitio" @click="emit('clear-target')"><X size="12" /></button>
        </span>
        <button
          v-else-if="selected"
          type="button"
          class="inline-flex items-center gap-1 rounded-full border border-dashed border-violet-300 px-2.5 py-1 text-xs text-violet-800 hover:bg-violet-50"
          @click="emit('set-target', selected)"
        ><Crosshair size="12" /> Enfocar en "{{ sectionName(selected) }}"</button>
        <span v-for="(a, j) in attachments" :key="a.url" class="relative inline-block h-10 w-10 overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
          <img v-if="a.preview" :src="a.preview" alt="" class="h-full w-full object-cover" />
          <Film v-if="a.type === 'video'" size="14" class="absolute bottom-0.5 right-0.5 text-white drop-shadow" />
          <button type="button" class="absolute right-0 top-0 rounded-bl bg-white/90 p-0.5 text-gray-700 hover:text-red-600" title="Quitar adjunto" @click="attachments.splice(j, 1)"><X size="10" /></button>
        </span>
        <span v-if="uploading" class="text-xs text-gray-500">{{ uploading === 'video' ? `Subiendo video… ${progress}%` : 'Subiendo fotos…' }}</span>
      </div>

      <div class="flex items-end gap-1.5 rounded-xl border border-gray-300 bg-white p-1.5 focus-within:ring-2 focus-within:ring-violet-500">
        <button type="button" class="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-black disabled:opacity-40" title="Adjuntar fotos" :disabled="loading || !!uploading" @click="imageInput?.click()"><ImagePlus size="18" /></button>
        <button type="button" class="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-black disabled:opacity-40" title="Adjuntar un video" :disabled="loading || !!uploading" @click="videoInput?.click()"><Film size="18" /></button>
        <textarea
          ref="textarea"
          v-model="instruction"
          rows="2"
          maxlength="1500"
          :placeholder="target ? `¿Qué cambio en “${sectionName(target)}”?` : 'Ej: usa la plantilla de festival, pon mis fotos en una galería y el menú a la izquierda'"
          class="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none"
          aria-label="Pídele un cambio al asistente"
          :disabled="loading"
          @keydown="onKeydown"
        ></textarea>
        <button
          type="button"
          class="rounded-lg bg-violet-600 p-2 text-white hover:bg-violet-700 disabled:opacity-40"
          :disabled="loading || !!uploading || instruction.trim().length < 3"
          title="Enviar (Enter)"
          data-testid="ai-send"
          @click="run()"
        ><ArrowUp size="16" /></button>
      </div>
      <p class="text-[11px] text-gray-400">Enter para enviar · Shift+Enter para otra línea</p>
      <input ref="imageInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple class="hidden" @change="onImages" />
      <input ref="videoInput" type="file" accept="video/mp4,video/webm,video/quicktime" class="hidden" @change="onVideo" />
    </div>
  </section>
</template>
