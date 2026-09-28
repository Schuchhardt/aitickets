// Conciliación con Flow (netlify/lib/payments/reconcile.mjs): Flow y confirmPaidOrder mockeados.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirmPaidOrder: vi.fn(async () => ({ status: 'paid', httpStatus: 200 })),
  getFlowPaymentStatusByCommerceId: vi.fn(),
}))

vi.mock('../../netlify/lib/orders.mjs', () => ({ confirmPaidOrder: mocks.confirmPaidOrder }))
vi.mock('../../netlify/lib/payments/flow.mjs', () => ({
  getFlowPaymentStatusByCommerceId: mocks.getFlowPaymentStatusByCommerceId,
  isFlowConfigured: () => true,
  FLOW_STATUS: { PENDING: 1, PAID: 2, REJECTED: 3, CANCELLED: 4 },
}))

import { reconcileOrder } from '../../netlify/lib/payments/reconcile.mjs'

const ORDER = { id: '0f8fad5b-d9cb-469f-a165-70867728950e', payment_provider: 'flow' }

beforeEach(() => {
  mocks.confirmPaidOrder.mockClear()
  mocks.getFlowPaymentStatusByCommerceId.mockReset()
})

describe('reconcileOrder', () => {
  it('Flow pagada → confirmPaidOrder con los datos del pago', async () => {
    mocks.getFlowPaymentStatusByCommerceId.mockResolvedValueOnce({ status: 2, amount: 33000, currency: 'CLP', flowOrder: 99, paymentData: { fee: '100', taxes: '19', balance: '32881', media: 'Webpay' } })
    expect((await reconcileOrder({}, ORDER)).outcome).toBe('confirmed')
    expect(mocks.confirmPaidOrder).toHaveBeenCalledWith({}, ORDER.id, { provider: 'flow', amount: 33000, currency: 'CLP', externalId: '99', fee: 119, net: 32881, method: 'Webpay' })
  })

  it('Flow no pagada → not_paid, sin confirmar', async () => {
    mocks.getFlowPaymentStatusByCommerceId.mockResolvedValueOnce({ status: 1 })
    expect(await reconcileOrder({}, ORDER)).toMatchObject({ outcome: 'not_paid', status: 1 })
    expect(mocks.confirmPaidOrder).not.toHaveBeenCalled()
  })

  it('error consultando Flow → error', async () => {
    mocks.getFlowPaymentStatusByCommerceId.mockRejectedValueOnce(new Error('red'))
    expect(await reconcileOrder({}, ORDER)).toMatchObject({ outcome: 'error', message: 'red' })
    expect(mocks.confirmPaidOrder).not.toHaveBeenCalled()
  })

  it('confirmPaidOrder pide reintento → retry', async () => {
    mocks.getFlowPaymentStatusByCommerceId.mockResolvedValueOnce({ status: 2, amount: 1, currency: 'CLP', flowOrder: 1 })
    mocks.confirmPaidOrder.mockResolvedValueOnce({ status: 'retry', httpStatus: 503 })
    expect((await reconcileOrder({}, ORDER)).outcome).toBe('retry')
  })

  it('orden sin proveedor se concilia como Flow', async () => {
    mocks.getFlowPaymentStatusByCommerceId.mockResolvedValueOnce({ status: 1 })
    expect((await reconcileOrder({}, { id: ORDER.id })).outcome).toBe('not_paid')
  })

  it('proveedor sin conciliación (gratis/cortesía) → unverifiable', async () => {
    expect((await reconcileOrder({}, { id: ORDER.id, payment_provider: 'free' })).outcome).toBe('unverifiable')
    expect(mocks.getFlowPaymentStatusByCommerceId).not.toHaveBeenCalled()
  })
})
