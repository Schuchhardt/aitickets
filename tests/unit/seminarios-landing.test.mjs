// Landing de seminarios (/ticketera-seminarios): el modelo del programa respeta la regla del producto (cada tipo de
// entrada vale para una función o para todas, nunca dos de tres) y suma el aforo; la jornada de ejemplo cae un jueves
// ≥ 35 días después en hora de Chile; la liberación es término + PAYOUT_RELEASE_HOURS (el pase completo, con la última
// función); la cotización, la compra de la empresa y el convenio salen de la fórmula del checkout (priceQuote,
// computeDiscountedTotals); los textos del escáner están tal cual en ValidateQR.vue; la card de ejemplo usa los rótulos
// reales (cardLabel); el "Quedan N" de la historia está bajo el umbral de escasez; y las preguntas de dinero y plazos son
// las de PRODUCER_FAQ, sin copias a mano.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AGREEMENT,
  DESK_CASES,
  DESK_START,
  DESK_TABLES,
  FORMATS,
  HERO_REGISTERED,
  ISSUED_TICKETS,
  MAX_PER_ORDER_AI,
  SCOPE_ALL,
  SEMINAR_CAPACITY,
  SEMINAR_MIN_DAYS_AHEAD,
  STORY_FRAMES,
  agreementTotals,
  buyerCard,
  channelLink,
  deskMessage,
  isScarce,
  matrixColumns,
  mismatchWarning,
  panelSummary,
  programModel,
  quoteLines,
  releaseAt,
  seminarChannels,
  seminarDate,
  seminarSchedule,
  sortChannels,
  surveyAverage,
  teamOrderTotal,
} from '../../src/components/landing/seminarios/seminariosLanding.js'
import { priceQuote } from '../../src/components/landing/producerLanding.js'
import { formatRating } from '../../src/components/event/eventView.js'
import { DEFAULT_CADENCE } from '../../src/lib/socialSeriesCadence'
import { SEMINARIOS_FAQ } from '../../src/data/seminariosFaq'
import { getLanding } from '../../src/data/landings'
import { PRODUCER_FAQ } from '../../src/data/producerFaq'
import { DISCOUNT_CODE_RE } from '../../netlify/lib/discounts.mjs'
import { EVENT_TIMEZONE, addDays, todayInTimeZone } from '../../netlify/lib/dates.mjs'
import { PAYOUT_RELEASE_HOURS, PAYOUT_SCHEDULE_TEXT } from '../../netlify/lib/legal.mjs'

const NOW = new Date('2026-10-27T15:00:00Z')
const DATE = seminarDate(NOW)

describe('el programa: programModel (§4.3)', () => {
  it('el congreso con entrada: 2 funciones, 4 tipos y aforo 260', () => {
    const model = programModel('congreso', 'paid', {}, DATE)
    expect(model.functions.map((f) => [f.id, f.date, f.start, f.end])).toEqual([
      ['d1', DATE, '09:00', '18:00'],
      ['d2', addDays(DATE, 1), '09:00', '13:30'],
    ])
    expect(model.tickets.map((t) => [t.name, t.price, t.capacity, t.scope])).toEqual([
      ['Pase completo', 60000, 120, SCOPE_ALL],
      ['Solo día 1', 40000, 60, 'd1'],
      ['Solo día 2', 30000, 40, 'd2'],
      ['Estudiante', 25000, 40, SCOPE_ALL],
    ])
    expect(model.capacity).toBe(260)
    expect(panelSummary(model).announce).toBe('2 funciones, 4 tipos de entrada, aforo 260')
  })

  it('cada tipo vale para una función o para todas, nunca para dos sueltas', () => {
    for (const f of FORMATS) {
      for (const mode of ['paid', 'free']) {
        const model = programModel(f.id, mode, { presale: true }, DATE)
        const valid = new Set(matrixColumns(model).map((c) => c.id))
        for (const t of model.tickets) {
          expect(typeof t.scope).toBe('string')
          expect(valid.has(t.scope)).toBe(true)
        }
        // "Todos los días" solo existe con más de una función
        expect(valid.has(SCOPE_ALL)).toBe(model.functions.length > 1)
      }
    }
    // Un alcance que no existe en el formato cae al de por defecto
    const charla = programModel('charla', 'paid', { scopes: { general: 'd2' } }, DATE)
    expect(charla.tickets[0].scope).toBe('d1')
  })

  it('el aforo es la suma de los cupos y el modo gratis tiene un solo tipo, de precio 0', () => {
    for (const f of FORMATS) {
      const paid = programModel(f.id, 'paid', {}, DATE)
      expect(paid.capacity).toBe(paid.tickets.reduce((s, t) => s + t.capacity, 0))
      const free = programModel(f.id, 'free', {}, DATE)
      expect(free.tickets).toHaveLength(1)
      expect(free.tickets[0].price).toBe(0)
    }
    expect(programModel('congreso', 'paid', { student: false }, DATE).tickets.map((t) => t.name)).not.toContain('Estudiante')
  })

  it('la card de ejemplo usa los rótulos reales de la página del evento', () => {
    const congress = buyerCard(programModel('congreso', 'paid', {}, DATE), { date: DATE })
    expect(congress.label).toBe('2 funciones')
    expect(congress.cta).toBe('Elegir entradas')
    expect(congress.chips).toHaveLength(2)
    expect(congress.price).toBe(priceQuote(25000).buyerPays)
    const almostFull = buyerCard(programModel('charla', 'free', {}, DATE), { almostFull: true, date: DATE })
    expect(almostFull.label).toBe('Gratis · Quedan 12 cupos')
    expect(almostFull.cta).toBe('Confirmar asistencia')
    expect(buyerCard(programModel('charla', 'paid', {}, DATE), { date: DATE }).cta).toBe('Comprar entrada')
    // Con preventa, la entrada general espera con "Disponible desde el {formatSaleStart}"
    const presale = buyerCard(programModel('congreso', 'paid', { presale: true }, DATE), { date: DATE })
    expect(presale.rows.find((r) => r.id === 'pase').opens).toMatch(/^Disponible desde el \d{1,2} [a-z]{3}, 10:00$/)
  })
})

describe('fechas y cobro por jornada (§0.3, §4.8)', () => {
  it('el Día 1 es un jueves ≥ 35 días después del build, en hora de Chile, y el Día 2 el viernes siguiente', () => {
    const today = todayInTimeZone(EVENT_TIMEZONE, NOW)
    const days = (Date.parse(`${DATE}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000
    expect(days).toBeGreaterThanOrEqual(SEMINAR_MIN_DAYS_AHEAD)
    expect(days).toBeLessThan(SEMINAR_MIN_DAYS_AHEAD + 7)
    expect(new Date(`${DATE}T12:00:00Z`).getUTCDay()).toBe(4)
    const schedule = seminarSchedule(NOW)
    expect(schedule.d2).toBe(addDays(DATE, 1))
    expect(schedule.short1).toMatch(/^Jue /)
    expect(schedule.short2).toMatch(/^Vie /)
  })

  it('Solo día 1 se libera con el término del día 1; el pase completo y Solo día 2, con el del día 2', () => {
    const schedule = seminarSchedule(NOW)
    const hours = (iso, end) => (Date.parse(iso) - end) / 3600000
    const end1 = Date.parse(releaseAt(schedule.d1, '18:00', 0).iso)
    const end2 = Date.parse(releaseAt(schedule.d2, '13:30', 0).iso)
    expect(hours(schedule.release.day1.iso, end1)).toBe(PAYOUT_RELEASE_HOURS)
    expect(hours(schedule.release.last.iso, end2)).toBe(PAYOUT_RELEASE_HOURS)
    expect(schedule.release.day1.label).toMatch(/^Sáb .*, 18:00$/)
    expect(schedule.release.last.label).toMatch(/^Dom .*, 13:30$/)
  })
})

describe('la plata sale de la fórmula del checkout', () => {
  it('cotización: $11.800.000 para ti, $12.923.360 tu público y $10.676.640 absorbido', () => {
    const lines = quoteLines()
    expect(lines.reduce((s, l) => s + priceQuote(l.price, 'buyer', l.qty).total, 0)).toBe(11_800_000)
    expect(lines.reduce((s, l) => s + priceQuote(l.price).buyerPays * l.qty, 0)).toBe(12_923_360)
    expect(lines.reduce((s, l) => s + priceQuote(l.price, 'producer', l.qty).total, 0)).toBe(10_676_640)
    expect(priceQuote(60000).buyerPays).toBe(65712)
    expect(priceQuote(60000, 'producer').perTicket).toBe(54288)
  })

  it('el convenio COLEGIO20 sobre $60.000 deja $52.570 y la compra de la empresa, $525.696', () => {
    expect(DISCOUNT_CODE_RE.test(AGREEMENT.code)).toBe(true)
    expect(agreementTotals().total).toBe(52570)
    expect(teamOrderTotal()).toBe(525696)
  })

  it('el tope de entradas por compra del asistente de IA calza con tools/tickets.ts', () => {
    const tools = readFileSync('src/lib/producer-api/tools/tickets.ts', 'utf8')
    expect(tools).toContain(`max_per_order: { type: "integer", minimum: 1, maximum: ${MAX_PER_ORDER_AI}`)
  })

  it('los canales suman los inscritos y ordenan por entradas o ingresos', () => {
    const rows = seminarChannels('Directo')
    expect(rows.reduce((s, r) => s + r.tickets, 0)).toBe(HERO_REGISTERED.reduce((s, r) => s + r.count, 0))
    expect(sortChannels(rows, 'tickets')[0].id).toBe('directo')
    expect(sortChannels(rows, 'revenue').map((r) => r.revenue)).toEqual([...rows.map((r) => r.revenue)].sort((a, b) => b - a))
    expect(channelLink('paula-rios')).toMatch(/\?ref=paula-rios$/)
  })
})

describe('la mesa de acreditación (§4.7)', () => {
  const validateQr = readFileSync('src/components/ValidateQR.vue', 'utf8')

  it('los textos del escáner están tal cual en ValidateQR.vue', () => {
    for (const text of [
      '✅ Entrada validada con éxito para ',
      " (pendiente de sincronizar)",
      ' · Ojo: entrada para ',
      '✅ Entrada validada manualmente para ',
      '⚠️ Esta entrada es para otra función',
      'Puedes validarla de todas formas si corresponde.',
      'entradas validadas',
      '▼ Buscar asistente (validación manual / reenviar entradas)',
      'Buscar por nombre o correo...',
      '✓ Validar Entrada',
      '✗ Cancelar',
      '✉️ Reenviar entradas',
    ]) {
      expect(validateQr).toContain(text)
    }
    const fn = 'Vie 4 dic · 09:00'
    expect(deskMessage(DESK_CASES[1])).toBe('✅ Entrada validada con éxito para Diego Fuentes (pendiente de sincronizar)')
    expect(deskMessage(DESK_CASES[2], fn)).toBe(`✅ Entrada validada con éxito para Andrea Soto (pendiente de sincronizar) · Ojo: entrada para ${fn}`)
    expect(deskMessage(DESK_CASES[3])).toBe('✅ Entrada validada manualmente para Rodrigo Pérez')
    expect(mismatchWarning(fn)).toBe(`⚠️ Esta entrada es para otra función: ${fn}. Puedes validarla de todas formas si corresponde.`)
  })

  it('las mesas suman el contador: 210 al empezar y 214 después de los cuatro válidos', () => {
    expect(DESK_TABLES.reduce((s, t) => s + t.start, 0)).toBe(DESK_START)
    expect(DESK_START + DESK_CASES.length - 1).toBe(214)
    expect(ISSUED_TICKETS).toBe(272)
  })
})

describe('difusión y después', () => {
  it('la historia D-3 muestra "Quedan N" (bajo el umbral) y las otras no', () => {
    const scarce = STORY_FRAMES.filter((f) => isScarce(f.remaining, DEFAULT_CADENCE.scarcity_threshold_pct, SEMINAR_CAPACITY))
    expect(scarce.map((f) => f.id)).toEqual(['d3'])
  })

  it('el promedio de la encuesta es 4,5', () => {
    expect(formatRating(surveyAverage())).toBe('4,5')
  })
})

describe('preguntas frecuentes (§4.11)', () => {
  it('veinte, en el orden de la spec, con las de dinero tal cual de PRODUCER_FAQ', () => {
    expect(SEMINARIOS_FAQ).toHaveLength(20)
    const pick = (q) => PRODUCER_FAQ.find((f) => f.q === q)
    expect(SEMINARIOS_FAQ[0]).toEqual(pick('¿Cuánto cuesta usar AI Tickets?'))
    expect(SEMINARIOS_FAQ[3]).toEqual(pick('¿Puedo absorber el cargo por servicio?'))
    expect(SEMINARIOS_FAQ.at(-1)).toEqual(pick('¿Me ayudan a publicar mi primer evento?'))
    const payout = SEMINARIOS_FAQ.find((f) => f.q === '¿Cuándo recibo lo recaudado?')
    expect(payout.a.startsWith(PAYOUT_SCHEDULE_TEXT)).toBe(true)
    expect(payout.terms).toBe(true)
    expect(new Set(SEMINARIOS_FAQ.map((f) => f.q)).size).toBe(20)
  })

  it('la landing está en landings.ts como dedicada y talleres la enlaza', () => {
    const landing = getLanding('ticketera-seminarios')
    expect(landing?.dedicated).toBe(true)
    expect(landing?.h1).toBe('Tú armas el programa. La acreditación es un QR.')
    expect(getLanding('ticketera-talleres')?.related).toContain('ticketera-seminarios')
  })
})
