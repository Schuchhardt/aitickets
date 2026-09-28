// Datos legales (netlify/lib/legal.mjs) y pies de correo (netlify/lib/mailer.mjs).
// LEGAL se calcula al importar el módulo, así que los casos con dirección configurada reimportan
// con vi.resetModules() después de fijar el entorno.
import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadLegal(env = {}) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return import('../../netlify/lib/legal.mjs')
}

async function loadMailer(env = {}) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return import('../../netlify/lib/mailer.mjs')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('legalReady', () => {
  it('es false sin dirección ni correo legal configurados', async () => {
    const { legalReady } = await loadLegal()
    expect(legalReady()).toBe(false)
  })

  it('es false con solo la dirección o solo el correo', async () => {
    const { legalReady } = await loadLegal()
    vi.stubEnv('CHANIUM_LEGAL_ADDRESS', '8 The Green, Dover, DE 19901, EE.UU.')
    expect(legalReady()).toBe(false)
    vi.unstubAllEnvs()
    vi.stubEnv('CHANIUM_LEGAL_EMAIL', 'legal@aitickets.cl')
    expect(legalReady()).toBe(false)
  })

  it('es false con valores en blanco', async () => {
    const { legalReady } = await loadLegal()
    vi.stubEnv('CHANIUM_LEGAL_ADDRESS', '   ')
    vi.stubEnv('CHANIUM_LEGAL_EMAIL', '  ')
    expect(legalReady()).toBe(false)
  })

  it('es true con dirección + correo legal (o su alias LEGAL_CONTACT_EMAIL), leyendo el entorno en cada llamada', async () => {
    const { legalReady } = await loadLegal()
    vi.stubEnv('CHANIUM_LEGAL_ADDRESS', '8 The Green, Dover, DE 19901, EE.UU.')
    vi.stubEnv('CHANIUM_LEGAL_EMAIL', 'legal@aitickets.cl')
    expect(legalReady()).toBe(true)
    vi.unstubAllEnvs()
    vi.stubEnv('CHANIUM_LEGAL_ADDRESS', '8 The Green, Dover, DE 19901, EE.UU.')
    vi.stubEnv('LEGAL_CONTACT_EMAIL', 'legal@aitickets.cl')
    expect(legalReady()).toBe(true)
  })
})

describe('LEGAL sin configurar (valores públicos neutros)', () => {
  it('identifica a Chanium LLC de Delaware y nunca muestra TODO ni "AI Tickets SpA"', async () => {
    const { LEGAL, legalLine, outreachFooterText } = await loadLegal()
    expect(LEGAL.entity).toBe('Chanium LLC')
    expect(LEGAL.state).toBe('Delaware')
    expect(LEGAL.address).toBe('')
    expect(LEGAL.addressLine).toBe('Chanium LLC, sociedad de Delaware, EE.UU.')
    expect(LEGAL.legalEmail).toBe('contacto@aitickets.cl')
    expect(LEGAL.serviceFeeLabel).toBe('Cargo por servicio')
    const texts = [LEGAL.addressLine, legalLine(), outreachFooterText({ sourceLabel: 'x', unsubscribeUrl: 'https://aitickets.cl/u' })]
    for (const t of texts) {
      expect(t).not.toMatch(/TODO/i)
      expect(t).not.toMatch(/SpA/)
    }
    expect(Object.isFrozen(LEGAL)).toBe(true)
  })

  it('SERVICE_FEE_TAX_MODE=included agrega "IVA incluido"; un valor inválido cae a unknown', async () => {
    let { LEGAL } = await loadLegal({ SERVICE_FEE_TAX_MODE: 'included' })
    expect(LEGAL.serviceFeeLabel).toBe('Cargo por servicio (IVA incluido)')
    ;({ LEGAL } = await loadLegal({ SERVICE_FEE_TAX_MODE: 'cualquiera' }))
    expect(LEGAL.serviceFeeTaxMode).toBe('unknown')
  })

  it('LEGAL_EFFECTIVE_DATE inválida cae a la fecha por defecto', async () => {
    const { LEGAL } = await loadLegal({ LEGAL_EFFECTIVE_DATE: 'mañana' })
    expect(LEGAL.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('outreachFooterText', () => {
  const ADDRESS = '8 The Green, Dover, DE 19901, EE.UU.'

  it('con dirección configurada incluye dirección, correo legal, origen del dato y enlace de baja', async () => {
    const { outreachFooterText } = await loadLegal({ CHANIUM_LEGAL_ADDRESS: ADDRESS, CHANIUM_LEGAL_EMAIL: 'legal@aitickets.cl' })
    const footer = outreachFooterText({
      sourceLabel: 'el sitio web público de tu organización (teatro.cl)',
      unsubscribeUrl: 'https://aitickets.cl/api/outreach/unsubscribe?t=abc',
    })
    expect(footer.startsWith('--\n')).toBe(true)
    expect(footer).toContain('Chanium LLC')
    expect(footer).toContain(ADDRESS)
    expect(footer).toContain('legal@aitickets.cl')
    expect(footer).toContain('teatro.cl')
    expect(footer).toContain('https://aitickets.cl/api/outreach/unsubscribe?t=abc')
    expect(footer).toMatch(/correo comercial/)
    expect(footer).toMatch(/responde "NO"/)
  })

  it('sin enlace de baja igual explica cómo darse de baja', async () => {
    const { outreachFooterText } = await loadLegal()
    const footer = outreachFooterText({})
    expect(footer).toMatch(/Si no quieres recibir más correos, responde "NO"/)
    expect(footer).toContain('sociedad de responsabilidad limitada constituida en Delaware')
  })

  it('quita saltos de línea del origen (no se puede inyectar texto en el pie)', async () => {
    const { outreachFooterText } = await loadLegal()
    const footer = outreachFooterText({ sourceLabel: 'x\n\nhttps://evil.example\n' })
    expect(footer).not.toMatch(/x\n\nhttps/)
  })
})

describe('pie legal de correos transaccionales (mailer)', () => {
  it('legalFooterHtml es mínimo: marca, operador y la baja cuando corresponde', async () => {
    const { legalFooterHtml } = await loadMailer()
    const html = legalFooterHtml({ reason: 'Recibes este correo porque <compraste>', unsubscribeUrl: 'https://aitickets.cl/baja?t=1&x=2' })
    expect(html).toContain('AI Tickets · Chanium LLC')
    expect(html).toContain('href="https://aitickets.cl/baja?t=1&amp;x=2"')
    expect(html).not.toContain('compraste')
    expect(legalFooterHtml()).not.toContain('baja')
  })

  it('ignora enlaces de baja que no son http(s)', async () => {
    const { legalFooterHtml, legalFooterText } = await loadMailer()
    expect(legalFooterHtml({ unsubscribeUrl: 'javascript:alert(1)' })).not.toContain('javascript:')
    expect(legalFooterText({ unsubscribeUrl: 'javascript:alert(1)' })).not.toContain('javascript:')
  })

  it('el pie de texto incluye la baja cuando corresponde', async () => {
    const { legalFooterText } = await loadMailer()
    const text = legalFooterText({ unsubscribeUrl: 'https://aitickets.cl/u' })
    expect(text).toContain('AI Tickets · Chanium LLC')
    expect(text).toContain('Darme de baja: https://aitickets.cl/u')
  })

  it('el remitente por defecto es no-reply@ y se puede sobrescribir', async () => {
    let mailer = await loadMailer()
    expect(mailer.MAIL_FROM).toMatch(/^AI Tickets <no-reply@/)
    mailer = await loadMailer({ MAIL_FROM: 'Otro <otro@aitickets.cl>' })
    expect(mailer.MAIL_FROM).toBe('Otro <otro@aitickets.cl>')
  })
})
