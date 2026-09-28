// Cuenta de Stripe compartida con otros negocios de Chanium: el webhook solo procesa objetos con
// metadata.app === 'aitickets' (netlify/functions/stripe-webhook/ownership.mjs).
import { describe, expect, it, vi } from 'vitest'
import { isAiTicketsEvent, HANDLED_EVENT_TYPES } from '../../netlify/functions/stripe-webhook/ownership.mjs'

const ev = (type, object) => ({ id: 'evt_1', type, data: { object } })
const noLookup = () => { throw new Error('no debería consultar Stripe') }

describe('isAiTicketsEvent', () => {
  it('checkout.session con metadata.app=aitickets es nuestra; sin ella o de otra app, no', async () => {
    const ours = ev('checkout.session.completed', { object: 'checkout.session', metadata: { app: 'aitickets', order_id: 'x' } })
    expect((await isAiTicketsEvent(ours, noLookup)).ours).toBe(true)
    const legacy = ev('checkout.session.completed', { object: 'checkout.session', metadata: { order_id: 'x' } })
    expect((await isAiTicketsEvent(legacy, noLookup)).ours).toBe(false)
    const other = ev('checkout.session.completed', { object: 'checkout.session', metadata: { app: 'otra' } })
    expect((await isAiTicketsEvent(other, noLookup)).ours).toBe(false)
    const none = ev('checkout.session.expired', { object: 'checkout.session' })
    expect((await isAiTicketsEvent(none, noLookup)).ours).toBe(false)
  })

  it('charge.refunded: usa la metadata del cargo o, si falta, la del PaymentIntent', async () => {
    const withMeta = ev('charge.refunded', { object: 'charge', metadata: { app: 'aitickets' }, payment_intent: 'pi_1' })
    expect((await isAiTicketsEvent(withMeta, noLookup)).ours).toBe(true)

    const lookup = vi.fn(async (id) => (id === 'pi_ours' ? { app: 'aitickets' } : { app: 'otra' }))
    expect((await isAiTicketsEvent(ev('charge.refunded', { object: 'charge', metadata: {}, payment_intent: 'pi_ours' }), lookup)).ours).toBe(true)
    expect((await isAiTicketsEvent(ev('charge.refunded', { object: 'charge', metadata: {}, payment_intent: 'pi_other' }), lookup)).ours).toBe(false)
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('charge.dispute.created: resuelve el PaymentIntent (expandido o consultado)', async () => {
    const expanded = ev('charge.dispute.created', { object: 'dispute', payment_intent: { id: 'pi_1', metadata: { app: 'aitickets' } } })
    expect((await isAiTicketsEvent(expanded, noLookup)).ours).toBe(true)
    const missing = ev('charge.dispute.created', { object: 'dispute', payment_intent: 'pi_gone' })
    expect((await isAiTicketsEvent(missing, async () => null)).ours).toBe(false)
    const noPi = ev('charge.dispute.created', { object: 'dispute', charge: 'ch_1' })
    expect((await isAiTicketsEvent(noPi, noLookup)).ours).toBe(false)
  })

  it('si Stripe no responde al leer el PaymentIntent, propaga el error (el webhook responde 500 y Stripe reintenta)', async () => {
    const e = ev('charge.refunded', { object: 'charge', metadata: {}, payment_intent: 'pi_1' })
    await expect(isAiTicketsEvent(e, async () => { throw new Error('timeout') })).rejects.toThrow('timeout')
  })

  it('objetos de otros tipos no se procesan', async () => {
    expect((await isAiTicketsEvent(ev('invoice.paid', { object: 'invoice', metadata: { app: 'aitickets' } }), noLookup)).ours).toBe(false)
    expect(HANDLED_EVENT_TYPES.has('invoice.paid')).toBe(false)
    expect(HANDLED_EVENT_TYPES.has('charge.refunded')).toBe(true)
  })
  it('respaldo para órdenes anteriores a la etiqueta: sin metadata.app se busca la orden de Stripe en la base', async () => {
    const finder = vi.fn(async ({ sessionId, paymentIntentId }) => sessionId === 'cs_legacy' || paymentIntentId === 'pi_legacy')

    const legacySession = ev('checkout.session.completed', { object: 'checkout.session', id: 'cs_legacy', metadata: { order_id: 'x' } })
    expect(await isAiTicketsEvent(legacySession, noLookup, finder)).toMatchObject({ ours: true })
    expect(finder).toHaveBeenLastCalledWith({ sessionId: 'cs_legacy' })
    const unknownSession = ev('checkout.session.completed', { object: 'checkout.session', id: 'cs_x', metadata: { order_id: 'x' } })
    expect((await isAiTicketsEvent(unknownSession, noLookup, finder)).ours).toBe(false)

    const legacyRefund = ev('charge.refunded', { object: 'charge', metadata: {}, payment_intent: 'pi_legacy' })
    expect((await isAiTicketsEvent(legacyRefund, async () => ({ order_id: 'x' }), finder)).ours).toBe(true)
    expect(finder).toHaveBeenLastCalledWith({ paymentIntentId: 'pi_legacy' })
    const legacyDispute = ev('charge.dispute.created', { object: 'dispute', payment_intent: { id: 'pi_legacy', metadata: { order_id: 'x' } } })
    expect((await isAiTicketsEvent(legacyDispute, noLookup, finder)).ours).toBe(true)
  })

  it('el respaldo nunca se usa si el objeto está marcado con otra app', async () => {
    const finder = vi.fn(async () => true)
    const otherSession = ev('checkout.session.completed', { object: 'checkout.session', id: 'cs_1', metadata: { app: 'otra' } })
    expect((await isAiTicketsEvent(otherSession, noLookup, finder)).ours).toBe(false)
    const otherPi = ev('charge.refunded', { object: 'charge', metadata: {}, payment_intent: 'pi_1' })
    expect((await isAiTicketsEvent(otherPi, async () => ({ app: 'otra' }), finder)).ours).toBe(false)
    const otherCharge = ev('charge.refunded', { object: 'charge', metadata: { app: 'otra' }, payment_intent: 'pi_1' })
    expect((await isAiTicketsEvent(otherCharge, async () => ({}), finder)).ours).toBe(false)
    expect(finder).not.toHaveBeenCalled()
  })

  it('si la base no responde en el respaldo, propaga el error (reintento de Stripe)', async () => {
    const e = ev('checkout.session.completed', { object: 'checkout.session', id: 'cs_1', metadata: { order_id: 'x' } })
    await expect(isAiTicketsEvent(e, noLookup, async () => { throw new Error('db caída') })).rejects.toThrow('db caída')
  })
})
