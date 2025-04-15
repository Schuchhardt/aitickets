import { createClient } from '@supabase/supabase-js'

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
    const { ticket_id } = await req.json()
    console.log("🎫 ticket_id recibido:", ticket_id)

    if (!ticket_id) {
      return new Response(JSON.stringify({ message: 'ticket_id es requerido' }), {
        status: 400
      })
    }

    const { data, error } = await supabase
      .from('event_attendees')
      .update({
        status: 'validated',
        validated_at: new Date().toISOString()
      })
      .eq('id', ticket_id)
      .select()

    console.log("📝 Resultado del UPDATE:", data)

    if (error) {
      console.error('❌ Error al actualizar:', error.message)
      return new Response(
        JSON.stringify({ message: 'No se pudo validar la entrada.' }),
        { status: 500 }
      )
    }

    return new Response(JSON.stringify({ message: 'Entrada validada exitosamente' }), {
      status: 200
    })
  } catch (err) {
    console.error('🔥 Error en confirm-ticket:', err.message)
    return new Response(JSON.stringify({ message: 'Error interno del servidor' }), {
      status: 500
    })
  }
}

export const config = {
  path: ['/api/confirm-ticket']
}

