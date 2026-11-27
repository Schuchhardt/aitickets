// Función programada diaria (12:20 UTC ≈ 09:20 Chile, después de passline-watch): solo dispara market-watch-background.
// Las funciones programadas mueren a los 30 s; el trabajo (búsquedas, Claude, Ticketmaster y el registro) corre en la
// background function (hasta 15 min). Se hace `await` del fetch: la background responde 202 al instante.
// Interruptores: MARKET_WATCH_ENABLED=true (por defecto apagado) y FIRECRAWL_API_KEY y/o TICKETMASTER_API_KEY.
// Disparo manual: POST /.netlify/functions/market-watch-background con header x-internal-secret.
import { functionsOrigin, triggerBackground } from '../../lib/outreach/background.mjs'
import { marketWatchGate } from '../../lib/market/ticketing-watch.mjs'
import { withHeartbeat } from '../../lib/job-heartbeat.mjs'

export default withHeartbeat('market-watch', async (req) => {
  const gate = marketWatchGate()
  if (!gate.ok) {
    console.log('[market-watch] omitido:', gate.reason)
    return new Response(`skipped: ${gate.reason}`, { status: 200 })
  }
  const result = await triggerBackground(functionsOrigin(req), 'market-watch-background')
  console.log('[market-watch]', JSON.stringify(result))
  return Response.json(result)
})

export const config = {
  schedule: '20 12 * * *',
}
