// Orquestador de corridas del blog: cada tarea queda en aitickets_blog_runs con su resultado y costo.
//
//   keywords  descubrir y puntuar keywords (Planner + Search Console + autocompletado + IA)   semanal
//   metrics   métricas de Search Console de cada artículo                                     semanal
//   generate  escribir un artículo nuevo                                                       BLOG_POSTS_PER_WEEK
//   refresh   reescribir un artículo que ya rankea entre la 3 y la 30                          semanal
//   auto      lo que toque hoy, en ese orden (lo usa la función programada blog-tick, a diario)
import { blogPostsPerWeek, isSearchConsoleConfigured } from './config.mjs'
import { discoverKeywords } from './keywords.mjs'
import { createCostMeter } from './llm.mjs'
import { generatePost, POSTS_TABLE, refreshPost, syncPostMetrics } from './posts.mjs'

export const RUNS_TABLE = 'aitickets_blog_runs'
export const BLOG_TASKS = ['keywords', 'metrics', 'generate', 'refresh']

const DAY = 86400_000

async function lastRun(supabase, task, statuses = ['ok']) {
  const { data } = await supabase.from(RUNS_TABLE).select('started_at, status').eq('task', task).in('status', statuses).order('started_at', { ascending: false }).limit(1)
  return data?.[0] ? new Date(data[0].started_at).getTime() : 0
}

/** Ejecuta una tarea con su registro en la bitácora. Nunca lanza: el error queda en la fila y en el resultado. */
export async function runBlogTask(supabase, { task, trigger = 'schedule', deadline = Date.now() + 13 * 60_000, ...opts }) {
  if (!BLOG_TASKS.includes(task)) throw new Error(`Tarea desconocida: ${task}`)
  const meter = createCostMeter()
  const { data: run, error } = await supabase.from(RUNS_TABLE).insert({ task, trigger, status: 'running', details: { opts } }).select('id').single()
  if (error) throw new Error(error.message)
  let status = 'ok'
  let details = {}
  let errorText = null
  try {
    if (task === 'keywords') details = await discoverKeywords(supabase, { meter, deadline, topicSlug: opts.topicSlug || null })
    else if (task === 'metrics') details = await syncPostMetrics(supabase)
    else if (task === 'generate') details = await generatePost(supabase, { meter, keywordId: opts.keywordId || null, topicSlug: opts.topicSlug || null, ...(opts.publish != null ? { publish: opts.publish } : {}) })
    else if (task === 'refresh') details = await refreshPost(supabase, { meter, postId: opts.postId || null })
    if (details?.skipped) status = 'skipped'
  } catch (err) {
    status = 'failed'
    errorText = String(err?.message || err).slice(0, 1000)
    console.error(`[blog:${task}]`, err)
  }
  const postId = Number(details?.post_id) || null
  await supabase
    .from(RUNS_TABLE)
    .update({ status, details: { ...details, opts, cost: meter }, error: errorText, post_id: postId, finished_at: new Date().toISOString() })
    .eq('id', run.id)
  return { run_id: Number(run.id), task, status, ...(errorText ? { error: errorText } : {}), details, cost_usd: meter.usd }
}

/** Qué toca hoy (sin ejecutar nada): para la corrida automática y para get_blog_overview. */
export async function plannedTasks(supabase, now = Date.now()) {
  const tasks = []
  if (now - (await lastRun(supabase, 'keywords', ['ok', 'skipped'])) > 6.5 * DAY) tasks.push('keywords')
  if (isSearchConsoleConfigured() && now - (await lastRun(supabase, 'metrics')) > 6.5 * DAY) tasks.push('metrics')

  const perWeek = blogPostsPerWeek()
  if (perWeek > 0) {
    const { count } = await supabase.from(POSTS_TABLE).select('id', { count: 'exact', head: true }).gte('created_at', new Date(now - 7 * DAY).toISOString())
    // Máximo uno al día, repartidos: con 3 por semana, uno cada ~2,3 días
    const lastGenerate = await lastRun(supabase, 'generate', ['ok'])
    const spacing = Math.max(1, 7 / perWeek) * DAY * 0.9
    if ((count || 0) < perWeek && now - lastGenerate > spacing) tasks.push('generate')
  }
  if (isSearchConsoleConfigured() && now - (await lastRun(supabase, 'refresh', ['ok', 'skipped'])) > 6.5 * DAY) tasks.push('refresh')
  return tasks
}

/** Corrida automática: lo que toque hoy, mientras quede tiempo. */
export async function runAutoBlog(supabase, { deadline = Date.now() + 13 * 60_000 } = {}) {
  const tasks = await plannedTasks(supabase)
  const results = []
  for (const task of tasks) {
    // La redacción toma ~3-6 min; no se empieza sin margen
    const needed = task === 'generate' || task === 'refresh' ? 8 * 60_000 : 3 * 60_000
    if (deadline - Date.now() < needed) {
      results.push({ task, status: 'deferred' })
      continue
    }
    results.push(await runBlogTask(supabase, { task, trigger: 'schedule', deadline }))
  }
  return { planned: tasks, results }
}
