<script setup>
// Galería del evento en el detalle del panel: subir varias fotos a la vez (se achican en el navegador y el
// servidor las optimiza), ordenarlas, ponerles leyenda y quitarlas. Se muestra al final de la página
// pública (EventGallery.vue). API: /api/events/upload-image (kind=gallery) y /api/events/gallery.
// Video de portada (uno por evento, arriba de las fotos): se sube directo a Storage con una URL firmada
// (los videos no caben en las funciones), con un póster sacado de un cuadro del video en el navegador.
import { computed, onMounted, ref } from 'vue'
import { Images, UploadCloud, Trash2, ChevronLeft, ChevronRight, Check, Film } from 'lucide-vue-next'
import { prepareImageForUpload, MAX_UPLOAD_BYTES, MAX_SOURCE_BYTES } from '../../lib/clientImage'

const props = defineProps({
  eventId: { type: Number, required: true },
  publicUrl: { type: String, default: '' },
})

const images = ref([])
const max = ref(40)
const loading = ref(true)
const busy = ref('')
const progress = ref({ done: 0, total: 0 })
const error = ref('')
const notice = ref('')
const captions = ref({})
const fileInput = ref(null)
const dragging = ref(false)

const remaining = computed(() => Math.max(0, max.value - images.value.length))

const api = async (body) => {
  const res = await fetch('/api/events/gallery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: props.eventId, ...body }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || 'Ocurrió un error')
  return data
}

const setImages = (list) => {
  images.value = list || []
  captions.value = Object.fromEntries(images.value.map((img) => [img.id, img.caption || '']))
}

async function load() {
  loading.value = true
  try {
    const res = await fetch(`/api/events/gallery?eventId=${props.eventId}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudo cargar la galería')
    setImages(data.images)
    if (data.max) max.value = data.max
    video.value = data.video || null
    videoAvailable.value = data.video_available !== false
    if (data.video_max_bytes) videoMaxBytes.value = data.video_max_bytes
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function uploadOne(file) {
  const prepared = await prepareImageForUpload(file)
  if (prepared.size > MAX_UPLOAD_BYTES) throw new Error(`"${file.name}" supera los 5MB incluso después de achicarla.`)
  const fd = new FormData()
  fd.append('file', prepared)
  fd.append('kind', 'gallery')
  const res = await fetch('/api/events/upload-image', { method: 'POST', body: fd })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `No se pudo subir "${file.name}"`)
  return { url: data.url, thumb_url: data.thumb_url, width: data.width, height: data.height }
}

async function addFiles(fileList) {
  error.value = ''
  notice.value = ''
  const files = Array.from(fileList || []).filter((f) => f.type?.startsWith('image/'))
  if (!files.length) { error.value = 'Solo se permiten imágenes.'; return }
  const tooBig = files.filter((f) => f.size > MAX_SOURCE_BYTES)
  const accepted = files.filter((f) => f.size <= MAX_SOURCE_BYTES).slice(0, remaining.value)
  if (!accepted.length) {
    error.value = remaining.value ? 'Las imágenes son demasiado pesadas (máx. 30MB cada una).' : `La galería ya tiene el máximo de ${max.value} imágenes.`
    return
  }

  busy.value = 'upload'
  progress.value = { done: 0, total: accepted.length }
  const uploaded = []
  const failures = []
  // De a 3 en paralelo: rápido sin saturar la conexión del celular
  const queue = [...accepted]
  const worker = async () => {
    while (queue.length) {
      const file = queue.shift()
      try { uploaded.push(await uploadOne(file)) } catch (e) { failures.push(e.message) }
      progress.value = { ...progress.value, done: progress.value.done + 1 }
    }
  }
  await Promise.all([worker(), worker(), worker()])

  try {
    if (uploaded.length) {
      const data = await api({ action: 'add', images: uploaded })
      setImages(data.images)
    }
    const skipped = files.length - accepted.length - tooBig.length
    const parts = []
    if (uploaded.length) parts.push(`${uploaded.length} ${uploaded.length === 1 ? 'imagen agregada' : 'imágenes agregadas'}.`)
    if (skipped > 0) parts.push(`${skipped} no se agregaron por el máximo de ${max.value}.`)
    if (tooBig.length) parts.push(`${tooBig.length} superan los 30MB.`)
    notice.value = parts.join(' ')
    if (failures.length) error.value = failures.slice(0, 3).join(' ')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = ''
  }
}

const onFiles = (e) => {
  const files = e.target.files
  addFiles(files).finally(() => { e.target.value = '' })
}
const onDrop = (e) => {
  dragging.value = false
  if (busy.value) return
  addFiles(e.dataTransfer?.files)
}

async function move(index, delta) {
  const target = index + delta
  if (target < 0 || target >= images.value.length || busy.value) return
  const previous = [...images.value]
  const list = [...images.value]
  ;[list[index], list[target]] = [list[target], list[index]]
  images.value = list
  busy.value = 'reorder'
  error.value = ''
  try {
    await api({ action: 'reorder', ids: list.map((img) => img.id) })
  } catch (e) {
    images.value = previous
    error.value = e.message
  } finally {
    busy.value = ''
  }
}

async function saveCaption(img) {
  const caption = (captions.value[img.id] || '').trim()
  if (caption === (img.caption || '')) return
  error.value = ''
  try {
    await api({ action: 'caption', id: img.id, caption })
    img.caption = caption || null
    notice.value = 'Leyenda guardada.'
  } catch (e) {
    error.value = e.message
  }
}

async function remove(img) {
  if (!confirm('¿Quitar esta imagen de la galería?')) return
  busy.value = 'delete'
  error.value = ''
  try {
    await api({ action: 'delete', id: img.id })
    setImages(images.value.filter((i) => i.id !== img.id))
    notice.value = 'Imagen quitada.'
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = ''
  }
}

// ---- Video de portada ----
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const video = ref(null)
const videoAvailable = ref(true)
const videoMaxBytes = ref(50 * 1024 * 1024)
const videoBusy = ref('')
const videoProgress = ref(0)
const videoError = ref('')
const videoNotice = ref('')
const videoInput = ref(null)
const mb = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`

/** Ancho, alto, duración y un cuadro como póster (JPEG). Si el navegador no puede leer el video, todo null. */
function readVideoMeta(file) {
  return new Promise((resolve) => {
    const src = URL.createObjectURL(file)
    const v = document.createElement('video')
    let done = false
    const finish = (poster) => {
      if (done) return
      done = true
      clearTimeout(timer)
      const meta = {
        width: v.videoWidth || null,
        height: v.videoHeight || null,
        duration: Number.isFinite(v.duration) ? Math.round(v.duration) : null,
        poster: poster || null,
      }
      v.removeAttribute('src')
      URL.revokeObjectURL(src)
      resolve(meta)
    }
    const timer = setTimeout(() => finish(null), 10000)
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.onerror = () => finish(null)
    v.onloadeddata = () => {
      try { v.currentTime = Math.min(1, (v.duration || 2) / 4) } catch { finish(null) }
    }
    v.onseeked = () => {
      try {
        const scale = Math.min(1, 1280 / (v.videoWidth || 1280))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(v.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(v.videoHeight * scale))
        canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => finish(blob), 'image/jpeg', 0.85)
      } catch {
        finish(null)
      }
    }
    v.src = src
  })
}

/** Mensaje claro a partir de la respuesta de Supabase Storage. */
function storageError(status, text) {
  let body = {}
  try { body = JSON.parse(text || '{}') } catch { /* sin JSON */ }
  const msg = String(body.message || body.error || '')
  if (status === 413 || /maximum allowed size|too large/i.test(msg)) return `El video supera el máximo permitido (${mb(videoMaxBytes.value)}).`
  if (/mime type|invalid_mime/i.test(msg)) return 'Formato no soportado: usa MP4 (recomendado), WEBM o MOV.'
  return `No se pudo subir el video${msg ? `: ${msg}` : ''}. Intenta de nuevo.`
}

/** PUT a la URL firmada con progreso (fetch no informa el avance de la subida). Mismo formato que supabase-js. */
function uploadToSignedUrl(url, file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) videoProgress.value = Math.min(99, Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(storageError(xhr.status, xhr.responseText))))
    xhr.onerror = () => reject(new Error('Se cortó la conexión mientras subía el video. Intenta de nuevo.'))
    const body = new FormData()
    body.append('cacheControl', '31536000')
    body.append('', file)
    xhr.send(body)
  })
}

async function uploadPoster(blob) {
  if (!blob) return null
  try {
    const fd = new FormData()
    fd.append('file', new File([blob], 'video-poster.jpg', { type: 'image/jpeg' }))
    fd.append('kind', 'gallery')
    const res = await fetch('/api/events/upload-image', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    return res.ok ? data.url : null
  } catch {
    return null
  }
}

async function uploadVideo(file) {
  videoError.value = ''
  videoNotice.value = ''
  if (!file) return
  if (!VIDEO_TYPES.includes(file.type)) {
    videoError.value = 'Formato no soportado: usa MP4 (recomendado), WEBM o MOV.'
    return
  }
  if (file.size > videoMaxBytes.value) {
    videoError.value = `El video pesa ${mb(file.size)}; el máximo es ${mb(videoMaxBytes.value)}. Recórtalo o comprímelo (1080p y menos de 1 minuto suele bastar).`
    return
  }
  videoBusy.value = 'upload'
  videoProgress.value = 0
  try {
    const meta = await readVideoMeta(file)
    const { uploadUrl, publicUrl } = await api({ action: 'video_upload_url', contentType: file.type, size: file.size })
    await uploadToSignedUrl(uploadUrl, file)
    videoProgress.value = 100
    const posterUrl = await uploadPoster(meta.poster)
    const data = await api({ action: 'video_set', url: publicUrl, poster_url: posterUrl, width: meta.width, height: meta.height, duration: meta.duration })
    video.value = data.video
    videoNotice.value = meta.width
      ? 'Video listo. Se reproduce solo y sin sonido cuando aparece en pantalla.'
      : 'Video subido, pero este navegador no pudo leerlo: puede que no se vea en todos los dispositivos. Recomendamos MP4 (H.264).'
  } catch (e) {
    videoError.value = e.message || 'No se pudo subir el video.'
  } finally {
    videoBusy.value = ''
  }
}

const onVideoFile = (e) => {
  const file = e.target.files?.[0]
  uploadVideo(file).finally(() => { e.target.value = '' })
}

async function removeVideo() {
  if (!confirm('¿Quitar el video de la galería?')) return
  videoBusy.value = 'delete'
  videoError.value = ''
  videoNotice.value = ''
  try {
    await api({ action: 'video_delete' })
    video.value = null
    videoNotice.value = 'Video quitado.'
  } catch (e) {
    videoError.value = e.message
  } finally {
    videoBusy.value = ''
  }
}

onMounted(load)
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" data-testid="event-gallery-manager">
    <div class="p-4 sm:p-6 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h3 class="font-bold text-lg flex items-center gap-2"><Images size="18" /> Galería</h3>
        <p class="text-sm text-gray-500">Un video de portada y fotos del lugar, line-up o ediciones anteriores. Se muestran al final de la página del evento.</p>
      </div>
      <button type="button" :disabled="!!busy || !remaining" @click="fileInput?.click()"
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
        <UploadCloud size="15" />
        {{ busy === 'upload' ? `Subiendo ${progress.done}/${progress.total}...` : 'Agregar fotos' }}
      </button>
      <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="onFiles" />
    </div>

    <!-- Video de portada (arriba de las fotos en la página pública) -->
    <div v-if="!loading" class="p-4 sm:p-6 border-b border-gray-100 space-y-3" data-testid="gallery-video-manager">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-semibold text-sm flex items-center gap-1.5"><Film size="16" /> Video de portada</p>
          <p class="text-xs text-gray-500 mt-0.5">Va arriba de las fotos. Se reproduce solo y sin sonido cuando aparece en pantalla; tu público activa el sonido con el ícono del parlante.</p>
        </div>
        <div v-if="video && videoAvailable" class="flex gap-2">
          <button type="button" :disabled="!!videoBusy" @click="videoInput?.click()"
            class="px-3 py-1.5 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cambiar</button>
          <button type="button" :disabled="!!videoBusy" @click="removeVideo" title="Quitar video"
            class="p-2 border border-gray-200 rounded-lg text-gray-600 hover:text-red-600 disabled:opacity-50"><Trash2 size="15" /></button>
        </div>
      </div>
      <input ref="videoInput" type="file" accept="video/mp4,video/webm,video/quicktime" class="hidden" @change="onVideoFile" />

      <p v-if="!videoAvailable" class="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">El video de portada se está activando. Vuelve a intentarlo en unos minutos.</p>
      <template v-else>
        <video v-if="video && videoBusy !== 'upload'" :key="video.url" :src="video.url" :poster="video.poster_url || undefined"
          controls muted playsinline preload="metadata" class="w-full max-h-80 rounded-lg bg-black"></video>
        <button v-else type="button" :disabled="!!videoBusy" @click="videoInput?.click()"
          class="w-full border-2 border-dashed border-gray-300 rounded-xl p-5 sm:p-6 flex flex-col items-center text-center transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-70 disabled:cursor-wait">
          <Film size="24" class="text-gray-400 mb-2" />
          <span class="font-medium text-gray-900 text-sm">{{ videoBusy === 'upload' ? `Subiendo video... ${videoProgress}%` : 'Subir un video' }}</span>
          <span class="text-xs text-gray-500 mt-1">MP4 (recomendado), WEBM o MOV · máx. {{ mb(videoMaxBytes) }}</span>
        </button>
        <div v-if="videoBusy === 'upload'" class="h-1.5 rounded-full bg-gray-100 overflow-hidden" role="progressbar" :aria-valuenow="videoProgress" aria-valuemin="0" aria-valuemax="100" aria-label="Subida del video">
          <div class="h-full bg-black transition-all" :style="{ width: `${videoProgress}%` }"></div>
        </div>
      </template>
      <p v-if="videoError" class="text-sm text-red-600" role="alert">{{ videoError }}</p>
      <p v-else-if="videoNotice" class="text-sm text-green-700" role="status">{{ videoNotice }}</p>
    </div>

    <div class="p-4 sm:p-6 space-y-4"
      @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="onDrop">
      <p v-if="loading" class="text-sm text-gray-500">Cargando galería...</p>

      <button v-else-if="!images.length" type="button" :disabled="!!busy" @click="fileInput?.click()"
        class="w-full border-2 border-dashed rounded-xl p-6 sm:p-10 flex flex-col items-center text-center transition disabled:opacity-60"
        :class="dragging ? 'border-black bg-gray-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'">
        <UploadCloud size="28" class="text-gray-400 mb-3" />
        <span class="font-medium text-gray-900">{{ busy === 'upload' ? `Subiendo ${progress.done}/${progress.total}...` : 'Arrastra fotos aquí o haz clic para elegirlas' }}</span>
        <span class="text-xs text-gray-500 mt-1">Puedes elegir varias a la vez (hasta {{ max }}). Se optimizan automáticamente.</span>
      </button>

      <template v-else>
        <ul class="grid grid-cols-2 sm:grid-cols-3 gap-3" :class="dragging ? 'ring-2 ring-black ring-offset-4 rounded-lg' : ''">
          <li v-for="(img, index) in images" :key="img.id" class="group rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
            <div class="relative aspect-square">
              <img :src="img.thumb_url || img.url" :alt="img.caption || `Foto ${index + 1}`" loading="lazy" decoding="async"
                class="w-full h-full object-cover" />
              <span class="absolute top-1.5 left-1.5 bg-black/60 text-white text-xs font-medium rounded px-1.5 py-0.5">{{ index + 1 }}</span>
              <button type="button" :disabled="!!busy" title="Quitar" @click="remove(img)"
                class="absolute top-1.5 right-1.5 p-1.5 bg-white/90 rounded-md text-gray-600 hover:text-red-600 disabled:opacity-50">
                <Trash2 size="15" />
              </button>
            </div>
            <div class="p-2 space-y-2">
              <div class="flex items-center gap-1">
                <input v-model="captions[img.id]" type="text" maxlength="200" placeholder="Leyenda (opcional)"
                  class="min-w-0 flex-1 px-2 py-1 text-xs rounded border border-gray-200 bg-white outline-none focus:ring-1 focus:ring-black"
                  @keydown.enter.prevent="saveCaption(img)" @blur="saveCaption(img)" />
                <Check v-if="(captions[img.id] || '') === (img.caption || '') && img.caption" size="14" class="text-green-600 shrink-0" />
              </div>
              <div class="flex justify-between">
                <button type="button" :disabled="!!busy || index === 0" title="Mover antes" @click="move(index, -1)"
                  class="p-1 rounded text-gray-500 hover:bg-gray-200 disabled:opacity-30"><ChevronLeft size="16" /></button>
                <button type="button" :disabled="!!busy || index === images.length - 1" title="Mover después" @click="move(index, 1)"
                  class="p-1 rounded text-gray-500 hover:bg-gray-200 disabled:opacity-30"><ChevronRight size="16" /></button>
              </div>
            </div>
          </li>
        </ul>
        <p class="text-xs text-gray-500">
          {{ images.length }} de {{ max }} imágenes.
          <a v-if="publicUrl" :href="`${publicUrl}#galeria`" target="_blank" rel="noopener" class="underline hover:text-black">Ver en la página</a>
        </p>
      </template>

      <p v-if="error" class="text-sm text-red-600" role="alert">{{ error }}</p>
      <p v-else-if="notice" class="text-sm text-green-700" role="status">{{ notice }}</p>
    </div>
  </section>
</template>
