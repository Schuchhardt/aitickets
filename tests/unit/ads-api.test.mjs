// Rutas /api/promote/ads/* (anuncios en Meta vía Zernio): permisos, creación con gasto confirmado y sin duplicar,
// pausa/activación, conexión de la cuenta publicitaria y lista con ventas atribuidas. Supabase y Zernio falsos.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db }))
vi.mock('../../src/lib/supabaseServer', () => ({
  EVENT_MANAGER_ROLES: ['admin', 'producer', 'editor'],
  ORG_ADMIN_ROLES: ['admin', 'producer'],
  getSessionContext: async () => session,
  hasRole: (u, roles) => roles.includes(u?.role),
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

const create = await import('../../src/pages/api/promote/ads/create.ts')
const status = await import('../../src/pages/api/promote/ads/status.ts')
const connect = await import('../../src/pages/api/promote/ads/connect.ts')
const callback = await import('../../src/pages/api/promote/ads/callback.ts')
const stats = await import('../../src/pages/api/promote/ads/stats.ts')
const { createOAuthState } = await import('../../src/lib/crypto.ts')

const post = (mod, body) => mod.POST({ request: new Request('https://aitickets.cl/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
const redirect = (to) => new Response(null, { status: 302, headers: { Location: to } })

/** Zernio falso: handlers por "MÉTODO /ruta"; registra cada llamada. */
function fakeZernio(handlers) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const u = new URL(url)
    const key = `${init.method || 'GET'} ${u.pathname.replace('/api/v1', '')}`
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ key, url: u, headers: init.headers || {}, body })
    const h = handlers[key]
    if (!h) return new Response(JSON.stringify({ error: `sin handler ${key}` }), { status: 404 })
    const out = await h({ url: u, body })
    return new Response(JSON.stringify(out.body ?? {}), { status: out.status ?? 200 })
  }))
  return calls
}

const FUTURE_START = new Date(Date.now() + 10 * 86400000).toISOString()
const FUTURE_END = new Date(Date.now() + 10 * 86400000 + 6 * 3600000).toISOString()

beforeEach(() => {
  vi.stubEnv('ZERNIO_API_KEY', 'zk_test')
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'test-key')
  session = { authUser: { id: 'auth-1' }, dbUser: { id: 1, organization_id: 7, role: 'producer' } }
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Prod SpA', zernio_profile_id: 'prof_7' }],
      events: [
        { id: 10, organization_id: 7, name: 'Fiesta Techno', slug: 'fiesta-techno', status: 'published', start_date: FUTURE_START, end_date: FUTURE_END, image_url: 'https://x.supabase.co/a.webp' },
        { id: 11, organization_id: 7, name: 'Borrador', slug: 'borrador', status: 'draft', start_date: FUTURE_START, end_date: FUTURE_END },
        { id: 20, organization_id: 8, name: 'Ajeno', slug: 'ajeno', status: 'published', start_date: FUTURE_START, end_date: FUTURE_END },
      ],
      ad_account_connections: [
        { id: 3, organization_id: 7, provider: 'zernio', status: 'active', zernio_account_id: 'zacc_ads', meta_ad_account_id: 'act_111', currency: 'CLP', minimum_daily_budget: 1000, account_name: 'Prod SpA' },
        { id: 4, organization_id: 8, provider: 'zernio', status: 'active', zernio_account_id: 'zacc_otro', meta_ad_account_id: 'act_222', currency: 'CLP' },
      ],
      social_accounts: [{ id: 1, organization_id: 7, platform: 'facebook', status: 'active', zernio_account_id: 'zacc_fb' }],
      social_posts: [{ id: 50, organization_id: 7, event_id: 10, status: 'published', zernio_post_id: 'zp_50', platforms: ['instagram', 'facebook'], content: 'Ya viene la fiesta', image_urls: ['https://x/p.webp'] }],
      ad_campaigns: [],
      event_orders: [],
    },
  })
})

const adBody = (over = {}) => ({
  eventId: 10,
  connectionId: 3,
  type: 'standalone',
  headline: 'Fiesta Techno',
  body: 'La noche más larga.',
  imageUrl: 'https://x.supabase.co/a.webp',
  dailyBudget: 5000,
  days: 3,
  confirmSpend: true,
  confirmTotal: 15000,
  ...over,
})

describe('POST /api/promote/ads/create', () => {
  it('solo dueños/administradores y solo con Zernio configurado', async () => {
    session.dbUser.role = 'editor'
    expect((await post(create, adBody())).status).toBe(403)
    session.dbUser.role = 'producer'
    vi.stubEnv('ZERNIO_API_KEY', '')
    expect((await post(create, adBody())).status).toBe(503)
  })

  it('crea el anuncio: guarda la fila antes, manda a Zernio con su clave y deja el link con utm del anuncio', async () => {
    const calls = fakeZernio({ 'POST /ads/create': () => ({ status: 201, body: { ad: { _id: 'zad1', status: 'pending_review', reviewStatus: 'in_review', platformCampaignId: 'c1' } } }) })
    const res = await post(create, adBody({ geo: { type: 'city', key: '263039', name: 'Valparaíso', radiusKm: 25 }, launch: 'paused' }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.message).toMatch(/pausado.*\$15\.000/)

    const row = db.tables.ad_campaigns[0]
    expect(row).toMatchObject({ organization_id: 7, event_id: 10, provider: 'zernio', ad_type: 'standalone', status: 'pending_review', zernio_ad_id: 'zad1', daily_budget: 5000, total_budget: 15000, duration_days: 3, created_by: 1, meta_campaign_id: 'c1' })
    expect(row.destination_url).toBe(`https://aitickets.cl/eventos/fiesta-techno?utm_source=meta&utm_medium=paid&utm_campaign=ad-${row.id}`)
    expect(row.zernio_request.path).toBe('/ads/create')

    expect(calls).toHaveLength(1)
    expect(calls[0].headers['Idempotency-Key']).toBe(`aitickets-ad-${row.id}`)
    expect(calls[0].body).toMatchObject({ accountId: 'zacc_ads', adAccountId: 'act_111', budgetAmount: 5000, budgetType: 'daily', adStatus: 'PAUSED', targeting: { cities: [{ key: '263039', radius: 25, distance_unit: 'kilometer' }] } })
  })

  it('doble clic: el mismo anuncio recién creado no se crea dos veces', async () => {
    const calls = fakeZernio({ 'POST /ads/create': () => ({ status: 201, body: { ad: { _id: 'zad1', status: 'pending_review' } } }) })
    expect((await post(create, adBody())).status).toBe(200)
    db.tables.ad_campaigns[0].created_at = new Date().toISOString() // la BD falsa no pone el DEFAULT now()
    const again = await post(create, adBody())
    expect(again.status).toBe(409)
    expect((await again.json()).duplicate).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('valida en el servidor: gasto sin confirmar, evento en borrador o ajeno, cuenta de otra productora', async () => {
    fakeZernio({})
    const noConfirm = await post(create, adBody({ confirmTotal: 999 }))
    expect(noConfirm.status).toBe(400)
    expect((await noConfirm.json()).message).toMatch(/Confirma el gasto/)
    expect((await post(create, adBody({ eventId: 11 }))).status).toBe(400)
    expect((await post(create, adBody({ eventId: 20 }))).status).toBe(404)
    expect((await post(create, adBody({ connectionId: 4 }))).status).toBe(400)
    expect(db.tables.ad_campaigns).toHaveLength(0)
  })

  it('si Meta/Zernio lo rechaza, la fila queda en error con el motivo', async () => {
    fakeZernio({ 'POST /ads/create': () => ({ status: 400, body: { error: 'Invalid image', type: 'platform_error', platformError: { error_user_msg: 'La imagen no cumple las políticas' } } }) })
    const res = await post(create, adBody())
    expect(res.status).toBe(502)
    expect((await res.json()).message).toMatch(/La imagen no cumple las políticas/)
    expect(db.tables.ad_campaigns[0]).toMatchObject({ status: 'error' })
  })

  it('boost de un post publicado: desde la cuenta de Facebook donde se publicó', async () => {
    const calls = fakeZernio({ 'POST /ads/boost': () => ({ status: 201, body: { ad: { _id: 'zad9', status: 'pending_review' } } }) })
    const res = await post(create, adBody({ type: 'boost', socialPostId: 50 }))
    expect(res.status).toBe(200)
    expect(calls[0].body).toMatchObject({ accountId: 'zacc_fb', postId: 'zp_50', callToAction: 'BUY_TICKETS' })
    expect(db.tables.ad_campaigns[0]).toMatchObject({ ad_type: 'boost', social_post_id: 50, ad_copy: 'Ya viene la fiesta' })
  })
})

describe('POST /api/promote/ads/status', () => {
  beforeEach(() => {
    db.tables.ad_campaigns.push({ id: 5, organization_id: 7, event_id: 10, provider: 'zernio', status: 'active', zernio_ad_id: 'zad5' })
  })

  it('pausar lo puede hacer quien administra eventos; reactivar (vuelve a gastar) solo dueños', async () => {
    const calls = fakeZernio({ 'PUT /ads/zad5/status': ({ body }) => ({ body: { updated: 1, status: body.status === 'paused' ? 'paused' : 'active' } }) })
    session.dbUser.role = 'editor'
    const paused = await post(status, { campaignId: 5, action: 'pause' })
    expect(paused.status).toBe(200)
    expect(calls[0].body).toEqual({ status: 'paused' })
    expect(db.tables.ad_campaigns[0].status).toBe('paused')
    expect((await post(status, { campaignId: 5, action: 'activate' })).status).toBe(403)
    session.dbUser.role = 'admin'
    expect((await post(status, { campaignId: 5, action: 'activate' })).status).toBe(200)
    expect(db.tables.ad_campaigns[0].status).toBe('active')
  })

  it('cancelar borra el anuncio en Meta y no se puede volver a tocar', async () => {
    fakeZernio({ 'DELETE /ads/zad5': () => ({ body: { message: 'ok' } }) })
    expect((await post(status, { campaignId: 5, action: 'cancel' })).status).toBe(200)
    expect(db.tables.ad_campaigns[0].status).toBe('cancelled')
    expect((await post(status, { campaignId: 5, action: 'pause' })).status).toBe(409)
  })
})

describe('conexión de la cuenta publicitaria', () => {
  it('si Facebook ya tiene permisos de anuncios, conecta al tiro y guarda las cuentas', async () => {
    const calls = fakeZernio({
      'GET /connect/facebook/ads': () => ({ body: { alreadyConnected: true, accountId: 'zacc_new' } }),
      'GET /ads/accounts': () => ({ body: { accounts: [{ id: 'act_999', name: 'Nueva', currency: 'CLP', selectable: true }] } }),
    })
    const res = await connect.POST({ request: new Request('https://aitickets.cl/api/promote/ads/connect', { method: 'POST' }) })
    expect(await res.json()).toEqual({ connected: true, adAccounts: 1 })
    expect(calls[0].url.searchParams.get('profileId')).toBe('prof_7')
    expect(calls[0].url.searchParams.get('accountId')).toBe('zacc_fb')
    expect(calls[0].url.searchParams.get('redirect_url')).toMatch(/^https:\/\/aitickets\.cl\/api\/promote\/ads\/callback\?state=/)
    expect(db.tables.ad_account_connections.find((c) => c.meta_ad_account_id === 'act_999')).toMatchObject({ organization_id: 7, zernio_account_id: 'zacc_new', status: 'active' })
  })

  it('sin permisos aún: devuelve el diálogo de Meta; un editor no puede conectar', async () => {
    fakeZernio({ 'GET /connect/facebook/ads': () => ({ body: { authUrl: 'https://www.facebook.com/dialog/oauth?x=1' } }) })
    const res = await connect.POST({ request: new Request('https://aitickets.cl/x', { method: 'POST' }) })
    expect(await res.json()).toEqual({ redirect_url: 'https://www.facebook.com/dialog/oauth?x=1' })
    session.dbUser.role = 'editor'
    expect((await connect.POST({ request: new Request('https://aitickets.cl/x', { method: 'POST' }) })).status).toBe(403)
  })

  it('callback: valida state, perfil y que la conexión sea del perfil (falla cerrado)', async () => {
    const calls = fakeZernio({
      'GET /accounts': () => ({ body: { accounts: [{ _id: 'zacc_new', profileId: 'prof_7', platform: 'metaads' }] } }),
      'GET /ads/accounts': () => ({ body: { accounts: [{ id: 'act_999', name: 'Nueva', currency: 'CLP', selectable: true }] } }),
    })
    const state = createOAuthState({ purpose: 'zernio-ads', org: 7, uid: 'auth-1', ts: Date.now() })
    const call = (qs) => callback.GET({ url: new URL(`https://aitickets.cl/api/promote/ads/callback?${qs}`), redirect })

    const bad = await call(`state=${encodeURIComponent(createOAuthState({ purpose: 'zernio', org: 7, uid: 'auth-1', ts: Date.now() }))}&connected=metaads&profileId=prof_7&accountId=zacc_new`)
    expect(bad.headers.get('Location')).toBe('/dashboard/promote?tab=ads&error=invalid_state')
    const otherProfile = await call(`state=${encodeURIComponent(state)}&connected=metaads&profileId=prof_x&accountId=zacc_new`)
    expect(otherProfile.headers.get('Location')).toBe('/dashboard/promote?tab=ads&error=invalid_profile')
    const denied = await call('error=meta_ads_authorization_denied&platform=metaads')
    expect(denied.headers.get('Location')).toBe('/dashboard/promote?tab=ads&error=ads_denied')

    const ok = await call(`state=${encodeURIComponent(state)}&connected=metaads&profileId=prof_7&accountId=zacc_new`)
    expect(ok.headers.get('Location')).toBe('/dashboard/promote?tab=ads&connected=ads')
    expect(calls.map((c) => c.key)).toEqual(['GET /accounts', 'GET /ads/accounts'])
    expect(db.tables.ad_account_connections.some((c) => c.meta_ad_account_id === 'act_999')).toBe(true)
  })
})

describe('POST /api/promote/ads/stats', () => {
  it('lista los anuncios con métricas de Zernio y las entradas que vendió cada uno', async () => {
    const old = new Date(Date.now() - 3600_000).toISOString()
    db.tables.ad_campaigns.push(
      { id: 5, organization_id: 7, event_id: 10, provider: 'zernio', status: 'active', zernio_ad_id: 'zad5', currency: 'CLP', created_at: old, last_synced_at: null, events: { id: 10, name: 'Fiesta Techno', slug: 'fiesta-techno' }, zernio_request: { secret: 'no' } },
      { id: 6, organization_id: 8, event_id: 20, provider: 'zernio', status: 'active', zernio_ad_id: 'zad6', created_at: old },
    )
    db.tables.event_orders.push(
      { event_id: 10, status: 'paid', utm_campaign: 'ad-5', amount: 30000, ticket_qty: 3, created_at: old },
      { event_id: 10, status: 'paid', utm_campaign: null, amount: 10000, ticket_qty: 1, created_at: old },
    )
    fakeZernio({
      'GET /ads/zad5': () => ({ body: { ad: { _id: 'zad5', status: 'active', reviewStatus: 'approved' } } }),
      'GET /ads/zad5/analytics': () => ({ body: { ad: { currency: 'CLP' }, analytics: { summary: { spend: 12000, impressions: 5000, reach: 3000, clicks: 90, ctr: 1.8 } } } }),
    })
    const res = await post(stats, {})
    const data = await res.json()
    expect(data.enabled).toBe(true)
    expect(data.campaigns).toHaveLength(1)
    expect(data.campaigns[0]).toMatchObject({ id: 5, spend: 12000, clicks: 90, review_status: 'approved', sales: { tickets: 3, revenue_clp: 30000 }, cost_per_ticket: 4000, roas: 2.5, event: { name: 'Fiesta Techno' } })
    expect(data.campaigns[0].zernio_request).toBeUndefined()
    expect(data.connections.map((c) => c.id)).toEqual([3])
    expect(data.connections[0].zernio_account_id).toBeUndefined()
  })
})
