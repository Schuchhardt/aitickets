// Preparación de imágenes en el navegador antes de subirlas: las fotos de celular (4000+ px, 5-12 MB)
// se achican a un lado mayor de MAX_SIDE y se recomprimen como JPEG, así entran bajo el límite de 5 MB
// de las funciones y suben rápido con datos móviles. El servidor igual optimiza (src/lib/imageOptimize.ts).
// GIF (pueden ser animados) y PNG con transparencia se suben tal cual.

const MAX_SIDE = 2400;
const SKIP_BELOW_BYTES = 1.5 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Tamaño máximo del archivo original que se intenta achicar en el navegador. */
export const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    // imageOrientation: 'from-image' respeta la rotación EXIF de las fotos de celular
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file))
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')) }
    img.src = url
  })
}

function hasTransparency(ctx, w, h) {
  // Muestra una grilla de píxeles (rápido incluso en imágenes grandes)
  const data = ctx.getImageData(0, 0, w, h).data
  const step = Math.max(4, Math.floor((w * h) / 40000) * 4)
  for (let i = 3; i < data.length; i += step) if (data[i] < 250) return true
  return false
}

/**
 * Devuelve el archivo listo para subir (el mismo si no hace falta tocarlo).
 * Nunca lanza por no poder procesar: en ese caso devuelve el original y el servidor decide.
 */
export async function prepareImageForUpload(file) {
  if (!file || !file.type?.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bitmap = await loadBitmap(file)
    const width = bitmap.width
    const height = bitmap.height
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
    if (scale === 1 && file.size <= SKIP_BELOW_BYTES) {
      bitmap.close?.()
      return file
    }
    const w = Math.round(width * scale)
    const h = Math.round(height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    if (file.type === 'image/png' && hasTransparency(ctx, w, h)) {
      return file.size <= MAX_UPLOAD_BYTES ? file : (await toFile(canvas, 'image/png', undefined, file.name)) || file
    }
    const out = await toFile(canvas, 'image/jpeg', 0.88, file.name)
    return out && out.size < file.size ? out : file
  } catch {
    return file
  }
}

function toFile(canvas, type, quality, name) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(null)
      const ext = type === 'image/png' ? 'png' : 'jpg'
      resolve(new File([blob], String(name || 'imagen').replace(/\.[^.]+$/, '') + '.' + ext, { type }))
    }, type, quality)
  })
}
