// Cargo al comprador de Passline (src/data/competitor-fees.mjs), usado en /precios (FeeCalculator) y /comparar.
import { describe, expect, it } from 'vitest'

import { PASSLINE_BUYER_FEE, passlineBuyerFeeRate, passlineBuyerTotal } from '../../src/data/competitor-fees.mjs'
import { computeBuyerTotal } from '../../netlify/lib/fees.mjs'
import { getComparison, isComparisonVerified, isRowReported, isRowVerified } from '../../src/data/comparisons.ts'

describe('cargo al comprador de Passline', () => {
  it('15% sobre el precio; 13% para entradas de menos de $15.000', () => {
    expect(PASSLINE_BUYER_FEE.rate).toBe(0.15)
    expect(PASSLINE_BUYER_FEE.reducedRate).toBe(0.13)
    expect(passlineBuyerFeeRate(14999)).toBe(0.13)
    expect(passlineBuyerFeeRate(15000)).toBe(0.15)
    expect(passlineBuyerTotal(10000)).toEqual({ price: 10000, rate: 0.13, fee: 1300, total: 11300 })
    expect(passlineBuyerTotal(20000)).toEqual({ price: 20000, rate: 0.15, fee: 3000, total: 23000 })
    expect(passlineBuyerTotal(0)).toEqual({ price: 0, rate: 0.13, fee: 0, total: 0 })
  })

  it('el comprador paga menos con AI Tickets (8% + IVA del cargo) en todos los tramos', () => {
    // $10.000: Passline $11.300 vs AI Tickets $10.952 → ahorro $348 por entrada
    expect(passlineBuyerTotal(10000).total - computeBuyerTotal(10000).total).toBe(348)
    // $20.000: Passline $23.000 vs AI Tickets $21.904 → ahorro $1.096
    expect(passlineBuyerTotal(20000).total - computeBuyerTotal(20000).total).toBe(1096)
    for (const p of [1000, 5000, 14999, 15000, 50000]) {
      expect(passlineBuyerTotal(p).total).toBeGreaterThan(computeBuyerTotal(p).total)
    }
  })

  it('la fila de /comparar/passline rotula la fuente como informada (sin URL pública) y aclara el IVA', () => {
    const row = getComparison('passline').rows.find((r) => r.feature === 'Cargo para el comprador')
    expect(row.competitor).toBe('15% sobre el precio; 13% en entradas de menos de $15.000')
    expect(row.source.label).toMatch(/informada por Passline a productores \(no publicada en su sitio\), verificada por AI Tickets el 30-09-2026/)
    // Passline no publica la tarifa: no se enlaza a passline.com como si fuera verificable
    expect(row.source.url).toBeUndefined()
    expect(row.checkedAt).toBe('2026-09-30')
    expect(isRowVerified(row)).toBe(false)
    expect(isRowReported(row)).toBe(true)
    expect(row.note).toMatch(/no le sumamos IVA/)
    expect(isComparisonVerified(getComparison('passline'))).toBe(false)
    expect(row.aitickets).toMatch(/8% \+ IVA/)
  })
})
