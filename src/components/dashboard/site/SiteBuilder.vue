<script setup>
// Editor visual del sitio en pantalla completa (/dashboard/sitio/editor).
//
//   [ Secciones | Plantillas | Estilo | IA ]   [ vista previa en vivo (computador / tablet / celular) ]   [ ajustes ]
//
// - La vista previa es /o/<slug>?editor=1 en un iframe (SitePage.vue en modo live): recibe el borrador por postMessage
//   y se redibuja al instante. Ahí mismo se editan los textos (clic en un texto) y se selecciona una sección (clic en ella),
//   que abre sus ajustes a la derecha (fotos, videos, ítems, diseño, botón, menú).
// - Plantillas: combinaciones de copy + layout + tema por tipo de página (src/lib/sitePresets.ts).
// - Deshacer / rehacer de todo (Ctrl+Z / Ctrl+Shift+Z), con instantáneas del borrador.
// - Nada se publica hasta "Guardar" (PUT /api/sites); al salir con cambios sin guardar avisa.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ArrowLeft,
  ExternalLink,
  LayoutTemplate,
  ListTree,
  Monitor,
  Palette,
  Redo2,
  Smartphone,
  Sparkles,
  Tablet,
  Undo2,
  X,
} from 'lucide-vue-next'
import { apiRequest, htmlToPlain, plainToHtml } from './siteApi.js'
import {
  MAX_SITE_IMAGES,
  MAX_SITE_VIDEOS,
  SECTION_INFO,
  TEMPLATE_INFO,
  applyTextEdit,
  blankSection,
  countSectionMedia,
  defaultSections,
  newSectionId,
  sanitizeLayout,
  sanitizeSections,
} from '../../../lib/siteTemplates'
import { PRESET_BY_KEY, applyPreset } from '../../../lib/sitePresets'
import SectionList from './builder/SectionList.vue'
import SectionInspector from './builder/SectionInspector.vue'
import PresetPicker from './builder/PresetPicker.vue'
import StylePanel from './builder/StylePanel.vue'
import SiteAiPanel from './SiteAiPanel.vue'

const props = defineProps({ initialJson: { type: String, required: true } })
const initial = JSON.parse(props.initialJson)
const site = ref(initial.site)
const org = initial.org || {}
const templates = initial.templates || ['clasico', 'nocturno']
const fonts = initial.fonts || ['Unbounded', 'Prompt', 'Inter']

function formFromSite(s) {
  const content = s.content || {}
  const template = templates.includes(s.template) ? s.template : 'clasico'
  return {
    template,
    theme: { ...(s.theme || {}) },
    title: content.title || '',
    tagline: content.tagline || '',
    about: htmlToPlain(content.about || ''),
    // Sin secciones guardadas: las sugeridas de la plantilla (el sitio sigue con la plantilla original hasta guardar)
    sections: Array.isArray(content.sections) ? sanitizeSections(content.sections, { keepEmpty: true }) : defaultSections(template),
    layout: { nav: 'top', sticky: false, ...sanitizeLayout(content.layout) },
    preset: typeof content.preset === 'string' ? content.preset : '',
  }
}

const form = reactive(formFromSite(site.value))
const savedSnapshot = ref(JSON.stringify(form))
const dirty = computed(() => JSON.stringify(form) !== savedSnapshot.value)
const media = computed(() => ({ ...countSectionMedia(form.sections), maxImages: MAX_SITE_IMAGES, maxVideos: MAX_SITE_VIDEOS }))

// --- Mensajes ---
const message = ref('')
const isError = ref(false)
let messageTimer = null
function flash(text, error = false) {
  message.value = text
  isError.value = error
  clearTimeout(messageTimer)
  messageTimer = setTimeout(() => { if (message.value === text) message.value = '' }, error ? 7000 : 3500)
}

// --- Deshacer / rehacer (instantáneas del borrador; los cambios seguidos se agrupan) ---
const history = ref([])
const future = ref([])
let lastSnapshot = JSON.stringify(form)
let historyTimer = null
let restoring = false
function commitHistory() {
  clearTimeout(historyTimer)
  const now = JSON.stringify(form)
  if (now === lastSnapshot) return
  history.value.push(lastSnapshot)
  if (history.value.length > 80) history.value.shift()
  future.value = []
  lastSnapshot = now
}
function restore(json) {
  restoring = true
  const data = JSON.parse(json)
  for (const key of Object.keys(data)) form[key] = data[key]
  lastSnapshot = json
  if (selectedId.value && !form.sections.some((s) => s.id === selectedId.value)) selectedId.value = null
  nextTick(() => { restoring = false })
}
function undo() {
  commitHistory()
  const previous = history.value.pop()
  if (!previous) return
  future.value.push(JSON.stringify(form))
  restore(previous)
}
function redo() {
  const next = future.value.pop()
  if (!next) return
  history.value.push(JSON.stringify(form))
  restore(next)
}
watch(form, () => {
  if (restoring) return
  clearTimeout(historyTimer)
  historyTimer = setTimeout(commitHistory, 600)
}, { deep: true })
/** Cambio de un solo paso (plantilla, IA, agregar o quitar sección): queda como su propio "deshacer". */
function step(change) {
  commitHistory()
  change()
  commitHistory()
}

// --- Paneles ---
// El asistente va primero y es la pestaña por defecto: puede hacer todo lo que hacen las demás
const TABS = [
  { key: 'ai', label: 'Asistente', icon: Sparkles },
  { key: 'sections', label: 'Secciones', icon: ListTree },
  { key: 'presets', label: 'Plantillas', icon: LayoutTemplate },
  { key: 'style', label: 'Estilo', icon: Palette },
]
const tab = ref('ai')
const selectedId = ref(null)
const selected = computed(() => form.sections.find((s) => s.id === selectedId.value) || null)
const mobileView = ref('preview') // celular: 'edit' | 'preview'

function select(id, { scroll = true } = {}) {
  selectedId.value = id
  if (id) mobileView.value = 'edit'
  postToPreview({ type: 'aitickets:site-select', sectionId: id, scroll })
}
function addSection(type) {
  const section = blankSection(type, form.template)
  step(() => {
    const at = selected.value ? form.sections.indexOf(selected.value) + 1 : form.sections.findIndex((s) => s.type === 'contact')
    if (at > 0) form.sections.splice(at, 0, section)
    else form.sections.push(section)
  })
  nextTick(() => select(section.id))
}
function removeSection(section) {
  const name = section.data.title || SECTION_INFO[section.type].name
  if (!window.confirm(`¿Quitar la sección "${name}"? Puedes deshacerlo.`)) return
  step(() => {
    const i = form.sections.indexOf(section)
    if (i >= 0) form.sections.splice(i, 1)
  })
  selectedId.value = null
}
function duplicateSection(section) {
  const copy = { ...JSON.parse(JSON.stringify(section)), id: newSectionId(section.type) }
  delete copy.nav
  step(() => form.sections.splice(form.sections.indexOf(section) + 1, 0, copy))
  nextTick(() => select(copy.id))
}

// --- Plantillas y estilo ---
function clearStyleOverrides() {
  for (const key of ['primary', 'accent', 'background', 'text', 'font', 'dark']) delete form.theme[key]
}
function applyPresetKey(key) {
  const preset = PRESET_BY_KEY[key]
  if (!preset) return
  const ok = window.confirm(
    `¿Usar la plantilla "${preset.name}"?\n\nReemplaza las secciones, el estilo, los colores y el menú. Se mantienen tu logo, tu imagen de portada y el texto de "Sobre nosotros". Puedes deshacerlo.`
  )
  if (!ok) return
  const applied = applyPreset(key, form.theme)
  step(() => {
    form.template = applied.template
    form.theme = applied.theme
    form.layout = { nav: 'top', sticky: false, ...applied.layout }
    form.sections = applied.sections
    form.preset = applied.preset
  })
  selectedId.value = null
  tab.value = 'sections'
  flash(`Plantilla "${preset.name}" aplicada. Haz clic en los textos de la vista previa para cambiarlos.`)
}
function selectTemplate(key) {
  if (key === form.template) return
  step(() => {
    clearStyleOverrides()
    form.template = key
  })
}

// --- IA ---
const aiPanel = ref(null)
const aiTarget = ref(null)
const draft = () => ({
  template: form.template,
  theme: form.theme,
  title: form.title,
  tagline: form.tagline,
  about: form.about,
  sections: form.sections,
  layout: form.layout,
})
function applyAi(changes) {
  step(() => {
    if (changes.template && templates.includes(changes.template)) {
      form.template = changes.template
      if (!changes.theme) clearStyleOverrides()
    }
    if (changes.theme) form.theme = { ...changes.theme }
    if (changes.layout) form.layout = { nav: 'top', sticky: false, ...changes.layout }
    if (typeof changes.preset === 'string') form.preset = changes.preset
    if (typeof changes.title === 'string') form.title = changes.title
    if (typeof changes.tagline === 'string') form.tagline = changes.tagline
    if (typeof changes.about === 'string') form.about = changes.about
    if (Array.isArray(changes.sections)) form.sections = changes.sections
  })
  if (aiTarget.value) aiTarget.value = form.sections.find((s) => s.id === aiTarget.value.id) || null
  if (selectedId.value && !form.sections.some((s) => s.id === selectedId.value)) selectedId.value = null
}
function editWithAi(section) {
  aiTarget.value = section
  tab.value = 'ai'
  mobileView.value = 'edit'
  nextTick(() => aiPanel.value?.focus())
}

// --- Guardar ---
const saving = ref(false)
async function save() {
  if (saving.value) return
  commitHistory()
  saving.value = true
  try {
    const data = await apiRequest('/api/sites', {
      method: 'PUT',
      body: {
        template: form.template,
        theme: form.theme,
        content: {
          title: form.title,
          tagline: form.tagline,
          about: plainToHtml(form.about),
          sections: form.sections,
          layout: form.layout,
          preset: form.preset || null,
        },
      },
    })
    if (data.site) site.value = data.site
    savedSnapshot.value = JSON.stringify(form)
    flash(site.value.published && org.emailVerified ? 'Cambios guardados. Ya se ven en tu sitio.' : 'Cambios guardados.')
  } catch (e) {
    flash(e.message, true)
  } finally {
    saving.value = false
  }
}

// --- Vista previa ---
const DEVICES = [
  { key: 'desktop', label: 'Computador', icon: Monitor, width: 1280 },
  { key: 'tablet', label: 'Tablet', icon: Tablet, width: 820 },
  { key: 'mobile', label: 'Celular', icon: Smartphone, width: 390 },
]
const device = ref('desktop')
const deviceWidth = computed(() => DEVICES.find((d) => d.key === device.value).width)
const previewBox = ref(null)
const previewFrame = ref(null)
const boxSize = reactive({ width: 1000, height: 700 })
const scale = computed(() => Math.min(1, (boxSize.width - 32) / deviceWidth.value))
const previewKey = ref(Date.now())
// previewPath solo lo cambia el fixture de los e2e (tests/e2e/fixtures/site-builder-fixture-page.astro)
const previewPath = initial.previewPath || null
const previewUrl = computed(() => {
  const base = previewPath || `/o/${site.value.slug}`
  return `${base}${base.includes('?') ? '&' : '?'}editor=1&v=${previewKey.value}`
})
let resizeObserver = null

function postToPreview(msg) {
  previewFrame.value?.contentWindow?.postMessage(JSON.parse(JSON.stringify(msg)), window.location.origin)
}
function postDraft() {
  postToPreview({ type: 'aitickets:site-draft', draft: draft() })
}
let draftTimer = null
watch(form, () => {
  clearTimeout(draftTimer)
  draftTimer = setTimeout(postDraft, 120)
}, { deep: true })

function onPreviewMessage(event) {
  if (event.origin !== window.location.origin || event.source !== previewFrame.value?.contentWindow) return
  const data = event.data || {}
  if (data.type === 'aitickets:site-preview-ready') {
    postDraft()
    if (selectedId.value) postToPreview({ type: 'aitickets:site-select', sectionId: selectedId.value })
  } else if (data.type === 'aitickets:site-edit') {
    commitHistory()
    if (applyTextEdit(form, data.target, data.value)) commitHistory()
  } else if (data.type === 'aitickets:site-shortcut') {
    if (data.action === 'undo') undo()
    else if (data.action === 'redo') redo()
    else if (data.action === 'save' && dirty.value) setTimeout(save, 50)
  } else if (data.type === 'aitickets:site-select') {
    selectedId.value = data.sectionId || null
    // En Plantillas o Estilo, seleccionar una sección lleva a sus ajustes; en el asistente se puede "enfocar" en ella
    if (data.sectionId && tab.value !== 'sections' && tab.value !== 'ai') tab.value = 'sections'
  }
}

function onKeydown(event) {
  const mod = event.metaKey || event.ctrlKey
  if (!mod) return
  const el = document.activeElement
  const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  if (event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (dirty.value) save()
    return
  }
  if (typing) return
  if (event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
  } else if (event.key.toLowerCase() === 'y') {
    event.preventDefault()
    redo()
  }
}
function onBeforeUnload(event) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => {
  window.addEventListener('message', onPreviewMessage)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
  document.documentElement.style.overflow = 'hidden'
  if (previewBox.value && 'ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(([entry]) => {
      boxSize.width = entry.contentRect.width
      boxSize.height = entry.contentRect.height
    })
    resizeObserver.observe(previewBox.value)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onPreviewMessage)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  document.documentElement.style.overflow = ''
  resizeObserver?.disconnect()
  clearTimeout(draftTimer)
  clearTimeout(historyTimer)
})

function leave() {
  if (dirty.value && !window.confirm('Tienes cambios sin guardar. ¿Salir igual?')) return
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.location.href = '/dashboard/sitio'
}
const presetName = computed(() => PRESET_BY_KEY[form.preset]?.name || TEMPLATE_INFO[form.template]?.name || '')
const visibleToPublic = computed(() => site.value.published && org.emailVerified)
</script>

<template>
  <div class="fixed inset-0 z-[70] flex flex-col bg-gray-100 text-gray-900" data-testid="site-builder">
    <!-- Barra superior -->
    <header class="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2 sm:px-4">
      <button type="button" class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100" @click="leave">
        <ArrowLeft size="16" /> <span class="hidden sm:inline">Mi sitio</span>
      </button>
      <div class="hidden min-w-0 md:block">
        <p class="truncate text-sm font-bold leading-tight">Editor del sitio</p>
        <p class="truncate text-xs text-gray-500">{{ presetName }} · <span :class="visibleToPublic ? 'text-green-700' : ''">{{ visibleToPublic ? 'Publicado' : 'No visible al público' }}</span></p>
      </div>

      <div class="mx-auto hidden items-center gap-1 rounded-lg bg-gray-100 p-1 md:flex" role="group" aria-label="Tamaño de la vista previa">
        <button
          v-for="d in DEVICES"
          :key="d.key"
          type="button"
          class="rounded-md p-1.5"
          :class="device === d.key ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-black'"
          :title="d.label"
          :aria-pressed="device === d.key"
          @click="device = d.key"
        ><component :is="d.icon" size="16" /></button>
      </div>

      <div class="ml-auto flex items-center gap-1 sm:gap-2">
        <span class="hidden text-xs text-gray-500 lg:inline" :title="`Fotos y videos subidos en las secciones`">{{ media.images }}/{{ media.maxImages }} fotos · {{ media.videos }}/{{ media.maxVideos }} videos</span>
        <button type="button" class="rounded-lg p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-30" :disabled="!history.length && !dirty" title="Deshacer (Ctrl+Z)" @click="undo"><Undo2 size="16" /></button>
        <button type="button" class="rounded-lg p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-30" :disabled="!future.length" title="Rehacer (Ctrl+Shift+Z)" @click="redo"><Redo2 size="16" /></button>
        <a :href="`/o/${site.slug}`" target="_blank" rel="noopener" class="hidden rounded-lg p-2 text-gray-600 hover:bg-gray-100 sm:inline-flex" title="Ver el sitio guardado"><ExternalLink size="16" /></a>
        <button
          type="button"
          class="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40 sm:px-4"
          :disabled="saving || !dirty"
          data-testid="site-builder-save"
          @click="save"
        >{{ saving ? 'Guardando…' : dirty ? 'Guardar' : 'Guardado' }}</button>
      </div>
    </header>

    <div v-if="message" class="absolute left-1/2 top-16 z-10 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm shadow-lg" :class="isError ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'" role="status">
      <div class="flex items-start gap-3"><span class="flex-1">{{ message }}</span><button type="button" class="opacity-70 hover:opacity-100" aria-label="Cerrar" @click="message = ''"><X size="14" /></button></div>
    </div>

    <!-- Celular: alternar entre editar y ver -->
    <div class="flex shrink-0 border-b border-gray-200 bg-white md:hidden">
      <button type="button" class="flex-1 py-2 text-sm font-semibold" :class="mobileView === 'edit' ? 'border-b-2 border-violet-600 text-violet-700' : 'text-gray-500'" @click="mobileView = 'edit'">Editar</button>
      <button type="button" class="flex-1 py-2 text-sm font-semibold" :class="mobileView === 'preview' ? 'border-b-2 border-violet-600 text-violet-700' : 'text-gray-500'" @click="mobileView = 'preview'">Vista previa</button>
    </div>

    <div class="flex min-h-0 flex-1">
      <!-- Panel izquierdo -->
      <aside
        class="min-h-0 w-full shrink-0 flex-col border-r border-gray-200 bg-gray-50 md:flex md:w-[300px] lg:w-[320px]"
        :class="mobileView === 'edit' ? 'flex' : 'hidden'"
      >
        <nav class="grid shrink-0 grid-cols-4 border-b border-gray-200 bg-white" aria-label="Paneles del editor">
          <button
            v-for="t in TABS"
            :key="t.key"
            type="button"
            class="flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold"
            :class="tab === t.key ? 'text-violet-700 shadow-[inset_0_-2px_0_#7c3aed]' : 'text-gray-500 hover:text-gray-900'"
            :aria-pressed="tab === t.key"
            :data-testid="`builder-tab-${t.key}`"
            @click="tab = t.key"
          ><component :is="t.icon" size="16" /> {{ t.label }}</button>
        </nav>
        <!-- En pantallas medianas los ajustes de la sección van aquí (en grandes, a la derecha) -->
        <div v-if="selected && tab === 'sections'" class="min-h-0 flex-1 bg-white xl:hidden">
          <SectionInspector
            :section="selected"
            :form="form"
            :media="media"
            :contact-form-enabled="site.contact_form_enabled"
            @ai="editWithAi"
            @remove="removeSection"
            @duplicate="duplicateSection"
            @close="select(null, { scroll: false })"
            @error="(m) => flash(m, true)"
            @open-dialog="(id) => postToPreview({ type: 'aitickets:site-open-dialog', id })"
          />
        </div>
        <div v-if="tab === 'ai'" class="min-h-0 flex-1">
          <SiteAiPanel
            ref="aiPanel"
            :get-draft="draft"
            :target="aiTarget"
            :selected="selected"
            :can-undo="history.length > 0"
            :template="form.template"
            :media="media"
            @apply="applyAi"
            @undo="undo"
            @clear-target="aiTarget = null"
            @set-target="(s) => (aiTarget = s)"
            @error="(m) => flash(m, true)"
          />
        </div>
        <div v-else class="min-h-0 flex-1 overflow-y-auto p-4" :class="{ 'max-xl:hidden': selected && tab === 'sections' }">
          <SectionList v-if="tab === 'sections'" :form="form" :selected-id="selectedId" @select="(id) => select(id)" @add="addSection" />
          <PresetPicker v-else-if="tab === 'presets'" :templates="templates" :current="form.preset" :current-template="form.template" @apply="applyPresetKey" />
          <StylePanel v-else-if="tab === 'style'" :form="form" :templates="templates" :fonts="fonts" :images-full="media.images >= media.maxImages" @select-template="selectTemplate" @error="(m) => flash(m, true)" />
        </div>
      </aside>

      <!-- Vista previa -->
      <main ref="previewBox" class="relative min-h-0 min-w-0 flex-1 overflow-hidden md:flex" :class="mobileView === 'preview' ? 'flex' : 'hidden'">
        <div class="absolute inset-0 flex justify-center overflow-hidden pt-4">
          <div
            class="shrink-0 origin-top overflow-hidden rounded-t-xl bg-white shadow-xl ring-1 ring-black/5"
            :style="{ width: `${deviceWidth}px`, height: `${(boxSize.height - 16) / scale}px`, transform: `scale(${scale})` }"
          >
            <iframe
              ref="previewFrame"
              :key="previewKey"
              :src="previewUrl"
              title="Vista previa del sitio (haz clic en un texto para editarlo)"
              class="h-full w-full"
              data-testid="site-builder-preview"
              @load="postDraft"
            ></iframe>
          </div>
        </div>
      </main>

      <!-- Ajustes de la sección (pantallas grandes) -->
      <aside class="hidden w-[360px] shrink-0 border-l border-gray-200 bg-white xl:block">
        <SectionInspector
          v-if="selected"
          :section="selected"
          :form="form"
          :media="media"
          :contact-form-enabled="site.contact_form_enabled"
          @ai="editWithAi"
          @remove="removeSection"
          @duplicate="duplicateSection"
          @close="select(null, { scroll: false })"
          @error="(m) => flash(m, true)"
          @open-dialog="(id) => postToPreview({ type: 'aitickets:site-open-dialog', id })"
        />
        <div v-else class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-gray-500">
          <ListTree size="28" class="text-gray-300" />
          <p class="font-semibold text-gray-700">Selecciona una sección</p>
          <p>Haz clic en una sección de la vista previa o de la lista para cambiar sus fotos, videos, diseño y botón.</p>
          <p>Para cambiar un texto, haz clic sobre él en la vista previa y escribe.</p>
        </div>
      </aside>
    </div>
  </div>
</template>
