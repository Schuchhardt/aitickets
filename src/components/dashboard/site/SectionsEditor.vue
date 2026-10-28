<script setup>
// Secciones de la página de inicio del sitio (src/lib/siteTemplates.ts): ordenar, ocultar, borrar, editar y agregar.
// Edita form.sections y form.about de SiteEditor directamente.
import { computed, ref } from 'vue'
import { ChevronDown, ChevronUp, ArrowUp, ArrowDown, Eye, EyeOff, Trash2, Plus, Sparkles, Upload, X } from 'lucide-vue-next'
import { SECTION_INFO, SECTION_TYPES, TEMPLATE_INFO, blankSection } from '../../../lib/siteTemplates'
import { uploadSiteImage } from './siteApi.js'

const props = defineProps({
  form: { type: Object, required: true },
  contactFormEnabled: { type: Boolean, default: true },
})
const emit = defineEmits(['ai', 'error'])

const sections = computed(() => props.form.sections)
const info = computed(() => TEMPLATE_INFO[props.form.template] || TEMPLATE_INFO.clasico)
const open = ref(null)
const adding = ref(false)

const ITEM_FIELDS = {
  highlights: [
    { key: 'title', label: 'Título', max: 80 },
    { key: 'text', label: 'Texto', max: 300, multiline: true },
  ],
  faq: [
    { key: 'question', label: 'Pregunta', max: 200 },
    { key: 'answer', label: 'Respuesta', max: 1500, multiline: true },
  ],
  testimonials: [
    { key: 'quote', label: 'Opinión', max: 500, multiline: true },
    { key: 'author', label: 'Quién lo dice', max: 100 },
  ],
}
const ADD_ITEM_LABEL = { highlights: 'Agregar punto', faq: 'Agregar pregunta', testimonials: 'Agregar opinión' }

const canAdd = (type) => !SECTION_INFO[type].single || !sections.value.some((s) => s.type === type)
const sectionLabel = (s) => s.data.title || (s.type === 'hero' ? props.form.title || 'Portada' : SECTION_INFO[s.type].name)

function move(index, delta) {
  const target = index + delta
  if (target < 0 || target >= sections.value.length) return
  const [item] = sections.value.splice(index, 1)
  sections.value.splice(target, 0, item)
}
function remove(index) {
  const s = sections.value[index]
  if (!window.confirm(`¿Quitar la sección "${sectionLabel(s)}"?`)) return
  sections.value.splice(index, 1)
}
function toggleHidden(s) {
  if (s.hidden) delete s.hidden
  else s.hidden = true
}
function add(type) {
  const section = blankSection(type, props.form.template)
  // Antes de "Contacto" si existe; si no, al final
  const contactIndex = sections.value.findIndex((s) => s.type === 'contact')
  if (contactIndex >= 0 && type !== 'contact') sections.value.splice(contactIndex, 0, section)
  else sections.value.push(section)
  open.value = section.id
  adding.value = false
}
function addItem(s) {
  const max = SECTION_INFO[s.type].maxItems || 6
  if (!s.data.items) s.data.items = []
  if (s.data.items.length >= max) return
  s.data.items.push(Object.fromEntries((ITEM_FIELDS[s.type] || []).map((f) => [f.key, ''])))
}
function moveItem(s, i, delta) {
  const t = i + delta
  if (t < 0 || t >= s.data.items.length) return
  const [item] = s.data.items.splice(i, 1)
  s.data.items.splice(t, 0, item)
}

const uploading = ref('')
async function uploadInto(event, s, kind) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  uploading.value = s.id
  try {
    const url = await uploadSiteImage(file, kind)
    if (s.type === 'gallery') {
      if (!s.data.items) s.data.items = []
      if (s.data.items.length < SECTION_INFO.gallery.maxItems) s.data.items.push({ image_url: url, caption: '' })
    } else {
      s.data.image_url = url
    }
  } catch (e) {
    emit('error', e.message)
  } finally {
    uploading.value = ''
  }
}
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 md:p-6 space-y-4">
    <div>
      <h3 class="font-bold">Secciones de la página</h3>
      <p class="text-sm text-gray-500">Ordénalas, ocúltalas o agrega nuevas. Los eventos se actualizan solos.</p>
    </div>

    <ol class="space-y-2">
      <li v-for="(s, index) in sections" :key="s.id" class="rounded-lg border" :class="open === s.id ? 'border-gray-400' : 'border-gray-200'">
        <div class="flex items-center gap-1 px-2 py-2">
          <div class="flex flex-col">
            <button type="button" class="p-0.5 text-gray-400 hover:text-black disabled:opacity-30" :disabled="index === 0" title="Subir" @click="move(index, -1)"><ArrowUp size="14" /></button>
            <button type="button" class="p-0.5 text-gray-400 hover:text-black disabled:opacity-30" :disabled="index === sections.length - 1" title="Bajar" @click="move(index, 1)"><ArrowDown size="14" /></button>
          </div>
          <button type="button" class="flex-1 min-w-0 text-left px-1" @click="open = open === s.id ? null : s.id">
            <span class="block text-xs font-bold uppercase text-gray-500">{{ SECTION_INFO[s.type].name }}</span>
            <span class="block text-sm truncate" :class="s.hidden ? 'text-gray-400 line-through' : 'text-gray-900'">{{ sectionLabel(s) }}</span>
          </button>
          <button type="button" class="p-1.5 text-gray-500 hover:text-black" title="Editar con IA" @click="emit('ai', s)"><Sparkles size="16" /></button>
          <button type="button" class="p-1.5 text-gray-500 hover:text-black" :title="s.hidden ? 'Mostrar' : 'Ocultar'" @click="toggleHidden(s)">
            <component :is="s.hidden ? EyeOff : Eye" size="16" />
          </button>
          <button v-if="s.type !== 'events'" type="button" class="p-1.5 text-gray-500 hover:text-red-600" title="Quitar" @click="remove(index)"><Trash2 size="16" /></button>
          <button type="button" class="p-1.5 text-gray-500 hover:text-black" :title="open === s.id ? 'Cerrar' : 'Editar'" @click="open = open === s.id ? null : s.id">
            <component :is="open === s.id ? ChevronUp : ChevronDown" size="16" />
          </button>
        </div>

        <div v-if="open === s.id" class="border-t border-gray-100 px-3 py-4 space-y-3">
          <div v-if="s.type !== 'cta' && s.type !== 'contact'" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Antetítulo</span>
              <input v-model="s.data.eyebrow" type="text" maxlength="60" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
            </label>
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Título</span>
              <input
                v-model="s.data.title"
                type="text"
                maxlength="120"
                :placeholder="s.type === 'hero' ? form.title || 'El nombre de tu productora' : s.type === 'events' ? info.copy.eventsTitle : ''"
                class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black"
              />
            </label>
          </div>
          <label v-else class="block">
            <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Título</span>
            <input v-model="s.data.title" type="text" maxlength="120" :placeholder="s.type === 'contact' ? info.copy.contactTitle : ''" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
          </label>

          <!-- Portada -->
          <template v-if="s.type === 'hero'">
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Frase</span>
              <textarea v-model="s.data.subtitle" rows="2" maxlength="300" :placeholder="form.tagline || 'Ej: Las mejores fiestas de Valparaíso desde 2015'" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black"></textarea>
            </label>
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Texto del botón</span>
              <input v-model="s.data.button_label" type="text" maxlength="40" placeholder="Ver eventos" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
            </label>
            <div class="flex items-center gap-3">
              <div class="h-14 w-20 shrink-0 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
                <img v-if="s.data.image_url || form.theme.hero_image_url" :src="s.data.image_url || form.theme.hero_image_url" alt="" class="h-full w-full object-cover" />
                <Upload v-else size="16" class="text-gray-400" />
              </div>
              <label class="text-xs px-3 py-1.5 rounded-lg border border-gray-300 cursor-pointer hover:bg-gray-50">
                {{ uploading === s.id ? 'Subiendo…' : 'Imagen de la portada' }}
                <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" :disabled="uploading === s.id" @change="uploadInto($event, s, 'hero')" />
              </label>
              <button v-if="s.data.image_url" type="button" class="text-xs text-gray-500 underline" @click="s.data.image_url = undefined">Quitar</button>
            </div>
            <p class="text-xs text-gray-500">Sin imagen se usa la imagen de portada de "Colores y tipografía" o la de tu próximo evento.</p>
          </template>

          <!-- Eventos -->
          <template v-else-if="s.type === 'events'">
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Texto (opcional)</span>
              <textarea v-model="s.data.text" rows="2" maxlength="300" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black"></textarea>
            </label>
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Cómo se muestran</span>
              <select v-model="s.data.layout" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white outline-none focus:ring-2 focus:ring-black">
                <option :value="undefined">Como la plantilla</option>
                <option value="cards">Tarjetas</option>
                <option value="posters">Afiches</option>
                <option value="list">Lista de fechas</option>
              </select>
            </label>
          </template>

          <!-- Sobre nosotros -->
          <label v-else-if="s.type === 'about'" class="block">
            <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Texto</span>
            <textarea v-model="form.about" rows="6" maxlength="5000" placeholder="Cuenta quiénes son y qué tipo de eventos hacen. Separa los párrafos con una línea en blanco." class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black"></textarea>
            <span v-if="!form.about.trim()" class="block text-xs text-gray-500 mt-1">Sin texto, la sección no se muestra.</span>
          </label>

          <!-- Destacados, preguntas, opiniones -->
          <template v-else-if="ITEM_FIELDS[s.type]">
            <div v-for="(item, i) in s.data.items || []" :key="i" class="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-gray-500">{{ i + 1 }}</span>
                <div class="flex items-center">
                  <button type="button" class="p-1 text-gray-400 hover:text-black disabled:opacity-30" :disabled="i === 0" title="Subir" @click="moveItem(s, i, -1)"><ArrowUp size="14" /></button>
                  <button type="button" class="p-1 text-gray-400 hover:text-black disabled:opacity-30" :disabled="i === s.data.items.length - 1" title="Bajar" @click="moveItem(s, i, 1)"><ArrowDown size="14" /></button>
                  <button type="button" class="p-1 text-gray-400 hover:text-red-600" title="Quitar" @click="s.data.items.splice(i, 1)"><X size="14" /></button>
                </div>
              </div>
              <template v-for="field in ITEM_FIELDS[s.type]" :key="field.key">
                <textarea v-if="field.multiline" v-model="item[field.key]" rows="2" :maxlength="field.max" :placeholder="field.label" :aria-label="field.label" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white outline-none focus:ring-2 focus:ring-black"></textarea>
                <input v-else v-model="item[field.key]" type="text" :maxlength="field.max" :placeholder="field.label" :aria-label="field.label" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white outline-none focus:ring-2 focus:ring-black" />
              </template>
            </div>
            <button
              v-if="(s.data.items || []).length < SECTION_INFO[s.type].maxItems"
              type="button"
              class="inline-flex items-center gap-1 text-sm text-gray-700 underline"
              @click="addItem(s)"
            ><Plus size="14" /> {{ ADD_ITEM_LABEL[s.type] }}</button>
            <p v-if="s.type === 'testimonials'" class="text-xs text-gray-500">Usa opiniones reales de tu público o de la prensa.</p>
          </template>

          <!-- Galería -->
          <template v-else-if="s.type === 'gallery'">
            <div class="grid grid-cols-3 gap-2">
              <div v-for="(item, i) in s.data.items || []" :key="item.image_url + i" class="space-y-1">
                <div class="relative">
                  <img :src="item.image_url" alt="" class="w-full aspect-square object-cover rounded-lg" />
                  <button type="button" class="absolute top-1 right-1 rounded-full bg-white/90 p-1 text-gray-700 hover:text-red-600" title="Quitar" @click="s.data.items.splice(i, 1)"><X size="12" /></button>
                </div>
                <input v-model="item.caption" type="text" maxlength="140" placeholder="Pie de foto" aria-label="Pie de foto" class="w-full px-2 py-1 text-xs rounded border border-gray-300 outline-none focus:ring-1 focus:ring-black" />
              </div>
            </div>
            <label v-if="(s.data.items || []).length < SECTION_INFO.gallery.maxItems" class="inline-flex text-xs px-3 py-1.5 rounded-lg border border-gray-300 cursor-pointer hover:bg-gray-50">
              {{ uploading === s.id ? 'Subiendo…' : 'Agregar foto' }}
              <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" :disabled="uploading === s.id" @change="uploadInto($event, s, 'gallery')" />
            </label>
          </template>

          <!-- Video -->
          <template v-else-if="s.type === 'video'">
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Enlace de YouTube o Vimeo</span>
              <input v-model="s.data.url" type="url" placeholder="https://www.youtube.com/watch?v=…" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
            </label>
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Texto (opcional)</span>
              <textarea v-model="s.data.text" rows="2" maxlength="600" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black"></textarea>
            </label>
          </template>

          <!-- Llamado a la acción -->
          <template v-else-if="s.type === 'cta'">
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Texto</span>
              <textarea v-model="s.data.text" rows="2" maxlength="400" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black"></textarea>
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="block">
                <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Texto del botón</span>
                <input v-model="s.data.button_label" type="text" maxlength="40" placeholder="Ver eventos" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
              </label>
              <label class="block">
                <span class="block text-xs font-bold text-gray-500 uppercase mb-1">El botón lleva a</span>
                <select
                  :value="['#eventos', 'contacto', undefined, ''].includes(s.data.button_url) ? s.data.button_url || '#eventos' : 'url'"
                  class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white outline-none focus:ring-2 focus:ring-black"
                  @change="s.data.button_url = $event.target.value === 'url' ? 'https://' : $event.target.value"
                >
                  <option value="#eventos">Los eventos</option>
                  <option value="contacto">El formulario de contacto</option>
                  <option value="url">Otro enlace</option>
                </select>
              </label>
            </div>
            <input
              v-if="s.data.button_url && !['#eventos', 'contacto'].includes(s.data.button_url)"
              v-model="s.data.button_url"
              type="url"
              placeholder="https://"
              aria-label="Enlace del botón"
              class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black"
            />
          </template>

          <!-- Contacto -->
          <template v-else-if="s.type === 'contact'">
            <label class="block">
              <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Texto</span>
              <textarea v-model="s.data.text" rows="2" maxlength="300" :placeholder="info.copy.contactText" class="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black"></textarea>
            </label>
            <p v-if="!contactFormEnabled" class="text-xs text-amber-700">El formulario de contacto está desactivado: esta sección no se muestra.</p>
          </template>
        </div>
      </li>
    </ol>

    <div class="relative">
      <button type="button" class="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-dashed border-gray-400 text-gray-700 hover:bg-gray-50 w-full justify-center" @click="adding = !adding">
        <Plus size="16" /> Agregar sección
      </button>
      <div v-if="adding" class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          v-for="type in SECTION_TYPES.filter(canAdd)"
          :key="type"
          type="button"
          class="text-left rounded-lg border border-gray-200 px-3 py-2 hover:border-gray-500"
          @click="add(type)"
        >
          <span class="block text-sm font-semibold">{{ SECTION_INFO[type].name }}</span>
          <span class="block text-xs text-gray-500">{{ SECTION_INFO[type].description }}</span>
        </button>
      </div>
    </div>
  </section>
</template>
