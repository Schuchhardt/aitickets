import { createClient } from '@supabase/supabase-js'

// Configurar Supabase con Service Role para crear auth users
const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

export default async function handler(req, context) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Método no permitido' }), { status: 405 })
  }

  try {
    const body = await req.json()
    const { name, email, password, phone, organization_name } = body

    if (!email || !password || password.length < 6) {
      return new Response(JSON.stringify({ message: 'Email y contraseña (mín 6 caracteres) son requeridos' }), { status: 400 })
    }

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

    // Create auth user via Supabase Auth (password is hashed by Supabase)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name }
    })

    if (authError) {
      console.error('❌ Error al crear auth user:', authError.message)
      // Rollback: delete org
      await supabase.from('organizations').delete().eq('id', org.id)
      throw new Error('Error al crear el usuario: ' + authError.message)
    }

    // Crear usuario en tabla pública con referencia al auth user
    const { error: userError } = await supabase.from('users').insert([
      {
        name,
        email,
        phone,
        organization_id: org.id,
        auth_user_id: authData.user.id,
        role: 'admin'
      }
    ])

    if (userError) {
      console.error('❌ Error al crear el usuario:', userError.message)
      // Rollback: delete auth user and org
      await supabase.auth.admin.deleteUser(authData.user.id)
      await supabase.from('organizations').delete().eq('id', org.id)
      throw new Error('Error al crear el usuario')
    }

    // Notificar en Slack sobre nuevo productor
    await notifySlack({ name, email, phone, organization_name })

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

async function notifySlack({ name, email, phone, organization_name }) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) {
    console.warn('⚠️ SLACK_WEBHOOK_URL no configurado, omitiendo notificación')
    return
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🎉 *Nuevo productor registrado*\n• *Nombre:* ${name}\n• *Email:* ${email}\n• *Teléfono:* ${phone || 'No proporcionado'}\n• *Organización:* ${organization_name || 'No proporcionada'}`
      })
    })

    if (!res.ok) {
      console.error('❌ Error al enviar notificación a Slack:', res.statusText)
    }
  } catch (err) {
    console.error('❌ Error al notificar a Slack:', err.message)
  }
}

export const config = {
  path: ['/api/register-producer']
}
