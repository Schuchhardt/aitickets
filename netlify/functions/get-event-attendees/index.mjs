import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ message: 'Método no permitido' }), {
      status: 405
    })
  }

  try {
    // Authenticate the request via cookie tokens
    const cookieHeader = req.headers.get('cookie') || ''
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map(c => {
        const [key, ...val] = c.trim().split('=')
        return [key, val.join('=')]
      })
    )
    const accessToken = cookies['sb-access-token']
    if (!accessToken) {
      return new Response(JSON.stringify({ message: 'No autorizado' }), { status: 401 })
    }

    // Verify the token and get user
    const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } }
    })
    const { data: { user }, error: authError } = await anonClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ message: 'No autorizado' }), { status: 401 })
    }

    const url = new URL(req.url)
    const eventId = url.searchParams.get('event_id')

    if (!eventId) {
      return new Response(JSON.stringify({ message: 'event_id es requerido' }), {
        status: 400
      })
    }

    // Verify the user owns this event (via organization)
    const { data: dbUser } = await supabaseAdmin
      .from('users')
      .select('organization_id')
      .eq('auth_user_id', user.id)
      .single()

    if (!dbUser?.organization_id) {
      return new Response(JSON.stringify({ message: 'No autorizado' }), { status: 403 })
    }

    const { data: eventData } = await supabaseAdmin
      .from('events')
      .select('id')
      .eq('id', eventId)
      .eq('organization_id', dbUser.organization_id)
      .single()

    if (!eventData) {
      return new Response(JSON.stringify({ message: 'Evento no encontrado o sin permisos' }), { status: 403 })
    }

    // Obtener todos los asistentes del evento con información completa
    const { data: attendees, error } = await supabaseAdmin
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
