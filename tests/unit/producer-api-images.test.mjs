// generate_image con imágenes de referencia (OpenAI /v1/images/edits, multipart image[]) y upload_image por URL.
// Sin red: fetch global simulado, Supabase falso en memoria con un storage mínimo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')
const { generateEventImage } = await import('../../src/lib/marketing.ts')

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2])
const AI_B64 = Buffer.from(PNG).toString('base64')

let uploads
let fetchMock

function seed(event = {}) {
  uploads = []
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Mi Productora' }],
      events: [{ id: 10, name: 'Fiesta', slug: 'fiesta-1', status: 'draft', organization_id: 7, image_url: null, ...event }],
      aitickets_api_audit: [],
    },
    rpc: { aitickets_rate_limit_hit: () => true },
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

const IMAGES = {
  'https://8.8.8.8/flyer.png': PNG,
  'https://8.8.4.4/foto.jpg': JPG,
  'https://8.8.8.8/anim.gif': GIF,
  'https://8.8.8.8/cover.jpg': JPG,
}

beforeEach(() => {
  seed()
  process.env.OPENAI_API_KEY = 'sk-test'
  fetchMock = vi.fn(async (input, init) => {
    const url = String(input)
    if (url.startsWith('https://api.openai.com/')) return new Response(JSON.stringify({ data: [{ b64_json: AI_B64 }] }), { status: 200 })
    if (IMAGES[url]) return new Response(IMAGES[url], { status: 200 })
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.OPENAI_API_KEY
})

const openaiCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('https://api.openai.com/'))

describe('generateEventImage', () => {
  it('sin referencias usa /images/generations con JSON', async () => {
    const url = await generateEventImage('Evento: Fiesta', 7, { extraPrompt: 'neón' })
    const [[endpoint, init]] = openaiCalls()
    expect(endpoint).toBe('https://api.openai.com/v1/images/generations')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ model: 'gpt-image-1', n: 1, size: '1024x1024', quality: 'medium' })
    expect(body.prompt).toMatch(/NO TEXT/)
    expect(body.prompt).toMatch(/neón/)
    expect(url).toMatch(/\/storage\/v1\/object\/public\/Events\/promote\/7-/)
  })

  it('con referencias usa /images/edits con FormData e image[]', async () => {
    await generateEventImage('Evento: Fiesta', 7, {
      size: '1024x1536',
      referenceImages: [{ buffer: Buffer.from(PNG), contentType: 'image/png' }, { buffer: Buffer.from(JPG), contentType: 'image/jpeg' }],
    })
    const [[endpoint, init]] = openaiCalls()
    expect(endpoint).toBe('https://api.openai.com/v1/images/edits')
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.headers['Content-Type']).toBeUndefined() // el boundary lo pone fetch
    const images = init.body.getAll('image[]')
    expect(images).toHaveLength(2)
    expect(images[0].type).toBe('image/png')
    expect(images[1].type).toBe('image/jpeg')
    expect(init.body.get('model')).toBe('gpt-image-1')
    expect(init.body.get('size')).toBe('1024x1536')
    expect(init.body.get('quality')).toBe('medium')
    expect(init.body.get('prompt')).toMatch(/reference images/)
    expect(init.body.get('prompt')).toMatch(/NO TEXT/)
  })
})

describe('generate_image (MCP)', () => {
  it('descarga las referencias por URL y las envía a /images/edits', async () => {
    const out = await run('generate_image', { event_id: 10, reference_image_urls: ['https://8.8.8.8/flyer.png', 'https://8.8.4.4/foto.jpg'], prompt: 'mismo estilo' })
    expect(out.ok).toBe(true)
    expect(out.result.reference_images_used).toBe(2)
    const [[endpoint, init]] = openaiCalls()
    expect(endpoint).toBe('https://api.openai.com/v1/images/edits')
    expect(init.body.getAll('image[]')).toHaveLength(2)
    expect(uploads).toHaveLength(1)
  })

  it('sin referencias sigue usando /images/generations', async () => {
    const out = await run('generate_image', { event_id: 10 })
    expect(out.ok).toBe(true)
    expect(out.result.reference_images_used).toBe(0)
    expect(openaiCalls()[0][0]).toBe('https://api.openai.com/v1/images/generations')
  })

  it('use_event_cover_as_reference usa la portada del evento', async () => {
    seed({ image_url: 'https://8.8.8.8/cover.jpg' })
    const out = await run('generate_image', { event_id: 10, use_event_cover_as_reference: true, set_as_cover: true })
    expect(out.ok).toBe(true)
    expect(fetchMock.mock.calls.some(([u]) => String(u) === 'https://8.8.8.8/cover.jpg')).toBe(true)
    expect(openaiCalls()[0][1].body.getAll('image[]')).toHaveLength(1)
    expect(db.tables.events[0].image_url).toMatch(/\/Events\/promote\//)
  })

  it('use_event_cover_as_reference sin portada => invalid_input', async () => {
    const out = await run('generate_image', { event_id: 10, use_event_cover_as_reference: true })
    expect(out).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(openaiCalls()).toHaveLength(0)
  })

  it('referencia inválida (http, no descargable o GIF) => error claro y sin llamar a OpenAI', async () => {
    let out = await run('generate_image', { event_id: 10, reference_image_urls: ['http://8.8.8.8/flyer.png'] })
    expect(out).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(out.message).toMatch(/Referencia 1.*https/)
    out = await run('generate_image', { event_id: 10, reference_image_urls: ['https://8.8.8.8/flyer.png', 'https://8.8.8.8/no-existe.png'] })
    expect(out).toMatchObject({ ok: false, code: 'upstream' })
    expect(out.message).toMatch(/Referencia 2/)
    out = await run('generate_image', { event_id: 10, reference_image_urls: ['https://8.8.8.8/anim.gif'] })
    expect(out).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(out.message).toMatch(/GIF/)
    expect(openaiCalls()).toHaveLength(0)
  })

  it('máximo 4 referencias', async () => {
    const out = await run('generate_image', { event_id: 10, reference_image_urls: Array(5).fill('https://8.8.8.8/flyer.png') })
    expect(out).toMatchObject({ ok: false, code: 'invalid_input' })
  })
})

describe('upload_image (MCP)', () => {
  it('sube una imagen desde una URL https y la deja como portada', async () => {
    const out = await run('upload_image', { image_url: 'https://8.8.4.4/foto.jpg', event_id: 10, set_as_cover: true })
    expect(out.ok).toBe(true)
    expect(out.result).toMatchObject({ content_type: 'image/jpeg', set_as_cover: true })
    expect(db.tables.events[0].image_url).toBe(out.result.url)
  })

  it('URL no https => mensaje claro', async () => {
    const out = await run('upload_image', { image_url: 'http://8.8.4.4/foto.jpg' })
    expect(out).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(out.message).toMatch(/https/)
  })
})
