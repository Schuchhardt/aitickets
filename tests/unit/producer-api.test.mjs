// API de productores (MCP /api/mcp + REST /api/v1): llaves, validación, protocolo MCP, aislamiento por
// organización, scopes y guardas (SSRF, stock). Sin red ni BD: Supabase falso en memoria.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const keys = await import('../../src/lib/producer-api/keys.ts')
const { validateArgs, runTool, ToolError } = await import('../../src/lib/producer-api/registry.ts')
const { handleMcpPayload } = await import('../../src/lib/producer-api/mcp.ts')
const { TOOLS, getTool } = await import('../../src/lib/producer-api/tools/index.ts')
const marketing = await import('../../src/lib/producer-api/tools/marketing.ts')

const NOW = new Date('2026-10-01T15:00:00Z')

function seed(extra = {}) {
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Mi Productora' }, { id: 8, public_name: 'Otra' }],
      users: [
        { id: 1, name: 'Ana', email: 'ana@prod.cl', organization_id: 7, role: 'producer', active: true },
        { id: 2, name: 'Val', email: 'val@prod.cl', organization_id: 7, role: 'validator', active: true },
        { id: 3, name: 'Ex', email: 'ex@prod.cl', organization_id: 7, role: 'editor', active: false },
      ],
      events: [
        { id: 10, name: 'Fiesta', slug: 'fiesta-1234', status: 'draft', accessibility: 'public', start_date: '2026-11-01T01:00:00Z', organization_id: 7 },
        { id: 20, name: 'Ajeno', slug: 'ajeno-1', status: 'published', organization_id: 8 },
      ],
      event_tickets: [
        { id: 100, event_id: 10, ticket_name: 'General', price: 10000, total_quantity: 100, status: 'available', is_gift: false },
        { id: 200, event_id: 20, ticket_name: 'Ajena', price: 5000, total_quantity: 50, status: 'available', is_gift: false },
      ],
      event_attendees: [],
      event_orders: [],
      event_visits: [],
      aitickets_api_keys: [],
      aitickets_api_audit: [],
      aitickets_discount_codes: [],
      aitickets_event_preview_links: [],
      social_posts: [],
      social_accounts: [],
      ...extra.tables,
    },
    rpc: {
      aitickets_ticket_availability: () => [{ ticket_id: 100, sold: 30, pending: 5 }],
      ...extra.rpc,
    },
  })
}

function actor(scopes = ['read', 'write', 'publish', 'attendees'], orgId = 7) {
  return { keyId: 'k1', userId: 1, orgId, role: 'producer', name: 'Ana', email: 'ana@prod.cl', scopes }
}
const ctx = (scopes, orgId) => ({ supabase: db, actor: actor(scopes, orgId), origin: 'https://aitickets.cl', requestUrl: new URL('https://aitickets.cl/api/mcp'), channel: 'mcp' })

function addKey(row = {}) {
  const { key, prefix, hash } = keys.generateApiKey()
  db.tables.aitickets_api_keys.push({ id: 'key-1', organization_id: 7, user_id: 1, name: 'x', key_prefix: prefix, key_hash: hash, scopes: ['read', 'write'], last_used_at: null, expires_at: null, revoked_at: null, ...row })
  return key
}

beforeEach(() => seed())

describe('llaves de API', () => {
  it('genera llaves aitk_ de 256 bits y guarda solo el sha256', () => {
    const { key, prefix, hash } = keys.generateApiKey()
    expect(key).toMatch(/^aitk_[A-Za-z0-9_-]{43}$/)
    expect(prefix).toBe(key.slice(0, 12))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(key)
  })

  it('normalizeScopes siempre incluye read e ignora scopes desconocidos', () => {
    expect(keys.normalizeScopes(['write', 'admin', 'publish'])).toEqual(['read', 'write', 'publish'])
    expect(keys.normalizeScopes(null)).toEqual(['read'])
  })

  it('extrae la llave de Authorization: Bearer o X-API-Key', () => {
    expect(keys.extractApiKey(new Request('https://x', { headers: { Authorization: 'Bearer aitk_abc' } }))).toBe('aitk_abc')
    expect(keys.extractApiKey(new Request('https://x', { headers: { 'X-API-Key': 'aitk_def' } }))).toBe('aitk_def')
    expect(keys.extractApiKey(new Request('https://x'))).toBeNull()
  })

  it('autentica una llave válida y marca last_used_at', async () => {
    const key = addKey()
    const res = await keys.authenticateApiKey(db, key, NOW)
    expect(res.ok).toBe(true)
    expect(res.actor).toMatchObject({ userId: 1, orgId: 7, role: 'producer', scopes: ['read', 'write'] })
    expect(db.tables.aitickets_api_keys[0].last_used_at).toBe(NOW.toISOString())
  })

  it('rechaza llaves ausentes, mal formadas, desconocidas, revocadas y vencidas', async () => {
    expect((await keys.authenticateApiKey(db, null)).status).toBe(401)
    expect((await keys.authenticateApiKey(db, 'aitk_corta')).status).toBe(401)
    expect((await keys.authenticateApiKey(db, keys.generateApiKey().key)).status).toBe(401)
    const revoked = addKey({ revoked_at: '2026-09-01T00:00:00Z' })
    expect((await keys.authenticateApiKey(db, revoked, NOW)).ok).toBe(false)
    seed()
    const expired = addKey({ expires_at: '2026-09-30T00:00:00Z' })
    expect((await keys.authenticateApiKey(db, expired, NOW)).ok).toBe(false)
  })

  it('rechaza si el usuario está inactivo, cambió de organización o no gestiona eventos', async () => {
    const inactive = addKey({ user_id: 3 })
    expect((await keys.authenticateApiKey(db, inactive, NOW)).status).toBe(401)
    seed()
    const moved = addKey({ organization_id: 8 })
    expect((await keys.authenticateApiKey(db, moved, NOW)).status).toBe(401)
    seed()
    const validator = addKey({ user_id: 2 })
    expect((await keys.authenticateApiKey(db, validator, NOW)).status).toBe(403)
  })

  it('sin la migración aplicada responde 503 (no 500)', async () => {
    db.failOn('aitickets_api_keys', 'select', { code: '42P01', message: 'relation "aitickets_api_keys" does not exist' })
    expect((await keys.authenticateApiKey(db, keys.generateApiKey().key)).status).toBe(503)
  })
})

describe('validateArgs', () => {
  const schema = {
    type: 'object', required: ['name'], additionalProperties: false,
    properties: {
      name: { type: 'string', maxLength: 5 },
      n: { type: 'integer', minimum: 1, default: 3 },
      kind: { type: 'string', enum: ['a', 'b'] },
      q: { type: 'integer', nullable: true },
      list: { type: 'array', maxItems: 2, items: { type: 'string' } },
    },
  }
  it('aplica defaults, recorta texto y acepta null si es nullable', () => {
    expect(validateArgs(schema, { name: ' hola ', q: null })).toEqual({ name: 'hola', n: 3, q: null })
  })
  it('rechaza faltantes, desconocidos, tipos y rangos con mensajes claros', () => {
    expect(() => validateArgs(schema, {})).toThrow(/falta "name"/)
    expect(() => validateArgs(schema, { name: 'a', otro: 1 })).toThrow(/campo desconocido "otro"/)
    expect(() => validateArgs(schema, { name: 'a', n: 1.5 })).toThrow(/entero/)
    expect(() => validateArgs(schema, { name: 'a', n: 0 })).toThrow(/≥ 1/)
    expect(() => validateArgs(schema, { name: 'a', kind: 'c' })).toThrow(/uno de/)
    expect(() => validateArgs(schema, { name: 'a', list: ['x', 'y', 'z'] })).toThrow(/máximo 2/)
    expect(() => validateArgs(schema, { name: 'demasiado' })).toThrow(ToolError)
  })
})

describe('protocolo MCP', () => {
  const call = (method, params, id = 1) => handleMcpPayload({ jsonrpc: '2.0', id, method, params }, ctx())

  it('initialize negocia la versión y anuncia tools + prompts', async () => {
    const res = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    expect(res.result.protocolVersion).toBe('2025-06-18')
    expect(res.result.capabilities).toHaveProperty('tools')
    expect(res.result.serverInfo.name).toBe('aitickets')
    expect(res.result.instructions).toMatch(/BORRADOR/)
    const unknown = await call('initialize', { protocolVersion: '1999-01-01' })
    expect(unknown.result.protocolVersion).toBe('2025-11-25')
  })

  it('notificaciones y respuestas del cliente no generan respuesta', async () => {
    expect(await handleMcpPayload({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx())).toBeNull()
    expect(await handleMcpPayload({ jsonrpc: '2.0', id: 9, result: {} }, ctx())).toBeNull()
  })

  it('tools/list publica todas las herramientas con JSON Schema estándar', async () => {
    const res = await call('tools/list')
    const names = res.result.tools.map((t) => t.name)
    expect(names).toEqual(TOOLS.map((t) => t.name))
    expect(names).toEqual(expect.arrayContaining(['create_event', 'create_ticket_type', 'create_discount_code', 'get_event_performance', 'generate_image', 'publish_social_post']))
    const quantity = res.result.tools.find((t) => t.name === 'create_ticket_type').inputSchema.properties.quantity
    expect(quantity.type).toEqual(['integer', 'null'])
    expect(JSON.stringify(res.result)).not.toContain('nullable')
  })

  it('métodos desconocidos y herramientas inexistentes devuelven errores JSON-RPC', async () => {
    expect((await call('foo/bar')).error.code).toBe(-32601)
    expect((await call('tools/call', { name: 'no_existe' })).error.code).toBe(-32602)
    expect((await handleMcpPayload({ id: 1 }, ctx())).error.code).toBe(-32600)
  })

  it('prompts/get arma el mensaje con los argumentos', async () => {
    const list = await call('prompts/list')
    expect(list.result.prompts.map((p) => p.name)).toContain('reporte_de_ventas')
    const res = await call('prompts/get', { name: 'campana_redes', arguments: { evento: 'Fiesta' } })
    expect(res.result.messages[0].content.text).toMatch(/Fiesta/)
    expect((await call('prompts/get', { name: 'campana_redes', arguments: {} })).error.code).toBe(-32602)
  })

  it('tools/call devuelve structuredContent y errores de herramienta como isError', async () => {
    const ok = await call('tools/call', { name: 'get_event', arguments: { event_id: 10 } })
    expect(ok.result.isError).toBeUndefined()
    expect(ok.result.structuredContent.ticket_types[0]).toMatchObject({ id: 100, sold: 30, reserved_in_checkout: 5, remaining: 65 })
    const bad = await call('tools/call', { name: 'get_event', arguments: {} })
    expect(bad.result.isError).toBe(true)
    expect(bad.result.content[0].text).toMatch(/invalid_input/)
  })

  it('procesa lotes', async () => {
    const res = await handleMcpPayload([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ], ctx())
    expect(res.map((r) => r.id)).toEqual([1, 2])
  })
})

describe('aislamiento por organización y scopes', () => {
  const run = (name, args, scopes, orgId) => runTool(getTool(name), args, ctx(scopes, orgId))

  it('no se puede leer ni modificar un evento de otra organización', async () => {
    expect(await run('get_event', { event_id: 20 })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await run('update_event', { event_id: 20, name: 'Hackeado' })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await run('create_ticket_type', { event_id: 20, name: 'X', price: 1 })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await run('update_ticket_type', { event_id: 10, ticket_type_id: 200, price: 1 })).toMatchObject({ ok: false, code: 'not_found' })
    expect(db.tables.events.find((e) => e.id === 20).name).toBe('Ajeno')
    expect(db.tables.event_tickets.find((t) => t.id === 200).price).toBe(5000)
  })

  it('list_events solo devuelve eventos propios con sus ventas', async () => {
    db.tables.event_orders.push(
      { id: 'o1', event_id: 10, status: 'paid', amount: 20000, ticket_qty: 2 },
      { id: 'o2', event_id: 20, status: 'paid', amount: 99999, ticket_qty: 9 },
    )
    const res = await run('list_events', {})
    expect(res.result.events.map((e) => e.id)).toEqual([10])
    // Borrador: el link público no funciona todavía
    expect(res.result.events[0]).toMatchObject({ tickets_sold: 2, revenue_clp: 20000, is_published: false, public_url: null, public_url_after_publish: 'https://aitickets.cl/eventos/fiesta-1234' })
    expect(res.result.drafts_note).toMatch(/BORRADOR/)
  })

  it('una llave sin el scope necesario no puede escribir, publicar ni ver compradores', async () => {
    expect(await run('create_discount_code', { code: 'X10', kind: 'percent', value: 10 }, ['read'])).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await run('set_event_status', { event_id: 10, status: 'published' }, ['read', 'write'])).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await run('list_orders', { event_id: 10 }, ['read', 'write'])).toMatchObject({ ok: false, code: 'forbidden' })
    expect(db.tables.aitickets_discount_codes).toHaveLength(0)
  })

  it('las escrituras quedan en la bitácora sin argumentos', async () => {
    await run('create_discount_code', { code: 'pre20', kind: 'percent', value: 20, event_id: 10 })
    expect(db.tables.aitickets_discount_codes[0]).toMatchObject({ code: 'PRE20', organization_id: 7, event_id: 10, created_by: 1 })
    expect(db.tables.aitickets_api_audit).toEqual([expect.objectContaining({ organization_id: 7, tool: 'create_discount_code', ok: true, event_id: 10, channel: 'mcp' })])
    expect(JSON.stringify(db.tables.aitickets_api_audit)).not.toContain('PRE20')
  })

  it('códigos de descuento: duplicado → conflict; evento ajeno → not_found', async () => {
    db.tables.aitickets_discount_codes.push({ id: '00000000-0000-0000-0000-000000000001', organization_id: 7, code: 'DUP', kind: 'fixed', value: 1000, active: true })
    db.failOn('aitickets_discount_codes', 'insert', { code: '23505', message: 'duplicate' })
    expect(await run('create_discount_code', { code: 'dup', kind: 'fixed', value: 1000 })).toMatchObject({ ok: false, code: 'conflict' })
    expect(await run('create_discount_code', { code: 'OTRO', kind: 'fixed', value: 1000, event_id: 20 })).toMatchObject({ ok: false, code: 'not_found' })
  })
})

describe('entradas', () => {
  const run = (name, args) => runTool(getTool(name), args, ctx())

  it('la capacidad no puede quedar bajo lo vendido + reservado', async () => {
    const res = await run('update_ticket_type', { event_id: 10, ticket_type_id: 100, quantity: 34 })
    expect(res).toMatchObject({ ok: false, code: 'conflict' })
    const ok = await run('update_ticket_type', { event_id: 10, ticket_type_id: 100, quantity: 35, price: 12000, on_sale: false })
    expect(ok.ok).toBe(true)
    expect(db.tables.event_tickets.find((t) => t.id === 100)).toMatchObject({ total_quantity: 35, price: 12000, status: 'unavailable' })
  })

  it('una ventana de venta invertida se rechaza', async () => {
    const res = await run('create_ticket_type', { event_id: 10, name: 'VIP', price: 20000, sales_start: '2026-10-10T00:00:00Z', sales_end: '2026-10-05T00:00:00Z' })
    expect(res).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('eliminar un tipo con ventas lo retira de la venta en vez de borrarlo', async () => {
    db.tables.event_attendees.push({ id: 'a1', event_id: 10, event_ticket_id: 100 })
    const res = await run('delete_ticket_type', { event_id: 10, ticket_type_id: 100 })
    expect(res.result.result).toBe('retired_from_sale')
    expect(db.tables.event_tickets.find((t) => t.id === 100).status).toBe('unavailable')
    db.tables.event_tickets.push({ id: 101, event_id: 10, ticket_name: 'Sin ventas', price: 1, status: 'available' })
    expect((await run('delete_ticket_type', { event_id: 10, ticket_type_id: 101 })).result.result).toBe('deleted')
  })
})

describe('rendimiento del evento', () => {
  it('agrega ventas, cortesías, canales, códigos y conversión', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    db.tables.event_orders.push(
      { id: 'o1', event_id: 10, status: 'paid', created_at: '2026-09-30T12:00:00Z', amount: 18000, ticket_qty: 2, discount_amount: 2000, discount_code: 'PRE10', ref: 'dj', ticket_details: [{ name: 'General', price: 10000, quantity: 2 }] },
      { id: 'o2', event_id: 10, status: 'paid', created_at: '2026-09-20T12:00:00Z', amount: 10000, ticket_qty: 1, utm_source: 'instagram', ticket_details: [{ name: 'General', price: 10000, quantity: 1 }] },
      { id: 'o3', event_id: 10, status: 'paid', created_at: '2026-09-29T12:00:00Z', amount: 0, ticket_qty: 3, payment_provider: 'courtesy' },
      { id: 'o4', event_id: 20, status: 'paid', created_at: '2026-09-30T12:00:00Z', amount: 50000, ticket_qty: 5 },
    )
    db.tables.event_visits.push(
      { event_id: 10, created_at: '2026-09-30T11:00:00Z', ip_hash: 'a', referrer: 'https://instagram.com' },
      { event_id: 10, created_at: '2026-09-30T11:05:00Z', ip_hash: 'a', referrer: null },
      { event_id: 10, created_at: '2026-09-30T11:10:00Z', ip_hash: 'b', utm_source: 'tiktok' },
    )
    const res = await runTool(getTool('get_event_performance'), { event_id: 10, days: 7 }, ctx())
    const r = res.result
    expect(r.sales).toMatchObject({ paid_orders: 2, tickets_sold: 3, courtesy_tickets: 3, revenue_clp: 28000, discounts_given_clp: 2000 })
    expect(r.traffic).toMatchObject({ visits: 3, unique_visitors: 2, conversion_pct: 100 })
    expect(r.sales_channels.map((c) => c.channel)).toEqual(['ref:dj', 'instagram'])
    expect(r.discount_codes_used).toEqual([{ code: 'PRE10', orders: 1, discount_clp: 2000 }])
    expect(r.pace).toMatchObject({ tickets_last_7_days: 2, tickets_previous_7_days: 1, trend: 'up' })
    expect(r.capacity).toMatchObject({ total: 100, issued_tickets: 30, sell_through_pct: 30 })
    expect(r.daily).toHaveLength(7)
    expect(r.daily.find((d) => d.date === '2026-09-30')).toMatchObject({ visits: 3, tickets: 2, revenue_clp: 18000 })
  })
})

describe('marketing', () => {
  const run = (name, args) => runTool(getTool(name), args, ctx())

  it('isPublicIp bloquea direcciones internas', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(marketing.isPublicIp(ip), ip).toBe(false)
    }
    for (const ip of ['8.8.8.8', '151.101.1.1', '2606:4700::1111']) expect(marketing.isPublicIp(ip), ip).toBe(true)
  })

  it('fetchPublicImage rechaza http, IPs internas y redirecciones hacia la red interna', async () => {
    await expect(marketing.fetchPublicImage('http://example.com/a.png')).rejects.toThrow(/https/)
    await expect(marketing.fetchPublicImage('https://169.254.169.254/latest')).rejects.toThrow(/no permitida/)
    const redirecting = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret' } }))
    await expect(marketing.fetchPublicImage('https://8.8.8.8/img.png', redirecting)).rejects.toThrow(/no permitida/)
    expect(redirecting).toHaveBeenCalledTimes(1)
  })

  it('fetchPublicImage acepta solo imágenes reales (por sus bytes)', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
    const ok = await marketing.fetchPublicImage('https://8.8.8.8/img', async () => new Response(png, { status: 200 }))
    expect(ok.contentType).toBe('image/png')
    await expect(marketing.fetchPublicImage('https://8.8.8.8/x', async () => new Response('<svg onload=alert(1)>', { status: 200 }))).rejects.toThrow(/no es una imagen/)
  })

  it('decodeBase64Image valida el contenido', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')
    expect(marketing.decodeBase64Image(`data:image/jpeg;base64,${jpeg}`).contentType).toBe('image/jpeg')
    expect(() => marketing.decodeBase64Image(Buffer.from('hola').toString('base64'))).toThrow(/no es una imagen/)
  })

  it('create_tracking_link arma el link con ref/UTM', async () => {
    const res = await run('create_tracking_link', { event_id: 10, utm_source: 'instagram', utm_campaign: 'preventa2' })
    expect(res.result.url).toBe('https://aitickets.cl/eventos/fiesta-1234?utm_source=instagram&utm_campaign=preventa2')
  })

  it('create_social_post crea borradores; Instagram exige imagen', async () => {
    expect(await run('create_social_post', { event_id: 10, content: 'Hola', platforms: ['instagram'] })).toMatchObject({ ok: false, code: 'invalid_input' })
    const res = await run('create_social_post', { event_id: 10, content: 'Hola', platforms: ['facebook', 'facebook'] })
    expect(res.ok).toBe(true)
    expect(db.tables.social_posts[0]).toMatchObject({ organization_id: 7, event_id: 10, status: 'draft', platforms: ['facebook'] })
  })

  it('publish_social_post no publica posts de otra organización', async () => {
    db.tables.social_posts.push({ id: 5, organization_id: 8, event_id: 20, status: 'draft', platforms: ['facebook'] })
    expect(await run('publish_social_post', { post_id: 5 })).toMatchObject({ ok: false, code: 'not_found' })
  })
})
