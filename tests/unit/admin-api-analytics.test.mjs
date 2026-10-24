// MCP de administración: analítica de plataforma (overview, series, ranking, embudo), soporte (órdenes, diagnóstico,
// usuarios), analítica de un evento y feed de actividad.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))

const { runAdminTool } = await import('../../src/lib/admin-api/registry.ts')
const { getAdminTool } = await import('../../src/lib/admin-api/tools/index.ts')
const { resetSupportUserCache } = await import('../../src/lib/admin-api/context.ts')
const { weekStart, bucketOf } = await import('../../src/lib/admin-api/tools/analytics.ts')
const { orderVerdict } = await import('../../src/lib/admin-api/tools/support.ts')

const SITE = 'https://aitickets.cl'
const DAY = 86400000
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString()
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const O = { o1: uuid(1), o2: uuid(2), o3: uuid(3), o4: uuid(4), o5: uuid(5), o6: uuid(6), o7: uuid(7), o8: uuid(8), t1: uuid(31), t2: uuid(32) }
const line = (name, quantity, price, extra = {}) => ({ name, quantity, price, ...extra })

beforeEach(() => {
  process.env.SITE_URL = SITE
  resetSupportUserCache()
  db = createFakeSupabase({
    tables: {
      aitickets_platform_settings: [{ key: 'support_user_id', value: 900 }],
      organizations: [
        { id: 7, public_name: 'Productora Siete', created_at: iso(-200 * DAY), email_verified_at: iso(-199 * DAY) },
        { id: 8, public_name: 'Ocho Eventos', created_at: iso(-10 * DAY), email_verified_at: null },
        { id: 9, public_name: 'Nueve Producciones', created_at: iso(-20 * DAY), email_verified_at: iso(-19 * DAY), signup_utm_source: 'instagram' },
        { id: 30, public_name: 'Treinta', created_at: iso(-600 * DAY), email_verified_at: iso(-600 * DAY) },
        { id: 1, public_name: 'AI Tickets', created_at: iso(-700 * DAY), email_verified_at: iso(-700 * DAY) },
      ],
      users: [
        { id: 1, name: 'Ana Pérez', email: 'ana@siete.cl', organization_id: 7, role: 'producer', active: true, last_access_at: iso(-DAY), login_count: 12 },
        { id: 2, name: 'Oscar', email: 'oscar@ocho.cl', organization_id: 8, role: 'producer', active: true },
        { id: 3, name: 'Nina', email: 'nina@nueve.cl', organization_id: 9, role: 'producer', active: true },
        { id: 900, name: 'Soporte AI Tickets', email: null, organization_id: null, role: 'viewer', active: false },
      ],
      events: [
        { id: 10, name: 'Fiesta Siete', slug: 'fiesta-siete', status: 'published', organization_id: 7, start_date: iso(20 * DAY), end_date: iso(20 * DAY + 3600000), created_at: iso(-35 * DAY) },
        { id: 12, name: 'Siete Pasado', slug: 'siete-pasado', status: 'published', organization_id: 7, start_date: iso(-41 * DAY), end_date: iso(-40 * DAY), created_at: iso(-100 * DAY) },
        { id: 11, name: 'Borrador Ocho', slug: 'borrador-ocho', status: 'draft', organization_id: 8, created_at: iso(-9 * DAY) },
        { id: 20, name: 'Nueve Borrador', slug: 'nueve-borrador', status: 'draft', organization_id: 9, created_at: iso(-18 * DAY) },
        { id: 21, name: 'Nueve Show', slug: 'nueve-show', status: 'published', organization_id: 9, start_date: iso(10 * DAY), end_date: iso(10 * DAY + 3600000), created_at: iso(-15 * DAY) },
        { id: 30, name: 'Treinta Fest', slug: 'treinta-fest', status: 'published', organization_id: 30, start_date: '2025-03-20T23:00:00.000Z', end_date: '2025-03-21T02:00:00.000Z', created_at: '2025-02-01T12:00:00.000Z' },
        { id: 99, name: 'Demo', slug: 'evento-demo-aitickets', status: 'published', organization_id: 1, start_date: iso(5 * DAY), end_date: iso(5 * DAY + 3600000), created_at: iso(-5 * DAY) },
      ],
      event_orders: [
        { id: O.o1, event_id: 10, attendee_id: 101, status: 'paid', created_at: iso(-2 * DAY), amount: 10000, ticket_fee: 800, service_fee_tax: 152, total_payment: 10952, payment_fee: 300, ticket_qty: 1, ticket_details: [line('General', 1, 10000)], payment_provider: 'flow', buyer_email: 'luis@correo.cl', buyer_first_name: 'Luis', buyer_last_name: 'Rojas', email_sent_at: iso(-2 * DAY) },
        { id: O.o2, event_id: 10, attendee_id: 102, status: 'paid', created_at: iso(-1 * DAY), amount: 0, ticket_fee: 0, service_fee_tax: 0, total_payment: 0, ticket_qty: 2, ticket_details: [line('Cortesía', 2, 0, { complimentary: true })], payment_provider: 'courtesy' },
        { id: O.o3, event_id: 99, attendee_id: 103, status: 'paid', created_at: iso(-1 * DAY), amount: 5000, ticket_fee: 400, service_fee_tax: 76, total_payment: 5476, ticket_qty: 1, ticket_details: [line('Demo', 1, 5000)], payment_provider: 'demo' },
        { id: O.o4, event_id: 12, attendee_id: 104, status: 'paid', created_at: iso(-45 * DAY), amount: 20000, ticket_fee: 1600, service_fee_tax: 304, total_payment: 21904, payment_fee: 600, ticket_qty: 2, ticket_details: [line('General', 2, 10000)], payment_provider: 'flow' },
        { id: O.o5, event_id: 10, attendee_id: 105, status: 'paid', created_at: iso(-1 * DAY), amount: 0, ticket_fee: 0, service_fee_tax: 0, total_payment: 0, ticket_qty: 1, ticket_details: [line('General', 1, 10000, { transferred_from_order: O.o1 })], payment_provider: 'flow' },
        { id: O.o6, event_id: 21, attendee_id: 106, status: 'paid', created_at: iso(-5 * DAY), amount: 5000, ticket_fee: 400, service_fee_tax: 76, total_payment: 5476, payment_fee: 0, ticket_qty: 1, ticket_details: [line('General', 1, 5000)], payment_provider: 'flow', payment_external_id: '123456', buyer_email: 'juana@correo.cl', buyer_first_name: 'Juana', buyer_last_name: 'Soto', email_sent_at: null },
        { id: O.o7, event_id: 10, attendee_id: 107, status: 'review', created_at: iso(-3 * DAY), amount: 10000, ticket_fee: 800, service_fee_tax: 152, total_payment: 10952, ticket_qty: 1, ticket_details: [line('General', 1, 10000)], payment_provider: 'flow', buyer_email: 'pedro@correo.cl' },
        { id: O.o8, event_id: 10, attendee_id: 106, status: 'paid', created_at: iso(-10 * DAY), amount: 8000, ticket_fee: 640, service_fee_tax: 122, total_payment: 8762, payment_fee: 0, ticket_qty: 1, ticket_details: [line('Preventa', 1, 8000)], payment_provider: 'flow', buyer_email: 'JUANA@correo.cl', email_sent_at: iso(-10 * DAY) },
        // Treinta: órdenes de 2025 para probar los cortes semanales en hora de Chile (UTC-3 en marzo de 2025)
        { id: uuid(40), event_id: 30, attendee_id: 140, status: 'paid', created_at: '2025-03-10T02:30:00.000Z', amount: 1000, ticket_fee: 80, service_fee_tax: 15, total_payment: 1095, ticket_qty: 1, ticket_details: [line('G', 1, 1000)], payment_provider: 'flow' },
        { id: uuid(41), event_id: 30, attendee_id: 141, status: 'paid', created_at: '2025-03-10T12:00:00.000Z', amount: 2000, ticket_fee: 160, service_fee_tax: 30, total_payment: 2190, ticket_qty: 2, ticket_details: [line('G', 2, 1000)], payment_provider: 'flow' },
      ],
      attendees: [
        { id: 106, first_name: 'Juana', last_name: 'Soto', email: 'juana@correo.cl' },
        { id: 101, first_name: 'Luis', last_name: 'Rojas', email: 'luis@correo.cl' },
      ],
      event_attendees: [
        { id: O.t1, event_id: 10, event_order_id: O.o1, attendee_id: 101, status: null, validated_at: iso(-DAY), is_complimentary: false, qr_code: 'QR-SECRET-1' },
        { id: O.t2, event_id: 10, event_order_id: O.o1, attendee_id: 101, status: 'active', validated_at: null, is_complimentary: false },
        { id: uuid(33), event_id: 10, event_order_id: O.o7, attendee_id: 107, status: 'cancelled', validated_at: null, is_complimentary: false },
        { id: uuid(34), event_id: 21, event_order_id: O.o6, attendee_id: 106, status: null, validated_at: null, is_complimentary: false },
      ],
      event_visits: [
        { id: 1, event_id: 10, ip_hash: 'a', created_at: iso(-DAY) },
        { id: 2, event_id: 10, ip_hash: 'a', created_at: iso(-2 * DAY) },
        { id: 3, event_id: 10, ip_hash: 'b', created_at: iso(-2 * DAY) },
        { id: 4, event_id: 21, ip_hash: 'c', created_at: iso(-6 * DAY) },
        { id: 5, event_id: 99, ip_hash: 'd', created_at: iso(-DAY) },
        { id: 6, event_id: 10, ip_hash: 'e', created_at: iso(-40 * DAY) },
      ],
      event_tickets: [],
      aitickets_refunds: [
        { id: uuid(50), organization_id: 7, event_id: 10, order_id: O.o1, kind: 'partial', total_amount: 10952, ticket_amount: 10000, fee_amount: 952, status: 'requested', source: 'refund_order', created_at: iso(-DAY) },
        { id: uuid(51), organization_id: 7, event_id: 10, order_id: O.o1, kind: 'partial', total_amount: 500, ticket_amount: 500, fee_amount: 0, status: 'failed', source: 'refund_order', created_at: iso(-DAY) },
      ],
      aitickets_payouts: [{ id: uuid(60), organization_id: 7, amount: 15000, status: 'requested', created_at: iso(-3 * DAY) }],
      organization_payout_accounts: [
        { organization_id: 7, bank_name: 'BancoEstado', bank_account_number: '12345678', bank_account_holder: 'Ana', bank_account_rut: '11.111.111-1', verified_at: null, verification_rejected_at: null },
        { organization_id: 9, bank_name: 'Santander', bank_account_number: '87654321', bank_account_holder: 'Nina', bank_account_rut: '22.222.222-2', verified_at: iso(-4 * DAY), verification_rejected_at: null },
      ],
      aitickets_event_reviews: [
        { id: uuid(70), organization_id: 7, event_id: 10, rating: 5, created_at: iso(-DAY), email: 'x@y.cl', private_comment: 'NO DEBE APARECER' },
        { id: uuid(71), organization_id: 7, event_id: 10, rating: 4, created_at: iso(-2 * DAY), email: 'z@y.cl' },
      ],
      aitickets_api_audit: [
        { id: 1, organization_id: 9, tool: 'set_event_status', channel: 'mcp', ok: true, event_id: 21, summary: 'Publicó "Nueve Show"', created_at: iso(-15 * DAY + 3600000) },
        { id: 2, organization_id: 7, tool: 'update_event', channel: 'rest', ok: true, event_id: 10, summary: 'Editó el evento', created_at: iso(-4 * DAY) },
      ],
      aitickets_admin_audit: [
        { id: 1, created_at: iso(-DAY), tool: 'org_update_event', ok: true, read_only: false, organization_id: 7, summary: 'Editar evento como Productora Siete', reason: 'Pedido por WhatsApp' },
        { id: 2, created_at: iso(-DAY), tool: 'search_orders', ok: true, read_only: true, organization_id: null, summary: 'Buscar órdenes' },
      ],
      aitickets_payment_events: [{ id: 'flow:123456:paid', provider: 'flow', type: 'payment.paid', order_id: O.o6, received_at: iso(-5 * DAY + 60000) }],
      notification_log: [],
    },
  })
})

afterEach(() => {
  delete process.env.SITE_URL
})

const actx = () => ({ supabase: db, origin: SITE, requestUrl: new URL(`${SITE}/api/admin/mcp`), keyKind: 'full', fingerprint: 'abcd1234', ipHash: 'f'.repeat(64) })
const run = async (name, args = {}) => {
  const out = await runAdminTool(getAdminTool(name), args, actx())
  if (!out.ok) throw new Error(`${name}: ${out.code} ${out.message}`)
  return out.result
}

describe('get_platform_overview', () => {
  it('plata y actividad del período sin cortesías, transferencias ni demo; período anterior', async () => {
    const r = await run('get_platform_overview', { preset: '30d' })
    expect(r.money).toMatchObject({
      gross_sales_clp: 10952 + 5476 + 8762,
      aitickets_fee_net_clp: 800 + 400 + 640,
      fee_iva_clp: 152 + 76 + 122,
      flow_cost_clp: 300,
      producer_net_clp: 23000,
      refund_fees_absorbed_clp: 952,
      aitickets_margin_clp: 1840 - 300 - 952,
    })
    expect(r.money.previous.gross_sales_clp).toBe(21904)
    expect(r.activity).toMatchObject({ paid_orders: 3, tickets_sold: 3, courtesy_tickets: 2, events_with_sales: 2, producers_with_sales: 2, new_producers: 2, producers_verified: 1 })
    expect(r.activity).toMatchObject({ visits: 4, unique_visitors: 3, conversion_pct: 100, events_created: 3, events_created_and_published: 1 })
    expect(r.refunds).toMatchObject({ count: 1, total_clp: 10952, fee_absorbed_by_aitickets_clp: 952 })
    expect(r.top_producers[0]).toMatchObject({ organization_id: 7, gross_sales_clp: 10952 + 8762 })
    expect(r.top_events.map((e) => e.event_id)).not.toContain(99)
    expect(r.pending_operations).toEqual({ payouts_requested: 1, accounts_to_verify: 1, refunds_requested: 1, orders_in_review: 1 })
  })
})

describe('visitas contadas en la base (aitickets_admin_visit_counts)', () => {
  it('si la función existe, overview usa sus conteos sin traer las filas de event_visits', async () => {
    const calls = []
    db = createFakeSupabase({
      tables: db.tables,
      rpc: {
        aitickets_admin_visit_counts: (args) => {
          calls.push(args)
          return [{ bucket: 'total', visits: 12345, unique_visitors: 6789 }]
        },
      },
    })
    const r = await run('get_platform_overview', { preset: '30d' })
    expect(r.activity).toMatchObject({ visits: 12345, unique_visitors: 6789 })
    expect(calls[0]).toMatchObject({ p_group: 'total' })
    expect(calls[0].p_event_ids).not.toContain(99) // sin eventos demo
    expect(db.calls.some((c) => c.table === 'event_visits')).toBe(false)
  })
})

describe('get_platform_timeseries', () => {
  it('semanas desde el lunes en hora de Chile', async () => {
    expect(weekStart('2025-03-09')).toBe('2025-03-03') // domingo → lunes anterior
    expect(weekStart('2025-03-10')).toBe('2025-03-10')
    expect(bucketOf('2025-03-31', 'month')).toBe('2025-03')
    const r = await run('get_platform_timeseries', { organization_id: 30, from: '2025-03-03', to: '2025-03-16', granularity: 'week', metrics: ['gross', 'orders', 'tickets'] })
    expect(r.series.map((p) => p.bucket)).toEqual(['2025-03-03', '2025-03-10'])
    // 2025-03-10T02:30Z es el domingo 9 a las 23:30 en Chile: cae en la semana anterior
    expect(r.series[0]).toMatchObject({ gross_sales_clp: 1095, paid_orders: 1, tickets_sold: 1 })
    expect(r.series[1]).toMatchObject({ gross_sales_clp: 2190, paid_orders: 1, tickets_sold: 2 })
  })

  it('signups y visitas por día', async () => {
    const r = await run('get_platform_timeseries', { preset: '30d', metrics: ['signups', 'visits'] })
    expect(r.granularity).toBe('day')
    expect(r.series.reduce((n, p) => n + p.signups, 0)).toBe(2)
    expect(r.series.reduce((n, p) => n + p.visits, 0)).toBe(4)
  })
})

describe('rank_producers', () => {
  it('ranking por ventas del período con crecimiento, reseñas y alertas', async () => {
    const r = await run('rank_producers', { preset: '30d' })
    expect(r.producers.map((p) => p.organization_id)).toEqual([7, 9])
    const siete = r.producers[0]
    expect(siete.period).toMatchObject({ gross_sales_clp: 10952 + 8762, paid_orders: 2, unique_visitors: 2, conversion_pct: 100, refunds: 1 })
    expect(siete.previous_period.gross_sales_clp).toBe(21904)
    expect(siete.growth_pct).toBe(Math.round(((19714 - 21904) / 21904) * 1000) / 10)
    expect(siete.reviews).toEqual({ average: 4.5, count: 2 })
    expect(siete.alerts.join(' ')).toMatch(/Cuenta bancaria/)
    const all = await run('rank_producers', { preset: '30d', include_inactive: true })
    expect(all.producers.map((p) => p.organization_id)).toContain(8)
  })
})

describe('get_producer_funnel', () => {
  it('pasos secuenciales de la cohorte y atascados', async () => {
    const r = await run('get_producer_funnel', {})
    expect(r.cohort.organizations).toBe(2) // 8 y 9 (90 días)
    const step = Object.fromEntries(r.steps.map((s) => [s.step, s]))
    expect(step.registered.organizations).toBe(2)
    expect(step.email_verified.organizations).toBe(1)
    expect(step.email_verified.stuck_examples[0]).toMatchObject({ organization_id: 8, owner_email: 'oscar@ocho.cl' })
    expect(step.first_event_created.organizations).toBe(1)
    expect(step.first_event_published.organizations).toBe(1)
    expect(step.first_sale.organizations).toBe(1)
    expect(step.second_event.organizations).toBe(1)
    expect(step.payout_verified.organizations).toBe(1)
    expect(step.email_verified.conversion_from_previous_pct).toBe(50)
  })
})

describe('soporte', () => {
  it('search_orders por correo (sin distinguir mayúsculas), por n° de Flow y por id de entrada', async () => {
    const byEmail = await run('search_orders', { query: 'juana@correo.cl' })
    expect(byEmail.orders.map((o) => o.order_id).sort()).toEqual([O.o6, O.o8].sort())
    expect(byEmail.orders.find((o) => o.order_id === O.o6)).toMatchObject({ organization: { id: 9, name: 'Nueve Producciones' }, kind: 'sale', flow_order: '123456' })
    const byFlow = await run('search_orders', { query: '123456' })
    expect(byFlow.orders.map((o) => o.order_id)).toEqual([O.o6])
    const byTicket = await run('search_orders', { query: O.t2 })
    expect(byTicket.orders.map((o) => o.order_id)).toEqual([O.o1])
    expect(byTicket.orders[0].tickets).toMatchObject({ issued: 2, active: 2, checked_in: 1 })
    const byName = await run('search_orders', { query: 'Juana Soto' })
    expect(byName.orders.map((o) => o.order_id)).toContain(O.o6)
    expect(JSON.stringify(byTicket)).not.toContain('QR-SECRET')
  })

  it('get_order_timeline: pagada sin correo → reenviar; en review → revisión manual', async () => {
    const paid = await run('get_order_timeline', { order_id: O.o6 })
    expect(paid.verdict).toMatch(/no salió/)
    expect(paid.next_action).toMatch(/org_resend_tickets/)
    expect(paid.payment_events).toHaveLength(1)
    expect(paid.timeline[0].what).toMatch(/Orden creada/)
    const review = await run('get_order_timeline', { order_id: O.o7 })
    expect(review.verdict).toMatch(/revisión manual/)
    const withRefund = await run('get_order_timeline', { order_id: O.o1 })
    expect(withRefund.next_action).toMatch(/aitickets_set_refund_status/)
    expect(JSON.stringify(withRefund)).not.toContain('QR-SECRET')
  })

  it('orderVerdict: pendiente con reserva vigente y expirada con flowOrder', () => {
    const base = { emailSummary: null, refunds: [], activeTickets: 0 }
    expect(orderVerdict({ id: 'x', status: 'pending', hold_expires_at: iso(5 * 60000) }, base).verdict).toMatch(/está en el pago/)
    expect(orderVerdict({ id: 'x', status: 'expired', payment_external_id: '999' }, base).next_action).toMatch(/999/)
  })

  it('search_users: datos del usuario y su organización, sin el usuario de servicio', async () => {
    const r = await run('search_users', { query: 'ana' })
    expect(r.users[0]).toMatchObject({ email: 'ana@siete.cl', role: 'producer', logins: 12, organization: { id: 7, email_verified: true } })
    expect((await run('search_users', { query: 'Soporte' })).users).toHaveLength(0)
  })
})

describe('get_event_analytics', () => {
  it('analítica del panel + check-in + reseñas sin datos personales', async () => {
    const r = await run('get_event_analytics', { event_id: 10 })
    expect(r.organization).toEqual({ id: 7, name: 'Productora Siete' })
    expect(r.kpis).toMatchObject({ paid_orders: 2, courtesy_tickets: 2, visits: 4, unique_visitors: 3 })
    expect(r.checkin).toMatchObject({ issued_tickets: 2, checked_in: 1 })
    expect(r.reviews).toMatchObject({ count: 2, average: 4.5 })
    expect(JSON.stringify(r)).not.toContain('NO DEBE APARECER')
    const demo = await runAdminTool(getAdminTool('get_event_analytics'), { event_id: 99 }, actx())
    expect(demo).toMatchObject({ ok: false, code: 'invalid_input' })
  })
})

describe('list_platform_activity', () => {
  it('mezcla fuentes, ordena del más reciente y filtra por tipo y organización', async () => {
    const r = await run('list_platform_activity', { since: iso(-30 * DAY) })
    const ats = r.entries.map((e) => e.at)
    expect([...ats].sort().reverse()).toEqual(ats)
    const types = new Set(r.entries.map((e) => e.type))
    for (const t of ['signup', 'event_created', 'event_published', 'api_action', 'payout', 'refund', 'review', 'admin_action', 'first_sale']) expect(types).toContain(t)
    // Primera venta solo de Nueve (Siete ya vendía antes)
    const first = r.entries.filter((e) => e.type === 'first_sale')
    expect(first.map((e) => e.organization.id)).toEqual([9])
    // Solo escrituras del admin y sin comentarios de reseñas
    expect(r.entries.filter((e) => e.type === 'admin_action')).toHaveLength(1)
    expect(JSON.stringify(r)).not.toContain('NO DEBE APARECER')
    expect(r.entries.some((e) => e.links?.event_id === 99)).toBe(false)

    const signups = await run('list_platform_activity', { since: iso(-30 * DAY), types: ['signup'] })
    expect(signups.entries.map((e) => e.organization.id)).toEqual([8, 9])
    const onlyNine = await run('list_platform_activity', { since: iso(-30 * DAY), organization_id: 9 })
    expect(onlyNine.entries.every((e) => e.organization?.id === 9)).toBe(true)
  })
})
