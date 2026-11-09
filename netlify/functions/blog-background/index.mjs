// Background function (hasta 15 min) del blog automatizado (netlify/lib/blog/runner.mjs). Solo llamadas internas
// (x-internal-secret): la dispara blog-tick a diario con { task: "auto" } y el MCP de admin (run_blog_task) con una
// tarea puntual. Body:
//   { task: "auto" }                                   lo que toque hoy
//   { task: "keywords", topicSlug? }                   descubrir y puntuar keywords
//   { task: "metrics" }                                métricas de Search Console por artículo
//   { task: "generate", keywordId?, topicSlug?, publish? }  un artículo nuevo (publish=false lo deja en borrador)
//   { task: "refresh", postId? }                       reescribir un artículo que ya rankea
// Responde 202 al instante: el resultado queda en aitickets_blog_runs (get_blog_run / list_blog_runs) y en Slack, con el
// resumen de cada corrida (netlify/lib/blog/summary.mjs).
import { getSupabaseAdmin, hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { notifySlack } from '../../lib/slack.mjs'
import { SITE_URL } from '../../lib/blog/config.mjs'
import { BLOG_TASKS, runAutoBlog, runBlogTask } from '../../lib/blog/runner.mjs'
import { runSummary } from '../../lib/blog/summary.mjs'
import { signBlogPreview } from '../../lib/blog/preview-token.mjs'

const MAX_RUN_MS = 13 * 60 * 1000
const positiveInt = (v) => (v == null ? null : Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined)

/** Resumen de cada corrida para Slack (summary.mjs). Las "skipped" de la corrida automática no avisan (ruido diario). */
function slackSummaries(results, { auto }) {
  return results
    .filter((r) => !(auto && (r.status === 'skipped' || r.status === 'deferred')))
    .map((r) => {
      const d = r.details || {}
      const previewUrl = r.task === 'generate' && d.post_id && d.status !== 'published' ? blogPreviewUrl(d.post_id) : null
      return runSummary(r, { siteUrl: SITE_URL(), previewUrl })
    })
}

function blogPreviewUrl(postId) {
  const t = signBlogPreview(postId)
  return t ? `${SITE_URL()}/blog/vista-previa/${postId}?t=${encodeURIComponent(t)}` : null
}

export default async (req) => {
  if (req.method !== 'POST' || !hasValidInternalSecret(req)) return json({ error: 'No autorizado' }, 401)
  let body = {}
  try {
    body = (await req.json()) || {}
  } catch {
    /* sin body: auto */
  }
  const task = body.task || 'auto'
  if (task !== 'auto' && !BLOG_TASKS.includes(task)) return json({ error: 'task inválida' }, 400)
  const keywordId = positiveInt(body.keywordId)
  const postId = positiveInt(body.postId)
  if (keywordId === undefined || postId === undefined) return json({ error: 'keywordId/postId inválido' }, 400)
  const topicSlug = typeof body.topicSlug === 'string' && /^[a-z0-9-]{1,60}$/.test(body.topicSlug) ? body.topicSlug : null
  const trigger = body.trigger === 'admin' ? 'admin' : body.trigger === 'manual' ? 'manual' : 'schedule'

  const supabase = getSupabaseAdmin()
  const deadline = Date.now() + MAX_RUN_MS
  try {
    const result =
      task === 'auto'
        ? await runAutoBlog(supabase, { deadline })
        : { results: [await runBlogTask(supabase, { task, trigger, deadline, keywordId, postId, topicSlug, ...(typeof body.publish === 'boolean' ? { publish: body.publish } : {}) })] }
    console.log('[blog-background]', JSON.stringify(result))
    // Un mensaje por corrida: Slack corta en 3000 caracteres y así cada resumen queda completo
    for (const text of slackSummaries(result.results || [], { auto: task === 'auto' })) await notifySlack(text)
    return json(result)
  } catch (err) {
    console.error('[blog-background] error:', err?.message)
    await notifySlack(`⚠️ El blog automático falló: ${String(err?.message || err).slice(0, 300)}`)
    return json({ error: 'blog_failed' }, 500)
  }
}
