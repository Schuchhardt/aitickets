// Posts manuales en Instagram, Facebook, TikTok y LinkedIn (src/lib/socialPlatforms.ts, publishSocialPost en
// src/lib/marketing.ts y create_social_post / publish_social_post): reglas de cada red, cuerpo que llega a Zernio
// (TikTok con sus ajustes obligatorios, LinkedIn como texto con o sin imagen) y conexión de las redes nuevas.
// Supabase y Zernio falsos: sin red.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { postMediaProblem, isSocialPlatform, tiktokTitle, SOCIAL_PLATFORMS } = await import('../../src/lib/socialPlatforms.ts')
const { socialPostPayload, publishSocialPost } = await import('../../src/lib/marketing.ts')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')

const SITE = 'https://aitickets.cl'
const IMG = 'https://proj.supabase.co/storage/v1/object/public/Events/promote/7-upload-a.jpg'
let zernioBodies

beforeEach(() => {
  process.env.ZERNIO_API_KEY = 'zk_test'
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  zernioBodies = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    if (String(url) === 'https://zernio.com/api/v1/posts' && init.method === 'POST') {
      zernioBodies.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ post: { _id: 'zp1' } }), { status: 201 })
    }
    return new Response('{}', { status: 404 })
  })
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Seminarios Dire', zernio_profile_id: 'prof-7' }],
      events: [{ id: 30, name: 'Seminario de RR. HH.', slug: 'seminario-rrhh', status: 'published', organization_id: 7, cancelled_at: null }],
      social_accounts: [
        { id: 1, organization_id: 7, platform: 'linkedin', zernio_account_id: 'acc-li-7', account_name: 'Dire Consultores', status: 'active' },
        { id: 2, organization_id: 7, platform: 'tiktok', zernio_account_id: 'acc-tt-7', account_name: '@dire', status: 'active' },
      ],
      social_posts: [],
      aitickets_api_audit: [],
      aitickets_api_confirmations: [],
      aitickets_api_idempotency: [],
    },
  })
})
afterEach(() => {
  delete process.env.ZERNIO_API_KEY
  delete process.env.SUPABASE_URL
  vi.restoreAllMocks()
})

const ctx = () => ({
  supabase: db,
  actor: { keyId: null, userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'ana@dire.cl', scopes: ['read', 'write', 'publish'], eventIds: null },
  origin: SITE,
  requestUrl: new URL(`${SITE}/api/x`),
  channel: 'mcp',
})

describe('reglas de cada red', () => {
  it('Instagram y TikTok piden imagen; LinkedIn, hasta 3.000 caracteres; Facebook y LinkedIn aceptan solo texto', () => {
    expect(SOCIAL_PLATFORMS).toEqual(['instagram', 'facebook', 'tiktok', 'linkedin'])
    expect(isSocialPlatform('linkedin')).toBe(true)
    expect(isSocialPlatform('twitter')).toBe(false)
    expect(postMediaProblem(['linkedin', 'facebook'], 0, 500)).toBeNull()
    expect(postMediaProblem(['tiktok'], 0, 10)).toBe('TikTok requiere al menos una imagen.')
    expect(postMediaProblem(['linkedin'], 1, 3001)).toMatch(/máximo de LinkedIn \(3\.000/)
    expect(postMediaProblem(['instagram'], 11, 10)).toBe('Instagram acepta hasta 10 imágenes.')
    expect(postMediaProblem(['twitter'], 1, 10)).toMatch(/no soportada/)
  })

  it('título de TikTok: primera línea sin links ni hashtags, hasta 90 caracteres', () => {
    expect(tiktokTitle('¡Se viene el seminario! https://x.cl #rrhh\nmás texto')).toBe('¡Se viene el seminario!')
    expect(tiktokTitle('a'.repeat(120))).toHaveLength(90)
  })
})

describe('cuerpo a Zernio', () => {
  it('LinkedIn: texto e imágenes tal cual; TikTok: photo post con descripción y consentimiento', () => {
    const payload = socialPostPayload({ content: 'Seminario de RR. HH.\n\nInscríbete: https://aitickets.cl/eventos/seminario-rrhh', image_urls: [IMG] }, [
      { platform: 'linkedin', zernio_account_id: 'acc-li-7' },
      { platform: 'tiktok', zernio_account_id: 'acc-tt-7' },
    ])
    expect(payload.platforms).toEqual([
      { platform: 'linkedin', accountId: 'acc-li-7' },
      { platform: 'tiktok', accountId: 'acc-tt-7', customContent: 'Seminario de RR. HH.' },
    ])
    expect(payload.mediaItems).toEqual([{ type: 'image', url: IMG }])
    expect(payload.tiktokSettings).toMatchObject({ media_type: 'photo', privacy_level: 'PUBLIC_TO_EVERYONE', content_preview_confirmed: true, express_consent_given: true })
    expect(payload.tiktokSettings.description).toContain('Inscríbete')
  })

  it('solo LinkedIn y sin imagen: post de texto, sin ajustes de TikTok', () => {
    const payload = socialPostPayload({ content: 'Hola', image_urls: [] }, [{ platform: 'linkedin', zernio_account_id: 'acc-li-7' }])
    expect(payload).toEqual({ content: 'Hola', platforms: [{ platform: 'linkedin', accountId: 'acc-li-7' }] })
  })
})

describe('herramientas de posts', () => {
  it('create_social_post acepta LinkedIn sin imagen y publish_social_post lo publica en la página conectada', async () => {
    const created = await runTool(getTool('create_social_post'), { event_id: 30, content: 'Seminario de RR. HH. el jueves 3. Inscríbete en el link.', platforms: ['linkedin'] }, ctx())
    expect(created).toMatchObject({ ok: true })
    const postId = created.result.post.id
    const first = await runTool(getTool('publish_social_post'), { post_id: postId }, ctx())
    expect(first.result.status).toBe('confirmation_required')
    expect(first.result.summary).toMatch(/LinkedIn \(Dire Consultores\)/)
    const out = await runTool(getTool('publish_social_post'), { post_id: postId, confirmation_token: first.result.confirmation_token }, ctx())
    expect(out).toMatchObject({ ok: true, result: { status: 'published' } })
    expect(zernioBodies[0]).toMatchObject({ content: expect.stringMatching(/^Seminario/), platforms: [{ platform: 'linkedin', accountId: 'acc-li-7' }], publishNow: true })
  })

  it('create_social_post: TikTok sin imagen se rechaza; LinkedIn con imagen y texto largo se guarda', async () => {
    const tiktok = await runTool(getTool('create_social_post'), { event_id: 30, content: 'Hola', platforms: ['tiktok'] }, ctx())
    expect(tiktok).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(tiktok.message).toMatch(/TikTok requiere al menos una imagen/)
    const long = await runTool(getTool('create_social_post'), { event_id: 30, content: 'a'.repeat(2100), platforms: ['linkedin'], image_urls: [IMG] }, ctx())
    expect(long).toMatchObject({ ok: true })
    expect(db.tables.social_posts.at(-1).platforms).toEqual(['linkedin'])
  })

  it('publishSocialPost con TikTok manda los ajustes obligatorios', async () => {
    db.tables.social_posts.push({ id: 90, organization_id: 7, event_id: 30, content: 'Foto del seminario', image_urls: [IMG], platforms: ['tiktok'], status: 'draft', scheduled_for: null })
    const out = await publishSocialPost(7, 90)
    expect(out).toMatchObject({ ok: true, status: 'published' })
    expect(zernioBodies[0].tiktokSettings).toMatchObject({ media_type: 'photo', description: 'Foto del seminario' })
  })
})
