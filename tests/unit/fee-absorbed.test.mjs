// Cargo por servicio absorbido por el productor (events.fee_absorbed / event_orders.fee_absorbed).
import { describe, expect, it } from 'vitest'
import { computeBuyerTotal, computeFeeSplit, orderBuyerBreakdown, orderFeeBreakdown, FEE_INCLUDED_NOTE, SERVICE_FEE_NOTE } from '../../netlify/lib/fees.mjs'
import { computeDiscountedTotals } from '../../netlify/lib/discounts.mjs'
import { expectedPaymentAmounts } from '../../netlify/lib/orders.mjs'
import { computeTotals, computeTotalsWithDiscount, feeNoteFor, isFeeAbsorbed } from '../../src/components/Reservation/pricing.js'
import { renderTicketsEmail } from '../../netlify/lib/emails/index.mjs'

describe('computeFeeSplit', () => {
  it('sin absorción: igual que computeBuyerTotal y el productor recibe el subtotal', () => {
    const split = computeFeeSplit(10000)
    const buyer = computeBuyerTotal(10000)
    expect(split).toEqual({ ...buyer, producerNet: 10000, absorbed: false })
    expect(split.total).toBe(10952)
  })

  it('con absorción: el comprador paga el subtotal y el cargo sale de lo del productor', () => {
    expect(computeFeeSplit(10000, { absorbed: true })).toEqual({
      subtotal: 10000, feeNet: 800, feeIva: 152, fee: 952, total: 10000, producerNet: 9048, absorbed: true,
    })
  })

  it('gratis: sin cargo en ambos modos', () => {
    expect(computeFeeSplit(0, { absorbed: true })).toMatchObject({ total: 0, fee: 0, producerNet: 0 })
  })
})

describe('computeDiscountedTotals con cargo absorbido', () => {
  it('sin opción: misma forma y montos que antes', () => {
    const t = computeDiscountedTotals(20000, { kind: 'percent', value: 10 })
    expect(t).toEqual({ grossSubtotal: 20000, discountAmount: 2000, subtotal: 18000, feeNet: 1440, feeIva: 274, fee: 1714, total: 19714 })
  })

  it('con absorción: el cargo va sobre el subtotal descontado y total = subtotal', () => {
    const t = computeDiscountedTotals(20000, { kind: 'percent', value: 10 }, { feeAbsorbed: true })
    expect(t).toMatchObject({ discountAmount: 2000, subtotal: 18000, feeNet: 1440, feeIva: 274, total: 18000, producerNet: 16286, feeAbsorbed: true })
  })

  it('la orden guardada cuadra con lo que cobra Flow', () => {
    const t = computeDiscountedTotals(15000, null, { feeAbsorbed: true })
    const order = { amount: t.producerNet, ticket_fee: t.feeNet, service_fee_tax: t.feeIva, fee_absorbed: true }
    expect(expectedPaymentAmounts(order)).toContain(t.total)
    expect(t.total).toBe(15000)
  })
})

describe('vista del comprador (pricing.js)', () => {
  it('nota junto al precio', () => {
    expect(feeNoteFor({ fee_absorbed: true })).toBe(FEE_INCLUDED_NOTE)
    expect(feeNoteFor({})).toBe(SERVICE_FEE_NOTE)
    expect(isFeeAbsorbed({ fee_absorbed: 'true' })).toBe(false)
  })

  it('totales con y sin absorción', () => {
    const lines = [{ total: 10000, quantity: 2 }]
    expect(computeTotals(lines).total).toBe(10952)
    expect(computeTotals(lines, { feeAbsorbed: true }).total).toBe(10000)
    const withCode = computeTotalsWithDiscount(lines, { kind: 'fixed', value: 1000 }, { feeAbsorbed: true })
    expect(withCode).toMatchObject({ subtotal: 9000, total: 9000, feeAbsorbed: true, quantity: 2 })
    expect(computeTotalsWithDiscount(lines, null).feeAbsorbed).toBeUndefined()
  })
})

describe('orderBuyerBreakdown (comprobantes)', () => {
  it('orden normal: igual que orderFeeBreakdown', () => {
    const order = { amount: 10000, ticket_fee: 800, service_fee_tax: 152 }
    expect(orderBuyerBreakdown(order)).toEqual({ ...orderFeeBreakdown(order), feeIncluded: false })
  })

  it('orden con cargo absorbido: subtotal = total pagado, sin cargo encima', () => {
    const b = orderBuyerBreakdown({ amount: 9048, ticket_fee: 800, service_fee_tax: 152, fee_absorbed: true })
    expect(b).toMatchObject({ subtotal: 10000, total: 10000, feeIncluded: true, feeNet: 800, feeIva: 152 })
  })

  it('el correo muestra "cargo incluido" y no suma el cargo', async () => {
    const { html } = await renderTicketsEmail({
      eventName: 'Fiesta',
      ticketLines: [{ name: 'General', quantity: 1, unitPrice: 10000 }],
      subtotal: 10000, feeNet: 800, feeIva: 152, fee: 952, feeIncluded: true, total: 10000,
      orderId: 'o1', orderUrl: 'https://aitickets.test/order/o1',
    })
    expect(html).toContain(FEE_INCLUDED_NOTE)
    expect(html).not.toContain('Cargo por servicio (8%)')
    expect(html).toContain('$10.000')
  })
})
