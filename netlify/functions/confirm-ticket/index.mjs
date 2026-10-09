// POST /api/confirm-ticket (contrato C7) — marca una entrada como validada (check-in).
// Body: { ticket_id, event_id, validated_at? } (validated_at opcional para sincronizaciones offline).
// Requiere sesión de productor con rol admin/producer/editor/validator y que el evento sea de su organización.
// status NULL (entradas antiguas) se trata como 'active'.
// 409 incluye `code`: 'already_validated' (ya validada) | 'invalid_status' (anulada u otro estado).
// R1: la respuesta incluye function_mismatch/function_label si la entrada es de otra función (solo aviso).
import { getSupabaseAdmin, getOwnedEvent } from '../../lib/supabase.mjs'
import { canAccessEventByStaff } from '../../lib/event-staff.mjs'
import { getSessionContextWithRefresh, jsonWithCookies, CHECKIN_ROLES } from '../../lib/session.mjs'
import { getFunctionCheck } from '../../lib/checkin.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Acepta la hora de validación del dispositivo (offline) si es razonable; si no, usa ahora. */
function resolveValidatedAt(value) {
  const now = Date.now()
  const t = value ? Date.parse(value) : NaN
  if (Number.isFinite(t) && t <= now + 5 * 60 * 1000 && t >= now - 48 * 60 * 60 * 1000) return new Date(t).toISOString()
  return new Date(now).toISOString()
}

export default async function handler(req) {
  const { ctx, setCookies } = await getSessionContextWithRefresh(req)
  const respond = (body, status) => jsonWithCookies(body, status, setCookies)

  if (req.method !== 'POST') return respond({ message: 'Método no permitido' }, 405)
  if (!ctx) return respond({ message: 'No autorizado' }, 401)
  if (!CHECKIN_ROLES.includes(ctx.dbUser.role || '')) return respond({ message: 'No tienes permisos para validar entradas' }, 403)

  try {
    let body
    try {
      body = await req.json()
    } catch {
      return respond({ message: 'Solicitud inválida' }, 400)
    }
    const ticketId = String(body?.ticket_id || '')
    const eventId = Number(body?.event_id)
    if (!UUID_RE.test(ticketId) || !Number.isInteger(eventId)) {
      return respond({ message: 'ticket_id y event_id son requeridos' }, 400)
    }

    const event = await getOwnedEvent(eventId, ctx.dbUser.organization_id, 'id')
    if (!event) return respond({ message: 'Evento no encontrado o sin permisos' }, 403)
    // Acceso por evento (aitickets_event_staff)
    if (!(await canAccessEventByStaff(getSupabaseAdmin(), ctx.dbUser.id, eventId))) return respond({ message: 'Evento no encontrado o sin permisos' }, 403)

    const supabase = getSupabaseAdmin()
    const { data: ticket, error: ticketError } = await supabase
      .from('event_attendees')
      .select('id, status, validated_at, event_tickets ( event_date_id )')
      .eq('id', ticketId)
      .eq('event_id', eventId)
      .maybeSingle()
    if (ticketError) throw new Error(ticketError.message)
    if (!ticket) return respond({ message: 'La entrada no pertenece a este evento' }, 404)

    if (ticket.status === 'validated') {
      return respond({ message: 'Entrada ya validada', code: 'already_validated', validated_at: ticket.validated_at }, 409)
    }
    if (ticket.status != null && ticket.status !== 'active') {
      return respond({ message: `Entrada no válida (estado: ${ticket.status})`, code: 'invalid_status', status: ticket.status }, 409)
    }

    const validatedAt = resolveValidatedAt(body?.validated_at)
    // PostgREST 12.2 falla (42703) si un UPDATE con filtro or()/and() pide la fila de vuelta
    // (return=representation): se usa count exacto y, si hace falta, una lectura aparte.
    const { count: updatedCount, error: updateError } = await supabase
      .from('event_attendees')
      .update({ status: 'validated', validated_at: validatedAt }, { count: 'exact' })
      .eq('id', ticketId)
      .eq('event_id', eventId)
      .or('status.is.null,status.eq.active')
    if (updateError) throw new Error(updateError.message)

    if (!updatedCount) {
      // Otro dispositivo la validó entre la lectura y el update
      const { data: current } = await supabase
        .from('event_attendees')
        .select('status, validated_at')
        .eq('id', ticketId)
        .maybeSingle()
      if (current?.status === 'validated') {
        return respond({ message: 'Entrada ya validada', code: 'already_validated', validated_at: current?.validated_at || null }, 409)
      }
      return respond({ message: `Entrada no válida (estado: ${current?.status || 'desconocido'})`, code: 'invalid_status', status: current?.status || null }, 409)
    }

    const fnCheck = await getFunctionCheck(supabase, eventId, ticket.event_tickets?.event_date_id ?? null)
    return respond({ message: 'Entrada validada exitosamente', validated_at: validatedAt, ...fnCheck }, 200)
  } catch (err) {
    console.error('Error en confirm-ticket:', err?.message)
    return respond({ message: 'Error interno del servidor' }, 500)
  }
}

export const config = {
  path: ['/api/confirm-ticket'],
}
