// Rutas /api/promote/* del panel que no tenían tests: conectar/desconectar redes (Zernio, con state firmado),
// generar contenido con IA, crear/listar/publicar posts, subir imágenes, desconectar la cuenta publicitaria y el
// buscador de segmentación. En cada una: sin sesión, roles fuera del permitido, recursos de otra organización (sin
// escribir nada), acceso por evento (aitickets_event_staff) donde aplica y un caso feliz con lo que se guarda.
// Supabase, Zernio, OpenAI, Claude y Storage falsos (sin red). Las rutas de anuncios create/status/connect/callback/stats
// están en ads-api.test.mjs.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
const IN_A_MONTH = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) // fecha de función siempre futura

const ai = vi.hoisted(() => ({ calls: [], reply: null }))
let db
let session

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
// Roles y hasRole reales (si cambian los conjuntos de roles, estos tests lo notan); solo la sesión es falsa.
vi.mock('../../src/lib/supabaseServer', async (importOriginal) => ({ ...(await importOriginal()), getSessionContext: async () => session }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    constructor(opts) {
      this.beta = { messages: { create: async (args) => { ai.calls.push({ opts, args }); return ai.reply(args) } } }
    }
  },
}))

const connect = await import('../../src/pages/api/promote/connect.ts')
const callback = await import('../../src/pages/api/promote/callback.ts')
const disconnect = await import('../../src/pages/api/promote/disconnect.ts')
const generate = await import('../../src/pages/api/promote/generate.ts')
const postsCreate = await import('../../src/pages/api/promote/posts/create.ts')
const postsIndex = await import('../../src/pages/api/promote/posts/index.ts')
const postsPublish = await import('../../src/pages/api/promote/posts/publish.ts')
const uploadImage = await import('../../src/pages/api/promote/upload-image.ts')
const adsDisconnect = await import('../../src/pages/api/promote/ads/disconnect.ts')
const adsTargeting = await import('../../src/pages/api/promote/ads/targeting.ts')
const { createOAuthState, verifyOAuthState } = await import('../../src/lib/crypto.ts')

const ALL_ROLES = ['producer', 'admin', 'finance', 'editor', 'validator', 'viewer']
const EMR = ['admin', 'producer', 'editor']
const OAR = ['admin', 'producer']
const outside = (allowed) => ALL_ROLES.filter((r) => !allowed.includes(r))
const Z = 'zernio.com/api/v1'
const IMG = 'https://proj.supabase.co/storage/v1/object/public/Events/promote/7-upload-a.jpg'
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#a3e635' } }).png().toBuffer()

const asRole = (role, over = {}) => {
  session = { authUser: { id: 'auth-1' }, dbUser: { id: 1, organization_id: 7, role, ...over } }
}
/** Escrituras en la BD falsa (insert/update/upsert/delete). */
const writes = () => db.calls.filter((c) => c.op !== 'select' && c.op !== 'rpc')
const jsonReq = (method, body, path = '/api/promote/x') =>
  new Request(`https://aitickets.cl${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const redirect = (to) => new Response(null, { status: 302, headers: { Location: to } })

/** APIs externas falsas (Zernio, OpenAI): handlers por "MÉTODO host/ruta"; registra cada llamada. */
function fakeApis(handlers = {}) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const u = new URL(String(url))
    const key = `${init.method || 'GET'} ${u.host}${u.pathname}`
    let body
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body) } catch { body = init.body }
    }
    calls.push({ key, url: u, headers: init.headers || {}, body })
    const h = handlers[key]
    if (!h) return new Response(JSON.stringify({ error: `sin handler ${key}` }), { status: 404 })
    const out = await h({ url: u, body })
    return new Response(JSON.stringify(out.body ?? {}), { status: out.status ?? 200 })
  }))
  return calls
}

function seed() {
  db = createFakeSupabase({
    tables: {
      organizations: [
        { id: 7, public_name: 'Club Norte', zernio_profile_id: 'prof_7' },
        { id: 8, public_name: 'Otra Productora', zernio_profile_id: 'prof_8' },
      ],
      events: [
        {
          id: 10, organization_id: 7, name: 'Viernes Techno', status: 'published', description: '<p>La noche más larga</p>',
          event_dates: [{ date: IN_A_MONTH, start_time: '23:00:00', end_time: '05:00:00' }],
          event_tickets: [{ ticket_name: 'General', price: 10000, status: 'available', is_gift: false }],
          event_locations: [{ venues: { name: 'Club Norte', city: 'Valparaíso', address_line1: 'Errázuriz 1' } }],
        },
        { id: 11, organization_id: 7, name: 'Sábado Indie', status: 'published' },
        { id: 20, organization_id: 8, name: 'Evento Ajeno', status: 'published' },
      ],
      aitickets_event_staff: [],
      social_accounts: [
        { id: 1, organization_id: 7, platform: 'instagram', zernio_account_id: 'zacc_ig7', account_name: '@norte', status: 'active' },
        { id: 2, organization_id: 7, platform: 'facebook', zernio_account_id: 'zacc_fb7', account_name: 'Club Norte', status: 'active' },
        { id: 3, organization_id: 8, platform: 'instagram', zernio_account_id: 'zacc_ig8', account_name: '@otra', status: 'active' },
      ],
      social_posts: [
        { id: 50, organization_id: 7, event_id: 10, content: 'Se viene el Viernes Techno', image_urls: [IMG], platforms: ['instagram'], status: 'draft', scheduled_for: null },
        { id: 51, organization_id: 7, event_id: 11, content: 'Sábado Indie', image_urls: [IMG], platforms: ['instagram', 'facebook'], status: 'scheduled', scheduled_for: '2026-12-01T20:00:00Z' },
        { id: 60, organization_id: 8, event_id: 20, content: 'Post ajeno', image_urls: [IMG], platforms: ['instagram'], status: 'draft', scheduled_for: null },
      ],
      ad_account_connections: [
        { id: 3, organization_id: 7, provider: 'zernio', status: 'active', zernio_account_id: 'zacc_ads7', meta_ad_account_id: 'act_111' },
        { id: 4, organization_id: 8, provider: 'zernio', status: 'active', zernio_account_id: 'zacc_ads8', meta_ad_account_id: 'act_222' },
        { id: 5, organization_id: 7, provider: 'zernio', status: 'revoked', zernio_account_id: 'zacc_old', meta_ad_account_id: 'act_333' },
      ],
      ad_campaigns: [],
    },
  })
  db.uploads = []
  db.storage = {
    from: (bucket) => ({
      upload: async (path, buf, opts) => {
        db.uploads.push({ bucket, path, bytes: buf.length, contentType: opts?.contentType })
        return { data: { path }, error: null }
      },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
    }),
  }
}

beforeEach(() => {
  vi.stubEnv('ZERNIO_API_KEY', 'zk_test')
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'test-key')
  ai.calls.length = 0
  ai.reply = () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '¡Se viene el Viernes Techno! 🎉 #techno' }] })
  seed()
  asRole('producer')
})

// ---------------------------------------------------------------------------
// Conectar una red (Zernio OAuth)
// ---------------------------------------------------------------------------
describe('POST /api/promote/connect', () => {
  const call = (body = { platform: 'instagram' }) => connect.POST({ request: jsonReq('POST', body) })
  const zernioConnect = () => fakeApis({ [`GET ${Z}/connect/instagram`]: () => ({ body: { authUrl: 'https://www.instagram.com/oauth/authorize?x=1' } }) })

  it('sin sesión 401; finance/validator/viewer 403, sin llamar a Zernio ni escribir', async () => {
    const calls = fakeApis({})
    session = null
    expect((await call()).status).toBe(401)
    for (const role of outside(EMR)) {
      asRole(role)
      expect((await call()).status, role).toBe(403)
    }
    expect(calls).toEqual([])
    expect(writes()).toEqual([])
  })

  it('admin, producer y editor: URL de OAuth con el perfil de SU organización y un state firmado (org, usuario, red)', async () => {
    for (const role of EMR) {
      asRole(role)
      const calls = zernioConnect()
      const res = await call()
      expect(res.status, role).toBe(200)
      expect(await res.json()).toEqual({ redirect_url: 'https://www.instagram.com/oauth/authorize?x=1' })
      expect(calls).toHaveLength(1)
      expect(calls[0].headers.Authorization).toBe('Bearer zk_test')
      expect(calls[0].url.searchParams.get('profileId')).toBe('prof_7')
      const back = new URL(calls[0].url.searchParams.get('redirect_url'))
      expect(back.origin + back.pathname).toBe('https://aitickets.cl/api/promote/callback')
      expect(verifyOAuthState(back.searchParams.get('state'))).toMatchObject({ purpose: 'zernio', org: 7, uid: 'auth-1', platform: 'instagram' })
    }
    expect(writes()).toEqual([])
  })

  it('la organización y el perfil del body se ignoran: manda la sesión', async () => {
    const calls = zernioConnect()
    const res = await call({ platform: 'instagram', organization_id: 8, profileId: 'prof_8' })
    expect(res.status).toBe(200)
    expect(calls[0].url.searchParams.get('profileId')).toBe('prof_7')
    const state = verifyOAuthState(new URL(calls[0].url.searchParams.get('redirect_url')).searchParams.get('state'))
    expect(state.org).toBe(7)
    expect(writes()).toEqual([])
  })

  it('sin perfil de Zernio: lo crea y lo guarda solo en la organización de la sesión', async () => {
    db.tables.organizations[0].zernio_profile_id = null
    const calls = fakeApis({
      [`POST ${Z}/profiles`]: () => ({ status: 201, body: { profile: { _id: 'prof_new' } } }),
      [`GET ${Z}/connect/instagram`]: () => ({ body: { authUrl: 'https://ig/oauth' } }),
    })
    expect((await call()).status).toBe(200)
    expect(calls.map((c) => c.key)).toEqual([`POST ${Z}/profiles`, `GET ${Z}/connect/instagram`])
    expect(calls[0].body).toEqual({ name: 'Club Norte' })
    expect(calls[1].url.searchParams.get('profileId')).toBe('prof_new')
    expect(db.tables.organizations.find((o) => o.id === 7).zernio_profile_id).toBe('prof_new')
    expect(db.tables.organizations.find((o) => o.id === 8).zernio_profile_id).toBe('prof_8')
    expect(writes()).toEqual([expect.objectContaining({ table: 'organizations', op: 'update', filters: [{ col: 'id', op: 'eq', value: 7 }] })])
  })

  it('red no soportada 400; sin ZERNIO_API_KEY 500; Zernio caído 502', async () => {
    fakeApis({})
    expect((await call({ platform: 'twitter' })).status).toBe(400)
    expect((await call({ platform: 'facebook' })).status).toBe(502)
    vi.stubEnv('ZERNIO_API_KEY', '')
    expect((await call()).status).toBe(500)
  })
})

describe('GET /api/promote/callback', () => {
  const stateFor = (over = {}) => createOAuthState({ purpose: 'zernio', org: 7, uid: 'auth-1', platform: 'instagram', ts: Date.now(), ...over })
  const params = (state, over = {}) => new URLSearchParams({ state, connected: 'instagram', profileId: 'prof_7', accountId: 'zacc_new', username: '@nuevo', ...over }).toString()
  const call = (qs) => callback.GET({ url: new URL(`https://aitickets.cl/api/promote/callback?${qs}`), redirect, cookies: {} })
  const location = async (qs) => (await call(qs)).headers.get('Location')
  const zernioAccounts = (accounts = [{ _id: 'zacc_new', profileId: 'prof_7', platform: 'instagram' }]) =>
    fakeApis({ [`GET ${Z}/accounts`]: () => ({ body: { accounts } }) })
  /** Cambia el payload del state sin volver a firmarlo. */
  const tamper = (state, patch) => {
    const decoded = Buffer.from(state, 'base64url').toString('utf8')
    const i = decoded.indexOf('.')
    return Buffer.from(`${decoded.slice(0, i)}.${JSON.stringify({ ...JSON.parse(decoded.slice(i + 1)), ...patch })}`).toString('base64url')
  }

  it('sin sesión va al login; un rol sin permiso vuelve con error=forbidden; nada se guarda', async () => {
    const calls = zernioAccounts()
    session = null
    expect(await location(params(stateFor()))).toBe('/organizadores/login')
    for (const role of outside(EMR)) {
      asRole(role)
      expect(await location(params(stateFor())), role).toBe('/dashboard/promote?error=forbidden')
    }
    expect(calls).toEqual([])
    expect(writes()).toEqual([])
  })

  it('state adulterado, de otro usuario, de otra organización, de otro propósito o vencido: se rechaza sin guardar', async () => {
    const calls = zernioAccounts()
    const otherKey = (() => {
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'otra-clave')
      const s = stateFor()
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'test-key')
      return s
    })()
    const cases = {
      'sin state': [new URLSearchParams({ connected: 'instagram', profileId: 'prof_7', accountId: 'zacc_new' }).toString(), 'invalid_state'],
      basura: [params('no-es-un-state'), 'invalid_state'],
      'firmado con otra clave': [params(otherKey), 'invalid_state'],
      'payload cambiado sin firma (uid ajeno → mío)': [params(tamper(stateFor({ uid: 'auth-2' }), { uid: 'auth-1' })), 'invalid_state'],
      'otro usuario': [params(stateFor({ uid: 'auth-2' })), 'invalid_state'],
      'otra organización': [params(stateFor({ org: 8 }), { profileId: 'prof_8' }), 'invalid_state'],
      'state de anuncios': [params(stateFor({ purpose: 'zernio-ads' })), 'invalid_state'],
      vencido: [params(stateFor({ ts: Date.now() - 16 * 60 * 1000 })), 'expired_state'],
      'otra red que la pedida': [params(stateFor(), { connected: 'facebook' }), 'invalid_platform'],
      'red no soportada': [params(stateFor({ platform: undefined }), { connected: 'twitter' }), 'invalid_platform'],
      'faltan datos': [params(stateFor(), { accountId: '' }), 'missing_params'],
    }
    for (const [name, [qs, error]] of Object.entries(cases)) {
      expect(await location(qs), name).toBe(`/dashboard/promote?error=${error}`)
    }
    expect(calls).toEqual([])
    expect(writes()).toEqual([])
    expect(db.tables.social_accounts).toHaveLength(3)
  })

  it('perfil de Zernio de otra organización: invalid_profile sin consultar a Zernio', async () => {
    const calls = zernioAccounts([{ _id: 'zacc_new', profileId: 'prof_8', platform: 'instagram' }])
    expect(await location(params(stateFor(), { profileId: 'prof_8' }))).toBe('/dashboard/promote?error=invalid_profile')
    expect(calls).toEqual([])
    expect(writes()).toEqual([])
  })

  it('la cuenta debe ser del perfil según Zernio (falla cerrado si no se puede confirmar)', async () => {
    const qs = params(stateFor())
    for (const accounts of [[], [{ _id: 'zacc_new', profileId: 'prof_8', platform: 'instagram' }], [{ _id: 'zacc_new', profileId: 'prof_7', platform: 'facebook' }]]) {
      zernioAccounts(accounts)
      expect(await location(qs)).toBe('/dashboard/promote?error=invalid_account')
    }
    fakeApis({ [`GET ${Z}/accounts`]: () => ({ status: 500, body: {} }) })
    expect(await location(qs)).toBe('/dashboard/promote?error=invalid_account')
    expect(writes()).toEqual([])
  })

  it('Zernio devuelve error de OAuth: oauth_failed', async () => {
    expect(await location('error=access_denied')).toBe('/dashboard/promote?error=oauth_failed')
  })

  it('caso feliz: guarda la cuenta en la organización de la sesión; reconectar la reactiva sin duplicar', async () => {
    const calls = zernioAccounts()
    asRole('editor')
    expect(await location(params(stateFor()))).toBe('/dashboard/promote?connected=instagram')
    expect(calls).toHaveLength(1)
    expect(calls[0].url.searchParams.get('profileId')).toBe('prof_7')
    const row = db.tables.social_accounts.find((a) => a.zernio_account_id === 'zacc_new')
    expect(row).toMatchObject({ organization_id: 7, platform: 'instagram', account_name: '@nuevo', status: 'active' })

    row.status = 'revoked'
    expect(await location(params(stateFor(), { username: '@renombrado' }))).toBe('/dashboard/promote?connected=instagram')
    expect(db.tables.social_accounts.filter((a) => a.zernio_account_id === 'zacc_new')).toHaveLength(1)
    expect(row).toMatchObject({ status: 'active', account_name: '@renombrado' })
  })
})

describe('POST /api/promote/disconnect', () => {
  const call = (body = { accountId: 1 }) => disconnect.POST({ request: jsonReq('POST', body) })

  it('sin sesión 401; roles fuera de EMR 403; no se borra nada ni se llama a Zernio', async () => {
    const calls = fakeApis({})
    session = null
    expect((await call()).status).toBe(401)
    for (const role of outside(EMR)) {
      asRole(role)
      expect((await call()).status, role).toBe(403)
    }
    expect(calls).toEqual([])
    expect(writes()).toEqual([])
    expect(db.tables.social_accounts).toHaveLength(3)
  })

  it('cuenta de otra organización: 404, sigue conectada y Zernio no se entera', async () => {
    const calls = fakeApis({})
    const res = await call({ accountId: 3 })
    expect(res.status).toBe(404)
    expect(calls).toEqual([])
    expect(writes()).toEqual([])
    expect(db.tables.social_accounts.find((a) => a.id === 3)).toMatchObject({ organization_id: 8, status: 'active' })
  })

  it('sin accountId 400', async () => {
    expect((await call({})).status).toBe(400)
  })

  it('caso feliz (editor): desconecta en Zernio y borra solo esa fila', async () => {
    asRole('editor')
    const calls = fakeApis({ [`DELETE ${Z}/accounts/zacc_ig7`]: () => ({ body: { ok: true } }) })
    const res = await call({ accountId: 1 })
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].headers.Authorization).toBe('Bearer zk_test')
    expect(db.tables.social_accounts.map((a) => a.id)).toEqual([2, 3])
    expect(writes()).toEqual([expect.objectContaining({ table: 'social_accounts', op: 'delete', filters: [{ col: 'id', op: 'eq', value: 1 }, { col: 'organization_id', op: 'eq', value: 7 }] })])
  })
})

// ---------------------------------------------------------------------------
// Contenido con IA
// ---------------------------------------------------------------------------
describe('POST /api/promote/generate', () => {
  const call = (body) => generate.POST({ request: jsonReq('POST', body) })

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
  })

  it('sin sesión 401; roles fuera de EMR 403 sin llamar a la IA', async () => {
    const calls = fakeApis({})
    session = null
    expect((await call({ eventId: 10, type: 'text' })).status).toBe(401)
    for (const role of outside(EMR)) {
      asRole(role)
      expect((await call({ eventId: 10, type: 'text' })).status, role).toBe(403)
    }
    expect(ai.calls).toEqual([])
    expect(calls).toEqual([])
  })

  it('evento de otra organización: 404 sin llamar a la IA', async () => {
    const calls = fakeApis({})
    for (const type of ['text', 'image', 'ad']) {
      expect((await call({ eventId: 20, type })).status, type).toBe(404)
    }
    expect(ai.calls).toEqual([])
    expect(calls).toEqual([])
    expect(db.uploads).toEqual([])
  })

  it('miembro limitado a ciertos eventos: 404 en los demás, funciona en el suyo', async () => {
    db.tables.aitickets_event_staff.push({ user_id: 1, event_id: 11 })
    asRole('editor')
    expect((await call({ eventId: 10, type: 'text' })).status).toBe(404)
    expect(ai.calls).toEqual([])
    const ok = await call({ eventId: 11, type: 'text' })
    expect(ok.status).toBe(200)
    expect(ai.calls).toHaveLength(1)
    expect(ai.calls[0].args.messages[0].content).toContain('Sábado Indie')
  })

  it('texto: Claude recibe el contexto del evento (nombre, fecha, precio) y la respuesta va tal cual', async () => {
    for (const role of EMR) {
      asRole(role)
      ai.calls.length = 0
      const res = await call({ eventId: 10, type: 'text', tone: 'divertido' })
      expect(res.status, role).toBe(200)
      expect(await res.json()).toEqual({ content: '¡Se viene el Viernes Techno! 🎉 #techno' })
      const { opts, args } = ai.calls[0]
      expect(opts.apiKey).toBe('sk-ant-test')
      expect(args.system).toContain('divertido')
      expect(args.messages[0].content).toMatch(/Viernes Techno[\s\S]*La noche más larga[\s\S]*General: \$10\.000/)
    }
    expect(writes()).toEqual([])
  })

  it('anuncio: título y texto sin links ni hashtags', async () => {
    ai.reply = () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ headline: 'Viernes Techno #fiesta', body: 'Ven a bailar https://x.cl hasta el amanecer' }) }] })
    const res = await call({ eventId: 10, type: 'ad' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ headline: 'Viernes Techno', body: 'Ven a bailar hasta el amanecer' })
  })

  it('imagen: OpenAI genera, se optimiza y se guarda en la carpeta de la organización de la sesión', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test')
    const calls = fakeApis({ 'POST api.openai.com/v1/images/generations': () => ({ body: { data: [{ b64_json: PNG.toString('base64') }] } }) })
    const res = await call({ eventId: 10, type: 'image' })
    expect(res.status).toBe(200)
    const { imageUrl } = await res.json()
    expect(calls).toHaveLength(1)
    expect(calls[0].headers.Authorization).toBe('Bearer sk-openai-test')
    expect(calls[0].body.prompt).toContain('Viernes Techno')
    expect(db.uploads).toHaveLength(1)
    expect(db.uploads[0].bucket).toBe('Events')
    expect(db.uploads[0].path).toMatch(/^promote\/7-ai-/)
    expect(imageUrl).toBe(`https://proj.supabase.co/storage/v1/object/public/Events/${db.uploads[0].path}`)
  })

  it('sin claves de IA: imagen 501, texto y anuncio 500; datos faltantes o tipo inválido 400', async () => {
    const calls = fakeApis({})
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect((await call({ eventId: 10, type: 'image' })).status).toBe(501)
    expect((await call({ eventId: 10, type: 'text' })).status).toBe(500)
    expect((await call({ eventId: 10, type: 'ad' })).status).toBe(500)
    expect((await call({ eventId: 10 })).status).toBe(400)
    expect((await call({ type: 'text' })).status).toBe(400)
    expect((await call({ eventId: 10, type: 'video' })).status).toBe(400)
    expect(calls).toEqual([])
    expect(ai.calls).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Posts en redes
// ---------------------------------------------------------------------------
describe('POST /api/promote/posts/create', () => {
  const body = (over = {}) => ({ eventId: 10, content: 'Se viene el Viernes Techno', imageUrls: [IMG], platforms: ['instagram', 'facebook', 'instagram'], ...over })
  const call = (b = body()) => postsCreate.POST({ request: jsonReq('POST', b) })

  it('sin sesión 401; roles fuera de EMR 403; no se crea nada', async () => {
    session = null
    expect((await call()).status).toBe(401)
    for (const role of outside(EMR)) {
      asRole(role)
      expect((await call()).status, role).toBe(403)
    }
    expect(writes()).toEqual([])
  })

  it('evento de otra organización: 404 sin crear la publicación', async () => {
    expect((await call(body({ eventId: 20 }))).status).toBe(404)
    expect(writes()).toEqual([])
    expect(db.tables.social_posts).toHaveLength(3)
  })

  it('miembro limitado a ciertos eventos: 404 en los demás, crea en el suyo', async () => {
    db.tables.aitickets_event_staff.push({ user_id: 1, event_id: 11 })
    asRole('editor')
    expect((await call(body({ eventId: 10 }))).status).toBe(404)
    expect(writes()).toEqual([])
    expect((await call(body({ eventId: 11 }))).status).toBe(200)
    expect(db.tables.social_posts.at(-1)).toMatchObject({ organization_id: 7, event_id: 11 })
  })

  it('valida datos y reglas de cada red antes de tocar la BD', async () => {
    expect((await call(body({ content: '' }))).status).toBe(400)
    expect((await call(body({ platforms: [] }))).status).toBe(400)
    const noImage = await call(body({ imageUrls: [], platforms: ['instagram'] }))
    expect(noImage.status).toBe(400)
    expect((await noImage.json()).message).toBe('Instagram requiere al menos una imagen.')
    expect((await call(body({ platforms: ['twitter'] }))).status).toBe(400)
    expect(writes()).toEqual([])
  })

  it('caso feliz: borrador en la organización de la sesión (aunque el body diga otra), redes sin repetir; con fecha queda programada', async () => {
    for (const role of EMR) {
      asRole(role)
      const res = await call(body({ organization_id: 8, status: 'published' }))
      expect(res.status, role).toBe(200)
      const { id } = await res.json()
      expect(db.tables.social_posts.find((p) => p.id === id)).toMatchObject({
        organization_id: 7, event_id: 10, content: 'Se viene el Viernes Techno', image_urls: [IMG], platforms: ['instagram', 'facebook'], status: 'draft', scheduled_for: null,
      })
    }
    const when = new Date(Date.now() + 86_400_000).toISOString()
    const res = await call(body({ scheduledFor: when }))
    const { id } = await res.json()
    expect(db.tables.social_posts.find((p) => p.id === id)).toMatchObject({ status: 'scheduled', scheduled_for: when })
  })

  // Mismas reglas que create_social_post (src/lib/socialPostInput.ts); antes el panel aceptaba cualquier cosa
  it('imágenes fuera de AI Tickets o fecha pasada / inválida: 400 sin crear nada', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://proj.supabase.co')
    asRole('editor')
    const before = db.tables.social_posts.length
    expect((await call(body({ imageUrls: ['https://otro-sitio.com/a.jpg'] }))).status).toBe(400)
    expect((await call(body({ imageUrls: ['http://proj.supabase.co/storage/v1/object/public/Events/a.jpg'] }))).status).toBe(400)
    expect((await call(body({ scheduledFor: new Date(Date.now() - 60_000).toISOString() }))).status).toBe(400)
    expect((await call(body({ scheduledFor: new Date(Date.now() + 60_000).toISOString() }))).status).toBe(400)
    expect((await call(body({ scheduledFor: 'mañana a las 8' }))).status).toBe(400)
    expect(db.tables.social_posts.length).toBe(before)
    expect((await call(body({}))).status).toBe(200) // IMG sí es del Storage de AI Tickets
    vi.unstubAllEnvs()
  })
})

describe('GET /api/promote/posts', () => {
  const call = (qs = '') => postsIndex.GET({ url: new URL(`https://aitickets.cl/api/promote/posts${qs}`), request: new Request(`https://aitickets.cl/api/promote/posts${qs}`) })

  it('sin sesión 401; roles fuera de EMR 403', async () => {
    session = null
    expect((await call()).status).toBe(401)
    for (const role of outside(EMR)) {
      asRole(role)
      expect((await call()).status, role).toBe(403)
    }
  })

  it('solo las publicaciones de la organización de la sesión, con filtro de estado', async () => {
    for (const role of EMR) {
      asRole(role)
      const res = await call()
      expect(res.status, role).toBe(200)
      expect((await res.json()).posts.map((p) => p.id)).toEqual([50, 51])
    }
    expect((await (await call('?status=scheduled')).json()).posts.map((p) => p.id)).toEqual([51])
    expect((await (await call('?status=all')).json()).posts.map((p) => p.id)).toEqual([50, 51])
    expect(writes()).toEqual([])
  })
})

describe('POST /api/promote/posts/publish', () => {
  const call = (body = { postId: 50 }) => postsPublish.POST({ request: jsonReq('POST', body) })
  const zernioPosts = (status = 201) => fakeApis({ [`POST ${Z}/posts`]: () => ({ status, body: status < 300 ? { post: { _id: 'zp_1' } } : { message: 'Instagram rechazó la imagen' } }) })

  it('sin sesión 401; roles fuera de EMR 403; no se publica nada', async () => {
    const calls = zernioPosts()
    session = null
    expect((await call()).status).toBe(401)
    for (const role of outside(EMR)) {
      asRole(role)
      expect((await call()).status, role).toBe(403)
    }
    expect(calls).toEqual([])
    expect(writes()).toEqual([])
  })

  it('post de otra organización: 404, no llega a Zernio y queda intacto', async () => {
    const calls = zernioPosts()
    const res = await call({ postId: 60 })
    expect(res.status).toBe(404)
    expect(calls).toEqual([])
    expect(writes()).toEqual([])
    expect(db.tables.social_posts.find((p) => p.id === 60)).toMatchObject({ organization_id: 8, status: 'draft' })
  })

  it('sin postId 400', async () => {
    expect((await call({})).status).toBe(400)
  })

  it('caso feliz: publica ahora solo en las cuentas de la organización y guarda el id de Zernio', async () => {
    asRole('editor')
    const calls = zernioPosts()
    const res = await call({ postId: 50 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: 'Publicación hecha', zernio_post_id: 'zp_1' })
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ content: 'Se viene el Viernes Techno', platforms: [{ platform: 'instagram', accountId: 'zacc_ig7' }], publishNow: true, mediaItems: [{ type: 'image', url: IMG }] })
    expect(JSON.stringify(calls[0].body)).not.toContain('zacc_ig8')
    expect(db.tables.social_posts.find((p) => p.id === 50)).toMatchObject({ status: 'published', zernio_post_id: 'zp_1', error_message: null })
    expect(db.tables.social_posts.find((p) => p.id === 60).status).toBe('draft')
  })

  it('con fecha: se programa en hora de Chile', async () => {
    const calls = zernioPosts()
    const res = await call({ postId: 51 })
    expect((await res.json()).message).toBe('Publicación programada')
    expect(calls[0].body).toMatchObject({ scheduledFor: '2026-12-01T20:00:00Z', timezone: 'America/Santiago' })
    expect(calls[0].body.platforms.map((p) => p.accountId)).toEqual(['zacc_ig7', 'zacc_fb7'])
    expect(db.tables.social_posts.find((p) => p.id === 51)).toMatchObject({ status: 'scheduled', zernio_post_id: 'zp_1', published_at: null })
  })

  it('si Zernio falla: 502 y el post queda fallido con el motivo', async () => {
    zernioPosts(400)
    const res = await call({ postId: 50 })
    expect(res.status).toBe(502)
    expect(db.tables.social_posts.find((p) => p.id === 50)).toMatchObject({ status: 'failed', error_message: 'Instagram rechazó la imagen' })
  })

  // La ruta aplica las reglas de publish_social_post (checkPublishable): un miembro asignado solo al evento 11 no
  // publica el post del evento 10 de su organización (403, como en la API de productores). Antes lo publicaba.
  it('miembro limitado a ciertos eventos no publica posts de otros eventos', async () => {
    db.tables.aitickets_event_staff.push({ user_id: 1, event_id: 11 })
    asRole('editor')
    const calls = zernioPosts()
    const res = await call({ postId: 50 })
    expect(res.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('evento en borrador o cancelado: no se publica (409) y no llega a Zernio', async () => {
    asRole('editor')
    const calls = zernioPosts()
    const ev = db.tables.events.find((e) => e.id === 10)
    ev.status = 'draft'
    expect((await call({ postId: 50 })).status).toBe(409)
    ev.status = 'published'
    ev.cancelled_at = '2026-11-01T00:00:00Z'
    expect((await call({ postId: 50 })).status).toBe(409)
    expect(calls).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Imágenes de posts
// ---------------------------------------------------------------------------
describe('POST /api/promote/upload-image', () => {
  const call = (file) => {
    const fd = new FormData()
    if (file) fd.append('file', file)
    return uploadImage.POST({ request: new Request('https://aitickets.cl/api/promote/upload-image', { method: 'POST', body: fd }), cookies: {} })
  }
  const pngFile = () => new File([PNG], 'flyer.png', { type: 'image/png' })

  it('sin sesión 401; roles fuera de EMR 403; no se sube nada', async () => {
    session = null
    expect((await call(pngFile())).status).toBe(401)
    for (const role of outside(EMR)) {
      asRole(role)
      expect((await call(pngFile())).status, role).toBe(403)
    }
    expect(db.uploads).toEqual([])
  })

  it('sin archivo, más de 5 MB o un archivo que no es imagen (SVG disfrazado): 400', async () => {
    expect((await call(null)).status).toBe(400)
    expect((await call(new File([Buffer.alloc(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))).status).toBe(400)
    const svg = await call(new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'x.png', { type: 'image/png' }))
    expect(svg.status).toBe(400)
    expect((await svg.json()).message).toMatch(/JPG, PNG, WEBP o GIF/)
    expect(db.uploads).toEqual([])
  })

  it('caso feliz: optimiza y guarda en promote/<org de la sesión>-upload', async () => {
    for (const role of EMR) {
      asRole(role)
      const res = await call(pngFile())
      expect(res.status, role).toBe(200)
      const { url } = await res.json()
      const up = db.uploads.at(-1)
      expect(up.path).toMatch(/^promote\/7-upload-/)
      expect(url).toBe(`https://proj.supabase.co/storage/v1/object/public/Events/${up.path}`)
    }
    expect(db.uploads).toHaveLength(EMR.length)
  })
})

// ---------------------------------------------------------------------------
// Anuncios: desconectar la cuenta y buscador de segmentación
// ---------------------------------------------------------------------------
describe('POST /api/promote/ads/disconnect', () => {
  const call = (body = { connectionId: 3 }) => adsDisconnect.POST({ request: jsonReq('POST', body) })

  it('sin sesión 401; solo dueños/administradores (editor y demás 403); nada cambia', async () => {
    session = null
    expect((await call()).status).toBe(401)
    for (const role of outside(OAR)) {
      asRole(role)
      expect((await call()).status, role).toBe(403)
    }
    expect(writes()).toEqual([])
    expect(db.tables.ad_account_connections.find((c) => c.id === 3).status).toBe('active')
  })

  it('cuenta de otra organización: 404 y sigue activa', async () => {
    expect((await call({ connectionId: 4 })).status).toBe(404)
    expect(writes()).toEqual([])
    expect(db.tables.ad_account_connections.find((c) => c.id === 4).status).toBe('active')
  })

  it('id inválido o body roto 400; con anuncios activos o en revisión 400 sin desconectar', async () => {
    expect((await call({ connectionId: 'x' })).status).toBe(400)
    expect((await adsDisconnect.POST({ request: new Request('https://aitickets.cl/x', { method: 'POST', body: '{' }) })).status).toBe(400)
    db.tables.ad_campaigns.push({ id: 9, organization_id: 7, ad_account_connection_id: 3, status: 'pending_review' })
    const res = await call()
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/Pausa o cancela/)
    expect(writes()).toEqual([])
  })

  it('caso feliz (admin y producer): queda revocada sin borrar la fila; la de otra organización no se toca', async () => {
    db.tables.ad_campaigns.push({ id: 9, organization_id: 7, ad_account_connection_id: 3, status: 'paused' })
    for (const role of OAR) {
      asRole(role)
      db.tables.ad_account_connections.find((c) => c.id === 3).status = 'active'
      const res = await call()
      expect(res.status, role).toBe(200)
      expect(db.tables.ad_account_connections.find((c) => c.id === 3)).toMatchObject({ status: 'revoked', organization_id: 7 })
    }
    expect(db.tables.ad_account_connections.find((c) => c.id === 4).status).toBe('active')
    expect(writes().every((w) => w.filters.some((f) => f.col === 'organization_id' && f.value === 7))).toBe(true)
  })
})

describe('GET /api/promote/ads/targeting', () => {
  const call = (qs) => {
    const url = new URL(`https://aitickets.cl/api/promote/ads/targeting?${qs}`)
    return adsTargeting.GET({ url, request: new Request(url) })
  }
  const zernioSearch = () =>
    fakeApis({
      [`GET ${Z}/ads/targeting/search`]: ({ url }) => ({
        body: { results: url.searchParams.get('dimension') === 'geo' ? [{ id: 263039, name: 'Valparaíso', path: ['Chile', 'Valparaíso'] }] : [{ id: '6003', name: 'Música electrónica', audienceSize: 120000 }] },
      }),
    })

  it('sin sesión 401; roles fuera de EMR 403; anuncios apagados 503', async () => {
    const calls = zernioSearch()
    session = null
    expect((await call('connectionId=3&q=valpo')).status).toBe(401)
    for (const role of outside(EMR)) {
      asRole(role)
      expect((await call('connectionId=3&q=valpo')).status, role).toBe(403)
    }
    asRole('producer')
    vi.stubEnv('ADS_ENABLED', 'false')
    expect((await call('connectionId=3&q=valpo')).status).toBe(503)
    expect(calls).toEqual([])
  })

  it('cuenta publicitaria de otra organización o revocada: 404 sin consultar a Zernio', async () => {
    const calls = zernioSearch()
    expect((await call('connectionId=4&q=valpo')).status).toBe(404)
    expect((await call('connectionId=5&q=valpo')).status).toBe(404)
    expect(calls).toEqual([])
  })

  it('búsqueda muy corta: lista vacía sin consultar; dimensión desconocida 400', async () => {
    const calls = zernioSearch()
    expect(await (await call('connectionId=3&q=v')).json()).toEqual({ results: [] })
    expect((await call('connectionId=3&q=valpo&dimension=age')).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('caso feliz: ciudades de Chile e intereses con la cuenta de Zernio de la organización', async () => {
    asRole('editor')
    const calls = zernioSearch()
    const geo = await call('connectionId=3&q=valpo')
    expect(geo.status).toBe(200)
    expect(await geo.json()).toEqual({ results: [{ key: '263039', name: 'Valparaíso', path: ['Chile', 'Valparaíso'] }] })
    expect(calls[0].url.searchParams.get('accountId')).toBe('zacc_ads7')
    expect(calls[0].url.searchParams.get('countryCode')).toBe('CL')

    const interests = await call('connectionId=3&q=techno&dimension=interest')
    expect((await interests.json()).results).toEqual([{ id: '6003', name: 'Música electrónica', path: [], audienceSize: 120000 }])
    expect(calls[1].url.searchParams.get('dimension')).toBe('interest')
    expect(writes()).toEqual([])
  })
})
