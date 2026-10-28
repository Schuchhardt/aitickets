// Hora límite de ingreso de un tipo de entrada (event_tickets.entry_until, migración 202610300300): la lista "hasta
// las 01:00". Es una hora local (America/Santiago) relativa a la función: si es anterior a la hora de inicio, es del
// día siguiente (función a las 23:00, "hasta 01:00" = 01:00 de la madrugada siguiente). Pasada esa hora la puerta ve
// "fuera de horario" y decide si deja entrar igual (force). Lógica pura, compartida por el servidor
// (netlify/lib/checkin.mjs) y el escáner (ValidateQR.vue, también sin conexión).
import { zonedDateTimeToUtc, addDays } from '../../netlify/lib/dates.mjs'
import { isMultiSession, pickSession } from './sessionCheckin.mjs'

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/

/** "01:00" desde "01:00:00" (lo que devuelve Postgres); null si no es una hora válida. */
export function normalizeEntryUntil(value) {
  if (value === null || value === undefined || value === '') return null
  const s = String(value).trim()
  if (!HHMM_RE.test(s)) return null
  return s.slice(0, 5)
}

const minutesOf = (hhmm) => {
  const [h, m] = String(hhmm || '00:00').slice(0, 5).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** true si la hora límite cae el día siguiente al de la función (es anterior a su hora de inicio). */
export function entryUntilNextDay(entryUntil, startTime) {
  const until = normalizeEntryUntil(entryUntil)
  if (!until || !startTime) return false
  return minutesOf(until) < minutesOf(startTime)
}

/** Instante (Date, UTC) en que vence el ingreso para la función `fn` ({ date, start_time }). */
export function entryDeadlineAt(entryUntil, fn) {
  const until = normalizeEntryUntil(entryUntil)
  if (!until || !fn?.date) return null
  const day = String(fn.date).slice(0, 10)
  return zonedDateTimeToUtc(entryUntilNextDay(until, fn.start_time) ? addDays(day, 1) : day, until)
}

/**
 * La función contra la que se mide la hora límite: la de la entrada; si vale para todas, la que se valida ahora
 * (pickSession) o la única del evento.
 */
export function deadlineFunction(eventDateId, dates, at = new Date()) {
  const list = Array.isArray(dates) ? dates : []
  if (eventDateId !== null && eventDateId !== undefined && eventDateId !== '') {
    return list.find((d) => String(d.id) === String(eventDateId)) || null
  }
  if (isMultiSession(null, list)) return pickSession(list, at)
  return list[0] || null
}

/**
 * ¿La entrada llega fuera de horario en `at`? Devuelve null si su tipo no tiene hora límite (o no se sabe la
 * función); si no, { late, entry_until: "HH:MM", deadline_at: ISO }.
 */
export function entryDeadlineCheck({ entryUntil, eventDateId = null, dates = [], at = new Date() }) {
  const until = normalizeEntryUntil(entryUntil)
  if (!until) return null
  const when = at instanceof Date ? at : new Date(at)
  const fn = deadlineFunction(eventDateId, dates, when)
  const deadline = entryDeadlineAt(until, fn)
  if (!deadline) return null
  return { late: when.getTime() > deadline.getTime(), entry_until: until, deadline_at: deadline.toISOString() }
}

/** Mensaje para la puerta: "Fuera de horario: la entrada valía hasta las 01:00." */
export const lateEntryMessage = (entryUntil) => `Fuera de horario: la entrada valía hasta las ${normalizeEntryUntil(entryUntil) || '—'}.`
