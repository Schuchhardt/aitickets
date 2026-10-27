// Landing de clubs (/ticketera-discotecas): los fotogramas de la noche en vivo cuadran entre sí (ingresados que nunca
// bajan, sin pasar las emitidas ni el aforo, sumas por tipo), la hora de cobro es término + PAYOUT_RELEASE_HOURS
// cruzando la medianoche (como functionEnd de ledger.ts), los ingresos del ranking salen de cantidades × precios, la
// serie de la semana usa DEFAULT_CADENCE, la cuenta regresiva va en hora de Chile, la calculadora es la del checkout
// (priceQuote → fees.mjs) y las preguntas de dinero y plazos son las de PRODUCER_FAQ, sin copias a mano.
import { describe, expect, it } from 'vitest'
import {
  CASH_PRESETS,
  CLUB_TICKETS,
  LIVE_PAYOUT,
  NIGHT_ARRIVALS,
  NIGHT_CAPACITY,
  NIGHT_FRAMES,
  NIGHT_PEAK_STEP,
  NIGHT_STEPS,
  RRPP_ROWS,
  aiAnswer,
  clubMonth,
  countdownToNight,
  insideAt,
  nightState,
  nightTooltip,
  payoutAt,
  rrppBoard,
  rrppRevenue,
  sortRrpp,
  stepTime,
  weekSeries,
} from '../../src/components/landing/clubs/clubsLanding.js'
import { priceQuote } from '../../src/components/landing/producerLanding.js'
import { DEFAULT_CADENCE } from '../../src/lib/socialSeriesCadence'
import { CLUBS_FAQ } from '../../src/data/clubsFaq'
import { getLanding } from '../../src/data/landings'
import { PRODUCER_FAQ } from '../../src/data/producerFaq'
import { PAYOUT_RELEASE_HOURS, PAYOUT_SCHEDULE_TEXT } from '../../netlify/lib/legal.mjs'

const states = Array.from({ length: NIGHT_STEPS + 1 }, (_, s) => nightState(s))

describe('la noche en vivo (§4.5)', () => {
  it('va de 22:00 a 05:00 en pasos de 15 min', () => {
    expect(stepTime(0)).toBe('22:00')
    expect(stepTime(NIGHT_PEAK_STEP)).toBe('01:30')
    expect(stepTime(NIGHT_STEPS)).toBe('05:00')
    expect(NIGHT_ARRIVALS).toHaveLength(NIGHT_STEPS + 1)
  })

  it('los ingresados nunca bajan, por tipo y en total', () => {
    for (let s = 1; s < states.length; s++) {
      expect(states[s].inside).toBeGreaterThanOrEqual(states[s - 1].inside)
      states[s].byKind.forEach((row, i) => {
        expect(row.inside).toBeGreaterThanOrEqual(states[s - 1].byKind[i].inside)
        expect(row.issued).toBeGreaterThanOrEqual(states[s - 1].byKind[i].issued)
      })
    }
  })

  it('nadie supera sus emitidas, ni el cupo del tipo de entrada, ni el aforo', () => {
    for (const st of states) {
      expect(st.inside).toBeLessThanOrEqual(NIGHT_CAPACITY)
      for (const row of st.byKind) {
        expect(row.inside).toBeLessThanOrEqual(row.issued)
        expect(row.issued).toBeLessThanOrEqual(CLUB_TICKETS[row.kind].capacity)
      }
    }
  })

  it('las sumas por tipo cuadran con las llegadas en cada posición y en cada fotograma', () => {
    for (const st of states) expect(st.byKind.reduce((s, r) => s + r.inside, 0)).toBe(st.inside)
    for (const f of NIGHT_FRAMES) {
      const total = Object.values(f.inside).reduce((s, n) => s + n, 0)
      expect(insideAt(f.step)).toBe(total)
      expect(nightState(f.step).byKind.map((r) => r.inside)).toEqual(Object.values(f.inside))
    }
  })

  it('a la 01:30: 455 adentro (76%), lista 171 de 200, cover 251, mesas 8 de 9, cortesías 25, 38 en 15 min', () => {
    const st = nightState(NIGHT_PEAK_STEP)
    expect(st.inside).toBe(455)
    expect(st.pct).toBe(76)
    expect(st.last15).toBe(38)
    expect(aiAnswer(st)).toBe(
      'Hay 455 personas adentro (76% del aforo). De la lista free entraron 171 de 200; de cover, 251; mesas, 8 de 9; cortesías, 25. En los últimos 15 minutos entraron 38.',
    )
  })

  it('al final: emitidas 539 (un QR por mesa) e ingresaron 498, aforo 83%', () => {
    const st = nightState(NIGHT_STEPS)
    expect(st.final).toBe(true)
    expect(st.issuedTotal).toBe(539)
    expect(st.inside).toBe(498)
    expect(st.byKind.find((r) => r.kind === 'mesa').issued).toBe(9)
    expect(nightState(20).sign).toBe('Aforo 83%')
  })

  it('el letrero cierra la lista a las 00:30 con el precio del cover', () => {
    expect(nightState(10).sign).toBe('Lista free cerrada · cover $10.000')
    expect(nightState(9).listClosed).toBe(false)
    expect(nightState(10).listClosed).toBe(true)
  })

  it('a las 22:00 la lista tiene 186 inscritos y van 7 de 10 mesas, como el ranking', () => {
    const st = nightState(0)
    expect(st.byKind[0].issued).toBe(186)
    expect(st.tablesSold).toBe(7)
    const board = rrppBoard('Directo')
    expect(board.reduce((s, r) => s + r.lista, 0)).toBe(186)
    expect(board.reduce((s, r) => s + r.mesa, 0)).toBe(7)
  })
})

describe('cobro por noche', () => {
  it(`una noche que cruza la medianoche se cobra ${PAYOUT_RELEASE_HOURS} h después de su término`, () => {
    // VIE 23:30 → 05:00 termina el SÁB 05:00
    const vie = payoutAt(4, '23:30', '05:00')
    const expectedDay = (5 + Math.floor((5 * 60 + PAYOUT_RELEASE_HOURS * 60) / 1440)) % 7
    expect(vie.weekday).toBe(expectedDay)
    expect(vie.time).toBe('05:00')
    expect(LIVE_PAYOUT).toBe(vie.label)
  })

  it('con el plazo actual (48 h): VIE → LUN 05:00, JUE 23:00 → 04:00 → DOM 04:00', () => {
    if (PAYOUT_RELEASE_HOURS !== 48) return
    expect(payoutAt(4, '23:30', '05:00').label).toBe('LUN 05:00')
    expect(payoutAt(3, '23:00', '04:00').label).toBe('DOM 04:00')
  })

  it('una noche que termina el mismo día no suma un día', () => {
    expect(payoutAt(4, '20:00', '23:00', 24).label).toBe('SÁB 23:00')
  })

  it('el mes del club tiene 5 semanas de 7 días con jueves, viernes y sábado como noches', () => {
    const weeks = clubMonth()
    expect(weeks).toHaveLength(5)
    for (const w of weeks) {
      expect(w.days).toHaveLength(7)
      expect(w.days.filter((d) => d.night).map((d) => d.label)).toEqual(['JUE', 'VIE', 'SÁB'])
    }
    const friday = weeks[2].days[4]
    expect(nightTooltip(friday)).toBe(`VIE 23:30 → 05:00 · Lista, Cover, Mesa · disponible el ${payoutAt(4, '23:30', '05:00').label}`)
  })
})

describe('la lista de los RRPP (§4.4)', () => {
  it('los ingresos son cantidades × precios (lo que recibe el club)', () => {
    const board = rrppBoard('Directo / sin seguimiento')
    for (const row of board) {
      expect(row.revenue).toBe(row.lista * CLUB_TICKETS.lista.price + row.cover * CLUB_TICKETS.cover.price + row.mesa * CLUB_TICKETS.mesa.price)
    }
    expect(rrppRevenue(RRPP_ROWS[0])).toBe(740000)
    expect(board.at(-1)).toMatchObject({ name: 'Directo / sin seguimiento', revenue: 1100000, direct: true })
  })

  it('ordena por inscritos o por ingresos', () => {
    const board = rrppBoard('Directo')
    expect(sortRrpp(board, 'lista')[0].id).toBe('cata')
    expect(sortRrpp(board, 'revenue')[0].id).toBe('directo')
  })
})

describe('tu noche en historias (§4.3)', () => {
  const week = weekSeries(DEFAULT_CADENCE)

  it('son 7 días de SÁB a VIE con la cadencia real', () => {
    expect(week.map((d) => d.weekday)).toEqual(['SÁB', 'DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE'])
    // Dentro de la banda diaria: historia todos los días; post de D-feed_posts_from_days a D-feed_posts_to_days
    expect(week.every((d) => d.story)).toBe(DEFAULT_CADENCE.daily_from_days >= 6)
    const posts = week.filter((d) => d.post).map((d) => d.day)
    expect(Math.min(...posts)).toBe(DEFAULT_CADENCE.feed_posts_to_days)
    expect(week.at(-1).post).toBe(false)
    expect(week.at(-1).time).toBe(DEFAULT_CADENCE.event_day_time)
    expect(week[0].time).toBe(DEFAULT_CADENCE.default_time)
  })
})

describe('cuenta regresiva al viernes (§4.12)', () => {
  it('cuenta en hora de Chile, sin segundos', () => {
    // Martes 27 oct 2026, 04:00 en Chile (UTC-3) → viernes 23:30
    expect(countdownToNight(new Date('2026-10-27T07:00:00Z')).label).toBe('Faltan 3 d 19 h 30 min')
  })

  it('justo a la hora de apertura cuenta al viernes siguiente y pasada la hora, también', () => {
    expect(countdownToNight(new Date('2026-10-31T02:30:00Z')).label).toBe('Faltan 7 d 00 h 00 min')
    expect(countdownToNight(new Date('2026-10-31T03:00:00Z')).label).toBe('Faltan 6 d 23 h 30 min')
  })
})

describe('se prenden las luces (§4.8)', () => {
  it('cover $10.000 y mesa $180.000 con la fórmula del checkout', () => {
    const cover = CASH_PRESETS.find((p) => p.id === 'cover').price
    const mesa = CASH_PRESETS.find((p) => p.id === 'mesa').price
    expect(priceQuote(cover, 'buyer')).toMatchObject({ buyerPays: 10952, perTicket: 10000 })
    expect(priceQuote(cover, 'producer')).toMatchObject({ buyerPays: 10000, perTicket: 9048 })
    expect(priceQuote(mesa, 'buyer')).toMatchObject({ buyerPays: 197136, perTicket: 180000 })
    expect(priceQuote(mesa, 'producer')).toMatchObject({ buyerPays: 180000, perTicket: 162864 })
  })

  it('la lista free no paga cargo', () => {
    expect(priceQuote(CASH_PRESETS.find((p) => p.id === 'lista').price, 'buyer')).toMatchObject({ buyerPays: 0, perTicket: 0 })
  })
})

describe('preguntas frecuentes y landings.ts (§4.11, §9)', () => {
  it('son 16 en el orden de la spec y las de dinero son las de PRODUCER_FAQ', () => {
    expect(CLUBS_FAQ).toHaveLength(16)
    expect(new Set(CLUBS_FAQ.map((f) => f.q)).size).toBe(16)
    for (const q of ['¿Cuánto cuesta usar AI Tickets?', '¿Puedo absorber el cargo por servicio?']) {
      expect(CLUBS_FAQ.find((f) => f.q === q)).toEqual(PRODUCER_FAQ.find((f) => f.q === q))
    }
  })

  it('el cobro de cada noche usa PAYOUT_SCHEDULE_TEXT y la frase de la cuenta bancaria de PRODUCER_FAQ, con términos', () => {
    const item = CLUBS_FAQ[1]
    expect(item.q).toBe('¿Cuándo recibo lo de cada noche?')
    expect(item.terms).toBe(true)
    expect(item.a.startsWith(PAYOUT_SCHEDULE_TEXT)).toBe(true)
    const producer = PRODUCER_FAQ.find((f) => f.q === '¿Cuándo recibo el dinero de mis ventas?').a
    expect(item.a.endsWith(producer.slice(PAYOUT_SCHEDULE_TEXT.length).trim())).toBe(true)
  })

  it('la landing es dedicada, con su CTA y las relacionadas', () => {
    const landing = getLanding('ticketera-discotecas')
    expect(landing).toMatchObject({ kind: 'vertical', dedicated: true, cta: { campaign: 'vertical_clubs' } })
    expect(landing.card.title).toBe('Clubs y discotecas')
    expect(landing.related).toEqual(['ventas-por-promotor', 'entradas-con-qr', 'ticketera-musica-en-vivo'])
  })
})
