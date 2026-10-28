// Difusión automática en Facebook y TikTok y el reel con el video del evento (src/lib/socialSeries.ts,
// socialSeriesCadence.ts): reparto del plan por red, video que sirve como reel, cuerpo de cada post a Zernio (historia de
// página, photo post de TikTok, reels), y que una red que falla o se desconecta no frene a las demás (y se retome al
// reconectarla). Supabase y Zernio falsos: sin red.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let zernioCalls
let zernioHandler

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/pages/api/_lib/server-utils', async (orig) => ({ ...(await orig()), notifySlack: async () => {} }))
vi.mock('../../netlify/lib/mailer.mjs', async (orig) => ({ ...(await orig()), sendEmail: async () => ({ id: 'm1' }) }))
vi.mock('../../netlify/lib/zernio-ads.mjs', async (orig) => {
  const real = await orig()
  return { ...real, zernioRequest: async (path, opts = {}) => {
    zernioCalls.push({ path, method: opts.method || 'GET', body: opts.body, idempotencyKey: opts.idempotencyKey })
    return zernioHandler(path, opts, real)
  } }
})

const { planSlots, expandNetworkSlots, reelSlot, REEL_DAYS } = await import('../../src/lib/socialSeriesCadence.ts')
const { pieceText } = await import('../../src/lib/socialSeriesRender.ts')
const S = await import('../../src/lib/socialSeries.ts')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')
const { santiagoToDate } = await import('../../src/pages/api/_lib/server-utils.ts')
const { MK_REEL_DAYS, marketingWeek, marketingPostCount } = await import('../../src/components/landing/producerLanding.js')

const SITE = 'https://aitickets.cl'
const local = (date, time) => santiagoToDate(date, time).toISOString()
const ACTIVATION = local('2026-10-26', '13:00')
const EVENT_START = local('2026-11-08', '12:00')
const VIDEO = { url: 'https://proj.supabase.co/storage/v1/object/public/Events/videos/2296-cover.mp4', poster_url: null, width: 1080, height: 1920, duration: 15, mime: 'video/mp4' }

let postSeq = 0
const hex24 = () => (++postSeq).toString(16).padStart(24, '0')
function defaultZernio(path, opts, real) {
  if (path === '/posts' && opts.method === 'POST') return { post: { _id: hex24() } }
  if (path === '/comment-automations' && opts.method === 'POST') return { automation: { id: `auto-${zernioCalls.length}` } }
  if (path.startsWith('/comment-automations/') && opts.method === 'PATCH') return { success: true }
  if (opts.method === 'DELETE') return { success: true }
  if (path.startsWith('/comment-automations/')) return { automation: { stats: {} } }
  throw new real.ZernioError(404, { error: `ruta no simulada ${path}` })
}
const setNow = (iso) => vi.useFakeTimers({ now: new Date(iso), toFake: ['Date'] })

beforeEach(() => {
  process.env.ZERNIO_API_KEY = 'zk_test'
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  zernioCalls = []
  zernioHandler = defaultZernio
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Escuela de Música del Dire', zernio_profile_id: 'prof-7' }],
      users: [{ id: 1, name: 'Ana', email: 'ana@dire.cl', organization_id: 7, role: 'producer', active: true }],
      events: [
        {
          id: 2296,
          name: 'Concierto de Primavera',
          slug: 'concierto-de-primavera-2296',
          status: 'published',
          organization_id: 7,
          description: '<p>Un concierto al aire libre con los alumnos de la escuela y música de cámara.</p>',
          start_date: EVENT_START,
          end_date: local('2026-11-08', '14:00'),
          image_url: null,
          cover_video: VIDEO,
          gallery_video: null,
          cancelled_at: null,
          archived_at: null,
          location: 'Escuela de Música del Dire, Santiago',
          event_dates: [{ date: '2026-11-08', start_time: '12:00:00', end_time: '14:00:00' }],
          event_locations: [{ venues: { name: 'Escuela de Música del Dire', city: 'Santiago' } }],
        },
      ],
      event_tickets: [{ id: 50, event_id: 2296, ticket_name: 'General', price: 5000, total_quantity: 350, is_gift: false, status: 'available' }],
      event_visits: [],
      event_orders: [],
      social_accounts: [
        { id: 1, organization_id: 7, platform: 'instagram', zernio_account_id: 'acc-ig-7', account_name: '@escueladire', status: 'active' },
        { id: 2, organization_id: 7, platform: 'facebook', zernio_account_id: 'acc-fb-7', account_name: 'Escuela Dire', status: 'active' },
        { id: 3, organization_id: 7, platform: 'tiktok', zernio_account_id: 'acc-tt-7', account_name: '@escueladire', status: 'active' },
      ],
      aitickets_sites: [],
      aitickets_platform_settings: [],
      aitickets_social_series: [],
      aitickets_social_series_slots: [],
      aitickets_zernio_webhook_events: [],
      aitickets_api_audit: [],
      aitickets_api_confirmations: [],
      aitickets_api_idempotency: [],
    },
    rpc: { aitickets_ticket_availability: () => [{ ticket_id: 50, sold: 67, pending: 0 }] },
    defaults: {
      aitickets_social_series: { feed_posts_enabled: true, sold_out_story_enabled: false, keyword: 'ENTRADAS', extra_keywords: ['entrada', 'link'], cadence_config: {}, status: 'draft', networks: {}, reel_enabled: true },
      aitickets_social_series_slots: { variant: 'countdown', attempts: 0, platform: 'instagram' },
    },
    unique: { aitickets_zernio_webhook_events: [['event_id']], aitickets_api_idempotency: [['organization_id', 'tool', 'idem_key']] },
  })
  db.storage = {
    from: () => ({
      upload: async () => ({ error: null }),
      getPublicUrl: (path) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/Events/${path}` } }),
    }),
  }
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.ZERNIO_API_KEY
  delete process.env.SUPABASE_URL
})

const ctx = () => ({
  supabase: db,
  actor: { keyId: null, userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'ana@dire.cl', scopes: ['read', 'write', 'publish', 'attendees', 'finance', 'team'], eventIds: null },
  origin: SITE,
  requestUrl: new URL(`${SITE}/api/events/social-series`),
  channel: 'dashboard',
})
const call = async (name, args) => {
  const out = await runTool(getTool(name), args, ctx())
  if (!out.ok) throw new Error(`${name}: ${out.code} ${out.message}`)
  return out.result
}
const confirmCall = async (name, args) => {
  const first = await call(name, args)
  expect(first.status).toBe('confirmation_required')
  return call(name, { ...args, confirmation_token: first.confirmation_token })
}
const series = () => db.tables.aitickets_social_series[0]
const slots = () => db.tables.aitickets_social_series_slots
const of = (platform, status) => slots().filter((s) => s.platform === platform && (!status || s.status === status))
const activateAll = async (opts = {}) => {
  setNow(ACTIVATION)
  await call('prepare_social_series', { event_id: 2296, facebook_enabled: true, tiktok_enabled: true, ...opts })
  return confirmCall('approve_social_series', { event_id: 2296 })
}
const posts = () => zernioCalls.filter((c) => c.path === '/posts' && c.method === 'POST')

// ---------------------------------------------------------------------------

describe('reparto del plan por red', () => {
  const plan = () => planSlots({ anchorStart: new Date(EVENT_START), now: new Date(ACTIVATION), publishTime: '21:00', feedPosts: true })

  it('Facebook repite historias y posts; TikTok, una foto por día de la última semana; el reel sale en D-3 en cada red', () => {
    const out = expandNetworkSlots(plan(), { platforms: ['instagram', 'facebook', 'tiktok'], reel: true })
    const count = (p, k) => out.filter((s) => s.platform === p && (!k || s.kind === k)).length
    expect([count('instagram', 'story'), count('instagram', 'feed_post'), count('instagram', 'reel')]).toEqual([10, 7, 1])
    expect([count('facebook', 'story'), count('facebook', 'feed_post'), count('facebook', 'reel')]).toEqual([10, 7, 1])
    // D-7 a D-0 = 8 días, menos el día del reel (TikTok publica el video en vez de la foto)
    expect(count('tiktok', 'feed_post')).toBe(7)
    expect(count('tiktok', 'reel')).toBe(1)
    expect(out.filter((s) => s.kind === 'reel').every((s) => s.days_to_event === REEL_DAYS && s.publish_at === local('2026-11-05', '21:00'))).toBe(true)
    expect(out.filter((s) => s.platform === 'tiktok').map((s) => s.days_to_event)).toEqual([7, 6, 5, 4, 3, 2, 1, 0])
  })

  it('solo Instagram y sin video: el plan de siempre', () => {
    const out = expandNetworkSlots(plan(), { platforms: ['instagram'], reel: false })
    expect(out).toHaveLength(17)
    expect(out.every((s) => s.platform === 'instagram' && s.kind !== 'reel')).toBe(true)
  })

  it('el reel toma el día con historia más cercano a D-3; sin días en la banda diaria, no hay reel', () => {
    const late = planSlots({ anchorStart: new Date(EVENT_START), now: new Date(local('2026-11-06', '22:00')), publishTime: '21:00', feedPosts: true })
    expect(reelSlot(late)?.days_to_event).toBe(1)
    const sameDay = planSlots({ anchorStart: new Date(EVENT_START), now: new Date(local('2026-11-07', '22:00')), publishTime: '21:00', feedPosts: true })
    expect(reelSlot(sameDay)).toBeNull()
  })

  it('la demo de la landing usa los mismos días antes de la función para el reel', () => {
    expect(MK_REEL_DAYS).toBe(REEL_DAYS)
    const times = { daily: '19:30', eventDay: '09:00' }
    expect(marketingPostCount(marketingWeek({ story: true, post: true, reel: true }, times)) - marketingPostCount(marketingWeek({ story: true, post: true }, times))).toBe(1)
  })
})

describe('video del evento como reel', () => {
  it('sirve un MP4/MOV vertical de 3 a 60 s (portada o, si no, galería)', () => {
    expect(S.reelVideoFor({ cover_video: VIDEO })).toMatchObject({ url: VIDEO.url, duration: 15 })
    expect(S.reelVideoFor({ cover_video: { ...VIDEO, width: 1920, height: 1080 } })).toBeNull()
    expect(S.reelVideoFor({ cover_video: { ...VIDEO, duration: 90 } })).toBeNull()
    expect(S.reelVideoFor({ cover_video: { ...VIDEO, duration: 2 } })).toBeNull()
    expect(S.reelVideoFor({ cover_video: { ...VIDEO, mime: 'video/webm', url: 'https://x.co/v.webm' } })).toBeNull()
    expect(S.reelVideoFor({ cover_video: { ...VIDEO, width: 1920, height: 1080 }, gallery_video: { ...VIDEO, url: 'https://x.co/g.mp4' } })?.url).toBe('https://x.co/g.mp4')
    expect(S.reelVideoFor({})).toBeNull()
  })
})

describe('cuerpo de cada post a Zernio', () => {
  const base = { accountId: 'acc', imageUrl: 'https://cdn/x.jpg', videoUrl: 'https://cdn/v.mp4', scheduledFor: '2026-11-05T00:00:00.000Z', metadata: { aitickets_slot_id: '9' } }
  it('historia de página de Facebook y reel de Facebook con contentType', () => {
    expect(S.slotPostBody({ ...base, platform: 'facebook', kind: 'story', caption: null })).toMatchObject({
      mediaItems: [{ type: 'image', url: base.imageUrl }],
      platforms: [{ platform: 'facebook', accountId: 'acc', platformSpecificData: { contentType: 'story' } }],
    })
    expect(S.slotPostBody({ ...base, platform: 'facebook', kind: 'reel', caption: 'Hola' })).toMatchObject({
      content: 'Hola',
      mediaItems: [{ type: 'video', url: base.videoUrl }],
      platforms: [{ platform: 'facebook', platformSpecificData: { contentType: 'reel' } }],
    })
  })
  it('Instagram: un video solo es reel (sin contentType)', () => {
    const body = S.slotPostBody({ ...base, platform: 'instagram', kind: 'reel', caption: 'Hola' })
    expect(body.platforms[0]).not.toHaveProperty('platformSpecificData')
    expect(body.mediaItems[0].type).toBe('video')
  })
  it('TikTok: photo post con título corto, descripción completa y los ajustes obligatorios', () => {
    const caption = `Concierto de Primavera: ¡Faltan 4 días! https://aitickets.cl/x #musica\n\nUn concierto al aire libre.\n\nEntradas: https://aitickets.cl/eventos/x?ref=tiktok-serie`
    const body = S.slotPostBody({ ...base, platform: 'tiktok', kind: 'feed_post', caption })
    expect(body.content).toBe('Concierto de Primavera: ¡Faltan 4 días!')
    expect(body.tiktokSettings).toMatchObject({
      privacy_level: 'PUBLIC_TO_EVERYONE',
      allow_comment: true,
      media_type: 'photo',
      description: caption,
      content_preview_confirmed: true,
      express_consent_given: true,
      commercialContentType: 'brand_organic',
    })
    const video = S.slotPostBody({ ...base, platform: 'tiktok', kind: 'reel', caption })
    expect(video.content).toBe(caption)
    expect(video.tiktokSettings).toMatchObject({ allow_duet: false, allow_stitch: false })
    expect(video.tiktokSettings).not.toHaveProperty('media_type')
  })
  it('las piezas de Facebook y TikTok dicen dónde comprar en vez de la palabra clave', () => {
    const d = { kind: 'story', variant: 'countdown', daysToEvent: 4, eventName: 'X', dateLabel: 'domingo 8 de noviembre', startTime: '12:00', venue: null, keyword: 'ENTRADAS', remaining: null, styleIndex: 0 }
    expect(pieceText(d).cta).toBe('Responde ENTRADAS y te mandamos el link')
    expect(pieceText({ ...d, linkLabel: 'aitickets.cl/eventos/x' }).cta).toBe('Entradas en aitickets.cl/eventos/x')
    expect(pieceText({ ...d, daysToEvent: 0, linkLabel: 'aitickets.cl/eventos/x' }).cta).toBe('Entradas en aitickets.cl/eventos/x o en puerta')
    expect(S.shortEventLink('https://www.aitickets.cl', 'x')).toBe('aitickets.cl/eventos/x')
  })
})

describe('preparar y aprobar con Facebook y TikTok', () => {
  it('el borrador cuenta las piezas por red y el reel; aprobar guarda cada red con su cuenta', async () => {
    setNow(ACTIVATION)
    const view = await call('prepare_social_series', { event_id: 2296, facebook_enabled: true, tiktok_enabled: true })
    expect(view.networks.facebook).toMatchObject({ connected: true, enabled: true, account: 'Escuela Dire' })
    expect(view.plan).toMatchObject({ stories: 10, feed_posts: 7, facebook_posts: 17, tiktok_posts: 7 })
    expect(view.plan.reels.map((r) => r.platform)).toEqual(['instagram', 'facebook', 'tiktok'])
    expect(view.reel).toMatchObject({ available: true, enabled: true })

    const first = await call('approve_social_series', { event_id: 2296 })
    expect(first.summary).toMatch(/Facebook \(Escuela Dire\): 17 pieza/)
    expect(first.summary).toMatch(/TikTok \(@escueladire\): 7 post/)
    expect(first.summary).toMatch(/reel con el video del evento/)
    await call('approve_social_series', { event_id: 2296, confirmation_token: first.confirmation_token })

    expect(series().networks).toMatchObject({
      facebook: { enabled: true, account_id: 'acc-fb-7', status: 'active' },
      tiktok: { enabled: true, account_id: 'acc-tt-7', status: 'active' },
    })
    expect(of('instagram')).toHaveLength(18)
    expect(of('facebook')).toHaveLength(18)
    expect(of('tiktok')).toHaveLength(8)
    expect(slots().filter((s) => s.kind === 'reel').every((s) => s.video_url === VIDEO.url)).toBe(true)
  })

  it('una red activada sin cuenta conectada bloquea la aprobación; sin reel si se apaga', async () => {
    db.tables.social_accounts = db.tables.social_accounts.filter((a) => a.platform !== 'tiktok')
    setNow(ACTIVATION)
    const view = await call('prepare_social_series', { event_id: 2296, tiktok_enabled: true, reel_enabled: false })
    expect(view.can_activate).toBe(false)
    expect(view.blockers.join(' ')).toMatch(/Conecta tu TikTok/)
    const out = await runTool(getTool('approve_social_series'), { event_id: 2296 }, ctx())
    expect(out).toMatchObject({ ok: false, code: 'invalid_input' })
    await call('prepare_social_series', { event_id: 2296, tiktok_enabled: false })
    await confirmCall('approve_social_series', { event_id: 2296 })
    expect(slots().every((s) => s.platform === 'instagram' && s.kind !== 'reel')).toBe(true)
  })
})

describe('despacho por red', () => {
  it('D-4: historia y post en Instagram y Facebook, y la foto de TikTok, cada uno con lo suyo', async () => {
    await activateAll()
    setNow(local('2026-11-04', '18:00'))
    const summary = await S.runSeriesJobs(db, { origin: SITE, budgetMs: 120_000 })
    expect(summary.dispatched).toBe(5)
    const byPlatform = (p) => posts().filter((c) => c.body.platforms[0].platform === p)
    const [fbStory, fbPost] = [byPlatform('facebook').find((c) => c.body.platforms[0].platformSpecificData), byPlatform('facebook').find((c) => !c.body.platforms[0].platformSpecificData)]
    expect(fbStory.body).not.toHaveProperty('content')
    expect(fbStory.body.platforms[0]).toMatchObject({ accountId: 'acc-fb-7', platformSpecificData: { contentType: 'story' } })
    expect(fbPost.body.content).toMatch(/Faltan 4 días/)
    expect(fbPost.body.content).toMatch(/Comenta ENTRADAS y te mandamos el link por Messenger 📩\nEntradas: https:\/\/aitickets\.cl\/eventos\/concierto-de-primavera-2296\?ref=fb-serie$/)
    const tiktok = byPlatform('tiktok')[0]
    expect(tiktok.body.content.length).toBeLessThanOrEqual(90)
    expect(tiktok.body.tiktokSettings).toMatchObject({ media_type: 'photo', description: expect.stringContaining('ref=tiktok-serie') })
    // El texto del día es el mismo en las tres redes (una sola generación)
    const igPost = byPlatform('instagram').find((c) => !c.body.platforms[0].platformSpecificData)
    expect(igPost.body.content.split('\n\nComenta')[0]).toBe(fbPost.body.content.split('\n\nComenta')[0])
    // DM por comentarios: Instagram y Facebook (Messenger); TikTok no tiene
    const automations = zernioCalls.filter((c) => c.path === '/comment-automations' && c.body.trigger === 'comment')
    expect(automations.map((a) => a.body.accountId).sort()).toEqual(['acc-fb-7', 'acc-ig-7'])
    expect(automations.find((a) => a.body.accountId === 'acc-fb-7').body.dmMessage).toMatch(/ref=fb-post-dm/)
    expect(of('tiktok', 'queued')[0].zernio_automation_id).toBeNull()
  }, 60_000)

  it('D-3: el reel sale con el video del evento en las tres redes', async () => {
    await activateAll()
    setNow(local('2026-11-05', '18:00'))
    await S.runSeriesJobs(db, { origin: SITE, budgetMs: 120_000 })
    const reels = posts().filter((c) => c.body.mediaItems[0].type === 'video')
    expect(reels.map((c) => c.body.platforms[0].platform).sort()).toEqual(['facebook', 'instagram', 'tiktok'])
    expect(reels.every((c) => c.body.mediaItems[0].url === VIDEO.url)).toBe(true)
    expect(slots().filter((s) => s.kind === 'reel').every((s) => s.status === 'queued')).toBe(true)
  }, 60_000)
})

describe('una red que falla no frena a las demás', () => {
  it('Facebook desconectado al publicar: solo Facebook se detiene; al reconectarlo se retoma desde hoy', async () => {
    await activateAll()
    setNow(local('2026-11-04', '18:00'))
    zernioHandler = (path, opts, real) => {
      if (path === '/posts' && opts.body?.platforms?.[0]?.platform === 'facebook') throw new real.ZernioError(403, { error: 'Page token expired', code: 'ACCOUNT_DISCONNECTED' })
      return defaultZernio(path, opts, real)
    }
    const summary = await S.runSeriesJobs(db, { origin: SITE, budgetMs: 120_000 })
    expect(series().status).toBe('active')
    expect(series().networks.facebook).toMatchObject({ status: 'disconnected', error: 'Page token expired' })
    expect(series().notice).toMatch(/Facebook se desconectó/)
    expect(db.tables.social_accounts.find((a) => a.platform === 'facebook').status).toBe('expired')
    expect(of('facebook', 'planned')).toHaveLength(0)
    expect(of('instagram', 'queued').length + of('tiktok', 'queued').length).toBe(3)
    expect(of('instagram', 'planned').length).toBeGreaterThan(0)
    expect(summary.failed).toBe(1)

    // Reconecta la página: la próxima pasada planifica Facebook desde ahora
    db.tables.social_accounts.find((a) => a.platform === 'facebook').status = 'active'
    zernioHandler = defaultZernio
    setNow(local('2026-11-04', '20:00'))
    const again = await S.runSeriesJobs(db, { origin: SITE, budgetMs: 120_000 })
    expect(again.reconciled.networks).toBe(1)
    expect(series().networks.facebook).toMatchObject({ status: 'active', account_id: 'acc-fb-7', error: null })
    expect(series().notice).toMatch(/Facebook conectado/)
    const fbPlanned = of('facebook', 'planned')
    expect(fbPlanned.map((s) => s.days_to_event).filter((d, i, a) => a.indexOf(d) === i)).toEqual([3, 2, 1, 0])
    expect(fbPlanned.some((s) => s.kind === 'reel')).toBe(true)
  }, 60_000)

  it('webhook: TikTok desconectado detiene solo TikTok; un fallo de Facebook por token vencido, solo Facebook', async () => {
    await activateAll()
    setNow(local('2026-11-01', '10:00'))
    const out = await S.handleZernioWebhook(db, { event: 'account.disconnected', account: { platform: 'tiktok', accountId: 'acc-tt-7', disconnectionType: 'unintentional' } }, SITE)
    expect(out).toMatch(/1 serie/)
    expect(series()).toMatchObject({ status: 'active' })
    expect(series().networks.tiktok.status).toBe('disconnected')
    expect(of('tiktok', 'planned')).toHaveLength(0)
    expect(of('instagram', 'planned').length).toBeGreaterThan(0)

    const fbSlot = of('facebook', 'planned')[0]
    fbSlot.status = 'queued'
    fbSlot.zernio_post_id = 'fbpost1'
    await S.handleZernioWebhook(db, {
      event: 'post.platform.failed',
      post: { id: 'fbpost1', metadata: { aitickets_slot_id: String(fbSlot.id) }, platforms: [{ platform: 'facebook', error: 'Session expired', errorCategory: 'auth_expired' }] },
    }, SITE)
    expect(fbSlot).toMatchObject({ status: 'failed', error: 'Session expired' })
    expect(series()).toMatchObject({ status: 'active' })
    expect(series().networks.facebook.status).toBe('disconnected')
    expect(of('instagram', 'planned').length).toBeGreaterThan(0)
  })

  it('una pieza de una red desconectada que llega a su hora se omite sin llamar a Zernio', async () => {
    await activateAll()
    const s = series()
    s.networks = { ...s.networks, tiktok: { ...s.networks.tiktok, status: 'disconnected' } }
    db.tables.social_accounts = db.tables.social_accounts.filter((a) => a.platform !== 'tiktok')
    setNow(local('2026-11-04', '18:00'))
    await S.runSeriesJobs(db, { origin: SITE, budgetMs: 120_000 })
    expect(posts().some((c) => c.body.platforms[0].platform === 'tiktok')).toBe(false)
    expect(of('tiktok').filter((x) => x.days_to_event === 4)[0]).toMatchObject({ status: 'skipped' })
  }, 60_000)
})
