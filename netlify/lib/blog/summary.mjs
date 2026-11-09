// Resumen legible de una corrida del blog (Slack y get_blog_run del MCP de admin). Función pura sobre la fila de
// aitickets_blog_runs (o el resultado de runBlogTask, que tiene la misma forma). Formato mrkdwn de Slack.

const usd = (v) => `US$${(Number(v) || 0).toFixed(Number(v) >= 1 ? 2 : 3)}`
const pct = (v) => (v == null ? '–' : `${(Number(v) * 100).toFixed(1)}%`)
const TASK_LABEL = { keywords: 'Keywords', metrics: 'Métricas y rendimiento', generate: 'Artículo nuevo', refresh: 'Refresco de artículo' }
const TRIGGER_LABEL = { schedule: 'automática', admin: 'desde el MCP de admin', manual: 'manual' }
const STATUS_ICON = { ok: '✅', skipped: '⏭️', failed: '⚠️', running: '⏳', deferred: '⏸️' }

function duration(run) {
  if (!run.started_at || !run.finished_at) return null
  const s = Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`
}

function costLine(cost) {
  if (!cost) return null
  const parts = [usd(cost.usd)]
  if (cost.calls) parts.push(`${cost.calls} ${cost.calls === 1 ? 'llamada' : 'llamadas'} a Claude`)
  if (cost.input_tokens || cost.output_tokens) parts.push(`${Math.round((cost.input_tokens || 0) / 1000)}k tokens de entrada / ${Math.round((cost.output_tokens || 0) / 1000)}k de salida`)
  if (cost.web_searches) parts.push(`${cost.web_searches} ${cost.web_searches === 1 ? 'búsqueda web' : 'búsquedas web'}`)
  return `Costo: ${parts.join(' · ')}`
}

function generateLines(d, { siteUrl, previewUrl }) {
  const lines = []
  if (!d.slug) return lines
  const published = d.status === 'published'
  lines.push(`${published ? 'Publicado' : 'Borrador'}: *${d.title || d.keyword}*`)
  lines.push(`Keyword: "${d.keyword}"${d.topic ? ` · tema ${d.topic}` : ''} · ${d.words} palabras${d.sources != null ? ` · ${d.sources} fuentes` : ''}`)
  lines.push(published ? `${siteUrl}/blog/${d.slug}` : previewUrl ? `Vista previa: ${previewUrl}` : `/blog/${d.slug} (borrador)`)
  const errors = (d.issues || []).filter((i) => i.level === 'error')
  const warns = (d.issues || []).filter((i) => i.level !== 'error')
  if (errors.length) lines.push(`No se publicó solo por: ${errors.map((i) => i.message).join('; ')}`)
  for (const w of warns.slice(0, 3)) lines.push(`Aviso: ${String(w.message).slice(0, 160)}${String(w.message).length > 160 ? '…' : ''}`)
  if (d.skipped_keywords?.length) lines.push(`Saltadas (ya cubiertas): ${d.skipped_keywords.map((k) => `"${k.keyword}" → ${k.covered_by}`).join(', ')}`)
  if (d.effects) lines.push(`Difusión: caché ${d.effects.cache} · sitemap ${d.effects.sitemap} · IndexNow ${d.effects.indexnow}`)
  return lines
}

function keywordsLines(d) {
  const lines = []
  if (d.saved == null) return lines
  const src = d.sources || {}
  lines.push(`${d.candidates ?? d.saved} candidatas (Planner ${src.planner ?? 0} · Search Console ${src.search_console ?? 0} · autocompletado ${src.autocomplete ?? 0})`)
  lines.push(`${d.classified ?? 0} nuevas clasificadas con IA · ${d.rejected ?? 0} descartadas · ${d.saved} guardadas`)
  if (d.top?.length) lines.push(`Mejores pendientes: ${d.top.slice(0, 5).map((k) => `"${k.keyword}" (${k.score})`).join(', ')}`)
  for (const w of (d.warnings || []).slice(0, 3)) lines.push(`Aviso: ${w}`)
  return lines
}

export function digestLines(p, { siteUrl } = {}) {
  if (!p) return []
  const t = p.totals || {}
  const lines = [`*Rendimiento últimos ${p.window?.days ?? 28} días* (${t.published_posts ?? 0} artículos publicados)`]
  lines.push(
    `Lectores ${t.visitors ?? 0} · clics a AI Tickets ${t.cta_visitors ?? 0} (${pct(t.cta_rate)}) · productores registrados ${t.signups ?? 0} · Google: ${t.gsc_clicks ?? 0} clics / ${t.gsc_impressions ?? 0} impresiones`,
  )
  const src = Object.entries(t.visitors_by_source || {}).filter(([, v]) => v > 0)
  if (src.length) lines.push(`Fuentes: ${src.sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  if (!p.site_analytics) lines.push('(Sin analítica propia todavía: falta la migración 202611090300_blog_analytics.sql)')
  if (p.top_posts?.length) {
    lines.push('*Los que mejor funcionan*')
    p.top_posts.forEach((x, i) =>
      lines.push(`${i + 1}. <${siteUrl}/blog/${x.slug}|${x.title}> — ${x.visitors} lectores, ${x.cta_visitors} clics CTA, ${x.signups} registros${x.gsc_position != null ? `, posición ${x.gsc_position}` : ''}`),
    )
  }
  const movers = (p.topics || []).filter((x) => x.quota_multiplier !== 1)
  if (movers.length) lines.push(`Cuota por rendimiento: ${movers.map((x) => `${x.slug} ×${x.quota_multiplier}`).join(' · ')}`)
  for (const r of (p.recommendations || []).slice(0, 4)) lines.push(`→ ${r.message}`)
  return lines
}

function metricsLines(d, opts) {
  const lines = []
  if (d.search_console?.updated != null) lines.push(`Search Console: ${d.search_console.updated} artículos actualizados (${d.search_console.pages_with_data} con datos)`)
  else if (typeof d.search_console === 'string') lines.push(`Search Console: ${d.search_console}`)
  return [...lines, ...digestLines(d.performance, opts)]
}

function refreshLines(d, { siteUrl }) {
  if (!d.slug) return []
  const lines = [`${d.refreshed ? 'Actualizado' : 'No se actualizó'}: ${siteUrl}/blog/${d.slug}${d.words ? ` (${d.words} palabras)` : ''}`]
  if (d.before) lines.push(`Antes: ${d.before.impressions ?? 0} impresiones, ${d.before.clicks ?? 0} clics, posición ${d.before.position ?? '–'}`)
  const errors = (d.issues || []).filter((i) => i.level === 'error')
  if (errors.length) lines.push(`Motivo: ${errors.map((i) => i.message).join('; ')}`)
  return lines
}

/**
 * Texto del resumen de una corrida. run: { run_id|id, task, trigger, status, error, details, started_at, finished_at }
 * (details.cost = medidor de costo). opts: { siteUrl, previewUrl } (previewUrl: link firmado del borrador, si hay).
 * @param {Record<string, any>} run
 * @param {{ siteUrl?: string, previewUrl?: string | null }} [opts]
 */
export function runSummary(run, { siteUrl = 'https://aitickets.cl', previewUrl = null } = {}) {
  const d = run.details || {}
  const id = run.run_id ?? run.id
  const head = [`${STATUS_ICON[run.status] || '•'} *Blog · ${TASK_LABEL[run.task] || run.task}*`, id ? `#${id}` : null, TRIGGER_LABEL[run.trigger] ? `(${TRIGGER_LABEL[run.trigger]})` : null]
  const lines = [head.filter(Boolean).join(' ')]
  if (run.status === 'failed') lines.push(`Error: ${String(run.error || 'desconocido').slice(0, 400)}`)
  if (run.status === 'skipped' || d.skipped) {
    lines.push(`Sin cambios: ${d.skipped || 'nada que hacer'}`)
    if (d.tried?.length) lines.push(`Probadas: ${d.tried.map((k) => `"${k.keyword}" → ${k.covered_by}`).join(', ')}`)
  }
  if (run.status === 'deferred') lines.push('Pospuesta: no quedaba tiempo en esta corrida; va mañana.')
  const opts = { siteUrl, previewUrl }
  if (run.task === 'generate') lines.push(...generateLines(d, opts))
  else if (run.task === 'keywords') lines.push(...keywordsLines(d))
  else if (run.task === 'metrics') lines.push(...metricsLines(d, opts))
  else if (run.task === 'refresh') lines.push(...refreshLines(d, opts))
  const meta = [duration(run) && `Duración: ${duration(run)}`, costLine(d.cost || run.cost)].filter(Boolean)
  if (meta.length) lines.push(meta.join(' · '))
  return lines.join('\n')
}
