// Páginas /comparar/* (src/data/comparisons.ts): solo se indexan con datos verificables (fuente + fecha).
import { describe, expect, it } from 'vitest'

import { COMPARISONS, getComparison, indexableComparisonSlugs, isComparisonVerified, isRowVerified } from '../../src/data/comparisons.ts'

const verifiedRow = { feature: 'Comisión', aitickets: '0%', competitor: '8%', source: { label: 'Tarifas', url: 'https://example.org/tarifas' }, checkedAt: '2026-09-26' }

describe('comparaciones', () => {
  it('una fila solo cuenta como verificada con valor, fuente https y fecha', () => {
    expect(isRowVerified(verifiedRow)).toBe(true)
    expect(isRowVerified({ ...verifiedRow, competitor: null })).toBe(false)
    expect(isRowVerified({ ...verifiedRow, source: undefined })).toBe(false)
    expect(isRowVerified({ ...verifiedRow, source: { label: 'x', url: 'http://example.org' } })).toBe(false)
    expect(isRowVerified({ ...verifiedRow, checkedAt: 'ayer' })).toBe(false)
  })

  it('una página con una sola fila sin verificar no se indexa', () => {
    expect(isComparisonVerified({ slug: 'x', rows: [verifiedRow, { ...verifiedRow, competitor: null }] })).toBe(false)
    expect(isComparisonVerified({ slug: 'x', rows: [] })).toBe(false)
    expect(isComparisonVerified({ slug: 'x', rows: [verifiedRow] })).toBe(true)
  })

  it('indexableComparisonSlugs solo incluye comparaciones totalmente verificadas', () => {
    const indexable = indexableComparisonSlugs()
    for (const slug of indexable) expect(isComparisonVerified(getComparison(slug))).toBe(true)
    for (const c of COMPARISONS.filter((c) => !indexable.includes(c.slug))) expect(isComparisonVerified(c)).toBe(false)
  })

  it('ningún texto público contiene TODO', () => {
    expect(JSON.stringify(COMPARISONS)).not.toMatch(/TODO/)
  })
})
