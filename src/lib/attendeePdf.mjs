// PDFs con un documento por asistente, en el servidor (jsPDF, fuentes estándar):
//   - certificatesPdf: certificado de asistencia, una página A4 horizontal por persona (src/lib/certificates.ts).
//   - credentialsPdf: credenciales para imprimir y recortar, 4 por hoja A4 (src/pages/api/events/credentials.ts).
// El QR de la credencial es el mismo de la entrada (event_attendees.qr_code, el que lee el escáner) y va dibujado
// como vector (nítido al imprimir y liviano). Devuelven un Buffer.
import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'

const INK = [10, 10, 11]
const MUTED = [110, 110, 118]
const LINE = [212, 212, 216]

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

/**
 * Elige la letra más grande (de `size` a `min`) con la que el texto cabe en `width` en a lo más `maxLines` líneas. Con
 * `oneLine`, prefiere achicar hasta `min` en una línea antes de partirlo. Si ni así cabe, corta con "…".
 */
function fitText(doc, text, { width, size, min, maxLines = 2, oneLine = false }) {
  const at = (s, lines) => ({ lines, size: s, lineHeight: s * 0.3528 * 1.2 })
  if (oneLine) {
    for (let s = size; s >= min; s--) {
      doc.setFontSize(s)
      if (doc.getTextWidth(text) <= width) return at(s, [text])
    }
  }
  for (let s = size; s >= min; s--) {
    doc.setFontSize(s)
    const lines = doc.splitTextToSize(text, width)
    if (lines.length <= maxLines) return at(s, lines)
  }
  doc.setFontSize(min)
  const lines = doc.splitTextToSize(text, width).slice(0, maxLines)
  lines[maxLines - 1] = `${String(lines[maxLines - 1]).replace(/\s*\S{0,3}$/, '')}…`
  return at(min, lines)
}

function drawLines(doc, fit, x, y, align = 'center') {
  doc.setFontSize(fit.size)
  fit.lines.forEach((line, i) => doc.text(line, x, y + i * fit.lineHeight, { align }))
  return y + fit.lines.length * fit.lineHeight
}

/** QR como cuadrados negros (corridas horizontales unidas). */
export function drawQr(doc, text, x, y, size) {
  const qr = QRCode.create(String(text), { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const quiet = 2
  const cell = size / (n + quiet * 2)
  doc.setFillColor(255, 255, 255)
  doc.rect(x, y, size, size, 'F')
  doc.setFillColor(...INK)
  for (let r = 0; r < n; r++) {
    let c = 0
    while (c < n) {
      if (!qr.modules.get(r, c)) {
        c++
        continue
      }
      let end = c
      while (end + 1 < n && qr.modules.get(r, end + 1)) end++
      // Un poco de solape para que no queden líneas blancas entre módulos al imprimir
      doc.rect(x + (quiet + c) * cell, y + (quiet + r) * cell, (end - c + 1) * cell + 0.05, cell + 0.05, 'F')
      c = end + 1
    }
  }
}

const newDoc = (orientation) => new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true })
const toBuffer = (doc) => Buffer.from(doc.output('arraybuffer'))

/**
 * @param {Array<{ name: string, eventName: string, organizer?: string, datesText: string, hoursText?: string|null,
 *   sessionsText?: string|null, place?: string|null, code: string, issuedText: string }>} certs
 */
export function certificatesPdf(certs, { title = 'Certificados de asistencia' } = {}) {
  const doc = newDoc('landscape')
  doc.setProperties({ title, creator: 'AI Tickets' })
  const W = 297
  const cx = W / 2
  certs.forEach((c, i) => {
    if (i > 0) doc.addPage()
    doc.setDrawColor(...INK)
    doc.setLineWidth(0.8)
    doc.rect(10, 10, W - 20, 190)
    doc.setLineWidth(0.2)
    doc.rect(14, 14, W - 28, 182)

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...MUTED)
    doc.setFontSize(10)
    if (c.organizer) doc.text(clean(c.organizer).toUpperCase(), cx, 32, { align: 'center' })

    doc.setTextColor(...INK)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(26)
    doc.text('CERTIFICADO DE ASISTENCIA', cx, 50, { align: 'center' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(13)
    doc.text('Se certifica que', cx, 68, { align: 'center' })

    doc.setFont('helvetica', 'bold')
    const name = fitText(doc, clean(c.name), { width: 230, size: 30, min: 20, maxLines: 2, oneLine: true })
    let y = drawLines(doc, name, cx, 84)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.3)
    doc.line(cx - 90, y - name.lineHeight + 4, cx + 90, y - name.lineHeight + 4)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(13)
    y += 6
    doc.text('asistió a', cx, y, { align: 'center' })
    y += 11
    doc.setFont('helvetica', 'bold')
    const event = fitText(doc, clean(c.eventName), { width: 230, size: 18, min: 14, maxLines: 2, oneLine: true })
    y = drawLines(doc, event, cx, y)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(12)
    y += 4
    for (const line of [c.datesText, c.sessionsText, c.hoursText, c.place].map(clean).filter(Boolean)) {
      for (const part of doc.splitTextToSize(line, 230).slice(0, 2)) {
        doc.text(part, cx, y, { align: 'center' })
        y += 6
      }
    }

    doc.setFontSize(9)
    doc.setTextColor(...MUTED)
    if (c.organizer) doc.text(`Organiza: ${clean(c.organizer)}`, 24, 186)
    doc.text(`${clean(c.issuedText)} · Código ${clean(c.code)}`, W - 24, 186, { align: 'right' })
    doc.text('Emitido con AI Tickets · aitickets.cl', cx, 192, { align: 'center' })
    doc.setTextColor(...INK)
  })
  return toBuffer(doc)
}

/**
 * @param {Array<{ name: string, company?: string|null, ticketType: string, functionLabel?: string|null, qr?: string|null, code: string }>} cards
 * @param {{ eventName: string, title?: string }} opts
 */
export function credentialsPdf(cards, { eventName, title = 'Credenciales' }) {
  const doc = newDoc('portrait')
  doc.setProperties({ title, creator: 'AI Tickets' })
  const CW = 95
  const CH = 135
  const X0 = (210 - CW * 2) / 2
  const Y0 = (297 - CH * 2) / 2
  const event = clean(eventName)
  cards.forEach((card, i) => {
    const slot = i % 4
    if (i > 0 && slot === 0) doc.addPage()
    const x = X0 + (slot % 2) * CW
    const y = Y0 + Math.floor(slot / 2) * CH
    const cx = x + CW / 2
    const inner = CW - 12

    // Borde de corte
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.2)
    doc.rect(x, y, CW, CH)

    // Banda del evento
    doc.setFillColor(...INK)
    doc.rect(x, y, CW, 22, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    const ev = fitText(doc, event, { width: inner, size: 12, min: 9, maxLines: 2 })
    drawLines(doc, ev, cx, y + (ev.lines.length > 1 ? 9 : 12))
    if (card.functionLabel) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text(clean(card.functionLabel), cx, y + 19.5, { align: 'center' })
    }

    // Nombre y empresa
    doc.setTextColor(...INK)
    doc.setFont('helvetica', 'bold')
    const name = fitText(doc, clean(card.name) || 'Asistente', { width: inner, size: 24, min: 14, maxLines: 2 })
    let ny = drawLines(doc, name, cx, y + 38)
    if (card.company) {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...MUTED)
      const company = fitText(doc, clean(card.company), { width: inner, size: 12, min: 9, maxLines: 1 })
      ny = drawLines(doc, company, cx, ny + 1)
      doc.setTextColor(...INK)
    }

    // Tipo de entrada
    doc.setFillColor(238, 238, 240)
    doc.rect(x + 6, y + 66, CW - 12, 10, 'F')
    doc.setFont('helvetica', 'bold')
    const type = fitText(doc, clean(card.ticketType).toUpperCase() || 'ENTRADA', { width: inner - 6, size: 12, min: 8, maxLines: 1 })
    drawLines(doc, type, cx, y + 73)

    // QR de la entrada
    if (card.qr) drawQr(doc, card.qr, cx - 22, y + 81, 44)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text(clean(card.code), cx, y + CH - 4, { align: 'center' })
    doc.setTextColor(...INK)
  })
  if (!cards.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(12)
    doc.text('No hay asistentes para estas credenciales.', 105, 40, { align: 'center' })
  }
  return toBuffer(doc)
}
