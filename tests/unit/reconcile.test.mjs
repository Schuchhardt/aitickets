// Conciliación con el proveedor (netlify/lib/payments/reconcile.mjs): Stripe/Flow y confirmPaidOrder mockeados.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirmPaidOrder: vi.fn(async () => ({ status: 'paid', httpStatus: 200 })),
  retrieveStripeSession: vi.fn(),
  getFlowPaymentStatusByCommerceId: vi.fn(),
}))

vi.mock('../../netlify/lib/orders.mjs', () => ({ confirmPaidOrder: mocks.confirmPaidOrder }))
vi.mock('../../netlify/lib/payments/stripe.mjs', () => ({ retrieveStripeSession: mocks.retrieveStripeSession }))
vi.mock('../../netlify/lib/payments/flow.mjs', () => ({
  getFlowPaymentStatusByCommerceId: mocks.getFlowPaymentStatusByCommerceId,
  isFlowConfigured: () => true,
  FLOW_STATUS: { PENDING: 1, PAID: 2, REJECTED: 3, CANCELLED: 4 },
}))

import { reconcileOrder } from '../../netlify/lib/payments/reconcile.mjs'

const ORDER = { id: '0f8fad5b-d9cb-469f-a165-70867728950e', payment_provider: 'stripe', provider_session_id: 'cs_test_1' }

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x')
  mocks.confirmPaidOrder.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('reconcileOrder', () => {
  it('Stripe cobrada → confirmPaidOrder con los datos de la sesión', async () => {
    mocks.retrieveStripeSession.mockResolvedValueOnce({ id: 'cs_test_1', status: 'complete', payment_status: 'paid', amount_total: 33000, currency: 'clp', payment_intent: 'pi_1' })
    expect((await reconcileOrder({}, ORDER)).outcome).toBe('confirmed')
    expect(mocks.confirmPaidOrder).toHaveBeenCalledWith({}, ORDER.id, expect.objectContaining({ provider: 'stripe', amount: 33000, externalId: 'cs_test_1', paymentIntentId: 'pi_1' }))
  })

  it('Stripe: pago asíncrono en curso, expirada o abierta → no confirma', async () => {
    mocks.retrieveStripeSession.mockResolvedValueOnce({ status: 'complete', payment_status: 'unpaid' })
    expect((await reconcileOrder({}, ORDER)).outcome).toBe('payment_pending')
    mocks.retrieveStripeSession.mockResolvedValueOnce({ status: 'expired', payment_status: 'unpaid' })
    expect((await reconcileOrder({}, ORDER)).outcome).toBe('session_expired')
    mocks.retrieveStripeSession.mockResolvedValueOnce({ status: 'open', payment_status: 'unpaid' })
    expect((await reconcileOrder({}, ORDER)).outcome).toBe('open')
    mocks.retrieveStripeSession.mockRejectedValueOnce(new Error('red'))
    expect((await reconcileOrder({}, ORDER)).outcome).toBe('error')
    expect(mocks.confirmPaidOrder).not.toHaveBeenCalled()
  })

  it('Stripe sin clave → unverifiable', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    expect((await reconcileOrder({}, ORDER)).outcome).toBe('unverifiable')
  })

  it('confirmPaidOrder pide reintento → retry', async () => {
    mocks.retrieveStripeSession.mockResolvedValueOnce({ id: 'cs_test_1', payment_status: 'paid', amount_total: 1, currency: 'clp' })
    mocks.confirmPaidOrder.mockResolvedValueOnce({ status: 'retry', httpStatus: 503 })
    expect((await reconcileOrder({}, ORDER)).outcome).toBe('retry')
  })

  it('Flow pagada → confirmPaidOrder; no pagada → not_paid', async () => {
    const flowOrder = { id: ORDER.id, payment_provider: 'flow' }
    mocks.getFlowPaymentStatusByCommerceId.mockResolvedValueOnce({ status: 2, amount: 33000, currency: 'CLP', flowOrder: 99, paymentData: { fee: '100', taxes: '19', balance: '32881', media: 'Webpay' } })
    expect((await reconcileOrder({}, flowOrder)).outcome).toBe('confirmed')
    expect(mocks.confirmPaidOrder).toHaveBeenCalledWith({}, ORDER.id, { provider: 'flow', amount: 33000, currency: 'CLP', externalId: '99', fee: 119, net: 32881, method: 'Webpay' })
    mocks.getFlowPaymentStatusByCommerceId.mockResolvedValueOnce({ status: 1 })
    expect((await reconcileOrder({}, flowOrder)).outcome).toBe('not_paid')
  })

  it('proveedor sin conciliación (gratis/cortesía) → unverifiable', async () => {
    expect((await reconcileOrder({}, { id: ORDER.id, payment_provider: 'free' })).outcome).toBe('unverifiable')
  })
})
