// Fuente única del cargo por servicio (netlify/lib/fees.mjs): 10% del subtotal + IVA (19%) del cargo.
import { describe, expect, it } from 'vitest'

import {
  IVA_RATE,
  SERVICE_FEE_LABEL,
  SERVICE_FEE_NOTE,
  SERVICE_FEE_RATE,
  SERVICE_FEE_TAX_LABEL,
  computeBuyerTotal,
  computeServiceFee,
  computeServiceFeeTax,
  orderFeeBreakdown,
} from '../../netlify/lib/fees.mjs'
import * as tickets from '../../netlify/lib/tickets.mjs'
import * as pricing from '../../src/components/Reservation/pricing.js'

describe('computeServiceFee', () => {
  it('10% del subtotal + 19% de IVA sobre el cargo, ambos redondeados a pesos', () => {
    expect(SERVICE_FEE_RATE).toBe(0.1)
    expect(IVA_RATE).toBe(0.19)
    expect(computeServiceFee(8000)).toEqual({ net: 800, iva: 152, total: 952 })
    expect(computeServiceFee(15000)).toEqual({ net: 1500, iva: 285, total: 1785 })
    // 10% de 12.345 = 1.234,5 → 1.235; IVA 234,65 → 235
    expect(computeServiceFee(12345)).toEqual({ net: 1235, iva: 235, total: 1470 })
    // El IVA se calcula sobre el cargo ya redondeado (no sobre el 11,9% del subtotal)
    expect(computeServiceFee(1)).toEqual({ net: 0, iva: 0, total: 0 })
    expect(computeServiceFee(5)).toEqual({ net: 1, iva: 0, total: 1 })
    expect(computeServiceFee(30)).toEqual({ net: 3, iva: 1, total: 4 })
  })

  it('subtotal 0, negativo o inválido: sin cargo', () => {
    for (const v of [0, -100, NaN, undefined, null, 'abc']) {
      expect(computeServiceFee(v)).toEqual({ net: 0, iva: 0, total: 0 })
    }
  })

  it('computeServiceFeeTax es el 19% redondeado del cargo neto', () => {
    expect(computeServiceFeeTax(800)).toBe(152)
    expect(computeServiceFeeTax(1000)).toBe(190)
    expect(computeServiceFeeTax(0)).toBe(0)
    expect(computeServiceFeeTax(-5)).toBe(0)
  })

  it('siempre enteros y total = subtotal + neto + IVA', () => {
    for (let subtotal = 0; subtotal <= 200000; subtotal += 777) {
      const t = computeBuyerTotal(subtotal)
      expect(Number.isInteger(t.feeNet) && Number.isInteger(t.feeIva) && Number.isInteger(t.total)).toBe(true)
      expect(t.total).toBe(subtotal + t.feeNet + t.feeIva)
      expect(t.fee).toBe(t.feeNet + t.feeIva)
    }
  })
})

describe('orderFeeBreakdown', () => {
  it('lee amount / ticket_fee / service_fee_tax de la orden', () => {
    expect(orderFeeBreakdown({ amount: 8000, ticket_fee: 800, service_fee_tax: 152 })).toEqual({ subtotal: 8000, feeNet: 800, feeIva: 152, fee: 952, total: 8952 })
  })

  it('órdenes antiguas (service_fee_tax 0) quedan sin IVA', () => {
    expect(orderFeeBreakdown({ amount: 8000, ticket_fee: 800, service_fee_tax: 0, total_payment: 8800 })).toMatchObject({ feeIva: 0, total: 8800 })
  })

  it('sin la columna: deduce el IVA si lo pagado lo incluye', () => {
    expect(orderFeeBreakdown({ amount: 8000, ticket_fee: 800, total_payment: 8952 })).toMatchObject({ feeIva: 152, total: 8952 })
    expect(orderFeeBreakdown({ amount: 8000, ticket_fee: 800, total_payment: 8800 })).toMatchObject({ feeIva: 0, total: 8800 })
    expect(orderFeeBreakdown({ amount: 8000, ticket_fee: 800 })).toMatchObject({ feeIva: 0, total: 8800 })
  })

  it('cortesías y gratis: todo en 0', () => {
    expect(orderFeeBreakdown({ amount: 0, ticket_fee: 0, service_fee_tax: 0 })).toEqual({ subtotal: 0, feeNet: 0, feeIva: 0, fee: 0, total: 0 })
  })
})

describe('una sola regla en servidor y navegador', () => {
  it('tickets.mjs y pricing.js reexportan la misma función de fees.mjs', () => {
    expect(tickets.computeServiceFee).toBe(computeServiceFee)
    expect(tickets.computeBuyerTotal).toBe(computeBuyerTotal)
    expect(pricing.computeBuyerTotal).toBe(computeBuyerTotal)
    expect(pricing.SERVICE_FEE_RATE).toBe(SERVICE_FEE_RATE)
  })

  it('etiquetas en español', () => {
    expect(SERVICE_FEE_LABEL).toBe('Cargo por servicio (10%)')
    expect(SERVICE_FEE_TAX_LABEL).toBe('IVA del cargo (19%)')
    expect(SERVICE_FEE_NOTE).toBe('+ cargo por servicio 10% + IVA')
  })
})
