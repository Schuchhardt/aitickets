// Función programada (cada 15 min, config.schedule abajo): manda por correo la dirección que solo ven quienes compran
// cuando se revela (events.secret_location_reveal_hours horas antes de la función). La lógica (a quién, una vez por
// persona y evento) vive en netlify/lib/secret-location.mjs.
import { getSupabaseAdmin, escapeHtml, fetchAllRows } from '../../lib/supabase.mjs'
import { sendEmail, SITE_URL, formatRecipient, isValidEmail } from '../../lib/mailer.mjs'
import { renderSecretLocationEmail } from '../../lib/emails/index.mjs'
import { greetingName, holderName } from '../../lib/buyer-name.mjs'
import { formatDateOnlyLong, formatTimeShort } from '../../lib/dates.mjs'
import { sendSecretLocationReveals } from '../../lib/secret-location.mjs'

export default async function handler() {
  try {
    const result = await sendSecretLocationReveals(getSupabaseAdmin(), {
      sendEmail,
      renderEmail: renderSecretLocationEmail,
      siteUrl: SITE_URL,
      formatRecipient,
      isValidEmail,
      escapeHtml,
      greetingName,
      holderName,
      fetchAllRows,
      formatDateOnlyLong,
      formatTimeShort,
    })
    console.log(`📍 Dirección revelada: ${result.sent} correo(s) en ${result.events} evento(s)`)
    return new Response(JSON.stringify(result), { status: 200 })
  } catch (error) {
    console.error('Error en send-secret-location:', error?.message)
    return new Response(JSON.stringify({ error: 'Error interno' }), { status: 500 })
  }
}

export const config = {
  schedule: '2,17,32,47 * * * *', // cada 15 min (a los :02, :17, :32 y :47, para no coincidir con las otras)
}
