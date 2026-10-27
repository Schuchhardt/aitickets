// Landing de fiestas (/ticketera-fiestas): la preventa por etapas (playPresale) respeta cupos, abre una etapa a la vez
// y en orden, se detiene solo cuando la siguiente abre después y cuadra con los casos de verificación de la spec; la
// fecha de la fiesta de ejemplo es un sábado ≥ 28 días después en hora de Chile con aperturas los lunes 20:00; los
// rótulos usan formatSaleStart; los totales de los promotores salen de computeDiscountedTotals; el "Quedan N" de la
// historia D-7 está bajo el umbral de escasez; la hora de cobro es término + PAYOUT_RELEASE_HOURS; la calculadora es la
// del checkout (priceQuote → fees.mjs) y las preguntas de dinero y plazos son las de PRODUCER_FAQ, sin copias a mano.
import { describe, expect, it } from 'vitest'
import {
  PARTY_CAPACITY,
  PRESALE_DEMAND,
  PRESALE_FIRST_DAY,
  STAGE_OPEN_DAYS,
  STORY_FRAMES,
  bandText,
  buyerRows,
  defaultStages,
  isScarce,
  openingLabel,
  partyDate,
  partySchedule,
  pauseCopy,
  playPresale,
  promoChannels,
  promoLink,
  promoSheet,
  sortPromos,
} from '../../src/components/landing/fiestas/fiestasLanding.js'
import { priceQuote } from '../../src/components/landing/producerLanding.js'
import { formatSaleStart } from '../../src/components/event/eventView.js'
import { DEFAULT_CADENCE } from '../../src/lib/socialSeriesCadence'
import { pieceText } from '../../src/lib/socialSeriesRender'
import { FIESTAS_FAQ } from '../../src/data/fiestasFaq'
import { getLanding } from '../../src/data/landings'
import { PRODUCER_FAQ } from '../../src/data/producerFaq'
import { DISCOUNT_CODE_RE, computeDiscountedTotals } from '../../netlify/lib/discounts.mjs'
import { PAYOUT_RELEASE_HOURS, PAYOUT_SCHEDULE_TEXT } from '../../netlify/lib/legal.mjs'

/** Juega la preventa tomando siempre la misma decisión en cada pausa */
function playAlways(stages, choice) {
  const choices = []
  let pauses = 0
  for (;;) {
    const result = playPresale(stages, choices)
    if (!result.pause) return { ...result, pauses }
    pauses++
    choices.push(choice)
  }
}
const sumOf = (list) => list.reduce((s, n) => s + n, 0)

describe('la escalera: playPresale (§4.3)', () => {
  const stages = defaultStages(4)

  it('las etapas por defecto y sus aperturas', () => {
    expect(stages.map((s) => [s.name, s.price, s.capacity, s.opensDay])).toEqual([
      ['Preventa 1', 8000, 150, 26],
      ['Preventa 2', 10000, 200, 19],
      ['Preventa 3', 12000, 200, 12],
      ['General', 15000, 150, 5],
    ])
    expect(defaultStages(3).map((s) => s.name)).toEqual(['Preventa 1', 'Preventa 2', 'General'])
    expect(defaultStages(2).map((s) => s.name)).toEqual(['Preventa', 'General'])
    expect(Object.keys(PRESALE_DEMAND)).toHaveLength(PRESALE_FIRST_DAY)
  })

  for (const choice of ['advance', 'wait']) {
    for (const count of [2, 3, 4]) {
      it(`${count} etapas, siempre "${choice}": cupos, una etapa a la vez y en orden`, () => {
        const st = defaultStages(count)
        const r = playAlways(st, choice)
        let last = -1
        for (const f of r.frames) {
          f.sold.forEach((n, i) => expect(n).toBeLessThanOrEqual(st[i].capacity))
          expect(f.status.filter((x) => x === 'available').length).toBeLessThanOrEqual(1)
          // Las etapas abren en orden: la que está a la venta nunca vuelve atrás
          if (f.current >= 0) {
            expect(f.current).toBeGreaterThanOrEqual(last)
            last = f.current
          }
        }
        expect(r.sold).toBe(sumOf(r.frames.at(-1).sold))
        expect(r.sold + r.lost).toBeLessThanOrEqual(sumOf(Object.values(PRESALE_DEMAND)))
      })
    }
  }

  it('se detiene solo si la siguiente abre después del día en que se agotó', () => {
    const r = playPresale(stages)
    expect(r.pause).toEqual({ stage: 0, next: 1, day: 22, days: 4 })
    expect(stages[r.pause.next].opensDay).toBeLessThan(r.pause.day)
    expect(r.frames.at(-1).day).toBe(22)
    expect(pauseCopy(stages, r.pause)).toEqual({
      title: 'Preventa 1: agotada en 4 días.',
      question: '¿Abrimos la 2?',
      advance: 'Adelantar la Preventa 2',
      wait: 'Esperar al lunes',
    })
  })

  it('"advance" abre la siguiente ese día con el resto de la demanda', () => {
    const r = playPresale(stages, ['advance'])
    const d22 = r.frames.find((f) => f.day === 22)
    // D-22: 25 de demanda; a la Preventa 1 le quedaban 10 y los otros 15 van a la Preventa 2
    expect(d22.sold.slice(0, 2)).toEqual([150, 15])
    expect(d22.status.slice(0, 2)).toEqual(['sold_out', 'available'])
  })

  it('"wait" pierde la demanda hasta la apertura de la siguiente', () => {
    const r = playPresale(stages, ['wait'])
    const d21 = r.frames.find((f) => f.day === 21)
    const d19 = r.frames.find((f) => f.day === 19)
    expect(d21.waiting).toBe(true)
    expect(d21.sold).toEqual([150, 0, 0, 0])
    expect(d19.sold[1]).toBe(PRESALE_DEMAND[19])
    expect(buyerRows(stages, d21).rows.map((x) => x.status)).toEqual(['sold_out', 'upcoming', 'upcoming', 'upcoming'])
  })

  it('verificación: adelantando siempre, 3 pausas, 700 de 700 y $7.850.000', () => {
    const r = playAlways(stages, 'advance')
    expect(r.pauses).toBe(3)
    expect(r.decisions.map((d) => d.day)).toEqual([22, 14, 6])
    expect([r.sold, r.total]).toEqual([700, 700])
    expect(r.allSoldOut).toBe(true)
    expect(r.frames.at(-1).day).toBe(1)
    expect(r.revenue).toBe(7_850_000)
    expect(r.revenue).toBe(sumOf(stages.map((s, i) => priceQuote(s.price, 'buyer', r.frames.at(-1).sold[i]).total)))
  })

  it('verificación: esperando siempre, 1 pausa, 663 de 700 y $7.448.000', () => {
    const r = playAlways(stages, 'wait')
    expect(r.pauses).toBe(1)
    expect(r.frames.at(-1).sold).toEqual([150, 179, 184, 150])
    expect(r.sold).toBe(663)
    expect(r.revenue).toBe(7_448_000)
  })

  it('una etapa que cierra con cupo al abrir la siguiente ya no aparece para el público', () => {
    const r = playAlways(stages, 'wait')
    const d12 = r.frames.find((f) => f.day === 12)
    expect(d12.status[1]).toBe('closed')
    expect(buyerRows(stages, d12).rows.map((x) => x.name)).toEqual(['Preventa 1', 'Preventa 3', 'General'])
  })

  it('"Últimas entradas" con el criterio de la página del evento (≤ 10 o ≤ 15%) y "Agotado" al final', () => {
    const r = playPresale(stages)
    const d23 = r.frames.find((f) => f.day === 23) // Preventa 1: 140 de 150
    expect(buyerRows(stages, d23).label).toBe('Últimas entradas')
    const d26 = r.frames[0]
    expect(buyerRows(stages, d26).label).toBe(null)
    const end = playAlways(stages, 'advance').frames.at(-1)
    expect(buyerRows(stages, end).label).toBe('Agotado')
  })
})

describe('la fiesta de ejemplo', () => {
  it('es el sábado que cae al menos 28 días después, en hora de Chile', () => {
    for (const iso of ['2026-10-27T12:00:00Z', '2026-10-31T02:30:00Z', '2026-12-31T23:59:00Z', '2027-03-01T10:00:00Z']) {
      const now = new Date(iso)
      const date = partyDate(now)
      expect(new Date(`${date}T12:00:00Z`).getUTCDay()).toBe(6)
      const chileToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(now)
      const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${chileToday}T00:00:00Z`)) / 86_400_000
      expect(days).toBeGreaterThanOrEqual(28)
      expect(days).toBeLessThan(35)
    }
  })

  it('cada etapa abre un lunes a las 20:00 (hora de Chile) y el rótulo es el del checkout', () => {
    const s = partySchedule(new Date('2026-10-27T12:00:00Z'))
    expect(s.date).toBe('2026-11-28')
    expect(s.stamp).toBe("'26 11 28")
    s.openings.forEach((iso, i) => {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
      expect(parts).toBe('Mon 20:00')
      expect(formatSaleStart(iso)).toMatch(/^\d{1,2} \w{3}, 20:00$/)
      expect(openingLabel(s, i)).toMatch(/^Abre lun \d{1,2} \w{3}, 20:00$/)
    })
    expect(formatSaleStart(s.openings[0])).toBe('2 nov, 20:00')
    expect(STAGE_OPEN_DAYS).toEqual([26, 19, 12, 5])
  })

  it('lo de la fiesta queda disponible el término (domingo 05:00) + PAYOUT_RELEASE_HOURS', () => {
    const s = partySchedule(new Date('2026-10-27T12:00:00Z'))
    const release = new Date(Date.parse(s.endIso) + PAYOUT_RELEASE_HOURS * 3_600_000)
    const label = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(release)
      .replace('.', '')
    expect(s.payout.label.toLowerCase()).toBe(label.replace(',', '').toLowerCase())
    if (PAYOUT_RELEASE_HOURS === 48) expect(s.payout.label).toBe('MAR 05:00')
  })
})

describe('los promos (§4.4)', () => {
  it('los totales salen de computeDiscountedTotals por orden', () => {
    const sheet = promoSheet()
    const cata = sheet.find((r) => r.code === 'CATA10')
    const cee = sheet.find((r) => r.code === 'CEE10')
    expect([cata.discount, cata.sales]).toEqual([88_000, 792_000])
    expect([cee.discount, cee.sales]).toEqual([156_000, 1_404_000])
    for (const row of sheet) {
      const order = computeDiscountedTotals(row.perOrder * 10_000, { kind: 'percent', value: 10 })
      expect(row.sales).toBe(order.subtotal * row.purchases)
      expect(row.uses).toBeLessThanOrEqual(row.maxUses)
      // Cada código es válido en el producto
      expect(DISCOUNT_CODE_RE.test(row.code)).toBe(true)
    }
  })

  it('se ordenan por ventas o por usos y los links llevan su ref', () => {
    expect(sortPromos(promoSheet(), 'sales')[0].code).toBe('CEE10')
    expect(sortPromos(promoSheet(), 'uses').map((r) => r.uses)).toEqual([52, 44, 31, 18, 12, 7])
    expect(promoLink('cata')).toBe('aitickets.cl/eventos/fiesta-disquete?ref=cata')
    const channels = promoChannels('Directo')
    expect(channels.at(-1)).toMatchObject({ label: 'Directo', visits: 820 })
    channels.forEach((c) => expect(c.visits).toBeGreaterThan(0))
    channels.forEach((c) => expect(c.revenue).toBe(c.tickets * 10_000))
  })
})

describe('la última semana (§4.5)', () => {
  it('el "Quedan N" de D-7 y D-3 está bajo el umbral de escasez y pieceText lo muestra', () => {
    const base = { kind: 'story', eventName: 'Fiesta Disquete', dateLabel: 'sábado 28 de noviembre', startTime: '23:00', venue: 'Galpón en Santiago', keyword: 'ENTRADAS', styleIndex: 0 }
    for (const f of STORY_FRAMES) {
      const text = pieceText({ ...base, variant: f.variant, daysToEvent: f.days, remaining: f.remaining })
      if (f.remaining != null) {
        expect(isScarce(f.remaining, DEFAULT_CADENCE.scarcity_threshold_pct, PARTY_CAPACITY)).toBe(true)
        expect(text.scarcity).toBe(`Quedan ${f.remaining} entradas`)
      }
      if (f.variant === 'sold_out') expect(text.bigLines).toEqual(['Agotado'])
      if (f.days === 1 && f.variant === 'countdown') expect(text.bigLines).toEqual(['Mañana'])
    }
    expect(PARTY_CAPACITY).toBe(700)
  })
})

describe('el cierre (§4.12)', () => {
  it('la pulsera reescribe el nombre en mayúsculas, con tope de 24 caracteres', () => {
    expect(bandText('')).toBe('FIESTA DISQUETE · PREVENTA 1')
    expect(bandText('los 2000')).toBe('FIESTA LOS 2000 · PREVENTA 1')
    expect(bandText('fiesta neón')).toBe('FIESTA NEÓN · PREVENTA 1')
    expect(bandText('x'.repeat(40))).toBe(`FIESTA ${'X'.repeat(24)} · PREVENTA 1`)
  })
})

describe('precio y preguntas (§4.8, §4.11)', () => {
  it('la calculadora es la del checkout', () => {
    const cases = [
      [8000, 8762, 7238],
      [10000, 10952, 9048],
      [12000, 13142, 10858],
      [15000, 16428, 13572],
    ]
    for (const [price, pays, absorbed] of cases) {
      expect(priceQuote(price, 'buyer').buyerPays).toBe(pays)
      expect(priceQuote(price, 'buyer').perTicket).toBe(price)
      expect(priceQuote(price, 'producer').perTicket).toBe(absorbed)
    }
    const stages = defaultStages(4)
    expect(sumOf(stages.map((s) => priceQuote(s.price, 'buyer', s.capacity).total))).toBe(7_850_000)
    expect(sumOf(stages.map((s) => priceQuote(s.price, 'buyer').buyerPays * s.capacity))).toBe(8_597_300)
    expect(sumOf(stages.map((s) => priceQuote(s.price, 'producer', s.capacity).total))).toBe(7_102_700)
  })

  it('las preguntas de dinero y plazos vienen de PRODUCER_FAQ y la de pago arma su respuesta con legal.mjs', () => {
    expect(FIESTAS_FAQ).toHaveLength(18)
    const cost = PRODUCER_FAQ.find((f) => f.q === '¿Cuánto cuesta usar AI Tickets?')
    expect(FIESTAS_FAQ[0]).toEqual(cost)
    const payout = FIESTAS_FAQ.find((f) => f.q === '¿Cuándo recibo lo de mi fiesta?')
    expect(payout.a.startsWith(PAYOUT_SCHEDULE_TEXT)).toBe(true)
    expect(payout.terms).toBe(true)
    expect(new Set(FIESTAS_FAQ.map((f) => f.q)).size).toBe(FIESTAS_FAQ.length)
  })

  it('la landing está en landings.ts como dedicada y discotecas la relaciona', () => {
    const landing = getLanding('ticketera-fiestas')
    expect(landing.dedicated).toBe(true)
    expect(landing.h1).toBe('Preventa 1: agotada. ¿Abrimos la 2?')
    expect(landing.cta).toEqual({ label: 'Publicar mi fiesta', campaign: 'vertical_fiestas' })
    expect(getLanding('ticketera-discotecas').related).toContain('ticketera-fiestas')
  })
})
