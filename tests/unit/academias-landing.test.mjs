// Landing de academias (/academias): los números de los mockups cuadran entre sí, la calculadora es la del checkout
// (priceQuote → fees.mjs) y las preguntas de dinero y plazos salen del código (fees.mjs, legal.mjs, producerFaq.ts).
import { describe, expect, it } from 'vitest'
import {
  ACADEMY_CHAT,
  ACADEMY_COURSES,
  ACADEMY_DEMO,
  academyDemoRevenue,
  courseScales,
} from '../../src/components/landing/academias/academiasLanding.js'
import { priceQuote } from '../../src/components/landing/producerLanding.js'
import { getLanding } from '../../src/data/landings'
import { ABSORB_FEE_ACTIVATION, PRODUCER_FAQ } from '../../src/data/producerFaq'
import { PAYOUT_SCHEDULE_TEXT } from '../../netlify/lib/legal.mjs'
import { SERVICE_FEE_PERCENT_LABEL } from '../../netlify/lib/fees.mjs'

describe('muestra de ejemplo', () => {
  it('las entradas por curso suman las vendidas y no pasan del cupo', () => {
    expect(ACADEMY_COURSES.reduce((n, c) => n + c.tickets, 0)).toBe(ACADEMY_DEMO.sold)
    expect(ACADEMY_DEMO.sold).toBeLessThanOrEqual(ACADEMY_DEMO.capacity)
  })

  it('lo recaudado es vendidas × precio ($1.060.000)', () => {
    expect(academyDemoRevenue()).toBe(1060000)
  })

  it('la barra del curso que más vendió va completa', () => {
    const scales = courseScales()
    expect(Math.max(...scales)).toBe(1)
    scales.forEach((s) => expect(s).toBeGreaterThan(0))
  })

  it('el chat muestra 5 mensajes en mobile (§3.10)', () => {
    expect(ACADEMY_CHAT.messages.filter((m) => !m.desktopOnly)).toHaveLength(5)
  })
})

describe('calculadora', () => {
  it('$5.000 → la familia paga $5.476 y la academia recibe $5.000; absorbido → $4.524 (§3.6)', () => {
    const family = priceQuote(5000, 'buyer')
    expect(family.buyerPays).toBe(5476)
    expect(family.perTicket).toBe(5000)
    const absorbed = priceQuote(5000, 'producer')
    expect(absorbed.buyerPays).toBe(5000)
    expect(absorbed.perTicket).toBe(4524)
  })
})

describe('preguntas frecuentes', () => {
  const landing = getLanding('academias')

  it('la landing es propia (no la genera [landing].astro) y tiene las 8 preguntas de la spec', () => {
    expect(landing?.dedicated).toBe(true)
    expect(landing?.faq).toHaveLength(8)
  })

  it('el plazo de pago es el de legal.mjs y no promete "48 horas después del evento"', () => {
    const payout = landing?.faq.find((f) => f.q === '¿Cuándo recibo lo recaudado?')
    expect(payout?.a).toBe(PRODUCER_FAQ.find((f) => f.q === '¿Cuándo recibo el dinero de mis ventas?')?.a)
    expect(payout?.a).toContain(PAYOUT_SCHEDULE_TEXT)
    expect(payout?.terms).toBe(true)
  })

  it('el cargo sale de fees.mjs y dice cómo se absorbe hoy', () => {
    const cost = landing?.faq.find((f) => f.q === '¿Cuánto cuesta?')
    expect(cost?.a).toContain(`${SERVICE_FEE_PERCENT_LABEL} más IVA`)
    expect(cost?.a).toContain(ABSORB_FEE_ACTIVATION)
  })
})
