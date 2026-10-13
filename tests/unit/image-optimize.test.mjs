// Optimización de imágenes subidas y render de la imagen para compartir (src/lib/imageOptimize.ts),
// URL versionada de og:image (src/lib/ogImage.ts) y validación de la galería (src/lib/eventGallery.ts).
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  OG_HEIGHT,
  OG_MAX_BYTES,
  OG_WIDTH,
  makeThumbnail,
  optimizeImage,
  renderOgImage,
  sniffImageType,
} from '../../src/lib/imageOptimize'
import { eventOgImagePath, ogImageVersion } from '../../src/lib/ogImage'
import { normalizeCaption, normalizeGalleryInput } from '../../src/lib/eventGallery'

// Imagen con ruido (no comprime trivialmente, como una foto real)
async function noisyImage(width, height, { alpha = false, format = 'png' } = {}) {
  const channels = alpha ? 4 : 3
  const raw = Buffer.alloc(width * height * channels)
  // Degradado + ruido pseudoaleatorio (LCG con semilla fija)
  let seed = 42
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    raw[i] = ((Math.floor(i / channels) % width) * 200 / width + (seed >>> 26)) & 0xff
  }
  if (alpha) for (let i = 3; i < raw.length; i += 8) raw[i] = 0
  return sharp(raw, { raw: { width, height, channels } })[format]().toBuffer()
}

describe('optimizeImage', () => {
  it('achica al lado mayor indicado, pasa a JPEG y quita metadatos', async () => {
    const input = await sharp(await noisyImage(3000, 2000)).withMetadata({ exif: { IFD0: { Copyright: 'x' } } }).png().toBuffer()
    const out = await optimizeImage(input, 'image/png', { maxSize: 2000 })
    expect(out.optimized).toBe(true)
    expect(out.contentType).toBe('image/jpeg')
    expect(out.ext).toBe('jpg')
    expect([out.width, out.height]).toEqual([2000, 1333])
    expect(out.buffer.length).toBeLessThan(input.length)
    const meta = await sharp(out.buffer).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.exif).toBeUndefined()
  })

  it('mantiene PNG cuando hay transparencia real', async () => {
    const input = await noisyImage(400, 300, { alpha: true })
    const out = await optimizeImage(input, 'image/png')
    expect(out.contentType).toBe('image/png')
    expect((await sharp(out.buffer).metadata()).hasAlpha).toBe(true)
  })

  it('aplica la orientación EXIF (foto de celular girada)', async () => {
    const input = await sharp(await noisyImage(400, 200)).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const out = await optimizeImage(input, 'image/jpeg', { maxSize: 4000 })
    expect([out.width, out.height]).toEqual([200, 400])
  })

  it('deja los GIF animados tal cual', async () => {
    const frame = (background) => sharp({ create: { width: 20, height: 20, channels: 3, background } }).png().toBuffer()
    const gif = await sharp([await frame('#f00'), await frame('#00f')], { join: { animated: true } }).gif().toBuffer()
    expect((await sharp(gif, { animated: true }).metadata()).pages).toBe(2)
    const out = await optimizeImage(gif, 'image/gif')
    expect(out.optimized).toBe(false)
    expect(out.buffer).toBe(gif)
  })

  it('con un archivo ilegible devuelve el original', async () => {
    const junk = Buffer.from('no soy una imagen')
    const out = await optimizeImage(junk, 'image/jpeg')
    expect(out.optimized).toBe(false)
    expect(out.buffer).toBe(junk)
  })
})

describe('renderOgImage', () => {
  it('flyer vertical => 1200×630 JPEG bajo 300 KB', async () => {
    const out = await renderOgImage(await noisyImage(1080, 1350))
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    expect([meta.width, meta.height]).toEqual([OG_WIDTH, OG_HEIGHT])
    expect(out.length).toBeLessThanOrEqual(OG_MAX_BYTES)
  })

  it('imagen apaisada grande => 1200×630 bajo 300 KB', async () => {
    const out = await renderOgImage(await noisyImage(3000, 1600, { format: 'jpeg' }))
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([OG_WIDTH, OG_HEIGHT])
    expect(out.length).toBeLessThanOrEqual(OG_MAX_BYTES)
  })

  it('null si la imagen no se puede leer', async () => {
    expect(await renderOgImage(Buffer.from('nada'))).toBeNull()
  })
})

describe('makeThumbnail', () => {
  it('miniatura WebP de 640 px de ancho', async () => {
    const thumb = await makeThumbnail(await noisyImage(2000, 1500))
    expect(thumb.width).toBe(640)
    expect((await sharp(thumb.buffer).metadata()).format).toBe('webp')
  })
})

describe('sniffImageType', () => {
  it('reconoce los formatos por sus bytes', async () => {
    expect(sniffImageType(await noisyImage(4, 4, { format: 'jpeg' }))).toBe('image/jpeg')
    expect(sniffImageType(await noisyImage(4, 4))).toBe('image/png')
    expect(sniffImageType(await noisyImage(4, 4, { format: 'webp' }))).toBe('image/webp')
    expect(sniffImageType(Buffer.from('<svg></svg>'))).toBeNull()
  })
})

describe('eventOgImagePath', () => {
  it('versiona la URL con la portada', () => {
    const a = eventOgImagePath(12, 'https://x.supabase.co/a.jpg')
    const b = eventOgImagePath(12, 'https://x.supabase.co/b.jpg')
    expect(a).toMatch(/^\/og\/eventos\/12\.jpg\?v=[0-9a-f]{16}$/)
    expect(a).not.toBe(b)
    expect(a).toBe(`/og/eventos/12.jpg?v=${ogImageVersion('https://x.supabase.co/a.jpg')}`)
  })

  it('null sin portada https o con id inválido', () => {
    expect(eventOgImagePath(12, null)).toBeNull()
    expect(eventOgImagePath(12, '/local.png')).toBeNull()
    expect(eventOgImagePath('abc', 'https://x/a.jpg')).toBeNull()
  })
})

describe('galería: validación', () => {
  const base = 'https://ref.supabase.co/storage/v1/object/public/Events/'

  it('acepta solo URLs del bucket propio', () => {
    expect(normalizeGalleryInput({ url: `${base}event-gallery/1-a.jpg`, thumb_url: `${base}event-gallery/1-a-thumb.webp`, width: 2000, height: 1333, caption: '  Hola\n mundo ' }, base))
      .toEqual({ url: `${base}event-gallery/1-a.jpg`, thumb_url: `${base}event-gallery/1-a-thumb.webp`, width: 2000, height: 1333, caption: 'Hola mundo' })
    expect(normalizeGalleryInput({ url: 'https://evil.example/a.jpg' }, base)).toBeNull()
    expect(normalizeGalleryInput({ url: `${base}../../secret` }, base)).toBeNull()
    expect(normalizeGalleryInput({ url: `${base}a.jpg`, thumb_url: 'https://evil.example/t.webp', width: -1, height: 'x' }, base))
      .toEqual({ url: `${base}a.jpg`, thumb_url: null, width: null, height: null, caption: null })
  })

  it('leyenda recortada a 200 caracteres', () => {
    expect(normalizeCaption('a'.repeat(300))).toHaveLength(200)
    expect(normalizeCaption('   ')).toBeNull()
    expect(normalizeCaption(42)).toBeNull()
  })
})
