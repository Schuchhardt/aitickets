// Llamadas del editor del sitio a /api/sites/* (mismo origen, cookies de sesión).
import { MAX_SOURCE_BYTES, MAX_UPLOAD_BYTES, prepareImageForUpload } from '../../../lib/clientImage.js'
import { VIDEO_TYPES, VIDEO_FORMAT_ERROR, formatMb, readVideoMeta, uploadToSignedUrl } from '../../../lib/clientVideo.js'
import { SITE_VIDEO_MAX_BYTES, SITE_VIDEO_MAX_SECONDS } from '../../../lib/siteTemplates'

export async function apiRequest(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok && res.status !== 202) {
    const err = new Error(data.message || 'Ocurrió un error. Intenta de nuevo.')
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/**
 * Sube una imagen a /api/sites/upload y devuelve su URL pública. Igual que las fotos del evento: las fotos de celular se
 * achican y recomprimen en el navegador (src/lib/clientImage.js) y el servidor las vuelve a optimizar.
 */
export async function uploadSiteImage(file, kind = 'banner') {
  if (!file) throw new Error('Selecciona una imagen.')
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Usa una imagen JPG, PNG, WEBP o GIF.')
  if (file.size > MAX_SOURCE_BYTES) throw new Error(`La imagen pesa ${formatMb(file.size)}; el máximo es ${formatMb(MAX_SOURCE_BYTES)}.`)
  const prepared = await prepareImageForUpload(file)
  if (prepared.size > MAX_UPLOAD_BYTES) throw new Error('La imagen no debe superar los 5 MB. Prueba con una más liviana.')
  const form = new FormData()
  form.append('file', prepared)
  form.append('kind', kind)
  const res = await fetch('/api/sites/upload', { method: 'POST', body: form, credentials: 'same-origin' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data.message || 'No se pudo subir la imagen.')
  return data.url
}

/**
 * Sube un video del sitio (mismas reglas que el video del evento): MP4/WEBM/MOV, máx. SITE_VIDEO_MAX_BYTES y
 * SITE_VIDEO_MAX_SECONDS. Va directo a Storage con una URL firmada y con un cuadro del video como póster.
 * Devuelve { url, poster_url, width, height, duration } para guardar en la sección.
 * @param {(percent: number) => void} [onProgress]
 */
export async function uploadSiteVideo(file, { onProgress } = {}) {
  if (!file) throw new Error('Selecciona un video.')
  if (!VIDEO_TYPES.includes(file.type)) throw new Error(VIDEO_FORMAT_ERROR)
  if (file.size > SITE_VIDEO_MAX_BYTES) {
    throw new Error(`El video pesa ${formatMb(file.size)}; el máximo es ${formatMb(SITE_VIDEO_MAX_BYTES)}. Recórtalo o comprímelo (1080p y menos de un minuto suele bastar).`)
  }
  const meta = await readVideoMeta(file)
  if (meta.duration && meta.duration > SITE_VIDEO_MAX_SECONDS) {
    throw new Error(`El video dura ${Math.round(meta.duration / 60)} min; el máximo es ${Math.round(SITE_VIDEO_MAX_SECONDS / 60)} min. Sube un fragmento más corto.`)
  }
  const { uploadUrl, publicUrl } = await apiRequest('/api/sites/video', {
    method: 'POST',
    body: { action: 'upload_url', contentType: file.type, size: file.size, duration: meta.duration },
  })
  await uploadToSignedUrl(uploadUrl, file, { onProgress, maxBytes: SITE_VIDEO_MAX_BYTES })
  await apiRequest('/api/sites/video', { method: 'POST', body: { action: 'confirm', url: publicUrl } })
  let poster_url = null
  if (meta.poster) {
    try {
      poster_url = await uploadSiteImage(new File([meta.poster], 'video-poster.jpg', { type: 'image/jpeg' }), 'poster')
    } catch {
      poster_url = null
    }
  }
  onProgress?.(100)
  const video = { url: publicUrl }
  if (poster_url) video.poster_url = poster_url
  if (meta.width) video.width = meta.width
  if (meta.height) video.height = meta.height
  if (meta.duration) video.duration = meta.duration
  return video
}

/** Avisa a la vista previa que el sitio cambió (la recarga SiteEditor). */
export function notifySiteUpdated() {
  window.dispatchEvent(new CustomEvent('aitickets:site-updated'))
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** HTML guardado → texto para el textarea (párrafos separados por línea en blanco). */
export function htmlToPlain(html) {
  if (!html) return ''
  const withBreaks = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h2|h3|li|blockquote)>\s*/gi, '\n\n')
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html')
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Texto del textarea → HTML simple (<p> y <br>); el servidor lo sanea igual. */
export function plainToHtml(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!clean) return ''
  return clean
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('')
}
