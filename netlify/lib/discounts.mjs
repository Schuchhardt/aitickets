// Códigos de descuento: fuente única de la matemática y de las reglas de validación.
//
// Reglas (decisión del dueño, oct 2026):
//   * El descuento se aplica al SUBTOTAL de entradas de la orden (todas las entradas del evento).
//     'percent': value% del subtotal (1-100), redondeado a pesos. 'fixed': value CLP, tope = subtotal.
//   * El cargo por servicio (+ IVA) se calcula sobre el subtotal YA descontado (fees.mjs).
//   * Si el subtotal descontado queda en 0 la orden es gratis (sin cargo ni Flow).
//   * El productor recibe el subtotal descontado: event_orders.amount guarda ese monto y
//     event_orders.discount_amount el descuento.
//   * Usos: se calculan desde event_orders (pagadas/en proceso/en revisión + pendientes con reserva vigente);
//     el límite final lo aplica aitickets_reserve_order_v2 con la fila del código bloqueada.
//
// Lo usan el servidor (purchase-tickets, /api/discount-code, /api/discount-codes, correo, orden, CSV) y el
// navegador (src/components/Reservation): NO debe importar nada de Node. Las funciones con BD reciben
// el cliente de Supabase (service role) como parámetro.
import { computeBuyerTotal } from './fees.mjs'

export const DISCOUNT_CODE_RE = /^[A-Z0-9_-]{3,30}$/
export const DISCOUNT_KINDS = ['percent', 'fixed']
/** Tope de un descuento fijo (CLP) para evitar errores de tipeo absurdos. */
export const MAX_FIXED_DISCOUNT = 10_000_000

/** Estados de orden que cuentan como uso del código (además de 'pending' con reserva vigente). */
export const DISCOUNT_USE_STATUSES = ['paid', 'processing', 'review']

export const DISCOUNT_MESSAGES = {
  invalid_format: 'Ingresa un código válido (3 a 30 letras, números, guiones o guion bajo).',
  not_found: 'El código de descuento no existe o no aplica a este evento.',
  inactive: 'Este código de descuento ya no está disponible.',
  not_started: 'Este código de descuento todavía no está vigente.',
  expired: 'Este código de descuento expiró.',
  exhausted: 'Este código de descuento ya alcanzó su límite de usos.',
  buyer_limit: 'Ya usaste este código de descuento el máximo de veces permitido.',
  no_subtotal: 'Los códigos de descuento solo aplican a entradas pagadas.',
  unavailable: 'Los códigos de descuento no están disponibles en este momento. Intenta sin código o más tarde.',
}

/** HTTP sugerido por motivo de rechazo. */
export const DISCOUNT_STATUS = {
  invalid_format: 400,
  not_found: 404,
  inactive: 409,
  not_started: 409,
  expired: 409,
  exhausted: 409,
  buyer_limit: 409,
  no_subtotal: 400,
  unavailable: 503,
}

const toInt = (value) => {
  const n = Math.round(Number(value) || 0)
  return n > 0 ? n : 0
}

/** Normaliza lo que escribe el comprador/productor: sin espacios, en mayúsculas. null si no es válido. */
export function normalizeDiscountCode(raw) {
  if (typeof raw !== 'string') return null
  const code = raw.replace(/\s+/g, '').toUpperCase()
  return DISCOUNT_CODE_RE.test(code) ? code : null
}

/**
 * Descuento en CLP (entero) de un código sobre un subtotal.
 * @param {{kind:'percent'|'fixed', value:number|string}} discount
 * @param {number} subtotal
 */
export function computeDiscountAmount(discount, subtotal) {
  const base = toInt(subtotal)
  if (!discount || base <= 0) return 0
  const value = Number(discount.value)
  if (!Number.isFinite(value) || value <= 0) return 0
  if (discount.kind === 'percent') {
    const pct = Math.min(value, 100)
    return Math.min(base, Math.round((base * pct) / 100))
  }
  if (discount.kind === 'fixed') return Math.min(base, Math.round(value))
  return 0
}

/**
 * Desglose de una compra con descuento.
 * @param {number} grossSubtotal subtotal de entradas a precio de lista
 * @param {{kind, value}|null} discount
 * @returns {{grossSubtotal:number, discountAmount:number, subtotal:number, feeNet:number, feeIva:number, fee:number, total:number}}
 *   subtotal = grossSubtotal - discountAmount (lo que recibe el productor); fee sobre ese subtotal.
 */
export function computeDiscountedTotals(grossSubtotal, discount = null) {
  const gross = toInt(grossSubtotal)
  const discountAmount = discount ? computeDiscountAmount(discount, gross) : 0
  const { subtotal, feeNet, feeIva, fee, total } = computeBuyerTotal(gross - discountAmount)
  return { grossSubtotal: gross, discountAmount, subtotal, feeNet, feeIva, fee, total }
}

/** Etiqueta de la línea de descuento: "Descuento (CODIGO)". */
export function discountLineLabel(code) {
  return code ? `Descuento (${code})` : 'Descuento'
}

/** "10%" o "$5.000". */
export function describeDiscount(discount) {
  if (!discount) return ''
  const value = Number(discount.value) || 0
  if (discount.kind === 'percent') return `${Math.round(value * 100) / 100}%`
  return `$${Math.round(value).toLocaleString('es-CL')}`
}

/**
 * Reglas que no dependen de los usos: activo, organización/evento y vigencia.
 * @param {object|null} row fila de aitickets_discount_codes
 * @param {{eventId:number, organizationId:number, now?:Date}} ctx
 * @returns {{ok:true} | {ok:false, reason:string}}
 */
export function checkDiscountCode(row, { eventId, organizationId, now = new Date() }) {
  if (!row) return { ok: false, reason: 'not_found' }
  if (organizationId == null || String(row.organization_id) !== String(organizationId)) return { ok: false, reason: 'not_found' }
  if (row.event_id != null && String(row.event_id) !== String(eventId)) return { ok: false, reason: 'not_found' }
  if (row.active === false) return { ok: false, reason: 'inactive' }
  if (row.starts_at && new Date(row.starts_at) > now) return { ok: false, reason: 'not_started' }
  if (row.ends_at && new Date(row.ends_at) <= now) return { ok: false, reason: 'expired' }
  return { ok: true }
}

/**
 * Límites de uso. buyerUses solo se revisa si se conoce el comprador.
 * @returns {{ok:true} | {ok:false, reason:'exhausted'|'buyer_limit'}}
 */
export function checkDiscountUsage(row, { uses = 0, buyerUses = null } = {}) {
  if (row?.max_uses != null && Number(uses) >= Number(row.max_uses)) return { ok: false, reason: 'exhausted' }
  if (row?.per_buyer_limit != null && buyerUses != null && Number(buyerUses) >= Number(row.per_buyer_limit)) {
    return { ok: false, reason: 'buyer_limit' }
  }
  return { ok: true }
}

const RPC_REASONS = {
  DISCOUNT_INVALID: 'not_found',
  DISCOUNT_NOT_STARTED: 'not_started',
  DISCOUNT_EXPIRED: 'expired',
  DISCOUNT_EXHAUSTED: 'exhausted',
  DISCOUNT_BUYER_LIMIT: 'buyer_limit',
}

/** Motivo de rechazo desde un error de aitickets_reserve_order_v2 ('DISCOUNT_*'), o null. */
export function discountReasonFromRpcError(error) {
  const m = /\b(DISCOUNT_[A-Z_]+)\b/.exec(String(error?.message || ''))
  return m ? RPC_REASONS[m[1]] || 'not_found' : null
}

/** Columna/tabla/función inexistente (base sin la migración 202609300200). */
export function isMissingDiscountSchema(error) {
  const code = String(error?.code || '')
  return ['42703', '42883', '42P01', 'PGRST202', 'PGRST204', 'PGRST205', 'PGRST200'].includes(code)
}

export const DISCOUNT_CODE_COLUMNS = 'id, organization_id, event_id, code, kind, value, max_uses, per_buyer_limit, starts_at, ends_at, active, created_at'

/**
 * Busca un código de la organización. Devuelve { row } (row null si no existe) o { unavailable:true }.
 */
export async function findDiscountCode(supabase, organizationId, code) {
  const { data, error } = await supabase
    .from('aitickets_discount_codes')
    .select(DISCOUNT_CODE_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('code', code)
    .maybeSingle()
  if (error) {
    if (isMissingDiscountSchema(error)) return { row: null, unavailable: true }
    throw new Error(`Error buscando código de descuento: ${error.message}`)
  }
  return { row: data || null }
}

/** Usos vigentes del código (y del comprador si se pasa email). Ante error devuelve 0: el RPC de reserva manda. */
export async function getDiscountUsage(supabase, codeId, email = null) {
  try {
    const { data, error } = await supabase.rpc('aitickets_discount_code_usage', { p_code_id: codeId, p_email: email || null })
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    return { uses: Number(row?.uses) || 0, buyerUses: email ? Number(row?.buyer_uses) || 0 : null }
  } catch (err) {
    console.warn('aitickets_discount_code_usage no disponible:', err?.message || err?.code)
    return { uses: 0, buyerUses: email ? 0 : null }
  }
}

/**
 * Valida un código para una compra (o una vista previa) y calcula el descuento.
 * @param {any} supabase
 * @param {{event:{id:number, organization_id:number}, code:string, grossSubtotal:number, buyerEmail?:string|null, now?:Date}} p
 * @returns {Promise<{ok:true, discount:{id:string, code:string, kind:string, value:number, amount:number, label:string}}
 *                  | {ok:false, reason:string, message:string, status:number}>}
 */
export async function resolveDiscount(supabase, { event, code: rawCode, grossSubtotal, buyerEmail = null, now = new Date() }) {
  const fail = (reason) => ({ ok: false, reason, message: DISCOUNT_MESSAGES[reason], status: DISCOUNT_STATUS[reason] })
  const code = normalizeDiscountCode(rawCode)
  if (!code) return fail('invalid_format')
  if (!event?.organization_id) return fail('not_found')
  if (toInt(grossSubtotal) <= 0) return fail('no_subtotal')

  const { row, unavailable } = await findDiscountCode(supabase, event.organization_id, code)
  if (unavailable) return fail('unavailable')
  const base = checkDiscountCode(row, { eventId: event.id, organizationId: event.organization_id, now })
  if (!base.ok) return fail(base.reason)

  const usage = await getDiscountUsage(supabase, row.id, buyerEmail)
  const limits = checkDiscountUsage(row, usage)
  if (!limits.ok) return fail(limits.reason)

  const value = Number(row.value)
  const amount = computeDiscountAmount({ kind: row.kind, value }, grossSubtotal)
  if (amount <= 0) return fail('no_subtotal')
  return {
    ok: true,
    discount: { id: row.id, code: row.code, kind: row.kind, value, amount, label: describeDiscount({ kind: row.kind, value }) },
  }
}

/**
 * Valida el cuerpo de creación/edición de un código desde el dashboard.
 * @param {object} body {code, kind, value, eventId?, maxUses?, perBuyerLimit?, startsAt?, endsAt?, active?}
 * @param {{partial?: boolean}} opts partial=true (PATCH): solo valida lo que viene
 * @returns {{error:string} | {values:object}} values con nombres de columna
 */
export function validateDiscountInput(body = {}, { partial = false } = {}) {
  const values = {}
  const has = (k) => body[k] !== undefined

  if (!partial || has('code')) {
    const code = normalizeDiscountCode(body.code)
    if (!code) return { error: DISCOUNT_MESSAGES.invalid_format }
    values.code = code
  }

  if (!partial || has('kind') || has('value')) {
    const kind = body.kind
    if (!DISCOUNT_KINDS.includes(kind)) return { error: 'Elige el tipo de descuento: porcentaje o monto fijo.' }
    const value = Number(body.value)
    if (!Number.isFinite(value)) return { error: 'Ingresa el valor del descuento.' }
    if (kind === 'percent' && (value < 1 || value > 100 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6)) {
      return { error: 'El porcentaje debe estar entre 1 y 100.' }
    }
    if (kind === 'fixed' && (!Number.isInteger(value) || value <= 0 || value > MAX_FIXED_DISCOUNT)) {
      return { error: 'El monto fijo debe ser un número entero de pesos mayor a 0.' }
    }
    values.kind = kind
    values.value = value
  }

  const optionalPositiveInt = (key, column, label) => {
    if (!has(key)) return null
    const raw = body[key]
    if (raw === null || raw === '') {
      values[column] = null
      return null
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0 || n > 1_000_000) return `${label} debe ser un número entero mayor a 0 (o vacío para sin límite).`
    values[column] = n
    return null
  }
  const e1 = optionalPositiveInt('maxUses', 'max_uses', 'El límite de usos')
  if (e1) return { error: e1 }
  const e2 = optionalPositiveInt('perBuyerLimit', 'per_buyer_limit', 'El límite por comprador')
  if (e2) return { error: e2 }

  const optionalDate = (key, column) => {
    if (!has(key)) return null
    const raw = body[key]
    if (raw === null || raw === '') {
      values[column] = null
      return null
    }
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return 'Fecha de vigencia inválida.'
    values[column] = d.toISOString()
    return null
  }
  const e3 = optionalDate('startsAt', 'starts_at')
  if (e3) return { error: e3 }
  const e4 = optionalDate('endsAt', 'ends_at')
  if (e4) return { error: e4 }
  if (values.starts_at && values.ends_at && new Date(values.ends_at) <= new Date(values.starts_at)) {
    return { error: 'La fecha de término debe ser posterior a la de inicio.' }
  }

  if (has('active')) values.active = body.active === true

  if (has('eventId')) {
    if (body.eventId === null || body.eventId === '') values.event_id = null
    else {
      const id = Number(body.eventId)
      if (!Number.isInteger(id) || id <= 0) return { error: 'Evento inválido.' }
      values.event_id = id
    }
  }
  return { values }
}

/** Descuento guardado en una orden: { code, amount } (amount 0 sin descuento o sin la columna). */
export function orderDiscount(order) {
  const amount = Math.round(Number(order?.discount_amount) || 0)
  return { code: amount > 0 ? order?.discount_code || '' : '', amount: amount > 0 ? amount : 0 }
}
