// Registro de entrega de correos (public.aitickets_email_log, migración 202610270300_email_log.sql).
//
// - logEmailAttempt: una fila por intento de envío (sent con el id de Resend, o failed con el error).
// - applyProviderEvent: el webhook de Resend (/api/webhooks/resend) actualiza el estado por provider_message_id.
// - loadOrderEmailLog / summarizeEmailDelivery: lo que ve el productor en get_order ("¿le llegó la entrada?").
//
// Nada de aquí lanza ni hace fallar un envío: si la tabla no existe (deploy preview sobre la BD de producción sin
// migrar) o la escritura falla, se avisa por consola y se sigue. Nunca se guarda el contenido del correo.

export const EMAIL_LOG_TABLE = 'aitickets_email_log'

const MAX_ERROR = 500
const MAX_RECIPIENT = 320
const MAX_EVENTS = 10

const isMissingTable = (error) => ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(String(error?.code || ''))

/** Tipos de evento de Resend que cambian el estado de entrega. email.sent no cambia nada (ya es 'sent'). */
export const RESEND_EVENT_STATUS = {
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}

// Los eventos pueden llegar desordenados (un "delayed" después del "delivered"): un estado solo reemplaza a otro
// de menor rango. bounced y complained son finales.
const STATUS_RANK = { failed: 0, sent: 1, delayed: 2, delivered: 3, bounced: 4, complained: 5 }

const truncate = (value, max) => {
  if (value == null || value === '') return null
  const s = String(value).replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

/**
 * Registra un intento de envío. Nunca lanza.
 * @param {any} supabase cliente service role
 * @param {{ kind?: string, orderId?: string | null, eventId?: number | null, recipient?: string | null,
 *           providerMessageId?: string | null, status: 'sent' | 'failed', error?: string | null }} entry
 * @returns {Promise<boolean>} true si quedó registrado
 */
export async function logEmailAttempt(supabase, { kind = 'tickets', orderId = null, eventId = null, recipient = null, providerMessageId = null, status, error = null } = {}) {
  try {
    const now = new Date().toISOString()
    const row = {
      kind,
      order_id: orderId || null,
      event_id: eventId != null && Number.isFinite(Number(eventId)) ? Number(eventId) : null,
      recipient: truncate(recipient, MAX_RECIPIENT),
      provider: 'resend',
      provider_message_id: truncate(providerMessageId, 200),
      status,
      error: truncate(error, MAX_ERROR),
      created_at: now,
      updated_at: now,
    }
    const { error: insertError } = await supabase.from(EMAIL_LOG_TABLE).insert(row)
    if (insertError) {
      if (!isMissingTable(insertError)) console.warn('email log:', insertError.message)
      return false
    }
    return true
  } catch (err) {
    console.warn('email log:', err?.message || err)
    return false
  }
}

/** Motivo legible de un evento de Resend (rebote o queja), sin datos del correo. */
export function providerEventError(type, data) {
  if (type === 'email.bounced') {
    const b = data?.bounce || {}
    return truncate([b.type, b.subType, b.message].filter(Boolean).join(' · ') || 'Rebotó', MAX_ERROR)
  }
  if (type === 'email.complained') return 'El destinatario lo marcó como spam'
  if (type === 'email.delivery_delayed') return 'Entrega demorada por el servidor del destinatario'
  return null
}

/**
 * Aplica un evento del proveedor a su fila. Idempotente (deduplica por eventId, el svix-id).
 * @param {any} supabase
 * @param {{ messageId: string, type: string, at?: string | null, eventId?: string | null, data?: any }} event
 * @returns {Promise<{ ok: boolean, updated: boolean, reason?: string, row?: any, previousStatus?: string }>}
 */
export async function applyProviderEvent(supabase, { messageId, type, at = null, eventId = null, data = null }) {
  const status = RESEND_EVENT_STATUS[type]
  if (!messageId) return { ok: true, updated: false, reason: 'no_message_id' }
  if (!status) return { ok: true, updated: false, reason: 'ignored_type' }
  const atIso = at && !Number.isNaN(new Date(at).getTime()) ? new Date(at).toISOString() : new Date().toISOString()

  const { data: row, error } = await supabase
    .from(EMAIL_LOG_TABLE)
    .select('id, kind, order_id, event_id, status, events, last_event_at')
    .eq('provider', 'resend')
    .eq('provider_message_id', messageId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return { ok: true, updated: false, reason: 'missing_table' }
    return { ok: false, updated: false, reason: error.message }
  }
  // Correo que no registramos (otro tipo de correo o enviado antes del registro): nada que actualizar
  if (!row) return { ok: true, updated: false, reason: 'unknown_message' }

  const events = Array.isArray(row.events) ? row.events : []
  if (eventId && events.some((e) => e?.id === eventId)) return { ok: true, updated: false, reason: 'duplicate', row }

  const nextEvents = [...events, { id: eventId || null, type, at: atIso }].slice(-MAX_EVENTS)
  const promote = (STATUS_RANK[status] ?? 0) > (STATUS_RANK[row.status] ?? 0)
  const patch = {
    events: nextEvents,
    last_event_at: !row.last_event_at || atIso > new Date(row.last_event_at).toISOString() ? atIso : row.last_event_at,
    updated_at: new Date().toISOString(),
  }
  if (promote) {
    // Condicionado a que el estado siga siendo de menor rango: si otro evento del mismo correo llegó en paralelo
    // (p. ej. bounced) y ya lo subió, este (delivered) no lo pisa y solo agrega el evento.
    const lower = Object.keys(STATUS_RANK).filter((s) => STATUS_RANK[s] < STATUS_RANK[status])
    const reason = providerEventError(type, data)
    const promoted = { ...patch, status, ...(reason ? { error: reason } : {}) }
    const { count, error: promoteError } = await supabase
      .from(EMAIL_LOG_TABLE)
      .update(promoted, { count: 'exact' })
      .eq('id', row.id)
      .in('status', lower)
    if (promoteError) return { ok: false, updated: false, reason: promoteError.message }
    if (count) return { ok: true, updated: true, row: { ...row, ...promoted }, previousStatus: row.status }
  }
  const { error: updateError } = await supabase.from(EMAIL_LOG_TABLE).update(patch).eq('id', row.id)
  if (updateError) return { ok: false, updated: false, reason: updateError.message }
  // Si la promoción perdió la carrera, el estado actual lo fijó el otro evento (que ya avisó lo que correspondía):
  // status null = desconocido aquí, para que quien llama no avise dos veces.
  return { ok: true, updated: true, row: { ...row, ...patch, ...(promote ? { status: null } : {}) }, previousStatus: row.status }
}

/** Últimos intentos de envío de una orden (más reciente primero). [] si la tabla no existe. */
export async function loadOrderEmailLog(supabase, orderId, { limit = 10 } = {}) {
  try {
    const { data, error } = await supabase
      .from(EMAIL_LOG_TABLE)
      .select('created_at, kind, recipient, status, error, events, last_event_at, provider_message_id')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) {
      if (!isMissingTable(error)) console.warn('email log:', error.message)
      return null
    }
    return data || []
  } catch (err) {
    console.warn('email log:', err?.message || err)
    return null
  }
}

const STATUS_LABELS = {
  sent: 'Enviado (Resend lo aceptó; aún sin confirmación de entrega)',
  delivered: 'Entregado en el servidor del destinatario',
  delayed: 'Entrega demorada (Resend sigue reintentando)',
  bounced: 'Rebotó: la dirección no existe o no acepta correo',
  complained: 'El destinatario lo marcó como spam',
  failed: 'No se pudo enviar',
}

/**
 * Resumen para get_order. `rows` = loadOrderEmailLog (null = registro no disponible).
 * `emailSentAt` = event_orders.email_sent_at, para órdenes anteriores al registro.
 */
export function summarizeEmailDelivery(rows, { emailSentAt = null } = {}) {
  if (rows === null) {
    return { tracked: false, last_status: emailSentAt ? 'sent' : null, sent_at: emailSentAt, note: 'El registro de entrega aún no está disponible: solo se sabe si se envió (email_sent_at).' }
  }
  if (!rows.length) {
    return {
      tracked: false,
      last_status: emailSentAt ? 'sent' : null,
      sent_at: emailSentAt,
      attempts: [],
      note: emailSentAt
        ? 'Correo enviado antes de que existiera el registro de entrega: no hay confirmación de entrega ni rebotes.'
        : 'No hay intentos de envío registrados para esta orden.',
    }
  }
  const last = rows[0]
  const bounced = last.status === 'bounced' || last.status === 'complained'
  return {
    tracked: true,
    last_status: last.status,
    last_status_label: STATUS_LABELS[last.status] || last.status,
    last_attempt_at: last.created_at,
    last_event_at: last.last_event_at || null,
    recipient: last.recipient || null,
    ...(last.error ? { last_error: last.error } : {}),
    ...(bounced
      ? { action_needed: 'El último correo no llegó (rebote o spam). Pide al comprador otra dirección y transfiere la entrada (transfer_ticket), o verifica la dirección antes de reenviar.' }
      : {}),
    attempts: rows.map((r) => ({
      at: r.created_at,
      status: r.status,
      recipient: r.recipient || null,
      ...(r.error ? { error: r.error } : {}),
      provider_events: (Array.isArray(r.events) ? r.events : []).map((e) => ({ type: e?.type, at: e?.at })),
    })),
  }
}
