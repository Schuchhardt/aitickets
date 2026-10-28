// Landing de stand-up (/ticketera-stand-up): el mapa de sala se llena con un orden estable que cubre cada asiento una
// vez, y las preguntas de dinero y plazos son las mismas de PRODUCER_FAQ (fees.mjs / legal.mjs), sin copias a mano.
import { describe, expect, it } from 'vitest'
import { HERO_SEATS, heroSeatSold, seatRanks } from '../../src/components/landing/standup/standupLanding.js'
import { STANDUP_FAQ } from '../../src/data/standupFaq'
import { PRODUCER_FAQ } from '../../src/data/producerFaq'
import { PAYOUT_SCHEDULE_TEXT } from '../../netlify/lib/legal.mjs'

describe('seatRanks', () => {
  it.each([
    [10, 20, 10],
    [8, 12, 6],
  ])('%i × %i con pasillo en %i: cada asiento tiene un turno único y el pasillo queda vacío', (rows, cols, aisle) => {
    const ranks = seatRanks(rows, cols, aisle)
    expect(ranks).toHaveLength(rows * (cols + 1))
    ranks.forEach((rank, i) => {
      if (i % (cols + 1) === aisle) expect(rank).toBe(-1)
    })
    const seats = ranks.filter((r) => r >= 0).sort((a, b) => a - b)
    expect(seats).toEqual(Array.from({ length: rows * cols }, (_, i) => i))
  })

  it('es estable: el mismo orden en cada llamada (servidor y navegador)', () => {
    expect(seatRanks(10, 20, 10)).toEqual(seatRanks(10, 20, 10))
  })
})

it('la card del hero muestra exactamente los vendidos que dice', () => {
  const sold = Array.from({ length: HERO_SEATS.total }, (_, i) => heroSeatSold(i)).filter(Boolean).length
  expect(sold).toBe(HERO_SEATS.sold)
})

describe('STANDUP_FAQ', () => {
  it('las respuestas de dinero y plazos son las de PRODUCER_FAQ', () => {
    for (const q of ['¿Cuánto cuesta usar AI Tickets?', '¿Cuándo recibo el dinero de mis ventas?', '¿Puedo absorber el cargo por servicio?']) {
      expect(STANDUP_FAQ.find((f) => f.q === q)).toBe(PRODUCER_FAQ.find((f) => f.q === q))
    }
    expect(STANDUP_FAQ.find((f) => f.q === '¿Cuándo recibo el dinero de mis ventas?')?.a).toContain(PAYOUT_SCHEDULE_TEXT)
  })

  it('la publicación automática dice lo que hace en Facebook, TikTok y el reel', () => {
    const social = STANDUP_FAQ.find((f) => f.q === '¿Cómo funciona la publicación automática en redes?')
    expect(social?.a).toMatch(/página de Facebook o tu TikTok/)
    // El reel usa el video del evento: AI Tickets no lo genera
    expect(social?.a).toMatch(/video vertical corto/)
    expect(social?.a).not.toMatch(/todavía no/)
  })
})
