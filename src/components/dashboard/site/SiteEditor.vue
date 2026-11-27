<script setup>
// Ajustes del sitio web del productor (/dashboard/sitio): estado y enlaces, nombre, frase, redes, dirección y SEO.
// El diseño (plantillas, secciones, estilo, IA y textos) se edita en el editor visual a pantalla completa
// (/dashboard/sitio/editor, SiteBuilder.vue). Guardar aquí solo envía lo de esta página (PUT parcial de content).
import { computed, reactive, ref, watch } from 'vue'
import { Globe, ExternalLink, Copy, Check, Upload, X, Eye, EyeOff, AlertTriangle, LayoutTemplate, ArrowRight } from 'lucide-vue-next'
import { apiRequest, uploadSiteImage, copyText } from './siteApi.js'
import { TEMPLATE_INFO } from '../../../lib/siteTemplates'
import { PRESET_BY_KEY } from '../../../lib/sitePresets'
import ConfirmDialog from '../ConfirmDialog.vue'

const props = defineProps({
  initialJson: { type: String, required: true },
})

const initial = JSON.parse(props.initialJson)
const site = ref(initial.site)
const urls = ref(initial.urls)
const org = initial.org || {}

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
    title: content.title || '',
    tagline: content.tagline || '',
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

const designName = computed(() => {
  const preset = PRESET_BY_KEY[site.value.content?.preset]
  if (preset) return preset.name
  return TEMPLATE_INFO[site.value.template]?.name || site.value.template
})
const hasSections = computed(() => Array.isArray(site.value.content?.sections))

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
    .replace(/[\u0300-\u036f]/g, '')
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

// --- Imagen para compartir ---
const uploadingOg = ref(false)
async function onUploadOg(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  uploadingOg.value = true
  try {
    form.seo.og_image = await uploadSiteImage(file, 'og')
  } catch (e) {
    flash(e.message, true)
  } finally {
    uploadingOg.value = false
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
  previewKey.value = Date.now()
}

async function save() {
  saving.value = true
  message.value = ''
  try {
    const data = await apiRequest('/api/sites', {
      method: 'PUT',
      body: { content: { title: form.title, tagline: form.tagline, socials: { ...form.socials } }, seo: form.seo },
    })
    applyServer(data)
    flash('Cambios guardados. Ya se ven en tu sitio.')
  } catch (e) {
    flash(e.message, true)
  } finally {
    saving.value = false
  }
}

// Publicar u ocultar cambia lo que ve el público en todas las direcciones del sitio (incluido el dominio propio):
// siempre pasa por el modal de confirmación.
const publishDialog = ref(false)
const publicUrls = computed(() => [urls.value.free, urls.value.subdomain, urls.value.custom].filter(Boolean))

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
    publishDialog.value = false
  }
}

const previewKey = ref(Date.now())
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
          data-testid="site-publish-toggle"
          @click="publishDialog = true"
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

    <!-- Diseño: editor visual -->
    <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" data-testid="site-design-card">
      <div class="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr]">
        <div class="p-5 md:p-6 flex flex-col gap-3 justify-center">
          <span class="inline-flex w-fit items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800"><LayoutTemplate size="14" /> Editor visual</span>
          <h3 class="font-bold text-lg leading-tight">Diseña tu sitio en grande</h3>
          <p class="text-sm text-gray-600">
            Elige una plantilla para tu tipo de productora (compañía, sala, festival, club, academia…), cambia los textos haciendo clic
            sobre ellos, agrega pestañas, carruseles, videos, galerías y ventanas, o pídele los cambios a la IA.
          </p>
          <p class="text-xs text-gray-500">Diseño actual: <strong class="text-gray-700">{{ designName }}</strong><template v-if="!hasSections"> · todavía sin personalizar</template></p>
          <a href="/dashboard/sitio/editor" class="inline-flex w-fit items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700" data-testid="open-site-builder">
            Abrir editor visual <ArrowRight size="16" />
          </a>
        </div>
        <a href="/dashboard/sitio/editor" class="relative block h-56 lg:h-auto min-h-56 overflow-hidden bg-gray-100 border-t lg:border-t-0 lg:border-l border-gray-100" aria-label="Abrir editor visual">
          <iframe
            :key="previewKey"
            :src="`/o/${site.slug}?v=${previewKey}`"
            title="Vista previa del sitio"
            tabindex="-1"
            loading="lazy"
            class="pointer-events-none absolute left-0 top-0 h-[250%] w-[250%] origin-top-left scale-40 bg-white"
          ></iframe>
        </a>
      </div>
    </section>

    <div class="space-y-6">
      <div class="space-y-6">
        <!-- Contenido -->
        <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6 space-y-4">
          <div><h3 class="font-bold">Nombre, frase y redes</h3><p class="text-sm text-gray-500">Se muestran en el encabezado, la portada y el pie de tu sitio.</p></div>
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
              {{ uploadingOg ? 'Subiendo…' : 'Imagen para compartir (1200×630)' }}
              <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" :disabled="uploadingOg" @change="onUploadOg" />
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

    </div>

    <ConfirmDialog
      :open="publishDialog"
      :title="site.published ? '¿Ocultar tu sitio?' : '¿Publicar tu sitio?'"
      :confirm-label="site.published ? 'Ocultar sitio' : 'Publicar sitio'"
      :tone="site.published ? 'danger' : 'default'"
      :busy="publishing"
      test-id="site-publish-dialog"
      @confirm="togglePublished"
      @cancel="publishDialog = false"
    >
      <template v-if="site.published">
        <p>Tu sitio dejará de verse en:</p>
        <ul class="space-y-1">
          <li v-for="url in publicUrls" :key="url" class="font-medium text-gray-900 break-all">{{ url }}</li>
        </ul>
        <p>
          Quien entre verá un aviso de que el sitio no está publicado por ahora.
          <template v-if="urls.custom">Tu dominio sigue conectado: no tienes que tocar el DNS.</template>
        </p>
        <p>Tus eventos siguen a la venta en AI Tickets y puedes volver a publicar el sitio cuando quieras.</p>
      </template>
      <template v-else>
        <p>Tu sitio quedará visible para el público en:</p>
        <ul class="space-y-1">
          <li v-for="url in publicUrls" :key="url" class="font-medium text-gray-900 break-all">{{ url }}</li>
        </ul>
        <p v-if="dirty" class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
          Tienes cambios sin guardar: se publicará la última versión guardada. Guárdalos antes si quieres que se vean.
        </p>
        <p v-if="!org.emailVerified" class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
          Mientras no verifiques el correo de tu productora, solo tú podrás ver el sitio.
        </p>
      </template>
    </ConfirmDialog>
  </div>
</template>
