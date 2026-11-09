// Background function (hasta 15 min) del blog automatizado (netlify/lib/blog/runner.mjs). Solo llamadas internas
// (x-internal-secret): la dispara blog-tick a diario con { task: "auto" } y el MCP de admin (run_blog_task) con una
// tarea puntual. Body:
//   { task: "auto" }                                   lo que toque hoy
//   { task: "keywords", topicSlug? }                   descubrir y puntuar keywords
//   { task: "metrics" }                                métricas de Search Console por artículo
//   { task: "generate", keywordId?, topicSlug?, publish? }  un artículo nuevo (publish=false lo deja en borrador)
//   { task: "refresh", postId? }                       reescribir un artículo que ya rankea
// Responde 202 al instante: el resultado queda en aitickets_blog_runs (list_blog_runs) y en Slack.
import { getSupabaseAdmin, hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { notifySlack } from '../../lib/slack.mjs'
import { SITE_URL } from '../../lib/blog/config.mjs'
import { BLOG_TASKS, runAutoBlog, runBlogTask } from '../../lib/blog/runner.mjs'

const MAX_RUN_MS = 13 * 60 * 1000
const positiveInt = (v) => (v == null ? null : Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined)

function slackLine(r) {
  const d = r.details || {}
  if (r.status === 'failed') return `⚠️ blog ${r.task}: ${r.error}`
  if (r.task === 'generate' && d.slug) {
    const issues = (d.issues || []).filter((i) => i.level === 'error').map((i) => i.message)
    return d.status === 'published'
      ? `📝 Blog: nuevo artículo "${d.keyword}" → ${SITE_URL()}/blog/${d.slug} (${d.words} palabras, US$${r.cost_usd})`
      : `📝 Blog: borrador "${d.keyword}" (/blog/${d.slug}) para revisar${issues.length ? `: ${issues.join('; ')}` : ''} (US$${r.cost_usd})`
  }
  if (r.task === 'refresh' && d.refreshed) return `🔁 Blog: artículo actualizado ${SITE_URL()}/blog/${d.slug} (US$${r.cost_usd})`
  if (r.task === 'keywords' && d.saved != null) return `🔎 Blog: ${d.saved} keywords actualizadas (${d.classified} nuevas clasificadas, ${d.rejected} descartadas)${d.warnings ? ` · ⚠️ ${d.warnings[0]}` : ''}`
  return null
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
    const lines = (result.results || []).map(slackLine).filter(Boolean)
    if (lines.length) await notifySlack(lines.join('\n'))
    return json(result)
  } catch (err) {
    console.error('[blog-background] error:', err?.message)
    await notifySlack(`⚠️ El blog automático falló: ${String(err?.message || err).slice(0, 300)}`)
    return json({ error: 'blog_failed' }, 500)
  }
}
