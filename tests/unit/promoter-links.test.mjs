// Links privados de promotor / RRPP (ítem 5): el promotor abre su link sin cuenta y ve solo sus ventas por evento y
// función, sin datos de compradores. src/lib/promoterLinks.ts, las herramientas create/list/revoke_promoter_link y
// /api/events/promoter-links. Sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/lib/supabaseServer', () => ({
  EVENT_MANAGER_ROLES: ['admin', 'producer', 'editor'],
  getSessionContext: async () => session,
  hasRole: (u, roles) => roles.includes(u?.role),
  getOwnedEvent: async (id, orgId) => db.tables.events.find((e) => e.id === Number(id) && e.organization_id === orgId) || null,
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

const lib = await import('../../src/lib/promoterLinks.ts')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { marketingTools } = await import('../../src/lib/producer-api/tools/marketing.ts')
const endpoint = await import('../../src/pages/api/events/promoter-links.ts')

const tool = (name) => marketingTools.find((t) => t.name === name)
const NOW = Date.parse('2026-11-01T12:00:00Z')
const line = (event_date_id, price, quantity) => ({ id: 1, name: 'General', price, quantity, total: price * quantity, event_date_id })

function seed() {
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Club Norte' }, { id: 8, public_name: 'Otra' }],
      events: [
        { id: 10, organization_id: 7, name: 'Viernes Techno', slug: 'viernes', status: 'published', start_date: '2026-11-07T01:00:00Z', end_date: '2026-11-07T08:00:00Z' },
        { id: 11, organization_id: 7, name: 'Halloween', slug: 'halloween', status: 'published', start_date: '2026-10-31T01:00:00Z', end_date: '2026-10-31T08:00:00Z' },
        { id: 12, organization_id: 7, name: 'Borrador', slug: 'borrador', status: 'draft', start_date: '2026-12-01T01:00:00Z', end_date: null },
        { id: 13, organization_id: 7, name: 'Septiembre', slug: 'sep', status: 'published', start_date: '2026-09-01T01:00:00Z', end_date: '2026-09-01T08:00:00Z' },
        { id: 20, organization_id: 8, name: 'Ajeno', slug: 'ajeno', status: 'published', start_date: '2026-11-07T01:00:00Z', end_date: '2026-11-07T08:00:00Z' },
      ],
      event_dates: [
        { id: 501, event_id: 10, date: '2026-11-06', start_time: '23:00:00' },
        { id: 502, event_id: 10, date: '2026-11-07', start_time: '23:00:00' },
      ],
      event_orders: [
        // Cami: 2 + 1 entradas en el viernes (dos funciones), una con descuento; 1 en Halloween (ya pasó)
        { id: 'o1', event_id: 10, status: 'paid', ref: 'cami-rojas', amount: 20000, ticket_qty: 2, created_at: '2026-10-20T15:00:00Z', ticket_details: [line(501, 10000, 2)], buyer_email: 'x@y.cl', buyer_first_name: 'Pía' },
        { id: 'o2', event_id: 10, status: 'paid', ref: 'Cami-Rojas', amount: 8000, ticket_qty: 1, created_at: '2026-10-21T15:00:00Z', ticket_details: [line(502, 10000, 1)] },
        { id: 'o3', event_id: 11, status: 'paid', ref: 'cami-rojas', amount: 15000, ticket_qty: 1, created_at: '2026-10-25T15:00:00Z', ticket_details: [line(null, 15000, 1)] },
        // No cuentan: otro promotor, pendiente, cortesía, ref que solo calza con _ como comodín, otra productora
        { id: 'o4', event_id: 10, status: 'paid', ref: 'pedro', amount: 10000, ticket_qty: 1, ticket_details: [line(501, 10000, 1)] },
        { id: 'o5', event_id: 10, status: 'pending', ref: 'cami-rojas', amount: 10000, ticket_qty: 1, ticket_details: [line(501, 10000, 1)] },
        { id: 'o6', event_id: 10, status: 'paid', ref: 'cami-rojas', amount: 0, ticket_qty: 1, payment_provider: 'courtesy', ticket_details: [{ ...line(501, 0, 1), complimentary: true }] },
        { id: 'o7', event_id: 20, status: 'paid', ref: 'cami-rojas', amount: 99000, ticket_qty: 9, ticket_details: [line(null, 11000, 9)] },
      ],
      aitickets_promoter_links: [],
      aitickets_api_audit: [],
    },
  })
}

const ctx = (over = {}) => ({
  supabase: db,
  actor: { keyId: 'k', userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'a@p.cl', scopes: ['read', 'write'], eventIds: null, ...over },
  origin: 'https://aitickets.test',
  requestUrl: new URL('https://aitickets.test/api/mcp'),
  channel: 'mcp',
})
const tokenOf = (url) => url.split('/promotor/')[1]

beforeEach(() => {
  seed()
  session = { dbUser: { id: 1, role: 'producer', organization_id: 7 } }
})

describe('link de promotor', () => {
  it('el código sale del nombre', () => {
    expect(lib.promoterRef('  Camí Rojas! ')).toBe('cami-rojas')
    expect(lib.promoterRef('DJ_Kev.2')).toBe('dj_kev.2')
  })

  it('se crea desde el asistente, se abre con el token y se revoca', async () => {
    const res = await runTool(tool('create_promoter_link'), { name: 'Cami Rojas' }, ctx())
    expect(res.ok).toBe(true)
    expect(res.result.link).toMatchObject({ name: 'Cami Rojas', ref: 'cami-rojas', scope: 'all_events', status: 'active' })
    const token = tokenOf(res.result.promoter_url)
    expect(token).toMatch(lib.PROMOTER_TOKEN_RE)
    // Solo se guarda el hash
    expect(JSON.stringify(db.tables.aitickets_promoter_links)).not.toContain(token)

    const resolved = await lib.resolvePromoterToken(db, token)
    expect(resolved).toMatchObject({ organizationName: 'Club Norte', link: { ref: 'cami-rojas' } })

    const list = await runTool(tool('list_promoter_links'), { event_id: 10 }, ctx())
    expect(list.result.links).toHaveLength(1)
    await runTool(tool('revoke_promoter_link'), { link_id: res.result.link.id }, ctx())
    expect(await lib.resolvePromoterToken(db, token)).toBeNull()
    expect(await lib.resolvePromoterToken(db, 'x'.repeat(32))).toBeNull()
  })

  it('un miembro con acceso a algunos eventos solo crea links de esos eventos', async () => {
    const limited = ctx({ role: 'editor', eventIds: [10] })
    expect(await runTool(tool('create_promoter_link'), { name: 'Cami' }, limited)).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await runTool(tool('create_promoter_link'), { name: 'Cami', event_id: 11 }, limited)).toMatchObject({ ok: false, code: 'forbidden' })
    const ok = await runTool(tool('create_promoter_link'), { name: 'Cami', event_id: 10 }, limited)
    expect(ok.result.link).toMatchObject({ scope: 'event', event_id: 10 })
    expect(await runTool(tool('create_promoter_link'), { name: 'Cami' }, ctx({ role: 'validator' }))).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('lo que ve el promotor', () => {
  it('solo sus ventas pagadas, por evento y función, sin datos de compradores', async () => {
    const { link } = await lib.createPromoterLink(db, { orgId: 7, eventId: null, name: 'Cami Rojas', userId: 1, origin: 'https://aitickets.test' })
    const row = db.tables.aitickets_promoter_links[0]
    const stats = await lib.promoterStats(db, row, 'https://aitickets.test', NOW)
    expect(link.ref).toBe('cami-rojas')

    // El borrador sin ventas y el de septiembre (pasado, sin ventas) no aparecen; el de otra productora tampoco
    expect(stats.events.map((e) => e.id)).toEqual([10, 11])
    const friday = stats.events[0]
    expect(friday).toMatchObject({
      on_sale: true,
      orders: 2,
      tickets: 3,
      revenue_clp: 28000,
      share_url: 'https://aitickets.test/eventos/viernes?ref=cami-rojas',
    })
    expect(friday.by_function).toEqual([
      { label: 'Vie 6 nov · 23:00', tickets: 2, revenue_clp: 20000 },
      { label: 'Sáb 7 nov · 23:00', tickets: 1, revenue_clp: 8000 },
    ])
    expect(stats.events[1]).toMatchObject({ id: 11, on_sale: false, tickets: 1, revenue_clp: 15000, by_function: [] })
    expect(stats.totals).toEqual({ orders: 3, tickets: 4, revenue_clp: 43000 })
    expect(JSON.stringify(stats)).not.toMatch(/x@y\.cl|Pía|buyer/)
  })

  it('un link de un evento solo muestra ese evento; un ref con _ no calza con otros', async () => {
    db.tables.event_orders.push({ id: 'o8', event_id: 10, status: 'paid', ref: 'kevXa', amount: 5000, ticket_qty: 1, ticket_details: [line(501, 5000, 1)] })
    await lib.createPromoterLink(db, { orgId: 7, eventId: 10, name: 'Kev', ref: 'kev_a', userId: 1, origin: 'https://aitickets.test' })
    const stats = await lib.promoterStats(db, db.tables.aitickets_promoter_links[0], 'https://aitickets.test', NOW)
    expect(stats.events.map((e) => e.id)).toEqual([10])
    expect(stats.totals.tickets).toBe(0)
  })
})

describe('/api/events/promoter-links (panel)', () => {
  const req = (method, { query = '', body } = {}) => {
    const url = new URL(`https://aitickets.test/api/events/promoter-links${query}`)
    return { url, request: new Request(url, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) }) }
  }

  it('crea, lista y revoca; un miembro de puerta no puede', async () => {
    const created = await endpoint.POST(req('POST', { body: { eventId: 10, name: 'Cami Rojas', allEvents: true } }))
    expect(created.status).toBe(201)
    const { url, link } = await created.json()
    expect(url).toContain('/promotor/')
    expect(link.scope).toBe('all_events')

    const listed = await (await endpoint.GET(req('GET', { query: '?event_id=10' }))).json()
    expect(listed).toMatchObject({ can_create_all: true, links: [{ id: link.id }] })

    expect((await endpoint.DELETE(req('DELETE', { query: `?id=${link.id}` }))).status).toBe(200)
    expect(db.tables.aitickets_promoter_links[0].revoked_at).toBeTruthy()

    expect((await endpoint.POST(req('POST', { body: { eventId: 20, name: 'X' } }))).status).toBe(404)
    expect((await endpoint.POST(req('POST', { body: { eventId: 10, name: '!!!' } }))).status).toBe(400)
    session = { dbUser: { id: 2, role: 'validator', organization_id: 7 } }
    expect((await endpoint.POST(req('POST', { body: { eventId: 10, name: 'Cami' } }))).status).toBe(403)
  })
})
