// Función programada (cada 30 min, config.schedule abajo): trae de la API de Sentry los issues vistos en las últimas
// 24 h y los guarda en la bandeja de errores (aitickets_error_issues). Respaldo del webhook /api/webhooks/sentry: cubre
// entregas perdidas y mantiene al día conteos y estados. Avisa a Slack los issues nuevos y las regresiones (una vez).
// Sin SENTRY_API_TOKEN o SENTRY_ORG no hace nada (el latido queda con "skipped"). Lógica en netlify/lib/sentry-issues.mjs.
import { getSupabaseAdmin } from '../../lib/supabase.mjs'
import { runSentrySync, sentryConfig } from '../../lib/sentry-issues.mjs'
import { withHeartbeat } from '../../lib/job-heartbeat.mjs'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export default withHeartbeat('sentry-sync', async function handler() {
  const config = sentryConfig()
  if (!config) return json({ skipped: 'falta SENTRY_API_TOKEN o SENTRY_ORG' })
  try {
    const result = await runSentrySync(getSupabaseAdmin(), config)
    console.log('🐞 sentry-sync:', JSON.stringify(result))
    return json(result, result.failed > 0 && result.failed === result.checked ? 500 : 200)
  } catch (error) {
    console.error('Error en sentry-sync:', error?.message)
    return json({ error: error?.message || 'Error interno' }, 500)
  }
})

export const config = {
  schedule: '7,37 * * * *', // cada 30 min (a los :07 y :37, para no coincidir con los otros jobs)
}
