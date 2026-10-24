// Video de portada de la galería: /api/events/gallery (acciones video_*), rutas propias del evento en Storage
// (src/lib/videoStorage.ts) y la forma pública (normalizeGalleryVideo).
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

const gallery = await import('../../src/pages/api/events/gallery.ts')
const { normalizeGalleryVideo, GALLERY_VIDEO_MAX_BYTES } = await import('../../src/lib/eventGallery.ts')
const { ownVideoLocation, VIDEO_BUCKET } = await import('../../src/lib/videoStorage.ts')

const post = (body) => gallery.POST({
  request: new Request('https://example.test/api/events/gallery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
})
const get = (eventId) => gallery.GET({ request: new Request(`https://example.test/api/events/gallery?eventId=${eventId}`) })

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

function setup({ role = 'producer', gallery_video = null, buckets } = {}) {
  session = { dbUser: { id: 1, organization_id: 7, role } }
  db = createFakeSupabase({
    tables: {
      events: [
        { id: 3, organization_id: 7, status: 'published', gallery_video },
        { id: 9, organization_id: 8, status: 'published', gallery_video: null },
      ],
      aitickets_event_gallery_images: [],
    },
  })
  storage = fakeStorage({ buckets })
  db.storage = storage
}

const videoUrl = (path, bucket = VIDEO_BUCKET) => `${STORAGE}${bucket}/${path}`

describe('/api/events/gallery: video de portada', () => {
  it('pide la URL firmada en el bucket de videos, en la carpeta del evento y la organización', async () => {
    setup()
    const res = await post({ eventId: 3, action: 'video_upload_url', contentType: 'video/mp4', size: 12 * 1024 * 1024 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.uploadUrl).toMatch(new RegExp(`/upload/sign/${VIDEO_BUCKET}/event-videos/7/3-.+\\.mp4\\?token=`))
    expect(body.publicUrl).toMatch(new RegExp(`^${STORAGE}${VIDEO_BUCKET}/event-videos/7/3-.+\\.mp4$`))
  })

  it('sin el bucket de videos usa el bucket Events', async () => {
    setup({ buckets: ['Events'] })
    const body = await (await post({ eventId: 3, action: 'video_upload_url', contentType: 'video/webm', size: 1000 })).json()
    expect(body.publicUrl).toMatch(new RegExp(`^${STORAGE}Events/event-videos/7/3-.+\\.webm$`))
  })

  it('rechaza formatos no soportados, archivos sobre el máximo, otra organización y validadores', async () => {
    setup()
    expect((await post({ eventId: 3, action: 'video_upload_url', contentType: 'video/x-msvideo', size: 1000 })).status).toBe(400)
    expect((await post({ eventId: 3, action: 'video_upload_url', contentType: 'video/mp4', size: GALLERY_VIDEO_MAX_BYTES + 1 })).status).toBe(400)
    expect((await post({ eventId: 9, action: 'video_upload_url', contentType: 'video/mp4', size: 1000 })).status).toBe(404)
    setup({ role: 'validator' })
    expect((await post({ eventId: 3, action: 'video_upload_url', contentType: 'video/mp4', size: 1000 })).status).toBe(403)
  })

  it('video_set verifica el archivo, guarda el video y borra el anterior', async () => {
    const previous = videoUrl('event-videos/7/3-old.mp4')
    setup({ gallery_video: { url: previous, mime: 'video/mp4' } })
    const path = 'event-videos/7/3-new.mp4'
    storage.files[`${VIDEO_BUCKET}/${path}`] = { contentType: 'video/mp4', size: 5_000_000 }
    const res = await post({
      eventId: 3,
      action: 'video_set',
      url: videoUrl(path),
      poster_url: `${STORAGE}Events/event-gallery/7-poster.jpg`,
      width: 1080,
      height: 1920,
      duration: 14.6,
    })
    expect(res.status).toBe(200)
    expect((await res.json()).video).toEqual({
      url: videoUrl(path),
      poster_url: `${STORAGE}Events/event-gallery/7-poster.jpg`,
      width: 1080,
      height: 1920,
      duration: 15,
      mime: 'video/mp4',
    })
    expect(db.tables.events[0].gallery_video).toMatchObject({ url: videoUrl(path), bytes: 5_000_000 })
    expect(storage.removed).toEqual([`${VIDEO_BUCKET}/event-videos/7/3-old.mp4`])
  })

  it('video_set rechaza URLs de otro evento, de afuera, sin archivo o que no son video', async () => {
    setup()
    storage.files[`${VIDEO_BUCKET}/event-videos/7/4-x.mp4`] = { contentType: 'video/mp4', size: 10 }
    expect((await post({ eventId: 3, action: 'video_set', url: videoUrl('event-videos/7/4-x.mp4') })).status).toBe(400)
    expect((await post({ eventId: 3, action: 'video_set', url: 'https://evil.example/event-videos/7/3-x.mp4' })).status).toBe(400)
    expect((await post({ eventId: 3, action: 'video_set', url: videoUrl('event-videos/7/3-missing.mp4') })).status).toBe(400)
    storage.files[`${VIDEO_BUCKET}/event-videos/7/3-page.mp4`] = { contentType: 'text/html', size: 10 }
    const res = await post({ eventId: 3, action: 'video_set', url: videoUrl('event-videos/7/3-page.mp4') })
    expect(res.status).toBe(400)
    expect(storage.removed).toEqual([`${VIDEO_BUCKET}/event-videos/7/3-page.mp4`])
    expect(db.tables.events[0].gallery_video).toBeNull()
  })

  it('un póster de otro dominio se descarta', async () => {
    setup()
    storage.files[`${VIDEO_BUCKET}/event-videos/7/3-a.mp4`] = { contentType: 'video/mp4', size: 10 }
    const body = await (await post({ eventId: 3, action: 'video_set', url: videoUrl('event-videos/7/3-a.mp4'), poster_url: 'https://evil.example/p.jpg' })).json()
    expect(body.video.poster_url).toBeNull()
  })

  it('GET devuelve el video y video_delete lo quita (y borra el archivo)', async () => {
    const url = videoUrl('event-videos/7/3-a.mp4')
    setup({ gallery_video: { url, mime: 'video/mp4', width: 1920, height: 1080 } })
    const data = await (await get(3)).json()
    expect(data).toMatchObject({ video: { url, width: 1920, height: 1080 }, video_available: true, video_max_bytes: GALLERY_VIDEO_MAX_BYTES })
    expect((await post({ eventId: 3, action: 'video_delete' })).status).toBe(200)
    expect(db.tables.events[0].gallery_video).toBeNull()
    expect(storage.removed).toEqual([`${VIDEO_BUCKET}/event-videos/7/3-a.mp4`])
  })

  it('sin la columna gallery_video (deploy preview sin migrar): GET sin video y acciones 503', async () => {
    setup()
    const missing = { code: '42703', message: 'column events.gallery_video does not exist' }
    db.failOn('events', 'select', missing, { once: false })
    const data = await (await get(3)).json()
    expect(data).toMatchObject({ video: null, video_available: false })
    expect((await post({ eventId: 3, action: 'video_upload_url', contentType: 'video/mp4', size: 1000 })).status).toBe(503)
    expect((await post({ eventId: 3, action: 'video_delete' })).status).toBe(503)
  })
})

describe('normalizeGalleryVideo / ownVideoLocation', () => {
  it('forma pública: solo https y campos válidos', () => {
    expect(normalizeGalleryVideo(null)).toBeNull()
    expect(normalizeGalleryVideo({ url: 'http://x.test/a.mp4' })).toBeNull()
    expect(normalizeGalleryVideo({ url: 'https://x.test/a.mp4', width: -1, mime: 'text/html', duration: 'x', poster_url: 'javascript:alert(1)' }))
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
