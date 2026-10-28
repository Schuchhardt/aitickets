// Utilidades de check-in: advertencia cuando la entrada es de otra función (contrato R1), ingreso por función de
// las entradas multifunción y hora límite de ingreso (la lista "hasta las 01:00").
import { EVENT_DATE_COLUMNS, todayInTimeZone, formatFunctionLabel } from './dates.mjs'
import { isMultiSession, pickSession, santiagoDay, sessionView } from '../../src/lib/sessionCheckin.mjs'
import { entryDeadlineCheck, lateEntryMessage, normalizeEntryUntil } from '../../src/lib/entryDeadline.mjs'

/**
 * Si la entrada es de una función específica (event_tickets.event_date_id) que no es hoy (America/Santiago),
 * devuelve { function_mismatch: true, function_label }. Si no, { function_mismatch: false, function_label }.
 */
export async function getFunctionCheck(supabase, eventId, eventDateId) {
  if (eventDateId == null) return { function_mismatch: false, function_label: null }
  const { data: fn } = await supabase
    .from('event_dates')
    .select(EVENT_DATE_COLUMNS)
    .eq('id', eventDateId)
    .eq('event_id', eventId)
    .maybeSingle()
  if (!fn) return { function_mismatch: false, function_label: null }
  const label = formatFunctionLabel(fn)
  return { function_mismatch: String(fn.date).slice(0, 10) !== todayInTimeZone(), function_label: label }
}

// ==== Ingreso por función de las entradas multifunción (aitickets_attendee_checkins) ====
// Una entrada "para todas las funciones" de un evento con varias funciones entra una vez en cada una. La lógica de
// qué función se valida está en src/lib/sessionCheckin.mjs (la comparte el escáner offline).

const MISSING_TABLE = new Set(['42P01', 'PGRST205'])
const isMissingTable = (error) =>
  MISSING_TABLE.has(error?.code) || (/aitickets_attendee_checkins/.test(error?.message || '') && /does not exist|schema cache/i.test(error?.message || ''))

/** Funciones del evento (con lugar, para las etiquetas), ordenadas. */
export async function loadEventSessions(supabase, eventId) {
  const { data, error } = await supabase
    .from('event_dates')
    .select(EVENT_DATE_COLUMNS)
    .eq('event_id', eventId)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

/**
 * Agrega `session_checkins` ([{ event_date_id, checked_in_at }]) a las entradas multifunción para el escáner
 * (sessionView). Si la tabla aún no existe o falla la lectura, devuelve las entradas tal cual (el escáner sigue
 * funcionando con la regla de un solo ingreso).
 */
export async function attachSessionCheckins(supabase, eventId, attendees, dates) {
  const multi = (attendees || []).filter((a) => isMultiSession(a?.event_tickets?.event_date_id ?? null, dates))
  if (!multi.length) return attendees
  const byAttendee = new Map()
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await supabase
      .from('aitickets_attendee_checkins')
      .select('event_attendee_id, event_date_id, checked_in_at')
      .eq('event_id', eventId)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) {
      if (!isMissingTable(error)) console.error('attachSessionCheckins:', error.message)
      return attendees
    }
    for (const row of data || []) {
      const list = byAttendee.get(row.event_attendee_id) || []
      list.push({ event_date_id: row.event_date_id, checked_in_at: row.checked_in_at })
      byAttendee.set(row.event_attendee_id, list)
    }
    if (!data || data.length < 1000) break
  }
  const multiIds = new Set(multi.map((a) => a.id))
  return attendees.map((a) => (multiIds.has(a.id) ? { ...a, session_checkins: byAttendee.get(a.id) || [] } : a))
}

/**
 * Ingreso de una entrada multifunción a la función que corresponde a `validatedAt`. Devuelve null si la entrada no
 * es multifunción o la tabla aún no existe (el llamador sigue con la regla de un solo ingreso). La entrada ya debe
 * estar activa o validada (las anuladas las rechaza el llamador).
 * Resultado: { ok: true, validated_at, function_label, sessions_attended, sessions_total }
 *          | { ok: false, code: 'already_validated', message, validated_at }
 */
export async function checkInSession(supabase, eventId, ticket, validatedAt, dates = null) {
  if (ticket?.event_tickets?.event_date_id != null) return null
  const sessions = dates || (await loadEventSessions(supabase, eventId))
  if (!isMultiSession(null, sessions)) return null
  const session = pickSession(sessions, validatedAt)
  const label = formatFunctionLabel(session, { withPlace: false })

  const { error } = await supabase
    .from('aitickets_attendee_checkins')
    .insert({ event_attendee_id: ticket.id, event_id: eventId, event_date_id: session.id, checked_in_at: validatedAt })
  if (error) {
    if (isMissingTable(error)) return null
    if (error.code !== '23505') throw new Error(error.message)
    const { data: prev } = await supabase
      .from('aitickets_attendee_checkins')
      .select('checked_in_at')
      .eq('event_attendee_id', ticket.id)
      .eq('event_date_id', session.id)
      .maybeSingle()
    const today = String(session.date).slice(0, 10) === santiagoDay(validatedAt)
    return {
      ok: false,
      code: 'already_validated',
      message: today ? 'Ya ingresó hoy.' : `Ya ingresó a la función ${label}.`,
      validated_at: prev?.checked_in_at ?? null,
      function_label: label,
    }
  }

  // Primer ingreso: la entrada queda 'validated' (asistió), con la hora del primer ingreso.
  if (ticket.status == null || ticket.status === 'active') {
    for (const cond of ['active', null]) {
      let q = supabase.from('event_attendees').update({ status: 'validated', validated_at: validatedAt }, { count: 'exact' }).eq('id', ticket.id)
      q = cond === null ? q.is('status', null) : q.eq('status', cond)
      const { count, error: updError } = await q
      if (updError) throw new Error(updError.message)
      if (count) break
    }
  }
  const { count: attended } = await supabase
    .from('aitickets_attendee_checkins')
    .select('id', { count: 'exact', head: true })
    .eq('event_attendee_id', ticket.id)
  return {
    ok: true,
    validated_at: validatedAt,
    function_mismatch: false,
    function_label: label,
    sessions_attended: Number(attended) || 1,
    sessions_total: sessions.length,
  }
}

/**
 * Para validate-ticket (buscar por QR): una entrada multifunción con el estado de la función actual, como
 * sessionView. Devuelve {} si no es multifunción o la tabla aún no existe; si no, campos que reemplazan
 * status / validated_at y agregan function_label, sessions_attended y sessions_total.
 */
export async function ticketSessionState(supabase, eventId, row, at = new Date()) {
  if (row?.event_tickets?.event_date_id != null) return {}
  const status = row?.status ?? 'active'
  if (status !== 'active' && status !== 'validated') return {}
  const sessions = await loadEventSessions(supabase, eventId)
  if (!isMultiSession(null, sessions)) return {}
  const { data, error } = await supabase
    .from('aitickets_attendee_checkins')
    .select('event_date_id, checked_in_at')
    .eq('event_attendee_id', row.id)
  if (error) return {}
  const view = sessionView({ ...row, status, session_checkins: data || [] }, sessions, at)
  const session = sessions.find((d) => String(d.id) === String(view.session_date_id))
  return {
    status: view.status,
    validated_at: view.validated_at,
    function_mismatch: false,
    function_label: session ? formatFunctionLabel(session, { withPlace: false }) : null,
    sessions_attended: view.sessions_attended,
    sessions_total: view.sessions_total,
  }
}

// ==== Hora límite de ingreso (event_tickets.entry_until, migración 202610300300) ====
// Pasada la hora, confirmar responde 409 late_entry ("fuera de horario") salvo que la puerta fuerce el ingreso
// (force: true). La regla pura está en src/lib/entryDeadline.mjs (la comparte el escáner offline).

const MISSING_COLUMN = new Set(['42703', 'PGRST204'])

/** Hora límite por tipo de entrada del evento: Map(ticketTypeId -> "HH:MM"). Vacío si la columna aún no existe. */
export async function loadEntryDeadlines(supabase, eventId) {
  const { data, error } = await supabase.from('event_tickets').select('id, entry_until').eq('event_id', eventId)
  if (error) {
    if (!MISSING_COLUMN.has(error.code) && !/entry_until/.test(error.message || '')) console.error('loadEntryDeadlines:', error.message)
    return new Map()
  }
  const map = new Map()
  for (const row of data || []) {
    const until = normalizeEntryUntil(row.entry_until)
    if (until) map.set(Number(row.id), until)
  }
  return map
}

/**
 * Agrega `event_tickets.entry_until` a las entradas de la lista del escáner (necesitan `event_ticket_id`), para que
 * marque "fuera de horario" también sin conexión.
 */
export async function attachEntryDeadlines(supabase, eventId, attendees) {
  if (!attendees?.length) return attendees || []
  const deadlines = await loadEntryDeadlines(supabase, eventId)
  if (!deadlines.size) return attendees
  return attendees.map((a) => {
    const until = deadlines.get(Number(a?.event_ticket_id))
    return until ? { ...a, event_tickets: { ...(a.event_tickets || {}), entry_until: until } } : a
  })
}

/**
 * Estado de la hora límite de una entrada (con `event_ticket_id` y `event_tickets.event_date_id`) en `at`.
 * null si su tipo no tiene hora límite; si no, { late, entry_until, deadline_at }.
 */
export async function entryDeadlineState(supabase, eventId, ticket, at = new Date(), dates = null) {
  const typeId = ticket?.event_ticket_id
  if (typeId == null) return null
  const { data, error } = await supabase.from('event_tickets').select('entry_until').eq('id', typeId).eq('event_id', eventId).maybeSingle()
  if (error || !normalizeEntryUntil(data?.entry_until)) return null
  const sessions = dates || (await loadEventSessions(supabase, eventId))
  return entryDeadlineCheck({ entryUntil: data.entry_until, eventDateId: ticket.event_tickets?.event_date_id ?? null, dates: sessions, at })
}

/**
 * Para confirmar: si la entrada llega fuera de horario y no se forzó, el rechazo
 * { ok: false, code: 'late_entry', message, entry_until, deadline_at }. Si no, null (o, forzada, { late_entry: true }
 * para sumar a la respuesta).
 */
export async function lateEntryGate(supabase, eventId, ticket, validatedAt, force = false) {
  if (ticket?.event_ticket_id == null) return null
  const sessions = await loadEventSessions(supabase, eventId)
  // Una entrada de una sola vez que ya entró responde "ya validada", no "fuera de horario"
  if (ticket.status === 'validated' && !isMultiSession(ticket.event_tickets?.event_date_id ?? null, sessions)) return null
  const state = await entryDeadlineState(supabase, eventId, ticket, new Date(validatedAt), sessions)
  if (!state?.late) return null
  if (force) return { forced: true, late_entry: true, entry_until: state.entry_until }
  return { ok: false, code: 'late_entry', message: lateEntryMessage(state.entry_until), entry_until: state.entry_until, deadline_at: state.deadline_at }
}
