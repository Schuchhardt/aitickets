// set_event_video (API de productores / MCP): video de portada o de la galería desde una URL, y la lectura de tipo y
// metadatos por bytes (src/lib/videoProbe.ts). Sin red: fetch global simulado, Supabase falso con un storage mínimo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')
const { readMp4Meta, sniffVideoType } = await import('../../src/lib/videoProbe.ts')
const { VIDEO_BUCKET } = await import('../../src/lib/videoStorage.ts')

const STORAGE = 'https://x.supabase.co/storage/v1/object/public/'

// ---- MP4 mínimo: ftyp + moov (mvhd + trak/tkhd) + mdat ----
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]) }
const IDENTITY = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]
const ROTATE_90 = [0, 0x00010000, 0, 0xffff0000, 0, 0, 0, 0, 0x40000000]
function mp4({ width, height, seconds = 12, matrix = IDENTITY, brand = 'isom' }) {
  const mvhd = box('mvhd', u32(0), u32(0), u32(0), u32(1000), u32(seconds * 1000), Buffer.alloc(80))
  const tkhd = box('tkhd', u32(0), u32(0), u32(0), u32(1), u32(0), u32(seconds * 1000), Buffer.alloc(16),
    Buffer.concat(matrix.map(u32)), u32(width * 65536), u32(height * 65536))
  const audioTkhd = box('tkhd', u32(0), u32(0), u32(0), u32(2), u32(0), u32(seconds * 1000), Buffer.alloc(16), Buffer.concat(IDENTITY.map(u32)), u32(0), u32(0))
  return Buffer.concat([
    box('ftyp', Buffer.from(brand, 'latin1'), u32(0), Buffer.from('isommp42', 'latin1')),
    box('moov', mvhd, box('trak', audioTkhd), box('trak', tkhd)),
    box('mdat', Buffer.alloc(64, 7)),
  ])
}
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84]), Buffer.from('webm', 'latin1'), Buffer.alloc(40)])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

let uploads
let removed
let files

function seed(event = {}) {
  uploads = []
  removed = []
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Mi Productora' }],
      events: [{ id: 10, name: 'Fiesta', slug: 'fiesta-1', status: 'draft', organization_id: 7, image_url: null, cover_video: null, gallery_video: null, ...event }],
      aitickets_api_audit: [],
    },
    rpc: { aitickets_rate_limit_hit: () => true },
  })
  db.storage = {
    from: (bucket) => ({
      upload: async (name, buffer, opts) => {
        uploads.push({ bucket, name, bytes: buffer.length, contentType: opts.contentType })
        return { error: null }
      },
      getPublicUrl: (name) => ({ data: { publicUrl: `${STORAGE}${bucket}/${name}` } }),
      remove: async (paths) => { removed.push(...paths.map((p) => `${bucket}/${p}`)); return { data: [], error: null } },
    }),
  }
}

const ctx = () => ({
  supabase: db,
  actor: { keyId: 'k1', userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'ana@prod.cl', scopes: ['read', 'write'] },
  origin: 'https://aitickets.cl',
  requestUrl: new URL('https://aitickets.cl/api/mcp'),
  channel: 'mcp',
})
const run = (name, args) => runTool(getTool(name), args, ctx())

beforeEach(() => {
  seed()
  files = {
    'https://8.8.8.8/clip.mp4': mp4({ width: 1920, height: 1080, seconds: 21 }),
    'https://8.8.8.8/vertical.mp4': mp4({ width: 1920, height: 1080, matrix: ROTATE_90 }),
    'https://8.8.8.8/clip.webm': WEBM,
    'https://8.8.8.8/poster.jpg': JPG,
    'https://8.8.8.8/flyer.png': PNG,
  }
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    const url = String(input)
    if (url === 'https://8.8.8.8/huge.mp4') return new Response(Buffer.alloc(16), { status: 200, headers: { 'content-length': String(60 * 1024 * 1024) } })
    if (files[url]) return new Response(files[url], { status: 200 })
    return new Response('not found', { status: 404 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('videoProbe', () => {
  it('detecta el tipo por bytes y lee ancho, alto (rotado) y duración del MP4', () => {
    expect(sniffVideoType(files['https://8.8.8.8/clip.mp4'])).toBe('video/mp4')
    expect(sniffVideoType(mp4({ width: 1, height: 1, brand: 'qt  ' }))).toBe('video/quicktime')
    expect(sniffVideoType(mp4({ width: 1, height: 1, brand: 'M4A ' }))).toBeNull()
    expect(sniffVideoType(WEBM)).toBe('video/webm')
    expect(sniffVideoType(PNG)).toBeNull()
    expect(readMp4Meta(files['https://8.8.8.8/clip.mp4'])).toEqual({ width: 1920, height: 1080, duration: 21 })
    // Celular en vertical: 1920×1080 con rotación de 90° => 1080×1920
    expect(readMp4Meta(files['https://8.8.8.8/vertical.mp4'])).toMatchObject({ width: 1080, height: 1920 })
    expect(readMp4Meta(Buffer.from('basura que no es un mp4'))).toEqual({ width: null, height: null, duration: null })
  })
})

describe('set_event_video (MCP)', () => {
  it('portada desde una URL: copia el video a Storage, guarda dimensiones y, sin imagen, el póster pasa a ser la imagen', async () => {
    const out = await run('set_event_video', { event_id: 10, video_url: 'https://8.8.8.8/clip.mp4', poster_image_url: 'https://8.8.8.8/poster.jpg' })
    expect(out.ok).toBe(true)
    const videoUpload = uploads.find((u) => u.contentType === 'video/mp4')
    expect(videoUpload).toMatchObject({ bucket: VIDEO_BUCKET, name: expect.stringMatching(/^event-videos\/7\/10-.+\.mp4$/) })
    expect(out.result).toMatchObject({
      event_id: 10,
      slot: 'cover',
      video: { url: `${STORAGE}${VIDEO_BUCKET}/${videoUpload.name}`, width: 1920, height: 1080, duration: 21, mime: 'video/mp4' },
      image_note: expect.stringMatching(/póster/),
    })
    expect(out.result.video.poster_url).toMatch(/^https:\/\//)
    expect(out.result.image_url).toBe(out.result.video.poster_url)
    expect(db.tables.events[0]).toMatchObject({ image_url: out.result.video.poster_url, cover_video: { url: out.result.video.url }, gallery_video: null })
    expect(out.result.warnings).toBeUndefined()
  })

  it('video vertical de celular: dimensiones rotadas; con imagen de portada, la imagen no cambia', async () => {
    seed({ image_url: `${STORAGE}Events/event-covers/flyer.jpg` })
    const out = await run('set_event_video', { event_id: 10, video_url: 'https://8.8.8.8/vertical.mp4' })
    expect(out.result.video).toMatchObject({ width: 1080, height: 1920 })
    expect(out.result.image_url).toBe(`${STORAGE}Events/event-covers/flyer.jpg`)
    expect(out.result.warnings).toEqual([expect.stringMatching(/Sin póster/)])
  })

  it('galería con WebM: sin dimensiones (16:9) y sin tocar la imagen', async () => {
    const out = await run('set_event_video', { event_id: 10, slot: 'gallery', video_url: 'https://8.8.8.8/clip.webm' })
    expect(out.result).toMatchObject({ slot: 'gallery', video: { mime: 'video/webm', width: null, height: null }, image_url: null })
    expect(out.result.warnings).toContainEqual(expect.stringMatching(/16:9/))
    expect(db.tables.events[0]).toMatchObject({ cover_video: null, gallery_video: { mime: 'video/webm' }, image_url: null })
  })

  it('reemplazar la portada borra el video anterior; remove=true la quita', async () => {
    const old = `${STORAGE}${VIDEO_BUCKET}/event-videos/7/10-old.mp4`
    seed({ cover_video: { url: old, mime: 'video/mp4' } })
    await run('set_event_video', { event_id: 10, video_url: 'https://8.8.8.8/clip.mp4' })
    expect(removed).toEqual([`${VIDEO_BUCKET}/event-videos/7/10-old.mp4`])

    const current = db.tables.events[0].cover_video.url
    const out = await run('set_event_video', { event_id: 10, remove: true })
    expect(out.result).toMatchObject({ removed: true, video: null })
    expect(db.tables.events[0].cover_video).toBeNull()
    expect(removed).toContain(current.slice(STORAGE.length))
  })

  it('errores claros: no https, no es video (p. ej. una página o imagen), más de 50 MB, sin video_url, otro evento', async () => {
    const http = await run('set_event_video', { event_id: 10, video_url: 'http://8.8.8.8/clip.mp4' })
    expect(http).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(http.message).toMatch(/https/)
    const notVideo = await run('set_event_video', { event_id: 10, video_url: 'https://8.8.8.8/flyer.png' })
    expect(notVideo).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(notVideo.message).toMatch(/descarga directa/)
    const huge = await run('set_event_video', { event_id: 10, video_url: 'https://8.8.8.8/huge.mp4' })
    expect(huge).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(huge.message).toMatch(/50 MB/)
    expect(await run('set_event_video', { event_id: 10 })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await run('set_event_video', { event_id: 999, video_url: 'https://8.8.8.8/clip.mp4' })).toMatchObject({ ok: false, code: 'not_found' })
    expect(uploads).toEqual([])
    expect(db.tables.events[0].cover_video).toBeNull()
  })

  it('get_event muestra los videos del evento', async () => {
    await run('set_event_video', { event_id: 10, video_url: 'https://8.8.8.8/clip.mp4' })
    const out = await run('get_event', { event_id: 10 })
    expect(out.ok).toBe(true)
    expect(out.result).toMatchObject({ cover_video: { width: 1920, height: 1080, mime: 'video/mp4' }, gallery_video: null })
  })
})
