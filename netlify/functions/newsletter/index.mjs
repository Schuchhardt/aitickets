// POST /api/newsletter — suscripción al newsletter (Supabase + MailerLite).
// Privacidad: no se guarda la IP, solo el país (geo de Netlify).
import { getSupabaseAdmin, json } from '../../lib/supabase.mjs'
import { isValidEmail } from '../../lib/mailer.mjs'

const clean = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : null) || null

export default async function handler(req, context) {
  if (req.method !== 'POST') return json({ message: 'Método no permitido' }, 405)

  let body
  try {
    body = await req.json()
  } catch {
    return json({ message: 'Solicitud inválida' }, 400)
  }

  const email = clean(body?.email, 254)?.toLowerCase()
  if (!email || !isValidEmail(email)) return json({ message: 'Ingresa un correo electrónico válido' }, 400)

  const language = clean(body?.language, 20)
  const timezone = clean(body?.timezone, 64)
  const referrer = clean(body?.referrer, 512)
  const country = context?.geo?.country?.name || null

  try {
    const supabase = getSupabaseAdmin()
    const { data: existing, error: fetchError } = await supabase
      .from('newsletter')
      .select('id')
      .eq('email', email)
      .limit(1)
    if (fetchError) throw new Error(fetchError.message)
    if (existing?.length) return json({ message: 'Ya estás registrado' }, 200)

    const { error: insertError } = await supabase
      .from('newsletter')
      .insert([{ email, country, language, timezone, referrer }])
    if (insertError) throw new Error(insertError.message)

    const mailerLiteApiKey = process.env.MAILERLITE_API_TOKEN
    if (mailerLiteApiKey) {
      const groupId = process.env.MAILERLITE_GROUP_ID
      const res = await fetch('https://connect.mailerlite.com/api/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mailerLiteApiKey}` },
        body: JSON.stringify({
          email,
          groups: groupId ? [groupId] : [],
          fields: { country, language, timezone, tracking_source: referrer || '' },
        }),
      })
      if (!res.ok) console.error('MailerLite respondió', res.status)
    }

    return json({ message: '¡Gracias por suscribirte!' }, 200)
  } catch (error) {
    console.error('Error en newsletter:', error?.message)
    return json({ message: 'Ha ocurrido un error, intenta más tarde' }, 500)
  }
}

export const config = {
  path: ['/api/newsletter', '/api/subscribe'],
}
