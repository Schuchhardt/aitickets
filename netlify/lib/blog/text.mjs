// Utilidades de texto del blog: normalizar keywords (sin tildes, minúsculas), slugs, conteo de palabras y lectura de
// Markdown (títulos y links). Sin dependencias: las usan las funciones de Netlify, las páginas y los tests.

/** Palabras vacías del español que no cuentan para cubrir una keyword ni van en el slug. */
const STOPWORDS = new Set([
  'a', 'al', 'ante', 'con', 'de', 'del', 'el', 'en', 'la', 'las', 'lo', 'los', 'para', 'por', 'que', 'se', 'sin', 'su',
  'sus', 'un', 'una', 'unos', 'unas', 'y', 'o', 'e', 'mi', 'tu', 'es', 'como', 'cual', 'cuales', 'donde', 'cuando',
])

/** "¿Cómo   organizar un SHOW de stand-up?" → "como organizar un show de stand up". Clave única de una keyword. */
export function normalizeKeyword(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!"'“”‘’.,;:()[\]{}]/g, ' ')
    .replace(/(\S)-(?=\S)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Palabras con significado de una keyword normalizada ("como organizar un show" → ["organizar", "show"]). */
export function keywordTokens(keyword) {
  return normalizeKeyword(keyword)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t))
}

/** Slug URL: sin tildes, minúsculas, guiones, sin palabras vacías, máx. `max` caracteres cortando en palabra. */
export function slugify(value, max = 70) {
  const words = normalizeKeyword(value)
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9 -]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
  const meaningful = words.filter((w) => !STOPWORDS.has(w))
  const parts = meaningful.length >= 2 ? meaningful : words
  let slug = ''
  for (const part of parts) {
    const next = slug ? `${slug}-${part}` : part
    if (next.length > max) break
    slug = next
  }
  return slug || 'articulo'
}

/** Palabras de un texto Markdown (sin URLs ni símbolos de formato). */
export function countWords(markdown) {
  const text = String(markdown ?? '')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#>*_`|[\]-]/g, ' ')
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

/**
 * Proporción (0-1) de las palabras con significado de la keyword que aparecen en el texto. Tolera plural/singular
 * simple (evento/eventos) comparando sin la "s" final.
 */
export function keywordCoverage(keyword, text) {
  const tokens = keywordTokens(keyword)
  if (!tokens.length) return 1
  const stem = (w) => (w.length > 4 ? w.replace(/(es|s)$/, '') : w)
  const haystack = new Set(keywordTokens(text).map(stem))
  const hits = tokens.filter((t) => haystack.has(stem(t))).length
  return hits / tokens.length
}

/** Títulos ## de un Markdown, en orden. */
export function markdownHeadings(markdown, level = 2) {
  const re = new RegExp(`^${'#'.repeat(level)}\\s+(.+?)\\s*#*\\s*$`, 'gm')
  return [...String(markdown ?? '').matchAll(re)].map((m) => m[1].trim())
}

/** Links [texto](url) de un Markdown: [{text, url, index, length}]. */
export function markdownLinks(markdown) {
  return [...String(markdown ?? '').matchAll(/\[([^\]\n]{1,200})\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => ({
    text: m[1],
    url: m[2],
    index: m.index,
    length: m[0].length,
  }))
}

/** Primeras `n` palabras del Markdown sin títulos (para revisar que la keyword aparezca al comienzo). */
export function leadText(markdown, n = 120) {
  const body = String(markdown ?? '')
    .split('\n')
    .filter((line) => !/^#{1,6}\s/.test(line))
    .join(' ')
  return body.split(/\s+/).slice(0, n).join(' ')
}

/** Recorta a `max` caracteres en un límite de palabra, sin dejar puntuación colgando. */
export function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max + 1)
  const atSpace = cut.lastIndexOf(' ')
  return (atSpace > max * 0.6 ? cut.slice(0, atSpace) : text.slice(0, max)).replace(/[\s,;:.\-–—]+$/, '')
}

/** "AI Tickets" y variantes ("AITickets", "aitickets.cl") en un texto. */
export function brandMentions(text) {
  return (String(text ?? '').match(/\bai\s?tickets\b/gi) || []).length
}
