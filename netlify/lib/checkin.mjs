// Utilidades de check-in (contrato R1): advertencia cuando la entrada es de otra función.
import { EVENT_DATE_COLUMNS, todayInTimeZone, formatFunctionLabel } from './dates.mjs'

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
