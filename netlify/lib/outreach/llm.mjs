// Llamadas a Claude del outreach con salida JSON estructurada y topes de tokens por corrida y por día.
// Nunca corre con OUTREACH_ENABLED=false. Sin ANTHROPIC_API_KEY devuelve null (el llamador degrada).
import Anthropic from '@anthropic-ai/sdk'

import { getOutreachConfig } from './config.mjs'
import { bumpCounter, counterKeys, readCounter } from './guardrails.mjs'

let client = null
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 })
  return client
}

/** Presupuesto de tokens para una corrida (se pasa entre llamadas de la misma función background). */
export function createRunBudget(cfg = getOutreachConfig()) {
  return { limit: cfg.llmTokensPerRun, used: 0, calls: 0, exhausted: false }
}

export class LlmBudgetError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LlmBudgetError'
  }
}

/**
 * Llama a Claude y devuelve el JSON parseado (según `schema`) o null si no hay API key, hubo rechazo
 * o la respuesta no es JSON válido. Lanza LlmBudgetError si se agotó el tope de la corrida o del día.
 * @param {object} p
 * @param {object} p.supabase
 * @param {object} p.budget   de createRunBudget()
 * @param {string} p.system
 * @param {string} p.user
 * @param {object} p.schema   JSON Schema (additionalProperties:false)
 * @param {number} [p.maxTokens]
 */
export async function callClaudeJson({ supabase, budget, system, user, schema, maxTokens = 1500 }) {
  const cfg = getOutreachConfig()
  if (!cfg.enabled) throw new LlmBudgetError('outreach_disabled')
  const anthropic = getClient()
  if (!anthropic) return null

  if (budget && (budget.exhausted || budget.used >= budget.limit)) {
    budget.exhausted = true
    throw new LlmBudgetError('run_token_cap')
  }
  const dayKey = counterKeys.llmTokensToday()
  if ((await readCounter(supabase, dayKey)) >= cfg.llmTokensPerDay) {
    if (budget) budget.exhausted = true
    throw new LlmBudgetError('daily_token_cap')
  }

  const model = cfg.anthropicModel
  const request = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema } },
  }
  // Haiku 4.5 no acepta `effort`; los modelos actuales sí (bajo = más barato para extracción/clasificación).
  if (!/haiku/i.test(model)) request.output_config.effort = 'low'

  let response
  try {
    response = await anthropic.messages.create(request)
  } catch (err) {
    console.error('[outreach] error de Claude:', err?.status || '', err?.message)
    return null
  }

  const used = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0) +
    (response.usage?.cache_creation_input_tokens || 0)
  if (budget) {
    budget.used += used
    budget.calls += 1
  }
  try {
    await bumpCounter(supabase, dayKey, used)
  } catch (err) {
    console.error('[outreach] no se pudo registrar el uso de tokens:', err?.message)
  }

  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null
  const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Envuelve texto no confiable (correo entrante, HTML de un sitio) entre delimitadores. */
export function untrusted(label, text, maxChars = 12_000) {
  const clean = String(text ?? '')
    .replace(/<\/?untrusted[^>]*>/gi, '')
    .slice(0, maxChars)
  return `<untrusted source="${label}">\n${clean}\n</untrusted>`
}
