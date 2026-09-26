// Redacción y validación de correos del outreach (netlify/lib/outreach/compose.mjs).
// validateOutgoing es la última barrera antes de enviar: enlaces solo a aitickets.cl, sin montos
// inventados, largo acotado y pie legal con baja.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { getOutreachConfig } from '../../netlify/lib/outreach/config.mjs'
import {
  composeFollowup,
  composeInitial,
  composeInterestedReply,
  signupUrl,
  sourceLabel,
  subjectFor,
  unsubscribeUrl,
  validateOutgoing,
} from '../../netlify/lib/outreach/compose.mjs'
import { outreachFooterText } from '../../netlify/lib/legal.mjs'
import { verifyLeadToken, verifyUnsubToken } from '../../netlify/lib/outreach/tokens.mjs'

const lead = {
  id: 'lead-42',
  email: 'contacto@teatrocamino.cl',
  org_name: 'Teatro Camino',
  website: 'https://www.teatrocamino.cl',
  email_source_url: 'https://www.teatrocamino.cl/contacto',
  source: 'chilecultura',
  upcoming_event: { name: 'La Pérgola de las Flores', venue: 'Teatro Camino', date: '2026-10-17' },
}

const UNSUB = 'https://aitickets.cl/api/outreach/unsubscribe?t=abc.def'
const footer = outreachFooterText({ sourceLabel: 'el sitio web público de tu organización (teatrocamino.cl)', unsubscribeUrl: UNSUB })
const email = (body) => `${body}\n${footer}`

beforeEach(() => {
  vi.stubEnv('OUTREACH_UNSUB_SECRET', 'unsub-secret-for-tests')
  vi.stubEnv('LEAD_TOKEN_SECRET', 'lead-secret-for-tests')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('validateOutgoing', () => {
  const cfg = () => getOutreachConfig()

  it('acepta un correo breve, con enlace a aitickets.cl y pie legal completo', () => {
    const res = validateOutgoing(email('Hola, vi tu obra en Chile Cultura. Te ofrecemos una web gratis con 0% de comisión.\n\nhttps://aitickets.cl/web-gratis'), { cfg: cfg() })
    expect(res).toEqual({ ok: true, errors: [] })
  })

  it('rechaza enlaces a otros dominios (URL completa o dominio suelto)', () => {
    expect(validateOutgoing(email('Mira https://evil.example.com/x para más info.'), { cfg: cfg() }).errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/enlace no permitido: evil\.example\.com/)])
    )
    expect(validateOutgoing(email('Revisa passline.com/precios y compara.'), { cfg: cfg() }).ok).toBe(false)
    expect(validateOutgoing(email('Entra a www.otrodominio.cl ahora.'), { cfg: cfg() }).ok).toBe(false)
  })

  it('no confunde un correo electrónico con un enlace', () => {
    expect(validateOutgoing(email('Escríbeme a ventas@aitickets.cl si tienes dudas.'), { cfg: cfg() }).ok).toBe(true)
  })

  it('permite subdominios de aitickets.cl', () => {
    expect(validateOutgoing(email('Tu web: https://teatro.aitickets.cl'), { cfg: cfg() }).ok).toBe(true)
  })

  it('rechaza un pie sin baja o sin Chanium LLC, y la falta de pie', () => {
    expect(validateOutgoing('Hola, te escribo por tu evento.', { cfg: cfg() }).errors).toContain('falta el pie legal')
    const noLink = `Hola.\n${outreachFooterText({ sourceLabel: 'x' })}`
    expect(validateOutgoing(noLink, { cfg: cfg() }).errors).toContain('falta el enlace de baja')
    const fake = 'Hola.\n--\nSaludos, AI Tickets'
    const errs = validateOutgoing(fake, { cfg: cfg() }).errors
    expect(errs).toEqual(expect.arrayContaining(['el pie no identifica a Chanium LLC', 'el pie no explica cómo darse de baja', 'falta el enlace de baja']))
  })

  it('rechaza precios inventados y porcentajes no aprobados', () => {
    for (const body of ['El plan cuesta $5.000 al mes.', 'Son 9.990 pesos por evento.', 'Solo US$ 10.', 'Cobramos 2 UF.', 'Cuesta CLP 3000.']) {
      expect(validateOutgoing(email(body), { cfg: cfg() }).ok, body).toBe(false)
    }
    expect(validateOutgoing(email('Cobramos solo 5% de comisión.'), { cfg: cfg() }).errors).toContain('porcentaje no aprobado: 5%')
    expect(validateOutgoing(email('Cargo de 7,5 % al comprador.'), { cfg: cfg() }).ok).toBe(false)
    expect(validateOutgoing(email('Para ti es 0% de comisión y el comprador paga 10%.'), { cfg: cfg() }).ok).toBe(true)
  })

  it('rechaza cuerpos demasiado largos (el pie no cuenta)', () => {
    const long = Array.from({ length: 120 }, () => 'palabra').join(' ')
    expect(validateOutgoing(email(long), { cfg: cfg() }).errors[0]).toMatch(/demasiado largo \(120 palabras > 110\)/)
    expect(validateOutgoing(email(long), { cfg: cfg(), maxWords: 140 }).ok).toBe(true)
  })

  it('vacío → error', () => {
    expect(validateOutgoing('', { cfg: cfg() })).toEqual({ ok: false, errors: ['vacío'] })
  })
})

describe('plantillas', () => {
  it('seguimientos y respuesta a interesados pasan la validación', () => {
    const cfg = getOutreachConfig()
    const f1 = composeFollowup({ lead, step: 1, cfg })
    const f2 = composeFollowup({ lead, step: 2, cfg })
    const interested = composeInterestedReply({ lead, cfg })
    // Seguimientos: asunto propio, nunca un "Re:" falso (el destinatario no respondió).
    expect(f1.subject).toBe('Seguimiento: web gratis para La Pérgola de las Flores')
    expect(f2.subject).toBe('Último correo sobre la web gratis para La Pérgola de las Flores')
    // Respuesta a quien nos escribió: "Re:" es verdadero.
    expect(interested.subject).toBe('Re: Web gratis para La Pérgola de las Flores')
    for (const out of [f1, f2, interested]) {
      expect(out.validation).toEqual({ ok: true, errors: [] })
      expect(out.text).toContain('Chanium LLC')
      expect(out.text).toContain('/api/outreach/unsubscribe?t=')
    }
  })

  it('sin OUTREACH_UNSUB_SECRET no hay enlace de baja y la validación falla (no se envía)', () => {
    vi.stubEnv('OUTREACH_UNSUB_SECRET', '')
    const out = composeFollowup({ lead, step: 1, cfg: getOutreachConfig() })
    expect(out.validation.ok).toBe(false)
    expect(out.validation.errors).toContain('falta el enlace de baja')
  })

  it('primer correo sin LLM (outreach apagado / sin API key) usa la plantilla fija y es válido', async () => {
    const res = await composeInitial({ supabase: createFakeSupabase(), budget: null, lead, cfg: getOutreachConfig() })
    expect(res.usedLlm).toBe(false)
    expect(res.validation).toEqual({ ok: true, errors: [] })
    expect(res.text).toContain('La Pérgola de las Flores')
    expect(res.text).toContain('https://aitickets.cl/web-gratis?')
  })

  it('los enlaces llevan tokens firmados válidos', () => {
    const cfg = getOutreachConfig()
    const unsub = new URL(unsubscribeUrl(lead, cfg))
    expect(verifyUnsubToken(unsub.searchParams.get('t'))).toEqual({ leadId: 'lead-42', email: 'contacto@teatrocamino.cl' })
    const signup = new URL(signupUrl(lead, cfg))
    expect(signup.pathname).toBe('/organizadores/registro')
    expect(verifyLeadToken(signup.searchParams.get('lead'))).toEqual({ leadId: 'lead-42' })
    expect(signup.searchParams.get('ref')).toBe('lead_lead-42')
  })

  it('sourceLabel y subjectFor', () => {
    expect(sourceLabel(lead)).toBe('el sitio web público de tu organización (www.teatrocamino.cl)')
    expect(sourceLabel({ ...lead, source: 'inbound_form' })).toMatch(/formulario/)
    expect(sourceLabel({ id: 1, source: 'chilecultura' })).toBe('fuentes públicas de eventos')
    expect(subjectFor({ org_name: 'Teatro\nCamino' })).toBe('Web gratis para Teatro Camino')
    expect(subjectFor({ upcoming_event: { name: 'x'.repeat(80) } }).length).toBeLessThanOrEqual('Web gratis para '.length + 60)
  })
})
