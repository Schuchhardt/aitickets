// Correo con las entradas de una orden. Los datos los arma netlify/lib/tickets-email.mjs (que también
// genera el adjunto .ics); aquí solo se presenta.
import { Link, Img } from '@react-email/components'
import { LEGAL } from '../legal.mjs'
import { FEE_INCLUDED_NOTE, SERVICE_FEE_TAX_LABEL, serviceFeeLabelFor } from '../fees.mjs'
import { discountLineLabel } from '../discounts.mjs'
import { orderCopy, isPaidKind } from '../order-kind.mjs'
import { h, str, safeHref, COLORS, FONT_FAMILY, EmailLayout, TABLE_PROPS, Title, Subtitle, Paragraph, Badge, PrimaryButton, Panel, renderEmail } from './layout.mjs'

export const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`

const cell = { fontFamily: FONT_FAMILY, fontSize: '14px', lineHeight: '20px', padding: '6px 0', verticalAlign: 'top' }

function DateRows({ dateLines }) {
  if (!dateLines.length) {
    return h(Paragraph, { small: true, muted: true, style: { margin: 0 } }, 'Revisa los detalles en el link de tus entradas.')
  }
  return h(
    'table',
    TABLE_PROPS,
    h(
      'tbody',
      null,
      dateLines.map((d, i) =>
        h(
          'tr',
          { key: `d-${i}` },
          h(
            'td',
            { style: { ...cell, color: COLORS.text } },
            h('strong', null, str(d.date)),
            d.time ? ` · ${str(d.time)} hrs` : '',
            d.place ? h('br') : null,
            d.place ? h('span', { style: { color: COLORS.muted } }, str(d.place)) : null
          )
        )
      )
    )
  )
}

function ReceiptRows({ ticketLines, subtotal, discountCode, discountAmount, fee, feeNet, feeIva, feeIncluded = false, total }) {
  const rows = ticketLines.map((t, i) => {
    const qty = Number(t.quantity) || 0
    const unit = Number(t.unitPrice) || 0
    const ticketUrl = safeHref(t.url)
    return h(
      'tr',
      { key: `t-${i}` },
      h(
        'td',
        { style: { ...cell, color: '#3f3f46' } },
        `${qty} x ${str(t.name)}`,
        ticketUrl ? h('span', null, ' · ', h(Link, { href: ticketUrl, style: { color: COLORS.text, textDecoration: 'underline', fontSize: '13px' } }, 'Ver QR')) : null
      ),
      h('td', { style: { ...cell, color: COLORS.text, textAlign: 'right', whiteSpace: 'nowrap' } }, unit > 0 ? clp(unit * qty) : 'Gratis')
    )
  })
  const small = { ...cell, fontSize: '13px', color: COLORS.muted, padding: '4px 0' }
  const strong = { ...cell, fontSize: '15px', fontWeight: 700, color: COLORS.text, padding: '10px 0 4px', borderTop: `1px solid ${COLORS.border}` }
  // feeNet/feeIva: cargo neto e IVA del cargo. Sin ellos (llamadas antiguas) `fee` es el cargo sin desglose.
  const net = feeNet != null ? Number(feeNet) || 0 : Number(fee) || 0
  const iva = feeIva != null ? Number(feeIva) || 0 : 0
  // Descuento: las líneas van a precio de lista; "Subtotal" es el monto ya descontado (lo que paga por entradas)
  const discount = Math.round(Number(discountAmount) || 0)
  if (discount > 0) {
    rows.push(
      h('tr', { key: 'disc' }, h('td', { style: { ...small, paddingTop: '10px' } }, discountLineLabel(str(discountCode))), h('td', { style: { ...small, paddingTop: '10px', textAlign: 'right' } }, `-${clp(discount)}`))
    )
  }
  if (Number(total) > 0 && feeIncluded) {
    // Cargo absorbido por el productor: el comprador pagó el precio de las entradas, sin cargo encima
    rows.push(
      h('tr', { key: 'tot' }, h('td', { style: strong }, 'Total pagado'), h('td', { style: { ...strong, textAlign: 'right' } }, clp(total))),
      h('tr', { key: 'incl' }, h('td', { style: small, colSpan: 2 }, FEE_INCLUDED_NOTE))
    )
  } else if (Number(total) > 0) {
    rows.push(
      h('tr', { key: 'sub' }, h('td', { style: { ...small, paddingTop: discount > 0 ? '4px' : '10px' } }, 'Subtotal'), h('td', { style: { ...small, paddingTop: discount > 0 ? '4px' : '10px', textAlign: 'right' } }, clp(subtotal))),
      h('tr', { key: 'fee' }, h('td', { style: small }, serviceFeeLabelFor(subtotal, net)), h('td', { style: { ...small, textAlign: 'right' } }, clp(net))),
      iva > 0 ? h('tr', { key: 'iva' }, h('td', { style: small }, SERVICE_FEE_TAX_LABEL), h('td', { style: { ...small, textAlign: 'right' } }, clp(iva))) : null,
      h('tr', { key: 'tot' }, h('td', { style: strong }, 'Total pagado'), h('td', { style: { ...strong, textAlign: 'right' } }, clp(total)))
    )
  } else {
    rows.push(h('tr', { key: 'tot' }, h('td', { style: strong }, 'Total'), h('td', { style: { ...strong, textAlign: 'right' } }, 'Gratis')))
  }
  return h('table', TABLE_PROPS, h('tbody', null, rows))
}

/** QR de cada entrada como imagen inline (cid:...), para mostrarlo en la puerta sin abrir el link. */
function QrTickets({ qrTickets, moreCount }) {
  const card = { border: `1px solid ${COLORS.border}`, borderRadius: '12px', padding: '16px', margin: '0 0 12px', textAlign: 'center' }
  const label = { fontFamily: FONT_FAMILY, fontSize: '14px', lineHeight: '20px', fontWeight: 600, color: COLORS.text, margin: '10px 0 0' }
  const sub = { fontFamily: FONT_FAMILY, fontSize: '12px', lineHeight: '18px', color: COLORS.subtle, margin: '2px 0 0' }
  return h(
    'div',
    { style: { margin: '8px 0 20px' } },
    ...qrTickets.map((t) =>
      h(
        'div',
        { key: t.cid, style: card },
        h(Img, { src: `cid:${t.cid}`, width: 200, height: 200, alt: `Código QR de tu entrada ${str(t.index)}`, style: { display: 'block', margin: '0 auto', width: '200px', height: '200px' } }),
        h('p', { style: label }, str(t.label)),
        h('p', { style: sub }, `Entrada ${str(t.index)} de ${str(t.total)}${t.functionLabel ? ` · ${str(t.functionLabel)}` : ''}`)
      )
    ),
    moreCount > 0
      ? h(Paragraph, { small: true, align: 'center', style: { color: COLORS.subtle } }, `Y ${moreCount} entrada${moreCount === 1 ? '' : 's'} más: ábrelas todas con el botón "Ver mis entradas".`)
      : null
  )
}

/** Entradas sin precios (gratis, cortesía o transferida): "2 x Entrada liberada · Ver QR". */
function TicketList({ ticketLines }) {
  return h(
    'table',
    TABLE_PROPS,
    h(
      'tbody',
      null,
      ticketLines.map((t, i) => {
        const ticketUrl = safeHref(t.url)
        return h(
          'tr',
          { key: `l-${i}` },
          h(
            'td',
            { style: { ...cell, color: '#3f3f46' } },
            `${Number(t.quantity) || 1} x ${str(t.name)}`,
            ticketUrl ? h('span', null, ' · ', h(Link, { href: ticketUrl, style: { color: COLORS.text, textDecoration: 'underline', fontSize: '13px' } }, 'Ver QR')) : null
          )
        )
      })
    )
  )
}

/** "¿Tienes una pregunta? Escríbele a la productora" (formulario en la página de la orden). */
function ContactProducer({ contactUrl, organizerName }) {
  const url = safeHref(contactUrl)
  if (!url) return null
  const who = str(organizerName).trim()
  return h(
    Paragraph,
    { small: true, align: 'center', muted: true, style: { margin: '4px 0 0' } },
    '¿Tienes una pregunta sobre el evento? ',
    h(Link, { href: url, style: { color: COLORS.text, fontWeight: 600, textDecoration: 'underline' } }, who ? `Escríbele a ${who}` : 'Escríbele a la productora')
  )
}

const FOOTER_REASON = {
  rsvp: 'Recibes este correo porque confirmaste tu asistencia en AI Tickets. El evento es organizado por su productora.',
  courtesy: 'Recibes este correo porque la productora del evento te invitó a través de AI Tickets.',
  transfer: 'Recibes este correo porque te transfirieron una entrada en AI Tickets. El evento es organizado por su productora.',
  purchase: 'Recibes este correo porque compraste entradas en AI Tickets. Guárdalo como comprobante de compra: el evento es organizado y ofrecido por su productora.',
}

/**
 * @param {{
 *   kind?: 'rsvp' | 'courtesy' | 'transfer' | 'purchase',
 *   customerName?: string, eventName?: string, organizerName?: string,
 *   dateLines?: Array<{ date: string, time?: string, place?: string }>,
 *   secretLocation?: string,
 *   ticketLines?: Array<{ name: string, quantity: number, unitPrice: number, url?: string }>,
 *   subtotal?: number, discountCode?: string, discountAmount?: number, fee?: number, feeNet?: number, feeIva?: number, feeIncluded?: boolean, total?: number,
 *   orderId: string, orderDate?: string, orderUrl: string, contactUrl?: string, calendarUrl?: string | null,
 * }} data
 * kind (netlify/lib/order-kind.mjs): sin él se deduce de los montos (todo en $0 y sin descuento => 'rsvp'). Solo
 * 'purchase' habla de compra y lleva comprobante; las gratis son una confirmación de asistencia.
 */
export async function renderTicketsEmail(data = {}) {
  const customerName = str(data.customerName).trim() || 'asistente'
  const eventName = str(data.eventName).trim() || 'Tu evento'
  const dateLines = Array.isArray(data.dateLines) ? data.dateLines : []
  const ticketLines = Array.isArray(data.ticketLines) ? data.ticketLines : []
  const calendarUrl = safeHref(data.calendarUrl)
  // Sin kind: hubo compra si se pagó algo, hubo descuento o alguna entrada tenía precio (p. ej. código de 100%)
  const bought = Number(data.total) > 0 || Number(data.discountAmount) > 0 || ticketLines.some((t) => Number(t.unitPrice) > 0)
  const kind = ['rsvp', 'courtesy', 'transfer', 'purchase'].includes(data.kind) ? data.kind : bought ? 'purchase' : 'rsvp'
  const paid = isPaidKind(kind)
  const count = ticketLines.reduce((n, t) => n + (Number(t.quantity) || 0), 0) || 1
  const copy = orderCopy(kind, count)
  const subject = {
    rsvp: `✅ Asistencia confirmada: ${eventName}`,
    courtesy: `🎟️ Tu invitación para ${eventName}`,
    transfer: `🎟️ Te transfirieron una entrada para ${eventName}`,
    purchase: `🎟️ Tus entradas para ${eventName}`,
  }[kind]
  const preview = {
    rsvp: `Tu lugar en ${eventName} está confirmado. Muestra el QR en la puerta.`,
    courtesy: `Tienes una invitación para ${eventName}. Muestra el QR en la puerta.`,
    transfer: `Tu entrada para ${eventName} está lista. Muestra el QR en la puerta.`,
    purchase: `Tus entradas para ${eventName} están listas. Muestra el QR en la puerta.`,
  }[kind]
  const title = paid ? `¡Hola ${customerName}! Aquí están tus entradas` : `¡Hola ${customerName}! ${copy.headline}`

  const element = h(
    EmailLayout,
    { preview, footer: { reason: FOOTER_REASON[kind] } },
    h(Badge, null, copy.badge),
    h(Title, null, title),
    h(Subtitle, null, eventName),
    Array.isArray(data.qrTickets) && data.qrTickets.length
      ? h(QrTickets, { qrTickets: data.qrTickets, moreCount: Number(data.qrMoreCount) || 0 })
      : null,
    h(PrimaryButton, { href: data.orderUrl, hint: data.qrTickets?.length ? `Muestra el QR en la puerta (también puedes abrir ${copy.entradas} desde aquí).` : 'Muestra el código QR de cada entrada en la puerta.' }, copy.cta),
    h(
      Panel,
      { label: 'Cuándo y dónde' },
      h(DateRows, { dateLines }),
      calendarUrl
        ? h(
            Paragraph,
            { small: true, style: { margin: '12px 0 0' } },
            h(Link, { href: calendarUrl, style: { color: COLORS.text, fontWeight: 600, textDecoration: 'underline' } }, '+ Agregar a Google Calendar'),
            h('span', { style: { color: COLORS.subtle, fontSize: '12px' } }, ' (también adjuntamos un archivo .ics)')
          )
        : null
    ),
    data.secretLocation
      ? h(
          Panel,
          { label: 'Dirección exclusiva para asistentes', tone: 'warn' },
          h(Paragraph, { style: { margin: 0 } }, str(data.secretLocation))
        )
      : null,
    paid
      ? h(
          Panel,
          { label: LEGAL.receiptLabel, tone: 'outline' },
          h(ReceiptRows, { ticketLines, subtotal: data.subtotal, discountCode: data.discountCode, discountAmount: data.discountAmount, fee: data.fee, feeNet: data.feeNet, feeIva: data.feeIva, feeIncluded: data.feeIncluded === true, total: data.total }),
          h(Paragraph, { small: true, style: { margin: '12px 0 0', color: COLORS.subtle, fontSize: '12px' } }, `Orden ${str(data.orderId)}${data.orderDate ? ` · ${str(data.orderDate)}` : ''}`)
        )
      : h(Panel, { label: kind === 'rsvp' ? 'Tu registro' : 'Tus entradas', tone: 'outline' }, h(TicketList, { ticketLines })),
    h(ContactProducer, { contactUrl: data.contactUrl, organizerName: data.organizerName })
  )
  return renderEmail(subject, element)
}
