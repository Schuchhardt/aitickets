// Anuncios en Meta vía Zernio (netlify/lib/zernio-ads.mjs): validación del gasto, cuerpo de los requests, estados,
// ventas atribuidas y recuperación de creaciones cortadas. Zernio falso (fetch inyectado) y Supabase falso: sin red.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import {
  validateAdInput,
  buildAdRequest,
  adRowPatch,
  metricsPatch,
  salesByAd,
  adEfficiency,
  adTrackingUrl,
  adCampaignIdFromUtm,
  zernioRequest,
  ZernioError,
  friendlyAdsError,
  submitAdRequest,
  recoverCreatingAd,
  syncAdAccounts,
  adsEnabled,
} from '../../netlify/lib/zernio-ads.mjs'

const NOW = new Date('2026-10-25T15:00:00Z')
const connection = { id: 3, zernio_account_id: 'zacc_ads', meta_ad_account_id: 'act_111', currency: 'CLP', minimum_daily_budget: 1000 }
const event = { id: 10, name: 'Fiesta Techno', slug: 'fiesta-techno', start_date: '2026-11-07T01:00:00Z', end_date: '2026-11-07T07:00:00Z' }
const base = (over = {}) => ({
  type: 'standalone',
  headline: 'Fiesta Techno · sáb 7',
  body: 'La noche más larga del año.',
  imageUrl: 'https://ref.supabase.co/storage/v1/object/public/Events/promote/7-upload-abc.webp',
  dailyBudget: 5000,
  days: 5,
  confirmSpend: true,
  confirmTotal: 25000,
  ...over,
})

/** Zernio falso: handlers por "MÉTODO /ruta"; registra cada llamada. */
function fakeZernio(handlers) {
  const calls = []
  const fetchImpl = vi.fn(async (url, init = {}) => {
    const u = new URL(url)
    const key = `${init.method || 'GET'} ${u.pathname.replace('/api/v1', '')}`
    calls.push({ key, url: u, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined })
    const h = handlers[key]
    if (!h) return new Response(JSON.stringify({ error: `sin handler ${key}` }), { status: 404 })
    const out = await h({ url: u, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers || {} })
    if (out instanceof Error) throw out
    return new Response(JSON.stringify(out.body ?? {}), { status: out.status ?? 200 })
  })
  vi.stubGlobal('fetch', fetchImpl)
  return calls
}

beforeEach(() => {
  vi.stubEnv('ZERNIO_API_KEY', 'zk_test')
})

describe('validación del anuncio', () => {
  it('acepta un anuncio válido y recalcula el gasto máximo', () => {
    const out = validateAdInput(base(), { connection, event, now: NOW })
    expect(out.ok).toBe(true)
    expect(out.value).toMatchObject({ type: 'standalone', currency: 'CLP', dailyBudget: 5000, days: 5, totalBudget: 25000, ageMin: 18, ageMax: 65, callToAction: 'BUY_TICKETS', launch: 'now' })
    expect(out.value.geo).toMatchObject({ type: 'country', countries: ['CL'] })
    expect(out.value.endDate.getTime() - out.value.startDate.getTime()).toBe(5 * 86400000)
  })

  it('exige confirmar exactamente el gasto máximo', () => {
    expect(validateAdInput(base({ confirmSpend: false }), { connection, event, now: NOW }).ok).toBe(false)
    const wrong = validateAdInput(base({ confirmTotal: 5000 }), { connection, event, now: NOW })
    expect(wrong.ok).toBe(false)
    expect(wrong.errors.join(' ')).toMatch(/Confirma el gasto/)
  })

  it('presupuesto entre el mínimo de la cuenta y el tope de cordura; 1 a 30 días; nunca después del evento', () => {
    const low = validateAdInput(base({ dailyBudget: 500, confirmTotal: 2500 }), { connection, event, now: NOW })
    expect(low.errors[0]).toMatch(/mínimo de tu cuenta publicitaria es \$1\.000/)
    const high = validateAdInput(base({ dailyBudget: 2_000_000, confirmTotal: 10_000_000 }), { connection, event, now: NOW })
    expect(high.errors[0]).toMatch(/máximo desde AI Tickets/)
    expect(validateAdInput(base({ days: 31, confirmTotal: 155000 }), { connection, event, now: NOW }).ok).toBe(false)
    const late = validateAdInput(base({ days: 14, confirmTotal: 70000 }), { connection, event, now: NOW })
    expect(late.errors.join(' ')).toMatch(/después del evento/)
  })

  it('cuentas en otra moneda: unidades enteras de esa moneda, con decimales', () => {
    const usd = { ...connection, currency: 'USD', minimum_daily_budget: 1 }
    const out = validateAdInput(base({ dailyBudget: 7.5, days: 4, confirmTotal: 30 }), { connection: usd, event, now: NOW })
    expect(out.ok).toBe(true)
    expect(out.value).toMatchObject({ currency: 'USD', dailyBudget: 7.5, totalBudget: 30 })
  })

  it('ciudad con id de Meta y radio permitido; edad válida; anuncio con título, texto e imagen', () => {
    const city = validateAdInput(base({ geo: { type: 'city', key: '263039', name: 'Valparaíso', radiusKm: 25 } }), { connection, event, now: NOW })
    expect(city.value.geo).toEqual({ type: 'city', key: '263039', radiusKm: 25, label: 'Valparaíso + 25 km' })
    expect(validateAdInput(base({ geo: { type: 'city', key: 'abc', radiusKm: 25 } }), { connection, event, now: NOW }).ok).toBe(false)
    expect(validateAdInput(base({ geo: { type: 'city', key: '263039', radiusKm: 5 } }), { connection, event, now: NOW }).ok).toBe(false)
    expect(validateAdInput(base({ ageMin: 40, ageMax: 20 }), { connection, event, now: NOW }).ok).toBe(false)
    const empty = validateAdInput(base({ headline: '  ', imageUrl: 'http://inseguro.cl/x.png' }), { connection, event, now: NOW })
    expect(empty.errors).toEqual(expect.arrayContaining(['Escribe el título del anuncio.', 'El anuncio necesita una imagen.']))
  })

  it('boost: solo posts publicados desde AI Tickets', () => {
    const ok = validateAdInput(base({ type: 'boost' }), { connection, event, post: { status: 'published', zernio_post_id: 'zp_1' }, now: NOW })
    expect(ok.ok).toBe(true)
    const draft = validateAdInput(base({ type: 'boost' }), { connection, event, post: { status: 'draft', zernio_post_id: null }, now: NOW })
    expect(draft.errors[0]).toMatch(/publicaciones hechas desde AI Tickets/)
  })
})

describe('request a Zernio', () => {
  it('anuncio nuevo: tráfico, presupuesto diario en unidades enteras, Chile, link con utm del anuncio y pausado si se pide', () => {
    const { value } = validateAdInput(base({ launch: 'paused' }), { connection, event, now: NOW })
    const req = buildAdRequest({ adCampaignId: 42, value, connection, event })
    expect(req.path).toBe('/ads/create')
    expect(req.body).toMatchObject({
      accountId: 'zacc_ads',
      adAccountId: 'act_111',
      name: 'Fiesta Techno · AI Tickets #42',
      goal: 'traffic',
      budgetAmount: 5000,
      budgetType: 'daily',
      currency: 'CLP',
      headline: 'Fiesta Techno · sáb 7',
      callToAction: 'BUY_TICKETS',
      targeting: { countries: ['CL'], ageMin: 18, ageMax: 65 },
      linkUrl: 'https://aitickets.cl/eventos/fiesta-techno?utm_source=meta&utm_medium=paid&utm_campaign=ad-42',
      adStatus: 'PAUSED',
    })
    expect(req.body.aiDisclosure).toBeUndefined()
    expect(req.body.endDate).toBe('2026-10-30T15:00:00.000Z')
  })

  it('imagen generada con IA en AI Tickets: se declara a Meta', () => {
    const { value } = validateAdInput(base({ imageUrl: 'https://ref.supabase.co/storage/v1/object/public/Events/promote/7-ai-123.webp' }), { connection, event, now: NOW })
    expect(buildAdRequest({ adCampaignId: 1, value, connection, event }).body.aiDisclosure).toBe('OPT_IN')
  })

  it('boost: el post publicado, desde la cuenta donde se publicó, con ciudad y radio', () => {
    const post = { status: 'published', zernio_post_id: 'zp_9' }
    const { value } = validateAdInput(base({ type: 'boost', geo: { type: 'city', key: '263039', radiusKm: 40 } }), { connection, event, post, now: NOW })
    const req = buildAdRequest({ adCampaignId: 7, value, connection, event, post, boostAccountId: 'zacc_fb' })
    expect(req.path).toBe('/ads/boost')
    expect(req.body).toMatchObject({ accountId: 'zacc_fb', postId: 'zp_9', targeting: { cities: [{ key: '263039', radius: 40, distance_unit: 'kilometer' }] } })
    expect(req.body.headline).toBeUndefined()
    expect(req.body.adStatus).toBeUndefined()
  })

  it('zernioRequest: Bearer, Idempotency-Key, query sin vacíos y error con código', async () => {
    const calls = fakeZernio({
      'GET /ads/accounts': () => ({ body: { accounts: [] } }),
      'POST /ads/create': () => ({ status: 403, body: { error: 'Ads allowance exceeded', code: 'ads_allowance_exceeded' } }),
    })
    await zernioRequest('/ads/accounts', { query: { accountId: 'a1', adAccountId: undefined, inScopeOnly: '' } })
    expect(calls[0].headers.Authorization).toBe('Bearer zk_test')
    expect([...calls[0].url.searchParams.keys()]).toEqual(['accountId'])
    const err = await zernioRequest('/ads/create', { method: 'POST', body: {}, idempotencyKey: 'k1' }).catch((e) => e)
    expect(calls[1].headers['Idempotency-Key']).toBe('k1')
    expect(err).toBeInstanceOf(ZernioError)
    expect(err).toMatchObject({ status: 403, code: 'ads_allowance_exceeded' })
    expect(friendlyAdsError(err)).toMatch(/no están disponibles/)
    expect(friendlyAdsError(new ZernioError(400, { error: 'x', platformError: { error_user_msg: 'Imagen con demasiado texto' } }))).toMatch(/Meta rechazó el anuncio: Imagen con demasiado texto/)
  })

  it('sin ZERNIO_API_KEY no hay anuncios', async () => {
    vi.stubEnv('ZERNIO_API_KEY', '')
    expect(adsEnabled()).toBe(false)
    await expect(zernioRequest('/ads')).rejects.toMatchObject({ code: 'not_configured' })
    vi.stubEnv('ZERNIO_API_KEY', 'zk')
    vi.stubEnv('ADS_ENABLED', 'false')
    expect(adsEnabled()).toBe(false)
  })
})

describe('estado, métricas y ventas', () => {
  it('mapea el anuncio de Zernio a la fila (rechazo en revisión = rechazado)', () => {
    expect(adRowPatch({ _id: 'z1', status: 'pending_review', reviewStatus: 'in_review', platformCampaignId: 'c1', platformAdSetId: 's1', platformAdId: 'a1' }))
      .toEqual({ zernio_ad_id: 'z1', status: 'pending_review', review_status: 'in_review', meta_campaign_id: 'c1', meta_adset_id: 's1', meta_ad_id: 'a1' })
    expect(adRowPatch({ status: 'active', reviewStatus: 'rejected', rejectionReason: 'Texto engañoso' })).toMatchObject({ status: 'rejected', error_message: 'Texto engañoso' })
    expect(adRowPatch({ status: 'raro' }).status).toBeUndefined()
    expect(metricsPatch({ spend: 12500.5, impressions: 3000.4, clicks: 80, ctr: 2.6, reach: 'x' })).toMatchObject({ spend: 12500.5, impressions: 3000, clicks: 80, ctr: 2.6, reach: 0 })
  })

  it('ventas por anuncio: utm_campaign=ad-<id>, sin cortesías, con ventana opcional', () => {
    expect(adCampaignIdFromUtm('AD-15')).toBe(15)
    expect(adCampaignIdFromUtm('reporte-semanal')).toBeNull()
    expect(adTrackingUrl('x', 5)).toContain('utm_campaign=ad-5')
    const orders = [
      { utm_campaign: 'ad-5', created_at: '2026-10-20T10:00:00Z', amount: 20000, ticket_qty: 2 },
      { utm_campaign: 'ad-5', created_at: '2026-10-10T10:00:00Z', amount: 10000, ticket_qty: 1 },
      { utm_campaign: 'ad-5', created_at: '2026-10-20T10:00:00Z', amount: 0, ticket_qty: 1, payment_provider: 'courtesy' },
      { utm_campaign: 'ad-6', created_at: '2026-10-21T10:00:00Z', amount: 15000, ticket_qty: 1 },
      { utm_campaign: null, created_at: '2026-10-21T10:00:00Z', amount: 15000, ticket_qty: 1 },
    ]
    expect(salesByAd(orders).get(5)).toEqual({ tickets: 3, revenue_clp: 30000, orders: 2 })
    expect(salesByAd(orders, { from: new Date('2026-10-18T03:00:00Z'), to: new Date('2026-10-25T03:00:00Z') }).get(5)).toEqual({ tickets: 2, revenue_clp: 20000, orders: 1 })
    expect(adEfficiency(10000, 4, 60000)).toEqual({ cost_per_ticket: 2500, roas: 6 })
    expect(adEfficiency(12, 4, 60000, 'USD')).toEqual({ cost_per_ticket: 3, roas: null })
    expect(adEfficiency(0, 0, 0)).toEqual({ cost_per_ticket: null, roas: null })
  })
})

describe('creación sin duplicar', () => {
  let db
  const row = (over = {}) => ({ id: 42, organization_id: 7, status: 'creating', created_at: '2026-10-25T14:00:00Z', zernio_request: { path: '/ads/create', body: { name: 'x' } }, ...over })
  beforeEach(() => {
    db = createFakeSupabase({ tables: { ad_campaigns: [row()] } })
  })

  it('guarda ids y estado; la clave es la misma en cada intento', async () => {
    const calls = fakeZernio({ 'POST /ads/create': () => ({ status: 201, body: { ad: { _id: 'zad1', status: 'pending_review', reviewStatus: 'in_review', platformAdId: '9' } } }) })
    const out = await submitAdRequest(db, row(), { now: NOW })
    expect(out.ok).toBe(true)
    expect(calls[0].headers['Idempotency-Key']).toBe('aitickets-ad-42')
    expect(calls[0].body).toEqual({ name: 'x' })
    expect(db.tables.ad_campaigns[0]).toMatchObject({ zernio_ad_id: 'zad1', status: 'pending_review', meta_ad_id: '9', error_message: null })
  })

  it('timeout o 5xx: queda "creating" para reintentar con la misma clave; un rechazo queda "error"', async () => {
    fakeZernio({ 'POST /ads/create': () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }) })
    const pending = await submitAdRequest(db, row(), { now: NOW })
    expect(pending).toMatchObject({ ok: false, pending: true })
    expect(db.tables.ad_campaigns[0].status).toBe('creating')

    fakeZernio({ 'POST /ads/create': () => ({ status: 400, body: { error: 'budgetAmount below minimum', code: 'invalid_field_value' } }) })
    const rejected = await submitAdRequest(db, row(), { now: NOW })
    expect(rejected).toMatchObject({ ok: false, pending: false })
    expect(db.tables.ad_campaigns[0]).toMatchObject({ status: 'error' })
    expect(db.tables.ad_campaigns[0].error_message).toMatch(/budgetAmount below minimum/)
  })

  it('recuperación: espera 1 min, reintenta hasta 24 h y después da el anuncio por fallido', async () => {
    const calls = fakeZernio({ 'POST /ads/create': () => ({ status: 201, body: { ad: { _id: 'zad2', status: 'active' } } }) })
    expect(await recoverCreatingAd(db, row({ created_at: '2026-10-25T14:59:30Z' }), { now: NOW })).toMatchObject({ status: 'creating' })
    expect(calls).toHaveLength(0)
    expect(await recoverCreatingAd(db, row(), { now: NOW })).toMatchObject({ status: 'active', zernio_ad_id: 'zad2' })
    const old = await recoverCreatingAd(db, row({ created_at: '2026-10-23T10:00:00Z' }), { now: NOW })
    expect(old.status).toBe('error')
    expect(calls).toHaveLength(1)
  })
})

describe('cuentas publicitarias', () => {
  it('guarda las de la conexión (moneda, mínimo, si sirve) y marca las que ya no ve', async () => {
    const db = createFakeSupabase({
      tables: {
        ad_account_connections: [
          { id: 1, organization_id: 7, provider: 'zernio', zernio_account_id: 'zacc', meta_ad_account_id: 'act_1', status: 'revoked' },
          { id: 2, organization_id: 7, provider: 'zernio', zernio_account_id: 'zacc', meta_ad_account_id: 'act_old', status: 'active' },
        ],
      },
    })
    fakeZernio({
      'GET /ads/accounts': () => ({
        body: {
          accounts: [
            { id: 'act_1', name: 'Prod SpA', currency: 'clp', minimumDailyBudget: 1050, selectable: true, timezoneName: 'America/Santiago' },
            { id: 'act_2', name: 'Cuenta deshabilitada', currency: 'USD', selectable: false, unusableReason: 'Pago pendiente' },
            { id: 'no-es-meta', name: 'x' },
          ],
        },
      }),
    })
    expect(await syncAdAccounts(db, 7, 'zacc', { now: NOW })).toBe(2)
    const byAct = Object.fromEntries(db.tables.ad_account_connections.map((r) => [r.meta_ad_account_id, r]))
    expect(byAct.act_1).toMatchObject({ id: 1, status: 'active', currency: 'CLP', minimum_daily_budget: 1050, account_name: 'Prod SpA' })
    expect(byAct.act_2).toMatchObject({ status: 'unusable', unusable_reason: 'Pago pendiente', currency: 'USD', provider: 'zernio' })
    expect(byAct.act_old).toMatchObject({ status: 'unusable' })
    expect(byAct['no-es-meta']).toBeUndefined()
  })
})
