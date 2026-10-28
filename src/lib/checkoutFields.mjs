// Datos extra que el checkout pide según el evento (events.checkout_fields, migración 202610300100).
// Lógica pura: la usan el checkout y el registro gratis (Vue), /api/purchase-ticket, los formularios del evento,
// la API de productores y el panel.
//
// checkout_fields = {
//   attendee_names: 'off' | 'optional' | 'required'
//       Nombre y correo de cada asistente cuando la compra trae más de una entrada (o una mesa para varios). Cada QR
//       llega al correo de su asistente. 'required' exige el nombre de cada uno (el correo siempre es opcional).
//   company: boolean
//       RUT y razón social de la empresa, opcionales para quien compra (solo compras pagadas). Se guardan en la orden
//       y salen en el comprobante, que NO es boleta ni factura (LEGAL.receiptLabel).
//   questions: [{ id, label, type: 'text' | 'choice' | 'yes_no', options?: string[], required: boolean }]
//       Preguntas al inscribirse. Se responden una vez por compra (event_orders.registration_answers).
// }
// NULL o {} = el checkout de siempre (solo nombre y correo de quien compra).

export const ATTENDEE_NAME_MODES = ['off', 'optional', 'required']
export const QUESTION_TYPES = ['text', 'choice', 'yes_no']
export const QUESTION_TYPE_LABELS = { text: 'Texto corto', choice: 'Elegir una opción', yes_no: 'Sí o no' }
export const MAX_QUESTIONS = 8
export const MAX_OPTIONS = 10
export const MAX_LABEL = 140
export const MAX_OPTION = 60
export const MAX_ANSWER = 300
/** Tope de personas por entrada (mesa para N, migración 202610300110). */
export const MAX_PEOPLE_PER_TICKET = 30
/** Leyenda junto a los datos de empresa: el comprobante no reemplaza una boleta o factura. */
export const COMPANY_RECEIPT_NOTE = 'Salen en el comprobante de compra, que no es boleta ni factura.'

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Configuración normalizada (valores por defecto si viene vacía o inválida). */
export function normalizeCheckoutFields(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const attendee_names = ATTENDEE_NAME_MODES.includes(src.attendee_names) ? src.attendee_names : 'off'
  const company = src.company === true
  const questions = []
  const ids = new Set()
  for (const q of Array.isArray(src.questions) ? src.questions : []) {
    if (questions.length >= MAX_QUESTIONS) break
    const label = text(q?.label, MAX_LABEL)
    if (!label) continue
    const type = QUESTION_TYPES.includes(q?.type) ? q.type : 'text'
    const options = type === 'choice'
      ? [...new Set((Array.isArray(q?.options) ? q.options : []).map((o) => text(o, MAX_OPTION)).filter(Boolean))].slice(0, MAX_OPTIONS)
      : null
    if (options && options.length < 2) continue
    let id = typeof q?.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(q.id) ? q.id : ''
    if (!id || ids.has(id)) {
      let n = questions.length + 1
      while (ids.has(`q${n}`)) n++
      id = `q${n}`
    }
    ids.add(id)
    questions.push({ id, label, type, required: q?.required === true, ...(options ? { options } : {}) })
  }
  return { attendee_names, company, questions }
}

export const isDefaultCheckoutFields = (f) => {
  const n = normalizeCheckoutFields(f)
  return n.attendee_names === 'off' && !n.company && n.questions.length === 0
}

/** Personas por entrada (mesa para N): entero de 1 a MAX_PEOPLE_PER_TICKET; cualquier otro valor = 1. */
export function normalizePeoplePerTicket(v) {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_PEOPLE_PER_TICKET) : 1
}

// ---------------------------------------------------------------------------------------------------------------
// RUT chileno: cuerpo + dígito verificador (módulo 11)
// ---------------------------------------------------------------------------------------------------------------

/** "12.345.678-k" -> "12345678-K" (sin validar). Vacío si no parece un RUT. */
export function cleanRut(v) {
  const s = String(v ?? '').toUpperCase().replace(/[^0-9K]/g, '')
  if (s.length < 2) return ''
  return `${s.slice(0, -1)}-${s.slice(-1)}`
}

export function rutCheckDigit(body) {
  let sum = 0
  let mul = 2
  for (let i = String(body).length - 1; i >= 0; i--) {
    sum += Number(String(body)[i]) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const dv = 11 - (sum % 11)
  return dv === 11 ? '0' : dv === 10 ? 'K' : String(dv)
}

export function isValidRut(v) {
  const clean = cleanRut(v)
  const m = /^(\d{7,8})-([\dK])$/.exec(clean)
  return Boolean(m) && rutCheckDigit(m[1]) === m[2]
}

/** "12345678-5" -> "12.345.678-5" (para mostrar). */
export function formatRut(v) {
  const clean = cleanRut(v)
  if (!clean) return ''
  const [body, dv] = clean.split('-')
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`
}

// ---------------------------------------------------------------------------------------------------------------
// Asistentes de una compra (una fila por QR)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Un lugar por QR que emitirá la compra: cada unidad de cada línea, por las personas de esa entrada (mesa para N).
 * @param lines [{ id, quantity, name? }]
 * @param peopleOf (ticketId) => personas por entrada
 * @returns [{ ticketId, ticketName, unit, seat, people }]
 */
export function holderSlots(lines, peopleOf = () => 1) {
  const slots = []
  for (const l of Array.isArray(lines) ? lines : []) {
    const qty = Math.max(0, Math.floor(Number(l?.quantity) || 0))
    const people = normalizePeoplePerTicket(peopleOf(l?.id))
    for (let unit = 1; unit <= qty; unit++) {
      for (let seat = 1; seat <= people; seat++) {
        slots.push({ ticketId: Number(l.id), ticketName: String(l?.name || l?.ticket_name || 'Entrada'), unit, seat, people })
      }
    }
  }
  return slots
}

/** ¿Se piden los asistentes en esta compra? Solo con el ajuste activo y más de un QR. */
export const asksHolders = (fields, slotCount) => normalizeCheckoutFields(fields).attendee_names !== 'off' && Number(slotCount) > 1

/**
 * Valida los asistentes que mandó el checkout contra los lugares de la compra.
 * raw: [{ ticket_id, name, email }] en el mismo orden que los lugares (holderSlots).
 * El primer lugar vacío es quien compra (no hace falta escribirlo dos veces).
 * @returns {{ holders: Array<{ticket_id:number, name:string|null, email:string|null}> | null, error?: string }}
 */
export function validateHolders(fields, slots, raw, buyer = {}) {
  const cfg = normalizeCheckoutFields(fields)
  if (!asksHolders(cfg, slots.length)) return { holders: null }
  const list = Array.isArray(raw) ? raw : []
  const holders = []
  for (let i = 0; i < slots.length; i++) {
    const r = list[i] && typeof list[i] === 'object' ? list[i] : {}
    if (r.ticket_id !== undefined && Number(r.ticket_id) !== slots[i].ticketId) return { holders: null, error: 'Los asistentes no coinciden con las entradas. Recarga la página e intenta de nuevo.' }
    let name = text(r.name, 120)
    let email = text(r.email, 254).toLowerCase()
    if (i === 0 && !name) {
      name = text(buyer.name, 120)
      if (!email) email = text(buyer.email, 254).toLowerCase()
    }
    if (email && !EMAIL_RE.test(email)) return { holders: null, error: `Revisa el correo de la entrada ${i + 1}.` }
    if (cfg.attendee_names === 'required' && name.length < 2) return { holders: null, error: `Escribe el nombre de la entrada ${i + 1}.` }
    holders.push({ ticket_id: slots[i].ticketId, name: name || null, email: email || null })
  }
  return { holders: holders.some((h) => h.name || h.email) ? holders : null }
}

// ---------------------------------------------------------------------------------------------------------------
// Preguntas al inscribirse
// ---------------------------------------------------------------------------------------------------------------

/**
 * Valida las respuestas ({ [questionId]: valor }) contra las preguntas del evento.
 * @returns {{ answers: Array<{id:string, question:string, answer:string}> | null, error?: string }}
 */
export function validateAnswers(fields, raw) {
  const { questions } = normalizeCheckoutFields(fields)
  if (!questions.length) return { answers: null }
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const answers = []
  for (const q of questions) {
    let value = src[q.id]
    let answer = ''
    if (q.type === 'yes_no') {
      if (value === true || value === 'yes' || value === 'Sí' || value === 'si') answer = 'Sí'
      else if (value === false || value === 'no' || value === 'No') answer = 'No'
    } else if (q.type === 'choice') {
      value = text(value, MAX_OPTION)
      if (value && !q.options.includes(value)) return { answers: null, error: `Elige una opción de "${q.label}".` }
      answer = value
    } else {
      answer = text(value, MAX_ANSWER)
    }
    if (!answer && q.required) return { answers: null, error: `Responde "${q.label}".` }
    if (answer) answers.push({ id: q.id, question: q.label, answer })
  }
  return { answers: answers.length ? answers : null }
}

/** Respuesta a una pregunta en una orden (por id; si cambió el id, por el texto de la pregunta). */
export function answerFor(answers, question) {
  const list = Array.isArray(answers) ? answers : []
  return (list.find((a) => a?.id === question.id) || list.find((a) => a?.question === question.label))?.answer || ''
}

// ---------------------------------------------------------------------------------------------------------------
// Datos de empresa (opcionales)
// ---------------------------------------------------------------------------------------------------------------

/**
 * @returns {{ company: { rut: string, name: string } | null, error?: string }}
 * Sin el ajuste o en compras gratis se ignora. Vacío = sin datos de empresa. Si escribe uno, pide el otro.
 */
export function validateCompany(fields, raw, { paid = true } = {}) {
  if (!normalizeCheckoutFields(fields).company || !paid) return { company: null }
  const src = raw && typeof raw === 'object' ? raw : {}
  const rutRaw = text(src.rut, 20)
  const name = text(src.name, 160)
  if (!rutRaw && !name) return { company: null }
  if (!rutRaw) return { company: null, error: 'Escribe el RUT de la empresa.' }
  if (!isValidRut(rutRaw)) return { company: null, error: 'Revisa el RUT de la empresa: el dígito verificador no calza.' }
  if (name.length < 2) return { company: null, error: 'Escribe la razón social de la empresa.' }
  return { company: { rut: cleanRut(rutRaw), name } }
}
