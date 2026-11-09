// Herramientas de la API de productores que ningún test ejercitaba directamente: get_sales_overview,
// get_event_compliance, list/update/delete_discount_code, get_account, list_venues, get_fee_schedule, list_payouts,
// remove_guest, get_marketing_kit, list/delete_social_post y list_scheduled_messages. Cada una por runTool (como el
// MCP, REST y el panel): permiso por rol (forbidden), alcance por organización (ids de otra → not_found o vacío),
// acceso por evento (actor.eventIds) y la forma del resultado. Sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const mocks = vi.hoisted(() => ({ notifySlack: vi.fn(async () => {}) }))
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/pages/api/_lib/server-utils', async (orig) => ({ ...(await orig()), notifySlack: mocks.notifySlack }))

const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')
const { API_SCOPES } = await import('../../src/lib/producer-api/keys.ts')

const DAY = 86400000
const iso = (ms) => new Date(Date.now() + ms).toISOString()
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const CODE = { ev10: uuid(1), ev11: uuid(2), org: uuid(3), foreign: uuid(9), used: uuid(4) }
const GUEST = { g10: uuid(21), g11: uuid(22), g20: uuid(29) }

function seed() {
  db = createFakeSupabase({
    tables: {
      organizations: [
        { id: 7, public_name: 'Productora Sur', email: 'hola@sur.cl', website: 'https://sur.cl', instagram: '@sur', facebook: null, tiktok: null },
        { id: 8, public_name: 'Otra', email: 'otra@x.cl' },
      ],
      events: [
        {
          id: 10, organization_id: 7, name: 'Show Viernes', slug: 'show-viernes', status: 'published', description: '<p>Rock en vivo</p>',
          start_date: iso(10 * DAY), end_date: iso(10 * DAY + 3 * 3600000), image_url: 'https://img.test/10.jpg', fee_absorbed: true,
          is_massive: true, requires_documents: true, permit_status: 'pending', risk_level: 'medium', risk_signals: [{ code: 'large_capacity', label: 'Capacidad grande' }], reserve_pct: 20,
        },
        { id: 11, organization_id: 7, name: 'Taller', slug: 'taller', status: 'draft', start_date: iso(20 * DAY), end_date: iso(20 * DAY + 3600000), fee_absorbed: false },
        { id: 20, organization_id: 8, name: 'Ajeno', slug: 'ajeno', status: 'published', start_date: iso(5 * DAY), end_date: iso(5 * DAY + 3600000), fee_absorbed: true },
      ],
      event_dates: [],
      event_tickets: [],
      event_orders: [
        { id: 'o1', event_id: 10, status: 'paid', amount: 20000, ticket_qty: 2, created_at: iso(-2 * DAY), ticket_details: [{ id: 1, name: 'General', price: 10000, quantity: 2 }] },
        { id: 'o2', event_id: 10, status: 'paid', amount: 10000, ticket_qty: 1, created_at: iso(-60 * DAY), ticket_details: [{ id: 1, name: 'General', price: 10000, quantity: 1 }] },
        { id: 'o3', event_id: 10, status: 'paid', amount: 0, ticket_qty: 1, payment_provider: 'courtesy', created_at: iso(-1 * DAY), ticket_details: [{ id: 2, name: 'Cortesía', price: 0, quantity: 1, complimentary: true }] },
        { id: 'o4', event_id: 11, status: 'paid', amount: 5000, ticket_qty: 1, created_at: iso(-1 * DAY), discount_code_id: CODE.used, ticket_details: [{ id: 3, name: 'Cupo', price: 5000, quantity: 1 }] },
        { id: 'o5', event_id: 10, status: 'pending', amount: 9000, ticket_qty: 1, created_at: iso(-1 * DAY) },
        { id: 'o9', event_id: 20, status: 'paid', amount: 999000, ticket_qty: 9, created_at: iso(-1 * DAY) },
      ],
      social_accounts: [
        { id: 1, organization_id: 7, platform: 'instagram', account_name: '@sur', status: 'active' },
        { id: 2, organization_id: 7, platform: 'facebook', account_name: 'Sur FB', status: 'disconnected' },
        { id: 3, organization_id: 8, platform: 'instagram', account_name: '@otra', status: 'active' },
      ],
      aitickets_discount_codes: [
        { id: CODE.ev10, organization_id: 7, event_id: 10, code: 'VIERNES', kind: 'percent', value: 10, active: true, created_at: '2026-10-01' },
        { id: CODE.ev11, organization_id: 7, event_id: 11, code: 'TALLER', kind: 'fixed', value: 2000, active: true, created_at: '2026-10-02' },
        { id: CODE.org, organization_id: 7, event_id: null, code: 'TODOS', kind: 'percent', value: 5, active: true, created_at: '2026-10-03' },
        { id: CODE.used, organization_id: 7, event_id: 11, code: 'USADO', kind: 'fixed', value: 1000, active: true, created_at: '2026-10-04' },
        { id: CODE.foreign, organization_id: 8, event_id: 20, code: 'AJENO', kind: 'fixed', value: 1000, active: true, created_at: '2026-10-05' },
        { id: uuid(5), organization_id: 7, event_id: null, code: 'GRACIAS-XYZ', kind: 'percent', value: 10, active: true, source: 'review_reward', created_at: '2026-10-06' },
      ],
      venues: [
        { id: 'v-own', name: 'Teatro Sur', city: 'Santiago', organization_id: 7 },
        { id: 'v-legacy', name: 'Bar Legado', city: 'Valparaíso', organization_id: null },
        { id: 'v-other', name: 'Arena Ajena', city: 'Santiago', organization_id: 8 },
      ],
      event_locations: [
        { id: 'l1', event_id: 10, venue_id: 'v-legacy', 'events.organization_id': 7 },
        { id: 'l9', event_id: 20, venue_id: 'v-other', 'events.organization_id': 8 },
      ],
      organization_payout_accounts: [],
      aitickets_payouts: [
        { id: 'p1', organization_id: 7, amount: 30000, status: 'requested', bank_name: 'BancoEstado', bank_account_type: 'Cuenta Vista', bank_account_last4: '6789', requested_via: 'dashboard', estimated_payment_date: '2026-11-10', created_at: iso(-1 * DAY) },
        { id: 'p2', organization_id: 7, amount: 10000, status: 'paid', bank_name: 'BancoEstado', bank_account_last4: '6789', requested_via: 'mcp', paid_at: iso(-3 * DAY), reference: 'TX-1', created_at: iso(-5 * DAY) },
        { id: 'p9', organization_id: 8, amount: 999000, status: 'requested', bank_name: 'Otro', bank_account_last4: '0000', created_at: iso(-1 * DAY) },
      ],
      event_withdrawals: [
        { id: 1, event_id: 10, amount: 5000, status: 'paid', paid_at: iso(-30 * DAY), created_at: iso(-31 * DAY), payout_id: null },
        { id: 2, event_id: 11, amount: 7000, status: 'requested', created_at: iso(-2 * DAY), payout_id: null },
        { id: 3, event_id: 10, amount: 30000, status: 'requested', created_at: iso(-1 * DAY), payout_id: 'p1' },
        { id: 9, event_id: 20, amount: 999000, status: 'paid', created_at: iso(-2 * DAY), payout_id: null },
      ],
      aitickets_refunds: [],
      aitickets_guests: [
        { id: GUEST.g10, organization_id: 7, event_id: 10, name: 'Invitada', email: 'inv@x.cl', status: 'pending' },
        { id: GUEST.g11, organization_id: 7, event_id: 11, name: 'Otro', email: 'otro@x.cl', status: 'pending' },
        { id: GUEST.g20, organization_id: 8, event_id: 20, name: 'Ajeno', email: 'aj@x.cl', status: 'pending' },
      ],
      social_posts: [
        { id: 1, organization_id: 7, event_id: 10, content: 'Borrador viernes', status: 'draft', platforms: ['instagram'], image_urls: [], created_at: '2026-10-01' },
        { id: 2, organization_id: 7, event_id: 10, content: 'Ya salió', status: 'published', platforms: ['instagram'], published_at: '2026-10-02', created_at: '2026-10-02' },
        { id: 3, organization_id: 7, event_id: 11, content: 'Falló taller', status: 'failed', platforms: ['facebook'], error_message: 'token vencido', created_at: '2026-10-03' },
        { id: 9, organization_id: 8, event_id: 20, content: 'Ajeno', status: 'draft', platforms: ['instagram'], created_at: '2026-10-04' },
      ],
      aitickets_scheduled_messages: [
        { id: uuid(31), organization_id: 7, event_id: 10, kind: 'reminder', subject: 'Mañana es el show', audience: 'all', send_at: iso(9 * DAY), status: 'scheduled', created_at: iso(-1 * DAY) },
        { id: uuid(32), organization_id: 7, event_id: 10, kind: 'message', subject: 'Cambio de puerta', audience: 'all', send_at: iso(-1 * DAY), status: 'sent', recipients_count: 12, failed_count: 0, sent_at: iso(-1 * DAY), created_at: iso(-2 * DAY) },
        { id: uuid(33), organization_id: 7, event_id: 11, kind: 'message', subject: 'Taller', audience: 'all', send_at: iso(-1 * DAY), status: 'sent', created_at: iso(-2 * DAY) },
        { id: uuid(39), organization_id: 8, event_id: 20, kind: 'message', subject: 'Ajeno', audience: 'all', send_at: iso(-1 * DAY), status: 'sent', created_at: iso(-2 * DAY) },
      ],
      aitickets_event_documents: [
        { id: uuid(41), event_id: 10, organization_id: 7, kind: 'delegacion_presidencial', status: 'pending', file_name: 'permiso.pdf', created_at: iso(-1 * DAY) },
      ],
      aitickets_api_audit: [],
      aitickets_api_idempotency: [],
      aitickets_api_confirmations: [],
    },
    rpc: {
      aitickets_discount_code_stats: ({ p_code_ids }) =>
        p_code_ids.includes(CODE.ev10) ? [{ code_id: CODE.ev10, uses: 4, paid_orders: 3, discount_total: 3000, revenue: 27000 }] : [],
    },
  })
}

beforeEach(() => {
  seed()
  mocks.notifySlack.mockClear()
})

const ctxFor = (role = 'producer', over = {}) => ({
  supabase: db,
  actor: { keyId: 'k1', userId: 1, orgId: 7, role, name: 'Ana', email: 'ana@sur.cl', scopes: [...API_SCOPES], eventIds: null, ...over },
  origin: 'https://aitickets.test',
  requestUrl: new URL('https://aitickets.test/api/mcp'),
  channel: 'mcp',
})
const call = (name, args = {}, ctx = ctxFor()) => runTool(getTool(name), args, ctx)
const writesTo = (table) => db.calls.filter((c) => c.table === table && ['insert', 'update', 'upsert', 'delete'].includes(c.op))
const staff = (role = 'editor') => ctxFor(role, { userId: 5, eventIds: [11] })

/** Roles sin el permiso: forbidden (y sin tocar `table` si se indica). */
async function expectForbiddenFor(roles, name, args, table) {
  for (const role of roles) {
    const before = table ? writesTo(table).length : 0
    const out = await call(name, args, ctxFor(role))
    expect(out, `${name} con rol ${role}`).toMatchObject({ ok: false, code: 'forbidden' })
    if (table) expect(writesTo(table).length).toBe(before)
  }
}

describe('get_sales_overview', () => {
  it('totales y ranking de la organización (sin cortesías, pendientes ni otra organización)', async () => {
    const out = await call('get_sales_overview', { days: 30 })
    expect(out.ok).toBe(true)
    expect(out.result).toMatchObject({ period_days: 30, totals: { paid_orders: 2, tickets_sold: 3, revenue_clp: 25000 } })
    expect(out.result.events.map((e) => [e.event_id, e.revenue_clp, e.tickets_sold])).toEqual([[10, 20000, 2], [11, 5000, 1]])
    expect(out.result.events[0]).toMatchObject({ name: 'Show Viernes', public_url: 'https://aitickets.test/eventos/show-viernes' })
    expect(out.result.events[1].public_url).toBeNull() // borrador: sin link público
    expect(JSON.stringify(out.result)).not.toContain('Ajeno')
  })

  it('el período cuenta: 90 días incluye la orden antigua', async () => {
    const out = await call('get_sales_overview', { days: 90 })
    expect(out.result.totals).toMatchObject({ paid_orders: 3, revenue_clp: 35000 })
  })

  it('acceso limitado a un evento: solo ese evento', async () => {
    const out = await call('get_sales_overview', {}, staff('validator'))
    expect(out.result.totals).toMatchObject({ paid_orders: 1, revenue_clp: 5000 })
    expect(out.result.events.map((e) => e.event_id)).toEqual([11])
  })

  it('sin el scope read: forbidden (todos los roles tienen events.read)', async () => {
    expect(await call('get_sales_overview', {}, ctxFor('producer', { scopes: ['finance'] }))).toMatchObject({ ok: false, code: 'forbidden' })
    for (const role of ['admin', 'finance', 'editor', 'validator', 'viewer']) expect((await call('get_sales_overview', {}, ctxFor(role))).ok).toBe(true)
  })
})

describe('get_event_compliance', () => {
  it('riesgo, reserva, autorización, documentos y faltantes del evento', async () => {
    const out = await call('get_event_compliance', { event_id: 10 })
    expect(out.ok).toBe(true)
    expect(out.result).toMatchObject({
      event_id: 10,
      name: 'Show Viernes',
      risk_level: 'medium',
      risk_signals: ['Capacidad grande'],
      reserve_pct: 20,
      is_massive: true,
      requires_documents: true,
      permit_status: 'pending',
      permit_status_label: 'Autorización en trámite',
    })
    expect(out.result.documents).toEqual([expect.objectContaining({ kind: 'delegacion_presidencial', status: 'pending', file_name: 'permiso.pdf' })])
    expect(out.result.missing_documents.map((d) => d.kind)).not.toContain('delegacion_presidencial')
    expect(out.result.missing_documents.length).toBeGreaterThan(0)
    expect(out.result.balance).toEqual(expect.objectContaining({ available: expect.any(Number), pending: expect.any(Number), summary: expect.stringContaining('Disponible') }))
    expect(Array.isArray(out.result.functions)).toBe(true)
  })

  it('evento de otra organización: not_found; acceso limitado a otro evento: forbidden', async () => {
    expect(await call('get_event_compliance', { event_id: 20 })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await call('get_event_compliance', { event_id: 10 }, staff())).toMatchObject({ ok: false, code: 'forbidden' })
    expect((await call('get_event_compliance', { event_id: 11 }, staff())).ok).toBe(true)
  })

  it('sin el scope read: forbidden', async () => {
    expect(await call('get_event_compliance', { event_id: 10 }, ctxFor('producer', { scopes: ['write'] }))).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('list_discount_codes', () => {
  it('códigos de la organización con estado y rendimiento, sin premios de reseñas ni de otra organización', async () => {
    const out = await call('list_discount_codes')
    expect(out.ok).toBe(true)
    expect(out.result.codes.map((c) => c.code).sort()).toEqual(['TALLER', 'TODOS', 'USADO', 'VIERNES'])
    expect(out.result.codes.find((c) => c.code === 'VIERNES')).toMatchObject({
      kind: 'percent', value: 10, event_id: 10, applies_to: 'event', state: 'active', uses: 4, paid_orders: 3, discount_given_clp: 3000, revenue_clp: 27000,
    })
    expect(out.result.codes.find((c) => c.code === 'TODOS')).toMatchObject({ event_id: null, applies_to: 'all_events' })
  })

  it('con event_id: los del evento + los de todos los eventos', async () => {
    const out = await call('list_discount_codes', { event_id: 10 })
    expect(out.result.codes.map((c) => c.code).sort()).toEqual(['TODOS', 'VIERNES'])
  })

  it('event_id de otra organización: not_found; de un evento no asignado: forbidden', async () => {
    expect(await call('list_discount_codes', { event_id: 20 })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await call('list_discount_codes', { event_id: 10 }, staff())).toMatchObject({ ok: false, code: 'forbidden' })
    expect((await call('list_discount_codes', { event_id: 11 }, staff())).result.codes.map((c) => c.code).sort()).toEqual(['TALLER', 'TODOS', 'USADO'])
  })

  // Sin event_id, un miembro limitado al evento 11 ve los códigos de su evento y los de toda la organización, nunca los
  // del evento 10 (antes veía todos, con su rendimiento)
  it('acceso limitado sin event_id: no ve códigos de eventos no asignados', async () => {
    const out = await call('list_discount_codes', {}, staff())
    expect(out.ok).toBe(true)
    expect(out.result.codes.map((c) => c.code)).not.toContain('VIERNES')
  })

  it('sin el scope read: forbidden', async () => {
    expect(await call('list_discount_codes', {}, ctxFor('producer', { scopes: ['write'] }))).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('update_discount_code', () => {
  it('desactiva y cambia límites; no toca el código ni el valor', async () => {
    const out = await call('update_discount_code', { id: CODE.ev10, active: false, max_uses: 50 })
    expect(out.ok).toBe(true)
    expect(out.result.code).toMatchObject({ id: CODE.ev10, code: 'VIERNES', value: 10, state: 'inactive', max_uses: 50, uses: 4 })
    expect(db.tables.aitickets_discount_codes.find((c) => c.id === CODE.ev10)).toMatchObject({ active: false, max_uses: 50, value: 10, code: 'VIERNES' })
    expect(db.tables.aitickets_api_audit.at(-1)).toMatchObject({ tool: 'update_discount_code', ok: true })
  })

  it('sin cambios o fechas al revés: invalid_input; campos no editables: invalid_input', async () => {
    expect(await call('update_discount_code', { id: CODE.ev10 })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await call('update_discount_code', { id: CODE.ev10, starts_at: '2026-12-10T00:00:00Z', ends_at: '2026-12-01T00:00:00Z' })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await call('update_discount_code', { id: CODE.ev10, value: 99 })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(writesTo('aitickets_discount_codes')).toHaveLength(0)
  })

  it('código de otra organización: not_found y sin cambios', async () => {
    expect(await call('update_discount_code', { id: CODE.foreign, active: false })).toMatchObject({ ok: false, code: 'not_found' })
    expect(db.tables.aitickets_discount_codes.find((c) => c.id === CODE.foreign).active).toBe(true)
    expect(writesTo('aitickets_discount_codes')).toHaveLength(0)
  })

  it('finanzas, puerta y solo lectura no editan códigos (events.write)', async () => {
    await expectForbiddenFor(['finance', 'validator', 'viewer'], 'update_discount_code', { id: CODE.ev10, active: false }, 'aitickets_discount_codes')
    for (const role of ['admin', 'editor']) expect((await call('update_discount_code', { id: CODE.ev10, active: true }, ctxFor(role))).ok).toBe(true)
  })

  // update_discount_code verifica el acceso por evento (antes un miembro del evento 11 desactivaba el código del 10)
  it('acceso limitado: no edita el código de un evento no asignado ni uno de toda la organización', async () => {
    expect(await call('update_discount_code', { id: CODE.ev10, active: false }, staff())).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await call('update_discount_code', { id: CODE.org, active: false }, staff())).toMatchObject({ ok: false, code: 'forbidden' })
    expect(db.tables.aitickets_discount_codes.find((c) => c.id === CODE.ev10).active).not.toBe(false)
  })

  it('acceso limitado: sí edita los códigos de su evento', async () => {
    expect((await call('update_discount_code', { id: CODE.ev11, max_uses: 3 }, staff())).ok).toBe(true)
    expect(db.tables.aitickets_discount_codes.find((c) => c.id === CODE.ev11).max_uses).toBe(3)
  })
})

describe('delete_discount_code', () => {
  it('elimina un código sin uso', async () => {
    const out = await call('delete_discount_code', { id: CODE.ev10 })
    expect(out).toMatchObject({ ok: true, result: { id: CODE.ev10, code: 'VIERNES', event_id: 10, result: 'deleted' } })
    expect(db.tables.aitickets_discount_codes.some((c) => c.id === CODE.ev10)).toBe(false)
  })

  it('un código ya usado no se elimina (conflict)', async () => {
    expect(await call('delete_discount_code', { id: CODE.used })).toMatchObject({ ok: false, code: 'conflict' })
    expect(db.tables.aitickets_discount_codes.some((c) => c.id === CODE.used)).toBe(true)
  })

  it('código de otra organización: not_found y no se borra', async () => {
    expect(await call('delete_discount_code', { id: CODE.foreign })).toMatchObject({ ok: false, code: 'not_found' })
    expect(db.tables.aitickets_discount_codes.some((c) => c.id === CODE.foreign)).toBe(true)
  })

  it('acceso limitado: forbidden para el código de otro evento; borra el de su evento', async () => {
    expect(await call('delete_discount_code', { id: CODE.ev10 }, staff())).toMatchObject({ ok: false, code: 'forbidden' })
    expect(db.tables.aitickets_discount_codes.some((c) => c.id === CODE.ev10)).toBe(true)
    expect((await call('delete_discount_code', { id: CODE.ev11 }, staff())).ok).toBe(true)
  })

  // Un código de toda la organización solo lo borra quien no tiene acceso limitado (igual que los links de promotor)
  it('acceso limitado: no borra un código de toda la organización', async () => {
    expect(await call('delete_discount_code', { id: CODE.org }, staff())).toMatchObject({ ok: false, code: 'forbidden' })
    expect(db.tables.aitickets_discount_codes.some((c) => c.id === CODE.org)).toBe(true)
  })

  it('finanzas, puerta y solo lectura no eliminan códigos', async () => {
    await expectForbiddenFor(['finance', 'validator', 'viewer'], 'delete_discount_code', { id: CODE.ev10 }, 'aitickets_discount_codes')
    expect(db.tables.aitickets_discount_codes.some((c) => c.id === CODE.ev10)).toBe(true)
  })
})

describe('get_account', () => {
  it('organización, rol con sus permisos, alcance de la conexión y redes activas', async () => {
    const out = await call('get_account', {}, ctxFor('finance', { scopes: ['read', 'finance'] }))
    expect(out.ok).toBe(true)
    expect(out.result.organization).toMatchObject({ id: 7, name: 'Productora Sur', email: 'hola@sur.cl', instagram: '@sur' })
    expect(out.result.user).toMatchObject({ id: 1, role: 'finance', role_label: 'Finanzas' })
    expect(out.result.scopes.map((s) => s.scope)).toEqual(['read', 'finance'])
    const perms = out.result.role_permissions.map((p) => p.permission)
    expect(perms).toContain('finance.manage')
    expect(perms).not.toContain('events.write')
    expect(out.result.event_access).toBe('all')
    expect(out.result.connected_social_accounts).toEqual([{ platform: 'instagram', account: '@sur' }])
  })

  it('acceso limitado: lo informa; nunca muestra otra organización', async () => {
    const out = await call('get_account', {}, staff('validator'))
    expect(out.result.event_access).toEqual({ restricted_to_event_ids: [11] })
    expect(JSON.stringify(out.result)).not.toMatch(/Otra|@otra/)
  })

  it('sin el scope read: forbidden', async () => {
    expect(await call('get_account', {}, ctxFor('producer', { scopes: ['finance'] }))).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('list_venues', () => {
  it('lugares propios y los que usan sus eventos; nunca los de otra organización', async () => {
    const out = await call('list_venues')
    expect(out.ok).toBe(true)
    expect(out.result.venues).toEqual([
      { venue_id: 'v-legacy', name: 'Bar Legado', city: 'Valparaíso' },
      { venue_id: 'v-own', name: 'Teatro Sur', city: 'Santiago' },
    ])
  })

  it('otra organización ve solo los suyos', async () => {
    const out = await call('list_venues', {}, ctxFor('producer', { orgId: 8 }))
    expect(out.result.venues.map((v) => v.venue_id)).toEqual(['v-other'])
  })

  it('sin el scope read: forbidden', async () => {
    expect(await call('list_venues', {}, ctxFor('producer', { scopes: ['write'] }))).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('get_fee_schedule', () => {
  it('cargo vigente, ejemplos en ambos modos y eventos con cargo absorbido (solo de la organización)', async () => {
    const out = await call('get_fee_schedule', {}, ctxFor('finance'))
    expect(out.ok).toBe(true)
    expect(out.result.service_fee).toMatchObject({ rate: expect.any(Number), label: expect.stringContaining('%') })
    expect(out.result.examples.buyer_pays).toMatchObject({ ticket_price: 10000, producer_receives: 10000 })
    expect(out.result.examples.buyer_pays.buyer_pays).toBeGreaterThan(10000)
    expect(out.result.examples.producer_absorbs).toMatchObject({ ticket_price: 10000, buyer_pays: 10000 })
    expect(out.result.examples.producer_absorbs.producer_receives).toBeLessThan(10000)
    expect(out.result.events_with_absorbed_fee).toEqual([{ id: 10, name: 'Show Viernes' }])
  })

  it('acceso limitado: solo sus eventos', async () => {
    const out = await call('get_fee_schedule', {}, staff('finance'))
    expect(out.result.events_with_absorbed_fee).toEqual([])
  })

  it('marketing, puerta y solo lectura no ven comisiones (finance.read)', async () => {
    await expectForbiddenFor(['editor', 'validator', 'viewer'], 'get_fee_schedule', {})
    for (const role of ['producer', 'admin', 'finance']) expect((await call('get_fee_schedule', {}, ctxFor(role))).ok).toBe(true)
  })
})

describe('list_payouts', () => {
  it('retiros de la organización y transferencias manuales antiguas', async () => {
    const out = await call('list_payouts', {}, ctxFor('finance'))
    expect(out.ok).toBe(true)
    expect(out.result.payouts.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(out.result.payouts[0]).toMatchObject({ amount: 30000, status: 'requested', bank: 'BancoEstado', account_last4: '6789', requested_via: 'dashboard' })
    expect(out.result.payouts[1]).toMatchObject({ status: 'paid', transfer_reference: 'TX-1' })
    // Las transferencias manuales son las sin payout_id; nunca de otra organización
    expect(out.result.manual_transfers.map((w) => [w.withdrawal_id, w.event])).toEqual([[1, 'Show Viernes'], [2, 'Taller']])
    expect(JSON.stringify(out.result)).not.toContain('999000')
  })

  it('filtro por estado', async () => {
    const out = await call('list_payouts', { status: 'paid' })
    expect(out.result.payouts.map((p) => p.id)).toEqual(['p2'])
    expect(out.result.manual_transfers.map((w) => w.withdrawal_id)).toEqual([1])
  })

  it('acceso limitado: transferencias manuales solo de sus eventos', async () => {
    const out = await call('list_payouts', {}, staff('finance'))
    expect(out.result.manual_transfers.map((w) => w.withdrawal_id)).toEqual([2])
  })

  it('marketing, puerta y solo lectura no ven retiros', async () => {
    await expectForbiddenFor(['editor', 'validator', 'viewer'], 'list_payouts', {})
  })
})

describe('remove_guest', () => {
  it('marca al invitado como quitado (idempotente)', async () => {
    const out = await call('remove_guest', { event_id: 10, guest_id: GUEST.g10 })
    expect(out).toMatchObject({ ok: true, result: { event_id: 10, guest_id: GUEST.g10, status: 'removed' } })
    expect(db.tables.aitickets_guests.find((g) => g.id === GUEST.g10)).toMatchObject({ status: 'removed', removed_at: expect.any(String) })
    expect((await call('remove_guest', { event_id: 10, guest_id: GUEST.g10 })).ok).toBe(true)
    expect(db.tables.aitickets_api_audit.at(-1)).toMatchObject({ tool: 'remove_guest', ok: true })
  })

  it('invitado de otro evento u organización: not_found y sin cambios', async () => {
    expect(await call('remove_guest', { event_id: 10, guest_id: GUEST.g11 })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await call('remove_guest', { event_id: 20, guest_id: GUEST.g20 })).toMatchObject({ ok: false, code: 'not_found' })
    expect(writesTo('aitickets_guests')).toHaveLength(0)
  })

  it('acceso limitado: forbidden en otro evento; quita en el suyo', async () => {
    expect(await call('remove_guest', { event_id: 10, guest_id: GUEST.g10 }, staff())).toMatchObject({ ok: false, code: 'forbidden' })
    expect(db.tables.aitickets_guests.find((g) => g.id === GUEST.g10).status).toBe('pending')
    expect((await call('remove_guest', { event_id: 11, guest_id: GUEST.g11 }, staff())).ok).toBe(true)
  })

  it('finanzas, puerta y solo lectura no gestionan invitados (guests.manage)', async () => {
    await expectForbiddenFor(['finance', 'validator', 'viewer'], 'remove_guest', { event_id: 10, guest_id: GUEST.g10 }, 'aitickets_guests')
    expect((await call('remove_guest', { event_id: 10, guest_id: GUEST.g10 }, ctxFor('editor'))).ok).toBe(true)
  })
})

describe('get_marketing_kit', () => {
  it('ficha, links con seguimiento, redes y guía de estilo de un evento publicado', async () => {
    const out = await call('get_marketing_kit', { event_id: 10 }, ctxFor('editor'))
    expect(out.ok).toBe(true)
    expect(out.result).toMatchObject({
      event_id: 10,
      status: 'published',
      is_published: true,
      public_url: 'https://aitickets.test/eventos/show-viernes',
      image_url: 'https://img.test/10.jpg',
      organization: { name: 'Productora Sur', instagram: '@sur' },
      can_publish_to: [{ platform: 'instagram', account: '@sur' }],
      image_generation_available: false,
    })
    expect(out.result.brief).toContain('Show Viernes')
    expect(out.result.tracking_link_examples.promoter).toBe('https://aitickets.test/eventos/show-viernes?ref=NOMBRE_PROMOTOR')
    expect(out.result.style_guide.length).toBeGreaterThan(0)
    expect(out.result.draft_warning).toBeUndefined()
  })

  it('borrador: sin link público y con aviso', async () => {
    const out = await call('get_marketing_kit', { event_id: 11 })
    expect(out.result).toMatchObject({ is_published: false, public_url: null, draft_warning: expect.stringContaining('BORRADOR') })
    expect(out.result.tracking_link_examples).toBeUndefined()
    expect(out.result.tracking_link_examples_after_publish.whatsapp).toContain('/eventos/taller')
  })

  it('evento de otra organización: not_found; no asignado: forbidden; sin scope read: forbidden', async () => {
    expect(await call('get_marketing_kit', { event_id: 20 })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await call('get_marketing_kit', { event_id: 10 }, staff())).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await call('get_marketing_kit', { event_id: 10 }, ctxFor('producer', { scopes: ['write'] }))).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('list_social_posts', () => {
  it('publicaciones de la organización con su estado; filtro por evento y estado', async () => {
    const all = await call('list_social_posts')
    expect(all.ok).toBe(true)
    expect(all.result.posts.map((p) => p.id)).toEqual([1, 2, 3])
    expect(all.result.posts[2]).toMatchObject({ event_id: 11, status: 'failed', error: 'token vencido', platforms: ['facebook'], image_urls: [] })
    expect((await call('list_social_posts', { event_id: 10 })).result.posts.map((p) => p.id)).toEqual([1, 2])
    expect((await call('list_social_posts', { status: 'draft' })).result.posts.map((p) => p.id)).toEqual([1])
  })

  it('event_id de otra organización: not_found (como las demás herramientas)', async () => {
    expect(await call('list_social_posts', { event_id: 20 })).toMatchObject({ ok: false, code: 'not_found' })
  })

  // list_social_posts aplica el acceso por evento (antes listaba los borradores de cualquier evento de la organización)
  it('acceso limitado: solo lista las publicaciones de sus eventos', async () => {
    const out = await call('list_social_posts', {}, staff())
    expect(out.result.posts.map((p) => p.event_id)).toEqual([11])
    expect(await call('list_social_posts', { event_id: 10 }, staff())).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('sin el scope read: forbidden', async () => {
    expect(await call('list_social_posts', {}, ctxFor('producer', { scopes: ['write'] }))).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('delete_social_post', () => {
  it('elimina un borrador o una fallida; no una publicada', async () => {
    expect(await call('delete_social_post', { post_id: 1 })).toMatchObject({ ok: true, result: { post_id: 1, event_id: 10, result: 'deleted' } })
    expect(db.tables.social_posts.some((p) => p.id === 1)).toBe(false)
    expect(await call('delete_social_post', { post_id: 2 })).toMatchObject({ ok: false, code: 'conflict' })
    expect(db.tables.social_posts.some((p) => p.id === 2)).toBe(true)
    expect((await call('delete_social_post', { post_id: 3 })).ok).toBe(true)
  })

  it('publicación de otra organización: not_found y no se borra', async () => {
    expect(await call('delete_social_post', { post_id: 9 })).toMatchObject({ ok: false, code: 'not_found' })
    expect(db.tables.social_posts.some((p) => p.id === 9)).toBe(true)
  })

  it('acceso limitado: forbidden en otro evento', async () => {
    expect(await call('delete_social_post', { post_id: 1 }, staff())).toMatchObject({ ok: false, code: 'forbidden' })
    expect(db.tables.social_posts.some((p) => p.id === 1)).toBe(true)
    expect((await call('delete_social_post', { post_id: 3 }, staff())).ok).toBe(true)
  })

  it('finanzas, puerta y solo lectura no eliminan publicaciones (events.write)', async () => {
    await expectForbiddenFor(['finance', 'validator', 'viewer'], 'delete_social_post', { post_id: 1 }, 'social_posts')
    expect(db.tables.social_posts).toHaveLength(4)
  })
})

describe('list_scheduled_messages', () => {
  it('mensajes del evento con estado y destinatarios', async () => {
    const out = await call('list_scheduled_messages', { event_id: 10 })
    expect(out.ok).toBe(true)
    expect(out.result.event_id).toBe(10)
    expect(out.result.messages.map((m) => m.subject)).toEqual(['Mañana es el show', 'Cambio de puerta'])
    expect(out.result.messages[1]).toMatchObject({ kind: 'message', status: 'sent', recipients_count: 12, failed_count: 0, send_at_local: expect.any(String) })
    expect((await call('list_scheduled_messages', { event_id: 10, status: 'sent' })).result.messages.map((m) => m.subject)).toEqual(['Cambio de puerta'])
  })

  it('evento de otra organización: not_found; no asignado: forbidden', async () => {
    expect(await call('list_scheduled_messages', { event_id: 20 })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await call('list_scheduled_messages', { event_id: 10 }, staff('validator'))).toMatchObject({ ok: false, code: 'forbidden' })
    expect((await call('list_scheduled_messages', { event_id: 11 }, staff('validator'))).result.messages).toHaveLength(1)
  })

  it('sin el scope read: forbidden', async () => {
    expect(await call('list_scheduled_messages', { event_id: 10 }, ctxFor('producer', { scopes: ['publish'] }))).toMatchObject({ ok: false, code: 'forbidden' })
  })
})
