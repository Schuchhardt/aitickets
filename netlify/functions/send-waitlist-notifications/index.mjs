// Función programada (cada 15 min, config.schedule abajo): avisa a la lista de espera cuando abre la venta o se
// liberan entradas. La lógica (a quién, cuándo, deduplicación) vive en netlify/lib/waitlist.mjs.
import { getSupabaseAdmin } from '../../lib/supabase.mjs'
import { notifyWaitlist } from '../../lib/waitlist.mjs'

export default async function handler() {
  try {
    const result = await notifyWaitlist(getSupabaseAdmin())
    console.log(`📣 Lista de espera: ${result.sent} aviso(s) en ${result.events} evento(s)${result.failed ? `, ${result.failed} fallidos` : ''}`)
    return new Response(JSON.stringify(result), { status: 200 })
  } catch (error) {
    console.error('Error en send-waitlist-notifications:', error?.message)
    return new Response(JSON.stringify({ error: 'Error interno' }), { status: 500 })
  }
}

export const config = {
  schedule: '7,22,37,52 * * * *', // cada 15 min (a los :07, :22, :37 y :52, para no coincidir con las otras)
}
