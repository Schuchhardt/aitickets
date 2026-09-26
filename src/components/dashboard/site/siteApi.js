// Llamadas del editor del sitio a /api/sites/* (mismo origen, cookies de sesión).

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

/** Sube una imagen a /api/sites/upload y devuelve su URL pública. */
export async function uploadSiteImage(file, kind = 'banner') {
  if (!file) throw new Error('Selecciona una imagen.')
  if (file.size > 5 * 1024 * 1024) throw new Error('La imagen no debe superar los 5MB.')
  const form = new FormData()
  form.append('file', file)
  form.append('kind', kind)
  const res = await fetch('/api/sites/upload', { method: 'POST', body: form, credentials: 'same-origin' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data.message || 'No se pudo subir la imagen.')
  return data.url
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
