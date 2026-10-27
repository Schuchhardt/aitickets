// Landing de productores (/organizadores): la calculadora coincide al peso con el checkout (fees.mjs) y el calendario
// de difusión de ejemplo sigue la cadencia real (socialSeriesCadence.ts).
import { describe, expect, it } from 'vitest'
import { computeFeeSplit } from '../../netlify/lib/fees.mjs'
import { MK_SHOW, MK_TODAY, marketingPostCount, marketingWeek, parseAmount, priceQuote } from '../../src/components/landing/producerLanding.js'

describe('priceQuote', () => {
  it('ejemplo de la spec: $10.000 → comprador $10.952 / recibes $10.000; absorbido → recibes $9.048', () => {
    expect(priceQuote(10000, 'buyer')).toMatchObject({ fee: 800, iva: 152, buyerPays: 10952, perTicket: 10000 })
    expect(priceQuote(10000, 'producer')).toMatchObject({ fee: 800, iva: 152, buyerPays: 10000, perTicket: 9048 })
  })

  it.each([1000, 4000, 10000, 15990, 100000])('$%i: idéntico al backend en ambos modos', (price) => {
    for (const absorbed of [false, true]) {
      const backend = computeFeeSplit(price, { absorbed })
      const quote = priceQuote(price, absorbed ? 'producer' : 'buyer', 100)
      expect(quote.buyerPays).toBe(backend.total)
      expect(quote.perTicket).toBe(backend.producerNet)
      expect(quote.total).toBe(backend.producerNet * 100)
    }
  })

  it('entradas gratis: sin cargo', () => {
    expect(priceQuote(0, 'buyer', 50)).toMatchObject({ fee: 0, iva: 0, buyerPays: 0, perTicket: 0, total: 0 })
  })
})

describe('parseAmount', () => {
  it('lee montos con puntos, signo y espacios, acotados al máximo', () => {
    expect(parseAmount('10.000', 1e7)).toBe(10000)
    expect(parseAmount('$ 4500', 1e7)).toBe(4500)
    expect(parseAmount('', 1e7)).toBe(0)
    expect(parseAmount('99999999', 100000)).toBe(100000)
  })
})

describe('marketingWeek', () => {
  const times = { daily: '19:30', eventDay: '09:00' }

  it('historia diaria hasta el día de la función (a las 09:00 ese día) y post diario hasta el día anterior', () => {
    const week = marketingWeek({ story: true, post: true }, times)
    expect(week[MK_SHOW].slots).toEqual([{ kind: 'story', label: 'Historia', time: '09:00', state: 'future' }])
    expect(week[MK_SHOW - 1].slots.map((s) => s.kind)).toEqual(['story', 'post'])
    expect(week[MK_SHOW + 1].slots).toEqual([])
    expect(week[0].slots.every((s) => s.state === 'past')).toBe(true)
    expect(week[MK_TODAY].slots.every((s) => s.state === 'today')).toBe(true)
    expect(marketingPostCount(week)).toBe(MK_SHOW + 1 + MK_SHOW)
  })

  it('con dos funciones (viernes y sábado), cada una con su historia de la mañana y posts hasta antes de la primera', () => {
    const week = marketingWeek({ story: true, post: true }, times, [MK_SHOW, MK_SHOW + 1])
    expect(week[MK_SHOW + 1].isShow).toBe(true)
    expect(week[MK_SHOW + 1].slots).toEqual([{ kind: 'story', label: 'Historia', time: '09:00', state: 'future' }])
    expect(week[MK_SHOW + 2].slots).toEqual([])
    expect(marketingPostCount(week)).toBe(MK_SHOW + 2 + MK_SHOW)
  })

  it('los switches quitan sus publicaciones', () => {
    expect(marketingPostCount(marketingWeek({ story: false, post: true }, times))).toBe(MK_SHOW)
    expect(marketingPostCount(marketingWeek({ story: false, post: false }, times))).toBe(0)
  })
})
