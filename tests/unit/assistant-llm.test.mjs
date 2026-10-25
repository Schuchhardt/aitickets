// Asistente IA de la página del evento: fallback entre Claude y ChatGPT y avisos a Slack
// (netlify/lib/assistant-llm.mjs), y el handler completo (netlify/functions/ai-assistant).
import Anthropic from '@anthropic-ai/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let alertsAllowed = true
vi.mock('../../netlify/lib/rate-limit.mjs', () => ({ rateLimit: async () => ({ allowed: alertsAllowed, source: 'db' }) }))
const slackMessages = []
vi.mock('../../netlify/lib/slack.mjs', () => ({ notifySlack: async (text) => { slackMessages.push(text) } }))

const {
  classifyLlmError,
  configuredProviders,
  createAnthropicProvider,
  createOpenAIProvider,
  runAssistantTurn,
  LlmHttpError,
  _resetAssistantLlmState,
} = await import('../../netlify/lib/assistant-llm.mjs')

const anthropicError = (status, type, message = 'falló') =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, undefined, new Headers())

const TOOLS = [{ name: 'send_message_to_producer', description: 'x', input_schema: { type: 'object', properties: {} } }]
const MESSAGES = [{ role: 'user', content: '¿A qué hora abren?' }]

/** Cliente de Anthropic falso: cada llamada a beta.messages.create toma la siguiente respuesta (o error). */
function fakeAnthropicClient(...responses) {
  const calls = []
  return {
    calls,
    beta: {
      messages: {
        create: async (req) => {
          calls.push(req)
          const next = responses.shift()
          if (next instanceof Error) throw next
          return next
        },
      },
    },
  }
}


/** fetch falso para OpenAI (y nada más: cualquier otra URL falla como en setup.mjs). */
function stubOpenAI(...responses) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init) => {
    if (!String(url).startsWith('https://api.openai.com/')) throw new Error(`red no permitida: ${url}`)
    calls.push(JSON.parse(init.body))
    const next = responses.shift()
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  })
  return calls
}

beforeEach(() => {
  _resetAssistantLlmState()
  slackMessages.length = 0
  alertsAllowed = true
})

describe('classifyLlmError', () => {
  it('reconoce la falta de saldo o cuota en ambos proveedores', () => {
    expect(classifyLlmError(anthropicError(402, 'billing_error'))).toBe('billing')
    // Cuentas antiguas: 400 con "credit balance is too low"
    expect(classifyLlmError(anthropicError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'))).toBe('billing')
    // OpenAI: cuota agotada llega como 429 insufficient_quota (no es un rate limit)
    expect(classifyLlmError(new LlmHttpError('openai', 429, { error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'You exceeded your current quota' } }))).toBe('billing')
  })

  it('distingue clave, modelo, rate limit, sobrecarga, servidor, red y solicitud', () => {
    expect(classifyLlmError(anthropicError(401, 'authentication_error'))).toBe('auth')
    expect(classifyLlmError(new LlmHttpError('openai', 401, { error: { code: 'invalid_api_key' } }))).toBe('auth')
    expect(classifyLlmError(anthropicError(403, 'permission_error'))).toBe('permission')
    expect(classifyLlmError(anthropicError(404, 'not_found_error'))).toBe('model')
    expect(classifyLlmError(anthropicError(429, 'rate_limit_error'))).toBe('rate_limit')
    expect(classifyLlmError(new LlmHttpError('openai', 429, { error: { code: 'rate_limit_exceeded' } }))).toBe('rate_limit')
    expect(classifyLlmError(anthropicError(529, 'overloaded_error'))).toBe('overloaded')
    expect(classifyLlmError(anthropicError(500, 'api_error'))).toBe('server')
    expect(classifyLlmError(anthropicError(400, 'invalid_request_error', 'messages: roles must alternate'))).toBe('request')
    expect(classifyLlmError(new Anthropic.APIConnectionTimeoutError())).toBe('network')
    expect(classifyLlmError(new TypeError('fetch failed'))).toBe('network')
    expect(classifyLlmError(new ReferenceError('feeAbsorbed is not defined'))).toBe('unknown')
  })
})

describe('configuredProviders', () => {
  it('usa Claude y luego ChatGPT por defecto, solo con API key', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    expect(configuredProviders().map((p) => p.name)).toEqual(['anthropic', 'openai'])
    expect(configuredProviders('openai, anthropic').map((p) => p.name)).toEqual(['openai', 'anthropic'])
    vi.stubEnv('OPENAI_API_KEY', '')
    expect(configuredProviders().map((p) => p.name)).toEqual(['anthropic'])
  })
})

describe('runAssistantTurn', () => {
  it('Claude sin saldo: responde ChatGPT y avisa a Slack con el link de facturación', async () => {
    const claude = createAnthropicProvider({ client: fakeAnthropicClient(anthropicError(402, 'billing_error', 'credit balance too low')), model: 'claude-opus-5-5' })
    const openaiCalls = stubOpenAI({ body: { choices: [{ message: { role: 'assistant', content: 'Las puertas abren a las 20:00.' } }] } })
    const gpt = createOpenAIProvider({ apiKey: 'sk-test', model: 'gpt-5-mini' })

    const result = await runAssistantTurn({ system: 'sys', messages: MESSAGES, tools: TOOLS, executeTool: vi.fn(), providers: [claude, gpt], eventId: 7 })

    expect(result).toMatchObject({ ok: true, provider: 'openai', text: 'Las puertas abren a las 20:00.' })
    expect(openaiCalls[0]).toMatchObject({ model: 'gpt-5-mini', reasoning_effort: 'low', tool_choice: 'auto' })
    expect(openaiCalls[0].messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(openaiCalls[0].tools[0].function.name).toBe('send_message_to_producer')
    expect(slackMessages).toHaveLength(1)
    expect(slackMessages[0]).toMatch(/Claude.*sin saldo/)
    expect(slackMessages[0]).toMatch(/console\.anthropic\.com\/settings\/billing/)
    expect(slackMessages[0]).toMatch(/respondió \*ChatGPT\* como respaldo/)
  })

  it('un 429 de Claude hace fallback sin avisar a Slack', async () => {
    const claude = createAnthropicProvider({ client: fakeAnthropicClient(anthropicError(429, 'rate_limit_error')) })
    stubOpenAI({ body: { choices: [{ message: { content: 'Hola' } }] } })
    const result = await runAssistantTurn({ system: 's', messages: MESSAGES, tools: TOOLS, executeTool: vi.fn(), providers: [claude, createOpenAIProvider({ apiKey: 'k' })] })
    expect(result).toMatchObject({ ok: true, provider: 'openai', text: 'Hola' })
    expect(slackMessages).toHaveLength(0)
  })

  it('si ningún proveedor responde, avisa que el asistente está caído', async () => {
    const claude = createAnthropicProvider({ client: fakeAnthropicClient(anthropicError(529, 'overloaded_error')) })
    stubOpenAI({ status: 429, body: { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } } })
    const result = await runAssistantTurn({ system: 's', messages: MESSAGES, tools: TOOLS, executeTool: vi.fn(), providers: [claude, createOpenAIProvider({ apiKey: 'k' })] })
    expect(result.ok).toBe(false)
    expect(result.failures).toEqual([
      { provider: 'anthropic', kind: 'overloaded', status: 529 },
      { provider: 'openai', kind: 'billing', status: 429 },
    ])
    expect(slackMessages[0]).toMatch(/Ningún proveedor respondió/)
    expect(slackMessages[0]).toMatch(/platform\.openai\.com/)
  })

  it('el aviso se limita (rate limit compartido): no se repite en la misma hora', async () => {
    alertsAllowed = false
    const claude = createAnthropicProvider({ client: fakeAnthropicClient(anthropicError(401, 'authentication_error')) })
    stubOpenAI({ body: { choices: [{ message: { content: 'ok' } }] } })
    await runAssistantTurn({ system: 's', messages: MESSAGES, tools: TOOLS, executeTool: vi.fn(), providers: [claude, createOpenAIProvider({ apiKey: 'k' })] })
    expect(slackMessages).toHaveLength(0)
  })

  it('tras un error de saldo, Claude queda en pausa unos minutos y se pregunta primero a ChatGPT', async () => {
    const client = fakeAnthropicClient(anthropicError(402, 'billing_error'))
    const claude = createAnthropicProvider({ client })
    stubOpenAI({ body: { choices: [{ message: { content: 'uno' } }] } }, { body: { choices: [{ message: { content: 'dos' } }] } })
    const gpt = createOpenAIProvider({ apiKey: 'k' })
    const now = Date.now()
    await runAssistantTurn({ system: 's', messages: MESSAGES, tools: TOOLS, executeTool: vi.fn(), providers: [claude, gpt], now })
    const second = await runAssistantTurn({ system: 's', messages: MESSAGES, tools: TOOLS, executeTool: vi.fn(), providers: [claude, gpt], now: now + 1000 })
    expect(second).toMatchObject({ ok: true, provider: 'openai', text: 'dos' })
    expect(client.calls).toHaveLength(1)
  })

  it('ejecuta herramientas en ChatGPT y devuelve el resultado al modelo', async () => {
    const openaiCalls = stubOpenAI(
      { body: { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'send_message_to_producer', arguments: '{"message":"¿Hay estacionamiento?","user_name":"Ana","user_email":"ana@test.cl"}' } }] } }] } },
      { body: { choices: [{ message: { content: 'Listo, le envié tu pregunta a la productora.' } }] } },
    )
    const executeTool = vi.fn(async () => ({ content: 'La pregunta fue enviada a la productora.' }))
    const result = await runAssistantTurn({ system: 's', messages: MESSAGES, tools: TOOLS, executeTool, providers: [createOpenAIProvider({ apiKey: 'k' })] })
    expect(executeTool).toHaveBeenCalledWith('send_message_to_producer', { message: '¿Hay estacionamiento?', user_name: 'Ana', user_email: 'ana@test.cl' })
    expect(result).toMatchObject({ ok: true, text: 'Listo, le envié tu pregunta a la productora.', toolsRan: true })
    const followUp = openaiCalls[1].messages
    expect(followUp.at(-2)).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call_1' }] })
    expect(followUp.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'La pregunta fue enviada a la productora.' })
  })

  it('no hace fallback si la herramienta ya se ejecutó (no se duplica la pregunta)', async () => {
    const toolTurn = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'send_message_to_producer', input: { message: 'x' } }] }
    const claude = createAnthropicProvider({ client: fakeAnthropicClient(toolTurn, anthropicError(500, 'api_error')) })
    const gptRun = vi.fn()
    const gpt = { name: 'openai', label: 'ChatGPT', model: 'm', configured: true, run: gptRun }
    const executeTool = vi.fn(async () => ({ content: 'ok' }))
    const result = await runAssistantTurn({ system: 's', messages: MESSAGES, tools: TOOLS, executeTool, providers: [claude, gpt] })
    expect(result).toMatchObject({ ok: true, provider: 'anthropic', toolsRan: true, text: '' })
    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(gptRun).not.toHaveBeenCalled()
  })

  it('fill_buyer_information corta el turno y vuelve al navegador', async () => {
    const toolTurn = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'fill_buyer_information', input: { first_name: 'Ana' } }] }
    const client = fakeAnthropicClient(toolTurn)
    const executeTool = async () => ({ clientAction: { called: true, name: 'fill_buyer_information', properties: { first_name: 'Ana' } } })
    const result = await runAssistantTurn({ system: 's', messages: MESSAGES, tools: TOOLS, executeTool, providers: [createAnthropicProvider({ client })] })
    expect(result).toMatchObject({ ok: true, clientAction: { name: 'fill_buyer_information' }, toolsRan: false })
    expect(client.calls).toHaveLength(1)
    expect(client.calls[0]).toMatchObject({ fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'], output_config: { effort: 'low' } })
  })
})

describe('handler /api/ai-assistant', () => {
  const event = { id: 5, slug: 'fiesta', name: 'Fiesta', description: '<p>Gran fiesta</p>', location: 'Santiago', start_date: '2026-12-01T23:00:00Z', end_date: null, status: 'published' }
  let db
  let provider

  beforeEach(() => {
    vi.resetModules()
  })

  async function loadHandler() {
    vi.doMock('../../netlify/lib/supabase.mjs', async (importOriginal) => ({ ...(await importOriginal()), getSupabaseAdmin: () => db }))
    vi.doMock('../../netlify/lib/tickets.mjs', async (importOriginal) => ({ ...(await importOriginal()), getSoldCounts: async () => new Map() }))
    vi.doMock('../../netlify/lib/assistant-llm.mjs', async (importOriginal) => ({ ...(await importOriginal()), configuredProviders: () => [provider] }))
    return (await import('../../netlify/functions/ai-assistant/index.mjs')).default
  }

  const post = (handler, body) =>
    handler(new Request('https://aitickets.cl/api/ai-assistant', { method: 'POST', body: JSON.stringify(body) }), { ip: `10.0.0.${Math.floor(Math.random() * 250)}` })

  it('arma el prompt de un evento con cargo absorbido (antes: ReferenceError feeAbsorbed en cada mensaje)', async () => {
    db = createFakeSupabase({
      tables: {
        events: [{ ...event, fee_absorbed: true }],
        event_dates: [],
        event_tickets: [{ id: 9, event_id: 5, ticket_name: 'General', price: 10000, total_quantity: null, status: 'available', is_gift: false, max_quantity: 4 }],
        event_faqs: [],
      },
    })
    let system = ''
    provider = { name: 'anthropic', label: 'Claude', model: 'm', configured: true, run: async (args) => { system = args.system; return { text: '¡Hola! La fiesta es el 1 de diciembre.' } } }
    const handler = await loadHandler()
    const res = await post(handler, { eventId: 5, messages: [{ role: 'assistant', text: '¿Te ayudo?' }, { role: 'user', text: 'Hola' }] })
    expect(res.status).toBe(200)
    expect((await res.json()).message).toBe('¡Hola! La fiesta es el 1 de diciembre.')
    expect(system).toContain('el cargo por servicio está incluido en el precio')
    expect(system).toContain('"General"')
  })

  it('guarda la pregunta para la productora y responde aunque el modelo no escriba texto', async () => {
    db = createFakeSupabase({ tables: { events: [event], event_dates: [], event_tickets: [], event_faqs: [], questions: [] } })
    provider = {
      name: 'openai', label: 'ChatGPT', model: 'm', configured: true,
      run: async ({ executeTool }) => {
        await executeTool('send_message_to_producer', { message: '¿Se puede entrar con niños?', user_name: 'Ana', user_email: 'ANA@test.cl' })
        return { text: '' }
      },
    }
    const handler = await loadHandler()
    const res = await post(handler, { eventId: 5, messages: [{ role: 'user', text: '¿Se puede entrar con niños?' }] })
    expect((await res.json()).message).toBe('✅ Tu pregunta fue enviada a la productora.')
    expect(db.tables.questions).toEqual([expect.objectContaining({ event_id: 5, user_name: 'Ana', user_email: 'ana@test.cl' })])
  })

  it('sin ningún proveedor disponible responde 503 con un mensaje claro', async () => {
    db = createFakeSupabase({ tables: { events: [event], event_dates: [], event_tickets: [], event_faqs: [] } })
    provider = {
      name: 'anthropic', label: 'Claude', model: 'm', configured: true,
      run: async () => { throw anthropicError(402, 'billing_error') },
    }
    const handler = await loadHandler()
    const res = await post(handler, { eventId: 5, messages: [{ role: 'user', text: 'Hola' }] })
    expect(res.status).toBe(503)
    expect((await res.json()).message).toMatch(/hubo un error/)
  })
})
