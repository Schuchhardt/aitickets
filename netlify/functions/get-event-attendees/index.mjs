// GET /api/get-event-attendees?event_id= — lista de entradas del evento para el check-in offline.
// Requiere sesión con rol de check-in y que el evento sea de la organización del usuario.
// Pagina con .range() (sin el tope de 1000 filas). Incluye `dates` (funciones) para el aviso de función (R1).
import { getSupabaseAdmin, getOwnedEvent, fetchAllRows } from '../../lib/supabase.mjs'
import { getSessionContextWithRefresh, jsonWithCookies, CHECKIN_ROLES } from '../../lib/session.mjs'

export default async function handler(req) {
  const { ctx, setCookies } = await getSessionContextWithRefresh(req)
  const respond = (body, status) => jsonWithCookies(body, status, setCookies)

  if (req.method !== 'GET') return respond({ message: 'Método no permitido' }, 405)
  if (!ctx) return respond({ message: 'No autorizado' }, 401)
  if (!CHECKIN_ROLES.includes(ctx.dbUser.role || '')) return respond({ message: 'No autorizado' }, 403)

  try {
    const eventId = Number(new URL(req.url).searchParams.get('event_id'))
    if (!Number.isInteger(eventId)) return respond({ message: 'event_id es requerido' }, 400)

    const event = await getOwnedEvent(eventId, ctx.dbUser.organization_id, 'id')
    if (!event) return respond({ message: 'Evento no encontrado o sin permisos' }, 403)

    const supabase = getSupabaseAdmin()
    let attendees
    try {
      attendees = await fetchAllRows(() => supabase
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
          event_tickets ( ticket_name, event_date_id )
        `)
        .eq('event_id', eventId)
        .order('id', { ascending: true }))
    } catch (error) {
      console.error('Error al obtener asistentes:', error.message)
      return respond({ message: 'No se pudieron obtener los asistentes.' }, 500)
    }

    const { data: dates } = await supabase
      .from('event_dates')
      .select('id, date, start_time')
      .eq('event_id', eventId)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })

    return respond({ attendees, dates: dates || [] }, 200)
  } catch (err) {
    console.error('Error en get-event-attendees:', err?.message)
    return respond({ message: 'Error interno del servidor' }, 500)
  }
}

export const config = {
  path: ['/api/get-event-attendees'],
}
