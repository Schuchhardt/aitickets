// Background function (hasta 15 min): arma el reel de respaldo de la difusión automática con ffmpeg
// (netlify/lib/reel-video.mjs) y lo deja en los slots. Solo llamadas internas (x-internal-secret): la dispara el job de
// la serie (src/lib/socialSeries.ts, prepareFallbackReels) con los cuadros ya renderizados en Storage.
// Body: { slotIds: number[], frames: string[], outPath: "social-series-reels/…mp4", musicUrl?: string }
// Responde 202 al instante (background); el resultado queda en los logs y, si falla, en el slot (error) y en Slack.
import { getSupabaseAdmin, hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { notifySlack } from '../../lib/slack.mjs'
import { parseReelJob, runReelJob } from '../../lib/reel-video.mjs'

export default async (req) => {
  if (req.method !== 'POST' || !hasValidInternalSecret(req)) return json({ error: 'No autorizado' }, 401)
  let body = {}
  try {
    body = (await req.json()) || {}
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }
  const job = parseReelJob(body)
  if (job.error) return json({ error: job.error }, 400)
  const supabase = getSupabaseAdmin()
  const started = Date.now()
  try {
    const result = await runReelJob(job, { supabase })
    console.log(`🎬 Reel de respaldo listo (slots ${job.slotIds.join(',')}): ${result.duration} s, ${Math.round(result.bytes / 1024)} KB en ${Math.round((Date.now() - started) / 1000)} s; actualizados ${result.updated.join(',') || 'ninguno'}`)
    return json({ ok: true, ...result })
  } catch (err) {
    const message = String(err?.message || err).slice(0, 400)
    console.error('social-series-reel-background:', message)
    await supabase
      .from('aitickets_social_series_slots')
      .update({ error: `No se pudo armar el reel automático: ${message}`.slice(0, 480), updated_at: new Date().toISOString() })
      .in('id', job.slotIds)
      .eq('status', 'planned')
      .then(() => {}, () => {})
    await notifySlack(`⚠️ *Reel automático fallido* (slots ${job.slotIds.join(', ')}): ${message}`).catch(() => {})
    return json({ error: message }, 500)
  }
}
