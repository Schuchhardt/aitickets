// Foto para celular e imágenes sin URL pública por el MCP:
// - upload_image / generate_image con set_as_mobile_cover (events.cover_mobile_url, src/lib/eventImageUse.ts)
// - create_image_upload_link: link firmado y temporal (/subir-imagen/<token>, netlify/lib/image-upload-token.mjs)
// - POST /api/images/upload-link: subida sin sesión autorizada por ese link
// Sin red: Supabase falso en memoria con un storage mínimo.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

process.env.IMAGE_UPLOAD_TOKEN_SECRET = 'test-secret'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')
const { signImageUploadToken, verifyImageUploadToken, IMAGE_UPLOAD_MAX_MINUTES } = await import('../../netlify/lib/image-upload-token.mjs')
const route = await import('../../src/pages/api/images/upload-link.ts')

const PNG = await sharp({ create: { width: 8, height: 10, channels: 3, background: '#7c3aed' } }).png().toBuffer()
const COVER = 'https://x.supabase.co/storage/v1/object/public/Events/event-covers/7-cover.jpg'

let uploads
let rateAllowed

function seed(event = {}) {
  uploads = []
  rateAllowed = true
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Dance Studio' }, { id: 8, public_name: 'Otra' }],
      events: [
        { id: 10, name: 'Gala', slug: 'gala-1', status: 'published', organization_id: 7, image_url: COVER, cover_mobile_url: null, page_settings: { layout: 'banner' }, ...event },
        { id: 20, name: 'Ajeno', slug: 'ajeno-1', status: 'published', organization_id: 8, image_url: COVER, cover_mobile_url: null, page_settings: { layout: 'banner' } },
      ],
      aitickets_api_audit: [],
    },
    rpc: { aitickets_rate_limit_hit: () => rateAllowed },
  })
  db.storage = {
    from: () => ({
      upload: async (name, buffer, opts) => {
        uploads.push({ name, bytes: buffer.length, contentType: opts.contentType })
        return { error: null }
      },
      getPublicUrl: (name) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/Events/${name}` } }),
    }),
  }
}

const ctx = () => ({
  supabase: db,
  actor: { keyId: 'k1', userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'ana@prod.cl', scopes: ['read', 'write'] },
  origin: 'https://aitickets.cl',
  requestUrl: new URL('https://aitickets.cl/api/mcp'),
  channel: 'mcp',
})
const run = (name, args) => runTool(getTool(name), args, ctx())
const eventRow = (id = 10) => db.tables.events.find((e) => e.id === id)
const b64 = PNG.toString('base64')

const post = (token, file) => {
  const fd = new FormData()
  if (token !== undefined) fd.append('t', token)
  if (file) fd.append('file', file)
  return route.POST({ request: new Request('https://aitickets.cl/api/images/upload-link', { method: 'POST', body: fd }) })
}
const tokenFor = (p) => signImageUploadToken(p).token

beforeEach(() => seed())

describe('upload_image con set_as_mobile_cover', () => {
  it('deja la imagen como foto para celular y no toca la imagen principal', async () => {
    const out = await run('upload_image', { image_base64: b64, event_id: 10, set_as_mobile_cover: true })
    expect(out.ok).toBe(true)
    expect(out.result).toMatchObject({ set_as_cover: false, set_as_mobile_cover: true })
    expect(out.result.warnings).toBeUndefined()
    expect(eventRow().cover_mobile_url).toBe(out.result.url)
    expect(eventRow().image_url).toBe(COVER)
  })

  it('avisa si el diseño no es Portada ancha (se guarda igual)', async () => {
    seed({ page_settings: { layout: 'poster' } })
    const out = await run('upload_image', { image_base64: b64, event_id: 10, set_as_mobile_cover: true })
    expect(out.ok).toBe(true)
    expect(out.result.warnings[0]).toMatch(/Portada ancha/)
    expect(eventRow().cover_mobile_url).toBe(out.result.url)
  })

  it('sin imagen principal, sin event_id o junto a set_as_cover: invalid_input sin subir nada', async () => {
    expect(await run('upload_image', { image_base64: b64, set_as_mobile_cover: true })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await run('upload_image', { image_base64: b64, event_id: 10, set_as_cover: true, set_as_mobile_cover: true })).toMatchObject({ ok: false, code: 'invalid_input' })
    seed({ image_url: null })
    const out = await run('upload_image', { image_base64: b64, event_id: 10, set_as_mobile_cover: true })
    expect(out).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(out.message).toMatch(/primero sube la portada/)
    expect(uploads).toEqual([])
  })

  it('set_as_cover sigue cambiando solo la imagen principal', async () => {
    const out = await run('upload_image', { image_base64: b64, event_id: 10, set_as_cover: true })
    expect(out.result).toMatchObject({ set_as_cover: true, set_as_mobile_cover: false })
    expect(eventRow().image_url).toBe(out.result.url)
    expect(eventRow().cover_mobile_url).toBeNull()
  })

  it('generate_image con set_as_mobile_cover sin imagen principal no gasta una generación', async () => {
    seed({ image_url: null })
    process.env.OPENAI_API_KEY = 'sk-test'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const out = await run('generate_image', { event_id: 10, format: 'portrait', set_as_mobile_cover: true })
      expect(out).toMatchObject({ ok: false, code: 'invalid_input' })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      delete process.env.OPENAI_API_KEY
    }
  })
})

describe('token del link de subida', () => {
  it('firma y verifica organización, evento, destino y vencimiento', () => {
    const now = new Date('2026-11-19T12:00:00Z')
    const { token, expiresAt } = signImageUploadToken({ orgId: 7, eventId: 10, use: 'mobile_cover', now })
    expect(expiresAt.toISOString()).toBe('2026-11-19T12:30:00.000Z')
    expect(verifyImageUploadToken(token, now)).toMatchObject({ orgId: 7, eventId: 10, use: 'mobile_cover' })
    expect(verifyImageUploadToken(token, new Date('2026-11-19T12:31:00Z'))).toBeNull()
    expect(verifyImageUploadToken(token.slice(0, -2) + 'xx', now)).toBeNull()
    expect(verifyImageUploadToken('', now)).toBeNull()
  })

  it('library no necesita evento; cover y mobile_cover sí; el plazo tiene tope', () => {
    const now = new Date('2026-11-19T12:00:00Z')
    expect(verifyImageUploadToken(signImageUploadToken({ orgId: 7, use: 'library', now }).token, now)).toMatchObject({ orgId: 7, eventId: null, use: 'library' })
    expect(signImageUploadToken({ orgId: 7, use: 'cover', now })).toBeNull()
    expect(signImageUploadToken({ orgId: 7, eventId: 10, use: 'otro', now })).toBeNull()
    const long = signImageUploadToken({ orgId: 7, eventId: 10, use: 'cover', minutes: 9999, now })
    expect((long.expiresAt - now) / 60000).toBe(IMAGE_UPLOAD_MAX_MINUTES)
  })
})

describe('create_image_upload_link (MCP)', () => {
  it('devuelve un link de /subir-imagen con un token válido para ese evento y destino', async () => {
    const out = await run('create_image_upload_link', { use: 'mobile_cover', event_id: 10 })
    expect(out.ok).toBe(true)
    expect(out.result.upload_url).toMatch(/^https:\/\/aitickets\.cl\/subir-imagen\//)
    const token = out.result.upload_url.split('/subir-imagen/')[1]
    expect(verifyImageUploadToken(token)).toMatchObject({ orgId: 7, eventId: 10, use: 'mobile_cover' })
    expect(out.result).toMatchObject({ use: 'mobile_cover', event_id: 10 })
    expect(db.tables.aitickets_api_audit).toHaveLength(1)
  })

  it('library sin evento; cover/mobile_cover sin evento, evento ajeno o sin portada: rechazado', async () => {
    expect((await run('create_image_upload_link', { use: 'library' })).ok).toBe(true)
    expect(await run('create_image_upload_link', { use: 'cover' })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await run('create_image_upload_link', { use: 'cover', event_id: 20 })).toMatchObject({ ok: false, code: 'not_found' })
    seed({ image_url: null })
    expect(await run('create_image_upload_link', { use: 'mobile_cover', event_id: 10 })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect((await run('create_image_upload_link', { use: 'cover', event_id: 10 })).ok).toBe(true)
  })
})

describe('POST /api/images/upload-link', () => {
  it('sin token, con token vencido o adulterado: 401 sin subir nada', async () => {
    const file = new File([PNG], 'a.png')
    expect((await post(undefined, file)).status).toBe(401)
    expect((await post('abc.def', file)).status).toBe(401)
    const expired = tokenFor({ orgId: 7, eventId: 10, use: 'cover', now: new Date(Date.now() - 3 * 3600 * 1000) })
    expect((await post(expired, file)).status).toBe(401)
    expect(uploads).toEqual([])
    expect(eventRow().image_url).toBe(COVER)
  })

  it('mobile_cover: guarda la foto para celular del evento del token y deja la portada igual', async () => {
    const res = await post(tokenFor({ orgId: 7, eventId: 10, use: 'mobile_cover' }), new File([PNG], 'a.png'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body).toMatchObject({ use: 'mobile_cover', event_id: 10 })
    expect(body.url).toMatch(/\/Events\/promote\/7-link/)
    expect(eventRow().cover_mobile_url).toBe(body.url)
    expect(eventRow().image_url).toBe(COVER)
    expect(eventRow(20).cover_mobile_url).toBeNull()
  })

  it('cover: cambia la imagen principal; library: solo aloja y devuelve la URL', async () => {
    const cover = await (await post(tokenFor({ orgId: 7, eventId: 10, use: 'cover' }), new File([PNG], 'a.png'))).json()
    expect(eventRow().image_url).toBe(cover.url)
    const before = { ...eventRow() }
    const lib = await post(tokenFor({ orgId: 7, use: 'library' }), new File([PNG], 'a.png'))
    expect(lib.status).toBe(200)
    expect((await lib.json()).url).toMatch(/\/Events\/promote\/7-link/)
    expect(eventRow()).toEqual(before)
  })

  it('sin archivo, más de 5 MB o algo que no es imagen: 400 sin subir nada', async () => {
    const token = tokenFor({ orgId: 7, eventId: 10, use: 'mobile_cover' })
    expect((await post(token, null)).status).toBe(400)
    expect((await post(token, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png'))).status).toBe(400)
    expect((await post(token, new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'a.svg', { type: 'image/svg+xml' }))).status).toBe(400)
    expect(uploads).toEqual([])
    expect(eventRow().cover_mobile_url).toBeNull()
  })

  it('el evento ya no existe o quedó sin portada: no guarda nada; tope de subidas: 429', async () => {
    const token = tokenFor({ orgId: 7, eventId: 10, use: 'mobile_cover' })
    seed({ image_url: null })
    expect((await post(token, new File([PNG], 'a.png'))).status).toBe(400)
    // token de la organización 7 apuntando a un evento de la 8
    expect((await post(tokenFor({ orgId: 7, eventId: 20, use: 'cover' }), new File([PNG], 'a.png'))).status).toBe(404)
    expect(uploads).toEqual([])
    seed()
    rateAllowed = false
    expect((await post(token, new File([PNG], 'a.png'))).status).toBe(429)
    expect(uploads).toEqual([])
  })
})
