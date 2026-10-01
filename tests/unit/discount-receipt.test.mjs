// El comprobante del correo de entradas muestra la línea "Descuento (CODIGO)".
import { describe, expect, it } from 'vitest'
import { renderTicketsEmail } from '../../netlify/lib/emails/index.mjs'

const base = {
  customerName: 'Ana',
  eventName: 'Fiesta',
  ticketLines: [{ name: 'General', quantity: 2, unitPrice: 10000 }],
  orderId: 'o-1',
  orderUrl: 'https://aitickets.cl/order/o-1',
}

describe('correo de entradas con descuento', () => {
  it('muestra la línea de descuento y el subtotal descontado', async () => {
    const { html, text } = await renderTicketsEmail({ ...base, subtotal: 15000, discountCode: 'PROMO25', discountAmount: 5000, feeNet: 1200, feeIva: 228, total: 16428 })
    expect(html).toContain('Descuento (PROMO25)')
    expect(html).toContain('-$5.000')
    expect(html).toContain('$15.000')
    expect(text).toContain('Descuento (PROMO25)')
  })

  it('100% de descuento: descuento + total gratis', async () => {
    const { html } = await renderTicketsEmail({ ...base, subtotal: 0, discountCode: 'FREE', discountAmount: 20000, feeNet: 0, feeIva: 0, total: 0 })
    expect(html).toContain('Descuento (FREE)')
    expect(html).toContain('Gratis')
  })

  it('sin descuento no hay línea', async () => {
    const { html } = await renderTicketsEmail({ ...base, subtotal: 20000, feeNet: 1600, feeIva: 304, total: 21904 })
    expect(html).not.toContain('Descuento')
  })
})
