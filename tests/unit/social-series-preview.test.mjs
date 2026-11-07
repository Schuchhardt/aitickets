// Vistas previas de la difusión automática sin sesión: link firmado de una pieza (src/lib/socialSeriesPreview.ts) y
// GET /api/events/social-series-preview. Solo lectura: no guarda imágenes ni toca los slots. Supabase falso: sin red.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const uploads = []

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const P = await import('../../src/lib/socialSeriesPreview.ts')
const { GET } = await import('../../src/pages/api/events/social-series-preview.ts')

const NOW = Date.parse('2026-11-05T12:00:00Z')
const PIECE = { eventId: 2296, kind: 'story', variant: 'countdown', days: 3, platform: 'instagram' }
const get = (qs) => {
  const url = new URL(`https://aitickets.cl/api/events/social-series-preview?${qs}`)
  return GET({ url, cookies: { get: () => undefined }, request: new Request(url), locals: {} })
}

beforeEach(() => {
  process.env.INTERNAL_API_SECRET = 'secreto-de-prueba'
  uploads.length = 0
  db = createFakeSupabase({
    tables: {
      events: [{
        id: 2296, name: 'Concierto de Primavera', slug: 'concierto-2296', status: 'published', organization_id: 7,
        start_date: '2026-11-08T15:00:00Z', end_date: '2026-11-08T18:00:00Z', image_url: null, cancelled_at: null, archived_at: null,
        location: 'Escuela', event_dates: [{ date: '2026-11-08', start_time: '12:00:00', end_time: '15:00:00' }], event_locations: [{ venues: { name: 'Escuela', city: 'Santiago' } }],
      }],
      event_tickets: [{ id: 50, event_id: 2296, ticket_name: 'General', price: 5000, total_quantity: 350, is_gift: false, status: 'available' }],
      event_orders: [],
      aitickets_platform_settings: [],
      aitickets_social_series: [],
      aitickets_social_series_slots: [],
    },
    rpc: { aitickets_ticket_availability: () => [{ ticket_id: 50, sold: 67, pending: 0 }] },
  })
  db.storage = { from: () => ({ upload: async (path) => { uploads.push(path); return { error: null } } }) }
})

afterEach(() => {
  delete process.env.INTERNAL_API_SECRET
})

describe('token de la vista previa', () => {
  it('devuelve la misma pieza y vence a las 24 h', () => {
    const token = P.signPreviewToken(PIECE, NOW)
    expect(P.verifyPreviewToken(token, NOW + 23 * 3600_000)).toEqual(PIECE)
    expect(P.verifyPreviewToken(token, NOW + 24 * 3600_000)).toBeNull()
  })

  it('rechaza una firma alterada, otra pieza con la misma firma y otra clave', () => {
    const token = P.signPreviewToken(PIECE, NOW)
    const [, sig] = token.split('.')
    const other = Buffer.from(JSON.stringify({ p: 'series_preview', e: 1, k: 'story', d: 3, v: 'countdown', n: 'instagram', exp: 9999999999 })).toString('base64url')
    expect(P.verifyPreviewToken(`${other}.${sig}`, NOW)).toBeNull()
    expect(P.verifyPreviewToken(`${token}x`, NOW)).toBeNull()
    expect(P.verifyPreviewToken('', NOW)).toBeNull()
    expect(P.verifyPreviewToken(null, NOW)).toBeNull()
    process.env.INTERNAL_API_SECRET = 'otro-secreto'
    expect(P.verifyPreviewToken(token, NOW)).toBeNull()
  })

  it('no firma sin clave', () => {
    delete process.env.INTERNAL_API_SECRET
    const prev = process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(P.signPreviewToken(PIECE, NOW)).toBeNull()
    if (prev) process.env.SUPABASE_SERVICE_ROLE_KEY = prev
  })

  it('previewLink: sin link para un reel, y el feed de TikTok se dibuja vertical', () => {
    expect(P.previewLink('https://aitickets.cl', 2296, { kind: 'reel', days_to_event: 3 }, NOW)).toBeNull()
    const url = new URL(P.previewLink('https://aitickets.cl/', 2296, { kind: 'feed_post', variant: 'countdown', days_to_event: 3, platform: 'tiktok' }, NOW))
    expect(url.pathname).toBe('/api/events/social-series-preview')
    expect(P.verifyPreviewToken(url.searchParams.get('token'), NOW)).toEqual({ ...PIECE, platform: 'tiktok' })
  })
})

describe('GET /api/events/social-series-preview', () => {
  it('con un link firmado entrega la imagen sin sesión y sin escribir nada', async () => {
    const before = JSON.stringify(db.tables)
    const res = await get(`token=${P.signPreviewToken(PIECE)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex')
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000)
    expect(JSON.stringify(db.tables)).toBe(before)
    expect(uploads).toEqual([])
  })

  it('un token inválido o vencido no entra, aunque traiga parámetros válidos', async () => {
    expect((await get('token=nada&event_id=2296&kind=story&days=3')).status).toBe(403)
    expect((await get(`token=${P.signPreviewToken(PIECE, Date.now() - 25 * 3600_000)}`)).status).toBe(403)
  })

  it('el token manda sobre la query: no sirve para pedir otro evento', async () => {
    const res = await get(`token=${P.signPreviewToken({ ...PIECE, eventId: 999 })}&event_id=2296`)
    expect(res.status).toBe(404)
  })

  it('sin token ni sesión responde 401', async () => {
    expect((await get('event_id=2296&kind=story&days=3')).status).toBe(401)
  })
})
