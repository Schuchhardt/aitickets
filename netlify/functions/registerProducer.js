const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

exports.handler = async (event) => {
    console.log("🔑 SUPABASE URL:", process.env.SUPABASE_URL)
  console.log("🔑 SUPABASE KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY)
  
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    }
  }

  try {
    const data = JSON.parse(event.body)
    const {
      name,
      email,
      password,
      phone,
      organization_id
    } = data

    const { error: userError } = await supabase
      .from('users')
      .insert([{
        name,
        email,
        encrypted_password: password,
        phone,
        organization_id
      }])

    if (userError) throw new Error('Error al crear el usuario')

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Registro exitoso' })
    }
  } catch (err) {
    console.error('Error en registerProducer:', err.message)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    }
  }
}
