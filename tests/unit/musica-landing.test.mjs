// Landing de música en vivo (/ticketera-musica-en-vivo): la serie de la sección de difusión sale de la cadencia real
// (DEFAULT_CADENCE), la calculadora es la del checkout (priceQuote → fees.mjs), las tandas y los ejemplos cuadran entre
// sí y las preguntas de dinero y plazos son las de PRODUCER_FAQ (fees.mjs / legal.mjs), sin copias a mano.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  AUDIENCES,
  CURVE_DOMAIN,
  CURVE_MOMENTS,
  CURVE_TICKS,
  CURVE_TOTAL,
  LINEUP,
  TIERS,
  curvePath,
  curveScales,
  currentTier,
  lineupLink,
  lineupScales,
  seriesCounts,
  seriesMarks,
  tierState,
} from '../../src/components/landing/musica/musicaLanding.js'
import { priceQuote } from '../../src/components/landing/producerLanding.js'
import { DEFAULT_CADENCE } from '../../src/lib/socialSeriesCadence'
import { MUSICA_FAQ } from '../../src/data/musicaFaq'
import { getLanding } from '../../src/data/landings'
import { MAX_EVENT_FUNCTIONS, PRODUCER_FAQ } from '../../src/data/producerFaq'
import { MAX_FUNCTIONS } from '../../src/lib/functionPattern.mjs'
import { PAYOUT_RELEASE_HOURS, PAYOUT_SCHEDULE_TEXT } from '../../netlify/lib/legal.mjs'
import { LARGE_CAPACITY } from '../../netlify/lib/event-risk.mjs'
import { RESERVE_HOLD_DAYS } from '../../src/lib/producer-api/ledger'

describe('serie automática (§4.8)', () => {
  const marks = seriesMarks(DEFAULT_CADENCE)

  it('va de D-14 al show, un día por posición', () => {
    expect(marks).toHaveLength(15)
    expect(marks[0].label).toBe('D-14')
    expect(marks.at(-1).label).toBe('Show')
  })

  it('historia diaria desde D-daily_from_days y una cada sparse_every_days antes, como planSlots', () => {
    const storyDays = marks.filter((m) => m.story).map((m) => m.day)
    const expected = []
    for (let d = 0; d <= DEFAULT_CADENCE.daily_from_days; d++) expected.push(d)
    for (let d = DEFAULT_CADENCE.sparse_start_days; d <= 14; d += DEFAULT_CADENCE.sparse_every_days) expected.push(d)
    expect(storyDays.sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b))
  })

  it('posts de feed de D-feed_posts_from_days a D-feed_posts_to_days, nunca el día del show', () => {
    const postDays = marks.filter((m) => m.post).map((m) => m.day)
    expect(Math.max(...postDays)).toBe(DEFAULT_CADENCE.feed_posts_from_days)
    expect(Math.min(...postDays)).toBe(DEFAULT_CADENCE.feed_posts_to_days)
    expect(marks.at(-1).post).toBe(false)
  })

  it('con la cadencia por defecto son 10 historias y 7 posts', () => {
    expect(seriesCounts(marks)).toEqual({ stories: 10, posts: 7 })
  })
})

describe('calculadora (§4.9)', () => {
  it('$12.000 → el público paga $13.142 y tú recibes $12.000; absorbido → $12.000 / $10.858', () => {
    expect(priceQuote(12000, 'buyer')).toMatchObject({ buyerPays: 13142, perTicket: 12000 })
    expect(priceQuote(12000, 'producer')).toMatchObject({ buyerPays: 12000, perTicket: 10858 })
  })

  it('$8.000 → $8.762 / $8.000; absorbido → $7.238', () => {
    expect(priceQuote(8000, 'buyer')).toMatchObject({ buyerPays: 8762, perTicket: 8000 })
    expect(priceQuote(8000, 'producer').perTicket).toBe(7238)
  })
})

describe('tandas de ejemplo (§4.1 y §4.4)', () => {
  it('Preventa 1 agotada, Preventa 2 con 38 y General por abrir, en ese orden', () => {
    expect(TIERS.map((t) => t.name)).toEqual(['Preventa 1', 'Preventa 2', 'General'])
    expect(TIERS.map((t) => tierState(t).kind)).toEqual(['soldout', 'selling', 'upcoming'])
    expect(tierState(TIERS[1]).label).toBe('Quedan 38')
    expect(currentTier()?.name).toBe('Preventa 2')
  })

  it('cada tanda es más cara que la anterior', () => {
    TIERS.slice(1).forEach((t, i) => expect(t.price).toBeGreaterThan(TIERS[i].price))
  })
})

describe('curva de un concierto (§4.3)', () => {
  it('el contador sube con cada momento y termina en el total', () => {
    const sold = CURVE_MOMENTS.map((m) => m.sold)
    expect(sold).toEqual([...sold].sort((a, b) => a - b))
    expect(sold.at(-1)).toBe(CURVE_TOTAL)
    expect(CURVE_MOMENTS).toHaveLength(6)
  })

  it('el path queda dentro del gráfico', () => {
    const d = curvePath(640, 380)
    expect(d.startsWith('M')).toBe(true)
    const numbers = d.match(/-?\d+(\.\d+)?/g).map(Number)
    numbers.forEach((n) => {
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThanOrEqual(640)
    })
    const { x } = curveScales(640, 380)
    // "Show" y "+48 h" no quedan pegados en el eje
    expect(x(CURVE_DOMAIN.to) - x(0)).toBeGreaterThan(60)
  })

  it('el final del eje es cuando se libera el cobro (PAYOUT_RELEASE_HOURS de legal.mjs)', () => {
    expect(CURVE_TICKS.at(-1)).toEqual({ day: PAYOUT_RELEASE_HOURS / 24, label: `+${PAYOUT_RELEASE_HOURS} h` })
    expect(CURVE_DOMAIN.to).toBe(PAYOUT_RELEASE_HOURS / 24)
    expect(CURVE_MOMENTS.at(-1).day).toBe(CURVE_DOMAIN.to)
  })
})

describe('tope de fechas (§0.3)', () => {
  it('MAX_EVENT_FUNCTIONS es el MAX_FUNCTIONS de schedule.ts y el cartel lo usa como {maxFunctions}', () => {
    const schedule = readFileSync(new URL('../../src/lib/producer-api/tools/schedule.ts', import.meta.url), 'utf8')
    expect(schedule).toMatch(/import \{ MAX_FUNCTIONS[^}]*\} from "..\/..\/functionPattern.mjs"/)
    expect(MAX_EVENT_FUNCTIONS).toBe(MAX_FUNCTIONS)
    const texts = AUDIENCES.flatMap((a) => a.lines.map((l) => l.text))
    expect(texts.some((t) => t.includes('{maxFunctions}'))).toBe(true)
    expect(texts.join(' ')).not.toMatch(/\b60\b/)
  })
})

describe('links del cartel (§4.5)', () => {
  it('la barra que más vendió va completa y cada link lleva su utm_source', () => {
    const { rows, direct } = lineupScales()
    expect(Math.max(...rows, direct)).toBe(1)
    expect(lineupLink(LINEUP[0])).toBe('aitickets.cl/eventos/festival-ejemplo?utm_source=niebla-norte')
  })
})

describe('MUSICA_FAQ (§4.11)', () => {
  it('la landing es propia (no la genera [landing].astro) y tiene las 16 preguntas de la spec', () => {
    expect(getLanding('ticketera-musica-en-vivo')?.dedicated).toBe(true)
    expect(MUSICA_FAQ).toHaveLength(16)
    expect(new Set(MUSICA_FAQ.map((f) => f.q)).size).toBe(16)
  })

  it('las respuestas de dinero y plazos son las de PRODUCER_FAQ', () => {
    for (const q of ['¿Cuánto cuesta usar AI Tickets?', '¿Cuándo recibo el dinero de mis ventas?', '¿Puedo absorber el cargo por servicio?']) {
      expect(MUSICA_FAQ.find((f) => f.q === q)).toBe(PRODUCER_FAQ.find((f) => f.q === q))
    }
    expect(MUSICA_FAQ.find((f) => f.q === '¿Cuándo recibo el dinero de mis ventas?')?.a).toContain(PAYOUT_SCHEDULE_TEXT)
  })

  it('las reformuladas para música mantienen la respuesta de PRODUCER_FAQ', () => {
    const tour = MUSICA_FAQ.find((f) => f.q === '¿Puedo publicar una gira o varias fechas?')
    expect(tour?.a.startsWith(PRODUCER_FAQ.find((f) => f.q === '¿Puedo publicar varias funciones de una misma obra o show?')?.a ?? '-')).toBe(true)
    const bands = MUSICA_FAQ.find((f) => f.q === '¿Puedo saber cuántas entradas vende cada banda del cartel?')
    expect(bands?.a).toBe(PRODUCER_FAQ.find((f) => f.q === '¿Puedo saber cuántas entradas vende cada promotor?')?.a)
  })

  it('el aviso a la lista de espera ya existe y el aforo grande sale de event-risk.mjs', () => {
    expect(MUSICA_FAQ.find((f) => f.q === '¿Qué pasa cuando se agota?')?.a).toContain('correo automático')
    const big = MUSICA_FAQ.find((f) => f.q === '¿Sirve para un concierto grande?')
    expect(big?.a).toContain(LARGE_CAPACITY.toLocaleString('es-CL'))
    // Lo que retiene fondos es la reserva por riesgo, no los documentos (ledger.ts)
    expect(big?.a).toContain(`${RESERVE_HOLD_DAYS} días`)
    expect(big?.a).not.toMatch(/antes de liberar/)
    expect(big?.terms).toBe(true)
  })
})
