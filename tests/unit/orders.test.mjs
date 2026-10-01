// Cumplimiento de órdenes (netlify/lib/orders.mjs) con un Supabase en memoria.
// Se mockean emisión de entradas, correo y Slack: solo se prueba la máquina de estados del pago.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const mocks = vi.hoisted(() => ({
  ensureOrderAttendees: vi.fn(async () => ({ created: 0 })),
  getSoldCounts: vi.fn(async () => new Map()),
  sendOrderTicketsEmail: vi.fn(async () => ({ ok: true })),
  notifySlack: vi.fn(async () => {}),
}))

vi.mock('../../netlify/lib/tickets.mjs', () => ({ ensureOrderAttendees: mocks.ensureOrderAttendees, getSoldCounts: mocks.getSoldCounts }))
vi.mock('../../netlify/lib/tickets-email.mjs', () => ({ sendOrderTicketsEmail: mocks.sendOrderTicketsEmail }))
vi.mock('../../netlify/lib/slack.mjs', () => ({ notifySlack: mocks.notifySlack }))

import {
  CLAIMABLE_STATUSES,
  confirmPaidOrder,
  expectedPaymentAmounts,
  findDiscountOveruse,
  findOversell,
  hasLiveHold,
  isMissingSchemaError,
  markOrderFailed,
  recordPaymentEvent,
} from '../../netlify/lib/orders.mjs'

const ORDER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

function order(overrides = {}) {
  return {
    id: ORDER_ID,
    status: 'pending',
    event_id: 7,
    attendee_id: 3,
    amount: 30000,
    ticket_fee: 3000,
    total_payment: 33000,
    ticket_details: [{ id: 1, quantity: 2 }],
    payment_external_id: null,
    processing_started_at: null,
    payment_provider: 'flow',
    currency: 'CLP',
    ...overrides,
  }
}

beforeEach(() => {
  mocks.ensureOrderAttendees.mockClear()
  mocks.sendOrderTicketsEmail.mockReset()
  mocks.sendOrderTicketsEmail.mockResolvedValue({ ok: true })
  mocks.notifySlack.mockClear()
})

describe('confirmPaidOrder', () => {
  it('id inválido u orden inexistente → not_found (404)', async () => {
    const db = createFakeSupabase({ tables: { event_orders: [] } })
    expect(await confirmPaidOrder(db, 'no-es-uuid', { provider: 'flow', amount: 1 })).toMatchObject({ status: 'not_found', httpStatus: 404 })
    expect(await confirmPaidOrder(db, ORDER_ID, { provider: 'flow', amount: 1 })).toMatchObject({ status: 'not_found', httpStatus: 404 })
  })

  it('orden ya pagada → already_paid, sin volver a reclamarla (solo asegura entradas y correo)', async () => {
    const db = createFakeSupabase({ tables: { event_orders: [order({ status: 'paid', payment_external_id: '999' })] } })
    const res = await confirmPaidOrder(db, ORDER_ID, { provider: 'flow', amount: 33000, externalId: '999' })
    expect(res).toMatchObject({ status: 'already_paid', httpStatus: 200 })
    expect(db.calls.filter((c) => c.op === 'update')).toHaveLength(0)
    expect(mocks.ensureOrderAttendees).toHaveBeenCalledTimes(1)
    expect(mocks.sendOrderTicketsEmail).toHaveBeenCalledWith(ORDER_ID)
    expect(db.tables.event_orders[0].status).toBe('paid')
  })

  it('orden ya pagada con correo fallido → retry 503 para que el proveedor reintente', async () => {
    mocks.sendOrderTicketsEmail.mockResolvedValue({ ok: false, status: 500 })
    const db = createFakeSupabase({ tables: { event_orders: [order({ status: 'paid' })] } })
    expect(await confirmPaidOrder(db, ORDER_ID, { provider: 'flow', amount: 33000 })).toMatchObject({ status: 'retry', httpStatus: 503 })
  })

  it('monto distinto al esperado → review, Slack y sin emitir entradas', async () => {
    const db = createFakeSupabase({ tables: { event_orders: [order()] } })
    const res = await confirmPaidOrder(db, ORDER_ID, { provider: 'flow', amount: 1000, externalId: '555' })
    expect(res).toMatchObject({ status: 'review', httpStatus: 200 })
    expect(db.tables.event_orders[0]).toMatchObject({ status: 'review', total_payment: 1000, payment_external_id: '555' })
    expect(mocks.notifySlack).toHaveBeenCalledWith(expect.stringMatching(/revisión/))
    expect(mocks.ensureOrderAttendees).not.toHaveBeenCalled()
    expect(mocks.sendOrderTicketsEmail).not.toHaveBeenCalled()
  })

  it('con service_fee_tax: un pago sin el IVA del cargo no coincide → review', async () => {
    const db = createFakeSupabase({ tables: { event_orders: [order({ service_fee_tax: 570 })] } })
    const res = await confirmPaidOrder(db, ORDER_ID, { provider: 'flow', amount: 33000, externalId: '556' })
    expect(res).toMatchObject({ status: 'review' })
    expect(mocks.notifySlack).toHaveBeenCalledWith(expect.stringMatching(/esperado 33570/))
    expect(mocks.ensureOrderAttendees).not.toHaveBeenCalled()
  })

  it('moneda distinta → review', async () => {
    const db = createFakeSupabase({ tables: { event_orders: [order({ payment_provider: 'flow' })] } })
    const res = await confirmPaidOrder(db, ORDER_ID, { provider: 'flow', amount: 33000, currency: 'usd' })
    expect(res.status).toBe('review')
    expect(db.tables.event_orders[0].status).toBe('review')
  })

  it('pago de un proveedor distinto al de la orden → review', async () => {
    const db = createFakeSupabase({ tables: { event_orders: [order({ payment_provider: 'free' })] } })
    expect((await confirmPaidOrder(db, ORDER_ID, { provider: 'flow', amount: 33000, currency: 'clp' })).status).toBe('review')
  })

  it('referencia de Flow distinta a la guardada → review', async () => {
    const db = createFakeSupabase({ tables: { event_orders: [order({ payment_provider: 'flow', payment_external_id: '556' })] } })
    const res = await confirmPaidOrder(db, ORDER_ID, { provider: 'flow', amount: 33000, currency: 'CLP', externalId: '557' })
    expect(res.status).toBe('review')
  })

  it('una orden en review no se toca', async () => {
    const db = createFakeSupabase({ tables: { event_orders: [order({ status: 'review' })] } })
    expect(await confirmPaidOrder(db, ORDER_ID, { provider: 'flow', amount: 33000 })).toMatchObject({ status: 'review' })
    expect(db.calls.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('un pago sobre una orden reembolsada queda en review y avisa a Slack', async () => {
    const db = createFakeSupabase({ tables: { event_orders: [order({ status: 'refunded' })] } })
    expect((await confirmPaidOrder(db, ORDER_ID, { provider: 'flow', amount: 33000 })).status).toBe('review')
    expect(mocks.notifySlack).toHaveBeenCalledWith(expect.stringMatching(/reembolsada/))
    expect(db.tables.event_orders[0].status).toBe('refunded')
  })
})

describe('findOversell', () => {
  const tickets = [{ id: 1, event_id: 7, ticket_name: 'General', total_quantity: 100 }]

  it('no cuenta dos veces las entradas ya emitidas de la propia orden (reclamo de un processing abandonado)', async () => {
    // 98 de otros + 2 de esta orden ya insertadas por un intento anterior = 100 emitidas
    mocks.getSoldCounts.mockResolvedValueOnce(new Map([[1, 100]]))
    const db = createFakeSupabase({
      tables: {
        event_tickets: tickets,
        event_attendees: [
          { id: 1, event_order_id: ORDER_ID, event_ticket_id: 1, status: 'active' },
          { id: 2, event_order_id: ORDER_ID, event_ticket_id: 1, status: null },
        ],
      },
    })
    expect(await findOversell(db, order({ status: 'processing' }))).toBeNull()
    expect(mocks.getSoldCounts).toHaveBeenLastCalledWith(db, 7, [1], { includePending: false })
  })

  it('sobreventa real sigue detectándose', async () => {
    mocks.getSoldCounts.mockResolvedValueOnce(new Map([[1, 99]]))
    const db = createFakeSupabase({ tables: { event_tickets: tickets, event_attendees: [] } })
    expect(await findOversell(db, order({ status: 'processing' }))).toMatch(/General: 99 emitidas \+ 2 > 100/)
  })

  it('pago tardío: cuenta las reservas vigentes de otros y descuenta la propia orden en processing', async () => {
    // 96 emitidas; pending = 2 (reserva de otro comprador) + 2 (esta orden, ya en processing) = 100
    mocks.getSoldCounts.mockResolvedValueOnce(new Map([[1, 100]]))
    const db = createFakeSupabase({ tables: { event_tickets: tickets, event_attendees: [] } })
    expect(await findOversell(db, order({ status: 'processing' }), { includeHolds: true })).toBeNull()
    expect(mocks.getSoldCounts).toHaveBeenLastCalledWith(db, 7, [1], { includePending: true })

    // 98 emitidas + 2 reservadas por otro + 2 propias: el tardío no cabe
    mocks.getSoldCounts.mockResolvedValueOnce(new Map([[1, 102]]))
    expect(await findOversell(db, order({ status: 'processing' }), { includeHolds: true })).toMatch(/100 emitidas\/reservadas \+ 2 > 100/)
  })
})

describe('findDiscountOveruse (pago tardío con código)', () => {
  const CODE_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
  const setup = ({ code = {}, usage = { uses: 1, buyer_uses: 1 }, orderRow = {} } = {}) =>
    createFakeSupabase({
      tables: {
        event_orders: [order({ status: 'processing', discount_code_id: CODE_ID, buyer_email: 'Ana@Mail.cl', ...orderRow })],
        aitickets_discount_codes: [{ id: CODE_ID, code: 'VERANO10', max_uses: 10, per_buyer_limit: 1, ...code }],
      },
      rpc: { aitickets_discount_code_usage: () => [usage] },
    })

  it('sin código en la orden → null, sin consultar usos', async () => {
    const db = setup({ orderRow: { discount_code_id: null } })
    expect(await findDiscountOveruse(db, ORDER_ID)).toBeNull()
    expect(db.calls.some((c) => c.op === 'rpc')).toBe(false)
  })

  it('dentro de los límites (contando esta orden) → null', async () => {
    const db = setup({ usage: { uses: 10, buyer_uses: 1 } })
    expect(await findDiscountOveruse(db, ORDER_ID)).toBeNull()
    const rpc = db.calls.find((c) => c.op === 'rpc')
    expect(rpc.values).toEqual({ name: 'aitickets_discount_code_usage', args: { p_code_id: CODE_ID, p_email: 'Ana@Mail.cl' } })
  })

  it('el uso liberado lo tomó otro comprador → supera max_uses', async () => {
    const db = setup({ usage: { uses: 11, buyer_uses: 1 } })
    expect(await findDiscountOveruse(db, ORDER_ID)).toMatch(/VERANO10: 11 usos > máximo 10/)
  })

  it('el mismo comprador volvió a usarlo → supera per_buyer_limit', async () => {
    const db = setup({ usage: { uses: 2, buyer_uses: 2 } })
    expect(await findDiscountOveruse(db, ORDER_ID)).toMatch(/2 usos del comprador > límite 1/)
  })

  it('código sin límites → null', async () => {
    const db = setup({ code: { max_uses: null, per_buyer_limit: null }, usage: { uses: 500, buyer_uses: 9 } })
    expect(await findDiscountOveruse(db, ORDER_ID)).toBeNull()
  })
})

describe('hasLiveHold', () => {
  const now = Date.parse('2026-09-26T12:00:00Z')
  it('pending con hold_expires_at futuro → vigente; vencido u otro estado → no', () => {
    expect(hasLiveHold(order({ hold_expires_at: '2026-09-26T12:10:00Z' }), now)).toBe(true)
    expect(hasLiveHold(order({ hold_expires_at: '2026-09-26T11:59:00Z' }), now)).toBe(false)
    expect(hasLiveHold(order({ status: 'expired', hold_expires_at: '2026-09-26T12:10:00Z' }), now)).toBe(false)
    expect(hasLiveHold(order({ status: 'processing', hold_expires_at: '2026-09-26T12:10:00Z' }), now)).toBe(false)
  })
  it('sin hold_expires_at usa created_at + 15 min', () => {
    expect(hasLiveHold(order({ created_at: '2026-09-26T11:50:00Z' }), now)).toBe(true)
    expect(hasLiveHold(order({ created_at: '2026-09-26T11:40:00Z' }), now)).toBe(false)
    expect(hasLiveHold(order(), now)).toBe(false)
  })
})

describe('otros helpers de órdenes', () => {
  it('CLAIMABLE_STATUSES permite cumplir pagos tardíos sobre órdenes expiradas', () => {
    expect(CLAIMABLE_STATUSES).toEqual(['pending', 'failed', 'rejected', 'cancelled', 'expired'])
  })

  it('markOrderFailed solo transiciona desde pending por defecto', async () => {
    const PAID_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
    const db = createFakeSupabase({ tables: { event_orders: [order(), order({ id: PAID_ID, status: 'paid' })] } })
    expect(await markOrderFailed(db, ORDER_ID, 'rejected')).toBe(true)
    expect(db.tables.event_orders[0].status).toBe('rejected')
    expect(await markOrderFailed(db, PAID_ID, 'rejected')).toBe(false)
    expect(db.tables.event_orders[1].status).toBe('paid')
    expect(await markOrderFailed(db, PAID_ID, 'refunded', { from: ['paid'] })).toBe(true)
    expect(await markOrderFailed(db, 'no-es-uuid', 'rejected')).toBe(false)
  })

  it('recordPaymentEvent deduplica por id', async () => {
    const db = createFakeSupabase({ tables: { aitickets_payment_events: [] } })
    expect(await recordPaymentEvent(db, { id: 'flow-556', provider: 'flow', type: 'payment.confirmed' })).toBe(true)
    db.failOn('aitickets_payment_events', 'insert', { code: '23505', message: 'duplicate key' })
    expect(await recordPaymentEvent(db, { id: 'flow-556', provider: 'flow', type: 'payment.confirmed' })).toBe(false)
  })

  it('isMissingSchemaError reconoce columnas/funciones/tablas inexistentes', () => {
    for (const code of ['42703', '42883', 'PGRST202', 'PGRST204', '42P01', 'PGRST205']) expect(isMissingSchemaError({ code })).toBe(true)
    expect(isMissingSchemaError({ code: '23505' })).toBe(false)
    expect(isMissingSchemaError(null)).toBe(false)
  })
})

describe('expectedPaymentAmounts', () => {
  it('monto esperado = amount + ticket_fee + service_fee_tax', () => {
    expect(expectedPaymentAmounts({ amount: 8000, ticket_fee: 800, service_fee_tax: 152 })).toEqual([8952])
  })

  it('órdenes anteriores al IVA (service_fee_tax 0) esperan subtotal + cargo', () => {
    expect(expectedPaymentAmounts({ amount: 8000, ticket_fee: 800, service_fee_tax: 0 })).toEqual([8800])
  })

  it('sin la columna (base sin migrar): acepta el total con o sin el IVA calculado del cargo', () => {
    expect(expectedPaymentAmounts({ amount: 8000, ticket_fee: 800 })).toEqual([8800, 8952])
    expect(expectedPaymentAmounts({ amount: 8000, ticket_fee: 800, service_fee_tax: null })).toEqual([8800, 8952])
  })

  it('orden gratis o cortesía: 0', () => {
    expect(expectedPaymentAmounts({ amount: 0, ticket_fee: 0 })).toEqual([0])
    expect(expectedPaymentAmounts({ amount: 0, ticket_fee: 0, service_fee_tax: 0 })).toEqual([0])
  })
})
