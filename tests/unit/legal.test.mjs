// Datos legales (netlify/lib/legal.mjs) y pies de correo (netlify/lib/mailer.mjs).
// LEGAL se calcula al importar el módulo, así que los casos que sobrescriben el entorno reimportan
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
  it('es true por defecto: los datos públicos de Chanium, LLC vienen fijados en legal.mjs', async () => {
    const { legalReady } = await loadLegal()
    expect(legalReady()).toBe(true)
  })

  it('valores en blanco en el entorno caen a los valores por defecto', async () => {
    const { legalReady, LEGAL } = await loadLegal({ CHANIUM_LEGAL_ADDRESS: '   ', CHANIUM_LEGAL_EMAIL: '  ' })
    expect(legalReady()).toBe(true)
    expect(LEGAL.address).toContain('Lican Ray 6742')
    expect(LEGAL.legalEmail).toBe('hello@chanium.com')
  })

  it('el entorno sobrescribe dirección y correo legal (o su alias LEGAL_CONTACT_EMAIL)', async () => {
    let { LEGAL } = await loadLegal({ CHANIUM_LEGAL_ADDRESS: '8 The Green, Dover, DE 19901, EE.UU.', CHANIUM_LEGAL_EMAIL: 'legal@aitickets.cl' })
    expect(LEGAL.address).toBe('8 The Green, Dover, DE 19901, EE.UU.')
    expect(LEGAL.legalEmail).toBe('legal@aitickets.cl')
    expect(LEGAL.privacyEmail).toBe('legal@aitickets.cl')
    vi.unstubAllEnvs()
    ;({ LEGAL } = await loadLegal({ LEGAL_CONTACT_EMAIL: 'otro@aitickets.cl' }))
    expect(LEGAL.legalEmail).toBe('otro@aitickets.cl')
  })
})

describe('LEGAL por defecto (Chanium, LLC)', () => {
  it('trae la razón social, el registro de Delaware y el domicilio, y nunca muestra TODO ni "AI Tickets SpA"', async () => {
    const { LEGAL, legalLine, outreachFooterText } = await loadLegal()
    expect(LEGAL.entity).toBe('Chanium LLC')
    expect(LEGAL.legalName).toBe('Chanium, LLC')
    expect(LEGAL.entityKind).toBe('Delaware LLC')
    expect(LEGAL.state).toBe('Delaware')
    expect(LEGAL.delawareFileNumber).toBe('10669971')
    expect(LEGAL.formationDate).toBe('2026-06-22')
    expect(LEGAL.representative).toBe('Sebastian Schuchhardt')
    expect(LEGAL.phone).toBe('+56 9 8234 7140')
    expect(LEGAL.address).toBe('Lican Ray 6742, Vitacura, Región Metropolitana, 7660043, Chile')
    expect(LEGAL.addressLine).toBe(LEGAL.address)
    expect(LEGAL.legalEmail).toBe('hello@chanium.com')
    expect(LEGAL.privacyEmail).toBe('hello@chanium.com')
    expect(LEGAL.supportEmail).toBe('soporte@aitickets.cl')
    expect(legalLine()).toContain('Chanium, LLC')
    expect(legalLine()).toContain('Lican Ray 6742')
    const texts = [LEGAL.addressLine, legalLine(), outreachFooterText({ sourceLabel: 'x', unsubscribeUrl: 'https://aitickets.cl/u' })]
    for (const t of texts) {
      expect(t).not.toMatch(/TODO/i)
      expect(t).not.toMatch(/SpA/)
    }
    expect(Object.isFrozen(LEGAL)).toBe(true)
  })

  it('cargo por servicio: 8% + IVA por defecto; SERVICE_FEE_TAX_MODE lo cambia y un valor inválido cae a added', async () => {
    let { LEGAL } = await loadLegal()
    expect(LEGAL.serviceFeeTaxMode).toBe('added')
    expect(LEGAL.serviceFeeLabel).toBe('Cargo por servicio (8% + IVA)')
    expect(LEGAL.serviceFeeRate).toBe(0.08)
    expect(LEGAL.serviceFeeVatRate).toBe(0.19)
    ;({ LEGAL } = await loadLegal({ SERVICE_FEE_TAX_MODE: 'included' }))
    expect(LEGAL.serviceFeeLabel).toBe('Cargo por servicio (IVA incluido)')
    ;({ LEGAL } = await loadLegal({ SERVICE_FEE_TAX_MODE: 'cualquiera' }))
    expect(LEGAL.serviceFeeTaxMode).toBe('added')
  })

  it('el aviso de retracto dice que se devuelve el cargo pero no su IVA, salvando los derechos irrenunciables', async () => {
    const { LEGAL } = await loadLegal()
    expect(LEGAL.retractoNotice).toMatch(/3 bis letra b/)
    expect(LEGAL.retractoNotice).toMatch(/cargo por servicio \(no su IVA\)/)
    expect(LEGAL.retractoNotice).toMatch(/irrenunciables/)
    expect(LEGAL.retractoNotice).not.toMatch(/incluido el cargo por servicio/)
  })

  it('LEGAL_EFFECTIVE_DATE inválida cae a la fecha por defecto', async () => {
    const { LEGAL } = await loadLegal({ LEGAL_EFFECTIVE_DATE: 'mañana' })
    expect(LEGAL.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('el EIN nunca se publica', () => {
  const EIN_RE = /38-?4403319/

  it('no aparece en LEGAL ni en los textos legales generados', async () => {
    const { LEGAL, legalLine, outreachFooterText } = await loadLegal()
    const mailer = await import('../../netlify/lib/mailer.mjs')
    const built = [
      JSON.stringify(LEGAL),
      legalLine(),
      outreachFooterText({ sourceLabel: 'x', unsubscribeUrl: 'https://aitickets.cl/u' }),
      mailer.legalFooterHtml({ unsubscribeUrl: 'https://aitickets.cl/u' }),
      mailer.legalFooterText({ unsubscribeUrl: 'https://aitickets.cl/u' }),
    ]
    for (const t of built) expect(t).not.toMatch(EIN_RE)
  })

  it('no aparece en las fuentes de las páginas legales, legal.mjs ni .env.example', async () => {
    const { readFileSync, existsSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = join(import.meta.dirname, '..', '..')
    const files = [
      'netlify/lib/legal.mjs',
      'src/lib/legal.ts',
      'src/pages/terms.astro',
      'src/pages/privacy.astro',
      'src/pages/terminos-productores.astro',
      '.env.example',
      ...readdirSync(join(root, 'docs/legal')).map(f => `docs/legal/${f}`),
    ]
    for (const f of files) expect(readFileSync(join(root, f), 'utf8'), f).not.toMatch(EIN_RE)
    // Si hay un build, las páginas legales prerenderizadas tampoco lo contienen
    for (const page of ['terms', 'privacy', 'terminos-productores']) {
      for (const dir of ['dist', 'dist/client']) {
        const html = join(root, dir, page, 'index.html')
        if (existsSync(html)) expect(readFileSync(html, 'utf8'), html).not.toMatch(EIN_RE)
      }
    }
  })
})

describe('outreachFooterText', () => {
  it('por defecto incluye la razón social, el domicilio, el correo legal, el origen del dato y el enlace de baja', async () => {
    const { outreachFooterText } = await loadLegal()
    const footer = outreachFooterText({
      sourceLabel: 'el sitio web público de tu organización (teatro.cl)',
      unsubscribeUrl: 'https://aitickets.cl/api/outreach/unsubscribe?t=abc',
    })
    expect(footer.startsWith('--\n')).toBe(true)
    // compose.mjs / instantly.mjs exigen que el pie contenga LEGAL.entity ("Chanium LLC")
    expect(footer).toContain('Chanium LLC')
    expect(footer).toContain('Chanium, LLC · Lican Ray 6742, Vitacura, Región Metropolitana, 7660043, Chile · hello@chanium.com')
    expect(footer).toContain('teatro.cl')
    expect(footer).toContain('https://aitickets.cl/api/outreach/unsubscribe?t=abc')
    expect(footer).toMatch(/correo comercial/)
    expect(footer).toMatch(/responde "NO"/)
  })

  it('usa la dirección y el correo del entorno si se sobrescriben', async () => {
    const ADDRESS = '8 The Green, Dover, DE 19901, EE.UU.'
    const { outreachFooterText } = await loadLegal({ CHANIUM_LEGAL_ADDRESS: ADDRESS, CHANIUM_LEGAL_EMAIL: 'legal@aitickets.cl' })
    const footer = outreachFooterText({})
    expect(footer).toContain(ADDRESS)
    expect(footer).toContain('legal@aitickets.cl')
  })

  it('sin enlace de baja igual explica cómo darse de baja', async () => {
    const { outreachFooterText } = await loadLegal()
    const footer = outreachFooterText({})
    expect(footer).toMatch(/Si no quieres recibir más correos, responde "NO"/)
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
