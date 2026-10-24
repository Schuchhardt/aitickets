// Videos del evento: /api/events/video (slot cover = portada en lugar de la imagen; gallery = opcional arriba de
// las fotos), rutas propias del evento en Storage (src/lib/videoStorage.ts) y la forma pública (normalizeEventVideo).
import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session
let storage

const STORAGE = 'https://ref.supabase.co/storage/v1/object/public/'

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))
vi.mock('../../src/lib/supabaseServer', () => ({
  EVENT_MANAGER_ROLES: ['admin', 'producer', 'editor'],
  getSessionContext: async () => session,
  hasRole: (u, roles) => roles.includes(u?.role),
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  getOwnedEvent: async (eventId, orgId) => (db.tables.events || []).find((e) => String(e.id) === String(eventId) && e.organization_id === orgId) || null,
}))

const api = await import('../../src/pages/api/events/video.ts')
const { normalizeEventVideo, EVENT_VIDEO_MAX_BYTES } = await import('../../src/lib/eventVideo.ts')
const { ownVideoLocation, VIDEO_BUCKET } = await import('../../src/lib/videoStorage.ts')

const post = (body) => api.POST({
  request: new Request('https://example.test/api/events/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
})
const get = (eventId, slot) => api.GET({ request: new Request(`https://example.test/api/events/video?eventId=${eventId}&slot=${slot}`) })

/**
 * Storage falso: buckets existentes, archivos subidos { 'bucket/path': { contentType, size } } y registro de borrados.
 * Sin el bucket de videos, createSignedUploadUrl responde "Bucket not found" (como Supabase).
 */
function fakeStorage({ buckets = [VIDEO_BUCKET, 'Events'], files = {} } = {}) {
  const removed = []
  return {
    files,
    removed,
    from: (bucket) => ({
      getPublicUrl: (p) => ({ data: { publicUrl: `${STORAGE}${bucket}/${p}` } }),
      createSignedUploadUrl: async (p) => buckets.includes(bucket)
        ? { data: { signedUrl: `https://ref.supabase.co/storage/v1/object/upload/sign/${bucket}/${p}?token=t`, token: 't', path: p }, error: null }
        : { data: null, error: { message: 'Bucket not found', statusCode: '404' } },
      info: async (p) => files[`${bucket}/${p}`] ? { data: files[`${bucket}/${p}`], error: null } : { data: null, error: { message: 'Object not found' } },
      remove: async (paths) => { removed.push(...paths.map((p) => `${bucket}/${p}`)); return { data: [], error: null } },
    }),
  }
}

function setup({ role = 'producer', cover_video = null, gallery_video = null, image_url = null, buckets } = {}) {
  session = { dbUser: { id: 1, organization_id: 7, role } }
  db = createFakeSupabase({
    tables: {
      events: [
        { id: 3, organization_id: 7, status: 'published', image_url, cover_video, gallery_video },
        { id: 9, organization_id: 8, status: 'published', image_url: null, cover_video: null, gallery_video: null },
      ],
    },
  })
  storage = fakeStorage({ buckets })
  db.storage = storage
}

const videoUrl = (path, bucket = VIDEO_BUCKET) => `${STORAGE}${bucket}/${path}`
const POSTER = `${STORAGE}Events/event-covers/7-poster.jpg`
const upload = (path, file = { contentType: 'video/mp4', size: 5_000_000 }) => { storage.files[`${VIDEO_BUCKET}/${path}`] = file }

describe('/api/events/video', () => {
  it('pide la URL firmada en el bucket de videos, en la carpeta del evento y la organización', async () => {
    setup()
    const res = await post({ eventId: 3, slot: 'cover', action: 'upload_url', contentType: 'video/mp4', size: 12 * 1024 * 1024 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.uploadUrl).toMatch(new RegExp(`/upload/sign/${VIDEO_BUCKET}/event-videos/7/3-.+\\.mp4\\?token=`))
    expect(body.publicUrl).toMatch(new RegExp(`^${STORAGE}${VIDEO_BUCKET}/event-videos/7/3-.+\\.mp4$`))
  })

  it('sin el bucket de videos usa el bucket Events', async () => {
    setup({ buckets: ['Events'] })
    const body = await (await post({ eventId: 3, slot: 'gallery', action: 'upload_url', contentType: 'video/webm', size: 1000 })).json()
    expect(body.publicUrl).toMatch(new RegExp(`^${STORAGE}Events/event-videos/7/3-.+\\.webm$`))
  })

  it('rechaza slot inválido, formatos no soportados, archivos sobre el máximo, otra organización y validadores', async () => {
    setup()
    expect((await post({ eventId: 3, slot: 'hero', action: 'upload_url', contentType: 'video/mp4', size: 1000 })).status).toBe(400)
    expect((await post({ eventId: 3, slot: 'cover', action: 'upload_url', contentType: 'video/x-msvideo', size: 1000 })).status).toBe(400)
    expect((await post({ eventId: 3, slot: 'cover', action: 'upload_url', contentType: 'video/mp4', size: EVENT_VIDEO_MAX_BYTES + 1 })).status).toBe(400)
    expect((await post({ eventId: 9, slot: 'cover', action: 'upload_url', contentType: 'video/mp4', size: 1000 })).status).toBe(404)
    setup({ role: 'validator' })
    expect((await post({ eventId: 3, slot: 'cover', action: 'upload_url', contentType: 'video/mp4', size: 1000 })).status).toBe(403)
  })

  it('set de portada: verifica el archivo, guarda el video, borra el anterior y, sin imagen, usa el póster como imagen', async () => {
    const previous = videoUrl('event-videos/7/3-old.mp4')
    setup({ cover_video: { url: previous, mime: 'video/mp4' } })
    const path = 'event-videos/7/3-new.mp4'
    upload(path)
    const res = await post({ eventId: 3, slot: 'cover', action: 'set', url: videoUrl(path), poster_url: POSTER, width: 1080, height: 1920, duration: 14.6 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      video: { url: videoUrl(path), poster_url: POSTER, width: 1080, height: 1920, duration: 15, mime: 'video/mp4' },
      image_url: POSTER,
    })
    expect(db.tables.events[0]).toMatchObject({ image_url: POSTER, cover_video: { url: videoUrl(path), bytes: 5_000_000 }, gallery_video: null })
    expect(storage.removed).toEqual([`${VIDEO_BUCKET}/event-videos/7/3-old.mp4`])
  })

  it('set de portada con imagen: la imagen no cambia; set de galería nunca toca la imagen', async () => {
    const image = `${STORAGE}Events/event-covers/7-flyer.jpg`
    setup({ image_url: image })
    upload('event-videos/7/3-a.mp4')
    const body = await (await post({ eventId: 3, slot: 'cover', action: 'set', url: videoUrl('event-videos/7/3-a.mp4'), poster_url: POSTER })).json()
    expect(body.image_url).toBe(image)
    expect(db.tables.events[0].image_url).toBe(image)

    setup()
    upload('event-videos/7/3-g.mp4')
    await post({ eventId: 3, slot: 'gallery', action: 'set', url: videoUrl('event-videos/7/3-g.mp4'), poster_url: POSTER })
    expect(db.tables.events[0]).toMatchObject({ image_url: null, cover_video: null, gallery_video: { url: videoUrl('event-videos/7/3-g.mp4') } })
  })

  it('set rechaza URLs de otro evento, de afuera, sin archivo o que no son video', async () => {
    setup()
    upload('event-videos/7/4-x.mp4', { contentType: 'video/mp4', size: 10 })
    expect((await post({ eventId: 3, slot: 'cover', action: 'set', url: videoUrl('event-videos/7/4-x.mp4') })).status).toBe(400)
    expect((await post({ eventId: 3, slot: 'cover', action: 'set', url: 'https://evil.example/event-videos/7/3-x.mp4' })).status).toBe(400)
    expect((await post({ eventId: 3, slot: 'cover', action: 'set', url: videoUrl('event-videos/7/3-missing.mp4') })).status).toBe(400)
    upload('event-videos/7/3-page.mp4', { contentType: 'text/html', size: 10 })
    const res = await post({ eventId: 3, slot: 'cover', action: 'set', url: videoUrl('event-videos/7/3-page.mp4') })
    expect(res.status).toBe(400)
    expect(storage.removed).toEqual([`${VIDEO_BUCKET}/event-videos/7/3-page.mp4`])
    expect(db.tables.events[0].cover_video).toBeNull()
  })

  it('un póster de otro dominio se descarta (y no pasa a ser la imagen)', async () => {
    setup()
    upload('event-videos/7/3-a.mp4')
    const body = await (await post({ eventId: 3, slot: 'cover', action: 'set', url: videoUrl('event-videos/7/3-a.mp4'), poster_url: 'https://evil.example/p.jpg' })).json()
    expect(body.video.poster_url).toBeNull()
    expect(db.tables.events[0].image_url).toBeNull()
  })

  it('GET devuelve el video del slot y delete lo quita (y borra el archivo) sin tocar el otro', async () => {
    const cover = videoUrl('event-videos/7/3-c.mp4')
    const gallery = videoUrl('event-videos/7/3-g.mp4')
    setup({ cover_video: { url: cover, mime: 'video/mp4', width: 1920, height: 1080 }, gallery_video: { url: gallery, mime: 'video/mp4' } })
    expect(await (await get(3, 'cover')).json()).toMatchObject({ video: { url: cover, width: 1920, height: 1080 }, available: true, max_bytes: EVENT_VIDEO_MAX_BYTES })
    expect((await (await get(3, 'gallery')).json()).video.url).toBe(gallery)
    expect((await post({ eventId: 3, slot: 'cover', action: 'delete' })).status).toBe(200)
    expect(db.tables.events[0]).toMatchObject({ cover_video: null, gallery_video: { url: gallery } })
    expect(storage.removed).toEqual([`${VIDEO_BUCKET}/event-videos/7/3-c.mp4`])
  })

  it('sin las columnas de video (deploy preview sin migrar): GET sin video y acciones 503', async () => {
    setup()
    db.failOn('events', 'select', { code: '42703', message: 'column events.cover_video does not exist' }, { once: false })
    expect(await (await get(3, 'cover')).json()).toMatchObject({ video: null, available: false })
    expect((await post({ eventId: 3, slot: 'cover', action: 'upload_url', contentType: 'video/mp4', size: 1000 })).status).toBe(503)
    expect((await post({ eventId: 3, slot: 'cover', action: 'delete' })).status).toBe(503)
  })
})

describe('normalizeEventVideo / ownVideoLocation', () => {
  it('forma pública: solo https y campos válidos', () => {
    expect(normalizeEventVideo(null)).toBeNull()
    expect(normalizeEventVideo({ url: 'http://x.test/a.mp4' })).toBeNull()
    expect(normalizeEventVideo({ url: 'https://x.test/a.mp4', width: -1, mime: 'text/html', duration: 'x', poster_url: 'javascript:alert(1)' }))
      .toEqual({ url: 'https://x.test/a.mp4', poster_url: null, width: null, height: null, duration: null, mime: null })
  })

  it('solo acepta rutas del evento y la organización, sin "..", con extensión de video', () => {
    setup()
    expect(ownVideoLocation(videoUrl('event-videos/7/3-a.mp4'), 7, 3)).toEqual({ bucket: VIDEO_BUCKET, path: 'event-videos/7/3-a.mp4' })
    expect(ownVideoLocation(videoUrl('event-videos/7/3-a.mov', 'Events'), 7, 3)).toEqual({ bucket: 'Events', path: 'event-videos/7/3-a.mov' })
    expect(ownVideoLocation(videoUrl('event-videos/7/31-a.mp4'), 7, 3)).toBeNull()
    expect(ownVideoLocation(videoUrl('event-videos/8/3-a.mp4'), 7, 3)).toBeNull()
    expect(ownVideoLocation(videoUrl('event-videos/7/3-../x.mp4'), 7, 3)).toBeNull()
    expect(ownVideoLocation(videoUrl('event-videos/7/3-a.html'), 7, 3)).toBeNull()
  })
})
