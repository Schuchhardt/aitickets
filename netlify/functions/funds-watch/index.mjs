// Función programada (cada hora, config.schedule abajo): riesgo por evento, funciones terminadas sin check-ins y picos
// de reclamos/contracargos, con avisos a Slack. La lógica vive en netlify/lib/funds-watch.mjs.
import { getSupabaseAdmin } from '../../lib/supabase.mjs'
import { runFundsWatch } from '../../lib/funds-watch.mjs'

export default async function handler() {
  try {
    const result = await runFundsWatch(getSupabaseAdmin())
    console.log('🛡️ funds-watch:', JSON.stringify(result))
    return new Response(JSON.stringify(result), { status: 200 })
  } catch (error) {
    console.error('Error en funds-watch:', error?.message)
    return new Response(JSON.stringify({ error: 'Error interno' }), { status: 500 })
  }
}

export const config = {
  schedule: '40 * * * *', // cada hora (a los :40, para no coincidir con recordatorios, mensajes y reseñas)
}
