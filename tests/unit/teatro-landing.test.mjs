// Landing de teatro (/ticketera-teatro): la cartelera de la temporada cuadra paso a paso, los montos del selector de
// funciones y de la calculadora son los del checkout (priceQuote → computeFeeSplit de fees.mjs), el tope de funciones
// sale de MAX_EVENT_FUNCTIONS y las preguntas de dinero y plazos son las de PRODUCER_FAQ (fees.mjs / legal.mjs), sin
// copias a mano.
import { describe, expect, it } from 'vitest'
import {
  LINK_SALES,
  REPARTO,
  SEASON_CAPACITY,
  SEASON_FUNCTIONS,
  SEASON_LAST_STEP,
  SEASON_STEPS,
  THEATRE_CALC_PRICE,
  functionFrom,
  linkScales,
  seasonCells,
  seasonCounters,
  ticketsFor,
} from '../../src/components/landing/teatro/teatroLanding.js'
import { priceQuote } from '../../src/components/landing/producerLanding.js'
import { computeFeeSplit } from '../../netlify/lib/fees.mjs'
import { PAYOUT_SCHEDULE_TEXT } from '../../netlify/lib/legal.mjs'
import { INVITE_AUDIENCES } from '../../netlify/lib/reviews.mjs'
import { INVITE_AUDIENCE_TEXT, TEATRO_FAQ } from '../../src/data/teatroFaq'
import { getLanding } from '../../src/data/landings'
import { PRODUCER_FAQ } from '../../src/data/producerFaq'
import { ORGANIZADORES_FAQ } from '../../src/data/organizadoresFaq'
import { DEFAULT_MAX_PER_PURCHASE } from '../../src/components/Reservation/pricing.js'
import { THEATRE_TESTIMONIAL } from '../../src/data/producerSocialProof'

describe('funciones de ejemplo (§4.3 y §4.4)', () => {
  it('16 funciones de jueves a domingo, del 5 al 29 de noviembre', () => {
    expect(SEASON_FUNCTIONS).toHaveLength(16)
    expect(SEASON_FUNCTIONS[0].label).toBe('Jue 5 nov · 20:30')
    expect(SEASON_FUNCTIONS[1].label).toBe('Vie 6 nov · 20:30')
    expect(SEASON_FUNCTIONS[3].label).toBe('Dom 8 nov · 19:00')
    expect(SEASON_FUNCTIONS.at(-1).label).toBe('Dom 29 nov · 19:00')
    // Calza con el calendario real (2026)
    for (const fn of SEASON_FUNCTIONS) {
      expect(new Date(2026, 10, fn.day).toLocaleDateString('es-CL', { weekday: 'long' })).toBe(fn.weekday)
    }
  })

  it('el selector muestra el precio final con cargo, como el checkout ($10.000 → $10.952; $7.000 → $7.666; $6.000 → $6.571)', () => {
    const thursday = SEASON_FUNCTIONS[4]
    const tickets = ticketsFor(thursday)
    expect(tickets.map((t) => t.final)).toEqual([10952, 7666, 6571])
    tickets.forEach((t) => expect(t.final).toBe(computeFeeSplit(t.price).total))
    expect(functionFrom(thursday)).toBe('Desde $6.571')
  })

  it('el jueves popular no aplica al estreno ni a los otros días', () => {
    expect(ticketsFor(SEASON_FUNCTIONS[0]).map((t) => t.id)).toEqual(['general', 'estudiante'])
    expect(ticketsFor(SEASON_FUNCTIONS[1]).map((t) => t.id)).toEqual(['general', 'estudiante'])
    expect(functionFrom(SEASON_FUNCTIONS[0])).toBeNull()
    expect(functionFrom(SEASON_FUNCTIONS[2])).toBeNull()
  })
})

describe('la temporada (§4.4)', () => {
  it('cinco pasos, de Estreno a Bajó el telón, con 16 funciones cada uno', () => {
    expect(SEASON_STEPS.map((s) => s.label)).toEqual(['Estreno', 'Semana 2', 'Semana 3', 'Últimas funciones', 'Bajó el telón'])
    SEASON_STEPS.forEach((s) => {
      expect(s.sold).toHaveLength(16)
      s.sold.forEach((n) => {
        expect(n).toBeGreaterThanOrEqual(0)
        expect(n).toBeLessThanOrEqual(SEASON_CAPACITY)
      })
    })
  })

  it('las funciones realizadas no cambian su venta y los contadores solo suben', () => {
    for (let i = 1; i < SEASON_STEPS.length; i++) {
      const prev = SEASON_STEPS[i - 1]
      const cur = SEASON_STEPS[i]
      expect(cur.done).toBeGreaterThanOrEqual(prev.done)
      for (let f = 0; f < prev.done; f++) expect(cur.sold[f]).toBe(prev.sold[f])
      expect(seasonCounters(i).sold).toBeGreaterThanOrEqual(seasonCounters(i - 1).sold)
    }
  })

  it('Estreno: el jueves del estreno agotado, el viernes con las últimas y ninguna realizada', () => {
    const cells = seasonCells(0)
    expect(cells[0].state).toBe('soldout')
    expect(cells[1].state).toBe('last')
    expect(cells.filter((c) => c.state === 'done')).toHaveLength(0)
    expect(seasonCounters(0).reviews).toBeNull()
    expect(cells[0].text).toBe('Jueves 5 de noviembre, 20:30, agotada')
  })

  it('Semana 2: la semana 1 realizada y lista para retirar', () => {
    const cells = seasonCells(1)
    expect(cells.slice(0, 4).every((c) => c.state === 'done' && c.payout)).toBe(true)
    expect(cells.slice(4).some((c) => c.payout)).toBe(false)
  })

  it('Últimas funciones: la semana 4 con viernes, sábado y domingo agotados y el jueves con las últimas', () => {
    const week4 = seasonCells(3).slice(12)
    expect(week4.map((c) => c.state)).toEqual(['last', 'soldout', 'soldout', 'soldout'])
  })

  it('Semana 3: solo el jueves que se afloja lleva la barra baja (marfil), en ningún otro paso', () => {
    const low = SEASON_STEPS.flatMap((_, step) => seasonCells(step).filter((c) => c.low).map((c) => `${step}:${c.id}`))
    expect(low).toEqual(['2:f9'])
    expect(seasonCells(2)[8].fill).toBeLessThan(0.4)
  })

  it('Bajó el telón: todo realizado y solo lo de la última semana listo para retirar', () => {
    const cells = seasonCells(SEASON_LAST_STEP)
    expect(cells.every((c) => c.state === 'done')).toBe(true)
    expect(cells.filter((c) => c.payout).map((c) => c.week)).toEqual([3, 3, 3, 3])
    expect(seasonCounters(SEASON_LAST_STEP).done).toBe(16)
  })
})

describe('calculadora del programa (§4.7)', () => {
  it('$10.000 → público $10.952 / compañía $10.000; absorbido → $10.000 / $9.048', () => {
    expect(THEATRE_CALC_PRICE.default).toBe(10000)
    expect(priceQuote(10000, 'buyer')).toMatchObject({ buyerPays: 10952, perTicket: 10000 })
    expect(priceQuote(10000, 'producer')).toMatchObject({ buyerPays: 10000, perTicket: 9048 })
  })

  it('$7.000 → $7.666 / $7.000; absorbido → $7.000 / $6.334', () => {
    expect(priceQuote(7000, 'buyer')).toMatchObject({ buyerPays: 7666, perTicket: 7000 })
    expect(priceQuote(7000, 'producer')).toMatchObject({ buyerPays: 7000, perTicket: 6334 })
  })
})

describe('reparto y links (§4.2 y §4.3)', () => {
  it('el tope de funciones se completa con MAX_EVENT_FUNCTIONS (nada escrito a mano)', () => {
    const who = REPARTO.map((r) => r.who).join(' ')
    expect(who).toContain('{maxFunctions}')
    expect(who).not.toMatch(/\b60\b/)
    expect(REPARTO.find((r) => r.id === 'plata')?.star).toBe(true)
  })

  it('la barra que más vendió va completa', () => {
    const { rows, direct } = linkScales()
    expect(Math.max(...rows, direct)).toBe(1)
    expect(rows).toHaveLength(LINK_SALES.length)
  })
})

describe('TEATRO_FAQ (§4.10)', () => {
  it('la landing es propia (no la genera [landing].astro) y tiene las 18 preguntas de la spec', () => {
    expect(getLanding('ticketera-teatro')?.dedicated).toBe(true)
    expect(TEATRO_FAQ).toHaveLength(18)
    expect(new Set(TEATRO_FAQ.map((f) => f.q)).size).toBe(18)
  })

  it('las respuestas de dinero y plazos son las de PRODUCER_FAQ', () => {
    for (const q of ['¿Cuánto cuesta usar AI Tickets?', '¿Cuándo recibo el dinero de mis ventas?', '¿Puedo absorber el cargo por servicio?']) {
      expect(TEATRO_FAQ.find((f) => f.q === q)).toBe(PRODUCER_FAQ.find((f) => f.q === q))
    }
    expect(TEATRO_FAQ.find((f) => f.q === '¿Cuándo recibo el dinero de mis ventas?')?.a).toContain(PAYOUT_SCHEDULE_TEXT)
  })

  it('las reformuladas mantienen la respuesta de origen', () => {
    const teaser = TEATRO_FAQ.find((f) => f.q === '¿Puedo poner el teaser de la obra como portada?')
    expect(teaser?.a).toBe(ORGANIZADORES_FAQ.find((f) => f.q === '¿Puedo poner un video como portada del evento?')?.a)
    const reviews = TEATRO_FAQ.find((f) => f.q === '¿Cómo funcionan las reseñas?')
    expect(reviews?.a.endsWith('En la página de la obra se muestran cuando termina la temporada.')).toBe(true)
    const first = TEATRO_FAQ.find((f) => f.q === '¿Me ayudan a publicar mi primera obra?')
    expect(first?.a).toBe(PRODUCER_FAQ.find((f) => f.q === '¿Me ayudan a publicar mi primer evento?')?.a)
  })

  it('el máximo por compra sale de DEFAULT_MAX_PER_PURCHASE y no promete butacas numeradas', () => {
    expect(TEATRO_FAQ.find((f) => f.q === '¿Puedo vender funciones para colegios o grupos?')?.a).toContain(`${DEFAULT_MAX_PER_PURCHASE} entradas`)
    expect(TEATRO_FAQ.find((f) => f.q === '¿Tienen butacas numeradas?')?.a.startsWith('No.')).toBe(true)
  })

  it('la invitación a la próxima obra usa las audiencias que existen (INVITE_AUDIENCES)', () => {
    expect(Object.keys(INVITE_AUDIENCES)).toEqual(expect.arrayContaining(['all', 'checked_in', 'promoters']))
    expect(INVITE_AUDIENCE_TEXT).toBe('todos los asistentes, a quienes ingresaron o a quienes calificaron con 4 o 5 estrellas')
    expect(TEATRO_FAQ.find((f) => f.q === '¿Puedo invitar a mi público a la próxima obra?')?.a).toContain(INVITE_AUDIENCE_TEXT)
  })
})

describe('testimonio (§4.9)', () => {
  it('no hay cita inventada: sin testimonio real la sección no se muestra', () => {
    expect(THEATRE_TESTIMONIAL).toBeNull()
  })
})
