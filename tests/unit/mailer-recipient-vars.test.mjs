// Variables por destinatario de sendEmail (netlify/lib/mailer.mjs): un valor { html, text } lleva el
// nombre escapado al HTML y el original al texto plano y al asunto (antes el texto decía "O&#39;Brien").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyRecipientVars, recipientVarValue, sendEmail } from '../../netlify/lib/mailer.mjs'
import { renderEventNotificationEmail, renderReminderEmail } from '../../netlify/lib/emails/index.mjs'
import { escapeHtml } from '../../netlify/lib/supabase.mjs'

let calls
beforeEach(() => {
  calls = []
  vi.stubEnv('RESEND_API_KEY', 're_test')
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    const n = Array.isArray(JSON.parse(init.body)) ? JSON.parse(init.body).length : 1
    return new Response(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ id: `id-${i}` })) }), { status: 200 })
  }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('recipientVarValue / applyRecipientVars', () => {
  it('un string se usa igual en HTML y texto (compatibilidad)', () => {
    expect(recipientVarValue('Ana', 'html')).toBe('Ana')
    expect(recipientVarValue('Ana', 'text')).toBe('Ana')
    expect(recipientVarValue(null, 'text')).toBe('')
    expect(recipientVarValue(undefined, 'html')).toBe('')
  })

  it('{ html, text } elige según el formato, con respaldo al otro', () => {
    const v = { html: 'O&#39;Brien', text: "O'Brien" }
    expect(recipientVarValue(v, 'html')).toBe('O&#39;Brien')
    expect(recipientVarValue(v, 'text')).toBe("O'Brien")
    expect(recipientVarValue({ text: 'solo texto' }, 'html')).toBe('solo texto')
    expect(recipientVarValue({ html: 'solo html' }, 'text')).toBe('solo html')
    expect(recipientVarValue({}, 'text')).toBe('')
  })

  it('reemplaza los marcadores y deja vacío lo desconocido', () => {
    const vars = { name: { html: 'A&amp;B', text: 'A&B' } }
    expect(applyRecipientVars('Hola %recipient.name% %recipient.otro%!', vars, 'html')).toBe('Hola A&amp;B !')
    expect(applyRecipientVars('Hola %recipient.name% %recipient.otro%!', vars, 'text')).toBe('Hola A&B !')
  })
})

describe('sendEmail con recipientVariables', () => {
  it('HTML escapado, texto plano y asunto con el nombre original', async () => {
    const raw = "O'Brien <b>"
    await sendEmail({
      to: ['Pat <pat@example.com>', 'ana@example.com'],
      subject: 'Hola %recipient.name%',
      html: '<p>Hola %recipient.name%</p>',
      text: 'Hola %recipient.name%',
      recipientVariables: {
        'pat@example.com': { name: { html: escapeHtml(raw), text: raw } },
        'ana@example.com': { name: 'Ana' },
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toMatch(/\/emails\/batch$/)
    const [pat, ana] = calls[0].body
    expect(pat.html).toBe('<p>Hola O&#39;Brien &lt;b&gt;</p>')
    expect(pat.text).toBe("Hola O'Brien <b>")
    expect(pat.subject).toBe("Hola O'Brien <b>")
    expect(ana).toMatchObject({ html: '<p>Hola Ana</p>', text: 'Hola Ana', subject: 'Hola Ana' })
  })

  it('recordatorio real: el texto plano no lleva entidades HTML', async () => {
    const { subject, html, text } = await renderReminderEmail({ eventName: 'Obra', eventDate: 'sábado 3 de octubre', startTime: '20:00', venue: 'Teatro' })
    const url = 'https://aitickets.cl/order/1?a=1&b=2'
    await sendEmail({
      to: ['x@example.com'], subject, html, text,
      recipientVariables: { 'x@example.com': { name: { html: escapeHtml("O'Brien"), text: "O'Brien" }, order_url: { html: escapeHtml(url), text: url } } },
    })
    const [msg] = calls[0].body
    expect(msg.text).not.toContain('&#39;')
    expect(msg.text).not.toContain('%recipient.')
    expect(text).toContain('%recipient.name%')
    expect(msg.text).toContain("O'Brien")
    expect(msg.text).toContain(url)
    expect(msg.html).toContain('O&#39;Brien')
    expect(msg.html).not.toContain("O'Brien")
  })

  it('aviso de cambio real: el texto plano no lleva entidades HTML', async () => {
    const { subject, html, text } = await renderEventNotificationEmail({ eventName: 'Obra', changeType: 'date_change', changeDescription: 'Nueva fecha', eventUrl: 'https://aitickets.cl/eventos/obra' })
    await sendEmail({ to: ['x@example.com'], subject, html, text, recipientVariables: { 'x@example.com': { name: { html: escapeHtml("O'Brien"), text: "O'Brien" } } } })
    const [msg] = calls[0].body
    expect(msg.text).not.toContain('&#39;')
    expect(text).toContain('%recipient.name%')
    expect(msg.text).toContain("O'Brien")
    expect(msg.html).toContain('O&#39;Brien')
  })
})
