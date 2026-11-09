// Sugerencias del autocompletado de Google para Chile: long-tail que la gente realmente escribe, sin credenciales.
// Es un endpoint público pero no oficial (el mismo del navegador): pocas llamadas, espaciadas, y si falla se sigue
// sin él. BLOG_AUTOCOMPLETE=off lo apaga.
const URL_BASE = 'https://suggestqueries.google.com/complete/search'
const MIN_INTERVAL_MS = 350
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function decode(buffer, contentType) {
  const charset = /charset=([\w-]+)/i.exec(contentType || '')?.[1]?.toLowerCase() || 'utf-8'
  try {
    return new TextDecoder(charset === 'iso-8859-1' ? 'latin1' : charset).decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

/** Sugerencias para una consulta (máx. 10). Nunca lanza: devuelve [] si algo falla. */
export async function suggest(query, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({ client: 'firefox', hl: 'es-419', gl: 'cl', ie: 'utf-8', oe: 'utf-8', q: query })
  try {
    const res = await fetchImpl(`${URL_BASE}?${params}`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const data = JSON.parse(decode(await res.arrayBuffer(), res.headers.get('content-type')))
    return Array.isArray(data?.[1]) ? data[1].map((s) => String(s).trim()).filter(Boolean).slice(0, 10) : []
  } catch {
    return []
  }
}

/**
 * Expande semillas: cada semilla sola y con un espacio al final (Google completa la siguiente palabra). Devuelve
 * [{keyword, seed}] sin repetir, con un tope de llamadas.
 */
export async function expandSeeds(seeds, { maxCalls = 12, fetchImpl = fetch, wait = sleep } = {}) {
  const queries = []
  for (const seed of seeds) queries.push(seed, `${seed} `)
  const out = new Map()
  let calls = 0
  for (const q of queries) {
    if (calls >= maxCalls) break
    if (calls) await wait(MIN_INTERVAL_MS)
    calls++
    for (const s of await suggest(q, { fetchImpl })) {
      const key = s.toLowerCase()
      if (!out.has(key)) out.set(key, { keyword: s, seed: q.trim() })
    }
  }
  return [...out.values()]
}
