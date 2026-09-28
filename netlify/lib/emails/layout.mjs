// Base común de los correos transaccionales hechos con React Email.
// Sin JSX a propósito (React.createElement): así lo importan tal cual el esbuild de Netlify y Vite/Astro,
// sin configurar JSX en ninguno de los dos. Solo servidor.
//
// Diseño: tarjeta blanca sobre fondo gris claro, franja negra con el logo de AI Tickets, acento lima
// (#9AE600), botones negros, tipografía Prompt con respaldo Arial, preheader y pie legal (Chanium LLC).
import * as React from 'react'
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Img,
  Text,
  Heading,
  Button,
  Link,
  Hr,
  Preview,
} from '@react-email/components'
// renderToStaticMarkup de la build "edge" de react-dom: no usa módulos de Node (util, stream, crypto...),
// así que funciona igual en el bundle ESM de esbuild (Netlify) que en Vite/Astro. render() de
// @react-email/render carga react-dom/server (build node), que dentro de un bundle ESM sin shim de require
// falla con 'Dynamic require of "util" is not supported'. Se replica lo que hace render(): doctype XHTML y
// sin los <link rel="preload" as="image"> que agrega React 19. El texto plano usa toPlainText de React Email.
import { renderToStaticMarkup } from 'react-dom/server.edge'
import { toPlainText } from '@react-email/render'
import { LEGAL } from '../legal.mjs'

export const h = React.createElement

export const COLORS = Object.freeze({
  background: '#f4f4f5',
  card: '#ffffff',
  border: '#e4e4e7',
  text: '#18181b',
  muted: '#71717a',
  subtle: '#a1a1aa',
  black: '#000000',
  lime: '#9AE600',
  limeSoft: '#f3fde0',
  limeText: '#3f6212',
  panel: '#f4f4f5',
  warnBg: '#fefce8',
  warnBorder: '#fde68a',
  warnText: '#92400e',
  danger: '#dc2626',
  dangerSoft: '#fef2f2',
})

export const FONT_FAMILY = "Prompt, Arial, Helvetica, sans-serif"

const PLACEHOLDER_RE = /^%recipient\.[A-Za-z0-9_]+%$/

const envValue = (name) => {
  try {
    const value = globalThis.process?.env?.[name]
    return typeof value === 'string' ? value.trim() : ''
  } catch {
    return ''
  }
}

/** Origen del sitio (SITE_URL), leído al renderizar para no depender del orden de carga. */
export function siteUrl() {
  return (envValue('SITE_URL') || LEGAL.siteUrl).replace(/\/+$/, '')
}

/**
 * URL absoluta del logo. Los clientes de correo no pueden cargar localhost ni http, así que en desarrollo
 * se usa el sitio público.
 */
export function logoUrl() {
  const base = siteUrl()
  const publicBase = /^https:\/\//.test(base) && !/\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(base) ? base : LEGAL.siteUrl
  return `${publicBase}/logo-dark.png`
}

/** Solo http(s), mailto o un marcador %recipient.x% (se reemplaza al enviar). Cualquier otra cosa -> ''. */
export function safeHref(url) {
  const value = String(url ?? '').trim()
  if (!value) return ''
  if (PLACEHOLDER_RE.test(value)) return value
  if (/^mailto:[^\s<>"]+$/i.test(value)) return value
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : ''
  } catch {
    return ''
  }
}

/** Texto seguro para mostrar (sin null/undefined). React se encarga de escapar. */
export const str = (value) => (value == null ? '' : String(value))

/** Texto con saltos de línea -> nodos con <br/>. */
export function multiline(value) {
  const lines = str(value).split(/\r?\n/)
  const out = []
  lines.forEach((line, i) => {
    if (i > 0) out.push(h('br', { key: `br-${i}` }))
    out.push(line)
  })
  return out
}

// ---------- Piezas reutilizables ----------

/** Props de tablas de datos: en el texto plano se renderizan como columnas (data-text-format). */
export const TABLE_PROPS = Object.freeze({ width: '100%', cellPadding: 0, cellSpacing: 0, role: 'presentation', 'data-text-format': 'dataTable', style: { borderCollapse: 'collapse' } })

const textBase = { fontFamily: FONT_FAMILY, color: COLORS.text, margin: 0 }

export function Title({ children, align = 'center' }) {
  return h(
    Heading,
    { as: 'h1', style: { ...textBase, fontSize: '24px', lineHeight: '32px', fontWeight: 700, textAlign: align, margin: '0 0 8px' } },
    children
  )
}

export function Subtitle({ children, align = 'center' }) {
  return h(
    Heading,
    { as: 'h2', style: { ...textBase, fontSize: '17px', lineHeight: '26px', fontWeight: 500, color: '#3f3f46', textAlign: align, margin: '0 0 24px' } },
    children
  )
}

export function Paragraph({ children, align = 'left', muted = false, small = false, style = {} }) {
  return h(
    Text,
    {
      style: {
        ...textBase,
        fontSize: small ? '13px' : '15px',
        lineHeight: small ? '20px' : '24px',
        color: muted ? COLORS.muted : COLORS.text,
        textAlign: align,
        margin: '0 0 16px',
        ...style,
      },
    },
    children
  )
}

export function Badge({ children, tone = 'lime' }) {
  const tones = {
    lime: { background: COLORS.lime, color: COLORS.black },
    danger: { background: COLORS.dangerSoft, color: COLORS.danger },
    dark: { background: COLORS.black, color: '#ffffff' },
  }
  return h(
    Section,
    { style: { textAlign: 'center', margin: '0 0 16px' } },
    h(
      'span',
      {
        style: {
          display: 'inline-block',
          padding: '4px 14px',
          borderRadius: '999px',
          fontFamily: FONT_FAMILY,
          fontSize: '12px',
          lineHeight: '18px',
          fontWeight: 600,
          letterSpacing: '0.3px',
          ...(tones[tone] || tones.lime),
        },
      },
      children
    )
  )
}

export function PrimaryButton({ href, children, hint }) {
  const url = safeHref(href)
  return h(
    Section,
    { style: { textAlign: 'center', margin: '8px 0 24px' } },
    h(
      Button,
      {
        href: url,
        style: {
          backgroundColor: COLORS.black,
          color: '#ffffff',
          borderRadius: '10px',
          fontFamily: FONT_FAMILY,
          fontSize: '15px',
          fontWeight: 600,
          lineHeight: '20px',
          textDecoration: 'none',
          textAlign: 'center',
          display: 'inline-block',
          padding: '14px 28px',
          borderBottom: `3px solid ${COLORS.lime}`,
        },
      },
      children
    ),
    hint ? h(Text, { style: { ...textBase, fontSize: '12px', lineHeight: '18px', color: COLORS.muted, margin: '10px 0 0', textAlign: 'center' } }, hint) : null
  )
}

/** Panel gris (o amarillo para avisos) con un rótulo opcional. */
export function Panel({ label, children, tone = 'default' }) {
  const tones = {
    default: { backgroundColor: COLORS.panel, border: `1px solid ${COLORS.panel}` },
    outline: { backgroundColor: '#ffffff', border: `1px solid ${COLORS.border}` },
    warn: { backgroundColor: COLORS.warnBg, border: `1px solid ${COLORS.warnBorder}` },
    lime: { backgroundColor: COLORS.limeSoft, border: `1px solid ${COLORS.lime}` },
  }
  const labelColor = tone === 'warn' ? COLORS.warnText : tone === 'lime' ? COLORS.limeText : COLORS.muted
  return h(
    Section,
    { style: { borderRadius: '12px', padding: '16px 18px', margin: '0 0 16px', ...(tones[tone] || tones.default) } },
    label
      ? h(Text, { style: { ...textBase, fontSize: '12px', lineHeight: '18px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px', color: labelColor, margin: '0 0 8px' } }, label)
      : null,
    children
  )
}

/** Tabla de pares etiqueta/valor (fecha, hora, lugar...). rows: [{label, value, strong?}] */
export function KeyValueTable({ rows }) {
  const cell = { fontFamily: FONT_FAMILY, fontSize: '14px', lineHeight: '20px', padding: '6px 0', verticalAlign: 'top' }
  return h(
    'table',
    TABLE_PROPS,
    h(
      'tbody',
      null,
      rows
        .filter((r) => r && r.value != null && r.value !== '')
        .map((r, i) =>
          h(
            'tr',
            { key: `kv-${i}` },
            h('td', { style: { ...cell, color: COLORS.muted, paddingRight: '12px', whiteSpace: 'nowrap' } }, r.label),
            h('td', { style: { ...cell, color: COLORS.text, fontWeight: r.strong === false ? 400 : 500, textAlign: r.align || 'right' } }, r.value)
          )
        )
    )
  )
}

/** "Si el botón no funciona, copia esta dirección" (el enlace completo, cortable). */
export function FallbackLink({ href }) {
  const url = safeHref(href)
  if (!url) return null
  return h(
    Section,
    { style: { margin: '0 0 8px' } },
    h(Text, { style: { ...textBase, fontSize: '12px', lineHeight: '18px', color: COLORS.muted, margin: '0 0 4px' } }, 'Si el botón no funciona, copia esta dirección en tu navegador:'),
    h(
      Text,
      { style: { ...textBase, fontSize: '12px', lineHeight: '18px', margin: 0, wordBreak: 'break-all' } },
      h(Link, { href: url, style: { color: COLORS.muted, textDecoration: 'underline' } }, url)
    )
  )
}

export function Divider() {
  return h(Hr, { style: { borderColor: COLORS.border, borderTopWidth: '1px', margin: '24px 0' } })
}

// ---------- Pie legal ----------

/**
 * Pie mínimo: "AI Tickets · Chanium LLC". Solo agrega el enlace de baja cuando el correo lo requiere
 * (unsubscribeUrl); `reason` se acepta por compatibilidad pero ya no se muestra.
 */
export function LegalFooter({ unsubscribeUrl } = {}) {
  const unsub = unsubscribeUrl ? safeHref(unsubscribeUrl) : ''
  const line = { fontFamily: FONT_FAMILY, fontSize: '11px', lineHeight: '16px', color: COLORS.muted, textAlign: 'center', margin: 0 }
  const link = { color: COLORS.muted, textDecoration: 'underline' }
  return h(
    Section,
    { style: { padding: '16px 24px 0' } },
    h(
      Text,
      { style: line },
      `${LEGAL.brand} · ${LEGAL.entity}`,
      unsub ? ' · ' : null,
      unsub ? h(Link, { href: unsub, style: link }, 'Darme de baja') : null
    )
  )
}

// ---------- Layout ----------

/**
 * @param {{ preview?: string, footer?: { reason?: string, unsubscribeUrl?: string }, children?: any }} props
 */
export function EmailLayout({ preview, footer = {}, children }) {
  return h(
    Html,
    { lang: 'es', dir: 'ltr' },
    h(
      Head,
      null,
      h('meta', { name: 'color-scheme', content: 'light' }),
      h('meta', { name: 'supported-color-schemes', content: 'light' }),
      h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700&display=swap' }),
      h('style', null, '@media only screen and (max-width:600px){.ait-card{padding:24px 18px !important}.ait-outer{padding:16px 8px !important}}')
    ),
    preview ? h(Preview, null, str(preview)) : null,
    h(
      Body,
      { style: { backgroundColor: COLORS.background, margin: 0, padding: 0, fontFamily: FONT_FAMILY, WebkitTextSizeAdjust: '100%' } },
      h(
        Container,
        { className: 'ait-outer', style: { maxWidth: '600px', width: '100%', margin: '0 auto', padding: '32px 12px' } },
        h(
          Section,
          { style: { backgroundColor: COLORS.black, borderRadius: '16px 16px 0 0', padding: '22px 24px', textAlign: 'center' } },
          h(
            Link,
            { href: siteUrl(), style: { textDecoration: 'none' }, 'data-skip-in-text': 'true' },
            h(Img, { src: logoUrl(), width: 160, height: 34, alt: 'AI Tickets', style: { display: 'block', margin: '0 auto', border: 0, outline: 'none', width: '160px', height: 'auto', maxWidth: '160px' } })
          )
        ),
        h(Section, { style: { backgroundColor: COLORS.lime, height: '4px', lineHeight: '4px', fontSize: '4px' } }, ' '),
        h(
          Section,
          {
            className: 'ait-card',
            style: {
              backgroundColor: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderTop: 'none',
              borderRadius: '0 0 16px 16px',
              padding: '32px 32px 28px',
            },
          },
          children
        ),
        h(LegalFooter, footer)
      )
    )
  )
}

// ---------- Render ----------

const TEXT_OPTIONS = {
  selectors: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) => ({
    selector,
    options: { uppercase: false },
  })),
}

const DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">'

function stripImagePreloads(markup) {
  return markup.replace(/<link\b[^>]*>/gi, (tag) => (/\brel="preload"/i.test(tag) && /\bas="image"/i.test(tag) ? '' : tag))
}

/**
 * Renderiza un elemento a { subject, html, text }. Los marcadores %recipient.x% se mantienen tal cual
 * (React no escapa "%") para que sendEmail los reemplace por destinatario.
 * Es async por contrato (igual que render() de React Email), aunque hoy el render es síncrono.
 */
export async function renderEmail(subject, element) {
  const markup = stripImagePreloads(renderToStaticMarkup(element))
  const html = `${DOCTYPE}${markup.replace(/<!DOCTYPE[^>]*>/i, '')}`
  const text = toPlainText(markup, TEXT_OPTIONS)
  return { subject: str(subject).replace(/[\r\n]+/g, ' ').trim(), html, text: text.replace(/\n{3,}/g, '\n\n').trim() }
}
