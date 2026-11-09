// Rendimiento del blog: qué artículos y temas funcionan, con datos propios (aitickets_blog_visits: lectores, clics al
// CTA y productores registrados desde el artículo) y de Search Console (impresiones, clics, posición).
//
// Lo usan:
//   - el motor: topicPerformanceMultipliers() ajusta la cuota de cada tema al elegir qué escribir (posts.mjs)
//   - la tarea "metrics" (semanal): performanceDigest() queda en la bitácora y va a Slack (summary.mjs)
//   - el MCP de admin: get_blog_analytics, list_blog_posts y get_blog_post
//
// Valor de un artículo = lectores + 10 × lectores que hicieron clic al CTA + 50 × productores registrados.
// Un clic al CTA pesa más que una lectura y un registro es lo que buscamos; con pocos datos domina el tráfico.

export const VALUE_WEIGHTS = { visitor: 1, cta: 10, signup: 50 }
/** Un artículo entra a comparar temas recién después de esto (antes Google todavía no lo posiciona). */
export const MIN_AGE_DAYS_FOR_PERFORMANCE = 14
/** Un tema necesita al menos estos artículos maduros para que su rendimiento mueva su cuota. */
export const MIN_POSTS_FOR_PERFORMANCE = 2
export const MULTIPLIER_RANGE = [0.6, 1.6]

const DAY = 86400_000
const num = (v) => (v == null ? 0 : Number(v) || 0)
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d

export function postValue(s) {
  return num(s.visitors) * VALUE_WEIGHTS.visitor + num(s.cta_visitors) * VALUE_WEIGHTS.cta + num(s.signups) * VALUE_WEIGHTS.signup
}

export function windowFor(days = 28, now = Date.now()) {
  return { from: new Date(now - days * DAY).toISOString(), to: new Date(now).toISOString(), days }
}

/**
 * Estadísticas por artículo en la ventana, unidas a los datos del artículo (título, tema, Search Console).
 * Tolera que la migración de analítica no esté aplicada: devuelve los artículos con ceros y available = false.
 */
export async function loadPostStats(supabase, { days = 28, now = Date.now() } = {}) {
  const window = windowFor(days, now)
  const [{ data: posts, error: postsError }, stats] = await Promise.all([
    supabase
      .from('aitickets_blog_posts')
      .select('id, slug, title, status, topic_id, primary_keyword, published_at, word_count, gsc_impressions, gsc_clicks, gsc_ctr, gsc_position, gsc_updated_at')
      .in('status', ['published', 'archived', 'draft']),
    supabase.rpc('aitickets_blog_post_stats', { p_from: window.from, p_to: window.to }),
  ])
  if (postsError) throw new Error(postsError.message)
  const byId = new Map((stats?.data || []).map((s) => [Number(s.post_id), s]))
  const rows = (posts || [])
    .filter((p) => p.status === 'published' || byId.has(Number(p.id)))
    .map((p) => {
      const s = byId.get(Number(p.id)) || {}
      const visitors = num(s.visitors)
      const ctaVisitors = num(s.cta_visitors)
      const ageDays = p.published_at ? Math.floor((now - new Date(p.published_at).getTime()) / DAY) : null
      const row = {
        id: Number(p.id),
        slug: p.slug,
        title: p.title,
        status: p.status,
        topic_id: p.topic_id == null ? null : Number(p.topic_id),
        primary_keyword: p.primary_keyword,
        published_at: p.published_at,
        age_days: ageDays,
        views: num(s.views),
        visitors,
        cta_clicks: num(s.cta_clicks),
        cta_visitors: ctaVisitors,
        cta_rate: visitors ? round(ctaVisitors / visitors, 4) : null,
        signups: num(s.signups),
        sources: {
          search: num(s.search_visitors),
          ai: num(s.ai_visitors),
          social: num(s.social_visitors),
          campaign: num(s.campaign_visitors),
          internal: num(s.internal_visitors),
          referral: num(s.referral_visitors),
          direct: num(s.direct_visitors),
        },
        gsc: p.gsc_updated_at
          ? { impressions: num(p.gsc_impressions), clicks: num(p.gsc_clicks), ctr: p.gsc_ctr == null ? null : Number(p.gsc_ctr), position: p.gsc_position == null ? null : Number(p.gsc_position) }
          : null,
      }
      row.value = postValue(row)
      return row
    })
  return { window, available: !stats?.error, error: stats?.error?.message || null, posts: rows }
}

/**
 * Multiplicador de cuota por tema (Map topic_id → 0,6-1,6): valor medio por artículo maduro del tema contra el del
 * blog, en raíz cuadrada para no sobrerreaccionar. Temas sin datos suficientes quedan en 1 (siguen con su peso).
 */
export function topicPerformanceMultipliers(postStats, { minPosts = MIN_POSTS_FOR_PERFORMANCE, minAgeDays = MIN_AGE_DAYS_FOR_PERFORMANCE } = {}) {
  const mature = postStats.filter((p) => p.status === 'published' && p.topic_id != null && (p.age_days ?? 0) >= minAgeDays)
  const out = new Map()
  if (!mature.length) return out
  const overall = mature.reduce((s, p) => s + p.value, 0) / mature.length
  if (!overall) return out
  const byTopic = new Map()
  for (const p of mature) byTopic.set(p.topic_id, [...(byTopic.get(p.topic_id) || []), p])
  const [lo, hi] = MULTIPLIER_RANGE
  for (const [topicId, list] of byTopic) {
    if (list.length < minPosts) continue
    const avg = list.reduce((s, p) => s + p.value, 0) / list.length
    out.set(topicId, round(Math.min(hi, Math.max(lo, Math.sqrt(avg / overall))), 2))
  }
  return out
}

/** Rendimiento agregado por tema. topics: [{id, slug, name, weight, active}]. */
export function topicPerformance(postStats, topics, multipliers = topicPerformanceMultipliers(postStats)) {
  return topics
    .map((t) => {
      const list = postStats.filter((p) => p.topic_id === Number(t.id) && p.status === 'published')
      const visitors = list.reduce((s, p) => s + p.visitors, 0)
      const cta = list.reduce((s, p) => s + p.cta_visitors, 0)
      return {
        slug: t.slug,
        name: t.name,
        weight: t.weight,
        active: t.active,
        posts: list.length,
        visitors,
        cta_visitors: cta,
        cta_rate: visitors ? round(cta / visitors, 4) : null,
        signups: list.reduce((s, p) => s + p.signups, 0),
        gsc_clicks: list.reduce((s, p) => s + (p.gsc?.clicks || 0), 0),
        gsc_impressions: list.reduce((s, p) => s + (p.gsc?.impressions || 0), 0),
        value_per_post: list.length ? round(list.reduce((s, p) => s + p.value, 0) / list.length, 1) : 0,
        quota_multiplier: multipliers.get(Number(t.id)) ?? 1,
      }
    })
    .filter((t) => t.posts > 0)
    .sort((a, b) => b.value_per_post - a.value_per_post)
}

/**
 * Sugerencias concretas a partir de los números (para el MCP y el resumen semanal de Slack). Cada una nombra el
 * artículo y la herramienta para actuar.
 */
export function performanceRecommendations(postStats, topicsPerf = []) {
  const recs = []
  const published = postStats.filter((p) => p.status === 'published')
  for (const p of published) {
    if (p.gsc && p.gsc.impressions >= 200 && p.gsc.ctr != null && p.gsc.ctr < 0.015 && p.gsc.position != null && p.gsc.position <= 15) {
      recs.push({ post_id: p.id, kind: 'low_ctr', message: `"${p.title}": ${p.gsc.impressions} impresiones con CTR ${(p.gsc.ctr * 100).toFixed(1)}% en posición ${p.gsc.position}. Mejora título y meta descripción (update_blog_post) o refréscalo (run_blog_task refresh).` })
    }
    if (p.visitors >= 50 && (p.cta_rate ?? 0) < 0.01) {
      recs.push({ post_id: p.id, kind: 'low_cta', message: `"${p.title}": ${p.visitors} lectores y casi nadie hace clic hacia AI Tickets. Revisa que el cierre conecte con lo que busca el lector (update_blog_post).` })
    }
    if ((p.age_days ?? 0) >= 45 && p.visitors < 5 && (p.gsc?.impressions || 0) < 20) {
      recs.push({ post_id: p.id, kind: 'no_traction', message: `"${p.title}": ${p.age_days} días publicado y sin tráfico. Revisa si la keyword tiene demanda; considera reescribirlo o archivarlo.` })
    }
  }
  const strong = topicsPerf.filter((t) => t.quota_multiplier >= 1.3)
  for (const t of strong) recs.push({ topic: t.slug, kind: 'strong_topic', message: `El tema "${t.name}" rinde ${t.quota_multiplier}× el promedio: ya recibe más cuota; súbele el peso (upsert_blog_topic) si quieres acelerar.` })
  const weak = topicsPerf.filter((t) => t.quota_multiplier <= 0.7)
  for (const t of weak) recs.push({ topic: t.slug, kind: 'weak_topic', message: `El tema "${t.name}" rinde ${t.quota_multiplier}× el promedio: recibe menos cuota; revisa sus semillas o bájale el peso.` })
  return recs.slice(0, 12)
}

function totalsOf(posts) {
  const sum = (k) => posts.reduce((s, p) => s + (p[k] || 0), 0)
  const visitors = sum('visitors')
  const ctaVisitors = sum('cta_visitors')
  const sources = {}
  for (const p of posts) for (const [k, v] of Object.entries(p.sources)) sources[k] = (sources[k] || 0) + v
  return {
    published_posts: posts.filter((p) => p.status === 'published').length,
    views: sum('views'),
    visitors,
    cta_clicks: sum('cta_clicks'),
    cta_visitors: ctaVisitors,
    cta_rate: visitors ? round(ctaVisitors / visitors, 4) : null,
    signups: sum('signups'),
    gsc_clicks: posts.reduce((s, p) => s + (p.gsc?.clicks || 0), 0),
    gsc_impressions: posts.reduce((s, p) => s + (p.gsc?.impressions || 0), 0),
    visitors_by_source: sources,
  }
}

/** Resumen del rendimiento (tarea metrics, get_blog_analytics, Slack). */
export async function performanceDigest(supabase, { days = 28, now = Date.now(), top = 5 } = {}) {
  const stats = await loadPostStats(supabase, { days, now })
  const { data: topics } = await supabase.from('aitickets_blog_topics').select('id, slug, name, weight, active')
  const multipliers = topicPerformanceMultipliers(stats.posts)
  const topicsPerf = topicPerformance(stats.posts, topics || [], multipliers)
  const ranked = [...stats.posts].filter((p) => p.status === 'published').sort((a, b) => b.value - a.value || (b.gsc?.clicks || 0) - (a.gsc?.clicks || 0))
  const brief = (p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    visitors: p.visitors,
    cta_visitors: p.cta_visitors,
    cta_rate: p.cta_rate,
    signups: p.signups,
    gsc_clicks: p.gsc?.clicks ?? null,
    gsc_position: p.gsc?.position ?? null,
    value: p.value,
  })
  return {
    window: stats.window,
    site_analytics: stats.available,
    totals: totalsOf(stats.posts),
    top_posts: ranked.slice(0, top).map(brief),
    topics: topicsPerf,
    recommendations: performanceRecommendations(stats.posts, topicsPerf),
  }
}
