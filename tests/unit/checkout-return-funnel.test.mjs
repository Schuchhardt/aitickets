// Embudo del checkout al volver de Webpay (SPEC_evento §14, src/pages/payment-confirmation.astro): qué evento se manda
// según el estado que muestra la página y que recargarla no lo repite (sessionStorage).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkoutReturnFunnel, trackCheckoutReturn } from '../../src/components/event/checkoutApi.js'

const order = (status) => ({ id: 'ord-1', status })

describe('checkoutReturnFunnel', () => {
  it('pagada o ya cobrada y emitiéndose → order_paid con total y cantidad', () => {
    expect(checkoutReturnFunnel('paid', order('paid'), { total: 10952, qty: 1 })).toEqual({
      name: 'order_paid',
      params: { order_id: 'ord-1', total: 10952, qty: 1 },
    })
    expect(checkoutReturnFunnel('processing', order('pending'), { total: 21904, qty: 2 })).toEqual({
      name: 'order_paid',
      params: { order_id: 'ord-1', total: 21904, qty: 2 },
    })
  })

  it('rechazada o anulada → order_failed con el estado', () => {
    expect(checkoutReturnFunnel('rejected', order('rejected'))).toEqual({ name: 'order_failed', params: { order_id: 'ord-1', status: 'rejected' } })
    expect(checkoutReturnFunnel('cancelled', order('cancelled'))).toEqual({ name: 'order_failed', params: { order_id: 'ord-1', status: 'cancelled' } })
  })

  it('anulada porque la reserva venció → hold_expired', () => {
    expect(checkoutReturnFunnel('cancelled', order('expired'))).toEqual({ name: 'hold_expired', params: { order_id: 'ord-1' } })
  })

  it('manda lo que se ve en pantalla aunque la orden ya esté vencida', () => {
    // Flow la rechazó (status 3) después de que expire-pending-orders la venciera: la página dice "rechazado"
    expect(checkoutReturnFunnel('rejected', order('expired'))?.name).toBe('order_failed')
    // Flow todavía la tiene pendiente (status 1): la página dice "pendiente", sin evento
    expect(checkoutReturnFunnel('pending', order('expired'))).toBeNull()
  })

  it('pendiente, en revisión, reembolsada, error o sin orden → ningún evento', () => {
    for (const state of ['pending', 'review', 'refunded', 'error']) expect(checkoutReturnFunnel(state, order('pending'))).toBeNull()
    expect(checkoutReturnFunnel('paid', null)).toBeNull()
  })
})

describe('trackCheckoutReturn', () => {
  let gtag
  let storage

  beforeEach(() => {
    gtag = vi.fn()
    const data = new Map()
    storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) }
    vi.stubGlobal('window', { gtag })
    vi.stubGlobal('sessionStorage', storage)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('manda el evento con el event_id una sola vez por orden y resultado', () => {
    const funnel = checkoutReturnFunnel('paid', order('paid'), { total: 10952, qty: 1 })
    expect(trackCheckoutReturn(funnel, 42)).toBe(true)
    expect(gtag).toHaveBeenCalledWith('event', 'order_paid', { event_id: 42, order_id: 'ord-1', total: 10952, qty: 1 })
    // Recargar la página: no se repite
    expect(trackCheckoutReturn(funnel, 42)).toBe(false)
    expect(gtag).toHaveBeenCalledTimes(1)
    // Otro resultado de la misma orden (reintento rechazado) sí se manda
    expect(trackCheckoutReturn(checkoutReturnFunnel('rejected', order('rejected')), 42)).toBe(true)
    expect(gtag).toHaveBeenCalledTimes(2)
  })

  it('suma la atribución que guardó la página del evento', () => {
    storage.setItem('aitickets_attribution', JSON.stringify({ ref: 'rrpp-ana', utm: { source: 'instagram' } }))
    trackCheckoutReturn(checkoutReturnFunnel('cancelled', order('expired')), 7)
    expect(gtag).toHaveBeenCalledWith('event', 'hold_expired', { event_id: 7, ref: 'rrpp-ana', utm_source: 'instagram', order_id: 'ord-1' })
  })

  it('sin storage (navegador in-app que lo bloquea) igual lo manda', () => {
    const blocked = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('SecurityError') } }
    expect(trackCheckoutReturn(checkoutReturnFunnel('paid', order('paid')), 1, blocked)).toBe(true)
    expect(gtag).toHaveBeenCalledTimes(1)
  })

  it('sin evento (pendiente) no manda nada', () => {
    expect(trackCheckoutReturn(null, 1)).toBe(false)
    expect(gtag).not.toHaveBeenCalled()
  })
})
