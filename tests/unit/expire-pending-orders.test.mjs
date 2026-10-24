// expire-pending-orders: expiración con conciliación contra Flow (pagos cuyo webhook no llegó), revisión tardía
// de expiradas y barrido de 'processing'. Flow, confirmPaidOrder y Slack mockeados: nada sale a la red.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const mocks = vi.hoisted(() => ({
  db: null,
  flowConfigured: true,
  getStatus: vi.fn(),
  confirmPaidOrder: vi.fn(),
  notifySlack: vi.fn(async () => {}),
}))

vi.mock('../../netlify/lib/supabase.mjs', async (importOriginal) => ({ ...(await importOriginal()), getSupabaseAdmin: () => mocks.db }))
vi.mock('../../netlify/lib/payments/flow.mjs', () => ({
  FLOW_STATUS: { PENDING: 1, PAID: 2, REJECTED: 3, CANCELLED: 4 },
  isFlowConfigured: () => mocks.flowConfigured,
  getFlowPaymentStatusByCommerceId: (...args) => mocks.getStatus(...args),
}))
vi.mock('../../netlify/lib/orders.mjs', async (importOriginal) => ({ ...(await importOriginal()), confirmPaidOrder: (...args) => mocks.confirmPaidOrder(...args) }))
vi.mock('../../netlify/lib/slack.mjs', () => ({ notifySlack: (...args) => mocks.notifySlack(...args) }))

import handler, {
  FLOW_TIMEOUT_MS,
  LATE_CHECK_AFTER_MINUTES,
  LATE_CHECK_WINDOW_MINUTES,
  RECONCILE_BUDGET_MS,
  RECONCILE_EXPIRED_LIMIT,
  RECONCILE_GRACE_MINUTES,
  RECONCILE_PENDING_LIMIT,
} from '../../netlify/functions/expire-pending-orders/index.mjs'

const NOW = Date.parse('2026-10-24T15:00:00Z')
const minutesAgo = (m) => new Date(NOW - m * 60 * 1000).toISOString()
let seq = 0
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

/** Orden pendiente de Flow cuya reserva venció hace `holdAgo` minutos y que llegó a Flow (flowOrder). */
function flowOrder(overrides = {}) {
  const holdAgo = overrides.holdAgo ?? 1
  const { holdAgo: _h, ...rest } = overrides
  return {
    id: uuid(),
    event_id: 7,
    status: 'pending',
    payment_provider: 'flow',
    payment_external_id: `9${seq}`,
    created_at: minutesAgo(holdAgo + 15),
    hold_expires_at: minutesAgo(holdAgo),
    processing_started_at: null,
    ...rest,
  }
}

const PAID = (order) => ({ status: 2, amount: 10950, currency: 'CLP', flowOrder: Number(order.payment_external_id), paymentData: { fee: '300', taxes: '57', balance: '10593', media: 'Webpay' } })

async function run(orders) {
  mocks.db = createFakeSupabase({ tables: { event_orders: orders } })
  const res = await handler()
  return { body: await res.json(), status: res.status, row: (id) => mocks.db.tables.event_orders.find((o) => o.id === id) }
}

/** confirmPaidOrder real en lo esencial: marca la orden pagada y responde como el webhook. */
function confirmMarksPaid(result = { status: 'paid', httpStatus: 200, message: 'Pago confirmado y entradas registradas' }) {
  return async (_supabase, orderId) => {
    const row = mocks.db.tables.event_orders.find((o) => o.id === orderId)
    if (result.status === 'paid' || result.status === 'retry') row.status = 'paid'
    if (result.status === 'review') row.status = 'review'
    return result
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  mocks.flowConfigured = true
  mocks.getStatus.mockReset()
  mocks.confirmPaidOrder.mockReset()
  mocks.confirmPaidOrder.mockImplementation(confirmMarksPaid())
  mocks.notifySlack.mockClear()
})

describe('expiración con conciliación contra Flow', () => {
  it('pagada en Flow sin webhook → se cumple (no se expira) y avisa a Slack', async () => {
    const order = flowOrder()
    mocks.getStatus.mockResolvedValueOnce(PAID(order))
    const { body, row } = await run([order])
    expect(row(order.id).status).toBe('paid')
    expect(mocks.confirmPaidOrder).toHaveBeenCalledWith(mocks.db, order.id, expect.objectContaining({ provider: 'flow', amount: 10950, externalId: order.payment_external_id }))
    expect(mocks.getStatus).toHaveBeenCalledWith(order.id, { timeoutMs: FLOW_TIMEOUT_MS })
    expect(body).toMatchObject({ expired: 0, rescued: 1, reconciled: 1 })
    expect(mocks.notifySlack).toHaveBeenCalledTimes(1)
    expect(mocks.notifySlack.mock.calls[0][0]).toMatch(/Pago recuperado por conciliación.*orden .*pagada en Flow/)
  })

  it('pagada en Flow pero sin stock → queda en review (aviso de rescate) y no se expira', async () => {
    const order = flowOrder()
    mocks.getStatus.mockResolvedValueOnce(PAID(order))
    mocks.confirmPaidOrder.mockImplementation(confirmMarksPaid({ status: 'review', httpStatus: 200, message: 'Pago registrado para revisión (sin stock)' }))
    const { body, row } = await run([order])
    expect(row(order.id).status).toBe('review')
    expect(body).toMatchObject({ expired: 0, rescued: 1 })
    expect(mocks.notifySlack.mock.calls[0][0]).toMatch(/review/)
  })

  it('pagada pero el correo falló → queda pagada y el aviso pide reenviar', async () => {
    const order = flowOrder()
    mocks.getStatus.mockResolvedValueOnce(PAID(order))
    mocks.confirmPaidOrder.mockImplementation(confirmMarksPaid({ status: 'retry', httpStatus: 503, message: 'Pago confirmado; correo pendiente' }))
    const { body, row } = await run([order])
    expect(row(order.id).status).toBe('paid')
    expect(body).toMatchObject({ expired: 0, rescued: 1 })
    expect(mocks.notifySlack.mock.calls[0][0]).toMatch(/Reenviar entradas/)
  })

  it('pendiente en Flow (el comprador no pagó) → expirada', async () => {
    const order = flowOrder()
    mocks.getStatus.mockResolvedValueOnce({ status: 1 })
    const { body, row } = await run([order])
    expect(row(order.id).status).toBe('expired')
    expect(mocks.confirmPaidOrder).not.toHaveBeenCalled()
    expect(body).toMatchObject({ expired: 1, rescued: 0 })
    expect(mocks.notifySlack).not.toHaveBeenCalled()
  })

  it('rechazada o anulada en Flow → rejected / cancelled, como el webhook', async () => {
    const rejected = flowOrder()
    const cancelled = flowOrder()
    mocks.getStatus.mockImplementation(async (id) => ({ status: id === rejected.id ? 3 : 4 }))
    const { body, row } = await run([rejected, cancelled])
    expect(row(rejected.id).status).toBe('rejected')
    expect(row(cancelled.id).status).toBe('cancelled')
    expect(body).toMatchObject({ expired: 0, closed: 2 })
  })

  it('Flow no responde → sigue pendiente para la próxima corrida; pasada la gracia se expira igual', async () => {
    const recent = flowOrder({ holdAgo: 5 })
    const old = flowOrder({ holdAgo: RECONCILE_GRACE_MINUTES + 1 })
    mocks.getStatus.mockRejectedValue(new Error('Flow payment/getStatusByCommerceId falló (502)'))
    const { body, row } = await run([recent, old])
    expect(row(recent.id).status).toBe('pending')
    expect(row(old.id).status).toBe('expired')
    expect(mocks.getStatus).toHaveBeenCalledTimes(2)
    expect(body).toMatchObject({ expired: 1, deferred: 1, rescued: 0 })
  })

  it('reintenta en corridas siguientes y expira al cumplirse la gracia', async () => {
    const order = flowOrder({ holdAgo: 1 })
    mocks.getStatus.mockRejectedValue(new Error('timeout'))
    mocks.db = createFakeSupabase({ tables: { event_orders: [order] } })
    for (const elapsed of [0, 10, 20]) {
      vi.setSystemTime(NOW + elapsed * 60 * 1000)
      await handler()
      expect(mocks.db.tables.event_orders[0].status).toBe('pending')
    }
    vi.setSystemTime(NOW + RECONCILE_GRACE_MINUTES * 60 * 1000)
    await handler()
    expect(mocks.db.tables.event_orders[0].status).toBe('expired')
    expect(mocks.getStatus).toHaveBeenCalledTimes(4)
  })

  it('tope de consultas por corrida: el resto queda para la próxima (o se expira si pasó la gracia)', async () => {
    const due = Array.from({ length: RECONCILE_PENDING_LIMIT + 5 }, () => flowOrder({ holdAgo: 2 }))
    const pastGrace = flowOrder({ holdAgo: RECONCILE_GRACE_MINUTES + 5 })
    mocks.getStatus.mockResolvedValue({ status: 1 })
    const { body, row } = await run([...due, pastGrace])
    expect(mocks.getStatus).toHaveBeenCalledTimes(RECONCILE_PENDING_LIMIT)
    // La más antigua va primero: se concilia (y expira) dentro del tope
    expect(row(pastGrace.id).status).toBe('expired')
    expect(body.expired).toBe(RECONCILE_PENDING_LIMIT)
    expect(body.deferred).toBe(due.length + 1 - RECONCILE_PENDING_LIMIT)
    expect(mocks.db.tables.event_orders.filter((o) => o.status === 'pending')).toHaveLength(body.deferred)
  })

  it('presupuesto de tiempo: pasado RECONCILE_BUDGET_MS no se inicia otra consulta a Flow', async () => {
    const a = flowOrder({ holdAgo: 3 })
    const b = flowOrder({ holdAgo: 2 })
    mocks.getStatus.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + RECONCILE_BUDGET_MS + 1)
      return { status: 1 }
    })
    const { body, row } = await run([a, b])
    expect(mocks.getStatus).toHaveBeenCalledTimes(1)
    expect(row(a.id).status).toBe('expired')
    expect(row(b.id).status).toBe('pending')
    expect(body).toMatchObject({ expired: 1, deferred: 1 })
  })

  it('el webhook llega en paralelo (otra invocación tiene la orden) → no se expira ni se avisa', async () => {
    const order = flowOrder()
    mocks.getStatus.mockResolvedValueOnce(PAID(order))
    mocks.confirmPaidOrder.mockImplementation(async (_s, id) => {
      mocks.db.tables.event_orders.find((o) => o.id === id).status = 'processing'
      return { status: 'retry', httpStatus: 503, message: 'Orden en proceso', inProgress: true }
    })
    const { body, row } = await run([order])
    expect(row(order.id).status).toBe('processing')
    expect(body).toMatchObject({ expired: 0, rescued: 0 })
    expect(mocks.notifySlack).not.toHaveBeenCalled()
  })

  it('el webhook ya la había pagado → already_paid, sin aviso de rescate', async () => {
    const order = flowOrder()
    mocks.getStatus.mockResolvedValueOnce(PAID(order))
    mocks.confirmPaidOrder.mockImplementation(async (_s, id) => {
      mocks.db.tables.event_orders.find((o) => o.id === id).status = 'paid'
      return { status: 'already_paid', httpStatus: 200, message: 'Orden ya procesada' }
    })
    const { body } = await run([order])
    expect(body).toMatchObject({ expired: 0, rescued: 0 })
    expect(mocks.notifySlack).not.toHaveBeenCalled()
  })

  it('órdenes que no llegaron a Flow (gratis, sin flowOrder, antiguas sin hold) se expiran sin consultar', async () => {
    const free = flowOrder({ payment_provider: 'free', payment_external_id: null })
    const noFlowOrder = flowOrder({ payment_external_id: null })
    const legacy = { ...flowOrder({ payment_external_id: null }), hold_expires_at: null, created_at: minutesAgo(20) }
    const live = flowOrder({ holdAgo: -5 })
    const { body, row } = await run([free, noFlowOrder, legacy, live])
    expect(mocks.getStatus).not.toHaveBeenCalled()
    expect(row(free.id).status).toBe('expired')
    expect(row(noFlowOrder.id).status).toBe('expired')
    expect(row(legacy.id).status).toBe('expired')
    expect(row(live.id).status).toBe('pending')
    expect(body.expired).toBe(3)
  })

  it('sin credenciales de Flow se expira como antes y no hay revisión tardía', async () => {
    mocks.flowConfigured = false
    const order = flowOrder()
    const expired = flowOrder({ status: 'expired', holdAgo: LATE_CHECK_AFTER_MINUTES + 5 })
    const { body, row } = await run([order, expired])
    expect(mocks.getStatus).not.toHaveBeenCalled()
    expect(row(order.id).status).toBe('expired')
    expect(body).toMatchObject({ expired: 1, late_checked: 0 })
  })
})

describe('revisión tardía de expiradas', () => {
  it('una expirada que Flow cobró después → se cumple con el camino de pago tardío y avisa', async () => {
    const order = flowOrder({ status: 'expired', holdAgo: LATE_CHECK_AFTER_MINUTES + 5 })
    mocks.getStatus.mockResolvedValueOnce(PAID(order))
    const { body, row } = await run([order])
    expect(row(order.id).status).toBe('paid')
    expect(body).toMatchObject({ late_checked: 1, rescued: 1 })
    expect(mocks.notifySlack.mock.calls[0][0]).toMatch(/ya había expirado/)
  })

  it('solo mira la ventana [LATE_CHECK_AFTER_MINUTES, +LATE_CHECK_WINDOW_MINUTES) min (más ancha que el cron: sin huecos)', async () => {
    expect(LATE_CHECK_WINDOW_MINUTES).toBeGreaterThan(10)
    const before = flowOrder({ status: 'expired', holdAgo: LATE_CHECK_AFTER_MINUTES - 1 })
    const inside = flowOrder({ status: 'expired', holdAgo: LATE_CHECK_AFTER_MINUTES + 1 })
    const after = flowOrder({ status: 'expired', holdAgo: LATE_CHECK_AFTER_MINUTES + LATE_CHECK_WINDOW_MINUTES + 1 })
    const notFlow = flowOrder({ status: 'expired', holdAgo: LATE_CHECK_AFTER_MINUTES + 1, payment_external_id: null })
    mocks.getStatus.mockResolvedValue({ status: 1 })
    const { body, row } = await run([before, inside, after, notFlow])
    expect(mocks.getStatus).toHaveBeenCalledTimes(1)
    expect(mocks.getStatus).toHaveBeenCalledWith(inside.id, { timeoutMs: FLOW_TIMEOUT_MS })
    expect(row(inside.id).status).toBe('expired')
    expect(body).toMatchObject({ late_checked: 1, rescued: 0 })
  })

  it('tope por corrida', async () => {
    const orders = Array.from({ length: RECONCILE_EXPIRED_LIMIT + 3 }, () => flowOrder({ status: 'expired', holdAgo: LATE_CHECK_AFTER_MINUTES + 2 }))
    mocks.getStatus.mockResolvedValue({ status: 1 })
    const { body } = await run(orders)
    expect(mocks.getStatus).toHaveBeenCalledTimes(RECONCILE_EXPIRED_LIMIT)
    expect(body.late_checked).toBe(RECONCILE_EXPIRED_LIMIT)
  })
})

describe("barrido de 'processing'", () => {
  it('una processing abandonada que Flow cobró se retoma', async () => {
    const order = flowOrder({ status: 'processing', processing_started_at: minutesAgo(8) })
    const fresh = flowOrder({ status: 'processing', processing_started_at: minutesAgo(1) })
    mocks.getStatus.mockResolvedValueOnce(PAID(order))
    const { body, row } = await run([order, fresh])
    expect(row(order.id).status).toBe('paid')
    expect(row(fresh.id).status).toBe('processing')
    expect(mocks.getStatus).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({ recovered: 1 })
  })
})
