<script setup>
import { ref, reactive } from 'vue'
import { Image as ImageIcon, ArrowUp, ArrowDown, Trash2, Upload, Save } from 'lucide-vue-next'
import { apiRequest, uploadSiteImage, notifySiteUpdated } from './siteApi.js'

const props = defineProps({
  initialJson: { type: String, required: true },
})

const MAX_BANNERS = 10

// datetime-local (hora local del navegador) <-> ISO
const toLocalInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null)

const toEditable = (b) => ({ ...b, starts_local: toLocalInput(b.starts_at), ends_local: toLocalInput(b.ends_at) })

const banners = ref((JSON.parse(props.initialJson) || []).map(toEditable))
const busy = ref(false)
const message = ref('')
const isError = ref(false)

const draft = reactive({ image_url: '', link_url: '', alt: '', starts_local: '', ends_local: '' })
const uploadingDraft = ref(false)

function flash(text, error = false) {
  message.value = text
  isError.value = error
}

function applyList(data) {
  if (Array.isArray(data.banners)) banners.value = data.banners.map(toEditable)
  notifySiteUpdated()
}

async function onDraftFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  uploadingDraft.value = true
  try {
    draft.image_url = await uploadSiteImage(file, 'banner')
  } catch (e) {
    flash(e.message, true)
  } finally {
    uploadingDraft.value = false
  }
}

async function addBanner() {
  if (!draft.image_url) return flash('Primero sube una imagen.', true)
  busy.value = true
  try {
    const data = await apiRequest('/api/sites/banners', {
      method: 'POST',
      body: {
        image_url: draft.image_url,
        link_url: draft.link_url || null,
        alt: draft.alt || null,
        starts_at: fromLocalInput(draft.starts_local),
        ends_at: fromLocalInput(draft.ends_local),
      },
    })
    applyList(data)
    Object.assign(draft, { image_url: '', link_url: '', alt: '', starts_local: '', ends_local: '' })
    flash('Banner agregado.')
  } catch (e) {
    flash(e.message, true)
  } finally {
    busy.value = false
  }
}

async function saveBanner(b) {
  busy.value = true
  try {
    const data = await apiRequest('/api/sites/banners', {
      method: 'PUT',
      body: {
        id: b.id,
        image_url: b.image_url,
        link_url: b.link_url || null,
        alt: b.alt || null,
        starts_at: fromLocalInput(b.starts_local),
        ends_at: fromLocalInput(b.ends_local),
        active: b.active,
      },
    })
    applyList(data)
    flash('Banner guardado.')
  } catch (e) {
    flash(e.message, true)
  } finally {
    busy.value = false
  }
}

async function replaceImage(event, b) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  try {
    b.image_url = await uploadSiteImage(file, 'banner')
    await saveBanner(b)
  } catch (e) {
    flash(e.message, true)
  }
}

async function removeBanner(b) {
  if (!window.confirm('¿Eliminar este banner?')) return
  busy.value = true
  try {
    const data = await apiRequest(`/api/sites/banners?id=${b.id}`, { method: 'DELETE' })
    applyList(data)
    flash('Banner eliminado.')
  } catch (e) {
    flash(e.message, true)
  } finally {
    busy.value = false
  }
}

async function move(index, delta) {
  const target = index + delta
  if (target < 0 || target >= banners.value.length) return
  const order = banners.value.map((b) => b.id)
  ;[order[index], order[target]] = [order[target], order[index]]
  busy.value = true
  try {
    const data = await apiRequest('/api/sites/banners', { method: 'PATCH', body: { order } })
    applyList(data)
  } catch (e) {
    flash(e.message, true)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
    <div class="p-6 border-b border-gray-100">
      <h3 class="font-bold text-lg flex items-center gap-2"><ImageIcon size="18" /> Banners</h3>
      <p class="text-sm text-gray-500 mt-1">
        Imágenes destacadas en la portada de tu sitio (máx. {{ MAX_BANNERS }}). Puedes programar desde y hasta cuándo se muestran.
      </p>
    </div>

    <div class="p-6 space-y-4">
      <p v-if="message" class="text-sm" :class="isError ? 'text-red-600' : 'text-green-700'">{{ message }}</p>

      <ul v-if="banners.length" class="space-y-3">
        <li v-for="(b, i) in banners" :key="b.id" class="rounded-lg border border-gray-200 p-3 flex flex-col md:flex-row gap-3">
          <div class="md:w-40 shrink-0">
            <img :src="b.image_url" :alt="b.alt || ''" class="w-full h-24 object-cover rounded-md bg-gray-100" :class="{ 'opacity-40': !b.active }" />
            <label class="mt-2 block text-center text-xs px-2 py-1 rounded border border-gray-300 cursor-pointer hover:bg-gray-50">
              Cambiar imagen
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" @change="replaceImage($event, b)" />
            </label>
          </div>
          <div class="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input v-model="b.link_url" type="url" placeholder="Enlace (opcional)" class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
            <input v-model="b.alt" type="text" maxlength="150" placeholder="Texto alternativo" class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
            <label class="text-xs text-gray-500">Desde
              <input v-model="b.starts_local" type="datetime-local" class="mt-0.5 w-full px-2 py-1 text-sm rounded-lg border border-gray-300" />
            </label>
            <label class="text-xs text-gray-500">Hasta
              <input v-model="b.ends_local" type="datetime-local" class="mt-0.5 w-full px-2 py-1 text-sm rounded-lg border border-gray-300" />
            </label>
            <label class="flex items-center gap-2 text-sm text-gray-700">
              <input v-model="b.active" type="checkbox" class="rounded" /> Visible
            </label>
          </div>
          <div class="flex md:flex-col gap-1 justify-end">
            <button type="button" class="p-2 rounded hover:bg-gray-100 disabled:opacity-30" title="Subir" :disabled="busy || i === 0" @click="move(i, -1)"><ArrowUp size="16" /></button>
            <button type="button" class="p-2 rounded hover:bg-gray-100 disabled:opacity-30" title="Bajar" :disabled="busy || i === banners.length - 1" @click="move(i, 1)"><ArrowDown size="16" /></button>
            <button type="button" class="p-2 rounded hover:bg-gray-100" title="Guardar" :disabled="busy" @click="saveBanner(b)"><Save size="16" /></button>
            <button type="button" class="p-2 rounded text-red-600 hover:bg-red-50" title="Eliminar" :disabled="busy" @click="removeBanner(b)"><Trash2 size="16" /></button>
          </div>
        </li>
      </ul>
      <p v-else class="text-sm text-gray-500">Aún no tienes banners.</p>

      <div v-if="banners.length < MAX_BANNERS" class="rounded-lg border border-dashed border-gray-300 p-4 space-y-3">
        <p class="text-sm font-semibold">Nuevo banner</p>
        <div class="flex items-center gap-3">
          <div class="h-20 w-36 rounded-md bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center">
            <img v-if="draft.image_url" :src="draft.image_url" alt="" class="h-full w-full object-cover" />
            <Upload v-else size="18" class="text-gray-400" />
          </div>
          <label class="text-sm px-3 py-1.5 rounded-lg border border-gray-300 cursor-pointer hover:bg-gray-50">
            {{ uploadingDraft ? 'Subiendo…' : 'Subir imagen (recomendado 1600×600)' }}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" :disabled="uploadingDraft" @change="onDraftFile" />
          </label>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input v-model="draft.link_url" type="url" placeholder="Enlace (opcional), ej. a un evento" class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
          <input v-model="draft.alt" type="text" maxlength="150" placeholder="Texto alternativo (describe la imagen)" class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
          <label class="text-xs text-gray-500">Desde (opcional)
            <input v-model="draft.starts_local" type="datetime-local" class="mt-0.5 w-full px-2 py-1 text-sm rounded-lg border border-gray-300" />
          </label>
          <label class="text-xs text-gray-500">Hasta (opcional)
            <input v-model="draft.ends_local" type="datetime-local" class="mt-0.5 w-full px-2 py-1 text-sm rounded-lg border border-gray-300" />
          </label>
        </div>
        <button type="button" class="px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-40" :disabled="busy || !draft.image_url" @click="addBanner">
          Agregar banner
        </button>
      </div>
    </div>
  </section>
</template>
