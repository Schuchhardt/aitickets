import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ message: 'Método no permitido' }), {
      status: 405
    })
  }

  try {
    const url = new URL(req.url)
    const eventId = url.searchParams.get('event_id')

    if (!eventId) {
      return new Response(JSON.stringify({ message: 'event_id es requerido' }), {
        status: 400
      })
    }

    // Obtener todos los asistentes del evento con información completa
    const { data: attendees, error } = await supabase
      .from('event_attendees')
      .select(`
        id,
        event_id,
        qr_code,
        status,
        validated_at,
        attendees (
          first_name,
          last_name,
          email
        ),
        event_tickets (
          ticket_name
        )
      `)
      .eq('event_id', eventId)

    if (error) {
      console.error('❌ Error al obtener asistentes:', error.message)
      return new Response(
        JSON.stringify({ message: 'No se pudieron obtener los asistentes.' }),
        { status: 500 }
      )
    }

    return new Response(JSON.stringify({ attendees: attendees || [] }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    })
  } catch (err) {
    console.error('🔥 Error en get-event-attendees:', err.message)
    return new Response(JSON.stringify({ message: 'Error interno del servidor' }), {
      status: 500
    })
  }
}

export const config = {
  path: ['/api/get-event-attendees']
}
