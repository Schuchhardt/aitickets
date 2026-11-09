// Descubrimiento de keywords (corrida "keywords", semanal): junta candidatas de tres fuentes, las clasifica con IA y
// guarda su puntaje en aitickets_blog_keywords.
//
//   1. Keyword Planner: ideas para las semillas de cada tema activo (volumen mensual y competencia en Chile).
//   2. Search Console: consultas por las que ya aparecemos en Chile (impresiones, clics, posición y la página que
//      rankea), los últimos 28 días. Sin la marca propia.
//   3. Autocompletado de Google: las semillas expandidas (long-tail real) cuando hay pocas ideas o no hay Planner.
//
// Las nuevas se clasifican en lotes (tema, intención, audiencia y relevancia para productores); las conocidas solo
// actualizan métricas y puntaje. Nunca se cambia el estado de una keyword usada o priorizada a mano.
import { blogFastModel, isAutocompleteEnabled, isKeywordPlannerConfigured, isSearchConsoleConfigured } from './config.mjs'
import { expandSeeds } from './autocomplete.mjs'
import { gscWindow, keywordIdeas, searchAnalytics } from './google.mjs'
import { askJson } from './llm.mjs'
import { keywordScore, rejectionReason } from './scoring.mjs'
import { keywordTokens, normalizeKeyword } from './text.mjs'

export const TOPICS_TABLE = 'aitickets_blog_topics'
export const KEYWORDS_TABLE = 'aitickets_blog_keywords'

const BRAND_RE = /\bai\s?tickets?\b|\baitickets\b/
const MAX_NEW_PER_RUN = 400
const CLASSIFY_BATCH = 60
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Keyword usable: 2 a 10 palabras, sin la marca propia, sin URLs ni símbolos raros. */
export function isUsableKeyword(raw) {
  if (/https?:|www\.|[/@#]|\.(com|cl|net|org|io)\b/i.test(String(raw ?? ''))) return false
  const k = normalizeKeyword(raw)
  if (k.length < 6 || k.length > 120 || BRAND_RE.test(k)) return false
  const words = k.split(' ')
  return words.length >= 2 && words.length <= 10 && keywordTokens(k).length >= 1
}

/** Agrega una candidata al mapa (clave normalizada), fusionando fuentes y métricas. */
export function mergeCandidate(map, raw, patch) {
  if (!isUsableKeyword(raw)) return
  const key = normalizeKeyword(raw)
  const prev = map.get(key) || { keyword: String(raw).trim().replace(/\s+/g, ' '), normalized: key, sources: new Set() }
  for (const s of patch.sources || []) prev.sources.add(s)
  for (const [k, v] of Object.entries(patch)) if (k !== 'sources' && v != null) prev[k] = v
  map.set(key, prev)
}

/** Consultas de Search Console agregadas por consulta: impresiones, clics, posición ponderada y la página principal. */
export function aggregateGscQueries(rows) {
  const byQuery = new Map()
  for (const r of rows) {
    const [query, page] = r.keys || []
    if (!query) continue
    const q = byQuery.get(query) || { impressions: 0, clicks: 0, posWeighted: 0, pages: new Map() }
    q.impressions += r.impressions || 0
    q.clicks += r.clicks || 0
    q.posWeighted += (r.position || 0) * (r.impressions || 0)
    if (page) q.pages.set(page, (q.pages.get(page) || 0) + (r.impressions || 0))
    byQuery.set(query, q)
  }
  return [...byQuery.entries()].map(([query, q]) => ({
    query,
    impressions: q.impressions,
    clicks: q.clicks,
    position: q.impressions ? Math.round((q.posWeighted / q.impressions) * 100) / 100 : null,
    page: [...q.pages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
  }))
}

const CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['i', 'topic', 'intent', 'audience', 'relevance'],
        properties: {
          i: { type: 'integer', description: 'Índice de la keyword en la lista.' },
          topic: { type: 'string', description: 'slug del tema, o "none" si no calza con ninguno.' },
          intent: { type: 'string', enum: ['informational', 'commercial', 'transactional', 'navigational'] },
          audience: { type: 'string', enum: ['producer', 'attendee', 'other'] },
          relevance: { type: 'integer', description: '0 a 100' },
        },
      },
    },
  },
}

const CLASSIFY_SYSTEM = [
  'Clasificas búsquedas de Google hechas en Chile para el blog de AI Tickets, una ticketera para productores y organizadores de eventos (stand-up, teatro, música en vivo, clubs, fiestas, seminarios, talleres, academias).',
  'El blog escribe artículos útiles para quien ORGANIZA eventos: producir, difundir, vender entradas, controlar el acceso, cobrar y medir.',
  'Para cada keyword devuelve:',
  '- topic: el slug del tema que mejor calza de la lista, o "none".',
  '- intent: informational (quiere aprender o resolver algo: "cómo…", "cuánto…", "qué es…", ideas, checklist), commercial (compara opciones o plataformas antes de decidir), transactional (quiere contratar o comprar ya: "ticketera para teatro", "comprar entradas…"), navigational (busca una marca, sitio o evento puntual: "passline", "teatro municipal cartelera").',
  '- audience: producer (productor, organizador, artista, sala, academia, RRPP), attendee (público que busca qué ver o compra entradas), other.',
  '- relevance 0-100: qué tan útil sería un artículo para un productor de eventos en Chile y qué tan cerca está de lo que AI Tickets resuelve. 80+ = problema central del productor; 50-79 = útil y relacionado; menos de 40 = tangencial.',
  'Juzga solo por el texto. No inventes keywords nuevas.',
].join('\n')

/** Clasifica keywords en lotes. Devuelve Map(normalized → {topic_id, intent, audience, relevance}). */
export async function classifyKeywords(keywords, topics, { meter, model = blogFastModel() } = {}) {
  const topicBySlug = new Map(topics.map((t) => [t.slug, t]))
  const topicList = topics.map((t) => `- ${t.slug}: ${t.name}. ${t.description || ''}`).join('\n')
  const out = new Map()
  for (let start = 0; start < keywords.length; start += CLASSIFY_BATCH) {
    const batch = keywords.slice(start, start + CLASSIFY_BATCH)
    const result = await askJson({
      system: CLASSIFY_SYSTEM,
      user: `Temas:\n${topicList}\n\nKeywords:\n${batch.map((k, i) => `${i}. ${k.keyword}`).join('\n')}`,
      schema: CLASSIFY_SCHEMA,
      model,
      effort: 'low',
      maxTokens: 16000,
      meter,
    })
    for (const item of result.items || []) {
      const k = batch[item.i]
      if (!k) continue
      const topic = topicBySlug.get(item.topic)
      out.set(k.normalized, {
        topic_id: topic ? Number(topic.id) : null,
        intent: item.intent,
        audience: item.audience,
        relevance: Math.max(0, Math.min(100, Math.round(Number(item.relevance) || 0))),
      })
    }
  }
  return out
}

const COMPETITIONS = ['LOW', 'MEDIUM', 'HIGH', 'UNSPECIFIED', 'UNKNOWN']

/**
 * Fila de upsert de una candidata. Todas las filas llevan las MISMAS columnas: en un upsert en lote, PostgREST deja
 * en null las columnas que falten en alguna fila, así que lo que esta corrida no midió se conserva del valor anterior.
 * La clasificación (cls) solo llega para keywords nuevas; el estado solo cambia si estaba en 'new'.
 */
export function buildKeywordRow(c, prev, cls, now) {
  const pick = (field) => c[field] ?? prev?.[field] ?? null
  const merged = {
    // El tema puesto a mano (upsert_blog_keywords) manda sobre el que sugiere la IA
    topic_id: prev?.topic_id ?? (cls ? cls.topic_id : c.hint_topic_id ?? null),
    intent: cls?.intent ?? prev?.intent ?? null,
    relevance: cls?.relevance ?? prev?.relevance ?? null,
    sources: [...new Set([...(prev?.sources || []), ...c.sources])],
    planner_searches: pick('planner_searches'),
    planner_competition: COMPETITIONS.includes(pick('planner_competition')) ? pick('planner_competition') : null,
    gsc_impressions: pick('gsc_impressions'),
    gsc_position: pick('gsc_position'),
  }
  let status = prev?.status || 'new'
  let note = prev?.note ?? null
  if (cls && status === 'new') {
    note = rejectionReason({ ...merged, audience: cls.audience })
    status = note ? 'rejected' : 'new'
  }
  return {
    keyword: prev?.keyword || c.keyword,
    normalized: c.normalized,
    ...merged,
    planner_competition_index: pick('planner_competition_index'),
    planner_high_bid_micros: pick('planner_high_bid_micros'),
    gsc_clicks: pick('gsc_clicks'),
    gsc_page: pick('gsc_page'),
    score: keywordScore(merged),
    status,
    note,
    classified_at: cls ? now : prev?.classified_at ?? null,
    metrics_at: now,
    updated_at: now,
  }
}

/** Lee todas las keywords existentes (columnas para el merge). */
async function existingKeywords(supabase) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(KEYWORDS_TABLE)
      .select(
        'id, keyword, normalized, status, note, topic_id, intent, relevance, sources, planner_searches, planner_competition, planner_competition_index, ' +
          'planner_high_bid_micros, gsc_impressions, gsc_clicks, gsc_position, gsc_page, classified_at',
      )
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return new Map(rows.map((r) => [r.normalized, r]))
}

/**
 * Corrida completa. Devuelve un resumen para la bitácora.
 * @param {any} supabase
 * @param {{meter?: object, deadline?: number, topicSlug?: string|null, fetchImpl?: typeof fetch}} opts
 */
export async function discoverKeywords(supabase, { meter, deadline = Date.now() + 10 * 60_000, topicSlug = null, fetchImpl = fetch } = {}) {
  const { data: topicRows, error } = await supabase.from(TOPICS_TABLE).select('*').eq('active', true).order('id')
  if (error) throw new Error(error.message)
  const topics = (topicRows || []).filter((t) => !topicSlug || t.slug === topicSlug)
  if (!topics.length) return { skipped: 'sin temas activos' }

  const candidates = new Map()
  const summary = { planner: 0, search_console: 0, autocomplete: 0, errors: [] }
  const timeLeft = () => deadline - Date.now()

  // 1) Keyword Planner
  if (isKeywordPlannerConfigured()) {
    for (const topic of topics) {
      if (timeLeft() < 4 * 60_000) break
      try {
        const ideas = await keywordIdeas(topic.seed_keywords || [], { fetchImpl })
        for (const idea of ideas) {
          mergeCandidate(candidates, idea.keyword, {
            sources: ['planner'],
            hint_topic_id: Number(topic.id),
            planner_searches: idea.searches,
            planner_competition: idea.competition,
            planner_competition_index: idea.competition_index,
            planner_high_bid_micros: idea.high_bid_micros,
          })
        }
        summary.planner += ideas.length
      } catch (err) {
        summary.errors.push(`planner ${topic.slug}: ${err.message}`)
        if (/developer token|PERMISSION_DENIED|UNAUTHENTICATED|invalid_grant/i.test(err.message)) break
      }
      await sleep(1100) // Keyword Planner limita las solicitudes por segundo
    }
  }

  // 2) Search Console (solo Chile, sin la marca)
  if (isSearchConsoleConfigured() && !topicSlug) {
    try {
      const rows = await searchAnalytics({
        ...gscWindow(28),
        dimensions: ['query', 'page'],
        filters: [{ dimension: 'country', operator: 'equals', expression: 'chl' }],
        maxRows: 10000,
        fetchImpl,
      })
      for (const q of aggregateGscQueries(rows)) {
        if (q.impressions < 5) continue
        mergeCandidate(candidates, q.query, {
          sources: ['search_console'],
          gsc_impressions: q.impressions,
          gsc_clicks: q.clicks,
          gsc_position: q.position,
          gsc_page: q.page,
        })
        summary.search_console++
      }
    } catch (err) {
      summary.errors.push(`search console: ${err.message}`)
    }
  }

  // 3) Autocompletado: siempre sin Planner; con Planner, solo para temas con pocas ideas
  if (isAutocompleteEnabled()) {
    for (const topic of topics) {
      if (timeLeft() < 3 * 60_000) break
      const fromPlanner = [...candidates.values()].filter((c) => c.hint_topic_id === Number(topic.id)).length
      if (isKeywordPlannerConfigured() && fromPlanner >= 30) continue
      const suggestions = await expandSeeds(topic.seed_keywords || [], { fetchImpl })
      for (const s of suggestions) mergeCandidate(candidates, s.keyword, { sources: ['autocomplete'], hint_topic_id: Number(topic.id) })
      summary.autocomplete += suggestions.length
    }
  }
  // Las semillas también son candidatas
  for (const topic of topics) for (const seed of topic.seed_keywords || []) mergeCandidate(candidates, seed, { sources: ['seed'], hint_topic_id: Number(topic.id) })

  // Clasificar solo las nuevas (o las que nunca se clasificaron, como las agregadas a mano), con tope por corrida
  const existing = await existingKeywords(supabase)
  for (const row of existing.values()) {
    if (!row.classified_at && (!topicSlug || topics.some((t) => Number(t.id) === Number(row.topic_id)))) {
      mergeCandidate(candidates, row.keyword, { sources: row.sources || [], hint_topic_id: row.topic_id == null ? null : Number(row.topic_id) })
    }
  }
  const toClassify = [...candidates.values()]
    .filter((c) => !existing.get(c.normalized)?.classified_at)
    .sort((a, b) => (b.planner_searches ?? b.gsc_impressions ?? 0) - (a.planner_searches ?? a.gsc_impressions ?? 0))
    .slice(0, MAX_NEW_PER_RUN)
  let classes = new Map()
  if (toClassify.length && timeLeft() > 2 * 60_000) {
    // Todos los temas activos (no solo el filtrado), para que cada keyword caiga en el mejor
    const { data: allTopics } = await supabase.from(TOPICS_TABLE).select('id, slug, name, description').eq('active', true)
    classes = await classifyKeywords(toClassify, allTopics || topics, { meter })
  }

  const now = new Date().toISOString()
  const rows = []
  let rejected = 0
  for (const c of candidates.values()) {
    const prev = existing.get(c.normalized)
    const cls = classes.get(c.normalized)
    if (!prev && !cls) continue // sin clasificar (tope o tiempo): entra en la próxima corrida
    const row = buildKeywordRow(c, prev, cls, now)
    if (cls && row.status === 'rejected' && prev?.status !== 'rejected') rejected++
    rows.push(row)
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error: upsertError } = await supabase.from(KEYWORDS_TABLE).upsert(rows.slice(i, i + 500), { onConflict: 'normalized' })
    if (upsertError) throw new Error(upsertError.message)
  }
  return {
    candidates: candidates.size,
    classified: classes.size,
    saved: rows.length,
    rejected,
    sources: { planner: summary.planner, search_console: summary.search_console, autocomplete: summary.autocomplete },
    ...(summary.errors.length ? { warnings: summary.errors.slice(0, 10) } : {}),
  }
}
