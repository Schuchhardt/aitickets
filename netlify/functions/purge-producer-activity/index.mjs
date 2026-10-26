// Función programada (a diario, config.schedule abajo): borra la bitácora de uso del panel de productores
// (aitickets_producer_activity) con más de 12 meses (docs/runbooks/retencion-de-registros.md). Borra en lotes con la
// RPC aitickets_purge_producer_activity (202610280100_producer_activity.sql) hasta vaciar o llegar al tope.
import { getSupabaseAdmin } from '../../lib/supabase.mjs'

export const KEEP_DAYS = 365
const BATCH = 20000
const MAX_BATCHES = 25

export default async function handler() {
  try {
    const supabase = getSupabaseAdmin()
    let deleted = 0
    for (let i = 0; i < MAX_BATCHES; i++) {
      const { data, error } = await supabase.rpc('aitickets_purge_producer_activity', { p_keep_days: KEEP_DAYS, p_batch: BATCH })
      if (error) {
        // Migración aún no aplicada: nada que borrar
        if (['PGRST202', '42883', '42P01'].includes(String(error.code || ''))) break
        throw error
      }
      deleted += Number(data) || 0
      if (!data || Number(data) < BATCH) break
    }
    if (deleted) console.log(`🧹 Bitácora del panel: ${deleted} fila(s) de más de ${KEEP_DAYS} días borradas`)
    return new Response(JSON.stringify({ deleted }), { status: 200 })
  } catch (error) {
    console.error('Error en purge-producer-activity:', error?.message)
    return new Response(JSON.stringify({ error: 'Error interno' }), { status: 500 })
  }
}

export const config = {
  schedule: '50 7 * * *', // 07:50 UTC (madrugada en Chile), fuera de la hora de los demás procesos
}
