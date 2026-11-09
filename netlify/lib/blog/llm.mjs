// Llamadas a Claude del blog: JSON con esquema (planificar, redactar, clasificar) e investigación con búsqueda web.
//
// - Streaming + finalMessage(): los artículos son largos y así no hay timeout HTTP.
// - Fallback del servidor ("default") en los modelos que lo aceptan: si el modelo declina, otro termina la respuesta.
// - Búsqueda web (web_search_20250305: la 20260209 usa code execution, que la org HIPAA no permite) con ubicación Santiago de Chile y passline.com bloqueado (regla dura del
//   repo: nunca se visita; ver netlify/lib/outreach/domains.mjs).
// - Medidor de costo: tokens y búsquedas de cada corrida, en USD estimados (queda en aitickets_blog_runs.details).
import Anthropic from '@anthropic-ai/sdk'
import { NEVER_FETCH_HOSTS, ticketingPlatformOf } from '../outreach/domains.mjs'

export class BlogAiError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BlogAiError'
  }
}

/** USD por millón de tokens [entrada, salida]. Solo para estimar; la factura real está en la consola de Anthropic. */
const PRICES = {
  'claude-fable-5-1': [10, 50],
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
}
const WEB_SEARCH_USD = 0.01

export function createCostMeter() {
  return { calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, web_searches: 0, usd: 0 }
}

export function addUsage(meter, model, usage) {
  if (!meter || !usage) return
  const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
  const cacheRead = usage.cache_read_input_tokens || 0
  const output = usage.output_tokens || 0
  const searches = usage.server_tool_use?.web_search_requests || 0
  meter.calls++
  meter.input_tokens += input
  meter.cache_read_tokens += cacheRead
  meter.output_tokens += output
  meter.web_searches += searches
  const price = PRICES[String(model || '').replace(/-\d{8}$/, '')]
  if (price) meter.usd += (input * price[0] + cacheRead * price[0] * 0.1 + output * price[1]) / 1e6
  meter.usd += searches * WEB_SEARCH_USD
  meter.usd = Math.round(meter.usd * 10000) / 10000
}

/** Fallback del servidor solo donde existe (Opus 5.x, Fable 5.x, Sonnet 5.5 en la API de Claude). */
const fallbackParams = (model) =>
  /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}

let client = null
function anthropic() {
  if (!client) {
    const apiKey = globalThis.process?.env?.ANTHROPIC_API_KEY
    if (!apiKey) throw new BlogAiError('Falta ANTHROPIC_API_KEY')
    client = new Anthropic({ apiKey, timeout: 10 * 60 * 1000, maxRetries: 2 })
  }
  return client
}

/** Para los tests: inyecta un cliente falso (o null para volver al real). */
export function _setAnthropicClient(fake) {
  client = fake
}

function assertUsable(message) {
  if (message.stop_reason === 'refusal') throw new BlogAiError('La IA declinó generar este contenido')
  if (message.stop_reason === 'max_tokens') throw new BlogAiError('La respuesta de la IA quedó cortada (max_tokens)')
}

const textOf = (message) =>
  message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

/** Respuesta JSON validada contra `schema` (structured outputs). */
export async function askJson({ system, user, schema, model, effort = 'low', maxTokens = 32000, meter }) {
  const message = await anthropic()
    .beta.messages.stream({
      model,
      max_tokens: maxTokens,
      output_config: { effort, format: { type: 'json_schema', schema } },
      ...fallbackParams(model),
      system,
      messages: [{ role: 'user', content: user }],
    })
    .finalMessage()
  addUsage(meter, message.model || model, message.usage)
  assertUsable(message)
  try {
    return JSON.parse(textOf(message))
  } catch {
    throw new BlogAiError('La IA devolvió un JSON inválido')
  }
}

/** Fuente usable en un artículo: https, sin ticketeras de la competencia ni hosts que nunca se visitan. */
export function isCitableSource(url) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const platform = ticketingPlatformOf(u.href)
    if (platform && platform !== 'aitickets') return false
    return !NEVER_FETCH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

/**
 * Investigación con búsqueda web. Devuelve { notes, sources: [{url, title}] } con las fuentes citadas primero.
 * Retoma los turnos en pausa (pause_turn) hasta 4 veces.
 */
export async function research({ system, user, model, maxSearches = 6, effort = 'low', meter }) {
  const tools = [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: maxSearches,
      blocked_domains: NEVER_FETCH_HOSTS,
      user_location: { type: 'approximate', city: 'Santiago', region: 'Región Metropolitana', country: 'CL', timezone: 'America/Santiago' },
    },
  ]
  const messages = [{ role: 'user', content: user }]
  const cited = new Map()
  const found = new Map()
  const notes = []
  for (let turn = 0; turn < 5; turn++) {
    const message = await anthropic()
      .beta.messages.stream({ model, max_tokens: 16000, output_config: { effort }, ...fallbackParams(model), system, tools, messages })
      .finalMessage()
    addUsage(meter, message.model || model, message.usage)
    if (message.stop_reason === 'refusal') throw new BlogAiError('La IA declinó investigar este tema')
    for (const block of message.content) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) if (r?.type === 'web_search_result' && r.url && !found.has(r.url)) found.set(r.url, r.title || r.url)
      } else if (block.type === 'text') {
        notes.push(block.text)
        for (const c of block.citations || []) if (c?.url && !cited.has(c.url)) cited.set(c.url, c.title || c.url)
      }
    }
    if (message.stop_reason !== 'pause_turn') break
    messages.push({ role: 'assistant', content: message.content })
  }
  const inNotes = new Set([...notes.join('\n').matchAll(/https?:\/\/[^\s)\]>"']+/g)].map((m) => m[0].replace(/[.,;]+$/, '')))
  const ordered = [
    ...cited.entries(),
    ...[...found.entries()].filter(([url]) => inNotes.has(url) && !cited.has(url)),
    ...[...found.entries()].filter(([url]) => !inNotes.has(url) && !cited.has(url)),
  ]
  const sources = ordered.filter(([url]) => isCitableSource(url)).slice(0, 15).map(([url, title]) => ({ url, title: String(title).slice(0, 200) }))
  return { notes: notes.join('').trim(), sources }
}
