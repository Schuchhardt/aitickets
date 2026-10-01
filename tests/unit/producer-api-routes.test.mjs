// Rutas HTTP de la API de productores: /api/mcp, /api/v1/<herramienta> y /api/api-keys (dashboard).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))
vi.mock('../../src/lib/supabaseServer', () => ({
  EVENT_MANAGER_ROLES: ['admin', 'producer', 'editor'],
  ORG_ADMIN_ROLES: ['admin', 'producer'],
  getSessionContext: async () => session,
  hasRole: (u, roles) => roles.includes(u?.role),
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

const { generateApiKey } = await import('../../src/lib/producer-api/keys.ts')
const mcp = await import('../../src/pages/api/mcp.ts')
const rest = await import('../../src/pages/api/v1/[tool].ts')
const catalog = await import('../../src/pages/api/v1/index.ts')
const apiKeys = await import('../../src/pages/api/api-keys/index.ts')

let key
beforeEach(() => {
  const generated = generateApiKey()
  key = generated.key
  db = createFakeSupabase({
    tables: {
      users: [
        { id: 1, name: 'Ana', email: 'ana@prod.cl', organization_id: 7, role: 'producer', active: true },
        { id: 4, name: 'Edu', email: 'edu@prod.cl', organization_id: 7, role: 'editor', active: true },
      ],
      events: [{ id: 10, name: 'Fiesta', slug: 'fiesta', status: 'draft', organization_id: 7 }],
      aitickets_api_keys: [{ id: '11111111-1111-1111-1111-111111111111', organization_id: 7, user_id: 1, name: 'mía', key_prefix: generated.prefix, key_hash: generated.hash, scopes: ['read'], revoked_at: null }],
      aitickets_api_audit: [],
      aitickets_discount_codes: [],
    },
  })
})

const post = (url, body, headers = {}) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

describe('/api/mcp', () => {
  it('sin llave: 401 con WWW-Authenticate', async () => {
    const res = await mcp.POST({ request: post('https://aitickets.test/api/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' }) })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer/)
  })

  it('initialize + notificación (202) + tools/call', async () => {
    const auth = { Authorization: `Bearer ${key}` }
    const init = await mcp.POST({ request: post('https://aitickets.test/api/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, auth) })
    expect(init.status).toBe(200)
    expect(init.headers.get('access-control-allow-origin')).toBe('*')
    expect((await init.json()).result.serverInfo.name).toBe('aitickets')

    const notif = await mcp.POST({ request: post('https://aitickets.test/api/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, auth) })
    expect(notif.status).toBe(202)

    const call = await mcp.POST({ request: post('https://aitickets.test/api/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_events', arguments: {} } }, auth) })
    const body = await call.json()
    expect(body.result.structuredContent.events.map((e) => e.id)).toEqual([10])
  })

  it('JSON inválido: error de parseo', async () => {
    const req = new Request('https://aitickets.test/api/mcp', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: '{no json' })
    const res = await mcp.POST({ request: req })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe(-32700)
  })

  it('GET responde 405 (sin stream SSE)', async () => {
    expect((await mcp.GET({ request: new Request('https://aitickets.test/api/mcp') })).status).toBe(405)
  })
})

describe('/api/v1', () => {
  it('catálogo público con todas las herramientas', async () => {
    const res = await catalog.GET({ request: new Request('https://aitickets.test/api/v1') })
    const body = await res.json()
    expect(body.mcp_endpoint).toBe('https://aitickets.test/api/mcp')
    expect(body.tools.find((t) => t.name === 'create_event')).toMatchObject({ scope: 'write', method: 'POST' })
  })

  it('herramienta desconocida: 404; sin llave: 401', async () => {
    expect((await rest.POST({ params: { tool: 'nada' }, request: post('https://aitickets.test/api/v1/nada', {}) })).status).toBe(404)
    expect((await rest.POST({ params: { tool: 'list_events' }, request: post('https://aitickets.test/api/v1/list_events', {}) })).status).toBe(401)
  })

  it('ejecuta la herramienta y mapea errores a HTTP', async () => {
    const auth = { Authorization: `Bearer ${key}` }
    const ok = await rest.POST({ params: { tool: 'get_event' }, request: post('https://aitickets.test/api/v1/get_event', { event_id: 10 }, auth) })
    expect(ok.status).toBe(200)
    expect((await ok.json()).data.event_id).toBe(10)
    const forbidden = await rest.POST({ params: { tool: 'create_discount_code' }, request: post('https://aitickets.test/api/v1/create_discount_code', { code: 'X10', kind: 'percent', value: 10 }, auth) })
    expect(forbidden.status).toBe(403)
    expect((await forbidden.json()).error.code).toBe('forbidden')
    const missing = await rest.POST({ params: { tool: 'get_event' }, request: post('https://aitickets.test/api/v1/get_event', { event_id: 999 }, auth) })
    expect(missing.status).toBe(404)
  })
})

describe('/api/api-keys', () => {
  const ctx = (method, body, search = '') => ({
    request: new Request(`https://aitickets.test/api/api-keys${search}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }),
    url: new URL(`https://aitickets.test/api/api-keys${search}`),
  })

  it('crea una llave: la devuelve una vez y guarda solo el hash', async () => {
    session = { dbUser: { id: 4, name: 'Edu', organization_id: 7, role: 'editor' } }
    const res = await apiKeys.POST(ctx('POST', { name: 'Claude', scopes: ['write', 'publish', 'root'], organization_id: 99 }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.key).toMatch(/^aitk_/)
    const row = db.tables.aitickets_api_keys.find((k) => k.name === 'Claude')
    expect(row).toMatchObject({ organization_id: 7, user_id: 4, scopes: ['read', 'write', 'publish'] })
    expect(JSON.stringify(row)).not.toContain(body.key)
  })

  it('un editor no puede revocar la llave de otro usuario; un productor sí', async () => {
    session = { dbUser: { id: 4, organization_id: 7, role: 'editor' } }
    const denied = await apiKeys.DELETE(ctx('DELETE', null, '?id=11111111-1111-1111-1111-111111111111'))
    expect(denied.status).toBe(404)
    expect(db.tables.aitickets_api_keys[0].revoked_at).toBeNull()
    session = { dbUser: { id: 1, organization_id: 7, role: 'producer' } }
    const ok = await apiKeys.DELETE(ctx('DELETE', null, '?id=11111111-1111-1111-1111-111111111111'))
    expect(ok.status).toBe(200)
    expect(db.tables.aitickets_api_keys[0].revoked_at).not.toBeNull()
  })

  it('un validador no puede crear llaves', async () => {
    session = { dbUser: { id: 5, organization_id: 7, role: 'validator' } }
    expect((await apiKeys.POST(ctx('POST', { name: 'x' }))).status).toBe(403)
  })
})
