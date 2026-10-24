// Background function (hasta 15 min): envía los reportes semanales a productores que falten esta semana
// (netlify/lib/weekly-report-send.mjs). Solo llamadas internas (x-internal-secret): la dispara send-weekly-reports
// los domingos, o una persona del equipo a mano. Body opcional:
//   { organizationId }                      solo esa productora (igual respeta el domingo y no repite)
//   { force: true }                         corre aunque no sea domingo (no repite una semana ya enviada)
//   { organizationId, previewTo: "a@b.cl" } vista previa del reporte de esa productora SOLO a esa dirección,
//                                           cualquier día, sin registrar nada (no bloquea el envío del domingo)
//   { organizationId, dryRun: true }        arma el reporte sin enviar; el resultado queda en el log de la función
// Las background functions responden 202 al instante: el resultado se ve en los logs y en Slack.
import { getSupabaseAdmin, hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { isValidEmail } from '../../lib/mailer.mjs'
import { notifySlack } from '../../lib/slack.mjs'
import { reportWeek, weekLabel, weeklyReportsEnabled } from '../../lib/weekly-report.mjs'
import { runWeeklyReports } from '../../lib/weekly-report-send.mjs'

const MAX_RUN_MS = 13 * 60 * 1000

export default async (req) => {
  if (req.method !== 'POST' || !hasValidInternalSecret(req)) return json({ error: 'No autorizado' }, 401)
  let body = {}
  try {
    body = (await req.json()) || {}
  } catch {
    /* sin body: corrida normal */
  }
  const organizationId = body.organizationId == null ? null : Number(body.organizationId)
  if (organizationId != null && (!Number.isSafeInteger(organizationId) || organizationId <= 0)) return json({ error: 'organizationId inválido' }, 400)
  const previewTo = body.previewTo ? String(body.previewTo).trim().toLowerCase() : null
  if (previewTo && !isValidEmail(previewTo)) return json({ error: 'previewTo inválido' }, 400)
  const dryRun = body.dryRun === true
  if ((previewTo || dryRun) && !organizationId) return json({ error: 'previewTo y dryRun requieren organizationId' }, 400)
  if (!previewTo && !dryRun && !weeklyReportsEnabled()) return json({ skipped: 'disabled' })

  const started = Date.now()
  try {
    const result = await runWeeklyReports(getSupabaseAdmin(), {
      deadline: started + MAX_RUN_MS,
      organizationIds: organizationId ? [organizationId] : null,
      force: body.force === true,
      previewTo,
      dryRun,
    })
    console.log('[send-weekly-reports-background]', JSON.stringify(result))
    if (!previewTo && !dryRun && (result.sent || result.failed || result.pending)) {
      const label = weekLabel(reportWeek(new Date(started)))
      await notifySlack(
        `📊 Reporte semanal a productores (${label}): ${result.sent} productora(s), ${result.emails} correo(s)` +
          `${result.skipped ? `, ${result.skipped} omitida(s)` : ''}` +
          `${result.failed ? `, ⚠️ ${result.failed} con error${result.errors.length ? ` (${result.errors.slice(0, 3).map((e) => `org ${e.organization_id}: ${e.error}`).join('; ')})` : ''}` : ''}` +
          `${result.pending ? `, ${result.pending} pendiente(s) para la próxima hora` : ''}.`
      )
    }
    return json(result)
  } catch (err) {
    console.error('[send-weekly-reports-background] error:', err?.message)
    await notifySlack(`⚠️ El reporte semanal a productores falló: ${String(err?.message || err).slice(0, 300)}`)
    return json({ error: 'weekly_reports_failed' }, 500)
  }
}
