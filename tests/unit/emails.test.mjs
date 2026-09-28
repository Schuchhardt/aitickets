// Plantillas de correo (React Email): cada una renderiza con logo, pie legal y sin "undefined";
// los marcadores %recipient.x% quedan literales y el contenido del usuario se escapa.
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import * as emails from '../../netlify/lib/emails/index.mjs'
import { SAMPLES } from '../../scripts/preview-emails.mjs'

const LOGO = 'https://aitickets.cl/logo-dark.png'

describe('plantillas de correo', () => {
  it('hay una muestra por cada plantilla exportada', () => {
    const renderers = Object.keys(emails).filter((k) => k.startsWith('render'))
    expect(renderers.length).toBeGreaterThanOrEqual(10)
    const script = readFileSync(new URL('../../scripts/preview-emails.mjs', import.meta.url), 'utf8')
    for (const r of renderers) expect(script, r).toContain(`emails.${r}(`)
  })

  for (const [name, build] of Object.entries(SAMPLES)) {
    it(`${name}: logo, pie legal, texto plano y sin undefined`, async () => {
      const { subject, html, text } = await build()
      expect(subject).toBeTruthy()
      expect(subject).not.toMatch(/[\r\n]/)
      expect(html).toContain(LOGO)
      expect(html.startsWith('<!DOCTYPE html')).toBe(true)
      expect(html).not.toMatch(/rel="preload"/)
      expect(html).toContain('alt="AI Tickets"')
      // Pie mínimo: solo marca y operador
      expect(html).toContain('AI Tickets · Chanium LLC')
      expect(html).not.toContain('https://aitickets.cl/terms')
      expect(text).toContain('Chanium LLC')
      expect(text).not.toContain(LOGO)
      for (const out of [subject, html, text]) {
        expect(out).not.toMatch(/undefined|\bnull\b|NaN|\[object Object\]/)
      }
    })
  }

  it('verify: botón "Confirmar mi correo" con el enlace', async () => {
    const url = 'https://aitickets.cl/organizadores/verificar?t=abc.def'
    const { html, text } = await emails.renderVerifyEmail({ name: 'Ana Pérez', orgName: 'Sur', url })
    expect(html).toContain('Confirmar mi correo')
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('Ana')
    expect(text).toContain(url)
  })

  it('magic link: textos por propósito, 60 minutos y un solo uso', async () => {
    const url = 'https://aitickets.cl/auth/link?t=x&y=1'
    const recovery = await emails.renderMagicLinkEmail({ url, purpose: 'recovery' })
    expect(recovery.html).toContain('Ingresa y crea una nueva contraseña')
    const change = await emails.renderMagicLinkEmail({ url, purpose: 'change-password' })
    expect(change.html).toContain('Cambia tu contraseña')
    const login = await emails.renderMagicLinkEmail({ url, purpose: 'login' })
    expect(login.subject).toContain('ingresar')
    for (const r of [recovery, change, login]) {
      expect(r.text).toContain('60 minutos')
      expect(r.text).toContain('una sola vez')
      expect(r.html).toContain('href="https://aitickets.cl/auth/link?t=x&amp;y=1"')
    }
  })

  it('recordatorio: conserva %recipient.name% y %recipient.order_url% en HTML y texto', async () => {
    const { html, text } = await emails.renderReminderEmail({ eventName: 'Show', eventDate: 'sábado 12 de octubre', startTime: '20:00', venue: 'Teatro' })
    expect(html).toContain('%recipient.name%')
    expect(html).toContain('href="%recipient.order_url%"')
    expect(text).toContain('%recipient.name%')
    expect(text).toContain('%recipient.order_url%')
  })

  it('aviso de cambio: conserva %recipient.name% y usa la etiqueta del tipo', async () => {
    const { subject, html, text } = await emails.renderEventNotificationEmail({ eventName: 'Show', changeType: 'cancellation', changeDescription: 'Se cancela', eventUrl: 'https://aitickets.cl/eventos/show' })
    expect(subject).toContain('Aviso importante')
    expect(html).toContain('Cancelación')
    expect(html).toContain('%recipient.name%')
    expect(text).toContain('%recipient.name%')
  })

  it('entradas: evento, funciones, dirección secreta, líneas, totales y calendario', async () => {
    const { subject, html, text } = await SAMPLES.tickets()
    expect(subject).toBe('🎟️ Tus entradas para Festival de Jazz de Valparaíso')
    expect(html).toContain('Ver mis entradas (QR)')
    expect(html).toContain('https://aitickets.cl/order/8f2c1e4a-1234-4c1a-9e1f-0a1b2c3d4e5f')
    expect(html).toContain('Dirección exclusiva para asistentes')
    expect(html).toContain('Bodega 7')
    expect(html).toContain('Cargo por servicio')
    expect(html).toContain('$66.000')
    expect(html).toContain('Agregar a Google Calendar')
    expect(html).toContain('Comprobante de compra')
    expect(text).toMatch(/2 x General .*\$30\.000/)
    const free = await SAMPLES['tickets-free']()
    expect(free.html).toContain('Gratis')
    expect(free.html).not.toContain('Dirección exclusiva')
    expect(free.html).not.toContain('Google Calendar')
  })

  it('escapa HTML del contenido del usuario y descarta URLs no http(s)', async () => {
    const { html } = await emails.renderSiteContactMessageEmail({
      siteName: '<b>Sitio</b>',
      contactUrl: 'javascript:alert(1)',
      name: '<script>alert(1)</script>',
      email: 'a@b.cl',
      message: '<img src=x onerror=alert(1)>\nlinea 2',
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('linea 2')
  })

  it('logo: usa SITE_URL público y cae a aitickets.cl en localhost', async () => {
    vi.stubEnv('SITE_URL', 'https://staging.aitickets.cl/')
    expect(emails.logoUrl()).toBe('https://staging.aitickets.cl/logo-dark.png')
    vi.stubEnv('SITE_URL', 'http://localhost:4321')
    expect(emails.logoUrl()).toBe(LOGO)
  })
})

describe('entradas: QR inline', () => {
  it('muestra un QR por entrada como imagen cid: y avisa si hay más que el límite', async () => {
    const emails = await import('../../netlify/lib/emails/index.mjs')
    const { html, text } = await emails.renderTicketsEmail({
      customerName: 'Ana',
      eventName: 'Evento',
      qrTickets: [
        { cid: 'qr-entrada-1', index: 1, total: 3, label: 'General', functionLabel: '' },
        { cid: 'qr-entrada-2', index: 2, total: 3, label: 'VIP <b>', functionLabel: 'vie 2 oct · 20:30' },
      ],
      qrMoreCount: 1,
      ticketLines: [{ name: 'General', quantity: 3, unitPrice: 0 }],
      orderUrl: 'https://aitickets.cl/order/x',
    })
    expect(html).toContain('src="cid:qr-entrada-1"')
    expect(html).toContain('src="cid:qr-entrada-2"')
    expect(html).toContain('Entrada 2 de 3 · vie 2 oct · 20:30')
    expect(html).not.toContain('VIP <b>')
    expect(html).toMatch(/Y 1 entrada más/)
    expect(text).toContain('General')
  })
})
