// Función programada (cada hora, config.schedule abajo): correos "¿Cómo estuvo?" después de cada función de un evento,
// con link para calificar de 1 a 5 estrellas, comentar y subir fotos. Hasta 3 por persona: el primero 4 h (de día) u 8 h
// (de noche) después del término y dos recordatorios, siempre entre las 10:00 y las 23:00 de Chile.
// La lógica (qué funciones, a quién, en qué paso va cada persona) vive en netlify/lib/review-requests.mjs.
import { getSupabaseAdmin } from '../../lib/supabase.mjs'
import { sendReviewRequests } from '../../lib/review-requests.mjs'
import { withHeartbeat } from '../../lib/job-heartbeat.mjs'

export default withHeartbeat('send-review-requests', async function handler() {
  try {
    const result = await sendReviewRequests(getSupabaseAdmin())
    if (result.skipped) console.log(`⭐ Reseñas: ${result.skipped}`)
    else console.log(`⭐ Reseñas pedidas: ${result.sent} correo(s) (${result.reminders} recordatorios) en ${result.events} evento(s)${result.failed ? `, ${result.failed} fallidos` : ''}${result.partial ? ' · quedó trabajo para la próxima hora' : ''}`)
    return new Response(JSON.stringify(result), { status: 200 })
  } catch (error) {
    console.error('Error en send-review-requests:', error?.message)
    return new Response(JSON.stringify({ error: 'Error interno' }), { status: 500 })
  }
})

export const config = {
  schedule: '20 * * * *', // cada hora (a los :20, para no coincidir con los recordatorios y los mensajes)
}
