// Proveedores de pago (netlify/lib/payments/*): habilitación de Stripe, reservas y Checkout Session.
// El SDK de Stripe se reemplaza por un mock: ningún caso sale a la red.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stripeMock = vi.hoisted(() => ({ create: vi.fn(), ctorArgs: [] }))

vi.mock('stripe', () => {
  class FakeStripe {
    constructor(key, opts) {
      stripeMock.ctorArgs.push({ key, opts })
      this.checkout = { sessions: { create: stripeMock.create } }
    }
  }
  return { default: FakeStripe }
})

import {
  createCheckout,
  defaultProvider,
  enabledProviders,
  holdMinutesFor,
  isStripeAllowedForEvent,
  isStripeEnabled,
  isStripeTestEligibleEvent,
  isStripeTestKey,
  isStripeTestModeAllowed,
} from '../../netlify/lib/payments/index.mjs'
import { DEMO_EVENT_SLUG } from '../../src/lib/demoEvent.mjs'
import { STRIPE_DEFAULT_API_VERSION, createStripeCheckout, stripeMinAmount } from '../../netlify/lib/payments/stripe.mjs'
import { signFlowParams } from '../../netlify/lib/payments/flow.mjs'

const TEST_KEY = 'sk_test_51FakeKeyForUnitTests'
const LIVE_KEY = 'sk_live_51FakeKeyForUnitTests'

// Por defecto los casos corren como `netlify dev` (CONTEXT=dev); los de producción lo cambian explícitamente.
beforeEach(() => {
  vi.stubEnv('CONTEXT', 'dev')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('habilitación de proveedores', () => {
  it('por defecto solo Flow (sin STRIPE_SECRET_KEY)', () => {
    expect(isStripeEnabled()).toBe(false)
    expect(enabledProviders()).toEqual(['flow'])
    expect(defaultProvider()).toBe('flow')
  })

  it('Stripe exige clave + "stripe" en PAYMENT_PROVIDERS', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', TEST_KEY)
    expect(enabledProviders()).toEqual(['flow'])
    vi.stubEnv('PAYMENT_PROVIDERS', 'flow,stripe')
    expect(enabledProviders()).toEqual(['flow', 'stripe'])
    vi.stubEnv('PAYMENT_PROVIDERS', ' Flow , STRIPE ')
    expect(enabledProviders()).toEqual(['flow', 'stripe'])
  })

  it('PAYMENT_PROVIDERS=stripe sin clave no deja al comprador sin medio de pago', () => {
    vi.stubEnv('PAYMENT_PROVIDERS', 'stripe')
    expect(enabledProviders()).toEqual(['flow'])
  })

  it('una clave live requiere STRIPE_LIVE_APPROVED=true', () => {
    vi.stubEnv('PAYMENT_PROVIDERS', 'flow,stripe')
    vi.stubEnv('STRIPE_SECRET_KEY', LIVE_KEY)
    expect(isStripeEnabled()).toBe(false)
    expect(enabledProviders()).toEqual(['flow'])
    vi.stubEnv('STRIPE_LIVE_APPROVED', '1')
    expect(isStripeEnabled()).toBe(false)
    vi.stubEnv('STRIPE_LIVE_APPROVED', 'true')
    expect(isStripeEnabled()).toBe(true)
  })

  it('solo Stripe si PAYMENT_PROVIDERS lo lista solo a él y está habilitado', () => {
    vi.stubEnv('PAYMENT_PROVIDERS', 'stripe')
    vi.stubEnv('STRIPE_SECRET_KEY', TEST_KEY)
    expect(enabledProviders()).toEqual(['stripe'])
    expect(defaultProvider()).toBe('stripe')
  })

  it('clave de prueba: nunca en el contexto production salvo STRIPE_TEST_MODE_ALLOWED=true', () => {
    vi.stubEnv('PAYMENT_PROVIDERS', 'flow,stripe')
    vi.stubEnv('STRIPE_SECRET_KEY', TEST_KEY)
    vi.stubEnv('CONTEXT', 'production')
    expect(isStripeTestModeAllowed()).toBe(false)
    expect(isStripeEnabled()).toBe(false)
    expect(enabledProviders()).toEqual(['flow'])
    // STRIPE_LIVE_APPROVED no habilita una clave de prueba en producción
    vi.stubEnv('STRIPE_LIVE_APPROVED', 'true')
    expect(isStripeEnabled()).toBe(false)
    vi.stubEnv('STRIPE_TEST_MODE_ALLOWED', 'true')
    expect(isStripeEnabled()).toBe(true)
  })

  it('clave de prueba sin CONTEXT (entorno desconocido) se trata como producción', () => {
    vi.stubEnv('PAYMENT_PROVIDERS', 'flow,stripe')
    vi.stubEnv('STRIPE_SECRET_KEY', TEST_KEY)
    vi.stubEnv('CONTEXT', '')
    expect(isStripeEnabled()).toBe(false)
    vi.stubEnv('CONTEXT', 'deploy-preview')
    expect(isStripeEnabled()).toBe(true)
  })

  it('clave de prueba: solo el evento demo o los marcados de prueba', () => {
    vi.stubEnv('PAYMENT_PROVIDERS', 'flow,stripe')
    vi.stubEnv('STRIPE_SECRET_KEY', TEST_KEY)
    expect(isStripeTestEligibleEvent(DEMO_EVENT_SLUG)).toBe(true)
    expect(isStripeTestEligibleEvent('concierto-real')).toBe(false)
    expect(isStripeTestEligibleEvent('')).toBe(false)
    expect(isStripeAllowedForEvent(DEMO_EVENT_SLUG)).toBe(true)
    expect(isStripeAllowedForEvent('concierto-real')).toBe(false)
    expect(enabledProviders({ eventSlug: 'concierto-real' })).toEqual(['flow'])
    expect(enabledProviders({ eventSlug: DEMO_EVENT_SLUG })).toEqual(['flow', 'stripe'])
    vi.stubEnv('STRIPE_TEST_EVENT_SLUGS', 'prueba-uno, prueba-dos')
    expect(isStripeAllowedForEvent('prueba-dos')).toBe(true)
    expect(isStripeAllowedForEvent('concierto-real')).toBe(false)
  })

  it('clave live aprobada: Stripe para cualquier evento', () => {
    vi.stubEnv('PAYMENT_PROVIDERS', 'flow,stripe')
    vi.stubEnv('STRIPE_SECRET_KEY', LIVE_KEY)
    vi.stubEnv('STRIPE_LIVE_APPROVED', 'true')
    vi.stubEnv('CONTEXT', 'production')
    expect(isStripeAllowedForEvent('concierto-real')).toBe(true)
    expect(enabledProviders({ eventSlug: 'concierto-real' })).toEqual(['flow', 'stripe'])
  })

  it('isStripeTestKey reconoce sk_test_ y rk_test_', () => {
    expect(isStripeTestKey('sk_test_x')).toBe(true)
    expect(isStripeTestKey('rk_test_x')).toBe(true)
    expect(isStripeTestKey('sk_live_x')).toBe(false)
    expect(isStripeTestKey('')).toBe(false)
    expect(isStripeTestKey(undefined)).toBe(false)
  })
})

describe('holdMinutesFor', () => {
  it('Flow 15 minutos; Stripe 31 (mínimo de Checkout: 30)', () => {
    expect(holdMinutesFor('flow')).toBe(15)
    expect(holdMinutesFor('stripe')).toBe(31)
    expect(holdMinutesFor('otro')).toBe(15)
  })

  it('STRIPE_HOLD_MINUTES solo se acepta si es >= 31 y se limita a 24 h', () => {
    vi.stubEnv('STRIPE_HOLD_MINUTES', '20')
    expect(holdMinutesFor('stripe')).toBe(31)
    vi.stubEnv('STRIPE_HOLD_MINUTES', '45')
    expect(holdMinutesFor('stripe')).toBe(45)
    vi.stubEnv('STRIPE_HOLD_MINUTES', '99999')
    expect(holdMinutesFor('stripe')).toBe(1440)
    vi.stubEnv('STRIPE_HOLD_MINUTES', 'abc')
    expect(holdMinutesFor('stripe')).toBe(31)
  })
})

describe('createStripeCheckout', () => {
  const ORDER_ID = '8a6e0804-2bd0-4672-b79d-d97027f9071a'
  const args = {
    order: { id: ORDER_ID },
    eventName: 'Concierto de prueba',
    lines: [
      { id: 1, name: 'General', price: 15000, quantity: 2 },
      { id: 2, name: 'VIP', price: 25000.4, quantity: 1 },
      { id: 3, name: 'Liberada', price: 0, quantity: 1 },
    ],
    fee: 6545,
    feeNet: 5500,
    feeIva: 1045,
    buyerEmail: 'ana@example.cl',
    holdMinutes: 31,
    siteUrl: 'https://aitickets.cl/',
  }

  beforeEach(() => {
    stripeMock.create.mockReset()
    stripeMock.create.mockResolvedValue({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' })
    vi.stubEnv('STRIPE_SECRET_KEY', TEST_KEY)
  })

  it('montos CLP enteros, sin multiplicar por 100, y omite líneas gratis', async () => {
    const result = await createStripeCheckout(args)
    expect(result).toEqual({ redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_123', externalId: 'cs_test_123', sessionId: 'cs_test_123' })
    const [params] = stripeMock.create.mock.calls[0]
    expect(params.currency).toBe('clp')
    expect(params.mode).toBe('payment')
    const amounts = params.line_items.map((li) => li.price_data.unit_amount)
    expect(amounts).toEqual([15000, 25000, 5500, 1045])
    for (const li of params.line_items) {
      expect(li.price_data.currency).toBe('clp')
      expect(Number.isInteger(li.price_data.unit_amount)).toBe(true)
    }
    const total = params.line_items.reduce((s, li) => s + li.price_data.unit_amount * li.quantity, 0)
    expect(total).toBe(15000 * 2 + 25000 + 5500 + 1045)
    expect(params.line_items.at(-2).price_data.product_data.name).toBe('Cargo por servicio (10%)')
    expect(params.line_items.at(-1).price_data.product_data.name).toBe('IVA del cargo (19%)')
  })

  it('el total de Stripe coincide exactamente con computeBuyerTotal (subtotal + cargo + IVA)', async () => {
    const { computeBuyerTotal } = await import('../../netlify/lib/fees.mjs')
    for (const price of [990, 8000, 12345, 15999]) {
      stripeMock.create.mockClear()
      const t = computeBuyerTotal(price * 3)
      await createStripeCheckout({ ...args, lines: [{ id: 1, name: 'General', price, quantity: 3 }], fee: t.fee, feeNet: t.feeNet, feeIva: t.feeIva })
      const [params] = stripeMock.create.mock.calls[0]
      const total = params.line_items.reduce((s, li) => s + li.price_data.unit_amount * li.quantity, 0)
      expect(total).toBe(t.total)
    }
  })

  it('sin feeNet/feeIva usa los montos guardados en la orden', async () => {
    await createStripeCheckout({ ...args, fee: undefined, feeNet: undefined, feeIva: undefined, order: { id: ORDER_ID, ticket_fee: 800, service_fee_tax: 152 } })
    const [params] = stripeMock.create.mock.calls[0]
    expect(params.line_items.slice(-2).map((li) => li.price_data.unit_amount)).toEqual([800, 152])
  })

  it('success_url lleva la orden y {CHECKOUT_SESSION_ID}; cancel_url marca cancelled', async () => {
    await createStripeCheckout(args)
    const [params, opts] = stripeMock.create.mock.calls[0]
    expect(params.success_url).toBe(`https://aitickets.cl/pago/retorno?order=${ORDER_ID}&provider=stripe&session_id={CHECKOUT_SESSION_ID}`)
    expect(params.cancel_url).toBe(`https://aitickets.cl/pago/retorno?order=${ORDER_ID}&provider=stripe&cancelled=1`)
    expect(params.client_reference_id).toBe(ORDER_ID)
    expect(params.metadata).toEqual({ app: 'aitickets', order_id: ORDER_ID })
    expect(params.payment_intent_data.metadata).toEqual({ app: 'aitickets', order_id: ORDER_ID })
    expect(params.payment_intent_data.statement_descriptor_suffix).toBe('AITICKETS')
    expect(params.customer_email).toBe('ana@example.cl')
    expect(opts).toEqual({ idempotencyKey: `order-${ORDER_ID}` })
  })

  it('expires_at respeta el mínimo de 30 minutos de Stripe aunque la reserva sea menor', async () => {
    const before = Math.floor(Date.now() / 1000)
    await createStripeCheckout({ ...args, holdMinutes: 5 })
    const [params] = stripeMock.create.mock.calls[0]
    expect(params.expires_at - before).toBeGreaterThanOrEqual(31 * 60 - 1)
  })

  it('fija la versión de la API al construir el cliente', async () => {
    await createStripeCheckout(args)
    const last = stripeMock.ctorArgs.at(-1)
    expect(last.key).toBe(TEST_KEY)
    expect(last.opts.apiVersion).toBe(STRIPE_DEFAULT_API_VERSION)
  })

  it('una orden sin montos cobrables no crea sesión', async () => {
    await expect(createStripeCheckout({ ...args, lines: [{ id: 3, name: 'Liberada', price: 0, quantity: 2 }], fee: 0, feeNet: 0, feeIva: 0 })).rejects.toThrow(/montos cobrables/)
    expect(stripeMock.create).not.toHaveBeenCalled()
  })

  it('createCheckout("stripe") se niega si Stripe no está habilitado', async () => {
    await expect(createCheckout('stripe', args)).rejects.toThrow(/no está habilitado/)
    expect(stripeMock.create).not.toHaveBeenCalled()
    vi.stubEnv('PAYMENT_PROVIDERS', 'flow,stripe')
    await expect(createCheckout('stripe', args)).resolves.toMatchObject({ sessionId: 'cs_test_123' })
  })

  it('createCheckout rechaza proveedores desconocidos', async () => {
    await expect(createCheckout('paypal', args)).rejects.toThrow(/desconocido/)
  })
})

describe('otros helpers de pago', () => {
  it('stripeMinAmount: 600 CLP por defecto, configurable', () => {
    expect(stripeMinAmount()).toBe(600)
    vi.stubEnv('STRIPE_MIN_AMOUNT_CLP', '1000')
    expect(stripeMinAmount()).toBe(1000)
    vi.stubEnv('STRIPE_MIN_AMOUNT_CLP', '-5')
    expect(stripeMinAmount()).toBe(600)
  })

  it('signFlowParams firma los parámetros ordenados e ignora "s"', () => {
    const a = signFlowParams({ b: '2', a: '1', apiKey: 'k' }, 'secret')
    const b = signFlowParams({ apiKey: 'k', a: '1', b: '2', s: 'ignorado' }, 'secret')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(signFlowParams({ a: '1' }, 'otro')).not.toBe(signFlowParams({ a: '1' }, 'secret'))
  })
})
