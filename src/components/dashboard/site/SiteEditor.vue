<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Globe, ExternalLink, Copy, Check, RefreshCw, Upload, X, Eye, EyeOff, AlertTriangle } from 'lucide-vue-next'
import { apiRequest, uploadSiteImage, copyText, htmlToPlain, plainToHtml } from './siteApi.js'

const props = defineProps({
  initialJson: { type: String, required: true },
})

const initial = JSON.parse(props.initialJson)
const site = ref(initial.site)
const urls = ref(initial.urls)
const org = initial.org || {}
const templates = initial.templates || ['clasico', 'nocturno']
const fonts = initial.fonts || ['Unbounded', 'Prompt', 'Inter']

// Valores por defecto de cada plantilla (mismos que src/lib/sites.ts)
const TEMPLATE_INFO = {
  clasico: {
    name: 'Clásico',
    description: 'Fondo claro, tipografía marcada. Ideal para teatro, charlas y ferias.',
    defaults: { primary: '#111827', accent: '#a3e635', background: '#ffffff', text: '#111827', font: 'Unbounded' },
  },
  nocturno: {
    name: 'Nocturno',
    description: 'Fondo oscuro y acentos neón. Ideal para fiestas, música y vida nocturna.',
    defaults: { primary: '#a78bfa', accent: '#f472b6', background: '#0b0b12', text: '#f5f5f5', font: 'Space Grotesk' },
  },
}
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
const colorValue = (key) => form.theme[key] || templateDefaults.value[key]
const setColor = (key, value) => {
  form.theme[key] = value
}
const removeThemeImage = (key) => {
  delete form.theme[key]
}
const resetColors = () => {
  for (const f of COLOR_FIELDS) delete form.theme[f.key]
  delete form.theme.font
}

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
        content: { title: form.title, tagline: form.tagline, about: plainToHtml(form.about), socials },
        seo: form.seo,
      },
    })
    applyServer(data)
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

// --- Vista previa ---
const previewKey = ref(Date.now())
const previewUrl = computed(() => `/o/${site.value.slug}?plantilla=${site.value.template}&v=${previewKey.value}`)
function reloadPreview() {
  previewKey.value = Date.now()
}
const onSiteUpdated = () => reloadPreview()
onMounted(() => window.addEventListener('aitickets:site-updated', onSiteUpdated))
onBeforeUnmount(() => window.removeEventListener('aitickets:site-updated', onSiteUpdated))

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
    <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div class="space-y-2">
          <div class="flex items-center gap-2">
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
            <div v-if="url" class="flex items-center gap-2 text-sm">
              <a :href="url" target="_blank" rel="noopener" class="font-medium text-gray-900 underline break-all">{{ url }}</a>
              <button type="button" class="p-1 text-gray-500 hover:text-black" :title="'Copiar enlace'" @click="copy(url)">
                <component :is="copied === url ? Check : Copy" size="14" />
              </button>
              <a :href="url" target="_blank" rel="noopener" class="p-1 text-gray-500 hover:text-black" title="Abrir"><ExternalLink size="14" /></a>
            </div>
          </div>
        </div>
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg border"
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
        <!-- Dirección -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
          <h3 class="font-bold">Dirección de tu sitio</h3>
          <div class="flex flex-col sm:flex-row gap-2">
            <div class="flex flex-1 items-center rounded-lg border border-gray-300 focus-within:ring-2 focus-within:ring-black overflow-hidden">
              <span class="px-3 py-2 text-sm text-gray-500 bg-gray-50 border-r border-gray-200 whitespace-nowrap">aitickets.cl/o/</span>
              <input v-model="slugInput" type="text" maxlength="40" class="flex-1 px-3 py-2 text-sm outline-none" aria-label="Dirección del sitio" />
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

        <!-- Plantilla -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
          <h3 class="font-bold">Plantilla</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              v-for="key in templates"
              :key="key"
              type="button"
              class="text-left rounded-xl border-2 overflow-hidden transition-colors"
              :class="form.template === key ? 'border-black' : 'border-gray-200 hover:border-gray-400'"
              @click="form.template = key"
            >
              <div class="h-24 p-3 flex flex-col justify-between" :style="{ background: TEMPLATE_INFO[key]?.defaults.background }">
                <div class="h-2 w-16 rounded" :style="{ background: TEMPLATE_INFO[key]?.defaults.text }"></div>
                <div class="flex gap-2">
                  <div class="h-8 flex-1 rounded" :style="{ background: TEMPLATE_INFO[key]?.defaults.primary, opacity: 0.85 }"></div>
                  <div class="h-8 flex-1 rounded" :style="{ background: TEMPLATE_INFO[key]?.defaults.accent, opacity: 0.85 }"></div>
                  <div class="h-8 flex-1 rounded border border-gray-300/40"></div>
                </div>
              </div>
              <div class="p-3">
                <p class="font-semibold text-sm">{{ TEMPLATE_INFO[key]?.name || key }}</p>
                <p class="text-xs text-gray-500">{{ TEMPLATE_INFO[key]?.description }}</p>
              </div>
            </button>
          </div>
        </section>

        <!-- Colores, tipografía e imágenes -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="font-bold">Colores y tipografía</h3>
            <button type="button" class="text-xs text-gray-500 underline" @click="resetColors">Usar los de la plantilla</button>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label v-for="field in COLOR_FIELDS" :key="field.key" class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">{{ field.label }}</span>
              <span class="flex items-center gap-2 rounded-lg border border-gray-300 px-2 py-1.5">
                <input
                  type="color"
                  class="h-7 w-9 cursor-pointer bg-transparent"
                  :value="colorValue(field.key)"
                  @input="setColor(field.key, $event.target.value)"
                />
                <span class="text-xs text-gray-600 font-mono">{{ colorValue(field.key) }}</span>
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
                <div class="h-16 w-16 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
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
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
          <h3 class="font-bold">Contenido</h3>
          <label class="block">
            <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre a mostrar</span>
            <input v-model="form.title" type="text" maxlength="80" :placeholder="org.publicName" class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
          </label>
          <label class="block">
            <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Frase corta</span>
            <input v-model="form.tagline" type="text" maxlength="200" placeholder="Ej: Las mejores fiestas de Valparaíso desde 2015" class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
          </label>
          <label class="block">
            <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Sobre nosotros</span>
            <textarea v-model="form.about" rows="5" maxlength="5000" placeholder="Cuenta quiénes son y qué tipo de eventos hacen. Separa los párrafos con una línea en blanco." class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black"></textarea>
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

        <!-- SEO -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
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
          <div class="flex items-center gap-3">
            <div class="h-16 w-28 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
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
            class="px-5 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-40"
            :disabled="saving || !dirty"
            @click="save"
          >
            {{ saving ? 'Guardando…' : 'Guardar cambios' }}
          </button>
        </div>
      </div>

      <!-- Vista previa -->
      <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden xl:sticky xl:top-4">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <p class="text-sm font-semibold">Vista previa <span class="font-normal text-gray-500">(cambios guardados)</span></p>
          <div class="flex items-center gap-2">
            <button type="button" class="p-1.5 text-gray-500 hover:text-black" title="Recargar" @click="reloadPreview"><RefreshCw size="16" /></button>
            <a :href="`/o/${site.slug}`" target="_blank" rel="noopener" class="p-1.5 text-gray-500 hover:text-black" title="Abrir en otra pestaña"><ExternalLink size="16" /></a>
          </div>
        </div>
        <iframe :key="previewKey" :src="previewUrl" title="Vista previa del sitio" class="w-full h-[720px] bg-gray-50" loading="lazy"></iframe>
      </section>
    </div>
  </div>
</template>
