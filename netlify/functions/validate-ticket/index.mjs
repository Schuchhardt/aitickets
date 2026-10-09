// POST /api/validate-ticket (contrato C7) — busca una entrada por QR dentro de un evento.
// Body: { qr_code, event_id }. Requiere sesión con rol de check-in y evento de la organización del usuario.
// status NULL (entradas antiguas) se devuelve como 'active'. R1: incluye function_mismatch/function_label.
import { getSupabaseAdmin, getOwnedEvent } from '../../lib/supabase.mjs'
import { canAccessEventByStaff } from '../../lib/event-staff.mjs'
import { getSessionContextWithRefresh, jsonWithCookies, CHECKIN_ROLES } from '../../lib/session.mjs'
import { getFunctionCheck } from '../../lib/checkin.mjs'

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
    const qrCode = typeof body?.qr_code === 'string' ? body.qr_code.trim().slice(0, 200) : ''
    const eventId = Number(body?.event_id)
    if (!qrCode || !Number.isInteger(eventId)) {
      return respond({ message: 'QR o Evento no recibido' }, 400)
    }

    const event = await getOwnedEvent(eventId, ctx.dbUser.organization_id, 'id')
    if (!event) return respond({ message: 'Evento no encontrado o sin permisos' }, 403)
    // Acceso por evento (aitickets_event_staff)
    if (!(await canAccessEventByStaff(getSupabaseAdmin(), ctx.dbUser.id, eventId))) return respond({ message: 'Evento no encontrado o sin permisos' }, 403)

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('event_attendees')
      .select(`
        id,
        event_id,
        qr_code,
        status,
        validated_at,
        event_order_id,
        is_complimentary,
        attendees ( first_name, last_name, email ),
        event_tickets ( ticket_name, price, event_date_id )
      `)
      .eq('qr_code', qrCode)
      .eq('event_id', eventId)
      .maybeSingle()

    if (error || !data) {
      return respond({ message: 'No se encontró una entrada con ese código QR.' }, 404)
    }

    const fnCheck = await getFunctionCheck(supabase, eventId, data.event_tickets?.event_date_id ?? null)
    const ticket = {
      id: data.id,
      event_id: data.event_id,
      qr_code: data.qr_code,
      event_order_id: data.event_order_id,
      is_complimentary: data.is_complimentary,
      event_date_id: data.event_tickets?.event_date_id ?? null,
      status: data.status ?? 'active',
      validated_at: data.validated_at,
      full_name: `${data.attendees?.first_name || ''} ${data.attendees?.last_name || ''}`.trim(),
      email: data.attendees?.email || null,
      ticket_name: data.event_tickets?.ticket_name || null,
      price: data.event_tickets?.price ?? null,
      ...fnCheck,
    }

    return respond({ ticket }, 200)
  } catch (err) {
    console.error('Error en validate-ticket:', err?.message)
    return respond({ message: 'Error interno del servidor' }, 500)
  }
}

export const config = {
  path: ['/api/validate-ticket'],
}
