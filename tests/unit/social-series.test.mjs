// Historias y posts automáticos en Instagram: motor de cadencia, textos de las piezas, ciclo de vida con las
// herramientas *_social_series (preparar, aprobar con confirmación, pausar, reanudar, cancelar), job de despacho a
// Zernio (render tardío, post programado, DM por comentarios), cortes automáticos (cancelado, cambio de fecha, agotado,
// Instagram desconectado), webhooks firmados de Zernio y vistas del MCP de admin. Supabase y Zernio falsos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let zernioCalls
let zernioHandler
const sentEmails = []
const slack = []

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/pages/api/_lib/server-utils', async (orig) => ({ ...(await orig()), notifySlack: async (text) => { slack.push(text) } }))
vi.mock('../../netlify/lib/mailer.mjs', async (orig) => ({ ...(await orig()), sendEmail: async (msg) => { sentEmails.push(msg); return { id: 'm1' } } }))
vi.mock('../../netlify/lib/zernio-ads.mjs', async (orig) => {
  const real = await orig()
  return { ...real, zernioRequest: async (path, opts = {}) => {
    zernioCalls.push({ path, method: opts.method || 'GET', body: opts.body, idempotencyKey: opts.idempotencyKey })
    return zernioHandler(path, opts, real)
  } }
})

const { planSlots, choosePublishTime, normalizeCadence, nextFunctionStart, DEFAULT_CADENCE, stageOf } = await import('../../src/lib/socialSeriesCadence.ts')
const { pieceText, backgroundMode, renderPiece, withoutEmoji } = await import('../../src/lib/socialSeriesRender.ts')
const S = await import('../../src/lib/socialSeries.ts')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')
const { santiagoToDate } = await import('../../src/pages/api/_lib/server-utils.ts')
const webhookRoute = await import('../../src/pages/api/webhooks/zernio.ts')
const { runAdminTool } = await import('../../src/lib/admin-api/registry.ts')
const { getAdminTool } = await import('../../src/lib/admin-api/tools/index.ts')

const SITE = 'https://aitickets.cl'
const local = (date, time) => santiagoToDate(date, time).toISOString()
// 26-oct-2026 13:00 en Chile: se activa la serie del "Concierto de Primavera" (8-nov 12:00)
const ACTIVATION = local('2026-10-26', '13:00')
const EVENT_START = local('2026-11-08', '12:00')

let postSeq = 0
const hex24 = () => (++postSeq).toString(16).padStart(24, '0')

function defaultZernio(path, opts, real) {
  if (path === '/posts' && opts.method === 'POST') return { post: { _id: hex24() } }
  if (path === '/comment-automations' && opts.method === 'POST') return { automation: { id: `auto-${zernioCalls.length}` } }
  if (path.startsWith('/comment-automations/') && opts.method === 'PATCH') return { success: true }
  if (opts.method === 'DELETE') return { success: true }
  if (path.startsWith('/comment-automations/')) return { automation: { stats: { dmsSent: 5, dmsFailed: 0, linkClicks: 3, uniqueClicks: 2, triggered: 6 } } }
  throw new real.ZernioError(404, { error: `ruta no simulada ${path}` })
}

const setNow = (iso) => vi.useFakeTimers({ now: new Date(iso), toFake: ['Date'] })

beforeEach(() => {
  process.env.ZERNIO_API_KEY = 'zk_test'
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  zernioCalls = []
  zernioHandler = defaultZernio
  sentEmails.length = 0
  slack.length = 0
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Escuela de Música del Dire', zernio_profile_id: 'prof-7' }, { id: 8, public_name: 'Otra' }],
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
      social_accounts: [{ id: 1, organization_id: 7, platform: 'instagram', zernio_account_id: 'acc-ig-7', account_name: '@escueladire', status: 'active' }],
      aitickets_sites: [],
      aitickets_platform_settings: [],
      aitickets_social_series: [],
      aitickets_social_series_slots: [],
      aitickets_zernio_webhook_events: [],
      aitickets_api_audit: [],
      aitickets_api_confirmations: [],
      aitickets_api_idempotency: [],
      aitickets_admin_audit: [],
    },
    rpc: { aitickets_ticket_availability: () => [{ ticket_id: 50, sold: 67, pending: 0 }] },
    // DEFAULT de las columnas (la base real los aplica en el INSERT)
    defaults: {
      aitickets_social_series: { feed_posts_enabled: true, sold_out_story_enabled: false, keyword: 'ENTRADAS', extra_keywords: ['entrada', 'link'], cadence_config: {}, status: 'draft' },
      aitickets_social_series_slots: { variant: 'countdown', attempts: 0 },
    },
    unique: {
      aitickets_zernio_webhook_events: [['event_id']],
      aitickets_api_idempotency: [['organization_id', 'tool', 'idem_key']],
    },
  })
  db.storage = {
    from: () => ({
      upload: async () => ({ error: null }),
      getPublicUrl: (path) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/Events/${path}` } }),
    }),
  }
})

afterEach(() => {
  delete process.env.ZERNIO_API_KEY
  delete process.env.SUPABASE_URL
  delete process.env.ZERNIO_WEBHOOK_SECRET
  delete process.env.SOCIAL_SERIES_ENABLED
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
const activate = async () => {
  setNow(ACTIVATION)
  await call('prepare_social_series', { event_id: 2296 })
  return confirmCall('approve_social_series', { event_id: 2296 })
}

// ---------------------------------------------------------------------------

describe('motor de cadencia', () => {
  it('Concierto de Primavera: cada 3 días, diario la última semana y D-0 a las 09:00 (10 historias y 7 posts)', () => {
    const out = planSlots({ anchorStart: new Date(EVENT_START), now: new Date(ACTIVATION), publishTime: '21:00', feedPosts: true })
    const stories = out.filter((s) => s.kind === 'story')
    const posts = out.filter((s) => s.kind === 'feed_post')
    expect(stories.map((s) => s.local_date)).toEqual(['2026-10-26', '2026-10-29', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
    expect(stories.map((s) => s.days_to_event)).toEqual([13, 10, 7, 6, 5, 4, 3, 2, 1, 0])
    expect(posts.map((s) => s.local_date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'])
    expect(stories[0].publish_at).toBe(local('2026-10-26', '21:00'))
    expect(stories.at(-1).publish_at).toBe(local('2026-11-08', '09:00'))
  })

  it('la transición a diario cae en D-7 aunque se active otro día, y sin posts si están desactivados', () => {
    const out = planSlots({ anchorStart: new Date(EVENT_START), now: new Date(local('2026-10-20', '10:00')), publishTime: '19:30', feedPosts: false })
    expect(out.map((s) => s.days_to_event)).toEqual([19, 16, 13, 10, 7, 6, 5, 4, 3, 2, 1, 0])
    expect(out.every((s) => s.kind === 'story')).toBe(true)
  })

  it('D-0 al menos 3 h antes del inicio; a menos de 24 h solo D-0; si su hora pasó, sale cuanto antes', () => {
    const early = planSlots({ anchorStart: new Date(local('2026-11-08', '11:00')), now: new Date(ACTIVATION), publishTime: '19:30', feedPosts: true })
    expect(early.at(-1).publish_at).toBe(local('2026-11-08', '08:00'))
    const tomorrow = planSlots({ anchorStart: new Date(local('2026-11-08', '21:00')), now: new Date(local('2026-11-07', '22:00')), publishTime: '19:30', feedPosts: true })
    expect(tomorrow).toHaveLength(1)
    expect(tomorrow[0]).toMatchObject({ kind: 'story', days_to_event: 0, publish_at: local('2026-11-08', '09:00') })
    const late = planSlots({ anchorStart: new Date(local('2026-11-08', '21:00')), now: new Date(local('2026-11-08', '13:02')), publishTime: '19:30', feedPosts: true })
    expect(late).toEqual([expect.objectContaining({ days_to_event: 0, publish_at: local('2026-11-08', '13:20') })])
    expect(planSlots({ anchorStart: new Date(local('2026-11-08', '21:00')), now: new Date(local('2026-11-08', '20:30')), publishTime: '19:30', feedPosts: true })).toEqual([])
  })

  it('hora pico con 50+ visitas (entre 09 y 22 h); si no, 19:30', () => {
    expect(choosePublishTime(new Array(49).fill(21))).toMatchObject({ time: '19:30', source: 'default' })
    const hours = [...new Array(20).fill(15), ...new Array(18).fill(16), ...new Array(25).fill(21), ...new Array(40).fill(3)]
    expect(choosePublishTime(hours)).toMatchObject({ time: '21:00', source: 'peak' })
  })

  it('configuración: valores inválidos vuelven al por defecto y la banda espaciada empieza después de la diaria', () => {
    expect(normalizeCadence({ default_time: '25:00', sparse_every_days: 0, daily_from_days: 9, sparse_start_days: 5 })).toMatchObject({
      default_time: DEFAULT_CADENCE.default_time,
      sparse_every_days: DEFAULT_CADENCE.sparse_every_days,
      daily_from_days: 9,
      sparse_start_days: 10,
    })
    expect(stageOf(13)).toBe('far')
    expect(stageOf(5)).toBe('week')
    expect(stageOf(1)).toBe('tomorrow')
    expect(stageOf(0)).toBe('today')
  })

  it('varias funciones: cuenta hacia la próxima que no ha empezado', () => {
    const dates = [{ date: '2026-11-08', start_time: '12:00' }, { date: '2026-11-15', start_time: '20:00' }]
    expect(nextFunctionStart(dates, null, new Date(local('2026-11-08', '13:00'))).toISOString()).toBe(local('2026-11-15', '20:00'))
    expect(nextFunctionStart(dates, null, new Date(local('2026-11-16', '00:00')))).toBeNull()
  })
})

describe('textos de las piezas', () => {
  const base = { eventName: 'Concierto de Primavera', dateLabel: 'domingo 8 de noviembre', startTime: '12:00', venue: 'Escuela de Música del Dire', keyword: 'ENTRADAS', remaining: null, styleIndex: 0 }
  it('sin emojis en la imagen (las fuentes no los tienen)', () => {
    expect(withoutEmoji('Cumpleaños de Seba en Halloween 🎃')).toBe('Cumpleaños de Seba en Halloween')
    expect(withoutEmoji('Fiesta 🇨🇱 👩🏽‍🎤 ❤️ final')).toBe('Fiesta final')
    expect(withoutEmoji('Ñuñoa · 20:00 h')).toBe('Ñuñoa · 20:00 h')
    const t = pieceText({ ...base, eventName: '🎃 Noche de brujas 🎃', venue: '🏠', kind: 'story', variant: 'countdown', daysToEvent: 13 })
    expect(t.kicker).toBe('Noche de brujas')
    expect(t.message).toEqual(['domingo 8 de noviembre · 12:00 h'])
  })
  it('cambian por etapa y muestran escasez real solo la última semana', () => {
    expect(pieceText({ ...base, kind: 'story', variant: 'countdown', daysToEvent: 13, remaining: 20 })).toMatchObject({ bigLines: ['Faltan', '13', 'días'], scarcity: null, cta: 'Responde ENTRADAS y te mandamos el link' })
    expect(pieceText({ ...base, kind: 'story', variant: 'countdown', daysToEvent: 5, remaining: 42 })).toMatchObject({ scarcity: 'Quedan 42 entradas' })
    expect(pieceText({ ...base, kind: 'story', variant: 'countdown', daysToEvent: 1 })).toMatchObject({ bigLines: ['Mañana'], message: ['Última noche para comprar', 'domingo 8 de noviembre · 12:00 h · Escuela de Música del Dire'] })
    expect(pieceText({ ...base, kind: 'story', variant: 'countdown', daysToEvent: 0 })).toMatchObject({ bigLines: ['Hoy'], cta: 'Entradas en puerta o por DM: responde ENTRADAS' })
    expect(pieceText({ ...base, kind: 'feed_post', variant: 'countdown', daysToEvent: 4 }).cta).toBe('Comenta ENTRADAS y te mandamos el link')
    expect(pieceText({ ...base, kind: 'story', variant: 'sold_out', daysToEvent: 2 })).toMatchObject({ bigLines: ['Agotado'], cta: null })
  })
})

describe('fondo: la portada o una versión de ella', () => {
  it('llena el formato solo si la proporción calza (±10%); si no, o si el productor la quiere completa, va completa sobre su versión difuminada', () => {
    expect(backgroundMode(1080 / 1920, 'story')).toBe('fill')
    expect(backgroundMode(1080 / 1920, 'story', 'contain')).toBe('framed')
    expect(backgroundMode(1200 / 630, 'story')).toBe('framed') // portada horizontal
    expect(backgroundMode(1240 / 1754, 'story')).toBe('framed') // afiche A4
    expect(backgroundMode(1080 / 1350, 'story')).toBe('framed') // flyer 4:5
    expect(backgroundMode(1080 / 1350, 'feed_post')).toBe('fill')
    expect(backgroundMode(1, 'feed_post')).toBe('framed')
  })

  it('usa el encuadre de la portada en móvil solo cuando la foto base es la portada', () => {
    const event = { image_url: 'https://x/cover.jpg', cover_settings: { mobile: { fit: 'contain', position_y: 20, height: 300 } } }
    expect(S.baseImageOptionsFor(null, event)).toEqual({ fit: 'contain', positionY: 20 })
    expect(S.baseImageOptionsFor({ base_image_url: 'https://x/otra.jpg' }, event)).toEqual({})
    expect(S.baseImageOptionsFor(null, { image_url: 'https://x/cover.jpg' })).toEqual({ fit: 'cover', positionY: 50 })
    expect(S.baseImageUrlFor(null, { image_url: null, cover_video: { poster_url: 'https://x/poster.jpg' } })).toBe('https://x/poster.jpg')
  })

  it('renderiza con portada horizontal, vertical y sin foto en el tamaño de cada formato', async () => {
    const sharp = (await import('sharp')).default
    const photo = (w, hgt) => sharp({ create: { width: w, height: hgt, channels: 3, background: '#7c3aed' } }).jpeg().toBuffer()
    const d = { kind: 'story', variant: 'countdown', daysToEvent: 5, eventName: 'Concierto de Primavera', dateLabel: 'domingo 8 de noviembre', startTime: '12:00', venue: 'Escuela de Música del Dire', keyword: 'ENTRADAS', remaining: null, styleIndex: 0 }
    for (const [piece, img] of [[d, await photo(1600, 840)], [d, await photo(1080, 1920)], [d, null], [{ ...d, kind: 'feed_post' }, await photo(1600, 840)]]) {
      const meta = await sharp(await renderPiece(piece, img, { positionY: 30 })).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1080, piece.kind === 'story' ? 1920 : 1350])
    }
  }, 30_000)
})

describe('preparar y aprobar', () => {
  it('sin Instagram conectado no se puede activar y la vista dice qué falta', async () => {
    db.tables.social_accounts = []
    setNow(ACTIVATION)
    const view = await call('get_social_series', { event_id: 2296 })
    expect(view.can_activate).toBe(false)
    expect(view.instagram).toEqual({ connected: false, connect_url: `${SITE}/dashboard/promote` })
    expect(view.blockers.join(' ')).toMatch(/Conecta la cuenta de Instagram/)
    const out = await runTool(getTool('approve_social_series'), { event_id: 2296 }, ctx())
    expect(out).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('el borrador muestra el calendario y el DM; aprobar pide confirmación, guarda los slots y crea el DM de historias', async () => {
    setNow(ACTIVATION)
    const draft = await call('prepare_social_series', { event_id: 2296, keyword: 'entradas' })
    expect(draft.series).toMatchObject({ status: 'draft', keyword: 'ENTRADAS', feed_posts_enabled: true })
    expect(draft.plan).toMatchObject({ stories: 10, feed_posts: 7, publish_time: '19:30' })
    expect(draft.plan.slots.find((s) => s.kind === 'feed_post').caption_example).toMatch(/Comenta ENTRADAS y te mandamos el link/)
    expect(draft.dm_preview).toBe(
      '¡Hola! Aquí están tus entradas para Concierto de Primavera, el domingo 8 de noviembre a las 12:00: https://aitickets.cl/eventos/concierto-de-primavera-2296?ref=ig-story-dm',
    )
    expect(zernioCalls).toHaveLength(0)

    const first = await call('approve_social_series', { event_id: 2296 })
    expect(first.status).toBe('confirmation_required')
    expect(first.summary).toMatch(/10 historia\(s\) y 7 post\(s\) de feed/)
    expect(series().status).toBe('draft')

    const approved = await call('approve_social_series', { event_id: 2296, confirmation_token: first.confirmation_token })
    expect(approved.result).toBe('approved')
    expect(series()).toMatchObject({ status: 'active', zernio_account_id: 'acc-ig-7', zernio_profile_id: 'prof-7', approved_by: 1, anchor_starts_at: EVENT_START })
    expect(series().cadence_config).toMatchObject({ publish_time: '19:30', publish_time_source: 'default' })
    expect(slots()).toHaveLength(17)
    expect(slots().every((s) => s.status === 'planned')).toBe(true)
    // Nada se publica al aprobar: solo el DM de historias
    const created = zernioCalls.filter((c) => c.path === '/comment-automations')
    expect(created).toHaveLength(1)
    expect(created[0].body).toMatchObject({
      profileId: 'prof-7',
      accountId: 'acc-ig-7',
      trigger: 'story_reply',
      keywords: ['ENTRADAS', 'entrada', 'link'],
      matchMode: 'contains',
      buttons: [{ type: 'url', title: 'Comprar entradas', url: 'https://aitickets.cl/eventos/concierto-de-primavera-2296?ref=ig-story-dm' }],
    })
    expect(created[0].body).not.toHaveProperty('platformPostId')
    expect(series().zernio_story_automation_id).toBeTruthy()
    expect(db.tables.aitickets_api_audit.at(-1)).toMatchObject({ tool: 'approve_social_series', channel: 'dashboard', ok: true })
  })

  it('no se puede preparar otra serie mientras hay una activa', async () => {
    await activate()
    const out = await runTool(getTool('prepare_social_series'), { event_id: 2296 }, ctx())
    expect(out).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('el mensaje del DM propio usa {link} y la foto base debe estar en AI Tickets', async () => {
    setNow(ACTIVATION)
    const v = await call('prepare_social_series', { event_id: 2296, dm_message: 'Hola! Compra acá {link} y nos vemos 🎶' })
    expect(v.dm_preview).toBe('Hola! Compra acá https://aitickets.cl/eventos/concierto-de-primavera-2296?ref=ig-story-dm y nos vemos 🎶')
    const bad = await runTool(getTool('prepare_social_series'), { event_id: 2296, base_image_url: 'https://evil.com/x.jpg' }, ctx())
    expect(bad).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('la foto base vacía (lo que manda el panel sin foto propia) vuelve a la portada del evento', async () => {
    setNow(ACTIVATION)
    const out = await runTool(getTool('prepare_social_series'), { event_id: 2296, base_image_url: '' }, ctx())
    expect(out).toMatchObject({ ok: true })
    const bad = await runTool(getTool('prepare_social_series'), { event_id: 2296, base_image_url: 'http://x/y.jpg' }, ctx())
    expect(bad).toMatchObject({ ok: false, code: 'invalid_input' })
  })
})

describe('despacho a Zernio (render tardío)', () => {
  it('programa la historia ~2 h antes con la imagen recién generada, metadata del slot e Idempotency-Key', async () => {
    await activate()
    setNow(local('2026-10-26', '18:00'))
    const summary = await S.runSeriesJobs(db, { origin: SITE, budgetMs: 60_000 })
    expect(summary.dispatched).toBe(1)
    const post = zernioCalls.find((c) => c.path === '/posts')
    const slot = slots().find((s) => s.days_to_event === 13)
    expect(post.idempotencyKey).toBe(`aitickets-series-slot-${slot.id}`)
    expect(post.body).toMatchObject({
      mediaItems: [{ type: 'image', url: expect.stringMatching(/^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/Events\/social-series\/7\/.+\.jpg$/) }],
      platforms: [{ platform: 'instagram', accountId: 'acc-ig-7', platformSpecificData: { contentType: 'story' } }],
      scheduledFor: local('2026-10-26', '19:30'),
      timezone: 'America/Santiago',
      metadata: { aitickets_slot_id: String(slot.id) },
    })
    expect(post.body).not.toHaveProperty('content')
    expect(slot).toMatchObject({ status: 'queued', zernio_post_id: expect.stringMatching(/^[0-9a-f]{24}$/), attempts: 1 })
    // El resto sigue planificado
    expect(slots().filter((s) => s.status === 'planned')).toHaveLength(16)
  }, 30_000)

  it('post de feed: caption que termina con la palabra clave y DM por comentarios atado al post', async () => {
    await activate()
    setNow(local('2026-11-01', '18:00'))
    const summary = await S.runSeriesJobs(db, { origin: SITE, budgetMs: 60_000 })
    expect(summary.skipped).toBe(2) // las de octubre ya no alcanzan a salir
    expect(summary.dispatched).toBe(2)
    const feed = zernioCalls.find((c) => c.path === '/posts' && !c.body.platforms[0].platformSpecificData)
    expect(feed.body.content).toMatch(/Faltan 7 días/)
    expect(feed.body.content).toMatch(/Comenta ENTRADAS y te mandamos el link 📩$/)
    const automation = zernioCalls.find((c) => c.path === '/comment-automations' && c.body.trigger === 'comment')
    const queuedPost = slots().find((s) => s.kind === 'feed_post' && s.status === 'queued')
    expect(automation.body).toMatchObject({
      postId: queuedPost.zernio_post_id,
      keywords: ['ENTRADAS', 'entrada', 'link'],
      dmMessage: expect.stringContaining('ref=ig-post-dm'),
    })
    expect(queuedPost.zernio_automation_id).toBeTruthy()
  }, 30_000)

  it('error transitorio: vuelve a planned y reintenta; un rechazo de Zernio queda fallido y avisa a Slack', async () => {
    await activate()
    setNow(local('2026-10-26', '18:00'))
    zernioHandler = (path, opts, real) => {
      if (path === '/posts') throw new real.ZernioError(503, { error: 'caído' })
      return defaultZernio(path, opts, real)
    }
    let s = await S.runSeriesJobs(db, { origin: SITE, budgetMs: 60_000 })
    expect(s.retried).toBe(1)
    expect(slots().find((x) => x.days_to_event === 13)).toMatchObject({ status: 'planned', attempts: 1, error: 'caído' })
    zernioHandler = (path, opts, real) => {
      if (path === '/posts') throw new real.ZernioError(400, { error: 'imagen inválida' })
      return defaultZernio(path, opts, real)
    }
    s = await S.runSeriesJobs(db, { origin: SITE, budgetMs: 60_000 })
    expect(s.failed).toBe(1)
    expect(slots().find((x) => x.days_to_event === 13)).toMatchObject({ status: 'failed', error: 'imagen inválida' })
    expect(slack.at(-1)).toMatch(/Historia automática fallida/)
  }, 30_000)

  it('cuenta desconectada al publicar: pausa la serie y avisa por correo', async () => {
    await activate()
    setNow(local('2026-10-26', '18:00'))
    zernioHandler = (path, opts, real) => {
      if (path === '/posts') throw new real.ZernioError(403, { error: 'Account is disconnected', code: 'ACCOUNT_DISCONNECTED' })
      return defaultZernio(path, opts, real)
    }
    await S.runSeriesJobs(db, { origin: SITE, budgetMs: 60_000 })
    expect(series()).toMatchObject({ status: 'paused', pause_reason: 'instagram_disconnected' })
    expect(db.tables.social_accounts[0].status).toBe('expired')
    expect(sentEmails[0]).toMatchObject({ to: ['ana@dire.cl'], subject: expect.stringMatching(/reconecta tu Instagram/) })
  }, 30_000)
})

describe('cortes automáticos', () => {
  it('evento cancelado: borra lo programado en Zernio, desactiva el DM y cancela la serie', async () => {
    await activate()
    setNow(local('2026-10-26', '18:00'))
    await S.runSeriesJobs(db, { origin: SITE, budgetMs: 60_000 })
    const queued = slots().find((s) => s.status === 'queued')
    db.tables.events[0].cancelled_at = new Date().toISOString()
    await S.runSeriesJobs(db, { origin: SITE, budgetMs: 60_000 })
    expect(series()).toMatchObject({ status: 'cancelled', cancel_reason: 'evento cancelado' })
    expect(slots().filter((s) => s.status === 'planned' || s.status === 'queued')).toHaveLength(0)
    expect(zernioCalls).toEqual(expect.arrayContaining([expect.objectContaining({ method: 'DELETE', path: `/posts/${queued.zernio_post_id}` })]))
    expect(zernioCalls.some((c) => c.method === 'DELETE' && c.path.startsWith('/comment-automations/'))).toBe(true)
  }, 30_000)

  it('cambio de fecha: recalcula los slots futuros con aviso; los ya publicados no se tocan', async () => {
    await activate()
    slots()[0].status = 'published'
    setNow(local('2026-10-27', '10:00'))
    db.tables.events[0].event_dates = [{ date: '2026-11-15', start_time: '20:00:00' }]
    const result = await S.reconcileSeries(db, series(), SITE, new Date())
    expect(result).toBe('replanned:cambio de fecha')
    expect(series().notice).toMatch(/Cambió la fecha del evento/)
    expect(series().anchor_starts_at).toBe(local('2026-11-15', '20:00'))
    expect(slots()[0].status).toBe('published')
    const live = slots().filter((s) => s.status === 'planned')
    expect(live.every((s) => s.anchor_starts_at === local('2026-11-15', '20:00'))).toBe(true)
    expect(live.at(-1).publish_at).toBe(local('2026-11-15', '09:00'))
  })

  it('agotado: detiene las publicaciones, publica la historia "agotado" si está activada y el DM responde agotado', async () => {
    setNow(ACTIVATION)
    await call('prepare_social_series', { event_id: 2296, sold_out_story_enabled: true })
    await confirmCall('approve_social_series', { event_id: 2296 })
    setNow(local('2026-11-02', '10:00'))
    // Las 350 entradas se vendieron: 67 vendidas con capacidad 67
    db.tables.event_tickets[0].total_quantity = 67
    const result = await S.reconcileSeries(db, series(), SITE, new Date())
    expect(result).toBe('sold_out')
    expect(series().sold_out_at).toBeTruthy()
    expect(series().notice).toMatch(/Se agotaron las entradas/)
    const pending = slots().filter((s) => s.status === 'planned')
    expect(pending).toEqual([expect.objectContaining({ variant: 'sold_out', kind: 'story' })])
    const patch = zernioCalls.filter((c) => c.method === 'PATCH').at(-1)
    expect(patch.body.dmMessage).toMatch(/se agotaron/)
    expect(patch.body.buttons).toEqual([])
  })

  it('Instagram desconectado: pausa y avisa; al reconectar reanuda desde hoy', async () => {
    await activate()
    db.tables.social_accounts[0].status = 'expired'
    setNow(local('2026-10-28', '10:00'))
    expect(await S.reconcileSeries(db, series(), SITE, new Date())).toBe('paused:instagram_disconnected')
    expect(series()).toMatchObject({ status: 'paused', pause_reason: 'instagram_disconnected' })
    expect(sentEmails).toHaveLength(1)
    db.tables.social_accounts.push({ id: 2, organization_id: 7, platform: 'instagram', zernio_account_id: 'acc-ig-7b', account_name: '@escueladire', status: 'active' })
    setNow(local('2026-10-30', '10:00'))
    expect(await S.reconcileSeries(db, series(), SITE, new Date())).toBe('resumed:instagram_reconnected')
    expect(series()).toMatchObject({ status: 'active', zernio_account_id: 'acc-ig-7b', notice: expect.stringMatching(/Instagram reconectado/) })
    const planned = slots().filter((s) => s.status === 'planned')
    expect(planned.every((s) => Date.parse(s.publish_at) > Date.now())).toBe(true)
    expect(planned[0].days_to_event).toBe(7)
  })

  it('después de la última función, sin pendientes: completa la serie y borra los DM', async () => {
    await activate()
    for (const s of slots()) s.status = 'published'
    setNow(local('2026-11-09', '10:00'))
    expect(await S.reconcileSeries(db, series(), SITE, new Date())).toBe('completed')
    expect(series().status).toBe('completed')
    expect(zernioCalls.some((c) => c.method === 'DELETE' && c.path.startsWith('/comment-automations/'))).toBe(true)
  })
})

describe('pausar, reanudar y cancelar', () => {
  it('pausar no publica nada; reanudar pide confirmación y recalcula desde hoy; cancelar borra el DM', async () => {
    await activate()
    setNow(local('2026-10-27', '09:00'))
    const paused = await call('pause_social_series', { event_id: 2296 })
    expect(paused.series.status).toBe('paused')
    expect(slots().filter((s) => s.status === 'planned')).toHaveLength(0)
    expect((await S.runSeriesJobs(db, { origin: SITE, budgetMs: 60_000 })).dispatched).toBe(0)

    setNow(local('2026-11-03', '09:00'))
    const resumed = await confirmCall('resume_social_series', { event_id: 2296 })
    expect(resumed.series.status).toBe('active')
    const planned = slots().filter((s) => s.status === 'planned')
    expect(planned.map((s) => s.days_to_event).filter((d, i, a) => a.indexOf(d) === i)).toEqual([5, 4, 3, 2, 1, 0])

    const cancelled = await confirmCall('cancel_social_series', { event_id: 2296 })
    expect(cancelled.series.status).toBe('cancelled')
    expect(slots().filter((s) => s.status === 'planned')).toHaveLength(0)
    // Sin series vivas en la cuenta, se borra la automatización de historias
    expect(zernioCalls.filter((c) => c.method === 'DELETE' && c.path.startsWith('/comment-automations/')).length).toBeGreaterThan(0)
    expect(series().zernio_story_automation_id).toBeNull()
  })

  it('get_social_series: DMs desde Zernio, próxima pieza y ventas atribuidas al DM', async () => {
    await activate()
    db.tables.event_orders.push(
      { id: 'o1', event_id: 2296, status: 'paid', ref: 'ig-story-dm', ticket_qty: 2, total_payment: 10952, ticket_fee: 800, service_fee_tax: 152, ticket_details: [{ name: 'General', quantity: 2, price: 5000 }], payment_provider: 'flow', created_at: new Date().toISOString() },
      { id: 'o2', event_id: 2296, status: 'paid', ref: 'whatsapp', ticket_qty: 1, total_payment: 5476, ticket_fee: 400, service_fee_tax: 76, ticket_details: [{ name: 'General', quantity: 1, price: 5000 }], payment_provider: 'flow', created_at: new Date().toISOString() },
    )
    const view = await call('get_social_series', { event_id: 2296 })
    expect(view.series.status).toBe('active')
    expect(view.next_slot).toMatchObject({ kind: 'story', stage: 'Faltan 13 días', status: 'planned' })
    expect(view.dms).toMatchObject({ sent: 5, link_clicks: 3 })
    expect(view.attributed_sales).toMatchObject({ orders: 1, tickets: 2, gross_clp: 10952, by_ref: { 'ig-story-dm': 2 } })
  })
})

describe('webhooks de Zernio', () => {
  const SECRET = 'whsec_' + 'x'.repeat(40)
  const post = (payload, { secret = SECRET, id = 'evt-1' } = {}) => {
    const raw = JSON.stringify(payload)
    return webhookRoute.POST({
      request: new Request(`${SITE}/api/webhooks/zernio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zernio-Event-Id': id, 'X-Zernio-Signature': createHmac('sha256', secret).update(raw).digest('hex') },
        body: raw,
      }),
    })
  }

  it('sin secreto configurado: 404; firma inválida: 401', async () => {
    expect((await post({ id: 'e', event: 'post.published', post: {} })).status).toBe(404)
    process.env.ZERNIO_WEBHOOK_SECRET = SECRET
    expect((await post({ id: 'e', event: 'post.published', post: {} }, { secret: 'otro-secreto' })).status).toBe(401)
  })

  it('publicado: marca el slot con el link; el mismo evento dos veces se procesa una sola', async () => {
    process.env.ZERNIO_WEBHOOK_SECRET = SECRET
    await activate()
    setNow(local('2026-10-26', '18:00'))
    await S.runSeriesJobs(db, { origin: SITE, budgetMs: 60_000 })
    const slot = slots().find((s) => s.status === 'queued')
    const payload = {
      id: 'evt-1',
      event: 'post.platform.published',
      post: { id: slot.zernio_post_id, content: '', status: 'published', scheduledFor: slot.publish_at, publishedAt: slot.publish_at, platforms: [{ platform: 'instagram', status: 'published', publishedUrl: 'https://instagram.com/stories/escueladire/1' }], metadata: { aitickets_slot_id: String(slot.id) } },
      platform: { platform: 'instagram', status: 'published', publishedUrl: 'https://instagram.com/stories/escueladire/1' },
      timestamp: slot.publish_at,
    }
    const res = await post(payload)
    expect(res.status).toBe(200)
    expect(slot).toMatchObject({ status: 'published', platform_post_url: 'https://instagram.com/stories/escueladire/1' })
    const again = await post(payload)
    expect(await again.json()).toMatchObject({ duplicate: true })
  }, 30_000)

  it('fallo por token vencido: slot fallido y serie pausada; cuenta desconectada: pausa las series de esa cuenta', async () => {
    process.env.ZERNIO_WEBHOOK_SECRET = SECRET
    await activate()
    setNow(local('2026-10-26', '18:00'))
    await S.runSeriesJobs(db, { origin: SITE, budgetMs: 60_000 })
    const slot = slots().find((s) => s.status === 'queued')
    await post({ id: 'evt-2', event: 'post.platform.failed', post: { id: slot.zernio_post_id, platforms: [{ platform: 'instagram', status: 'failed', error: 'Token expirado', errorCategory: 'auth_expired' }], metadata: { aitickets_slot_id: String(slot.id) } } }, { id: 'evt-2' })
    expect(slot).toMatchObject({ status: 'failed', error: 'Token expirado' })
    expect(series()).toMatchObject({ status: 'paused', pause_reason: 'instagram_disconnected' })

    // Otra serie activa en la misma cuenta
    series().status = 'active'
    await post({ id: 'evt-3', event: 'account.disconnected', account: { accountId: 'acc-ig-7', profileId: 'prof-7', platform: 'instagram', username: 'escueladire', disconnectionType: 'unintentional', reason: 'token' } }, { id: 'evt-3' })
    expect(series().status).toBe('paused')
    expect(db.tables.social_accounts[0].status).toBe('expired')
  }, 30_000)
})

describe('MCP de admin', () => {
  const actx = () => ({ supabase: db, origin: SITE, requestUrl: new URL(`${SITE}/api/admin/mcp`), keyKind: 'full', fingerprint: 'abcd1234', ipHash: 'f'.repeat(64) })
  const run = async (name, args = {}) => {
    const out = await runAdminTool(getAdminTool(name), args, actx())
    if (!out.ok) throw new Error(`${name}: ${out.code} ${out.message}`)
    return out.result
  }

  it('list_social_series y org_get_social_series ven la serie del productor', async () => {
    await activate()
    const list = await run('list_social_series')
    expect(list.series[0]).toMatchObject({ status: 'active', organization: { id: 7, name: 'Escuela de Música del Dire' }, event: { id: 2296, name: 'Concierto de Primavera' }, pieces: { pending: 17 } })
    expect(getAdminTool('org_get_social_series')).toBeTruthy()
    expect(getAdminTool('org_approve_social_series')).toBeTruthy()
  })

  it('update_social_series_config cambia bandas y horas (y ajusta lo inválido)', async () => {
    const r = await run('update_social_series_config', { default_time: '20:00', daily_from_days: 5, reason: 'Probar con datos de octubre' })
    expect(r.changed).toEqual(expect.arrayContaining([{ key: 'default_time', before: '19:30', after: '20:00' }, { key: 'daily_from_days', before: 7, after: 5 }]))
    expect(db.tables.aitickets_platform_settings[0]).toMatchObject({ key: 'social_series_cadence', value: expect.objectContaining({ default_time: '20:00', daily_from_days: 5 }) })
    expect((await S.loadCadenceConfig(db)).default_time).toBe('20:00')
  })
})
