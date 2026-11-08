// Videos en el navegador antes de subirlos directo a Supabase Storage (no caben en las funciones de Netlify).
// Lo usan el video del evento en el panel (EventVideoUploader.vue) y los videos de los asistentes en la galería de
// reseñas (EventReviews.vue). Solo navegador: usa <video>, <canvas> y XMLHttpRequest.

/** Tipos que aceptan las APIs de video (src/lib/eventVideo.ts, EVENT_VIDEO_TYPES). */
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
export const VIDEO_FORMAT_ERROR = 'Formato no soportado: usa MP4 (recomendado), WEBM o MOV.'

/** "50 MB" */
export const formatMb = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`

/**
 * Ancho, alto, duración (s) y un cuadro del video como póster (Blob JPEG, como máximo `posterMaxWidth` de ancho).
 * Si el navegador no puede leer el video (p. ej. HEVC en Chrome), todo null.
 * @returns {Promise<{ width: number | null, height: number | null, duration: number | null, poster: Blob | null }>}
 */
export function readVideoMeta(file, { posterMaxWidth = 1280, timeoutMs = 10000 } = {}) {
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
    const timer = setTimeout(() => finish(null), timeoutMs)
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.onerror = () => finish(null)
    v.onloadeddata = () => {
      try {
        v.currentTime = Math.min(1, (v.duration || 2) / 4)
      } catch {
        finish(null)
      }
    }
    v.onseeked = () => {
      try {
        const scale = Math.min(1, posterMaxWidth / (v.videoWidth || posterMaxWidth))
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
export function storageUploadError(status, text, maxBytes) {
  let body = {}
  try {
    body = JSON.parse(text || '{}')
  } catch {
    /* sin JSON */
  }
  const msg = String(body.message || body.error || '')
  if (status === 413 || /maximum allowed size|too large/i.test(msg)) return `El video supera el máximo permitido${maxBytes ? ` (${formatMb(maxBytes)})` : ''}.`
  if (/mime type|invalid_mime/i.test(msg)) return VIDEO_FORMAT_ERROR
  return `No se pudo subir el video${msg ? `: ${msg}` : ''}. Intenta de nuevo.`
}

/**
 * PUT a una URL firmada de Storage con progreso (fetch no informa el avance de la subida). Mismo formato que supabase-js.
 * @param {(percent: number) => void} [onProgress] 0-99 mientras sube
 */
export function uploadToSignedUrl(url, file, { onProgress, maxBytes } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)))
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(storageUploadError(xhr.status, xhr.responseText, maxBytes))))
    xhr.onerror = () => reject(new Error('Se cortó la conexión mientras subía el video. Intenta de nuevo.'))
    const body = new FormData()
    body.append('cacheControl', '31536000')
    body.append('', file)
    xhr.send(body)
  })
}
