// % vendido de un evento para la página pública (src/lib/salesProgress.mjs): "60% de entradas vendidas" desde el 50 %
// y "Últimas entradas" desde el 80 %, sobre todas las entradas del evento (no solo las que están a la venta).
import { describe, expect, it } from 'vitest'

import { computeSalesProgress, SOLD_PERCENT_LAST, SOLD_PERCENT_VISIBLE, FEW_REMAINING } from '../../src/lib/salesProgress.mjs'

const NOW = new Date('2026-11-08T15:00:00Z')
const counts = (obj) => new Map(Object.entries(obj).map(([k, v]) => [k, v]))
const progress = (tickets, sold = {}, pending = {}) => computeSalesProgress(tickets, { sold: counts(sold), pending: counts(pending), now: NOW })

describe('computeSalesProgress', () => {
  it('umbrales del producto', () => {
    expect([SOLD_PERCENT_VISIBLE, SOLD_PERCENT_LAST, FEW_REMAINING]).toEqual([50, 80, 10])
  })

  it('una entrada: % hacia abajo y lo que queda (descontando reservas en checkout)', () => {
    expect(progress([{ id: 1, total_quantity: 200 }], { 1: 127 }, { 1: 3 })).toEqual({ sold_percent: 63, remaining: 70 })
    // 99,5 % no es 100 %: nunca exagera
    expect(progress([{ id: 1, total_quantity: 200 }], { 1: 199 })).toEqual({ sold_percent: 99, remaining: 1 })
  })

  it('bajo la mitad no expone el % (sí lo que queda)', () => {
    expect(progress([{ id: 1, total_quantity: 100 }], { 1: 49 })).toEqual({ sold_percent: null, remaining: 51 })
    expect(progress([{ id: 1, total_quantity: 100 }], { 1: 50 })).toEqual({ sold_percent: 50, remaining: 50 })
  })

  it('tandas: la preventa agotada y la general por abrir cuentan en el total', () => {
    const tickets = [
      { id: 1, total_quantity: 100 }, // Preventa 1, agotada
      { id: 2, total_quantity: 100 }, // Preventa 2, a la venta
      { id: 3, total_quantity: 200, init_date: '2026-11-20T03:00:00Z' }, // General, abre después
    ]
    // 100 + 95 de 400: 48 %, quedan 205 (la preventa 2 está casi agotada, pero no son las últimas del evento)
    expect(progress(tickets, { 1: 100, 2: 95 })).toEqual({ sold_percent: null, remaining: 205 })
    expect(progress(tickets, { 1: 100, 2: 100, 3: 130 })).toEqual({ sold_percent: 82, remaining: 70 })
  })

  it('una entrada con la venta cerrada suma solo lo que vendió', () => {
    const tickets = [
      { id: 1, total_quantity: 100, end_date: '2026-11-01T03:00:00Z' }, // preventa cerrada con 60 de 100
      { id: 2, total_quantity: 100 },
    ]
    // 60 + 70 de (60 + 100)
    expect(progress(tickets, { 1: 60, 2: 70 })).toEqual({ sold_percent: 81, remaining: 30 })
  })

  it('sobreventa: el cupo efectivo es lo ya tomado y no pasa del 100 %', () => {
    expect(progress([{ id: 1, total_quantity: 10 }], { 1: 12 })).toEqual({ sold_percent: 100, remaining: 0 })
  })

  it('sin % si alguna entrada que se vende o se venderá es ilimitada', () => {
    expect(progress([{ id: 1, total_quantity: 100 }, { id: 2, total_quantity: null }], { 1: 90 })).toBeNull()
    // Una ilimitada que ya cerró su venta no impide calcular
    expect(progress([{ id: 1, total_quantity: 100 }, { id: 2, total_quantity: null, end_date: '2026-11-01T03:00:00Z' }], { 1: 90, 2: 10 })).toEqual({
      sold_percent: 90,
      remaining: 10,
    })
  })

  it('sin entradas por vender (o sin cupo) no hay avance', () => {
    expect(progress([])).toBeNull()
    expect(progress([{ id: 1, total_quantity: 100, end_date: '2026-11-01T03:00:00Z' }], { 1: 100 })).toBeNull()
    expect(progress([{ id: 1, total_quantity: 0 }])).toBeNull()
  })
})
