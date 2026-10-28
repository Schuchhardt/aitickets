// Landing de talleres (/ticketera-talleres): los rótulos del armador son los de la página real (cardLabel / cardState /
// checkoutFunctions de eventView.js), los montos del armador y de la cuenta son los del checkout (priceQuote →
// computeFeeSplit de fees.mjs), con los cupos como multiplicador; el plazo de un curso usa PAYOUT_RELEASE_HOURS
// (legal.mjs, regla de ledger.ts) y las preguntas de dinero y plazos son las de PRODUCER_FAQ, sin copias a mano.
import { describe, expect, it } from 'vitest'
import {
  BUILDER_INITIAL,
  COURSE_SESSIONS,
  FORMAT_CARDS,
  PENDIENTES,
  ROLL_DEMO,
  ROLL_FINAL,
  SUM_PRICE,
  SUM_SEATS,
  WORKSHOP_PRESETS,
  builderNotes,
  courseDatesLabel,
  courseReleaseText,
  dateReleaseText,
  fakeEvent,
  invitationBody,
  notebookSum,
  presetById,
  presetPrice,
  previewModel,
  rollState,
  spaceCards,
  workshopDates,
} from '../../src/components/landing/talleres/talleresLanding.js'
import { cardLabel, cardState } from '../../src/components/event/eventView.js'
import { computeFeeSplit } from '../../netlify/lib/fees.mjs'
import { PAYOUT_RELEASE_HOURS } from '../../netlify/lib/legal.mjs'
import { TALLERES_FAQ } from '../../src/data/talleresFaq'
import { INVITE_AUDIENCE_TEXT } from '../../src/data/inviteAudience'
import { INVITE_AUDIENCE_TEXT as THEATRE_INVITE_AUDIENCE_TEXT } from '../../src/data/teatroFaq'
import { getLanding } from '../../src/data/landings'
import { PRODUCER_FAQ } from '../../src/data/producerFaq'
import { ORGANIZADORES_FAQ } from '../../src/data/organizadoresFaq'
import { DEFAULT_MAX_PER_PURCHASE } from '../../src/components/Reservation/pricing.js'
import { WORKSHOP_TESTIMONIAL } from '../../src/data/producerSocialProof'

const ceramica = presetById('ceramica')
const model = (overrides = {}) =>
  previewModel({ preset: ceramica, format: 'day', paid: true, price: 28000, seats: 10, enrolled: 7, ...overrides })

describe('fechas de ejemplo', () => {
  it('calzan con el calendario real (2026)', () => {
    for (const preset of WORKSHOP_PRESETS) {
      const dates = workshopDates(preset, 8)
      const weekday = new Date(`${preset.start}T12:00:00Z`).getUTCDay()
      for (const d of dates) expect(new Date(`${d.date}T12:00:00Z`).getUTCDay()).toBe(weekday)
    }
    expect(workshopDates(ceramica, 1)[0].label).toBe('Sáb 14 nov')
  })

  it('el curso de 4 sesiones se lee como en la spec', () => {
    expect(courseDatesLabel(workshopDates(ceramica, COURSE_SESSIONS), '10:00')).toBe('Sáb 14, 21 y 28 nov y sáb 5 dic · 10:00')
  })
})

describe('el armador (§4.3) dice lo que dice la página real', () => {
  it('estado inicial: Cerámica, un día, con pago, 7 de 10 → "Últimas entradas" y $30.666', () => {
    const preset = presetById(BUILDER_INITIAL.preset)
    const m = previewModel({
      preset,
      format: BUILDER_INITIAL.format,
      paid: true,
      price: presetPrice(preset, BUILDER_INITIAL.format),
      seats: preset.seats,
      enrolled: preset.seats - BUILDER_INITIAL.enrolledGap,
    })
    expect(m.label).toEqual({ text: 'Últimas entradas', tone: 'warning' })
    expect(m.finalPrice).toBe('$30.666')
    expect(m.cta).toBe('Comprar entrada')
  })

  it('los rótulos son los de cardLabel para gratis y pagado, con pocos y llenos', () => {
    const cases = [
      [{ paid: false }, 'Gratis · Quedan 3 cupos'],
      [{ paid: false, enrolled: 10 }, 'Gratis · Cupos llenos'],
      [{ paid: true, enrolled: 10 }, 'Agotado'],
      [{ paid: true }, 'Últimas entradas'],
      [{ paid: false, seats: 40, enrolled: 0 }, 'Gratis'],
    ]
    for (const [input, text] of cases) {
      const m = model(input)
      const event = fakeEvent({ preset: ceramica, format: 'day', paid: true, price: 28000, seats: 10, enrolled: 7, ...input })
      expect(cardLabel(event, cardState(event))?.text).toBe(text)
      expect(m.label?.text).toBe(text)
    }
    // Pagado con harto cupo: la card real abre con el precio (sin rótulo)
    expect(model({ seats: 40, enrolled: 0 }).label).toBeNull()
  })

  it('lleno: la lista de espera con el botón real de cada caso', () => {
    expect(model({ paid: false, enrolled: 10 }).waitlistCta).toBe('Avisarme si se libera un cupo')
    expect(model({ enrolled: 10 }).waitlistCta).toBe('Avisarme si se liberan')
    expect(model({ enrolled: 10 }).soldOut).toBe(true)
  })

  it('curso: una entrada para todas las funciones con su precio final', () => {
    const m = model({ format: 'course', price: presetPrice(ceramica, 'course') })
    expect(m.ticketName).toBe('Curso completo · 4 sesiones')
    expect(m.finalPrice).toBe(`$${computeFeeSplit(95000).total.toLocaleString('es-CL')}`)
    expect(m.event.tickets[0].event_date_id).toBeNull()
    expect(m.event.dates).toHaveLength(COURSE_SESSIONS)
  })

  it('todas las semanas: una entrada por fecha, "Elegir entradas" y el estado de cada fecha', () => {
    const m = model({ format: 'weekly', seats: 20, enrolled: 17 })
    expect(m.state).toBe('paid_multi')
    expect(m.label?.text).toBe('8 funciones')
    expect(m.cta).toBe('Elegir entradas')
    expect(m.functions.map((f) => f.text)).toEqual(['Últimas', 'Últimas', 'Disponible', 'Disponible'])
    expect(model({ format: 'weekly', enrolled: 10 }).functions[0].text).toBe('Agotada')
  })

  it('los montos son los del checkout', () => {
    for (const price of [5000, 28000, 95000, 120000]) {
      expect(model({ price }).finalPrice).toBe(`$${computeFeeSplit(price).total.toLocaleString('es-CL')}`)
    }
    expect(model({ paid: false }).finalPrice).toBe('Gratis')
  })

  it('las notas cambian con el caso y marcan "Pronto" lo que no existe', () => {
    const ids = (input) => builderNotes({ format: 'day', paid: true, enrolled: 7, seats: 10, ...input }).map((n) => n.id)
    expect(ids({})).toEqual(['qr', 'reminder', 'webpay', 'payout'])
    expect(ids({ paid: false })).toEqual(['qr', 'reminder', 'free'])
    const course = builderNotes({ format: 'course', paid: true, enrolled: 7, seats: 10 })
    expect(course.find((n) => n.id === 'payout')?.text).toBe(`${courseReleaseText}.`)
    expect(course.find((n) => n.id === 'roll')?.soon).toBe(true)
    const weekly = builderNotes({ format: 'weekly', paid: false, enrolled: 7, seats: 10 })
    expect(weekly.find((n) => n.id === 'repeat')?.soon).toBeUndefined()
    const full = builderNotes({ format: 'day', paid: false, enrolled: 10, seats: 10 })
    expect(full.find((n) => n.id === 'waitlist')?.soon).toBeUndefined()
    // Todas las semanas: solo se llena la primera fecha y la nota no promete el aviso que el teléfono no muestra
    const weeklyFull = builderNotes({ format: 'weekly', paid: true, enrolled: 10, seats: 10 })
    expect(weeklyFull.find((n) => n.id === 'full')?.text).toContain('Agotada')
    expect(weeklyFull.find((n) => n.id === 'waitlist')?.soon).toBeUndefined()
  })
})

describe('plazos (manda el código)', () => {
  it('curso con una sola entrada: con la última sesión (ledger.ts) y PAYOUT_RELEASE_HOURS', () => {
    expect(courseReleaseText).toBe(`Lo del curso queda disponible ${PAYOUT_RELEASE_HOURS} h después de la última sesión`)
    expect(dateReleaseText).toContain(`${PAYOUT_RELEASE_HOURS} h`)
    expect(PENDIENTES.find((p) => p.star)?.after).toContain(dateReleaseText)
  })
})

describe('la cuenta del cuaderno (§4.8)', () => {
  it('$25.000 × 12 → paga $27.380, recibes $25.000, $300.000; absorbido → $25.000 / $22.620 / $271.440', () => {
    expect(SUM_PRICE.default).toBe(25000)
    expect(SUM_SEATS.default).toBe(12)
    const buyer = notebookSum(25000, 'buyer', 12)
    expect([buyer.buyerPays, buyer.perTicket, buyer.total]).toEqual([27380, 25000, 300000])
    const producer = notebookSum(25000, 'producer', 12)
    expect([producer.buyerPays, producer.perTicket, producer.total]).toEqual([25000, 22620, 271440])
    const split = computeFeeSplit(10000, { absorbed: true })
    expect(notebookSum(10000, 'producer', 1).perTicket).toBe(split.producerNet)
    expect(notebookSum(10000, 'buyer', 1).buyerPays).toBe(computeFeeSplit(10000).total)
  })
})

describe('pasar lista (§4.5)', () => {
  it('termina en 9 de 10, con la sexta buscada por nombre y un QR repetido que no suma', () => {
    const final = rollState(ROLL_FINAL)
    expect(final.checked).toBe(9)
    expect(ROLL_DEMO.rows).toHaveLength(10)
    expect(final.present.valentina.search).toBe(true)
    // Los casos especiales se ven en mobile (las primeras mobileVisible filas)
    const visibleRows = ROLL_DEMO.rows.slice(0, ROLL_DEMO.mobileVisible).map((r) => r.id)
    for (const step of ROLL_DEMO.steps.filter((s) => s.search || s.repeat)) expect(visibleRows).toContain(step.row)
    expect(Object.keys(final.repeats)).toEqual(['ignacio'])
    expect(rollState(6).last.search).toBe('vale')
    expect(rollState(8).checked).toBe(7)
  })
})

describe('espacios e invitación', () => {
  it('las fichas del espacio usan los rótulos de cardLabel', () => {
    expect(spaceCards().map((c) => c.label?.text ?? c.finalPrice)).toEqual([
      'Últimas entradas',
      '$27.380',
      'Gratis · Quedan 4 cupos',
      'Gratis',
    ])
  })

  it('el texto por defecto de la invitación es el de invitationCopy (invitations.ts)', async () => {
    const { invitationCopy } = await import('../../src/lib/invitations.ts')
    const { body } = invitationCopy('', 'Torno para principiantes', 'Torno nivel 2', {})
    expect(invitationBody('Torno para principiantes', 'Torno nivel 2')).toBe(body)
  })

  it('las audiencias en una frase son las mismas que usa teatro', () => {
    expect(INVITE_AUDIENCE_TEXT).toBe(THEATRE_INVITE_AUDIENCE_TEXT)
    expect(INVITE_AUDIENCE_TEXT).toBe('todos los asistentes, a quienes ingresaron o a quienes calificaron con 4 o 5 estrellas')
  })
})

describe('preguntas frecuentes (§4.11)', () => {
  it('20 preguntas; las de dinero y plazos, tal cual de PRODUCER_FAQ', () => {
    expect(TALLERES_FAQ).toHaveLength(20)
    for (const q of ['¿Cuánto cuesta usar AI Tickets?', '¿Cuándo recibo el dinero de mis ventas?', '¿Puedo absorber el cargo por servicio?']) {
      expect(TALLERES_FAQ.find((f) => f.q === q)).toEqual(PRODUCER_FAQ.find((f) => f.q === q))
    }
    const suspend = TALLERES_FAQ.find((f) => f.q === '¿Y si no llego al mínimo y tengo que suspender?')
    expect(suspend?.a).toBe(PRODUCER_FAQ.find((f) => f.q === '¿Qué pasa si tengo que cambiar o cancelar una función?')?.a)
    expect(suspend?.terms).toBe(true)
    const reviews = TALLERES_FAQ.find((f) => f.q === '¿Cómo funcionan las reseñas?')
    expect(reviews?.a.startsWith(ORGANIZADORES_FAQ.find((f) => f.q === '¿Cómo funcionan las reseñas?')?.a ?? '-')).toBe(true)
  })

  it('el curso de varias sesiones y el máximo por compra salen de las constantes', () => {
    const course = TALLERES_FAQ.find((f) => f.q === '¿Y si vendo un curso de varias sesiones?')
    expect(course?.a).toContain(`${PAYOUT_RELEASE_HOURS} h después de la última sesión`)
    expect(course?.terms).toBe(true)
    expect(TALLERES_FAQ.find((f) => f.q === '¿Puedo limitar a una inscripción por persona?')?.a).toContain(`(${DEFAULT_MAX_PER_PURCHASE} si no lo cambias)`)
  })

  it('se conservan las tres de landings.ts y la landing es dedicada', () => {
    const landing = getLanding('ticketera-talleres')
    expect(landing?.dedicated).toBe(true)
    expect(landing?.sections).toEqual([])
    for (const item of landing?.faq ?? []) expect(TALLERES_FAQ).toContainEqual(item)
    expect(landing?.card.title).toBe('Talleres y cursos')
    expect(landing?.cta.label).toBe('Abrir inscripciones')
  })

  it('el fichero de formatos deja el tope de fechas para MAX_EVENT_FUNCTIONS', () => {
    expect(FORMAT_CARDS.find((c) => c.id === 'weekly')?.text).toContain('{maxFunctions}')
  })
})

it('sin testimonio real no hay cita', () => {
  expect(WORKSHOP_TESTIMONIAL).toBeNull()
})
