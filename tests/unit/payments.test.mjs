// Proveedor de pago (netlify/lib/payments/*): solo Flow. Ningún caso sale a la red.
import { describe, expect, it, vi } from 'vitest'

const flowMock = vi.hoisted(() => ({ createFlowPayment: vi.fn() }))

vi.mock('../../netlify/lib/payments/flow.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createFlowCheckout: (args) => flowMock.createFlowPayment(args),
  }
})

import { PROVIDERS, createCheckout, defaultProvider, enabledProviders, holdMinutesFor } from '../../netlify/lib/payments/index.mjs'
import { signFlowParams } from '../../netlify/lib/payments/flow.mjs'

describe('proveedores de pago', () => {
  it('solo Flow', () => {
    expect(PROVIDERS).toEqual(['flow'])
    expect(enabledProviders()).toEqual(['flow'])
    expect(defaultProvider()).toBe('flow')
  })

  it('la reserva de stock es de 15 minutos', () => {
    expect(holdMinutesFor('flow')).toBe(15)
    expect(holdMinutesFor()).toBe(15)
  })

  it('createCheckout("flow") delega en Flow', async () => {
    flowMock.createFlowPayment.mockResolvedValueOnce({ redirectUrl: 'https://flow.cl/pay?token=t', externalId: '99' })
    const args = { order: { id: 'o1' }, eventName: 'Evento', ticketQty: 1, total: 1000, buyerEmail: 'a@b.cl', siteUrl: 'https://aitickets.cl', holdMinutes: 15 }
    await expect(createCheckout('flow', args)).resolves.toEqual({ redirectUrl: 'https://flow.cl/pay?token=t', externalId: '99' })
    expect(flowMock.createFlowPayment).toHaveBeenCalledWith(args)
  })

  it('createCheckout rechaza proveedores desconocidos', async () => {
    await expect(createCheckout('webpay-directo', {})).rejects.toThrow(/desconocido/)
    await expect(createCheckout('paypal', {})).rejects.toThrow(/desconocido/)
  })
})

describe('otros helpers de pago', () => {
  it('signFlowParams firma los parámetros ordenados e ignora "s"', () => {
    const a = signFlowParams({ b: '2', a: '1', apiKey: 'k' }, 'secret')
    const b = signFlowParams({ apiKey: 'k', a: '1', b: '2', s: 'ignorado' }, 'secret')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(signFlowParams({ a: '1' }, 'otro')).not.toBe(signFlowParams({ a: '1' }, 'secret'))
  })
})
