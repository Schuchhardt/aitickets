<script setup>
// Subir, cambiar o quitar un video del evento desde el panel (/api/events/video). `kind`:
//   cover    reemplaza la imagen de portada arriba de la página pública (Portada y Editar evento)
//   gallery  opcional, arriba de las fotos de la galería (Galería)
// El video se sube directo a Supabase Storage con una URL firmada (no cabe en las funciones), con barra de
// progreso, y el navegador saca un cuadro del video como póster. Se guarda al instante. Emite "change" con
// { video, image_url } (con kind cover, si el evento no tenía imagen, el póster pasa a ser su imagen).
import { onMounted, ref } from 'vue'
import { Film, Trash2 } from 'lucide-vue-next'
import { CANVA_REEL_URL } from '../../lib/socialPlatforms'

const props = defineProps({
  eventId: { type: Number, required: true },
  kind: { type: String, default: 'cover', validator: (v) => ['cover', 'gallery'].includes(v) },
  title: { type: String, default: '' },
  hint: { type: String, default: '' },
})
const emit = defineEmits(['change'])

const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
const loading = ref(true)
const video = ref(null)
const available = ref(true)
const maxBytes = ref(50 * 1024 * 1024)
const busy = ref('')
const progress = ref(0)
const error = ref('')
const notice = ref('')
const input = ref(null)
const mb = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`

const api = async (body) => {
  const res = await fetch('/api/events/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: props.eventId, slot: props.kind, ...body }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || 'Ocurrió un error')
  return data
}

async function load() {
  loading.value = true
  try {
    const res = await fetch(`/api/events/video?eventId=${props.eventId}&slot=${props.kind}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudo cargar el video')
    video.value = data.video || null
    available.value = data.available !== false
    if (data.max_bytes) maxBytes.value = data.max_bytes
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

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
  if (status === 413 || /maximum allowed size|too large/i.test(msg)) return `El video supera el máximo permitido (${mb(maxBytes.value)}).`
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
      if (e.lengthComputable) progress.value = Math.min(99, Math.round((e.loaded / e.total) * 100))
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
    fd.append('kind', props.kind === 'cover' ? 'cover' : 'gallery')
    const res = await fetch('/api/events/upload-image', { method: 'POST', body: fd })
    const data = await res.json().catch(() => ({}))
    return res.ok ? data.url : null
  } catch {
    return null
  }
}

async function upload(file) {
  error.value = ''
  notice.value = ''
  if (!file) return
  if (!VIDEO_TYPES.includes(file.type)) {
    error.value = 'Formato no soportado: usa MP4 (recomendado), WEBM o MOV.'
    return
  }
  if (file.size > maxBytes.value) {
    error.value = `El video pesa ${mb(file.size)}; el máximo es ${mb(maxBytes.value)}. Recórtalo o comprímelo (1080p y menos de 1 minuto suele bastar).`
    return
  }
  busy.value = 'upload'
  progress.value = 0
  try {
    const meta = await readVideoMeta(file)
    const { uploadUrl, publicUrl } = await api({ action: 'upload_url', contentType: file.type, size: file.size })
    await uploadToSignedUrl(uploadUrl, file)
    progress.value = 100
    const posterUrl = await uploadPoster(meta.poster)
    const data = await api({ action: 'set', url: publicUrl, poster_url: posterUrl, width: meta.width, height: meta.height, duration: meta.duration })
    video.value = data.video
    emit('change', { video: data.video, image_url: data.image_url ?? null })
    notice.value = meta.width
      ? 'Video listo. Se reproduce solo y sin sonido cuando aparece en pantalla.'
      : 'Video subido, pero este navegador no pudo leerlo: puede que no se vea en todos los dispositivos. Recomendamos MP4 (H.264).'
  } catch (e) {
    error.value = e.message || 'No se pudo subir el video.'
  } finally {
    busy.value = ''
  }
}

const onFile = (e) => {
  const file = e.target.files?.[0]
  upload(file).finally(() => { e.target.value = '' })
}

async function remove() {
  if (!confirm(props.kind === 'cover' ? '¿Quitar el video de portada? La página vuelve a mostrar la imagen.' : '¿Quitar el video de la galería?')) return
  busy.value = 'delete'
  error.value = ''
  notice.value = ''
  try {
    await api({ action: 'delete' })
    video.value = null
    emit('change', { video: null, image_url: null })
    notice.value = 'Video quitado.'
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-3" :data-testid="`event-video-uploader-${kind}`">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="font-semibold text-sm flex items-center gap-1.5"><Film size="16" /> {{ title || (kind === 'cover' ? 'Video de portada' : 'Video de la galería') }}</p>
        <p v-if="hint" class="text-xs text-gray-500 mt-0.5">{{ hint }}</p>
        <p class="text-xs text-gray-500 mt-0.5">
          ¿No tienes video? Arma uno vertical en
          <a :href="CANVA_REEL_URL" target="_blank" rel="noopener" class="underline" data-track="Hacer video en Canva">Canva</a>
          con el afiche (tiene plantillas gratis de reel), descárgalo en MP4 y súbelo aquí. También sirve para el reel de la difusión automática.
        </p>
      </div>
      <div v-if="video && available" class="flex gap-2">
        <button type="button" :disabled="!!busy" @click="input?.click()"
          class="px-3 py-1.5 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">Cambiar</button>
        <button type="button" :disabled="!!busy" @click="remove" title="Quitar video" aria-label="Quitar video"
          class="p-2 border border-gray-200 rounded-lg text-gray-600 hover:text-red-600 disabled:opacity-50"><Trash2 size="15" /></button>
      </div>
    </div>
    <input ref="input" type="file" accept="video/mp4,video/webm,video/quicktime" class="hidden" @change="onFile" />

    <p v-if="loading" class="text-sm text-gray-500">Cargando video...</p>
    <p v-else-if="!available" class="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">Los videos se están activando. Vuelve a intentarlo en unos minutos.</p>
    <template v-else>
      <video v-if="video && busy !== 'upload'" :key="video.url" :src="video.url" :poster="video.poster_url || undefined"
        controls muted playsinline preload="metadata" class="w-full max-h-80 rounded-lg bg-black"></video>
      <button v-else type="button" :disabled="!!busy" @click="input?.click()"
        class="w-full border-2 border-dashed border-gray-300 rounded-xl p-5 sm:p-6 flex flex-col items-center text-center transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-70 disabled:cursor-wait">
        <Film size="24" class="text-gray-400 mb-2" />
        <span class="font-medium text-gray-900 text-sm">{{ busy === 'upload' ? `Subiendo video... ${progress}%` : 'Subir un video' }}</span>
        <span class="text-xs text-gray-500 mt-1">MP4 (recomendado), WEBM o MOV · máx. {{ mb(maxBytes) }}</span>
      </button>
      <div v-if="busy === 'upload'" class="h-1.5 rounded-full bg-gray-100 overflow-hidden" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100" aria-label="Subida del video">
        <div class="h-full bg-black transition-all" :style="{ width: `${progress}%` }"></div>
      </div>
    </template>
    <p v-if="error" class="text-sm text-red-600" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="text-sm text-green-700" role="status">{{ notice }}</p>
  </div>
</template>
