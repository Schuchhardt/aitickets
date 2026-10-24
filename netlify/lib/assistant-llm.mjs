// Proveedores de IA del asistente de la página del evento (netlify/functions/ai-assistant) con fallback.
//
// Se prueba cada proveedor configurado en orden (AI_ASSISTANT_PROVIDERS, por defecto "anthropic,openai"; solo
// los que tienen API key) y si uno falla se pasa al siguiente. Así un corte, un 429 o la falta de saldo en
// Claude no deja a los compradores sin respuesta: contesta ChatGPT (y al revés si el orden es "openai,anthropic").
//
// Avisos a Slack (SLACK_WEBHOOK_URL), como máximo uno por hora por combinación de fallas:
// - Errores que necesitan a una persona: sin saldo o sin cuota, API key rechazada, sin permiso, modelo
//   inexistente, solicitud inválida o un error inesperado del código. Además, ese proveedor se salta por
//   PROVIDER_COOLDOWN_MS en esta instancia (no tiene sentido pagar la latencia de un rechazo seguro).
// - Los transitorios (429, 5xx, 529, timeouts, red) solo hacen fallback; avisan únicamente si ningún
//   proveedor respondió (asistente caído).
//
// Conversación en formato común: [{ role: 'user' | 'assistant', content: string }] (primero un 'user').
// Herramientas en formato de Anthropic ({ name, description, input_schema }); OpenAI recibe la conversión.
// executeTool(name, input) devuelve { clientAction } (se corta el turno y vuelve al navegador) o
// { content, isError? } (se le entrega el resultado al modelo y este responde). Si una herramienta ya se
// ejecutó (p. ej. se guardó la pregunta para la productora) no se hace fallback: se repetiría el efecto.
import Anthropic from '@anthropic-ai/sdk'

import { notifySlack } from './slack.mjs'
import { rateLimit } from './rate-limit.mjs'

const env = (name) => globalThis.process?.env?.[name]

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5'
export const DEFAULT_OPENAI_MODEL = 'gpt-5-mini'
export const DEFAULT_PROVIDER_ORDER = ['anthropic', 'openai']
const REQUEST_TIMEOUT_MS = 45_000
const MAX_OUTPUT_TOKENS = 4000
export const PROVIDER_COOLDOWN_MS = 5 * 60 * 1000
const ALERT_LIMIT = { bucket: 'ai-assistant:alert', windowSeconds: 60 * 60, max: 1 }

/** Tipos de falla que necesitan a una persona (recargar saldo, cambiar la clave o el modelo, revisar el código). */
export const ACTION_REQUIRED_KINDS = new Set(['billing', 'auth', 'permission', 'model', 'request', 'unknown'])
/** Con estos el proveedor se salta un rato: el próximo intento fallaría igual. */
const COOLDOWN_KINDS = new Set(['billing', 'auth', 'permission', 'model'])

/** Error HTTP de un proveedor sin SDK (OpenAI vía fetch). Misma forma que Anthropic.APIError: status y type. */
export class LlmHttpError extends Error {
  constructor(provider, status, body) {
    const err = body?.error || {}
    super(String(err.message || `${provider} respondió ${status}`))
    this.name = 'LlmHttpError'
    this.provider = provider
    this.status = status
    this.type = err.type || null
    this.code = err.code || null
  }
}

/**
 * Clasifica un error de cualquiera de los proveedores:
 * billing | auth | permission | model | request | rate_limit | overloaded | server | network | unknown.
 * Anthropic: 402 billing_error; algunas cuentas aún reciben la falta de saldo como 400 "Your credit balance is too
 * low", que solo se distingue por el mensaje. OpenAI: la cuota agotada llega como 429 con code insufficient_quota
 * (no es un rate limit: reintentar no sirve).
 */
export function classifyLlmError(err) {
  const status = Number(err?.status) || 0
  const type = String(err?.type || err?.error?.error?.type || '')
  const code = String(err?.code || err?.error?.error?.code || '')
  const message = String(err?.message || '')
  if (status === 402 || type === 'billing_error' || type === 'insufficient_quota' || code === 'insufficient_quota' ||
    /credit balance is too low|exceeded your current quota/i.test(message)) return 'billing'
  if (status === 401 || type === 'authentication_error' || code === 'invalid_api_key') return 'auth'
  if (status === 403 || type === 'permission_error') return 'permission'
  if (status === 404 || type === 'not_found_error' || code === 'model_not_found') return 'model'
  if (status === 429 || type === 'rate_limit_error') return 'rate_limit'
  if (status === 529 || type === 'overloaded_error') return 'overloaded'
  if (status >= 500) return 'server'
  if (status >= 400) return 'request'
  if (err instanceof Anthropic.APIConnectionError || ['AbortError', 'TimeoutError'].includes(err?.name) ||
    /timed? ?out|fetch failed|network|socket|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) return 'network'
  return 'unknown'
}

const textOf = (message) => (message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()

/** Claude (Anthropic SDK). `client` solo para tests. */
export function createAnthropicProvider({ apiKey = env('ANTHROPIC_API_KEY'), model = env('ANTHROPIC_MODEL') || DEFAULT_ANTHROPIC_MODEL, client } = {}) {
  return {
    name: 'anthropic',
    label: 'Claude',
    model,
    keyEnv: 'ANTHROPIC_API_KEY',
    billingUrl: 'https://console.anthropic.com/settings/billing',
    configured: Boolean(client || apiKey),
    async run({ system, messages, tools, executeTool }) {
      const anthropic = client || new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 })
      // Chat corto de preguntas y respuestas: esfuerzo bajo para mantener la latencia.
      // fallbacks "default": si el modelo rechaza por política, la API reintenta con el modelo recomendado.
      const request = {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        tools,
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }
      const response = await anthropic.beta.messages.create({ ...request, messages })
      if (response.stop_reason === 'refusal') return { refusal: true }

      const toolUses = response.content.filter((b) => b.type === 'tool_use')
      if (response.stop_reason !== 'tool_use' || !toolUses.length) return { text: textOf(response) }

      const toolResults = []
      for (const toolUse of toolUses) {
        const out = await executeTool(toolUse.name, toolUse.input || {})
        if (out.clientAction) return { clientAction: out.clientAction }
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: String(out.content ?? ''), is_error: Boolean(out.isError) })
      }
      // Devolver el turno del asistente completo (incluye bloques de thinking) y todos los resultados juntos
      const second = await anthropic.beta.messages.create({
        ...request,
        messages: [...messages, { role: 'assistant', content: response.content }, { role: 'user', content: toolResults }],
      })
      return { text: second.stop_reason === 'refusal' ? '' : textOf(second) }
    },
  }
}

/** ChatGPT (API de OpenAI, Chat Completions vía fetch). OPENAI_CHAT_MODEL elige el modelo. */
export function createOpenAIProvider({ apiKey = env('OPENAI_API_KEY'), model = env('OPENAI_CHAT_MODEL') || DEFAULT_OPENAI_MODEL } = {}) {
  const call = async (body) => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new LlmHttpError('openai', res.status, data)
    return data
  }
  return {
    name: 'openai',
    label: 'ChatGPT',
    model,
    keyEnv: 'OPENAI_API_KEY',
    billingUrl: 'https://platform.openai.com/settings/organization/billing/overview',
    configured: Boolean(apiKey),
    async run({ system, messages, tools, executeTool }) {
      const body = {
        model,
        messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
        tool_choice: 'auto',
        max_completion_tokens: MAX_OUTPUT_TOKENS,
      }
      // Modelos de razonamiento (gpt-5*, o*): esfuerzo bajo, igual que con Claude
      if (/^(gpt-5|o\d)/.test(model)) body.reasoning_effort = 'low'

      const first = await call(body)
      const message = first.choices?.[0]?.message || {}
      const calls = (message.tool_calls || []).filter((c) => c.type === 'function' && c.function?.name)
      if (!calls.length) {
        const text = String(message.content || '').trim()
        return text ? { text } : { refusal: Boolean(message.refusal), text: '' }
      }

      const toolMessages = []
      for (const c of calls) {
        let input = {}
        try { input = JSON.parse(c.function.arguments || '{}') } catch { /* argumentos inválidos: el handler valida */ }
        const out = await executeTool(c.function.name, input && typeof input === 'object' ? input : {})
        if (out.clientAction) return { clientAction: out.clientAction }
        toolMessages.push({ role: 'tool', tool_call_id: c.id, content: String(out.content ?? '') })
      }
      const assistantTurn = {
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments || '{}' } })),
      }
      const second = await call({ ...body, messages: [...body.messages, assistantTurn, ...toolMessages] })
      return { text: String(second.choices?.[0]?.message?.content || '').trim() }
    },
  }
}

const FACTORIES = { anthropic: createAnthropicProvider, openai: createOpenAIProvider }

/** Proveedores configurados en el orden de AI_ASSISTANT_PROVIDERS (los nombres desconocidos o sin key se omiten). */
export function configuredProviders(order = env('AI_ASSISTANT_PROVIDERS')) {
  const names = String(order || '').split(',').map((s) => s.trim().toLowerCase()).filter((n) => FACTORIES[n])
  const unique = [...new Set(names.length ? names : DEFAULT_PROVIDER_ORDER)]
  return unique.map((n) => FACTORIES[n]()).filter((p) => p.configured)
}

// ---- Cooldown por instancia: un proveedor sin saldo o con la clave mala se salta por unos minutos ----
const cooldownUntil = new Map()
/** Solo para tests. */
export function _resetAssistantLlmState() {
  cooldownUntil.clear()
}
const inCooldown = (name, now) => (cooldownUntil.get(name) || 0) > now

/** Los que están en cooldown van al final (se prueban igual si todos los demás fallan). */
function orderForAttempt(providers, now) {
  const ready = providers.filter((p) => !inCooldown(p.name, now))
  const cooling = providers.filter((p) => inCooldown(p.name, now))
  return [...ready, ...cooling]
}

const KIND_LABELS = {
  billing: 'sin saldo o sin cuota',
  auth: 'API key rechazada',
  permission: 'sin permiso para el modelo',
  model: 'modelo inexistente o no habilitado',
  request: 'solicitud rechazada',
  rate_limit: 'límite de solicitudes (429)',
  overloaded: 'sobrecargado (529)',
  server: 'error del servidor',
  network: 'sin conexión o timeout',
  unknown: 'error inesperado',
}

function describeFailure(f) {
  const p = f.provider
  const detail = [f.status ? `HTTP ${f.status}` : null, f.message ? f.message.slice(0, 200) : null].filter(Boolean).join(' · ')
  let hint = ''
  if (f.kind === 'billing') hint = ` → Recarga créditos: ${p.billingUrl}`
  else if (f.kind === 'auth') hint = ` → Revisa ${p.keyEnv} en Netlify (scope Functions).`
  else if (f.kind === 'model' || f.kind === 'permission') hint = ` → Revisa el modelo configurado (${p.model}).`
  return `• *${p.label}* (${p.model}): ${KIND_LABELS[f.kind] || f.kind}${detail ? ` — ${detail}` : ''}${hint}`
}

/** Aviso a Slack, como máximo uno por hora por combinación de fallas y resultado (compartido entre instancias). */
async function alertFailures(failures, servedBy, { eventId, partial = false } = {}) {
  const actionable = failures.filter((f) => ACTION_REQUIRED_KINDS.has(f.kind))
  if (!actionable.length && servedBy) return
  const key = `${failures.map((f) => `${f.provider.name}:${f.kind}`).join('|')}>${partial ? 'partial' : servedBy?.name || 'none'}`
  try {
    const { allowed } = await rateLimit(ALERT_LIMIT.bucket, key, ALERT_LIMIT)
    if (!allowed) return
  } catch { /* sin rate limit: avisar igual */ }
  const outcome = partial
    ? 'La herramienta alcanzó a ejecutarse (p. ej. se guardó la pregunta para la productora), pero falló la respuesta final.'
    : servedBy
      ? `Los compradores siguen atendidos: respondió *${servedBy.label}* como respaldo.`
      : '⚠️ *Ningún proveedor respondió: el asistente de los eventos no está contestando.*'
  await notifySlack(
    `🤖 *Asistente IA de eventos con problemas*\n${failures.map(describeFailure).join('\n')}\n${outcome}` +
    `${eventId ? `\n(Evento ${eventId}. Próximo aviso igual en 1 h como mínimo.)` : ''}`
  )
}

/**
 * Corre un turno del asistente con fallback entre proveedores.
 * @returns {Promise<{ ok: true, provider: string, text?: string, refusal?: boolean, clientAction?: object, toolsRan: boolean }
 *   | { ok: false, failures: Array<{ provider: string, kind: string, status: number | null }> }>}
 */
export async function runAssistantTurn({ system, messages, tools, executeTool, providers = configuredProviders(), eventId, now = Date.now() }) {
  const failures = []
  for (const provider of orderForAttempt(providers, now)) {
    let toolsRan = false
    const trackedExecute = async (name, input) => {
      const out = await executeTool(name, input)
      if (!out?.clientAction) toolsRan = true
      return out
    }
    try {
      const result = await provider.run({ system, messages, tools, executeTool: trackedExecute })
      cooldownUntil.delete(provider.name)
      if (failures.length) await alertFailures(failures, provider, { eventId })
      return { ok: true, provider: provider.name, toolsRan, ...result }
    } catch (err) {
      const kind = classifyLlmError(err)
      const failure = { provider, kind, status: Number(err?.status) || null, message: String(err?.message || '') }
      failures.push(failure)
      console.error(`[ai-assistant] ${provider.name} falló (${kind}):`, failure.status || '', failure.message.slice(0, 300))
      if (COOLDOWN_KINDS.has(kind)) cooldownUntil.set(provider.name, now + PROVIDER_COOLDOWN_MS)
      // La herramienta ya tuvo efecto (pregunta guardada): no se repite con otro proveedor
      if (toolsRan) {
        await alertFailures(failures, null, { eventId, partial: true })
        return { ok: true, provider: provider.name, toolsRan, text: '' }
      }
    }
  }
  await alertFailures(failures, null, { eventId })
  return { ok: false, failures: failures.map((f) => ({ provider: f.provider.name, kind: f.kind, status: f.status })) }
}

/** Aviso de un error del asistente fuera de los proveedores (p. ej. al armar el contexto). Máximo uno por hora. */
export async function alertAssistantError(err, { eventId } = {}) {
  const name = String(err?.name || 'Error')
  try {
    const { allowed } = await rateLimit(ALERT_LIMIT.bucket, `handler:${name}:${String(err?.message || '').slice(0, 80)}`, ALERT_LIMIT)
    if (!allowed) return
  } catch { /* avisar igual */ }
  await notifySlack(`🤖 *Asistente IA de eventos con error* (${name}): ${String(err?.message || err).slice(0, 400)}${eventId ? `\n(Evento ${eventId}.)` : ''}`)
}
