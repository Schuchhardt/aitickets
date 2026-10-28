// Segmentar anuncios por intereses y cargo (netlify/lib/zernio-ads.mjs): buscador de Zernio (dimensiones interest y
// workPosition de /ads/targeting/search), validación de lo elegido y TargetingSpec que llega a Meta en create y boost.
// Zernio falso (fetch inyectado): sin red.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AD_LIMITS, adTargeting, buildAdRequest, searchAdAudience, validateAdInput } from '../../netlify/lib/zernio-ads.mjs'

const NOW = new Date('2026-10-25T15:00:00Z')
const connection = { id: 3, zernio_account_id: 'zacc_ads', meta_ad_account_id: 'act_111', currency: 'CLP', minimum_daily_budget: 1000 }
const event = { id: 10, name: 'Fiesta Reggaetón', slug: 'fiesta-reggaeton', start_date: '2026-11-07T01:00:00Z', end_date: '2026-11-07T07:00:00Z' }
const base = (over = {}) => ({
  type: 'standalone',
  headline: 'Fiesta Reggaetón · sáb 7',
  body: 'Perreo hasta que salga el sol.',
  imageUrl: 'https://ref.supabase.co/storage/v1/object/public/Events/promote/7-upload-abc.webp',
  dailyBudget: 5000,
  days: 5,
  confirmSpend: true,
  confirmTotal: 25000,
  ...over,
})

let calls
beforeEach(() => {
  process.env.ZERNIO_API_KEY = 'zk_test'
  calls = []
  globalThis.fetch = vi.fn(async (url) => {
    const u = new URL(url)
    calls.push(u)
    const dim = u.searchParams.get('dimension')
    const results =
      dim === 'interest'
        ? [{ id: '6003107902433', name: 'Reggaetón', type: 'interest', path: ['Interests', 'Música', 'Reggaetón'], audienceSize: 1_200_000 }, { id: 'x', name: '' }]
        : [{ id: '108240792538353', name: 'Gerente de recursos humanos', type: 'workPosition', audienceSize: null }]
    return new Response(JSON.stringify({ results }), { status: 200 })
  })
})
afterEach(() => {
  delete process.env.ZERNIO_API_KEY
  vi.restoreAllMocks()
})

describe('buscador de público', () => {
  it('busca intereses en Meta vía Zernio (dimension=interest, en español) y descarta resultados sin nombre', async () => {
    const out = await searchAdAudience('zacc_ads', 'reggaeton', 'interest')
    expect(calls[0].pathname).toBe('/api/v1/ads/targeting/search')
    expect(Object.fromEntries(calls[0].searchParams)).toMatchObject({ accountId: 'zacc_ads', q: 'reggaeton', dimension: 'interest', locale: 'es_LA' })
    expect(out).toEqual([{ id: '6003107902433', name: 'Reggaetón', path: ['Interests', 'Música', 'Reggaetón'], audienceSize: 1_200_000 }])
  })

  it('busca cargos (dimension=workPosition); otra dimensión no se manda', async () => {
    const out = await searchAdAudience('zacc_ads', 'recursos humanos', 'workPosition')
    expect(calls[0].searchParams.get('dimension')).toBe('workPosition')
    expect(out[0]).toMatchObject({ id: '108240792538353', audienceSize: null })
    await expect(searchAdAudience('zacc_ads', 'x', 'behavior')).rejects.toThrow(/no soportada/)
    expect(calls).toHaveLength(1)
  })
})

describe('validación y TargetingSpec', () => {
  it('hasta 3 intereses y 3 cargos, sin repetidos, viajan a Meta con su nombre', () => {
    const interests = [{ id: '6003107902433', name: 'Reggaetón' }, { id: '6003107902433', name: 'Reggaetón' }, { id: '6003139266461', name: 'Música latina' }]
    const workPositions = [{ id: '108240792538353', name: 'Gerente de recursos humanos' }]
    const check = validateAdInput(base({ interests, workPositions }), { connection, event, now: NOW })
    expect(check.ok).toBe(true)
    expect(check.value.interests).toHaveLength(2)
    expect(adTargeting(check.value)).toEqual({
      countries: ['CL'],
      ageMin: 18,
      ageMax: 65,
      interests: [{ id: '6003107902433', name: 'Reggaetón' }, { id: '6003139266461', name: 'Música latina' }],
      workPositions: [{ id: '108240792538353', name: 'Gerente de recursos humanos' }],
    })
    const req = buildAdRequest({ adCampaignId: 44, value: check.value, connection, event })
    expect(req.body.targeting.interests).toHaveLength(2)
  })

  it('sin intereses ni cargos, la segmentación queda como antes (sin campos vacíos)', () => {
    const check = validateAdInput(base(), { connection, event, now: NOW })
    expect(adTargeting(check.value)).toEqual({ countries: ['CL'], ageMin: 18, ageMax: 65 })
  })

  it('rechaza más del máximo, ids que no vienen del buscador o una lista mal formada', () => {
    const many = Array.from({ length: AD_LIMITS.maxInterests + 1 }, (_, i) => ({ id: String(600 + i), name: `I${i}` }))
    expect(validateAdInput(base({ interests: many }), { connection, event, now: NOW }).errors).toContain(`Elige como mucho ${AD_LIMITS.maxInterests} intereses.`)
    expect(validateAdInput(base({ workPositions: [{ id: 'abc', name: 'x' }] }), { connection, event, now: NOW }).errors).toContain('Elige los cargos desde el buscador.')
    expect(validateAdInput(base({ interests: 'reggaeton' }), { connection, event, now: NOW }).errors).toContain('Los intereses no son válidos.')
  })

  it('el boost también lleva los intereses', () => {
    const check = validateAdInput(base({ type: 'boost', interests: [{ id: '6003107902433', name: 'Reggaetón' }] }), { connection, event, post: { zernio_post_id: 'p1', status: 'published' }, now: NOW })
    const req = buildAdRequest({ adCampaignId: 45, value: check.value, connection, event, post: { zernio_post_id: 'p1' }, boostAccountId: 'acc-fb' })
    expect(req.path).toBe('/ads/boost')
    expect(req.body.targeting.interests).toEqual([{ id: '6003107902433', name: 'Reggaetón' }])
  })
})
