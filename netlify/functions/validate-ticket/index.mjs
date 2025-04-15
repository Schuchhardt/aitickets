import { createClient } from '@supabase/supabase-js'

// 🔐 Configurar Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Método no permitido' }), {
      status: 405
    })
  }

  try {
    const { qr_code, event_id } = await req.json()

if (!qr_code || !event_id) {
  return new Response(JSON.stringify({ message: 'QR o Evento no recibido' }), {
    status: 400
  })
}

const { data, error } = await supabase
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
      ticket_name,
      price
    )
  `)
  .eq('qr_code', qr_code)
  .eq('event_id', event_id) 
  .single()

      
      console.log("🧠 Resultado completo de Supabase:", data)


    if (error || !data) {
      return new Response(
        JSON.stringify({ message: 'No se encontró una entrada con ese código QR.' }),
        { status: 404 }
      )
    }

    const ticket = {
      id: data.id,
      event_id: data.event_id,
      status: data.status,
      validated_at: data.validated_at,
      full_name: `${data.attendees.first_name} ${data.attendees.last_name}`,
      email: data.attendees.email,
      ticket_name: data.event_tickets.ticket_name,
      price: data.event_tickets.price
    }

    return new Response(JSON.stringify({ ticket }), {
      status: 200
    })
  } catch (err) {
    console.error('❌ Error en validate-ticket:', err.message)
    return new Response(JSON.stringify({ message: 'Error interno del servidor' }), {
      status: 500
    })
  }
}

export const config = {
  path: ['/api/validate-ticket']
}
