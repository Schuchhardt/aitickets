// Datos extra que el checkout pide según el evento (events.checkout_fields, migración 202610300100).
// Lógica pura: la usan el checkout y el registro gratis (Vue), /api/purchase-ticket, los formularios del evento,
// la API de productores y el panel.
//
// checkout_fields = {
//   attendee_names: 'off' | 'optional' | 'required'
//       Nombre y correo de cada asistente cuando la compra trae más de una entrada (o una mesa para varios). Cada QR
//       llega al correo de su asistente. 'required' exige el nombre de cada uno (el correo siempre es opcional).
//   holders: 'buyer' | 'invite'   (por defecto 'buyer'; solo importa en compras de más de un QR)
//       Quién completa los datos de cada persona. 'buyer': quien compra escribe nombre, correo y respuestas por persona
//       de todos en el checkout. 'invite': quien compra solo escribe el correo de cada invitado (nombre opcional) y cada
//       uno completa su nombre y sus respuestas desde el correo que le llega (/ticket/<id>, /api/tickets/holder). El
//       lugar de quien compra siempre se llena en el checkout.
//   company: boolean
//       RUT y razón social de la empresa, opcionales para quien compra (solo compras pagadas). Se guardan en la orden
//       y salen en el comprobante, que NO es boleta ni factura (LEGAL.receiptLabel).
//   questions: [{ id, label, type: 'text' | 'choice' | 'yes_no', options?: string[], required: boolean,
//                 per: 'order' | 'attendee' }]
//       Preguntas al inscribirse. per 'order' (por defecto): una vez por compra (event_orders.registration_answers).
//       per 'attendee': una vez por persona (QR); viajan en event_orders.attendee_holders[i].answers hasta emitir y
//       quedan en event_attendees.registration_answers (migración 202610310100).
// }
// Configuraciones guardadas antes de holders/per se leen igual: quien compra llena todo y las preguntas son por compra.
// NULL o {} = el checkout de siempre (solo nombre y correo de quien compra).

export const ATTENDEE_NAME_MODES = ['off', 'optional', 'required']
export const HOLDER_MODES = ['buyer', 'invite']
export const QUESTION_SCOPES = ['order', 'attendee']
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
  const holders = HOLDER_MODES.includes(src.holders) ? src.holders : 'buyer'
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
    const per = q?.per === 'attendee' ? 'attendee' : 'order'
    questions.push({ id, label, type, required: q?.required === true, per, ...(options ? { options } : {}) })
  }
  return { attendee_names, holders, company, questions }
}

/** Preguntas que se responden una vez por compra. */
export const orderQuestions = (fields) => normalizeCheckoutFields(fields).questions.filter((q) => q.per !== 'attendee')
/** Preguntas que responde cada persona (una vez por QR). */
export const attendeeQuestions = (fields) => normalizeCheckoutFields(fields).questions.filter((q) => q.per === 'attendee')

/** ¿El evento pide datos de cada persona (nombre o preguntas por persona)? */
export function asksAttendeeData(fields) {
  const cfg = normalizeCheckoutFields(fields)
  return cfg.attendee_names !== 'off' || cfg.questions.some((q) => q.per === 'attendee')
}

/** ¿Hay algo que cada invitado TIENE que completar (nombre obligatorio o una pregunta por persona obligatoria)? */
export function requiresAttendeeData(fields) {
  const cfg = normalizeCheckoutFields(fields)
  return cfg.attendee_names === 'required' || cfg.questions.some((q) => q.per === 'attendee' && q.required)
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

/**
 * ¿Se piden los asistentes (nombre y correo por QR) en esta compra? Con más de un QR y el ajuste de nombres activo o
 * alguna pregunta por persona.
 */
export const asksHolders = (fields, slotCount) => Number(slotCount) > 1 && asksAttendeeData(fields)

/** ¿Los datos de cada invitado los completa él mismo desde su correo? (Solo en compras de más de un QR.) */
export const invitesHolders = (fields, slotCount) => asksHolders(fields, slotCount) && normalizeCheckoutFields(fields).holders === 'invite'

/**
 * ¿El checkout manda un elemento por QR? Cuando pide asistentes o, con un solo QR, cuando hay preguntas por persona
 * (las responde quien compra para su propia entrada).
 */
export const collectsHolders = (fields, slotCount) => asksHolders(fields, slotCount) || (Number(slotCount) >= 1 && attendeeQuestions(fields).length > 0)

/**
 * Valida los asistentes que mandó el checkout contra los lugares de la compra.
 * raw: [{ ticket_id, name, email, answers? }] en el mismo orden que los lugares (holderSlots). answers son las
 * respuestas a las preguntas por persona ({ [preguntaId]: valor }).
 * El primer lugar vacío es quien compra (no hace falta escribirlo dos veces). Con holders 'invite', los demás lugares
 * solo traen correo (y nombre, opcional): sus respuestas se ignoran y las completa cada invitado. Si el evento exige
 * datos de cada persona, el correo del invitado es obligatorio (sin él nadie le avisa).
 * @returns {{ holders: Array<{ticket_id:number, name:string|null, email:string|null, answers?: Array<{id:string, question:string, answer:string}>}> | null, error?: string }}
 */
export function validateHolders(fields, slots, raw, buyer = {}) {
  const cfg = normalizeCheckoutFields(fields)
  if (!collectsHolders(cfg, slots.length)) return { holders: null }
  const multi = asksHolders(cfg, slots.length)
  const invite = multi && cfg.holders === 'invite'
  const perQuestions = cfg.questions.filter((q) => q.per === 'attendee')
  const list = Array.isArray(raw) ? raw : []
  const holders = []
  for (let i = 0; i < slots.length; i++) {
    const r = list[i] && typeof list[i] === 'object' ? list[i] : {}
    if (r.ticket_id !== undefined && Number(r.ticket_id) !== slots[i].ticketId) return { holders: null, error: 'Los asistentes no coinciden con las entradas. Recarga la página e intenta de nuevo.' }
    let name = multi ? text(r.name, 120) : ''
    let email = multi ? text(r.email, 254).toLowerCase() : ''
    if (i === 0 && !name) {
      name = text(buyer.name, 120)
      if (!email) email = text(buyer.email, 254).toLowerCase()
    }
    const guest = invite && i > 0
    if (email && !EMAIL_RE.test(email)) return { holders: null, error: `Revisa el correo de la entrada ${i + 1}.` }
    if (guest && !email && requiresAttendeeData(cfg)) return { holders: null, error: `Escribe el correo de la entrada ${i + 1}: ahí le llega su entrada para que complete sus datos.` }
    if (multi && !guest && cfg.attendee_names === 'required' && name.length < 2) return { holders: null, error: `Escribe el nombre de la entrada ${i + 1}.` }
    let answers = null
    if (!guest && perQuestions.length) {
      const check = checkAnswers(perQuestions, r.answers, multi ? ` (entrada ${i + 1})` : '')
      if (check.error) return { holders: null, error: check.error }
      answers = check.answers
    }
    holders.push({ ticket_id: slots[i].ticketId, name: name || null, email: email || null, ...(answers ? { answers } : {}) })
  }
  return { holders: holders.some((h) => h.name || h.email || h.answers) ? holders : null }
}

// ---------------------------------------------------------------------------------------------------------------
// Preguntas al inscribirse
// ---------------------------------------------------------------------------------------------------------------

/**
 * Valida las respuestas por compra ({ [questionId]: valor }) contra las preguntas del evento con per 'order'. Las
 * preguntas por persona van en cada asistente (validateHolders) o en /api/tickets/holder (validateHolderUpdate).
 * @returns {{ answers: Array<{id:string, question:string, answer:string}> | null, error?: string }}
 */
export function validateAnswers(fields, raw) {
  return checkAnswers(orderQuestions(fields), raw)
}

function checkAnswers(questions, raw, suffix = '') {
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
      if (value && !q.options.includes(value)) return { answers: null, error: `Elige una opción de "${q.label}"${suffix}.` }
      answer = value
    } else {
      answer = text(value, MAX_ANSWER)
    }
    if (!answer && q.required) return { answers: null, error: `Responde "${q.label}"${suffix}.` }
    if (answer) answers.push({ id: q.id, question: q.label, answer })
  }
  return { answers: answers.length ? answers : null }
}

/** Respuesta a una pregunta en una orden o una entrada (por id; si cambió el id, por el texto de la pregunta). */
export function answerFor(answers, question) {
  const list = Array.isArray(answers) ? answers : []
  return (list.find((a) => a?.id === question.id) || list.find((a) => a?.question === question.label))?.answer || ''
}

/** Respuestas como texto ("Talla: M · Alergias: no"). */
export const answersText = (answers, sep = ' · ') =>
  (Array.isArray(answers) ? answers : []).filter((a) => a?.question && a?.answer).map((a) => `${a.question}: ${a.answer}`).join(sep)

// ---------------------------------------------------------------------------------------------------------------
// Datos de cada persona después de comprar (invitados que completan desde su correo)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Qué le falta a una entrada (fila de event_attendees) según lo que exige el evento: [] = nada.
 * - Nombre: con attendee_names 'required', solo en entradas de otra persona (holder_email distinto al de quien
 *   compró) sin holder_name. La entrada de quien compra usa su nombre.
 * - Preguntas por persona obligatorias sin respuesta en la entrada (en la de quien compra vale también la de la
 *   orden, si la pregunta antes era por compra).
 * No bloquea el QR: el productor ve quién está pendiente.
 * @param {any} fields events.checkout_fields
 * @param {{ holder_name?: string|null, holder_email?: string|null, registration_answers?: any }} row
 * @param {{ buyerEmail?: string|null, orderAnswers?: any }} [ctx]
 * @returns {string[]} lo que falta ('Nombre' o el texto de cada pregunta)
 */
export function missingAttendeeData(fields, row, { buyerEmail = '', orderAnswers = null } = {}) {
  const cfg = normalizeCheckoutFields(fields)
  const missing = []
  const holderEmail = String(row?.holder_email || '').trim().toLowerCase()
  const other = Boolean(holderEmail) && holderEmail !== String(buyerEmail || '').trim().toLowerCase()
  if (cfg.attendee_names === 'required' && other && !String(row?.holder_name || '').trim()) missing.push('Nombre')
  for (const q of cfg.questions) {
    if (q.per !== 'attendee' || !q.required) continue
    if (answerFor(row?.registration_answers, q)) continue
    if (!other && answerFor(orderAnswers, q)) continue
    missing.push(q.label)
  }
  return missing
}

/**
 * Valida lo que completa una persona desde su entrada (/api/tickets/holder): nombre y respuestas por persona, con las
 * mismas reglas que el checkout. El nombre se exige con attendee_names 'required'; vacío conserva el actual.
 * @param {any} fields events.checkout_fields
 * @param {{ name?: any, answers?: any }} raw
 * @param {{ currentName?: string|null }} [ctx]
 * @returns {{ name: string|null, answers: Array<{id:string, question:string, answer:string}> | null, error?: string, field?: string }}
 */
export function validateHolderUpdate(fields, raw, { currentName = null } = {}) {
  const cfg = normalizeCheckoutFields(fields)
  const src = raw && typeof raw === 'object' ? raw : {}
  const name = text(src.name, 120) || text(currentName, 120)
  if (cfg.attendee_names === 'required' && name.length < 2) return { name: null, answers: null, error: 'Escribe tu nombre y apellido.', field: 'name' }
  const check = checkAnswers(cfg.questions.filter((q) => q.per === 'attendee'), src.answers)
  if (check.error) return { name: null, answers: null, error: check.error, field: 'answers' }
  return { name: name || null, answers: check.answers }
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
