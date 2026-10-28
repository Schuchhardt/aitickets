<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Globe, ExternalLink, Copy, Check, RefreshCw, Upload, X, Eye, EyeOff, AlertTriangle, Monitor, Smartphone } from 'lucide-vue-next'
import { apiRequest, uploadSiteImage, copyText, htmlToPlain, plainToHtml } from './siteApi.js'
import { TEMPLATE_INFO, defaultSections, fontStack, sanitizeSections } from '../../../lib/siteTemplates'
import SectionsEditor from './SectionsEditor.vue'
import SiteAiPanel from './SiteAiPanel.vue'
import '../../../styles/site-niches.css'

const props = defineProps({
  initialJson: { type: String, required: true },
})

const initial = JSON.parse(props.initialJson)
const site = ref(initial.site)
const urls = ref(initial.urls)
const org = initial.org || {}
const templates = initial.templates || ['clasico', 'nocturno']
const fonts = initial.fonts || ['Unbounded', 'Prompt', 'Inter']

// Plantillas por nicho primero (mismo estilo que cada landing de nicho) y luego las generales
const nicheTemplates = templates.filter((t) => TEMPLATE_INFO[t]?.group === 'nicho')
const generalTemplates = templates.filter((t) => TEMPLATE_INFO[t] && TEMPLATE_INFO[t].group !== 'nicho')
const COLOR_FIELDS = [
  { key: 'primary', label: 'Principal' },
  { key: 'accent', label: 'Acento' },
  { key: 'background', label: 'Fondo' },
  { key: 'text', label: 'Texto' },
]
const SOCIAL_FIELDS = [
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/tuproductora' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/tuproductora' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@tuproductora' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@tuproductora' },
  { key: 'x', label: 'X (Twitter)', placeholder: 'https://x.com/tuproductora' },
  { key: 'website', label: 'Otro sitio web', placeholder: 'https://tuproductora.cl' },
]

function formFromSite(s) {
  const content = s.content || {}
  const socials = content.socials || {}
  return {
    template: templates.includes(s.template) ? s.template : 'clasico',
    theme: { ...(s.theme || {}) },
    title: content.title || '',
    tagline: content.tagline || '',
    about: htmlToPlain(content.about || ''),
    socials: {
      instagram: socials.instagram || '',
      facebook: socials.facebook || '',
      tiktok: socials.tiktok || '',
      youtube: socials.youtube || '',
      x: socials.x || '',
      website: socials.website || '',
      whatsapp: socials.whatsapp || '',
    },
    seo: { title: s.seo?.title || '', description: s.seo?.description || '', og_image: s.seo?.og_image || '' },
    // Sin secciones guardadas: las sugeridas de la plantilla (el sitio sigue con la plantilla original hasta guardar)
    sections: Array.isArray(content.sections) ? sanitizeSections(content.sections) : defaultSections(templates.includes(s.template) ? s.template : 'clasico'),
  }
}

const form = reactive(formFromSite(site.value))
const savedSnapshot = ref(JSON.stringify(form))
const dirty = computed(() => JSON.stringify(form) !== savedSnapshot.value)

const saving = ref(false)
const message = ref('')
const isError = ref(false)
const publishing = ref(false)

const templateDefaults = computed(() => TEMPLATE_INFO[form.template]?.defaults || TEMPLATE_INFO.clasico.defaults)
const templateName = computed(() => TEMPLATE_INFO[form.template]?.name || form.template)

// --- Plantilla y secciones ---
const withoutIds = (sections) => JSON.stringify(sections.map(({ id, ...rest }) => rest))
const usingSuggested = computed(() => withoutIds(form.sections) === withoutIds(defaultSections(form.template)))
function clearStyleOverrides() {
  for (const f of COLOR_FIELDS) delete form.theme[f.key]
  delete form.theme.font
  delete form.theme.dark
}
function selectTemplate(key) {
  if (key === form.template) return
  pushHistory()
  // Si las secciones siguen como las sugirió la plantilla anterior, se cambian por las de la nueva (sus textos son del nicho)
  if (usingSuggested.value) form.sections = defaultSections(key)
  clearStyleOverrides()
  form.template = key
}
function useSuggestedSections() {
  pushHistory()
  form.sections = defaultSections(form.template)
}

// --- Deshacer (cambios de la IA y de plantilla) ---
const history = ref([])
function pushHistory() {
  history.value.push(JSON.stringify(form))
  if (history.value.length > 20) history.value.shift()
}
function undo() {
  const previous = history.value.pop()
  if (previous) Object.assign(form, JSON.parse(previous))
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
})
function applyAi(changes) {
  pushHistory()
  if (changes.template && templates.includes(changes.template)) {
    form.template = changes.template
    if (!changes.theme) clearStyleOverrides()
  }
  if (changes.theme) form.theme = { ...changes.theme }
  if (typeof changes.title === 'string') form.title = changes.title
  if (typeof changes.tagline === 'string') form.tagline = changes.tagline
  if (typeof changes.about === 'string') form.about = changes.about
  if (Array.isArray(changes.sections)) {
    form.sections = changes.sections
    if (aiTarget.value) aiTarget.value = form.sections.find((s) => s.id === aiTarget.value.id) || null
  }
}
function editSectionWithAi(section) {
  aiTarget.value = section
  aiPanel.value?.$el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  aiPanel.value?.focus()
}
const colorValue = (key) => form.theme[key] || templateDefaults.value[key]
const setColor = (key, value) => {
  form.theme[key] = value
}
const removeThemeImage = (key) => {
  delete form.theme[key]
}
const resetColors = () => clearStyleOverrides()

// --- Dirección (slug) ---
const slugInput = ref(site.value.slug)
const slugState = ref({ checking: false, available: true, reason: null })
const slugSaving = ref(false)
let slugTimer = null
const slugMessage = computed(() => {
  if (slugInput.value === site.value.slug) return ''
  if (slugState.value.checking) return 'Revisando disponibilidad…'
  if (slugState.value.available) return '¡Disponible!'
  return (
    {
      invalid: 'Usa entre 3 y 40 caracteres: minúsculas, números y guiones (sin guion al inicio ni al final).',
      reserved: 'Esa dirección está reservada.',
      taken: 'Esa dirección ya está en uso.',
    }[slugState.value.reason] || 'No disponible.'
  )
})
watch(slugInput, (value) => {
  const cleaned = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
  if (cleaned !== value) {
    slugInput.value = cleaned
    return
  }
  clearTimeout(slugTimer)
  if (cleaned === site.value.slug) {
    slugState.value = { checking: false, available: true, reason: null }
    return
  }
  slugState.value = { checking: true, available: false, reason: null }
  slugTimer = setTimeout(async () => {
    try {
      const data = await apiRequest(`/api/sites/slug-check?slug=${encodeURIComponent(cleaned)}`)
      if (slugInput.value !== cleaned) return
      slugState.value = { checking: false, available: !!data.available, reason: data.reason || null }
    } catch (e) {
      slugState.value = { checking: false, available: false, reason: 'error' }
    }
  }, 400)
})

async function saveSlug() {
  if (slugInput.value === site.value.slug || !slugState.value.available) return
  const ok = window.confirm(
    `Tu sitio pasará a ${urls.value.free.replace(/\/o\/[^/]+$/, '')}/o/${slugInput.value}. ` +
      'Los enlaces con la dirección anterior dejarán de funcionar. ¿Continuar?'
  )
  if (!ok) return
  slugSaving.value = true
  try {
    const data = await apiRequest('/api/sites', { method: 'PUT', body: { slug: slugInput.value } })
    applyServer(data, { keepForm: true })
    flash('Dirección actualizada.')
  } catch (e) {
    flash(e.message, true)
  } finally {
    slugSaving.value = false
  }
}

// --- Imágenes ---
const uploading = reactive({ logo: false, hero: false, og: false })
async function onUpload(event, kind) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  uploading[kind] = true
  try {
    const url = await uploadSiteImage(file, kind)
    if (kind === 'logo') form.theme.logo_url = url
    else if (kind === 'hero') form.theme.hero_image_url = url
    else form.seo.og_image = url
  } catch (e) {
    flash(e.message, true)
  } finally {
    uploading[kind] = false
  }
}

// --- Guardar ---
function flash(text, error = false) {
  message.value = text
  isError.value = error
  if (!error) setTimeout(() => { if (message.value === text) message.value = '' }, 4000)
}

function applyServer(data, { keepForm = false } = {}) {
  if (data.site) site.value = data.site
  if (data.urls) urls.value = data.urls
  if (!keepForm) {
    Object.assign(form, formFromSite(site.value))
    savedSnapshot.value = JSON.stringify(form)
  }
  slugInput.value = site.value.slug
  reloadPreview()
}

async function save() {
  saving.value = true
  message.value = ''
  try {
    const socials = { ...form.socials }
    const data = await apiRequest('/api/sites', {
      method: 'PUT',
      body: {
        template: form.template,
        theme: form.theme,
        content: { title: form.title, tagline: form.tagline, about: plainToHtml(form.about), socials, sections: form.sections },
        seo: form.seo,
      },
    })
    applyServer(data)
    history.value = []
    flash('Cambios guardados. Ya se ven en tu sitio.')
  } catch (e) {
    flash(e.message, true)
  } finally {
    saving.value = false
  }
}

async function togglePublished() {
  publishing.value = true
  try {
    const data = await apiRequest('/api/sites', { method: 'PUT', body: { published: !site.value.published } })
    applyServer(data, { keepForm: true })
    flash(site.value.published ? 'Tu sitio está publicado.' : 'Tu sitio quedó oculto al público.')
  } catch (e) {
    flash(e.message, true)
  } finally {
    publishing.value = false
  }
}

// --- Vista previa en vivo ---
// /o/<slug>?editor=1 se hidrata solo para el dueño y redibuja con el borrador que le mandamos por postMessage
// (src/components/sites/SitePage.vue): los cambios se ven antes de guardar.
const previewKey = ref(Date.now())
const previewFrame = ref(null)
const previewMode = ref('desktop')
const previewUrl = computed(() => `/o/${site.value.slug}?editor=1&v=${previewKey.value}`)
function reloadPreview() {
  previewKey.value = Date.now()
}
function postDraft() {
  const win = previewFrame.value?.contentWindow
  if (!win) return
  win.postMessage({ type: 'aitickets:site-draft', draft: JSON.parse(JSON.stringify(draft())) }, window.location.origin)
}
let draftTimer = null
watch(form, () => {
  clearTimeout(draftTimer)
  draftTimer = setTimeout(postDraft, 200)
}, { deep: true })
function onPreviewMessage(event) {
  if (event.origin !== window.location.origin || event.source !== previewFrame.value?.contentWindow) return
  if (event.data?.type === 'aitickets:site-preview-ready') postDraft()
}
const onSiteUpdated = () => reloadPreview()
onMounted(() => {
  window.addEventListener('aitickets:site-updated', onSiteUpdated)
  window.addEventListener('message', onPreviewMessage)
})
onBeforeUnmount(() => {
  window.removeEventListener('aitickets:site-updated', onSiteUpdated)
  window.removeEventListener('message', onPreviewMessage)
  clearTimeout(draftTimer)
})

const copied = ref('')
async function copy(url) {
  if (await copyText(url)) {
    copied.value = url
    setTimeout(() => { if (copied.value === url) copied.value = '' }, 2000)
  }
}

const visibleToPublic = computed(() => site.value.published && org.emailVerified)
</script>

<template>
  <div class="space-y-6">
    <!-- Estado y URLs -->
    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6">
      <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div class="space-y-2 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <Globe size="18" />
            <h2 class="font-bold text-lg">Tu sitio web</h2>
            <span
              class="text-xs font-semibold px-2 py-0.5 rounded-full"
              :class="visibleToPublic ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'"
            >
              {{ visibleToPublic ? 'Publicado' : 'No visible' }}
            </span>
          </div>
          <div v-for="(url, key) in { free: urls.free, subdomain: urls.subdomain, custom: urls.custom }" :key="key">
            <div v-if="url" class="flex items-center gap-2 text-sm min-w-0">
              <a :href="url" target="_blank" rel="noopener" class="font-medium text-gray-900 underline break-all min-w-0">{{ url }}</a>
              <button type="button" class="p-1 shrink-0 text-gray-500 hover:text-black" :title="'Copiar enlace'" @click="copy(url)">
                <component :is="copied === url ? Check : Copy" size="14" />
              </button>
              <a :href="url" target="_blank" rel="noopener" class="p-1 shrink-0 text-gray-500 hover:text-black" title="Abrir"><ExternalLink size="14" /></a>
            </div>
          </div>
        </div>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg border shrink-0"
          :class="site.published ? 'border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-black text-white border-black hover:bg-gray-800'"
          :disabled="publishing"
          @click="togglePublished"
        >
          <component :is="site.published ? EyeOff : Eye" size="16" />
          {{ publishing ? 'Guardando…' : site.published ? 'Ocultar sitio' : 'Publicar sitio' }}
        </button>
      </div>

      <div v-if="!org.emailVerified" class="mt-4 flex gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle size="16" class="shrink-0 mt-0.5" />
        <span>Verifica el correo de tu productora para que el sitio sea visible al público. Mientras tanto solo tú puedes verlo.</span>
      </div>
      <div v-else-if="!org.publishedEvents" class="mt-4 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-700">
        Tu sitio aparecerá en Google cuando tengas al menos un evento publicado.
      </div>
    </section>

    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
      <div class="space-y-6">
        <SiteAiPanel ref="aiPanel" :get-draft="draft" :target="aiTarget" :can-undo="history.length > 0" @apply="applyAi" @undo="undo" @clear-target="aiTarget = null" />

        <!-- Plantilla -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6 space-y-4">
          <div>
            <h3 class="font-bold">Plantilla</h3>
            <p class="text-sm text-gray-500">Cada plantilla tiene el estilo de su tipo de evento. Al cambiarla se usan sus colores; luego puedes ajustarlos.</p>
          </div>
          <div v-for="group in [{ label: 'Según lo que produces', keys: nicheTemplates }, { label: 'Generales', keys: generalTemplates }]" :key="group.label" class="space-y-2">
            <p v-if="group.keys.length" class="text-xs font-bold text-gray-500 uppercase">{{ group.label }}</p>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <button
                v-for="key in group.keys"
                :key="key"
                type="button"
                class="text-left rounded-xl border-2 overflow-hidden transition-colors"
                :class="form.template === key ? 'border-black' : 'border-gray-200 hover:border-gray-400'"
                :aria-pressed="form.template === key"
                @click="selectTemplate(key)"
              >
                <div class="h-20 p-2.5 flex flex-col justify-between" :style="{ background: TEMPLATE_INFO[key].defaults.background, color: TEMPLATE_INFO[key].defaults.text }">
                  <span class="text-xl leading-none truncate" :style="{ fontFamily: fontStack(TEMPLATE_INFO[key].defaults.font) }">Aa</span>
                  <div class="flex gap-1.5">
                    <span class="h-4 w-8 rounded-full" :style="{ background: TEMPLATE_INFO[key].defaults.primary }"></span>
                    <span class="h-4 w-4 rounded-full" :style="{ background: TEMPLATE_INFO[key].defaults.accent }"></span>
                  </div>
                </div>
                <div class="p-2.5">
                  <p class="font-semibold text-sm leading-tight">{{ TEMPLATE_INFO[key].name }}</p>
                  <p class="text-[11px] leading-snug text-gray-500 mt-0.5">{{ TEMPLATE_INFO[key].description }}</p>
                </div>
              </button>
            </div>
          </div>
          <p v-if="!usingSuggested" class="text-xs text-gray-500">
            Mantuvimos tus secciones.
            <button type="button" class="underline" @click="useSuggestedSections">Usar las sugeridas para {{ templateName }}</button>
          </p>
        </section>

        <SectionsEditor :form="form" :contact-form-enabled="site.contact_form_enabled" @ai="editSectionWithAi" @error="(m) => flash(m, true)" />

        <!-- Colores, tipografía e imágenes -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-bold">Colores y tipografía</h3>
            <button type="button" class="text-xs text-gray-500 underline" @click="resetColors">Usar los de la plantilla</button>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label v-for="field in COLOR_FIELDS" :key="field.key" class="block min-w-0">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">{{ field.label }}</span>
              <span class="flex items-center gap-2 rounded-lg border border-gray-300 px-2 py-1.5 min-w-0">
                <input
                  type="color"
                  class="h-7 w-9 shrink-0 cursor-pointer bg-transparent"
                  :value="colorValue(field.key)"
                  @input="setColor(field.key, $event.target.value)"
                />
                <span class="text-xs text-gray-600 font-mono truncate">{{ colorValue(field.key) }}</span>
              </span>
            </label>
          </div>
          <label class="block">
            <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Tipografía de títulos</span>
            <select v-model="form.theme.font" class="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white outline-none focus:ring-2 focus:ring-black">
              <option :value="undefined">La de la plantilla ({{ templateDefaults.font }})</option>
              <option v-for="f in fonts" :key="f" :value="f">{{ f }}</option>
            </select>
          </label>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div v-for="img in [{ kind: 'logo', key: 'logo_url', label: 'Logo' }, { kind: 'hero', key: 'hero_image_url', label: 'Imagen de portada' }]" :key="img.kind">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">{{ img.label }}</span>
              <div class="flex items-center gap-3">
                <div class="h-16 w-16 shrink-0 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
                  <img v-if="form.theme[img.key]" :src="form.theme[img.key]" alt="" class="h-full w-full object-cover" />
                  <Upload v-else size="16" class="text-gray-400" />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-xs px-3 py-1.5 rounded-lg border border-gray-300 cursor-pointer hover:bg-gray-50">
                    {{ uploading[img.kind] ? 'Subiendo…' : 'Subir imagen' }}
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" :disabled="uploading[img.kind]" @change="onUpload($event, img.kind)" />
                  </label>
                  <button v-if="form.theme[img.key]" type="button" class="text-xs text-gray-500 underline text-left" @click="removeThemeImage(img.key)">Quitar</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Contenido -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6 space-y-4">
          <h3 class="font-bold">Contenido</h3>
          <label class="block">
            <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre a mostrar</span>
            <input v-model="form.title" type="text" maxlength="80" :placeholder="org.publicName" class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
          </label>
          <label class="block">
            <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Frase corta</span>
            <input v-model="form.tagline" type="text" maxlength="200" placeholder="Ej: Las mejores fiestas de Valparaíso desde 2015" class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
          </label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label v-for="s in SOCIAL_FIELDS" :key="s.key" class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">{{ s.label }}</span>
              <input v-model="form.socials[s.key]" type="url" :placeholder="s.placeholder" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
            </label>
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">WhatsApp</span>
              <input v-model="form.socials.whatsapp" type="tel" placeholder="56912345678" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
            </label>
          </div>
        </section>

        <!-- Dirección -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6 space-y-3">
          <h3 class="font-bold">Dirección de tu sitio</h3>
          <div class="flex flex-col sm:flex-row gap-2">
            <div class="flex flex-1 items-center rounded-lg border border-gray-300 focus-within:ring-2 focus-within:ring-black overflow-hidden">
              <span class="px-3 py-2 text-sm text-gray-500 bg-gray-50 border-r border-gray-200 whitespace-nowrap">aitickets.cl/o/</span>
              <input v-model="slugInput" type="text" maxlength="40" class="flex-1 min-w-0 px-3 py-2 text-sm outline-none" aria-label="Dirección del sitio" />
            </div>
            <button
              type="button"
              class="px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-40"
              :disabled="slugInput === site.slug || !slugState.available || slugState.checking || slugSaving"
              @click="saveSlug"
            >
              {{ slugSaving ? 'Guardando…' : 'Cambiar' }}
            </button>
          </div>
          <p v-if="slugMessage" class="text-xs" :class="slugState.available && !slugState.checking ? 'text-green-700' : 'text-gray-500'">{{ slugMessage }}</p>
        </section>

        <!-- SEO -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6 space-y-4">
          <div>
            <h3 class="font-bold">Google y redes sociales</h3>
            <p class="text-sm text-gray-500">Cómo se ve tu sitio al compartirlo o en los resultados de búsqueda.</p>
          </div>
          <label class="block">
            <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Título ({{ form.seo.title.length }}/70)</span>
            <input v-model="form.seo.title" type="text" maxlength="70" class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
          </label>
          <label class="block">
            <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Descripción ({{ form.seo.description.length }}/170)</span>
            <textarea v-model="form.seo.description" rows="2" maxlength="170" class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black"></textarea>
          </label>
          <div class="flex flex-wrap items-center gap-3">
            <div class="h-16 w-28 shrink-0 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
              <img v-if="form.seo.og_image" :src="form.seo.og_image" alt="" class="h-full w-full object-cover" />
              <Upload v-else size="16" class="text-gray-400" />
            </div>
            <label class="text-xs px-3 py-1.5 rounded-lg border border-gray-300 cursor-pointer hover:bg-gray-50">
              {{ uploading.og ? 'Subiendo…' : 'Imagen para compartir (1200×630)' }}
              <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" :disabled="uploading.og" @change="onUpload($event, 'og')" />
            </label>
            <button v-if="form.seo.og_image" type="button" class="p-1 text-gray-500 hover:text-black" title="Quitar" @click="form.seo.og_image = ''"><X size="14" /></button>
          </div>
        </section>

        <div class="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/95 backdrop-blur px-4 py-3 shadow-lg">
          <p class="text-sm" :class="isError ? 'text-red-600' : 'text-gray-600'">
            {{ message || (dirty ? 'Tienes cambios sin guardar.' : 'Todo guardado.') }}
          </p>
          <button
            type="button"
            class="px-5 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-40 shrink-0 whitespace-nowrap"
            :disabled="saving || !dirty"
            @click="save"
          >
            {{ saving ? 'Guardando…' : 'Guardar cambios' }}
          </button>
        </div>
      </div>

      <!-- Vista previa -->
      <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden xl:sticky xl:top-4">
        <div class="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
          <p class="text-sm font-semibold min-w-0">Vista previa <span class="font-normal text-gray-500">{{ dirty ? '(con cambios sin guardar)' : '(en vivo)' }}</span></p>
          <div class="flex items-center gap-2">
            <button type="button" class="p-1.5" :class="previewMode === 'desktop' ? 'text-black' : 'text-gray-400 hover:text-black'" title="Computador" :aria-pressed="previewMode === 'desktop'" @click="previewMode = 'desktop'"><Monitor size="16" /></button>
            <button type="button" class="p-1.5" :class="previewMode === 'mobile' ? 'text-black' : 'text-gray-400 hover:text-black'" title="Celular" :aria-pressed="previewMode === 'mobile'" @click="previewMode = 'mobile'"><Smartphone size="16" /></button>
            <button type="button" class="p-1.5 text-gray-500 hover:text-black" title="Recargar" @click="reloadPreview"><RefreshCw size="16" /></button>
            <a :href="`/o/${site.slug}`" target="_blank" rel="noopener" class="p-1.5 text-gray-500 hover:text-black" title="Abrir en otra pestaña"><ExternalLink size="16" /></a>
          </div>
        </div>
        <div class="bg-gray-100 flex justify-center">
          <iframe
            ref="previewFrame"
            :key="previewKey"
            :src="previewUrl"
            title="Vista previa del sitio"
            class="h-[560px] md:h-[760px] bg-white transition-[width] duration-200"
            :class="previewMode === 'mobile' ? 'w-[390px] max-w-full border-x border-gray-200' : 'w-full'"
            @load="postDraft"
          ></iframe>
        </div>
      </section>
    </div>
  </div>
</template>
