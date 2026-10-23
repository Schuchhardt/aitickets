// Función programada (cada hora, config.schedule abajo): correo "¿Cómo estuvo?" 24 h después de que termina
// cada función de un evento, con link para calificar de 1 a 5 estrellas, comentar y subir fotos.
// La lógica (qué funciones, a quién, deduplicación) vive en netlify/lib/review-requests.mjs.
import { getSupabaseAdmin } from '../../lib/supabase.mjs'
import { sendReviewRequests } from '../../lib/review-requests.mjs'

export default async function handler() {
  try {
    const result = await sendReviewRequests(getSupabaseAdmin())
    console.log(`⭐ Reseñas pedidas: ${result.sent} correo(s) en ${result.events} evento(s)${result.failed ? `, ${result.failed} fallidos` : ''}`)
    return new Response(JSON.stringify(result), { status: 200 })
  } catch (error) {
    console.error('Error en send-review-requests:', error?.message)
    return new Response(JSON.stringify({ error: 'Error interno' }), { status: 500 })
  }
}

export const config = {
  schedule: '20 * * * *', // cada hora (a los :20, para no coincidir con los recordatorios y los mensajes)
}
