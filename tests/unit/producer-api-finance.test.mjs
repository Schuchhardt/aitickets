// API de productores — finanzas: cuenta de pago, comisiones, saldo y retiros (src/lib/producer-api/tools/finance.ts + ledger.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const mocks = vi.hoisted(() => ({ notifySlack: vi.fn(async () => {}) }))
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/pages/api/_lib/server-utils', async (orig) => ({ ...(await orig()), notifySlack: mocks.notifySlack }))

const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { financeTools } = await import('../../src/lib/producer-api/tools/finance.ts')
const { computeOrgLedger, addBusinessDays, lastFunctionEnd } = await import('../../src/lib/producer-api/ledger.ts')

const tool = (name) => financeTools.find((t) => t.name === name)
const DAY = 86400000
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString()

function seed({ account = {}, tables = {} } = {}) {
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Mi Productora', email_verified_at: '2026-01-01T00:00:00Z', terms_accepted_at: '2026-01-01T00:00:00Z' }],
      events: [
        { id: 10, name: 'Pasado', status: 'published', organization_id: 7, end_date: iso(-5 * DAY), fee_absorbed: false },
        { id: 11, name: 'Futuro', status: 'published', organization_id: 7, end_date: iso(20 * DAY), fee_absorbed: true },
        { id: 12, name: 'Cancelado', status: 'draft', organization_id: 7, end_date: iso(-10 * DAY), cancelled_at: iso(-11 * DAY) },
        { id: 20, name: 'Ajeno', status: 'published', organization_id: 8, end_date: iso(-5 * DAY) },
      ],
      event_dates: [],
      event_orders: [
        { id: 'o1', event_id: 10, status: 'paid', amount: 50000, ticket_qty: 5, ticket_fee: 4000, service_fee_tax: 760, created_at: iso(-30 * DAY) },
        { id: 'o2', event_id: 10, status: 'paid', amount: 20000, ticket_qty: 2, ticket_fee: 1600, service_fee_tax: 304, discount_amount: 5000, created_at: iso(-29 * DAY) },
        { id: 'o3', event_id: 10, status: 'refunded', amount: 10000, ticket_qty: 1, ticket_fee: 800, created_at: iso(-28 * DAY) },
        { id: 'o4', event_id: 10, status: 'review', amount: 7000, ticket_qty: 1, created_at: iso(-27 * DAY) },
        { id: 'o5', event_id: 11, status: 'paid', amount: 9048, ticket_qty: 1, ticket_fee: 800, service_fee_tax: 152, fee_absorbed: true, created_at: iso(-1 * DAY) },
        { id: 'o6', event_id: 12, status: 'paid', amount: 15000, ticket_qty: 1, created_at: iso(-40 * DAY) },
        { id: 'o9', event_id: 20, status: 'paid', amount: 999999, ticket_qty: 1, created_at: iso(-40 * DAY) },
      ],
      aitickets_refunds: [
        { id: 'r1', organization_id: 7, event_id: 10, order_id: 'o2', kind: 'partial', ticket_amount: 10000, fee_amount: 0, total_amount: 10000, status: 'requested', created_at: iso(-2 * DAY) },
        { id: 'r2', organization_id: 7, event_id: 10, order_id: 'o3', kind: 'full', ticket_amount: 10000, fee_amount: 800, total_amount: 10800, status: 'completed', created_at: iso(-3 * DAY) },
      ],
      event_withdrawals: [{ id: 1, event_id: 10, amount: 15000, status: 'paid', paid_at: iso(-4 * DAY), created_at: iso(-4 * DAY), payout_id: null }],
      organization_payout_accounts: [
        {
          organization_id: 7, legal_name: 'Mi Productora SpA', legal_rut: '76.123.456-7', bank_name: 'BancoEstado', bank_account_type: 'Cuenta Corriente',
          bank_account_number: '000123456789', bank_account_holder: 'Ana Pérez', bank_account_rut: '12.345.678-9',
          verified_at: iso(-10 * DAY), verified_by: 'ops', bank_changed_at: iso(-10 * DAY), removed_at: null, ...account,
        },
      ],
      aitickets_payouts: [],
      aitickets_api_confirmations: [],
      aitickets_api_idempotency: [],
      aitickets_api_audit: [],
      ...tables,
    },
  })
}

const ctx = (role = 'producer', scopes = ['read', 'finance']) => ({
  supabase: db,
  actor: { keyId: 'k1', userId: 1, orgId: 7, role, name: 'Ana', email: 'ana@prod.cl', scopes, eventIds: null },
  origin: 'https://aitickets.cl',
  requestUrl: new URL('https://aitickets.cl/api/mcp'),
  channel: 'mcp',
})

const call = (name, args = {}, c = ctx()) => runTool(tool(name), args, c)

beforeEach(() => {
  seed()
  mocks.notifySlack.mockClear()
})

describe('ledger', () => {
  it('saldo: disponible tras 48 h, pendiente si no termina, cancelado retenido; sin doble resta de reembolsos totales', async () => {
    const l = await computeOrgLedger(db, 7)
    const ev10 = l.events.find((e) => e.event_id === 10)
    // 50000 + 20000 pagadas − 10000 reembolso parcial (o2 sigue pagada) − 15000 retirado; o3 'refunded' no suma ni resta
    expect(ev10.sales_net).toBe(70000)
    expect(ev10.partial_refunds).toBe(10000)
    expect(ev10.available).toBe(45000)
    expect(ev10.retained).toBe(7000) // orden en revisión
    expect(l.events.find((e) => e.event_id === 11).pending).toBe(9048)
    expect(l.events.find((e) => e.event_id === 12).retained).toBe(15000)
    expect(l.events.some((e) => e.event_id === 20)).toBe(false)
    expect(l.totals.available).toBe(45000)
  })

  it('un reembolso posterior al retiro deja saldo negativo que se descuenta', async () => {
    db.tables.event_withdrawals.push({ id: 2, event_id: 10, amount: 50000, status: 'requested' })
    const l = await computeOrgLedger(db, 7)
    expect(l.events.find((e) => e.event_id === 10).net_due).toBe(-5000)
    expect(l.totals.negative_balance).toBe(5000)
    expect(l.totals.available).toBe(0)
  })

  it('fin de función con event_dates en hora de Chile y funciones pasada la medianoche', () => {
    const end = lastFunctionEnd({ end_date: null }, [{ date: '2026-10-10', start_time: '22:00', end_time: '03:00' }])
    expect(end.toISOString()).toBe('2026-10-11T06:00:00.000Z')
  })

  it('días hábiles', () => {
    expect(addBusinessDays(new Date('2026-10-09T15:00:00Z'), 2)).toBe('2026-10-13') // viernes → martes
  })
})

describe('cuenta de pago', () => {
  it('get_payout_account nunca expone el número ni el RUT completos', async () => {
    const out = await call('get_payout_account')
    expect(out.ok).toBe(true)
    const text = JSON.stringify(out.result)
    expect(text).not.toContain('000123456789')
    expect(text).not.toContain('12.345.678-9')
    expect(out.result.account).toMatchObject({ status: 'verified', account_last4: '6789', bank: 'BancoEstado', can_request_payout: true })
  })

  it('create_payout_account_link apunta al panel con sesión', async () => {
    const out = await call('create_payout_account_link')
    expect(out.result.url).toBe('https://aitickets.cl/dashboard/settings#datos-bancarios')
  })

  it('verificación: cuenta cambiada hace poco bloquea retiros', async () => {
    seed({ account: { verified_at: null, verified_by: null, bank_changed_at: iso(-1 * 3600000) } })
    const out = await call('get_verification_status')
    expect(out.result.can_request_payout).toBe(false)
    expect(out.result.missing.map((m) => m.item)).toEqual(expect.arrayContaining(['bank_verified', 'bank_change_hold']))
  })

  it('remove_payout_account pide confirmación y se niega con retiros en curso', async () => {
    const first = await call('remove_payout_account')
    expect(first.result.status).toBe('confirmation_required')
    expect(db.tables.organization_payout_accounts[0].bank_account_number).toBe('000123456789')
    const done = await call('remove_payout_account', { confirmation_token: first.result.confirmation_token })
    expect(done.ok).toBe(true)
    expect(db.tables.organization_payout_accounts[0].bank_account_number).toBeNull()

    seed({ tables: { aitickets_payouts: [{ id: 'p1', organization_id: 7, amount: 1000, status: 'requested' }] } })
    const blocked = await call('remove_payout_account')
    expect(blocked).toMatchObject({ ok: false, code: 'conflict' })
  })
})

describe('comisiones', () => {
  it('quote_fees en ambos modos (8% + IVA)', async () => {
    const out = await call('quote_fees', { price: 10000, quantity: 2 })
    expect(out.result.buyer_pays_fee).toMatchObject({ buyer_pays: 21904, producer_receives: 20000 })
    expect(out.result.producer_absorbs_fee).toMatchObject({ buyer_pays: 20000, producer_receives: 18096 })
  })

  it('quote_fees usa el modo del evento', async () => {
    const out = await call('quote_fees', { price: 10000, event_id: 11 })
    expect(out.result.selected_mode).toBe('producer_absorbs_fee')
  })

  it('set_fee_absorption exige confirmación y permiso finance.manage', async () => {
    const editor = await call('set_fee_absorption', { event_id: 10, absorbed: true }, ctx('editor'))
    expect(editor).toMatchObject({ ok: false, code: 'forbidden' })
    const first = await call('set_fee_absorption', { event_id: 10, absorbed: true })
    expect(db.tables.events.find((e) => e.id === 10).fee_absorbed).toBe(false)
    const done = await call('set_fee_absorption', { event_id: 10, absorbed: true, confirmation_token: first.result.confirmation_token })
    expect(done.ok).toBe(true)
    expect(db.tables.events.find((e) => e.id === 10).fee_absorbed).toBe(true)
  })

  it('el administrador ve pero no mueve plata; finanzas sí', async () => {
    expect((await call('get_balance', {}, ctx('admin'))).ok).toBe(true)
    expect(await call('request_payout', {}, ctx('admin'))).toMatchObject({ ok: false, code: 'forbidden' })
    expect((await call('request_payout', {}, ctx('finance'))).result.status).toBe('confirmation_required')
    expect(await call('get_balance', {}, ctx('producer', ['read']))).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('saldo y retiros', () => {
  it('get_balance y movimientos', async () => {
    const bal = await call('get_balance')
    expect(bal.result).toMatchObject({ available: 45000, pending: 9048, retained: 22000 })
    const tx = await call('list_balance_transactions', { event_id: 10 })
    const amounts = tx.result.transactions.map((t) => [t.type, t.amount])
    expect(amounts).toEqual(expect.arrayContaining([['sale', 50000], ['refund', -10000], ['payout', -15000]]))
    // o3 tiene fila de reembolso: no se duplica
    expect(tx.result.transactions.filter((t) => t.order_id === 'o3' && t.type === 'refund')).toHaveLength(1)
  })

  it('request_payout: confirmación, reparto por evento, anulación', async () => {
    const first = await call('request_payout', { amount: 30000 })
    expect(first.result.status).toBe('confirmation_required')
    expect(db.tables.aitickets_payouts).toHaveLength(0)
    const tooMuch = await call('request_payout', { amount: 999999 })
    expect(tooMuch).toMatchObject({ ok: false, code: 'conflict' })

    const done = await call('request_payout', { amount: 30000, confirmation_token: first.result.confirmation_token })
    expect(done.ok).toBe(true)
    expect(done.result).toMatchObject({ status: 'requested', amount: 30000, account_last4: '6789' })
    const rows = db.tables.event_withdrawals.filter((w) => w.payout_id === done.result.payout_id)
    // El reparto por evento guarda solo datos enmascarados (mismo formato que aitickets_mask_* en la BD)
    expect(rows).toEqual([
      expect.objectContaining({ event_id: 10, amount: 30000, status: 'requested', account_number: '•••• 6789', account_holder_name: 'A** P****', account_holder_rut: '••••678-9' }),
    ])
    expect(JSON.stringify(db.tables.event_withdrawals)).not.toContain('000123456789')
    // El aviso a AI Tickets trae el SQL para registrar la transferencia
    const slack = mocks.notifySlack.mock.calls.map((c) => c[0]).join('\n')
    expect(slack).toContain(`aitickets_set_payout_status('${done.result.payout_id}', 'paid'`)
    expect(slack).toContain(`aitickets_set_payout_status('${done.result.payout_id}', 'failed'`)
    expect(slack).toContain('from organization_payout_accounts where organization_id = 7')
    expect(slack).not.toContain('000123456789')
    expect((await call('get_balance')).result.available).toBe(15000)

    // el mismo token no ejecuta dos veces
    const again = await call('request_payout', { amount: 30000, confirmation_token: first.result.confirmation_token })
    expect(db.tables.aitickets_payouts).toHaveLength(1)
    expect(again.ok === false || again.result.idempotent_replay === true).toBe(true)

    const cancel = await call('cancel_payout', { payout_id: done.result.payout_id })
    expect(cancel.result.status).toBe('cancelled')
    expect(rows[0].status).toBe('cancelled')
    expect((await call('get_balance')).result.available).toBe(45000)
  })

  it('cuenta rechazada por AI Tickets: el productor ve el motivo y no puede retirar', async () => {
    seed({ account: { verified_at: null, verified_by: 'ops', verification_rejected_at: iso(-1 * DAY), verification_notes: 'El RUT del titular no coincide con la cartola' } })
    const acc = await call('get_payout_account')
    expect(acc.result.account).toMatchObject({ status: 'rejected', rejection_reason: 'El RUT del titular no coincide con la cartola', can_request_payout: false })
    const v = await call('get_verification_status')
    expect(v.result.can_request_payout).toBe(false)
    expect(v.result.missing).toEqual(
      expect.arrayContaining([expect.objectContaining({ item: 'bank_verified', rejected: true, rejection_reason: 'El RUT del titular no coincide con la cartola', blocks_payouts: true })]),
    )
    expect(v.result.missing.find((m) => m.item === 'bank_verified').label).toMatch(/rechazó la cuenta: El RUT del titular/)
    const payout = await call('request_payout')
    expect(payout).toMatchObject({ ok: false, code: 'conflict' })
    expect(payout.message).toMatch(/rechazó la cuenta bancaria: El RUT del titular/)
  })

  it('sin columnas de rechazo (BD sin migrar) la cuenta sigue funcionando', async () => {
    seed()
    db.failOn('organization_payout_accounts', 'select', { code: '42703', message: 'column verification_rejected_at does not exist' })
    const v = await call('get_verification_status')
    expect(v.ok).toBe(true)
    expect(v.result.can_request_payout).toBe(true)
  })

  it('request_payout bloqueado sin verificación o en la espera de 72 h', async () => {
    seed({ account: { verified_at: iso(-1 * DAY), bank_changed_at: iso(-2 * 3600000) } })
    expect(await call('request_payout')).toMatchObject({ ok: false, code: 'conflict' })
    seed({ account: { verified_at: null } })
    expect(await call('request_payout')).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('get_settlement_report cuadra', async () => {
    const out = await call('get_settlement_report', { event_id: 10 })
    const r = out.result.events[0]
    expect(r.gross_ticket_sales).toBe(50000 + 25000 + 10000)
    expect(r.discounts).toBe(5000)
    expect(r.refunds_to_buyers).toBe(20000)
    expect(r.producer_net).toBe(60000)
    expect(r.pending_payment).toBe(45000)
    const absorbed = await call('get_settlement_report', { event_id: 11 })
    expect(absorbed.result.events[0]).toMatchObject({ gross_ticket_sales: 10000, service_fee_absorbed_by_producer: 952, producer_net: 9048 })
  })

  it('aislamiento: no ve retiros ni eventos de otra organización', async () => {
    db.tables.aitickets_payouts.push({ id: '00000000-0000-0000-0000-000000000009', organization_id: 8, amount: 5, status: 'requested' })
    expect(await call('get_payout', { payout_id: '00000000-0000-0000-0000-000000000009' })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await call('get_settlement_report', { event_id: 20 })).toMatchObject({ ok: false, code: 'not_found' })
  })
})

describe('liberación por función', () => {
  // Evento 30 con dos funciones: la 1ª terminó hace 3 días (liberada), la 2ª es en 10 días.
  const chileDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(Date.now() + ms))
  const seedFunctions = (extra = {}) =>
    seed({
      tables: {
        events: [{ id: 30, name: 'Stand-up semanal', status: 'published', organization_id: 7, end_date: null, fee_absorbed: false }],
        event_dates: [
          { id: 301, event_id: 30, date: chileDate(-3 * DAY), start_time: '21:00', end_time: '23:00' },
          { id: 302, event_id: 30, date: chileDate(10 * DAY), start_time: '21:00', end_time: '23:00' },
        ],
        event_tickets: [
          { id: 1, event_id: 30, event_date_id: 301 },
          { id: 2, event_id: 30, event_date_id: 302 },
          { id: 3, event_id: 30, event_date_id: null }, // abono: válido para cualquier función
        ],
        event_orders: [
          { id: 'a', event_id: 30, status: 'paid', amount: 10000, ticket_qty: 1 },
          { id: 'b', event_id: 30, status: 'paid', amount: 20000, ticket_qty: 2 },
          { id: 'c', event_id: 30, status: 'paid', amount: 30000, ticket_qty: 1 },
          { id: 'd', event_id: 30, status: 'paid', amount: 5000, ticket_qty: 2 }, // entradas de ambas funciones
        ],
        event_attendees: [
          { event_id: 30, event_order_id: 'a', event_ticket_id: 1 },
          { event_id: 30, event_order_id: 'b', event_ticket_id: 2 },
          { event_id: 30, event_order_id: 'b', event_ticket_id: 2 },
          { event_id: 30, event_order_id: 'c', event_ticket_id: 3 },
          { event_id: 30, event_order_id: 'd', event_ticket_id: 1 },
          { event_id: 30, event_order_id: 'd', event_ticket_id: 2 },
          { event_id: 30, event_order_id: null, event_ticket_id: 1, is_complimentary: true }, // cortesía: no suma
        ],
        aitickets_refunds: [],
        event_withdrawals: [],
        ...extra,
      },
    })

  it('solo se libera lo vendido para funciones que terminaron hace ≥ 48 h', async () => {
    seedFunctions()
    const l = (await computeOrgLedger(db, 7)).events[0]
    expect(l.sales_net).toBe(65000)
    expect(l.released_sales).toBe(10000) // solo la orden 'a'; abono y mixta esperan la última función
    expect(l.available).toBe(10000)
    expect(l.pending).toBe(55000)
    expect(l.released).toBe(false)
    expect(l.next_release_at).toBe(l.functions[1].releases_at)
    expect(l.functions.map((f) => [f.event_date_id, f.sales_net, f.released])).toEqual([
      [301, 10000, true],
      [302, 20000, false],
    ])
  })

  it('reembolsos de órdenes liberadas y retiros se descuentan de lo liberado', async () => {
    seedFunctions({
      aitickets_refunds: [{ id: 'r', organization_id: 7, event_id: 30, order_id: 'a', ticket_amount: 4000, status: 'completed' }],
      event_withdrawals: [{ id: 9, event_id: 30, amount: 5000, status: 'paid' }],
    })
    const l = (await computeOrgLedger(db, 7)).events[0]
    expect(l.released_due).toBe(1000) // 10000 − 4000 − 5000
    expect(l.available).toBe(1000)
    expect(l.pending).toBe(55000)
  })

  it('un evento cancelado no libera ninguna función', async () => {
    seedFunctions()
    db.tables.events[0].cancelled_at = iso(-1 * DAY)
    const l = (await computeOrgLedger(db, 7)).events[0]
    expect(l.available).toBe(0)
    expect(l.retained).toBe(65000)
  })

  it('request_payout desde el panel (sin llave) retira solo lo liberado', async () => {
    seedFunctions()
    const panel = { ...ctx('producer', ['read', 'write', 'publish', 'attendees', 'finance', 'team']), channel: 'dashboard' }
    panel.actor = { ...panel.actor, keyId: null }
    const first = await call('request_payout', {}, panel)
    expect(first.result.status).toBe('confirmation_required')
    expect(first.result.details.amount).toBe(10000)
    const done = await call('request_payout', { confirmation_token: first.result.confirmation_token, idempotency_key: 'panel-key-1' }, panel)
    expect(done.ok).toBe(true)
    expect(done.result.amount).toBe(10000)
    expect(db.tables.aitickets_payouts[0]).toMatchObject({ requested_via: 'dashboard', amount: 10000 })
    const again = await call('request_payout', {}, panel)
    expect(again.ok).toBe(false) // ya no queda saldo liberado
  })

  it('un confirmation_token del panel no sirve con una llave de API', async () => {
    seedFunctions()
    const panel = { ...ctx(), channel: 'dashboard' }
    panel.actor = { ...panel.actor, keyId: null }
    const first = await call('request_payout', {}, panel)
    const withKey = await call('request_payout', { confirmation_token: first.result.confirmation_token }, ctx())
    expect(withKey).toMatchObject({ ok: false, code: 'invalid_input' })
  })
})
