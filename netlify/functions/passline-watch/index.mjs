// Función programada diaria (11:00 UTC ≈ 08:00 Chile): solo dispara passline-watch-background.
// Las funciones programadas mueren a los 30 s; el trabajo (búsquedas, Claude, enriquecimiento) corre en la
// background function (hasta 15 min). Se hace `await` del fetch: la background responde 202 al instante.
// Interruptores: LEADS_PASSLINE_ENABLED=true (por defecto apagado) y FIRECRAWL_API_KEY.
// Disparo manual: POST /.netlify/functions/passline-watch-background con header x-internal-secret.
import { functionsOrigin, triggerBackground } from '../../lib/outreach/background.mjs'
import { passlineWatchGate } from '../../lib/leads/passline-watch.mjs'

export default async (req) => {
  const gate = passlineWatchGate()
  if (!gate.ok) {
    console.log('[passline-watch] omitido:', gate.reason)
    return new Response(`skipped: ${gate.reason}`, { status: 200 })
  }
  const result = await triggerBackground(functionsOrigin(req), 'passline-watch-background')
  console.log('[passline-watch]', JSON.stringify(result))
  return Response.json(result)
}

export const config = {
  schedule: '0 11 * * *',
}
