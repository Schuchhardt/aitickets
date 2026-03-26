import { createClient } from '@supabase/supabase-js'

// Configurar Supabase
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY 
const supabase = createClient(supabaseUrl, supabaseKey)

export default async function handler(req, context) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Método no permitido' }), { status: 405 })
  }

  try {
    const body = await req.json()
    const { name, email, password, phone, organization_name } = body

    // Crear organización
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert([{ public_name: organization_name }])
      .select()
      .single()

    if (orgError) {
      console.error('❌ Error al crear la organización:', orgError.message)
      throw new Error('Error al crear la organización')
    }

    // Crear usuario con el id de la organización recién creada
    const { error: userError } = await supabase.from('users').insert([
      {
        name,
        email,
        encrypted_password: password,
        phone,
        organization_id: org.id
      }
    ])

    if (userError) {
      console.error('❌ Error al crear el usuario:', userError.message)
      throw new Error('Error al crear el usuario')
    }

    // ⏩ Enviar correo de bienvenida (detecta local vs producción)
    try {
      const baseUrl =
        process.env.NODE_ENV === 'production'
          ? process.env.SITE_URL
          : 'http://localhost:8888'

      await fetch(`${baseUrl}/api/send-welcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email })
      })
    } catch (emailError) {
      console.error('📭 Error al enviar el correo de bienvenida:', emailError.message)
    }

    return new Response(JSON.stringify({ message: 'Registro exitoso' }), {
      status: 200
    })
  } catch (err) {
    console.error('🔥 Error en registerProducer:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500
    })
  }
}

export const config = {
  path: ['/api/register-producer']
}


