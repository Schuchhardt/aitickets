// Precios mostrados al comprador (src/components/Reservation/pricing.js). El checkout, /precios
// (FeeCalculator) y el servidor usan la misma regla (netlify/lib/fees.mjs): cargo por servicio = 10% del
// subtotal, redondeado, más IVA (19%) de ese cargo, redondeado.
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MAX_PER_PURCHASE,
  IVA_RATE,
  SERVICE_FEE_RATE,
  buildSelectedLines,
  computeTotals,
  findTicketFunction,
  formatCLP,
  formatFunctionLabel,
  isValidEmail,
  maxPerPurchase,
} from '../../src/components/Reservation/pricing.js'

const tickets = [
  { id: 1, ticket_name: 'General', price: 15000, event_date_id: null },
  { id: 2, ticket_name: 'VIP', price: 25000.4, event_date_id: 10 },
  { id: 3, ticket_name: 'Liberada', price: 0 },
]
const dates = [{ id: 10, date: '2026-10-17', start_time: '20:00:00', venue: { name: 'Teatro Caupolicán' } }]

describe('computeTotals', () => {
  it('cargo 10% + IVA 19% del cargo: 15.000 → 1.500 + 285 = 16.785', () => {
    expect(SERVICE_FEE_RATE).toBe(0.1)
    expect(IVA_RATE).toBe(0.19)
    expect(computeTotals([{ total: 15000, quantity: 1 }])).toEqual({ subtotal: 15000, feeNet: 1500, feeIva: 285, fee: 1785, total: 16785, quantity: 1 })
  })

  it('ejemplo de /precios: $8.000 → cargo $800 + IVA $152 = $8.952', () => {
    expect(computeTotals([{ total: 8000, quantity: 1 }])).toMatchObject({ feeNet: 800, feeIva: 152, total: 8952 })
  })

  it('redondea cargo e IVA a pesos enteros (CLP no tiene decimales)', () => {
    expect(computeTotals([{ total: 9995, quantity: 1 }])).toMatchObject({ feeNet: 1000, feeIva: 190, total: 11185 })
    expect(computeTotals([{ total: 9994, quantity: 1 }])).toMatchObject({ feeNet: 999, feeIva: 190, total: 11183 })
    for (const subtotal of [1, 3333, 7777, 12345]) {
      const t = computeTotals([{ total: subtotal, quantity: 1 }])
      expect(Number.isInteger(t.feeNet)).toBe(true)
      expect(Number.isInteger(t.feeIva)).toBe(true)
      expect(t.total).toBe(subtotal + t.feeNet + t.feeIva)
      expect(t.fee).toBe(t.feeNet + t.feeIva)
    }
  })

  it('una orden gratis no tiene cargo ni IVA', () => {
    expect(computeTotals([{ total: 0, quantity: 3 }])).toEqual({ subtotal: 0, feeNet: 0, feeIva: 0, fee: 0, total: 0, quantity: 3 })
    expect(computeTotals([])).toEqual({ subtotal: 0, feeNet: 0, feeIva: 0, fee: 0, total: 0, quantity: 0 })
  })

  it('suma varias líneas (el cargo se calcula sobre el subtotal de la compra)', () => {
    expect(computeTotals([{ total: 30000, quantity: 2 }, { total: 25000, quantity: 1 }])).toEqual({ subtotal: 55000, feeNet: 5500, feeIva: 1045, fee: 6545, total: 61545, quantity: 3 })
  })
})

describe('buildSelectedLines', () => {
  it('arma líneas con precio entero e ignora entradas desconocidas o en 0', () => {
    const lines = buildSelectedLines({ 1: 2, 2: 1, 3: 0, 99: 4 }, tickets, dates)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ id: 1, name: 'General', quantity: 2, price: 15000, total: 30000, functionLabel: '' })
    expect(lines[1]).toMatchObject({ id: 2, price: 25000, total: 25000, functionLabel: 'Sáb 17 oct · 20:00' })
  })

  it('el total mostrado es el mismo que calcularía el servidor', () => {
    const totals = computeTotals(buildSelectedLines({ 1: 2, 2: 1 }, tickets, dates))
    expect(totals).toEqual({ subtotal: 55000, feeNet: 5500, feeIva: 1045, fee: 6545, total: 61545, quantity: 3 })
  })
})

describe('helpers', () => {
  it('maxPerPurchase usa max_quantity o 10 por defecto', () => {
    expect(maxPerPurchase({ max_quantity: 4 })).toBe(4)
    expect(maxPerPurchase({ max_quantity: 0 })).toBe(DEFAULT_MAX_PER_PURCHASE)
    expect(maxPerPurchase({})).toBe(10)
    expect(maxPerPurchase(null)).toBe(10)
  })

  it('formatFunctionLabel y findTicketFunction', () => {
    expect(formatFunctionLabel(dates[0])).toBe('Sáb 17 oct · 20:00 · Teatro Caupolicán')
    expect(formatFunctionLabel({ date: 'x' })).toBe('')
    expect(findTicketFunction(tickets[1], dates)).toBe(dates[0])
    expect(findTicketFunction(tickets[0], dates)).toBeNull()
  })

  it('formatCLP usa separador de miles chileno', () => {
    expect(formatCLP(16500)).toBe('$16.500')
    expect(formatCLP('abc')).toBe('$0')
  })

  it('isValidEmail', () => {
    expect(isValidEmail('ana@productora.cl')).toBe(true)
    expect(isValidEmail(' ana@productora.cl ')).toBe(true)
    expect(isValidEmail('ana@productora')).toBe(false)
    expect(isValidEmail('ana productora@x.cl')).toBe(false)
    expect(isValidEmail(`${'a'.repeat(250)}@x.cl`)).toBe(false)
  })
})
