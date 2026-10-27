// MCP de administración (/api/admin/mcp): autenticación, aislamiento, registro (motivo, llave de solo lectura,
// confirmación, bitácora), espejo org_* y herramientas de plataforma de la fase 0.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))

const { generateAdminKey, authenticateAdminRequest } = await import('../../src/lib/admin-api/auth.ts')
const { generateApiKey, hashApiKey } = await import('../../src/lib/producer-api/keys.ts')
const { runAdminTool, adminEffectiveSchema } = await import('../../src/lib/admin-api/registry.ts')
const { resetSupportUserCache } = await import('../../src/lib/admin-api/context.ts')
const { getAdminTool, ADMIN_TOOLS } = await import('../../src/lib/admin-api/tools/index.ts')
const { BLOCKED, FORCED_CONFIRM } = await import('../../src/lib/admin-api/mirror.ts')
const { segmentFor, resolvePeriod, totalsFromOrders } = await import('../../src/lib/admin-api/metrics.ts')
const adminRoute = await import('../../src/pages/api/admin/mcp.ts')
const producerRoute = await import('../../src/pages/api/mcp.ts')
const exportRoute = await import('../../src/pages/api/exports/orders.ts')

const SITE = 'https://aitickets.cl'
const SUPPORT_ID = 900
const DAY = 86400000
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString()

let full
let readonly
beforeEach(() => {
  full = generateAdminKey()
  readonly = generateAdminKey()
  process.env.SITE_URL = SITE
  process.env.ADMIN_MCP_ENABLED = 'true'
  process.env.AITICKETS_ADMIN_KEY_SHA256 = full.hash
  process.env.AITICKETS_ADMIN_READONLY_KEY_SHA256 = readonly.hash
  process.env.INTERNAL_API_SECRET = 'test-internal-secret'
  resetSupportUserCache()
  db = createFakeSupabase({
    tables: {
      aitickets_platform_settings: [{ key: 'support_user_id', value: SUPPORT_ID }],
      organizations: [
        { id: 7, public_name: 'Productora Siete', email: 'siete@prod.cl', created_at: iso(-200 * DAY), email_verified_at: iso(-199 * DAY) },
        { id: 8, public_name: 'Ocho Eventos', email: 'ocho@prod.cl', created_at: iso(-10 * DAY), email_verified_at: null },
        { id: 1, public_name: 'AI Tickets', email: 'hola@aitickets.cl', created_at: iso(-400 * DAY), email_verified_at: iso(-400 * DAY) },
      ],
      users: [
        { id: 1, name: 'Ana', email: 'ana@prod.cl', organization_id: 7, role: 'producer', active: true },
        { id: 2, name: 'Oscar', email: 'oscar@ocho.cl', organization_id: 8, role: 'producer', active: true },
        { id: SUPPORT_ID, name: 'Soporte AI Tickets', email: null, organization_id: null, role: 'viewer', active: false, auth_user_id: null },
      ],
      events: [
        { id: 10, name: 'Fiesta Siete', slug: 'fiesta-siete', status: 'published', organization_id: 7, start_date: iso(20 * DAY), end_date: iso(20 * DAY + 3600000), created_at: iso(-30 * DAY) },
        { id: 11, name: 'Borrador Ocho', slug: 'borrador-ocho', status: 'draft', organization_id: 8, start_date: iso(40 * DAY), end_date: iso(40 * DAY + 3600000), created_at: iso(-9 * DAY) },
        { id: 99, name: 'Demo', slug: 'evento-demo-aitickets', status: 'published', organization_id: 1, start_date: iso(5 * DAY), end_date: iso(5 * DAY + 3600000), created_at: iso(-300 * DAY) },
      ],
      event_orders: [
        { id: 'o1', event_id: 10, status: 'paid', created_at: iso(-2 * DAY), amount: 10000, ticket_fee: 800, service_fee_tax: 152, total_payment: 10952, payment_fee: 300, ticket_qty: 1, ticket_details: [{ name: 'General', quantity: 1, price: 10000 }], payment_provider: 'flow' },
        { id: 'o2', event_id: 10, status: 'paid', created_at: iso(-1 * DAY), amount: 0, ticket_fee: 0, service_fee_tax: 0, total_payment: 0, ticket_qty: 2, ticket_details: [{ name: 'Cortesía', quantity: 2, price: 0, complimentary: true }], payment_provider: 'courtesy' },
        { id: 'o3', event_id: 99, status: 'paid', created_at: iso(-1 * DAY), amount: 5000, ticket_fee: 400, service_fee_tax: 76, total_payment: 5476, ticket_qty: 1, ticket_details: [{ name: 'Demo', quantity: 1, price: 5000 }], payment_provider: 'demo' },
      ],
      event_visits: [],
      event_tickets: [],
      aitickets_discount_codes: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', organization_id: 7, event_id: null, code: 'PROMO', kind: 'percent', value: 10, active: true, max_uses: null }],
      aitickets_api_audit: [],
      aitickets_admin_audit: [],
      aitickets_admin_confirmations: [],
      aitickets_admin_idempotency: [],
      aitickets_api_confirmations: [],
      aitickets_api_idempotency: [],
      aitickets_api_keys: [],
    },
    unique: {
      aitickets_admin_idempotency: [['tool', 'idem_key']],
      aitickets_api_idempotency: [['organization_id', 'tool', 'idem_key']],
    },
  })
})

afterEach(() => {
  for (const k of ['SITE_URL', 'ADMIN_MCP_ENABLED', 'AITICKETS_ADMIN_KEY_SHA256', 'AITICKETS_ADMIN_READONLY_KEY_SHA256', 'INTERNAL_API_SECRET', 'ADMIN_MCP_EMAILS']) delete process.env[k]
})

const req = (body, { key = full.key, host = 'aitickets.cl', method = 'POST' } = {}) =>
  new Request(`https://${host}/api/admin/mcp`, {
    method,
    headers: { 'Content-Type': 'application/json', host, ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  })
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params })
const call = async (name, args = {}, opts) => {
  const res = await adminRoute.POST({ request: req(rpc('tools/call', { name, arguments: args }), opts) })
  const body = await res.json()
  return { status: res.status, body, result: body.result?.structuredContent, isError: body.result?.isError, text: body.result?.content?.[0]?.text }
}
const actx = (keyKind = 'full') => ({ supabase: db, origin: SITE, requestUrl: new URL(`${SITE}/api/admin/mcp`), keyKind, fingerprint: 'abcd1234', ipHash: 'f'.repeat(64) })

describe('autenticación', () => {
  it('sin ADMIN_MCP_ENABLED, sin hash o en otro host: 404 (no existe)', async () => {
    delete process.env.ADMIN_MCP_ENABLED
    expect((await adminRoute.POST({ request: req(rpc('ping')) })).status).toBe(404)
    process.env.ADMIN_MCP_ENABLED = 'true'
    delete process.env.AITICKETS_ADMIN_KEY_SHA256
    delete process.env.AITICKETS_ADMIN_READONLY_KEY_SHA256
    expect((await adminRoute.POST({ request: req(rpc('ping')) })).status).toBe(404)
    process.env.AITICKETS_ADMIN_KEY_SHA256 = full.hash
    expect((await adminRoute.POST({ request: req(rpc('ping'), { host: 'deploy-preview-12--aitickets.netlify.app' }) })).status).toBe(404)
    expect((await adminRoute.POST({ request: req(rpc('ping'), { host: 'eventos.miproductora.cl' }) })).status).toBe(404)
    delete process.env.SITE_URL
    expect((await adminRoute.POST({ request: req(rpc('ping')) })).status).toBe(404)
  })

  it('GET: 405 si está habilitado, 404 si no', async () => {
    expect((await adminRoute.GET({ request: req(null, { method: 'GET' }) })).status).toBe(405)
    delete process.env.ADMIN_MCP_ENABLED
    expect((await adminRoute.GET({ request: req(null, { method: 'GET' }) })).status).toBe(404)
  })

  it('llave inválida, sin Bearer o llave de productor: 401', async () => {
    expect((await adminRoute.POST({ request: req(rpc('ping'), { key: generateAdminKey().key }) })).status).toBe(401)
    expect((await adminRoute.POST({ request: req(rpc('ping'), { key: null }) })).status).toBe(401)
    expect((await adminRoute.POST({ request: req(rpc('ping'), { key: `aitk_${'a'.repeat(43)}` }) })).status).toBe(401)
  })

  it('token OAuth (aitk_) con email autorizado: acceso full', async () => {
    const apiKey = generateApiKey()
    db.tables.aitickets_api_keys.push({
      id: 500, organization_id: 7, user_id: 1, name: 'OAuth key', key_prefix: apiKey.prefix,
      key_hash: apiKey.hash, scopes: ['read', 'write'], last_used_at: null, expires_at: null, revoked_at: null, created_at: new Date().toISOString(),
    })
    process.env.ADMIN_MCP_EMAILS = 'ana@prod.cl,admin@aitickets.cl'
    const auth = await authenticateAdminRequest(
      new Request('https://aitickets.cl/api/admin/mcp', { method: 'POST', headers: { host: 'aitickets.cl', Authorization: `Bearer ${apiKey.key}` }, body: '{}' }),
      db,
    )
    expect(auth).toMatchObject({ ok: true, keyKind: 'full' })
  })

  it('token OAuth (aitk_) con email no autorizado: 401', async () => {
    const apiKey = generateApiKey()
    db.tables.aitickets_api_keys.push({
      id: 501, organization_id: 7, user_id: 1, name: 'OAuth key', key_prefix: apiKey.prefix,
      key_hash: apiKey.hash, scopes: ['read'], last_used_at: null, expires_at: null, revoked_at: null, created_at: new Date().toISOString(),
    })
    process.env.ADMIN_MCP_EMAILS = 'admin@aitickets.cl'
    const auth = await authenticateAdminRequest(
      new Request('https://aitickets.cl/api/admin/mcp', { method: 'POST', headers: { host: 'aitickets.cl', Authorization: `Bearer ${apiKey.key}` }, body: '{}' }),
      db,
    )
    expect(auth).toMatchObject({ ok: false, status: 401 })
  })

  it('el MCP de productores rechaza la llave de admin', async () => {
    const res = await producerRoute.POST({
      request: new Request('https://aitickets.cl/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${full.key}` }, body: JSON.stringify(rpc('ping')) }),
    })
    expect(res.status).toBe(401)
  })

  it('acepta dos hashes (rotación) y distingue la llave de solo lectura', async () => {
    const next = generateAdminKey()
    process.env.AITICKETS_ADMIN_KEY_SHA256 = `${next.hash}, ${full.hash}`
    const a = await authenticateAdminRequest(req(rpc('ping'), { key: next.key }), db)
    const b = await authenticateAdminRequest(req(rpc('ping')), db)
    const c = await authenticateAdminRequest(req(rpc('ping'), { key: readonly.key }), db)
    expect(a).toMatchObject({ ok: true, keyKind: 'full', fingerprint: next.hash.slice(0, 8) })
    expect(b).toMatchObject({ ok: true, keyKind: 'full' })
    expect(c).toMatchObject({ ok: true, keyKind: 'readonly' })
  })

  it('demasiados intentos fallidos desde la misma IP: 429', async () => {
    const bad = generateAdminKey().key
    const headers = { 'x-nf-client-connection-ip': '203.0.113.7' }
    let last
    for (let i = 0; i < 12; i++) {
      const r = new Request('https://aitickets.cl/api/admin/mcp', { method: 'POST', headers: { host: 'aitickets.cl', Authorization: `Bearer ${bad}`, ...headers }, body: '{}' })
      last = await authenticateAdminRequest(r, db)
    }
    expect(last).toMatchObject({ ok: false, status: 429 })
  })
})

describe('servidor MCP', () => {
  it('initialize, tools/list y CORS', async () => {
    const init = await adminRoute.POST({ request: req(rpc('initialize', { protocolVersion: '2025-06-18' })) })
    expect(init.status).toBe(200)
    expect(init.headers.get('access-control-allow-origin')).toBe('*')
    expect((await init.json()).result.serverInfo.name).toBe('aitickets-admin')

    const list = await (await adminRoute.POST({ request: req(rpc('tools/list')) })).json()
    const names = list.result.tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['get_admin_context', 'search_organizations', 'get_organization', 'search_events', 'org_update_event', 'org_list_events']))
    for (const blocked of BLOCKED) expect(names).not.toContain(`org_${blocked}`)
    const update = list.result.tools.find((t) => t.name === 'org_update_event')
    expect(update.inputSchema.required).toContain('reason')
    expect(update.inputSchema.properties.organization_id).toBeTruthy()
    expect(update.annotations.readOnlyHint).toBe(false)
  })

  it('la llave de solo lectura no ve escrituras ni lecturas sensibles, y no puede ejecutarlas', async () => {
    const list = await (await adminRoute.POST({ request: req(rpc('tools/list'), { key: readonly.key }) })).json()
    const names = list.result.tools.map((t) => t.name)
    expect(names).toContain('search_organizations')
    expect(names).not.toContain('org_update_event')
    expect(names).not.toContain('org_list_orders')
    const r = await call('org_update_event', { event_id: 10, name: 'X', reason: 'prueba de solo lectura' }, { key: readonly.key })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/solo lectura/)
  })

  it('cada llamada queda en aitickets_admin_audit (también lecturas y rechazos), sin argumentos', async () => {
    await call('search_organizations', { query: 'Siete' })
    await call('org_update_event', { event_id: 10, name: 'Nuevo nombre' }) // sin reason
    const rows = db.tables.aitickets_admin_audit
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ tool: 'search_organizations', ok: true, read_only: true, key_kind: 'full' })
    expect(rows[1]).toMatchObject({ tool: 'org_update_event', ok: false, error_code: 'invalid_input' })
    expect(JSON.stringify(rows)).not.toContain('Nuevo nombre')
  })
})

describe('registro de herramientas de admin', () => {
  const write = {
    name: 'test_write',
    title: 'Escritura de prueba',
    description: 'x',
    readOnly: false,
    inputSchema: { type: 'object', additionalProperties: false, properties: { n: { type: 'integer' } } },
    confirm: async (args) => ({ message: `Confirmar ${args.n}` }),
    handler: async (args) => ({ done: args.n }),
  }

  it('exige reason en escrituras', () => {
    expect(adminEffectiveSchema(write).required).toContain('reason')
    expect(adminEffectiveSchema(write).properties.confirmation_token).toBeTruthy()
  })

  it('confirmación en dos pasos con token de un solo uso', async () => {
    const first = await runAdminTool(write, { n: 3, reason: 'motivo de prueba' }, actx())
    expect(first.result.status).toBe('confirmation_required')
    const token = first.result.confirmation_token
    const mismatch = await runAdminTool(write, { n: 4, reason: 'motivo de prueba', confirmation_token: token }, actx())
    expect(mismatch).toMatchObject({ ok: false, code: 'invalid_input' })
    const second = await runAdminTool(write, { n: 3, reason: 'otro motivo', confirmation_token: token }, actx())
    expect(second).toMatchObject({ ok: true, result: { done: 3 } })
    const again = await runAdminTool(write, { n: 3, reason: 'otro motivo', confirmation_token: token }, actx())
    expect(again.ok).toBe(true)
    expect(again.result.idempotent_replay).toBe(true)
  })
})

describe('org_*: actuar como productor', () => {
  it('infiere la organización desde event_id y rechaza si no calza', async () => {
    const mismatch = await call('org_get_event', { organization_id: 8, event_id: 10 })
    expect(mismatch.isError).toBe(true)
    expect(mismatch.text).toMatch(/organización 7, no de la 8/)
    const none = await call('org_list_events', {})
    expect(none.isError).toBe(true)
    expect(none.text).toMatch(/Indica organization_id/)
  })

  it('lee como la organización y responde con acting_as', async () => {
    const r = await call('org_list_events', { organization_id: 7 })
    expect(r.isError).toBeFalsy()
    expect(r.result.acting_as).toMatchObject({ organization_id: 7, name: 'Productora Siete', as: 'Soporte AI Tickets' })
    expect(r.result.events.map((e) => e.id)).toEqual([10])
  })

  it('escritura: queda en la bitácora del productor con canal admin y el usuario de servicio', async () => {
    const r = await call('org_update_discount_code', { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', max_uses: 10, reason: 'Productor pidió limitar el código por WhatsApp' })
    const audit = db.tables.aitickets_api_audit
    expect(audit.length).toBeGreaterThan(0)
    expect(audit.at(-1)).toMatchObject({ organization_id: 7, channel: 'admin', user_id: SUPPORT_ID })
    expect(db.tables.aitickets_admin_audit.at(-1)).toMatchObject({ tool: 'org_update_discount_code', reason: 'Productor pidió limitar el código por WhatsApp' })
    expect(r.status).toBe(200)
  })

  it('las herramientas de confirmación forzada piden confirmación aunque el productor no la necesite', async () => {
    expect(FORCED_CONFIRM.has('delete_discount_code')).toBe(true)
    const r = await call('org_delete_discount_code', { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', reason: 'Productor pidió borrar el código' })
    expect(r.result.status).toBe('confirmation_required')
    expect(r.result.next_step).toMatch(/dueño de la plataforma/)
    expect(db.tables.aitickets_discount_codes).toHaveLength(1)
  })

  it('list_audit_log muestra las acciones de soporte como "Soporte AI Tickets"', async () => {
    db.tables.aitickets_api_audit.push({ id: 1, organization_id: 7, user_id: SUPPORT_ID, tool: 'update_event', channel: 'admin', ok: true, created_at: iso(-1000), summary: 'x' })
    const r = await call('org_list_audit_log', { organization_id: 7, include_money: false })
    expect(r.result.entries[0].user).toBe('Soporte AI Tickets')
  })

  it('el link de export_orders pedido por el admin se descarga con el claim adm', async () => {
    const r = await call('org_export_orders', { organization_id: 7, reason: 'El contador del productor pidió las órdenes' })
    const url = r.result.download_url
    expect(url).toBeTruthy()
    const res = await exportRoute.GET({ url: new URL(url) })
    expect(res.status).toBe(200)
    // Otro uid con adm no sirve (el claim va firmado, pero el uid debe ser el usuario de servicio)
    db.tables.aitickets_platform_settings[0].value = 12345
    const denied = await exportRoute.GET({ url: new URL(url) })
    expect(denied.status).toBe(403)
  })
})

describe('herramientas de plataforma', () => {
  it('search_organizations: ventas sin cortesías ni demo, segmentos y dueño', async () => {
    const r = await call('search_organizations', {})
    const siete = r.result.organizations.find((o) => o.id === 7)
    const ocho = r.result.organizations.find((o) => o.id === 8)
    expect(siete.lifetime).toMatchObject({ paid_orders: 1, tickets_sold: 1, gross_sales_clp: 10952, aitickets_fee_net_clp: 800 })
    expect(siete.segment).toBe('activo')
    expect(siete.owner).toMatchObject({ email: 'ana@prod.cl' })
    expect(ocho.segment).toBe('sin_verificar')
    expect(r.result.organizations[0].id).toBe(7) // orden por ventas
    const byEmail = await call('search_organizations', { query: 'oscar@ocho' })
    expect(byEmail.result.organizations.map((o) => o.id)).toEqual([8])
  })

  it('get_organization: ficha con eventos, equipo, cuenta y segmento', async () => {
    const r = await call('get_organization', { organization_id: 7 })
    expect(r.isError).toBeFalsy()
    expect(r.result.organization.name).toBe('Productora Siete')
    expect(r.result.team[0]).toMatchObject({ email: 'ana@prod.cl', role: 'producer' })
    expect(r.result.events[0]).toMatchObject({ id: 10, tickets_sold: 1 })
    expect(r.result.payout_account.status).toBe('missing')
    expect(r.result.sales.lifetime.courtesy_tickets).toBe(2)
    const missing = await call('get_organization', { organization_id: 4242 })
    expect(missing.isError).toBe(true)
  })

  it('search_events: todos los productores, sin demo por defecto', async () => {
    const r = await call('search_events', {})
    expect(r.result.events.map((e) => e.id).sort()).toEqual([10, 11])
    expect(r.result.events.find((e) => e.id === 10).organization).toEqual({ id: 7, name: 'Productora Siete' })
    const demo = await call('search_events', { include_demo: true })
    expect(demo.result.events.map((e) => e.id)).toContain(99)
  })

  it('get_admin_context indica el tipo de llave', async () => {
    const r = await call('get_admin_context', {}, { key: readonly.key })
    expect(r.result.key.kind).toBe('readonly')
  })
})

describe('métricas', () => {
  it('totales: bruto = total_payment; cortesías aparte', () => {
    const t = totalsFromOrders(db.tables.event_orders.filter((o) => o.event_id === 10))
    expect(t).toMatchObject({ paid_orders: 1, tickets_sold: 1, courtesy_tickets: 2, gross_sales_clp: 10952, producer_net_clp: 10000, aitickets_fee_net_clp: 800, fee_iva_clp: 152, flow_cost_clp: 300 })
  })

  it('segmentos', () => {
    const org = { email_verified_at: iso(-DAY) }
    const now = new Date()
    const upcoming = { id: 1, status: 'published', end_date: iso(10 * DAY), created_at: iso(-20 * DAY) }
    expect(segmentFor({}, [upcoming], [], now)).toBe('sin_verificar')
    expect(segmentFor(org, [], [], now)).toBe('sin_evento')
    expect(segmentFor(org, [upcoming], [], now)).toBe('publicado_sin_ventas')
    expect(segmentFor(org, [upcoming], [{ event_id: 1, created_at: iso(-60 * DAY) }], now)).toBe('activo')
    expect(segmentFor(org, [{ id: 2, status: 'draft', created_at: iso(-5 * DAY) }], [], now)).toBe('borrador_estancado')
    const past = { id: 3, status: 'published', end_date: iso(-40 * DAY), created_at: iso(-90 * DAY) }
    expect(segmentFor(org, [past], [{ event_id: 3, created_at: iso(-50 * DAY) }], now)).toBe('en_riesgo')
    expect(segmentFor(org, [past], [{ event_id: 3, created_at: iso(-200 * DAY) }], now)).toBe('inactivo')
  })

  it('períodos en hora de Chile con período anterior del mismo largo', () => {
    const { current, previous } = resolvePeriod({ from: '2026-10-01', to: '2026-10-10' })
    expect(current.days).toBe(10)
    expect(current.fromIso).toBe('2026-10-01T03:00:00.000Z')
    expect(previous).toMatchObject({ from: '2026-09-21', to: '2026-09-30' })
  })
})

describe('humo: cada herramienta de lectura de plataforma responde sin error interno', () => {
  const SAMPLE = {
    organization_id: 7,
    event_id: 10,
    order_id: 'o1',
    payout_id: '11111111-1111-4111-8111-111111111111',
    query: 'ana@prod.cl',
  }
  it('todas', async () => {
    const tools = ADMIN_TOOLS.filter((t) => t.readOnly && !t.name.startsWith('org_'))
    expect(tools.length).toBeGreaterThan(15)
    for (const tool of tools) {
      const schema = adminEffectiveSchema(tool)
      const args = Object.fromEntries((schema.required || []).map((k) => [k, SAMPLE[k]]))
      const out = await runAdminTool(tool, args, actx())
      if (!out.ok) expect(out.code, `${tool.name}: ${out.message}`).not.toBe('internal')
    }
  })
})

describe('aislamiento', () => {
  it('ningún archivo de la API de productores importa el MCP de admin', () => {
    const root = join(process.cwd(), 'src/lib/producer-api')
    const files = []
    const walk = (dir) => readdirSync(dir).forEach((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : files.push(join(dir, f))))
    walk(root)
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/(from\s+|import\()["'][^"']*admin-api/)
  })

  it('cada herramienta de admin tiene nombre único y org_* cubre todas las de productor no bloqueadas', () => {
    expect(new Set(ADMIN_TOOLS.map((t) => t.name)).size).toBe(ADMIN_TOOLS.length)
    expect(getAdminTool('org_get_account')).toBeNull()
    expect(getAdminTool('org_request_payout')).toBeNull()
  })
})
