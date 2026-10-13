// /api/events/gallery (alcance por organización, URLs propias, máximo, orden) y /og/eventos/<id>.jpg
// (versión, borradores, render y fallback).
import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session
let fetchPublicImpl

const BASE = 'https://ref.supabase.co/storage/v1/object/public/Events/'

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))
vi.mock('../../src/lib/supabaseServer', () => ({
  EVENT_MANAGER_ROLES: ['admin', 'producer', 'editor'],
  getSessionContext: async () => session,
  hasRole: (u, roles) => roles.includes(u?.role),
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  getOwnedEvent: async (eventId, orgId) => (db.tables.events || []).find((e) => String(e.id) === String(eventId) && e.organization_id === orgId) || null,
}))
vi.mock('../../src/lib/safe-fetch', () => ({ fetchPublic: (...args) => fetchPublicImpl(...args) }))

const gallery = await import('../../src/pages/api/events/gallery.ts')
const og = await import('../../src/pages/og/eventos/[id].jpg.ts')
const { ogImageVersion } = await import('../../src/lib/ogImage.ts')
const { GALLERY_MAX_IMAGES } = await import('../../src/lib/eventGallery.ts')

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const post = (body) => gallery.POST({
  request: new Request('https://example.test/api/events/gallery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
})
const get = (eventId) => gallery.GET({ request: new Request(`https://example.test/api/events/gallery?eventId=${eventId}`) })

function setup(images = [], role = 'producer') {
  session = { dbUser: { id: 1, organization_id: 7, role } }
  db = createFakeSupabase({
    tables: {
      events: [
        { id: 3, organization_id: 7, status: 'published', image_url: `${BASE}event-covers/a.jpg` },
        { id: 9, organization_id: 8, status: 'published', image_url: null },
        { id: 4, organization_id: 7, status: 'draft', image_url: `${BASE}event-covers/draft.jpg` },
      ],
      aitickets_event_gallery_images: images,
    },
  })
  db.storage = { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: BASE + p } }) }) }
}

describe('/api/events/gallery', () => {
  it('evento de otra organización: 404; validador: 403', async () => {
    setup()
    expect((await get(9)).status).toBe(404)
    expect((await post({ eventId: 9, action: 'add', images: [{ url: `${BASE}x.jpg` }] })).status).toBe(404)
    setup([], 'validator')
    expect((await get(3)).status).toBe(403)
  })

  it('add guarda solo URLs del bucket propio, en la organización de la sesión y al final', async () => {
    setup([{ id: uuid(1), event_id: 3, organization_id: 7, url: `${BASE}g/1.jpg`, position: 0, created_at: '2026-10-01' }])
    const res = await post({
      eventId: 3,
      action: 'add',
      images: [
        { url: `${BASE}event-gallery/7-a.jpg`, thumb_url: `${BASE}event-gallery/7-a-thumb.webp`, width: 2000, height: 1500, organization_id: 8 },
        { url: 'https://evil.example/b.jpg' },
      ],
    })
    expect(res.status).toBe(201)
    const rows = db.tables.aitickets_event_gallery_images
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ event_id: 3, organization_id: 7, position: 1, width: 2000, created_by_user_id: 1, url: `${BASE}event-gallery/7-a.jpg` })
    const { images } = await res.json()
    expect(images.map((i) => i.url)).toEqual([`${BASE}g/1.jpg`, `${BASE}event-gallery/7-a.jpg`])
  })

  it('add sin imágenes válidas: 400; sobre el máximo: 400', async () => {
    setup()
    expect((await post({ eventId: 3, action: 'add', images: [{ url: 'https://evil.example/b.jpg' }] })).status).toBe(400)
    setup(Array.from({ length: GALLERY_MAX_IMAGES }, (_, i) => ({ id: uuid(i + 1), event_id: 3, organization_id: 7, url: `${BASE}g/${i}.jpg`, position: i })))
    const res = await post({ eventId: 3, action: 'add', images: [{ url: `${BASE}g/extra.jpg` }] })
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/hasta/)
  })

  it('reorder exige ids del evento; caption y delete no tocan otros eventos', async () => {
    setup([
      { id: uuid(1), event_id: 3, organization_id: 7, url: `${BASE}1.jpg`, position: 0 },
      { id: uuid(2), event_id: 3, organization_id: 7, url: `${BASE}2.jpg`, position: 1 },
      { id: uuid(3), event_id: 9, organization_id: 8, url: `${BASE}3.jpg`, position: 0 },
    ])
    expect((await post({ eventId: 3, action: 'reorder', ids: [uuid(2), uuid(3)] })).status).toBe(400)
    expect((await post({ eventId: 3, action: 'reorder', ids: [uuid(2), uuid(1)] })).status).toBe(200)
    const pos = Object.fromEntries(db.tables.aitickets_event_gallery_images.map((r) => [r.id, r.position]))
    expect(pos).toMatchObject({ [uuid(1)]: 1, [uuid(2)]: 0, [uuid(3)]: 0 })

    expect((await post({ eventId: 3, action: 'caption', id: uuid(3), caption: 'x' })).status).toBe(404)
    expect((await post({ eventId: 3, action: 'caption', id: uuid(1), caption: '  Pista  central ' })).status).toBe(200)
    expect(db.tables.aitickets_event_gallery_images.find((r) => r.id === uuid(1)).caption).toBe('Pista central')

    await post({ eventId: 3, action: 'delete', id: uuid(3) })
    expect(db.tables.aitickets_event_gallery_images.some((r) => r.id === uuid(3))).toBe(true)
    await post({ eventId: 3, action: 'delete', id: uuid(2) })
    expect(db.tables.aitickets_event_gallery_images.some((r) => r.id === uuid(2))).toBe(false)
  })

  it('tabla aún no migrada: GET devuelve lista vacía', async () => {
    setup()
    db.failOn('aitickets_event_gallery_images', 'select', { code: '42P01', message: 'no existe' })
    const res = await get(3)
    expect(res.status).toBe(200)
    expect((await res.json()).images).toEqual([])
  })
})

describe('/og/eventos/<id>.jpg', () => {
  const call = (id, v) => og.GET({ params: { id: String(id) }, url: new URL(`https://aitickets.cl/og/eventos/${id}.jpg${v ? `?v=${v}` : ''}`) })
  const flyer = () => sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#a3e635' } }).jpeg().toBuffer()

  it('versión correcta: JPEG 1200×630 cacheable', async () => {
    setup()
    fetchPublicImpl = async () => ({ buffer: await flyer(), contentType: 'image/jpeg', finalUrl: '' })
    const res = await call(3, ogImageVersion(`${BASE}event-covers/a.jpg`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toContain('immutable')
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
    expect([meta.width, meta.height]).toEqual([1200, 630])
  })

  it('versión vieja de un evento publicado: 301 a la vigente', async () => {
    setup()
    const res = await call(3, 'viejo')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe(`/og/eventos/3.jpg?v=${ogImageVersion(`${BASE}event-covers/a.jpg`)}`)
  })

  it('borrador sin la versión exacta: imagen genérica (no se enumeran portadas)', async () => {
    setup()
    const res = await call(4, 'cualquiera')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/aitickets_preview.png')
  })

  it('sin portada o inexistente: imagen genérica; si falla la descarga: la portada original', async () => {
    setup()
    expect((await call(9)).headers.get('location')).toBe('/aitickets_preview.png')
    expect((await call(999)).headers.get('location')).toBe('/aitickets_preview.png')
    fetchPublicImpl = async () => { throw new Error('timeout') }
    const res = await call(3, ogImageVersion(`${BASE}event-covers/a.jpg`))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${BASE}event-covers/a.jpg`)
  })
})
