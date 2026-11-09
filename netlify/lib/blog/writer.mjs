// Redacción de un artículo en tres pasos con Claude, más validaciones deterministas:
//
//   1. plan:       ¿ya lo responde una página nuestra? (canibalización) · keywords secundarias de la misma intención ·
//                  ángulo, esquema y preguntas reales.
//   2. research:   búsqueda web desde Chile: datos, normas y cifras con su URL (fuentes del artículo).
//   3. write:      el artículo en Markdown con reglas editoriales: primero informa (≈90%) y solo al cierre presenta
//                  AI Tickets con hechos de PRODUCT_FACTS. También reescribe un artículo existente (refresh).
//   4. finalize:   (sin IA) limpia links no permitidos, corrige títulos, mide y decide si se puede publicar.
import { PRODUCT_FACTS, isInternalPath } from './product-facts.mjs'
import { askJson, isCitableSource, research } from './llm.mjs'
import { brandMentions, clip, countWords, keywordCoverage, leadText, markdownHeadings, markdownLinks, slugify } from './text.mjs'

const today = () => new Date().toISOString().slice(0, 10)
const catalogText = (catalog) => catalog.map((p) => `- ${p.path} — ${p.title}${p.keyword ? ` (keyword: ${p.keyword})` : ''}`).join('\n')

// ---------------------------------------------------------------------------------------------------------------
// 1. Plan

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['covered_by', 'secondary_keywords', 'search_intent', 'angle', 'working_title', 'outline', 'questions', 'research_queries'],
  properties: {
    covered_by: { type: 'string', description: 'Ruta exacta de una página de la lista que YA responde esta búsqueda, o "" si ninguna.' },
    secondary_keywords: { type: 'array', items: { type: 'string' }, description: 'Candidatas con la MISMA intención de búsqueda (máx. 6), copiadas tal cual.' },
    search_intent: { type: 'string', description: 'Qué quiere resolver quien busca esto, en una frase.' },
    angle: { type: 'string', description: 'Qué hará este artículo mejor que lo que ya existe.' },
    working_title: { type: 'string' },
    outline: { type: 'array', items: { type: 'string' }, description: 'Secciones ## propuestas, en orden.' },
    questions: { type: 'array', items: { type: 'string' }, description: 'Preguntas reales que hace la gente sobre esto (3 a 6).' },
    research_queries: { type: 'array', items: { type: 'string' }, description: '3 a 5 búsquedas web para investigar.' },
  },
}

const PLAN_SYSTEM = [
  'Eres el editor SEO del blog de AI Tickets, una ticketera chilena para productores y organizadores de eventos.',
  'Recibes una búsqueda principal, búsquedas candidatas del mismo tema y la lista de páginas que ya existen en el sitio.',
  '- covered_by: si una página existente ya responde ESA MISMA intención de búsqueda (aunque con otras palabras), devuelve su ruta exacta: escribir otro artículo competiría con ella. Si solo toca el tema de pasada o es una página comercial y la búsqueda es informativa, devuelve "".',
  '- secondary_keywords: de las candidatas, solo las que un mismo artículo respondería por completo (misma intención). No incluyas variantes que merezcan su propio artículo.',
  '- Piensa en productores de eventos en Chile: qué necesitan saber para decidir y ejecutar.',
].join('\n')

export async function planArticle({ keyword, topic, candidates, catalog, model, meter }) {
  const plan = await askJson({
    system: PLAN_SYSTEM,
    user: [
      `Fecha de hoy: ${today()}`,
      `Tema: ${topic?.name || 'general'}${topic?.description ? ` — ${topic.description}` : ''}`,
      `Búsqueda principal: "${keyword}"`,
      `Candidatas del mismo tema:\n${candidates.map((c) => `- ${c}`).join('\n') || '(ninguna)'}`,
      `Páginas que ya existen:\n${catalogText(catalog)}`,
    ].join('\n\n'),
    schema: PLAN_SCHEMA,
    model,
    effort: 'low',
    maxTokens: 16000,
    meter,
  })
  const allowed = new Set(candidates.map((c) => c.toLowerCase()))
  return {
    ...plan,
    covered_by: catalog.some((p) => p.path === plan.covered_by) ? plan.covered_by : '',
    secondary_keywords: (plan.secondary_keywords || []).filter((k) => allowed.has(String(k).toLowerCase())).slice(0, 6),
    outline: (plan.outline || []).slice(0, 10),
    questions: (plan.questions || []).slice(0, 6),
    research_queries: (plan.research_queries || []).slice(0, 5),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Investigación

const RESEARCH_SYSTEM = [
  'Investigas en la web para un artículo del blog de AI Tickets dirigido a productores y organizadores de eventos en Chile.',
  'Busca información actual y verificable: datos, cifras, normas chilenas (SII, municipalidades, Ley del Consumidor, SERNAC), plazos, costos de referencia, buenas prácticas y ejemplos. Prefiere fuentes oficiales, medios reconocidos y especialistas; evita foros y sitios de otras ticketeras.',
  'Revisa también qué cubren los primeros resultados para la búsqueda principal y qué les falta.',
  'Responde con notas en Markdown: una viñeta por hecho, con la URL exacta de su fuente al final entre paréntesis. Después, una sección "Qué cubren los primeros resultados" y otra "Vacíos que podemos llenar". No redactes el artículo.',
].join('\n')

export async function researchArticle({ keyword, plan, topic, model, meter, maxSearches = 6, extra = '' }) {
  return research({
    system: RESEARCH_SYSTEM,
    user: [
      `Fecha de hoy: ${today()}`,
      `Búsqueda principal: "${keyword}"`,
      topic ? `Tema del blog: ${topic.name}` : '',
      plan?.search_intent ? `Intención: ${plan.search_intent}` : '',
      plan?.outline?.length ? `Esquema tentativo:\n${plan.outline.map((h) => `- ${h}`).join('\n')}` : '',
      plan?.research_queries?.length ? `Búsquedas sugeridas:\n${plan.research_queries.map((q) => `- ${q}`).join('\n')}` : '',
      extra,
    ]
      .filter(Boolean)
      .join('\n\n'),
    model,
    maxSearches,
    meter,
  })
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Redacción

const ARTICLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'meta_title', 'meta_description', 'slug', 'excerpt', 'body_markdown', 'faq', 'secondary_keywords_used'],
  properties: {
    title: { type: 'string' },
    meta_title: { type: 'string' },
    meta_description: { type: 'string' },
    slug: { type: 'string' },
    excerpt: { type: 'string' },
    body_markdown: { type: 'string' },
    faq: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['question', 'answer'], properties: { question: { type: 'string' }, answer: { type: 'string' } } },
    },
    secondary_keywords_used: { type: 'array', items: { type: 'string' } },
  },
}

export const MAX_BRAND_MENTIONS = 3
export const CLOSING_HEADING = 'Cómo hacerlo con AI Tickets'

export const WRITER_SYSTEM = [
  'Eres el editor del blog de AI Tickets, una ticketera chilena para productores y organizadores de eventos. Escribes en español de Chile, tuteando, con tono cercano, claro y profesional, para quienes organizan eventos: productores independientes, salas, clubs, academias, comediantes, bandas, organizadores de seminarios y talleres.',
  'Objetivo: que el artículo sea la respuesta más útil que existe en internet para la búsqueda principal. Primero entregas valor e informas; solo al final presentas AI Tickets, breve y sin presión.',
  '',
  'Estructura:',
  '- No escribas el título como H1 (va aparte). Usa ## para las secciones (5 a 9) y ### para subsecciones.',
  '- Primer párrafo: responde directo la búsqueda en 2 o 3 frases (40 a 60 palabras) e incluye la keyword principal de forma natural.',
  '- Desarrollo: pasos concretos, ejemplos con montos en pesos chilenos cuando aplique, listas de chequeo, errores comunes y tablas Markdown cuando ordenen la información. Contexto chileno (SII, municipalidades, Ley del Consumidor, medios de pago locales) solo si lo respalda la investigación.',
  '- La keyword principal va en el primer párrafo y en al menos un ##; las secundarias donde calcen naturalmente. Nunca fuerces keywords.',
  '- Párrafos cortos (2 a 4 frases). Entre 1.300 y 2.200 palabras de cuerpo, sin relleno.',
  '- Enlaces internos: 2 a 4 a páginas de la lista "Páginas propias", con la ruta exacta y texto ancla descriptivo (nunca "aquí").',
  '- Fuentes: toda cifra, ley, plazo, porcentaje o dato externo sale de la investigación y lleva su enlace en el texto [descripción](URL exacta de la investigación). Si un dato no está en la investigación, no lo uses o dilo en general. Nunca inventes estudios, estadísticas, testimonios, citas, precios de terceros ni casos de clientes.',
  '- No nombres ni enlaces a otras ticketeras o plataformas de venta de entradas, y no hables mal de nadie.',
  '',
  'AI Tickets:',
  '- En el cuerpo, como máximo UNA mención natural donde una función de la plataforma resuelve justo el paso que explicas (es opcional).',
  `- Cierra con la sección "## ${CLOSING_HEADING}" de máximo 110 palabras: un párrafo y, si ayuda, 2 o 3 viñetas, solo con hechos de "Lo que AI Tickets hace hoy" conectados con el tema, y un enlace a la página indicada. Sin superlativos ("la mejor", "líder") ni urgencia falsa.`,
  `- Fuera de eso no menciones AI Tickets: máximo ${MAX_BRAND_MENTIONS} menciones de la marca en todo el cuerpo.`,
  '',
  'Preguntas frecuentes (campo faq, NO dentro del cuerpo): 3 a 5 preguntas que la gente realmente hace (usa las del plan), respuestas de 40 a 80 palabras en texto plano que no repitan párrafos del cuerpo.',
  '',
  'Metadatos:',
  '- title: titular de la página, máximo 70 caracteres, con la keyword principal cerca del inicio, específico y honesto (sin clickbait).',
  '- meta_title: título para Google, máximo 60 caracteres, con la keyword principal.',
  '- meta_description: 140 a 155 caracteres: qué resuelve el artículo, con la keyword, sin comillas.',
  '- slug: 3 a 6 palabras de la búsqueda principal, minúsculas con guiones, sin tildes ni años.',
  '- excerpt: 1 o 2 frases para la tarjeta del artículo.',
  '- secondary_keywords_used: las keywords secundarias que de verdad cubriste.',
].join('\n')

const REFRESH_RULES = [
  'Estás ACTUALIZANDO un artículo ya publicado que Google muestra pero que puede rankear mejor. Conserva lo que funciona y su estructura general; corrige lo desactualizado según la investigación nueva.',
  'Cubre de verdad las consultas de Search Console que aún no responde (agrega o amplía secciones ## / ### o preguntas frecuentes), sin desviarte de la intención principal.',
  'Si el CTR es bajo para su posición, mejora title, meta_title y meta_description para que prometan con precisión lo que el artículo entrega.',
  'Devuelve el artículo COMPLETO (no solo los cambios). El slug no cambia.',
].join('\n')

export async function writeArticle({ keyword, secondary = [], plan, researchResult, topic, catalog, model, meter, refresh = null }) {
  const landing = topic?.landing_path || '/organizadores'
  const user = [
    `Fecha de hoy: ${today()}`,
    `Búsqueda principal: "${keyword}"`,
    secondary.length ? `Keywords secundarias: ${secondary.map((k) => `"${k}"`).join(', ')}` : '',
    topic ? `Tema: ${topic.name}. Página de AI Tickets para el cierre: ${landing}` : `Página de AI Tickets para el cierre: ${landing}`,
    plan
      ? `Plan:\n- Intención: ${plan.search_intent}\n- Ángulo: ${plan.angle}\n- Título tentativo: ${plan.working_title}\n- Esquema:\n${(plan.outline || []).map((h) => `  - ${h}`).join('\n')}\n- Preguntas reales:\n${(plan.questions || []).map((q) => `  - ${q}`).join('\n')}`
      : '',
    `Investigación (las únicas fuentes que puedes citar):\n${researchResult?.notes || '(sin investigación)'}\n\nURLs disponibles:\n${(researchResult?.sources || []).map((s) => `- ${s.url} — ${s.title}`).join('\n') || '(ninguna)'}`,
    `Páginas propias (enlaces internos permitidos):\n${catalogText(catalog)}`,
    `Lo que AI Tickets hace hoy (lo único que puedes afirmar de la plataforma):\n${PRODUCT_FACTS.map((f) => `- ${f}`).join('\n')}`,
    refresh
      ? `${REFRESH_RULES}\n\nMétricas de Search Console (28 días): ${refresh.impressions ?? 0} impresiones, ${refresh.clicks ?? 0} clics, posición media ${refresh.position ?? '—'}, CTR ${refresh.ctr != null ? `${(refresh.ctr * 100).toFixed(1)}%` : '—'}.\nConsultas que traen el artículo:\n${(refresh.queries || []).map((q) => `- "${q.query}" · ${q.impressions} impr. · pos. ${q.position}`).join('\n') || '(sin datos)'}\n\nArtículo actual:\n# ${refresh.title}\n\n${refresh.body_md}\n\nPreguntas frecuentes actuales:\n${(refresh.faq || []).map((f) => `- ${f.question}: ${f.answer}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  return askJson({ system: WRITER_SYSTEM, user, schema: ARTICLE_SCHEMA, model, effort: 'medium', maxTokens: 64000, meter })
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Validación y limpieza (sin IA)

const OWN_HOSTS = new Set(['aitickets.cl', 'www.aitickets.cl'])

const sameUrl = (a, b) => {
  const norm = (u) => {
    try {
      const x = new URL(u)
      return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}${x.search}`
    } catch {
      return u
    }
  }
  return norm(a) === norm(b)
}

/**
 * Limpia el Markdown del modelo: H1 → H2, links internos fuera del catálogo o externos que no salieron de la
 * investigación quedan como texto. Devuelve { body, stripped: [url], cited: [url] }.
 */
export function sanitizeArticleLinks(markdown, { internalPaths = [], sourceUrls = [] } = {}) {
  let body = String(markdown ?? '').replace(/^#\s+/gm, '## ')
  const stripped = []
  const cited = []
  const links = markdownLinks(body)
  for (const link of links.reverse()) {
    let keep = null
    const url = link.url.trim()
    if (url.startsWith('/')) {
      if (isInternalPath(url, internalPaths)) keep = url
    } else if (/^https?:\/\//i.test(url)) {
      const host = (() => {
        try {
          return new URL(url).hostname.toLowerCase()
        } catch {
          return ''
        }
      })()
      if (OWN_HOSTS.has(host)) {
        const path = new URL(url).pathname
        if (isInternalPath(path, internalPaths)) keep = path
      } else {
        const source = sourceUrls.find((s) => sameUrl(s, url))
        if (source && isCitableSource(source)) {
          keep = source
          if (!cited.includes(source)) cited.unshift(source)
        }
      }
    }
    const replacement = keep ? `[${link.text}](${keep})` : link.text
    if (!keep) stripped.push(url)
    body = body.slice(0, link.index) + replacement + body.slice(link.index + link.length)
  }
  return { body, stripped: stripped.reverse(), cited }
}

const plain = (text) => String(text ?? '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Normaliza la salida del modelo y la evalúa. Errores = no se publica sola (queda en borrador con el detalle).
 * @returns {{ ok: boolean, article: object, issues: {level: 'error'|'warn', code: string, message: string}[] }}
 */
export function finalizeArticle(raw, { keyword, landingPath, internalPaths = [], sources = [], existingSlugs = new Set(), fixedSlug = null }) {
  const issues = []
  const error = (code, message) => issues.push({ level: 'error', code, message })
  const warn = (code, message) => issues.push({ level: 'warn', code, message })

  sources = [...new Map(sources.filter((s) => s?.url).map((s) => [s.url, s])).values()]
  const sourceUrls = sources.map((s) => s.url)
  const { body, stripped, cited } = sanitizeArticleLinks(String(raw?.body_markdown ?? '').trim(), { internalPaths, sourceUrls })
  const title = clip(plain(raw?.title), 110)
  const metaTitle = clip(plain(raw?.meta_title || raw?.title), 65)
  const description = clip(plain(raw?.meta_description), 160)
  const excerpt = clip(plain(raw?.excerpt || raw?.meta_description), 300)
  const faq = (Array.isArray(raw?.faq) ? raw.faq : [])
    .map((f) => ({ question: clip(plain(f?.question), 200), answer: clip(plain(f?.answer), 900) }))
    .filter((f) => f.question && f.answer)
    .slice(0, 6)

  let slug = fixedSlug
  if (!slug) {
    const base = slugify(raw?.slug || keyword, 70)
    slug = base
    for (let n = 2; existingSlugs.has(slug) && n < 50; n++) slug = `${base}-${n}`
  }

  const words = countWords(body)
  const h2 = markdownHeadings(body, 2)
  const brand = brandMentions(body)
  const internalLinks = markdownLinks(body).filter((l) => l.url.startsWith('/'))

  if (words < 800) error('too_short', `El cuerpo tiene ${words} palabras (mínimo 800)`)
  else if (words > 3800) warn('too_long', `El cuerpo tiene ${words} palabras`)
  if (h2.length < 3) error('structure', `Solo ${h2.length} secciones ## (mínimo 3)`)
  if (title.length < 10) error('title', 'Falta el título')
  if (description.length < 50) error('description', 'Falta la meta descripción')
  if (brand > MAX_BRAND_MENTIONS + 1) error('promotional', `Menciona AI Tickets ${brand} veces (máximo ${MAX_BRAND_MENTIONS})`)
  if (keyword && keywordCoverage(keyword, `${title} ${metaTitle}`) < 0.5) error('keyword_title', `El título no trabaja la búsqueda "${keyword}"`)
  if (keyword && keywordCoverage(keyword, leadText(body, 120)) < 0.5) warn('keyword_lead', 'La búsqueda principal no aparece al comienzo')
  if (!h2.some((h) => /ai\s?tickets/i.test(h))) warn('closing', `Falta la sección de cierre "${CLOSING_HEADING}"`)
  if (landingPath && !internalLinks.some((l) => l.url.split(/[?#]/)[0] === landingPath)) warn('landing_link', `No enlaza a ${landingPath}`)
  if (internalLinks.length < 2) warn('internal_links', `Solo ${internalLinks.length} enlaces internos`)
  if (faq.length < 3) warn('faq', `Solo ${faq.length} preguntas frecuentes`)
  if (stripped.length) warn('links_removed', `Se quitaron ${stripped.length} enlaces no permitidos: ${stripped.slice(0, 5).join(', ')}`)
  if (metaTitle.length > 60) warn('meta_title_length', `Meta título de ${metaTitle.length} caracteres`)

  // Fuentes: las citadas en el texto primero; luego las consultadas, hasta 8
  const sourceList = [
    ...cited.map((url) => ({ url, title: sources.find((s) => s.url === url)?.title || url, cited: true })),
    ...sources.filter((s) => !cited.includes(s.url)).map((s) => ({ url: s.url, title: s.title, cited: false })),
  ].slice(0, Math.max(cited.length, 8))

  return {
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    article: {
      slug,
      title,
      meta_title: metaTitle,
      description,
      excerpt,
      body_md: body,
      faq,
      sources: sourceList,
      word_count: words,
      secondary_keywords: (raw?.secondary_keywords_used || []).map((k) => clip(k, 120)).filter(Boolean).slice(0, 8),
    },
  }
}
