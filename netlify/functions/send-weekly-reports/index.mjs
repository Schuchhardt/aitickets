// Función programada (domingos, cada hora a los :40 de 13 a 22 UTC ≈ 10:40 a 19:40 en Chile en verano, una hora menos
// en invierno; siempre domingo en Chile): solo dispara send-weekly-reports-background, que arma y envía el reporte
// semanal a los productores (las funciones programadas mueren a los 30 s; la background tiene 15 min).
// La primera corrida del domingo envía casi todo; las siguientes retoman lo que faltó o falló (reclamo por semana en
// aitickets_weekly_reports): ningún reporte sale dos veces. WEEKLY_REPORTS_ENABLED=false lo apaga.
// Disparo manual: POST /.netlify/functions/send-weekly-reports-background con header x-internal-secret
// (ver docs/runbooks/reporte-semanal.md).
import { functionsOrigin, triggerBackground } from '../../lib/outreach/background.mjs'
import { weeklyReportsEnabled } from '../../lib/weekly-report.mjs'

export default async (req) => {
  if (!weeklyReportsEnabled()) {
    console.log('[send-weekly-reports] desactivado (WEEKLY_REPORTS_ENABLED=false)')
    return new Response('weekly reports disabled', { status: 200 })
  }
  const result = await triggerBackground(functionsOrigin(req), 'send-weekly-reports-background')
  console.log('[send-weekly-reports]', JSON.stringify(result))
  return Response.json(result)
}

export const config = {
  schedule: '40 13-22 * * 0',
}
