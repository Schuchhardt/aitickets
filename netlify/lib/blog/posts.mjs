// Artículos del blog: elegir qué escribir, generarlo, refrescar los que Google ya muestra y medirlos con Search
// Console. Las llamadas a Claude están en writer.mjs; aquí, la base de datos y las reglas de selección.
import { blogAutopublish, blogModel, isSearchConsoleConfigured } from './config.mjs'
import { gscWindow, searchAnalytics } from './google.mjs'
import { KEYWORDS_TABLE, TOPICS_TABLE } from './keywords.mjs'
import { INTERNAL_PAGES } from './product-facts.mjs'
import { afterBlogChange } from './publish.mjs'
import { loadPostStats, topicPerformanceMultipliers } from './analytics.mjs'
import { MIN_AUTO_SCORE, topicByDeficit } from './scoring.mjs'
import { normalizeKeyword } from './text.mjs'
import { finalizeArticle, planArticle, researchArticle, writeArticle } from './writer.mjs'

export const POSTS_TABLE = 'aitickets_blog_posts'

/** Un artículo recién publicado espera esto antes de refrescarse, y entre refrescos. */
export const REFRESH_MIN_AGE_DAYS = 21
export const REFRESH_EVERY_DAYS = 45
const RECENT_DAYS_FOR_QUOTAS = 90
const daysAgo = (days, now = Date.now()) => new Date(now - days * 86400_000).toISOString()

class SkipError extends Error {}

/** Páginas que el artículo puede enlazar (catálogo fijo + publicados) y las que existen para medir canibalización. */
export async function loadCatalog(supabase) {
  const { data, error } = await supabase
    .from(POSTS_TABLE)
    .select('id, slug, title, status, primary_keyword, secondary_keywords')
    .in('status', ['published', 'draft'])
    .order('id', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)
  const posts = data || []
  const postPages = posts.map((p) => ({ path: `/blog/${p.slug}`, title: p.title, keyword: p.primary_keyword, status: p.status, id: Number(p.id) }))
  return {
    posts,
    linkable: [...INTERNAL_PAGES, ...postPages.filter((p) => p.status === 'published')],
    existing: [...INTERNAL_PAGES, ...postPages],
    publishedPaths: postPages.filter((p) => p.status === 'published').map((p) => p.path),
  }
}

async function loadTopics(supabase) {
  const { data, error } = await supabase.from(TOPICS_TABLE).select('*').order('id')
  if (error) throw new Error(error.message)
  return data || []
}

/**
 * Keyword a escribir: la pedida (keywordId), si no la mejor priorizada a mano (queued), si no la mejor del tema con
 * más déficit de cuota (pesos de aitickets_blog_topics contra los artículos de los últimos 90 días).
 */
export async function pickKeyword(supabase, { keywordId = null, topicSlug = null, exclude = [] } = {}) {
  const topics = await loadTopics(supabase)
  const topicById = new Map(topics.map((t) => [Number(t.id), t]))
  const withTopic = (k) => (k ? { keyword: k, topic: topicById.get(Number(k.topic_id)) || null } : null)

  if (keywordId) {
    const { data } = await supabase.from(KEYWORDS_TABLE).select('*').eq('id', keywordId).maybeSingle()
    if (!data) throw new SkipError(`No existe la keyword ${keywordId}`)
    return withTopic(data)
  }
  const forcedTopic = topicSlug ? topics.find((t) => t.slug === topicSlug) : null
  if (topicSlug && !forcedTopic) throw new SkipError(`No existe el tema ${topicSlug}`)

  const base = () => {
    let q = supabase.from(KEYWORDS_TABLE).select('*')
    if (exclude.length) q = q.not('id', 'in', `(${exclude.join(',')})`)
    if (forcedTopic) q = q.eq('topic_id', forcedTopic.id)
    return q
  }
  const { data: queued } = await base().eq('status', 'queued').order('score', { ascending: false }).limit(1)
  if (queued?.[0]) return withTopic(queued[0])

  // Temas con candidatas que superan el mínimo
  const { data: pool } = await base().eq('status', 'new').gte('score', MIN_AUTO_SCORE).not('topic_id', 'is', null).order('score', { ascending: false }).limit(1000)
  if (!pool?.length) return null
  const bestByTopic = new Map()
  for (const k of pool) if (!bestByTopic.has(Number(k.topic_id))) bestByTopic.set(Number(k.topic_id), k)

  const { data: recent } = await supabase.from(POSTS_TABLE).select('topic_id').gte('created_at', daysAgo(RECENT_DAYS_FOR_QUOTAS)).neq('status', 'archived')
  const counts = new Map()
  for (const p of recent || []) counts.set(Number(p.topic_id), (counts.get(Number(p.topic_id)) || 0) + 1)
  // Los temas que mejor funcionan (lectores, clics al CTA y registros) reciben más cuota (analytics.mjs)
  const multipliers = forcedTopic ? new Map() : await performanceMultipliers(supabase)
  const eligible = topics
    .filter((t) => t.active && bestByTopic.has(Number(t.id)))
    .map((t) => ({ ...t, weight: t.weight * (multipliers.get(Number(t.id)) ?? 1) }))
  const topic = forcedTopic || topicByDeficit(eligible, counts)
  return withTopic(topic ? bestByTopic.get(Number(topic.id)) : pool[0])
}

/** Multiplicador de cuota por tema según su rendimiento. Sin analítica (o si falla) todos quedan en 1. */
async function performanceMultipliers(supabase) {
  try {
    const { posts } = await loadPostStats(supabase, { days: 90 })
    return topicPerformanceMultipliers(posts)
  } catch {
    return new Map()
  }
}

async function markKeywords(supabase, ids, patch) {
  if (!ids.length) return
  const { error } = await supabase.from(KEYWORDS_TABLE).update({ ...patch, updated_at: new Date().toISOString() }).in('id', ids)
  if (error) throw new Error(error.message)
}

/** Keywords candidatas del mismo tema para agrupar en el artículo (misma intención las elige el plan). */
async function topicCandidates(supabase, keyword) {
  if (!keyword.topic_id) return []
  const { data } = await supabase
    .from(KEYWORDS_TABLE)
    .select('id, keyword, normalized')
    .eq('topic_id', keyword.topic_id)
    .in('status', ['new', 'queued'])
    .neq('id', keyword.id)
    .order('score', { ascending: false })
    .limit(30)
  return data || []
}

/**
 * Genera un artículo nuevo. Si la keyword ya está respondida por otra página, la marca y prueba con la siguiente
 * (hasta 3 veces; con keywordId, no prueba otras). Devuelve el resumen para la bitácora.
 */
export async function generatePost(supabase, { meter, keywordId = null, topicSlug = null, publish = blogAutopublish(), model = blogModel() } = {}) {
  const tried = []
  const skipped = []
  for (let attempt = 0; attempt < (keywordId ? 1 : 3); attempt++) {
    let picked
    try {
      picked = await pickKeyword(supabase, { keywordId, topicSlug, exclude: tried })
    } catch (err) {
      if (err instanceof SkipError) return { skipped: err.message }
      throw err
    }
    if (!picked) return { skipped: 'No hay keywords candidatas: corre la tarea keywords o agrega una con upsert_blog_keywords', tried: skipped }
    const { keyword, topic } = picked
    tried.push(Number(keyword.id))
    const catalog = await loadCatalog(supabase)

    // Canibalización exacta: ya es la keyword principal o secundaria de un artículo
    const norm = normalizeKeyword(keyword.keyword)
    const twin = catalog.posts.find((p) => [p.primary_keyword, ...(p.secondary_keywords || [])].some((k) => normalizeKeyword(k) === norm))
    if (twin) {
      await markKeywords(supabase, [Number(keyword.id)], { status: 'used', post_id: twin.id, note: `Ya la trabaja /blog/${twin.slug}` })
      skipped.push({ keyword: keyword.keyword, covered_by: `/blog/${twin.slug}` })
      continue
    }

    const candidates = await topicCandidates(supabase, keyword)
    const plan = await planArticle({ keyword: keyword.keyword, topic, candidates: candidates.map((c) => c.keyword), catalog: catalog.existing, model, meter })
    if (plan.covered_by) {
      const coveringPost = catalog.posts.find((p) => `/blog/${p.slug}` === plan.covered_by)
      await markKeywords(
        supabase,
        [Number(keyword.id)],
        coveringPost
          ? { status: 'used', post_id: coveringPost.id, note: `La responde ${plan.covered_by}` }
          : { status: 'rejected', note: `La responde ${plan.covered_by}` },
      )
      skipped.push({ keyword: keyword.keyword, covered_by: plan.covered_by })
      continue
    }

    const researchResult = await researchArticle({ keyword: keyword.keyword, plan, topic, model, meter })
    const raw = await writeArticle({
      keyword: keyword.keyword,
      secondary: plan.secondary_keywords,
      plan,
      researchResult,
      topic,
      catalog: catalog.linkable,
      model,
      meter,
    })
    const existingSlugs = new Set(catalog.posts.map((p) => p.slug))
    const { ok, issues, article } = finalizeArticle(raw, {
      keyword: keyword.keyword,
      landingPath: topic?.landing_path || '/organizadores',
      internalPaths: catalog.publishedPaths,
      sources: researchResult.sources,
      existingSlugs,
    })
    const now = new Date().toISOString()
    const status = ok && publish ? 'published' : 'draft'
    const { data: post, error } = await supabase
      .from(POSTS_TABLE)
      .insert({
        ...article,
        topic_id: topic?.id ?? null,
        status,
        primary_keyword: keyword.keyword,
        secondary_keywords: article.secondary_keywords.length ? article.secondary_keywords : plan.secondary_keywords,
        quality: { ok, issues },
        generation: {
          model,
          at: now,
          keyword_id: Number(keyword.id),
          plan: { search_intent: plan.search_intent, angle: plan.angle, outline: plan.outline },
          research_sources: researchResult.sources.length,
          cost: meter ? { ...meter } : null,
        },
        published_at: status === 'published' ? now : null,
        content_updated_at: now,
      })
      .select('id, slug, status')
      .single()
    if (error) throw new Error(error.message)

    // La principal y las secundarias que el plan agrupó quedan usadas por este artículo
    const secondaryIds = candidates.filter((c) => plan.secondary_keywords.some((s) => normalizeKeyword(s) === c.normalized)).map((c) => Number(c.id))
    await markKeywords(supabase, [Number(keyword.id), ...secondaryIds], { status: 'used', post_id: post.id, note: null })

    const effects = status === 'published' ? await afterBlogChange([`/blog/${post.slug}`]) : null
    return {
      post_id: Number(post.id),
      slug: post.slug,
      status: post.status,
      title: article.title,
      keyword: keyword.keyword,
      sources: researchResult.sources.length,
      topic: topic?.slug || null,
      words: article.word_count,
      issues,
      ...(skipped.length ? { skipped_keywords: skipped } : {}),
      ...(effects ? { effects } : {}),
    }
  }
  return { skipped: 'Las keywords elegidas ya estaban cubiertas por otras páginas', tried: skipped }
}

// ---------------------------------------------------------------------------------------------------------------
// Métricas de Search Console por artículo

/** "https://aitickets.cl/blog/mi-articulo?x" → "mi-articulo" (o null si no es un artículo). */
export function blogSlugFromUrl(url) {
  try {
    const m = /^\/blog\/([a-z0-9-]+)\/?$/.exec(new URL(url).pathname)
    return m && m[1] !== 'tema' ? m[1] : null
  } catch {
    return null
  }
}

/** Agrupa filas page×query de Search Console por artículo: {slug → {queries:[{query, impressions, clicks, position}]}}. */
export function groupQueriesBySlug(rows, limit = 25) {
  const out = new Map()
  for (const r of rows) {
    const [page, query] = r.keys || []
    const slug = blogSlugFromUrl(page)
    if (!slug || !query) continue
    const list = out.get(slug) || []
    list.push({ query, impressions: r.impressions || 0, clicks: r.clicks || 0, position: Math.round((r.position || 0) * 10) / 10 })
    out.set(slug, list)
  }
  for (const [slug, list] of out) out.set(slug, list.sort((a, b) => b.impressions - a.impressions).slice(0, limit))
  return out
}

/** Corrida "metrics": impresiones, clics, CTR, posición y consultas de los últimos 28 días de cada artículo. */
export async function syncPostMetrics(supabase, { fetchImpl = fetch } = {}) {
  if (!isSearchConsoleConfigured()) return { skipped: 'Search Console sin configurar (GOOGLE_OAUTH_* y GSC_SITE_URL)' }
  const window = gscWindow(28)
  const filters = [{ dimension: 'page', operator: 'contains', expression: '/blog/' }]
  const [pageRows, queryRows] = await Promise.all([
    searchAnalytics({ ...window, dimensions: ['page'], filters, maxRows: 5000, fetchImpl }),
    searchAnalytics({ ...window, dimensions: ['page', 'query'], filters, maxRows: 25000, fetchImpl }),
  ])
  const queriesBySlug = groupQueriesBySlug(queryRows)
  const totals = new Map()
  for (const r of pageRows) {
    const slug = blogSlugFromUrl(r.keys?.[0])
    if (!slug) continue
    const t = totals.get(slug) || { impressions: 0, clicks: 0, posWeighted: 0 }
    t.impressions += r.impressions || 0
    t.clicks += r.clicks || 0
    t.posWeighted += (r.position || 0) * (r.impressions || 0)
    totals.set(slug, t)
  }
  const { data: posts } = await supabase.from(POSTS_TABLE).select('id, slug').eq('status', 'published')
  const now = new Date().toISOString()
  let updated = 0
  for (const post of posts || []) {
    const t = totals.get(post.slug) || { impressions: 0, clicks: 0, posWeighted: 0 }
    const { error } = await supabase
      .from(POSTS_TABLE)
      .update({
        gsc_impressions: t.impressions,
        gsc_clicks: t.clicks,
        gsc_ctr: t.impressions ? Math.round((t.clicks / t.impressions) * 10000) / 10000 : null,
        gsc_position: t.impressions ? Math.round((t.posWeighted / t.impressions) * 100) / 100 : null,
        gsc_queries: queriesBySlug.get(post.slug) || [],
        gsc_updated_at: now,
      })
      .eq('id', post.id)
    if (!error) updated++
  }
  return { window, pages_with_data: totals.size, updated }
}

// ---------------------------------------------------------------------------------------------------------------
// Refresco: reescribir un artículo que Google ya muestra para que suba

/** El candidato a refrescar: publicado hace 21+ días, sin refresco en 45, con impresiones y posición 3-30. */
export async function pickRefreshCandidate(supabase, now = Date.now()) {
  const { data } = await supabase
    .from(POSTS_TABLE)
    .select('*')
    .eq('status', 'published')
    .lte('published_at', daysAgo(REFRESH_MIN_AGE_DAYS, now))
    .or(`refreshed_at.is.null,refreshed_at.lte.${daysAgo(REFRESH_EVERY_DAYS, now)}`)
    .gte('gsc_impressions', 30)
    .gte('gsc_position', 3)
    .lte('gsc_position', 30)
    .order('gsc_impressions', { ascending: false })
    .limit(1)
  return data?.[0] || null
}

export async function refreshPost(supabase, { meter, postId = null, model = blogModel() } = {}) {
  let post = null
  if (postId) {
    const { data } = await supabase.from(POSTS_TABLE).select('*').eq('id', postId).maybeSingle()
    post = data
    if (!post) return { skipped: `No existe el artículo ${postId}` }
    if (post.status !== 'published') return { skipped: 'Solo se refrescan artículos publicados' }
  } else {
    post = await pickRefreshCandidate(supabase)
    if (!post) return { skipped: 'Ningún artículo cumple las condiciones de refresco todavía (21+ días, 30+ impresiones, posición 3-30)' }
  }
  const { data: topic } = post.topic_id ? await supabase.from(TOPICS_TABLE).select('*').eq('id', post.topic_id).maybeSingle() : { data: null }
  const catalog = await loadCatalog(supabase)
  const queries = Array.isArray(post.gsc_queries) ? post.gsc_queries : []
  const researchResult = await researchArticle({
    keyword: post.primary_keyword || post.title,
    plan: null,
    topic,
    model,
    meter,
    maxSearches: 4,
    extra: queries.length ? `Consultas reales que traen este artículo (cubre las que falten):\n${queries.slice(0, 15).map((q) => `- ${q.query}`).join('\n')}` : '',
  })
  const raw = await writeArticle({
    keyword: post.primary_keyword || post.title,
    secondary: post.secondary_keywords || [],
    plan: null,
    researchResult: { notes: researchResult.notes, sources: [...(post.sources || []), ...researchResult.sources] },
    topic,
    catalog: catalog.linkable.filter((p) => p.path !== `/blog/${post.slug}`),
    model,
    meter,
    refresh: {
      title: post.title,
      body_md: post.body_md,
      faq: post.faq,
      queries,
      impressions: post.gsc_impressions,
      clicks: post.gsc_clicks,
      position: post.gsc_position,
      ctr: post.gsc_ctr != null ? Number(post.gsc_ctr) : null,
    },
  })
  const { ok, issues, article } = finalizeArticle(raw, {
    keyword: post.primary_keyword || post.title,
    landingPath: topic?.landing_path || '/organizadores',
    internalPaths: catalog.publishedPaths.filter((p) => p !== `/blog/${post.slug}`),
    sources: [...(post.sources || []).map((s) => ({ url: s.url, title: s.title })), ...researchResult.sources],
    fixedSlug: post.slug,
  })
  const before = { impressions: post.gsc_impressions, clicks: post.gsc_clicks, position: post.gsc_position, ctr: post.gsc_ctr }
  if (!ok) return { post_id: Number(post.id), slug: post.slug, refreshed: false, issues, before }

  const now = new Date().toISOString()
  const history = Array.isArray(post.generation?.refreshes) ? post.generation.refreshes : []
  const { slug: _slug, ...changes } = article
  const { error } = await supabase
    .from(POSTS_TABLE)
    .update({
      ...changes,
      secondary_keywords: [...new Set([...(post.secondary_keywords || []), ...article.secondary_keywords])].slice(0, 12),
      quality: { ok, issues },
      generation: {
        ...(post.generation || {}),
        refreshes: [
          ...history.slice(-9),
          { at: now, model, before: { impressions: post.gsc_impressions, clicks: post.gsc_clicks, position: post.gsc_position, ctr: post.gsc_ctr }, cost: meter ? { ...meter } : null },
        ],
      },
      content_updated_at: now,
      refreshed_at: now,
      refresh_count: (post.refresh_count || 0) + 1,
      updated_at: now,
    })
    .eq('id', post.id)
  if (error) throw new Error(error.message)
  const effects = await afterBlogChange([`/blog/${post.slug}`])
  return { post_id: Number(post.id), slug: post.slug, refreshed: true, words: article.word_count, issues, effects, before }
}
