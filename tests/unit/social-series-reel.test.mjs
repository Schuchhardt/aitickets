// Reel de la difusión automática sin video del productor (src/lib/socialSeries.ts, socialSeriesReel.ts,
// netlify/lib/reel-video.mjs): reel agregado a una serie activa cuando se sube el video después de aprobar, reel de
// respaldo armado con las fotos del evento (flag SOCIAL_SERIES_FALLBACK_REEL), y que al despachar se use el video
// vigente. Caso real: serie 2 (evento 134) con reel_enabled y sin video. Supabase, Zernio y la background function
// falsos: sin red (las fotos se generan con sharp).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let zernioCalls
let zernioHandler

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
let internalCalls
vi.mock('../../src/pages/api/_lib/server-utils', async (orig) => ({
  ...(await orig()),
  notifySlack: async () => {},
  callInternalFunction: async (url, path, body) => { internalCalls.push({ origin: String(url), path, body }); return { ok: true, status: 202, data: null } },
}))
// Las fotos del evento: un JPG vertical generado (sin red)
let photo
vi.mock('../../src/lib/safe-fetch', async (orig) => ({ ...(await orig()), fetchPublic: async (url) => ({ buffer: photo, contentType: 'image/jpeg', finalUrl: url }) }))
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

let uploads = []
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

const sharp = (await import('sharp')).default
beforeEach(async () => {
  photo = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#3b82f6' } }).jpeg().toBuffer()
  internalCalls = []
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
      aitickets_event_gallery_images: [],
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
  uploads = []
  db.storage = {
    from: () => ({
      upload: async (path, buf, opts) => { uploads.push({ path, bytes: buf.length, contentType: opts?.contentType }); return { error: null } },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/Events/${path}` } }),
    }),
  }
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.SOCIAL_SERIES_FALLBACK_REEL
  delete process.env.SOCIAL_SERIES_REEL_MUSIC_URL
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

const IMG = 'https://proj.supabase.co/storage/v1/object/public/Events/covers/2296.jpg'
const UPLOAD = `${SITE}/dashboard/events/2296#pagina`
const ev = () => db.tables.events[0]
const noVideo = () => { ev().cover_video = null; ev().gallery_video = null }
const reels = (status) => slots().filter((s) => s.kind === 'reel' && (!status || s.status === status))
// Aprobar sin video ni respaldo, como la serie 2
const activateWithoutVideo = async (opts = {}) => {
  noVideo()
  return activateAll(opts)
}
const reelDayLocal = () => reels()[0].publish_at

// ---------------------------------------------------------------------------

describe('reelNoticeFor', () => {
  const published = { status: 'published', cover_video: null }
  const story = (iso, extra = {}) => ({ kind: 'story', platform: 'instagram', variant: 'countdown', status: 'planned', days_to_event: 3, publish_at: iso, ...extra })
  const now = new Date(local('2026-11-01', '12:00'))
  const future = local('2026-11-05', '21:00')
  const active = { status: 'active', reel_enabled: true, cadence_config: {} }

  it('antes de activar: sin video avisa (warning) con CTA; con respaldo, info; con video, desactivado o borrador, nada', () => {
    expect(S.reelNoticeFor({ series: null, event: published, uploadUrl: UPLOAD })).toMatchObject({ code: 'reel_without_video', level: 'warning', blocking: false, cta: { url: UPLOAD } })
    expect(S.reelNoticeFor({ series: null, event: published, uploadUrl: UPLOAD, fallback: true })).toMatchObject({ code: 'reel_fallback', level: 'info', cta: { url: UPLOAD } })
    expect(S.reelNoticeFor({ series: null, event: { ...published, cover_video: VIDEO }, uploadUrl: UPLOAD })).toBeNull()
    expect(S.reelNoticeFor({ series: { status: 'draft', reel_enabled: false }, event: published, uploadUrl: UPLOAD })).toBeNull()
    expect(S.reelNoticeFor({ series: null, event: { ...published, status: 'draft' }, uploadUrl: UPLOAD })).toBeNull()
    expect(S.reelNoticeFor({ series: null, event: { ...published, cover_video: { ...VIDEO, duration: 90 } }, uploadUrl: UPLOAD })?.code).toBe('reel_without_video')
  })

  it('serie activa sin reel (serie 2): si queda un día, subir el video lo agrega; si no quedan días, solo informa', () => {
    const withDay = [story(future)]
    expect(S.reelNoticeFor({ series: active, event: published, slots: withDay, uploadUrl: UPLOAD, now })).toMatchObject({ code: 'reel_without_video', level: 'info', cta: { url: UPLOAD } })
    expect(S.reelNoticeFor({ series: active, event: published, slots: withDay, uploadUrl: UPLOAD, now }).message).toMatch(/lo agregamos/)
    expect(S.reelNoticeFor({ series: active, event: { ...published, cover_video: VIDEO }, slots: withDay, uploadUrl: UPLOAD, now })).toMatchObject({ code: 'reel_pending', cta: null })
    expect(S.reelNoticeFor({ series: active, event: published, slots: withDay, uploadUrl: UPLOAD, now, fallback: true })).toMatchObject({ code: 'reel_pending' })
    // Solo quedan historias dentro de 3 h (o ya publicadas): no hay día para el reel
    const late = [story(new Date(now.getTime() + 60 * 60_000).toISOString()), story(future, { status: 'published' })]
    expect(S.reelNoticeFor({ series: active, event: published, slots: late, uploadUrl: UPLOAD, now })).toMatchObject({ code: 'reel_without_video', cta: null, message: expect.stringMatching(/ya no quedan días/) })
    // Agotada: no se agrega
    expect(S.reelNoticeFor({ series: { ...active, sold_out_at: '2026-11-01T00:00:00Z' }, event: { ...published, cover_video: VIDEO }, slots: withDay, uploadUrl: UPLOAD, now }).code).toBe('reel_without_video')
  })

  it('reel pendiente: sin video ni respaldo avisa que no saldrá; con respaldo (o ya armado), info; con video, nada', () => {
    const pending = [story(future), { kind: 'reel', status: 'planned', video_url: null }]
    expect(S.reelNoticeFor({ series: active, event: published, slots: pending, uploadUrl: UPLOAD, now })).toMatchObject({ code: 'reel_video_missing', level: 'warning' })
    expect(S.reelNoticeFor({ series: active, event: published, slots: pending, uploadUrl: UPLOAD, now, fallback: true })).toMatchObject({ code: 'reel_fallback' })
    const built = [{ kind: 'reel', status: 'planned', video_url: 'https://proj.supabase.co/storage/v1/object/public/Events/social-series-reels/7/1-2-x.mp4' }]
    expect(S.reelNoticeFor({ series: active, event: published, slots: built, uploadUrl: UPLOAD, now })).toMatchObject({ code: 'reel_fallback' })
    expect(S.reelNoticeFor({ series: active, event: { ...published, cover_video: VIDEO }, slots: pending, uploadUrl: UPLOAD, now })).toBeNull()
    expect(S.reelNoticeFor({ series: active, event: published, slots: [{ kind: 'reel', status: 'published' }], uploadUrl: UPLOAD, now })).toBeNull()
  })
})

describe('reel agregado a una serie activa', () => {
  it('aprobada sin video; el productor sube el video: la próxima pasada agrega el reel en cada red y TikTok cambia la foto por el video', async () => {
    await activateWithoutVideo()
    expect(reels()).toEqual([])
    const view = await call('get_social_series', { event_id: 2296 })
    expect(view.notices.map((n) => n.code)).toEqual(['reel_without_video'])

    setNow(local('2026-10-30', '10:00'))
    ev().cover_video = VIDEO
    expect((await call('get_social_series', { event_id: 2296 })).notices.map((n) => n.code)).toEqual(['reel_pending'])
    const result = await S.reconcileSeries(db, series(), SITE)
    expect(result).toBe('reel_added')
    expect(reels().map((r) => r.platform).sort()).toEqual(['facebook', 'instagram', 'tiktok'])
    expect(reels().every((r) => r.status === 'planned' && r.video_url === VIDEO.url && r.days_to_event === REEL_DAYS)).toBe(true)
    // El mismo día y hora que una historia de Instagram (la regla de aprobar)
    expect(slots().some((s) => s.kind === 'story' && s.platform === 'instagram' && s.publish_at === reelDayLocal())).toBe(true)
    expect(slots().find((s) => s.platform === 'tiktok' && s.kind === 'feed_post' && s.publish_at === reelDayLocal())).toMatchObject({ status: 'skipped', skip_reason: 'reemplazada por el reel' })
    expect(series().notice).toMatch(/Agregamos el reel con el video del evento/)
    // No se duplica
    expect(await S.reconcileSeries(db, series(), SITE)).not.toBe('reel_added')
    expect(reels().length).toBe(3)
    expect((await call('get_social_series', { event_id: 2296 })).notices).toEqual([])
  })

  it('sin video ni respaldo, o con el reel desactivado, no agrega nada', async () => {
    await activateWithoutVideo()
    setNow(local('2026-10-30', '10:00'))
    expect(await S.reconcileSeries(db, series(), SITE)).not.toBe('reel_added')
    series().reel_enabled = false
    ev().cover_video = VIDEO
    expect(await S.reconcileSeries(db, series(), SITE)).not.toBe('reel_added')
    expect(reels()).toEqual([])
  })

  it('si ya no queda un día con más de 3 h por delante, no lo agrega', async () => {
    await activateWithoutVideo()
    ev().cover_video = VIDEO
    // El día del evento: solo queda la historia de D-0
    setNow(local('2026-11-08', '08:00'))
    await S.reconcileSeries(db, series(), SITE)
    expect(reels()).toEqual([])
  })
})

describe('despacho del reel con el video vigente', () => {
  it('si el productor cambió el video después de aprobar, se publica el nuevo', async () => {
    await activateAll()
    const NEW = { ...VIDEO, url: 'https://proj.supabase.co/storage/v1/object/public/Events/videos/2296-cover-v2.mp4' }
    ev().cover_video = NEW
    setNow(new Date(Date.parse(reelDayLocal()) - 60 * 60_000).toISOString())
    await S.runSeriesJobs(db, { origin: SITE, budgetMs: 120_000 })
    const reelPosts = posts().filter((c) => c.body.mediaItems[0].type === 'video')
    expect(reelPosts.length).toBe(3)
    expect(reelPosts.every((c) => c.body.mediaItems[0].url === NEW.url)).toBe(true)
    expect(reels().every((r) => r.video_url === NEW.url && r.status === 'queued')).toBe(true)
  })

  it('si le quitaron el video y no hay respaldo, el reel falla con el motivo (las demás piezas salen)', async () => {
    await activateAll()
    noVideo()
    setNow(new Date(Date.parse(reelDayLocal()) - 60 * 60_000).toISOString())
    const summary = await S.runSeriesJobs(db, { origin: SITE, budgetMs: 120_000 })
    expect(reels('failed').length).toBe(3)
    expect(reels('failed')[0].error).toMatch(/ya no tiene un video/)
    expect(summary.dispatched).toBeGreaterThan(0)
  })
})

describe('reel de respaldo (SOCIAL_SERIES_FALLBACK_REEL)', () => {
  const withFallback = () => {
    process.env.SOCIAL_SERIES_FALLBACK_REEL = 'true'
    noVideo()
    ev().image_url = IMG
    db.tables.aitickets_event_gallery_images.push(
      { id: 'g1', event_id: 2296, url: 'https://proj.supabase.co/storage/v1/object/public/Events/gallery/a.jpg', position: 0 },
      { id: 'g2', event_id: 2296, url: 'https://proj.supabase.co/storage/v1/object/public/Events/gallery/b.jpg', position: 1 },
    )
  }

  it('apagado por defecto: sin video no hay reel (como hoy)', async () => {
    noVideo()
    ev().image_url = IMG
    setNow(ACTIVATION)
    const view = await call('prepare_social_series', { event_id: 2296, facebook_enabled: true, tiktok_enabled: true })
    expect(view.reel).toMatchObject({ available: false, source: null })
    expect(view.plan.reels).toEqual([])
  })

  it('al aprobar se programa el reel sin video todavía; el borrador lo anuncia', async () => {
    withFallback()
    setNow(ACTIVATION)
    const view = await call('prepare_social_series', { event_id: 2296, facebook_enabled: true, tiktok_enabled: true })
    expect(view.reel).toMatchObject({ available: true, source: 'fallback', video_url: null })
    expect(view.plan.reels.length).toBe(3)
    expect(view.notices.map((n) => n.code)).toEqual(['reel_fallback'])
    const first = await call('approve_social_series', { event_id: 2296 })
    expect(JSON.stringify(first)).toMatch(/reel armado con las fotos del evento/)
    await call('approve_social_series', { event_id: 2296, confirmation_token: first.confirmation_token })
    expect(reels().map((r) => [r.platform, r.video_url])).toEqual(expect.arrayContaining([['instagram', null], ['facebook', null], ['tiktok', null]]))
  })

  it('sin ninguna foto no hay respaldo', async () => {
    process.env.SOCIAL_SERIES_FALLBACK_REEL = 'true'
    noVideo()
    setNow(ACTIVATION)
    const view = await call('prepare_social_series', { event_id: 2296 })
    expect(view.reel.source).toBeNull()
  })

  it('24 h antes renderiza los cuadros, los sube y pide el video (uno para Instagram+Facebook y otro para TikTok); no repite el pedido en curso', async () => {
    withFallback()
    await activateAll()
    const at = new Date(Date.parse(reelDayLocal()) - 20 * 3_600_000)
    setNow(at.toISOString())
    const jobs = []
    const trigger = async (job) => { jobs.push(job); return { ok: true, status: 202 } }
    expect(await S.prepareFallbackReels(db, [series()], { origin: SITE, now: at, maxJobs: 5, trigger })).toBe(2)
    expect(jobs.length).toBe(2)
    const meta = jobs.find((j) => j.slotIds.length === 2)
    const tiktok = jobs.find((j) => j.slotIds.length === 1)
    expect(meta.slotIds.sort()).toEqual(reels().filter((r) => r.platform !== 'tiktok').map((r) => r.id).sort())
    expect(tiktok.slotIds).toEqual([reels().find((r) => r.platform === 'tiktok').id])
    // Portada con la plantilla + 2 fotos de la galería + cierre
    expect(meta.frames.length).toBe(4)
    expect(meta.frames.every((f) => f.startsWith('https://proj.supabase.co/storage/v1/object/public/Events/social-series/7/reel-frames/'))).toBe(true)
    expect(meta.outPath).toMatch(/^social-series-reels\/7\/\d+-\d+-[a-z0-9]+\.mp4$/)
    expect(meta.musicUrl).toBeNull()
    expect(uploads.filter((u) => u.path.includes('/reel-frames/')).length).toBe(8)
    expect(reels().every((r) => r.rendered_at === at.toISOString())).toBe(true)
    // Pedido en curso: no se repite
    expect(await S.prepareFallbackReels(db, [series()], { origin: SITE, now: new Date(at.getTime() + 15 * 60_000), maxJobs: 5, trigger })).toBe(0)
    // Pasados 30 min sin resultado, se repite
    expect(await S.prepareFallbackReels(db, [series()], { origin: SITE, now: new Date(at.getTime() + 31 * 60_000), maxJobs: 5, trigger })).toBe(2)
  })

  it('más de 24 h antes, o si el evento ya tiene video, no pide nada', async () => {
    withFallback()
    await activateAll()
    const trigger = vi.fn(async () => ({ ok: true, status: 202 }))
    const early = new Date(Date.parse(reelDayLocal()) - 30 * 3_600_000)
    expect(await S.prepareFallbackReels(db, [series()], { origin: SITE, now: early, maxJobs: 5, trigger })).toBe(0)
    ev().cover_video = VIDEO
    const soon = new Date(Date.parse(reelDayLocal()) - 5 * 3_600_000)
    expect(await S.prepareFallbackReels(db, [series()], { origin: SITE, now: soon, maxJobs: 5, trigger })).toBe(0)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('si la función del reel no responde, limpia el pedido y deja el motivo en el slot (se reintenta en la próxima pasada)', async () => {
    withFallback()
    await activateAll()
    const at = new Date(Date.parse(reelDayLocal()) - 10 * 3_600_000)
    expect(await S.prepareFallbackReels(db, [series()], { origin: SITE, now: at, trigger: async () => ({ ok: false, status: 500 }) })).toBe(0)
    const r = reels().find((x) => x.platform === 'instagram')
    expect(r).toMatchObject({ rendered_at: null, status: 'planned' })
    expect(r.error).toMatch(/No se pudo armar el reel automático/)
  })

  it('el job pide el reel con el tiempo que sobra, espera mientras se arma y publica el video armado', async () => {
    withFallback()
    process.env.SOCIAL_SERIES_REEL_MUSIC_URL = 'https://proj.supabase.co/storage/v1/object/public/Events/music/pista.mp3'
    await activateAll()
    const publish = Date.parse(reelDayLocal())
    setNow(new Date(publish - 6 * 3_600_000).toISOString())
    const summary = await S.runSeriesJobs(db, { origin: SITE, budgetMs: 120_000 })
    expect(summary.reels_requested).toBe(1)
    expect(internalCalls[0]).toMatchObject({ path: '/.netlify/functions/social-series-reel-background', body: { musicUrl: process.env.SOCIAL_SERIES_REEL_MUSIC_URL } })

    // Dentro de la ventana de despacho (2 h antes) pero el video aún no está: espera
    setNow(new Date(publish - 90 * 60_000).toISOString())
    for (const r of reels()) r.rendered_at = new Date(publish - 100 * 60_000).toISOString()
    await S.runSeriesJobs(db, { origin: SITE, budgetMs: 120_000 })
    expect(reels('planned').length).toBe(3)
    expect(posts().filter((c) => c.body.mediaItems[0].type === 'video')).toEqual([])

    // La background function dejó el video: sale como reel
    const built = 'https://proj.supabase.co/storage/v1/object/public/Events/social-series-reels/7/1-2-abc.mp4'
    for (const r of reels()) r.video_url = built
    setNow(new Date(publish - 60 * 60_000).toISOString())
    await S.runSeriesJobs(db, { origin: SITE, budgetMs: 120_000 })
    const reelPosts = posts().filter((c) => c.body.mediaItems[0].type === 'video')
    expect(reelPosts.length).toBe(3)
    expect(reelPosts.every((c) => c.body.mediaItems[0].url === built)).toBe(true)
  })

  it('si el productor sube un video antes de publicar, se usa ese en vez del respaldo', async () => {
    withFallback()
    await activateAll()
    for (const r of reels()) r.video_url = 'https://proj.supabase.co/storage/v1/object/public/Events/social-series-reels/7/x.mp4'
    ev().cover_video = VIDEO
    setNow(new Date(Date.parse(reelDayLocal()) - 60 * 60_000).toISOString())
    await S.runSeriesJobs(db, { origin: SITE, budgetMs: 120_000 })
    expect(posts().filter((c) => c.body.mediaItems[0].type === 'video').every((c) => c.body.mediaItems[0].url === VIDEO.url)).toBe(true)
  })

  it('si a 20 min de publicar no hay video armado, el reel falla con el motivo', async () => {
    withFallback()
    await activateAll()
    const publish = Date.parse(reelDayLocal())
    for (const r of reels()) r.rendered_at = new Date(publish - 25 * 60_000).toISOString()
    setNow(new Date(publish - 15 * 60_000).toISOString())
    await S.runSeriesJobs(db, { origin: SITE, budgetMs: 120_000 })
    expect(reels('failed').length).toBe(3)
    expect(reels('failed')[0].error).toMatch(/No alcanzó a armarse el reel automático/)
  })

  it('el reel agregado tarde también puede ser de respaldo (serie aprobada sin flag)', async () => {
    await activateWithoutVideo()
    withFallback()
    setNow(local('2026-10-30', '10:00'))
    expect(await S.reconcileSeries(db, series(), SITE)).toBe('reel_added')
    expect(reels().every((r) => r.video_url === null)).toBe(true)
    expect(series().notice).toMatch(/reel armado con las fotos/)
  })
})

const R = await import('../../src/lib/socialSeriesReel.ts')
describe('cuadros del reel', () => {
  it('fotos: la base y hasta 3 de la galería, sin repetir', () => {
    expect(R.reelPhotos('a', [{ url: 'a' }, { url: 'b' }, { url: 'c' }, { url: 'd' }, { url: 'e' }])).toEqual([
      { url: 'a', role: 'cover' }, { url: 'b', role: 'gallery' }, { url: 'c', role: 'gallery' }, { url: 'd', role: 'gallery' },
    ])
    expect(R.reelPhotos(null, [])).toEqual([])
  })
  it('apertura y cierre con la plantilla ("Comenta ENTRADAS"), fotos al medio, todo en 1080×1920', async () => {
    const data = { kind: 'story', variant: 'countdown', daysToEvent: 3, eventName: 'Concierto de Primavera', dateLabel: 'domingo 8 de noviembre', startTime: '12:00', venue: 'Escuela', keyword: 'ENTRADAS', remaining: null, styleIndex: 0 }
    const frames = await R.renderReelFrames(data, [{ url: 'a', role: 'cover' }, { url: 'b', role: 'gallery' }, { url: 'broken', role: 'gallery' }], { load: async (u) => (u === 'broken' ? null : photo) })
    expect(frames.length).toBe(3)
    for (const f of frames) expect(await sharp(f).metadata()).toMatchObject({ width: 1080, height: 1920, format: 'jpeg' })
    expect(pieceText({ ...data, replyVerb: 'Comenta' }).cta).toBe('Comenta ENTRADAS y te mandamos el link')
    expect(await R.renderReelFrames(data, [{ url: 'x', role: 'cover' }], { load: async () => null })).toEqual([])
  })
})
