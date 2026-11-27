<script setup>
// Ajustes de la sección seleccionada en el editor visual: textos, diseño (data.layout), fotos y videos, ítems, botón
// (enlace o ventana) y si aparece en el menú. Edita la sección del borrador directamente (SiteBuilder.vue). Los textos
// también se editan haciendo clic en la vista previa.
import { computed, ref } from 'vue'
import { ArrowDown, ArrowUp, Eye, EyeOff, Menu, Plus, Sparkles, Trash2, X, Copy } from 'lucide-vue-next'
import {
  SECTION_INFO,
  SECTION_LAYOUTS,
  TEMPLATE_INFO,
  blankItem,
  sectionAnchor,
  textMax,
} from '../../../../lib/siteTemplates'
import MediaField from './MediaField.vue'
import VideoField from './VideoField.vue'
import { uploadSiteImage } from '../siteApi.js'

const props = defineProps({
  section: { type: Object, required: true },
  form: { type: Object, required: true },
  /** { images, videos, maxImages, maxVideos } */
  media: { type: Object, required: true },
  contactFormEnabled: { type: Boolean, default: true },
})
const emit = defineEmits(['ai', 'remove', 'duplicate', 'close', 'error', 'open-dialog'])

const s = computed(() => props.section)
const d = computed(() => props.section.data)
const info = computed(() => TEMPLATE_INFO[props.form.template] || TEMPLATE_INFO.clasico)
const layouts = computed(() => SECTION_LAYOUTS[s.value.type] || [])
const imagesFull = computed(() => props.media.images >= props.media.maxImages)
const videosFull = computed(() => props.media.videos >= props.media.maxVideos)

const input = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white outline-none focus:ring-2 focus:ring-violet-500'
const label = 'block text-xs font-semibold text-gray-600 mb-1'
const max = (field, item = false) => textMax(s.value.type, field, item) || undefined

const ITEM_FIELDS = {
  highlights: [
    { key: 'title', label: 'Título' },
    { key: 'text', label: 'Texto', multiline: true },
  ],
  faq: [
    { key: 'question', label: 'Pregunta' },
    { key: 'answer', label: 'Respuesta', multiline: true },
  ],
  testimonials: [
    { key: 'quote', label: 'Opinión (real, de tu público o la prensa)', multiline: true },
    { key: 'author', label: 'Quién lo dice' },
  ],
  tabs: [
    { key: 'title', label: 'Nombre de la pestaña' },
    { key: 'text', label: 'Contenido', multiline: true, rows: 4 },
  ],
  people: [
    { key: 'name', label: 'Nombre' },
    { key: 'role', label: 'Rol' },
    { key: 'text', label: 'Bio (se abre en una ventana)', multiline: true, rows: 3 },
  ],
}
const ITEM_NOUN = { highlights: 'punto', faq: 'pregunta', testimonials: 'opinión', tabs: 'pestaña', people: 'persona' }
const hasItems = computed(() => !!ITEM_FIELDS[s.value.type])
const items = computed(() => d.value.items || [])
const maxItems = computed(() => SECTION_INFO[s.value.type].maxItems || 0)

function addItem() {
  if (!d.value.items) d.value.items = []
  if (d.value.items.length < maxItems.value) d.value.items.push(blankItem(s.value.type))
}
function moveItem(i, delta) {
  const list = d.value.items
  const t = i + delta
  if (t < 0 || t >= list.length) return
  const [item] = list.splice(i, 1)
  list.splice(t, 0, item)
}

// --- Botón: a dónde lleva ---
const anchors = computed(() =>
  props.form.sections.filter((x) => x.id !== s.value.id && x.type !== 'events').map((x) => ({ value: `#${sectionAnchor(x)}`, label: `Sección: ${x.data.title || SECTION_INFO[x.type].name}` }))
)
const buttonTarget = computed({
  get() {
    const url = d.value.button_url
    if (!url || url === '#eventos') return '#eventos'
    if (url === 'contacto') return 'contacto'
    if (url.startsWith('#')) return url
    return 'url'
  },
  set(v) {
    d.value.button_url = v === 'url' ? 'https://' : v
  },
})
const supportsModal = computed(() => s.value.type === 'cta' || s.value.type === 'feature')
function setAction(action) {
  if (action === 'modal') d.value.button_action = 'modal'
  else delete d.value.button_action
}

// --- Galería ---
const galleryUploading = ref(false)
async function addGalleryImages(event) {
  const files = [...(event.target.files || [])]
  event.target.value = ''
  if (!files.length) return
  if (!d.value.items) d.value.items = []
  const room = Math.min(maxItems.value - d.value.items.length, props.media.maxImages - props.media.images)
  if (room <= 0) {
    emit('error', imagesFull.value ? `Tu sitio llegó al máximo de ${props.media.maxImages} fotos.` : `Esta galería admite hasta ${maxItems.value} fotos.`)
    return
  }
  if (files.length > room) emit('error', `Solo se agregarán ${room} foto${room === 1 ? '' : 's'} (límite de la galería o del sitio).`)
  galleryUploading.value = true
  try {
    for (const file of files.slice(0, room)) {
      const url = await uploadSiteImage(file, 'gallery')
      d.value.items.push({ image_url: url, caption: '' })
    }
  } catch (e) {
    emit('error', e.message)
  } finally {
    galleryUploading.value = false
  }
}

function toggleNav() {
  if (s.value.nav) delete s.value.nav
  else s.value.nav = true
}
function toggleHidden() {
  if (s.value.hidden) delete s.value.hidden
  else s.value.hidden = true
}
const titlePlaceholder = computed(() => {
  if (s.value.type === 'hero') return props.form.title || 'El nombre de tu productora'
  if (s.value.type === 'events') return info.value.copy.eventsTitle
  if (s.value.type === 'contact') return info.value.copy.contactTitle
  return ''
})
</script>

<template>
  <div class="flex h-full flex-col" data-testid="site-inspector">
    <div class="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
      <div class="min-w-0 flex-1">
        <p class="text-[11px] font-bold uppercase tracking-wide text-violet-700">{{ SECTION_INFO[s.type].name }}</p>
        <p class="truncate text-sm font-semibold">{{ d.title || (s.type === 'hero' ? form.title || 'Portada' : SECTION_INFO[s.type].name) }}</p>
      </div>
      <button type="button" class="p-1.5 text-gray-500 hover:text-violet-700" title="Editar con IA" @click="emit('ai', s)"><Sparkles size="16" /></button>
      <button type="button" class="p-1.5 text-gray-500 hover:text-black" :title="s.hidden ? 'Mostrar en el sitio' : 'Ocultar del sitio'" @click="toggleHidden">
        <component :is="s.hidden ? EyeOff : Eye" size="16" />
      </button>
      <button v-if="!SECTION_INFO[s.type].single" type="button" class="p-1.5 text-gray-500 hover:text-black" title="Duplicar" @click="emit('duplicate', s)"><Copy size="16" /></button>
      <button v-if="s.type !== 'events'" type="button" class="p-1.5 text-gray-500 hover:text-red-600" title="Quitar sección" @click="emit('remove', s)"><Trash2 size="16" /></button>
      <button type="button" class="p-1.5 text-gray-500 hover:text-black" title="Cerrar" @click="emit('close')"><X size="16" /></button>
    </div>

    <div class="flex-1 space-y-5 overflow-y-auto px-4 py-4">
      <p class="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">Tip: haz clic en cualquier texto de la vista previa para editarlo ahí mismo.</p>
      <p v-if="s.hidden" class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Esta sección está oculta: no se ve en tu sitio.</p>

      <!-- Menú -->
      <div v-if="s.type !== 'hero'" class="space-y-2">
        <label class="flex items-center justify-between gap-3 text-sm">
          <span class="inline-flex items-center gap-2 font-medium"><Menu size="14" /> Mostrar en el menú</span>
          <input type="checkbox" class="h-4 w-4 accent-violet-600" :checked="!!s.nav" @change="toggleNav" />
        </label>
        <input v-if="s.nav" v-model="d.nav_label" type="text" :maxlength="max('nav_label')" :class="input" :placeholder="d.title || SECTION_INFO[s.type].name" aria-label="Texto en el menú" />
      </div>

      <!-- Diseño -->
      <div v-if="layouts.length">
        <span :class="label">Diseño</span>
        <div class="grid gap-1.5" :class="layouts.length > 2 ? 'grid-cols-1' : 'grid-cols-2'">
          <button
            v-for="l in layouts"
            :key="l.value"
            type="button"
            class="rounded-lg border px-3 py-2 text-left text-xs"
            :class="(d.layout || (s.type === 'hero' ? info.hero : s.type === 'events' ? info.events : layouts[0].value)) === l.value ? 'border-violet-600 bg-violet-50 font-semibold text-violet-900' : 'border-gray-200 hover:border-gray-400'"
            @click="d.layout = l.value"
          >{{ l.label }}</button>
        </div>
      </div>

      <!-- Textos de cabecera -->
      <div class="space-y-3">
        <label v-if="!['cta', 'contact'].includes(s.type)" class="block">
          <span :class="label">Antetítulo</span>
          <input v-model="d.eyebrow" type="text" :maxlength="max('eyebrow')" :class="input" placeholder="Opcional" />
        </label>
        <label class="block">
          <span :class="label">Título</span>
          <input v-model="d.title" type="text" :maxlength="max('title')" :class="input" :placeholder="titlePlaceholder" />
        </label>
        <label v-if="s.type === 'hero'" class="block">
          <span :class="label">Frase</span>
          <textarea v-model="d.subtitle" rows="2" :maxlength="max('subtitle')" :class="input" :placeholder="form.tagline || 'Ej: Las mejores fiestas de Valparaíso desde 2015'"></textarea>
        </label>
        <label v-if="max('text')" class="block">
          <span :class="label">{{ s.type === 'events' || s.type === 'video' ? 'Texto (opcional)' : 'Texto' }}</span>
          <textarea v-model="d.text" :rows="s.type === 'feature' ? 5 : 3" :maxlength="max('text')" :class="input" :placeholder="s.type === 'contact' ? info.copy.contactText : ''"></textarea>
        </label>
        <label v-if="s.type === 'about'" class="block">
          <span :class="label">Texto de "Sobre nosotros"</span>
          <textarea v-model="form.about" rows="7" maxlength="5000" :class="input" placeholder="Cuenta quiénes son y qué tipo de eventos hacen. Separa los párrafos con una línea en blanco."></textarea>
        </label>
        <p v-if="s.type === 'contact' && !contactFormEnabled" class="text-xs text-amber-700">El formulario de contacto está desactivado: esta sección no se muestra. Actívalo en "Mi sitio web".</p>
        <p v-if="s.type === 'events'" class="text-xs text-gray-500">Los eventos publicados aparecen solos, siempre al día.</p>
      </div>

      <!-- Fotos y videos -->
      <div v-if="s.type === 'hero'" class="space-y-3">
        <MediaField v-model="d.image_url" kind="hero" label="Imagen de la portada" :full="imagesFull" aspect="16 / 9" hint="Sin imagen se usa la de tu próximo evento." @error="(m) => emit('error', m)" />
        <VideoField v-model="d.video" label="Video de fondo (opcional)" hint="Se reproduce solo y sin sonido; reemplaza la imagen. Usa la portada con imagen de fondo o centrada." :full="videosFull" @error="(m) => emit('error', m)" />
      </div>
      <div v-else-if="s.type === 'feature'" class="space-y-3">
        <MediaField v-model="d.image_url" kind="feature" label="Foto" :full="imagesFull" @error="(m) => emit('error', m)" />
        <VideoField v-model="d.video" label="o un video (reemplaza la foto)" :full="videosFull" @error="(m) => emit('error', m)" />
        <div>
          <span :class="label">Foto a la</span>
          <div class="grid grid-cols-2 gap-1.5">
            <button type="button" class="rounded-lg border px-3 py-2 text-xs" :class="d.align !== 'right' ? 'border-violet-600 bg-violet-50 font-semibold' : 'border-gray-200'" @click="delete d.align">Izquierda</button>
            <button type="button" class="rounded-lg border px-3 py-2 text-xs" :class="d.align === 'right' ? 'border-violet-600 bg-violet-50 font-semibold' : 'border-gray-200'" @click="d.align = 'right'">Derecha</button>
          </div>
        </div>
      </div>
      <div v-else-if="s.type === 'video'" class="space-y-3">
        <VideoField v-model="d.video" label="Sube un video" :full="videosFull" hint="Se reproduce solo y sin sonido al aparecer, con controles para el sonido." @error="(m) => emit('error', m)" />
        <label v-if="!d.video" class="block">
          <span :class="label">o pega un enlace de YouTube o Vimeo</span>
          <input v-model="d.url" type="url" :class="input" placeholder="https://www.youtube.com/watch?v=…" />
        </label>
      </div>

      <!-- Botón -->
      <div v-if="['hero', 'feature', 'cta'].includes(s.type)" class="space-y-3 rounded-xl border border-gray-200 p-3">
        <p class="text-xs font-bold uppercase text-gray-500">Botón</p>
        <label class="block">
          <span :class="label">Texto del botón</span>
          <input v-model="d.button_label" type="text" :maxlength="max('button_label')" :class="input" :placeholder="s.type === 'feature' ? 'Sin botón' : 'Ver eventos'" />
        </label>
        <div v-if="supportsModal" class="grid grid-cols-2 gap-1.5">
          <button type="button" class="rounded-lg border px-3 py-2 text-xs" :class="d.button_action !== 'modal' ? 'border-violet-600 bg-violet-50 font-semibold' : 'border-gray-200'" @click="setAction('link')">Lleva a un enlace</button>
          <button type="button" class="rounded-lg border px-3 py-2 text-xs" :class="d.button_action === 'modal' ? 'border-violet-600 bg-violet-50 font-semibold' : 'border-gray-200'" @click="setAction('modal')">Abre una ventana</button>
        </div>
        <template v-if="d.button_action === 'modal' && supportsModal">
          <label class="block">
            <span :class="label">Título de la ventana</span>
            <input v-model="d.modal_title" type="text" :maxlength="max('modal_title')" :class="input" />
          </label>
          <label class="block">
            <span :class="label">Texto de la ventana</span>
            <textarea v-model="d.modal_text" rows="5" :maxlength="max('modal_text')" :class="input" placeholder="Condiciones, horarios, cómo reservar… Al final aparece un botón para escribirte."></textarea>
          </label>
          <button type="button" class="text-xs font-semibold text-violet-700 underline" @click="emit('open-dialog', `${s.id}-ventana`)">Ver la ventana en la vista previa</button>
        </template>
        <template v-else>
          <label class="block">
            <span :class="label">Lleva a</span>
            <select v-model="buttonTarget" :class="input">
              <option value="#eventos">Los eventos</option>
              <option value="contacto">El formulario de contacto</option>
              <option v-for="a in anchors" :key="a.value" :value="a.value">{{ a.label }}</option>
              <option value="url">Otro enlace</option>
            </select>
          </label>
          <input v-if="buttonTarget === 'url'" v-model="d.button_url" type="url" :class="input" placeholder="https://" aria-label="Enlace del botón" />
        </template>
      </div>

      <!-- Ítems -->
      <div v-if="hasItems" class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold uppercase text-gray-500">{{ ITEM_NOUN[s.type] }}s ({{ items.length }}/{{ maxItems }})</span>
        </div>
        <p v-if="s.type === 'testimonials'" class="text-xs text-gray-500">Usa opiniones reales: las vacías no se muestran.</p>
        <p v-if="s.type === 'people' || s.type === 'tabs' || s.type === 'faq'" class="text-xs text-gray-500">Lo que dejes incompleto no se muestra en tu sitio.</p>
        <div v-for="(item, i) in items" :key="i" class="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-gray-500">{{ i + 1 }}</span>
            <div class="flex items-center">
              <button type="button" class="p-1 text-gray-400 hover:text-black disabled:opacity-30" :disabled="i === 0" title="Subir" @click="moveItem(i, -1)"><ArrowUp size="14" /></button>
              <button type="button" class="p-1 text-gray-400 hover:text-black disabled:opacity-30" :disabled="i === items.length - 1" title="Bajar" @click="moveItem(i, 1)"><ArrowDown size="14" /></button>
              <button type="button" class="p-1 text-gray-400 hover:text-red-600" title="Quitar" @click="d.items.splice(i, 1)"><X size="14" /></button>
            </div>
          </div>
          <template v-for="field in ITEM_FIELDS[s.type]" :key="field.key">
            <textarea v-if="field.multiline" v-model="item[field.key]" :rows="field.rows || 2" :maxlength="max(field.key, true)" :placeholder="field.label" :aria-label="field.label" :class="input"></textarea>
            <input v-else v-model="item[field.key]" type="text" :maxlength="max(field.key, true)" :placeholder="field.label" :aria-label="field.label" :class="input" />
          </template>
          <MediaField
            v-if="s.type === 'people' || s.type === 'tabs'"
            v-model="item.image_url"
            :kind="s.type === 'people' ? 'person' : 'tab'"
            :label="s.type === 'people' ? 'Foto' : 'Foto (opcional)'"
            :full="imagesFull"
            :aspect="s.type === 'people' ? '4 / 5' : '4 / 3'"
            compact
            @error="(m) => emit('error', m)"
          />
          <input v-if="s.type === 'people'" v-model="item.link_url" type="url" placeholder="Instagram o sitio web (opcional)" aria-label="Enlace de la persona" :class="input" />
        </div>
        <button v-if="items.length < maxItems" type="button" class="inline-flex items-center gap-1 text-sm font-medium text-violet-700" @click="addItem"><Plus size="14" /> Agregar {{ ITEM_NOUN[s.type] }}</button>
      </div>

      <!-- Galería -->
      <div v-if="s.type === 'gallery'" class="space-y-2">
        <span class="text-xs font-bold uppercase text-gray-500">Fotos ({{ items.length }}/{{ maxItems }})</span>
        <div class="grid grid-cols-3 gap-2">
          <div v-for="(item, i) in items" :key="item.image_url + i" class="space-y-1">
            <div class="relative">
              <img :src="item.image_url" alt="" class="aspect-square w-full rounded-lg object-cover" :class="d.layout === 'logos' ? 'bg-white object-contain p-1' : ''" />
              <button type="button" class="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-gray-700 hover:text-red-600" title="Quitar" @click="d.items.splice(i, 1)"><X size="12" /></button>
              <div class="absolute bottom-1 left-1 flex gap-0.5">
                <button type="button" class="rounded bg-white/90 p-0.5 disabled:opacity-30" :disabled="i === 0" title="Antes" @click="moveItem(i, -1)"><ArrowUp size="11" class="-rotate-90" /></button>
                <button type="button" class="rounded bg-white/90 p-0.5 disabled:opacity-30" :disabled="i === items.length - 1" title="Después" @click="moveItem(i, 1)"><ArrowDown size="11" class="-rotate-90" /></button>
              </div>
            </div>
            <input v-model="item.caption" type="text" maxlength="140" :placeholder="d.layout === 'logos' ? 'Nombre de la marca' : 'Pie de foto'" aria-label="Pie de foto" class="w-full rounded border border-gray-300 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-violet-500" />
          </div>
        </div>
        <label
          v-if="items.length < maxItems"
          class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-gray-400 px-3 py-2 text-xs font-medium hover:bg-gray-50"
          :class="{ 'pointer-events-none opacity-50': imagesFull || galleryUploading }"
        >
          <Plus size="14" /> {{ galleryUploading ? 'Subiendo…' : imagesFull ? 'Límite de fotos del sitio alcanzado' : 'Agregar fotos' }}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple class="hidden" :disabled="imagesFull || galleryUploading" @change="addGalleryImages" />
        </label>
        <p class="text-[11px] text-gray-500">Puedes elegir varias a la vez. Se optimizan al subirlas.</p>
      </div>
    </div>
  </div>
</template>
