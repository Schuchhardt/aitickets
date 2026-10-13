// Bot de WhatsApp (Kapso): firma del webhook, formato, historial, herramientas (privacidad de compras),
// pausa cuando responde una persona y el bucle del agente con un Claude falso.
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const rateLimitMock = vi.fn(async () => ({ allowed: true, source: 'db' }))
const sendTicketsMock = vi.fn(async () => ({ ok: true, status: 'sent' }))
const slackMock = vi.fn(async () => {})
const triggerMock = vi.fn(async (_origin, name) => ({ name, status: 202 }))
const sendTextMock = vi.fn(async () => 'wamid.out.1')
const createLeadMock = vi.fn(async () => ({ leadId: 'lead-1', created: true, domainConflict: false }))
let fakeDb

vi.mock('../../netlify/lib/rate-limit.mjs', () => ({ rateLimit: (...a) => rateLimitMock(...a) }))
vi.mock('../../netlify/lib/tickets-email.mjs', () => ({ sendOrderTicketsEmail: (...a) => sendTicketsMock(...a) }))
vi.mock('../../netlify/lib/slack.mjs', () => ({ notifySlack: (...a) => slackMock(...a) }))
vi.mock('../../netlify/lib/outreach/sources/inbound.mjs', () => ({ createInboundLead: (...a) => createLeadMock(...a) }))
vi.mock('../../netlify/lib/outreach/background.mjs', () => ({
  functionsOrigin: () => 'https://deploy.example.test',
  triggerBackground: (...a) => triggerMock(...a),
}))
vi.mock('../../netlify/lib/whatsapp/kapso.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  sendWhatsAppText: (...a) => sendTextMock(...a),
  markReadWithTyping: async () => {},
}))
vi.mock('../../netlify/lib/supabase.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  getSupabaseAdmin: () => fakeDb,
}))

const kapso = await import('../../netlify/lib/whatsapp/kapso.mjs')
const store = await import('../../netlify/lib/whatsapp/store.mjs')
const tools = await import('../../netlify/lib/whatsapp/tools.mjs')
const agent = await import('../../netlify/lib/whatsapp/agent.mjs')
const { default: webhook } = await import('../../netlify/functions/whatsapp-webhook/index.mjs')

const SECRET = 'whsec-test'
const PHONE_ID = '123456789012345'
const sign = (raw) => createHmac('sha256', SECRET).update(raw).digest('hex')

function webhookRequest(event, body, { signature } = {}) {
  const raw = JSON.stringify(body)
  return new Request('https://aitickets.test/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Event': event, 'X-Webhook-Signature': signature ?? sign(raw) },
    body: raw,
  })
}

const conversationPayload = (over = {}) => ({ id: 'conv_1', phone_number: '56912345678', contact_name: 'Ana', phone_number_id: PHONE_ID, ...over })
const received = (wamid, text) => ({
  message: { id: wamid, type: 'text', from: '56912345678', text: { body: text }, kapso: { direction: 'inbound', origin: 'cloud_api' } },
  conversation: conversationPayload(),
  phone_number_id: PHONE_ID,
})
const sent = (wamid, text) => ({
  message: { id: wamid, type: 'text', to: '56912345678', text: { body: text }, kapso: { direction: 'outbound', origin: 'cloud_api' } },
  conversation: conversationPayload(),
  phone_number_id: PHONE_ID,
})

function claimRpcs() {
  return {
    aitickets_wa_claim_conversation: ({ p_id }, state) => {
      const row = state.aitickets_wa_conversations.find((r) => r.id === p_id)
      if (!row || (row.lock_until && Date.parse(row.lock_until) > Date.now())) return false
      row.lock_until = new Date(Date.now() + 60_000).toISOString()
      return true
    },
    aitickets_wa_release_conversation: ({ p_id }, state) => {
      const row = state.aitickets_wa_conversations.find((r) => r.id === p_id)
      if (row) row.lock_until = null
    },
  }
}

beforeEach(() => {
  vi.stubEnv('KAPSO_WEBHOOK_SECRET', SECRET)
  vi.stubEnv('KAPSO_PHONE_NUMBER_ID', PHONE_ID)
  vi.stubEnv('KAPSO_API_KEY', 'kapso-key')
  rateLimitMock.mockClear().mockImplementation(async () => ({ allowed: true, source: 'db' }))
  for (const m of [sendTicketsMock, slackMock, triggerMock, sendTextMock, createLeadMock]) m.mockClear()
})

describe('kapso helpers', () => {
  it('verifica la firma HMAC hex del cuerpo exacto', () => {
    const raw = '{"a":1}'
    expect(kapso.verifyKapsoSignature(raw, sign(raw), SECRET)).toBe(true)
    expect(kapso.verifyKapsoSignature(raw + ' ', sign(raw), SECRET)).toBe(false)
    expect(kapso.verifyKapsoSignature(raw, 'nope', SECRET)).toBe(false)
    expect(kapso.verifyKapsoSignature(raw, sign(raw), '')).toBe(false)
  })

  it('convierte markdown a formato WhatsApp', () => {
    expect(kapso.toWhatsAppText('## Hola\n**Entradas**: [Comprar](https://aitickets.cl/eventos/x)\n- uno'))
      .toBe('*Hola*\n*Entradas*: Comprar: https://aitickets.cl/eventos/x\n• uno')
  })

  it('corta textos largos sin pasar el límite', () => {
    const parts = kapso.splitForWhatsApp(`${'a '.repeat(3000)}\n\n${'b '.repeat(3000)}`)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((p) => p.length <= kapso.WHATSAPP_TEXT_LIMIT)).toBe(true)
  })

  it('extrae texto de botones y transcripciones de audio', () => {
    expect(kapso.inboundText({ type: 'interactive', interactive: { button_reply: { title: 'Sí' } } })).toBe('Sí')
    expect(kapso.inboundText({ type: 'audio', kapso: { transcript: { text: 'hola' } } })).toBe('hola')
    expect(kapso.inboundText({ type: 'sticker' })).toBe('[sticker sin texto]')
  })

  it('responde por teléfono o, sin teléfono, por BSUID', () => {
    expect(kapso.recipientFields({ phone: '+56 9 1234 5678' })).toEqual({ to: '56912345678' })
    expect(kapso.recipientFields({ bsuid: 'CL.123' })).toEqual({ recipient_type: 'individual', recipient: 'CL.123' })
  })
})

describe('historial para Claude', () => {
  it('une turnos seguidos, marca respuestas humanas y empieza por user', () => {
    const msgs = store.historyToClaudeMessages([
      { direction: 'out', author: 'bot', body: 'saludo viejo' },
      { direction: 'in', author: 'customer', body: 'hola' },
      { direction: 'in', author: 'customer', body: '¿hay eventos?' },
      { direction: 'out', author: 'human', body: 'te ayudo yo' },
    ])
    expect(msgs).toEqual([
      { role: 'user', content: 'hola\n\n¿hay eventos?' },
      { role: 'assistant', content: '[Respuesta de una persona del equipo de AI Tickets]: te ayudo yo' },
    ])
  })
})

describe('webhook', () => {
  beforeEach(() => {
    fakeDb = createFakeSupabase({ tables: { aitickets_wa_conversations: [], aitickets_wa_messages: [] }, unique: { aitickets_wa_messages: [['wamid']] } })
  })

  it('rechaza firmas inválidas', async () => {
    const res = await webhook(webhookRequest('whatsapp.message.received', received('wamid.1', 'hola'), { signature: 'a'.repeat(64) }))
    expect(res.status).toBe(401)
    expect(fakeDb.tables.aitickets_wa_messages).toHaveLength(0)
  })

  it('guarda el entrante, dispara el bot y no duplica reintentos', async () => {
    const res = await webhook(webhookRequest('whatsapp.message.received', received('wamid.1', 'hola')))
    expect(res.status).toBe(200)
    expect(fakeDb.tables.aitickets_wa_conversations[0]).toMatchObject({ id: 'conv_1', wa_phone: '56912345678', contact_name: 'Ana' })
    expect(fakeDb.tables.aitickets_wa_messages[0]).toMatchObject({ wamid: 'wamid.1', direction: 'in', author: 'customer', body: 'hola', processed_at: null })
    expect(triggerMock).toHaveBeenCalledWith('https://deploy.example.test', 'whatsapp-bot-background', { conversationId: 'conv_1' })

    await webhook(webhookRequest('whatsapp.message.received', received('wamid.1', 'hola')))
    expect(fakeDb.tables.aitickets_wa_messages).toHaveLength(1)
    expect(triggerMock).toHaveBeenCalledTimes(1)
  })

  it('acepta lotes con buffering', async () => {
    const body = { type: 'whatsapp.message.received', batch: true, data: [received('wamid.1', 'hola'), received('wamid.2', 'quiero entradas')] }
    await webhook(webhookRequest('whatsapp.message.received', body))
    expect(fakeDb.tables.aitickets_wa_messages.map((m) => m.body)).toEqual(['hola', 'quiero entradas'])
    expect(triggerMock).toHaveBeenCalledTimes(1)
  })

  it('ignora otros números', async () => {
    const payload = { ...received('wamid.1', 'hola'), phone_number_id: '999' }
    await webhook(webhookRequest('whatsapp.message.received', payload))
    expect(fakeDb.tables.aitickets_wa_messages).toHaveLength(0)
  })

  it('una respuesta desde el Inbox pausa el bot; un envío del bot no', async () => {
    await webhook(webhookRequest('whatsapp.message.received', received('wamid.1', 'hola')))
    fakeDb.tables.aitickets_wa_messages.push({ id: 'm-bot', conversation_id: 'conv_1', wamid: 'wamid.bot', direction: 'out', author: 'bot', body: 'hola!', created_at: new Date().toISOString() })

    await webhook(webhookRequest('whatsapp.message.sent', sent('wamid.bot', 'hola!')))
    expect(fakeDb.tables.aitickets_wa_conversations[0].bot_paused_until ?? null).toBeNull()

    await webhook(webhookRequest('whatsapp.message.sent', sent('wamid.human', 'Hola Ana, soy Seba')))
    const conv = fakeDb.tables.aitickets_wa_conversations[0]
    expect(Date.parse(conv.bot_paused_until)).toBeGreaterThan(Date.now())
    expect(fakeDb.tables.aitickets_wa_messages.find((m) => m.wamid === 'wamid.human')).toMatchObject({ author: 'human', direction: 'out' })
  })
})

describe('herramientas: compras', () => {
  const conversation = { id: 'conv_1', wa_phone: '56912345678', contact_name: 'Ana' }
  const ORDER_A = 'aaaaaaaa-1111-4111-8111-111111111111'
  const ORDER_B = 'bbbbbbbb-2222-4222-8222-222222222222'
  let phoneRpcArgs

  beforeEach(() => {
    phoneRpcArgs = []
    fakeDb = createFakeSupabase({
      tables: {
        events: [{ id: 7, name: 'Jazz en el Parque', slug: 'jazz', start_date: '2026-11-20T23:00:00Z' }],
        event_orders: [
          { id: ORDER_B, buyer_email: 'otra@correo.cl', status: 'paid', created_at: new Date().toISOString() },
          { id: 'cccccccc-3333-4333-8333-333333333333', buyer_email: 'otra@correo.cl', status: 'refunded', created_at: new Date().toISOString() },
        ],
      },
      rpc: {
        aitickets_wa_orders_by_phone: (args) => {
          phoneRpcArgs.push(args)
          return [{ id: ORDER_A, event_id: 7, created_at: '2026-10-01T12:00:00Z', ticket_qty: 2, buyer_email: 'ana.perez@gmail.com', buyer_first_name: 'Ana' }]
        },
      },
    })
  })

  it('mis_compras busca por el teléfono de la conversación y enmascara el correo', async () => {
    const r = await tools.misCompras({ supabase: fakeDb, conversation }, { telefono: '56900000000' })
    expect(phoneRpcArgs[0].p_phone).toBe('56912345678')
    expect(r.compras[0]).toMatchObject({ referencia: 'AAAAAAAA', evento: 'Jazz en el Parque', entradas: 2, correo: 'an***@gmail.com' })
    expect(JSON.stringify(r)).not.toContain(ORDER_A)
  })

  it('reenviar_entradas por referencia solo acepta compras de este teléfono', async () => {
    expect(await tools.reenviarEntradas({ supabase: fakeDb, conversation }, { referencia: 'bbbbbbbb' })).toHaveProperty('error')
    expect(sendTicketsMock).not.toHaveBeenCalled()

    const ok = await tools.reenviarEntradas({ supabase: fakeDb, conversation }, { referencia: 'aaaaaaaa' })
    expect(ok).toEqual({ ok: true, enviado_a: 'an***@gmail.com' })
    expect(sendTicketsMock).toHaveBeenCalledWith(ORDER_A, { force: true })
  })

  it('reenviar_entradas por correo reenvía solo compras pagadas y responde igual exista o no', async () => {
    const found = await tools.reenviarEntradas({ supabase: fakeDb, conversation }, { correo: 'otra@correo.cl' })
    expect(sendTicketsMock.mock.calls).toEqual([[ORDER_B, { force: true }]])
    sendTicketsMock.mockClear()
    const missing = await tools.reenviarEntradas({ supabase: fakeDb, conversation }, { correo: 'nadie@correo.cl' })
    expect(sendTicketsMock).not.toHaveBeenCalled()
    expect(Object.keys(missing)).toEqual(Object.keys(found))
  })

  it('respeta el límite de reenvíos', async () => {
    rateLimitMock.mockImplementation(async () => ({ allowed: false }))
    expect(await tools.reenviarEntradas({ supabase: fakeDb, conversation }, { referencia: 'aaaaaaaa' })).toHaveProperty('error')
    expect(sendTicketsMock).not.toHaveBeenCalled()
  })
})

describe('herramientas: eventos', () => {
  const future = (days) => {
    const d = new Date(Date.now() + days * 86400_000)
    return d.toISOString().slice(0, 10)
  }

  beforeEach(() => {
    const loc = (city) => ({ display_name: 'Sala', venues: { name: 'Sala', city } })
    fakeDb = createFakeSupabase({
      tables: {
        events: [
          { id: 1, slug: 'jazz-parque', name: 'Jazz en el Parque', description: '<p>Concierto de jazz</p>', status: 'published', accessibility: null },
          { id: 2, slug: 'stand-up', name: 'Noche de Stand Up', description: 'comedia', status: 'published', accessibility: 'public' },
          { id: 3, slug: 'privado', name: 'Jazz privado', status: 'published', accessibility: 'private' },
          { id: 4, slug: 'evento-demo-concierto', name: 'Jazz demo', status: 'published', accessibility: null },
          { id: 5, slug: 'borrador', name: 'Jazz borrador', status: 'draft', accessibility: null },
          { id: 6, slug: 'pasado', name: 'Jazz pasado', status: 'published', accessibility: null },
          { id: 8, slug: 'archivado', name: 'Jazz archivado', status: 'published', accessibility: null, archived_at: '2026-01-01T00:00:00Z' },
        ],
        event_dates: [
          { event_id: 1, date: future(10), start_time: '20:00:00', event_locations: loc('Valparaíso') },
          { event_id: 2, date: future(5), start_time: '21:00:00', event_locations: loc('Santiago') },
          { event_id: 3, date: future(5), start_time: '21:00:00', event_locations: loc('Santiago') },
          { event_id: 4, date: future(5), start_time: '21:00:00', event_locations: loc('Santiago') },
          { event_id: 6, date: '2020-01-01', start_time: '21:00:00', event_locations: loc('Santiago') },
          { event_id: 8, date: future(5), start_time: '21:00:00', event_locations: loc('Santiago') },
        ],
        event_tags: [],
        event_tickets: [
          { id: 11, event_id: 1, ticket_name: 'General', price: 10000, status: 'available' },
          { id: 12, event_id: 1, ticket_name: 'VIP', price: 25000, status: 'available' },
        ],
      },
    })
  })

  it('solo muestra eventos públicos, publicados, próximos y reales', async () => {
    const r = await tools.buscarEventos({ supabase: fakeDb }, {})
    expect(r.resultados.map((e) => e.id).sort()).toEqual([1, 2])
  })

  it('filtra por texto (sin tildes) y ciudad, con precio desde y link', async () => {
    const r = await tools.buscarEventos({ supabase: fakeDb }, { texto: 'JAZZ', ciudad: 'valparaiso' })
    expect(r.resultados).toHaveLength(1)
    expect(r.resultados[0]).toMatchObject({ id: 1, precio: 'desde $10.000 + cargo por servicio', link: 'https://aitickets.cl/eventos/jazz-parque' })
  })

  it('ver_evento acepta links y rechaza referencias raras', async () => {
    expect(tools.parseEventRef('https://aitickets.cl/eventos/jazz-parque?utm=x')).toEqual({ slug: 'jazz-parque' })
    expect(tools.parseEventRef('42')).toEqual({ id: 42 })
    expect(tools.parseEventRef('drop table; --')).toBeNull()
  })
})

describe('herramientas: derivar y registrar productor', () => {
  beforeEach(() => {
    fakeDb = createFakeSupabase({ tables: { aitickets_wa_conversations: [{ id: 'conv_1' }] } })
  })

  it('derivar_a_persona pausa el bot y avisa por Slack', async () => {
    const r = await tools.derivarAPersona({ supabase: fakeDb, conversation: { id: 'conv_1', wa_phone: '56912345678', contact_name: 'Ana' } }, { motivo: 'reembolso', resumen: 'Pide reembolso de Jazz' })
    expect(r.ok).toBe(true)
    expect(Date.parse(fakeDb.tables.aitickets_wa_conversations[0].bot_paused_until)).toBeGreaterThan(Date.now())
    expect(slackMock.mock.calls[0][0]).toContain('+56912345678')
  })

  it('registrar_productor crea el lead con fuente whatsapp y el teléfono de la conversación', async () => {
    const r = await tools.registrarProductor({ supabase: fakeDb, conversation: { id: 'conv_1', wa_phone: '56912345678' } }, { nombre: 'Pía', correo: 'pia@productora.cl', productora: 'Productora X' })
    expect(r.ok).toBe(true)
    expect(createLeadMock.mock.calls[0][1]).toMatchObject({ email: 'pia@productora.cl', phone: '+56912345678', source: 'whatsapp', orgName: 'Productora X' })
    expect(fakeDb.tables.aitickets_wa_conversations[0].lead_id).toBe('lead-1')
  })

  it('registrar_productor exige correo válido', async () => {
    expect(await tools.registrarProductor({ supabase: fakeDb, conversation: { id: 'conv_1' } }, { nombre: 'Pía', correo: 'no-es-correo' })).toHaveProperty('error')
    expect(createLeadMock).not.toHaveBeenCalled()
  })
})

function fakeAnthropic(responses) {
  const calls = []
  return {
    calls,
    beta: { messages: { create: vi.fn(async (req) => { calls.push(structuredClone(req)); return responses.shift() }) } },
  }
}

describe('agente', () => {
  it('ejecuta herramientas y devuelve el texto final; derivar marca handedOff', async () => {
    fakeDb = createFakeSupabase({ tables: { aitickets_wa_conversations: [{ id: 'conv_1' }] } })
    const anthropic = fakeAnthropic([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu1', name: 'derivar_a_persona', input: { motivo: 'reembolso', resumen: 'x' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Listo, te escribirá una persona.' }] },
    ])
    const r = await agent.runAgentTurn({ anthropic, messages: [{ role: 'user', content: 'quiero un reembolso' }], toolCtx: { supabase: fakeDb, conversation: { id: 'conv_1' } } })
    expect(r).toEqual({ text: 'Listo, te escribirá una persona.', handedOff: true })
    expect(anthropic.calls[0]).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'low' } })
    expect(anthropic.calls[1].messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1' })
  })

  it('processConversation responde pendientes, guarda el wamid y respeta la pausa', async () => {
    fakeDb = createFakeSupabase({
      tables: {
        aitickets_wa_conversations: [{ id: 'conv_1', phone_number_id: PHONE_ID, wa_phone: '56912345678' }],
        aitickets_wa_messages: [{ id: 'in1', conversation_id: 'conv_1', wamid: 'wamid.1', direction: 'in', author: 'customer', body: 'hola', processed_at: null, created_at: new Date().toISOString() }],
      },
      rpc: claimRpcs(),
    })
    const anthropic = fakeAnthropic([{ stop_reason: 'end_turn', content: [{ type: 'text', text: '¡Hola! **¿En qué te ayudo?**' }] }])
    const out = await agent.processConversation(fakeDb, 'conv_1', { anthropic })
    expect(out.turns).toBe(1)
    expect(sendTextMock).toHaveBeenCalledWith({ phone: '56912345678', bsuid: undefined, body: '¡Hola! *¿En qué te ayudo?*' }, expect.any(Object))
    const msgs = fakeDb.tables.aitickets_wa_messages
    expect(msgs.find((m) => m.id === 'in1').processed_at).toBeTruthy()
    expect(msgs.find((m) => m.author === 'bot')).toMatchObject({ wamid: 'wamid.out.1', direction: 'out' })
    expect(fakeDb.tables.aitickets_wa_conversations[0].lock_until).toBeNull()

    // Pausado (respondió una persona): marca como procesado sin llamar a Claude
    fakeDb.tables.aitickets_wa_conversations[0].bot_paused_until = new Date(Date.now() + 3600_000).toISOString()
    msgs.push({ id: 'in2', conversation_id: 'conv_1', wamid: 'wamid.2', direction: 'in', author: 'customer', body: 'gracias', processed_at: null, created_at: new Date().toISOString() })
    sendTextMock.mockClear()
    const paused = await agent.processConversation(fakeDb, 'conv_1', { anthropic: fakeAnthropic([]) })
    expect(paused.skipped).toBe('paused')
    expect(sendTextMock).not.toHaveBeenCalled()
    expect(msgs.find((m) => m.id === 'in2').processed_at).toBeTruthy()
  })

  it('no corre si otra ejecución tiene el candado', async () => {
    fakeDb = createFakeSupabase({
      tables: { aitickets_wa_conversations: [{ id: 'conv_1', lock_until: new Date(Date.now() + 60_000).toISOString() }], aitickets_wa_messages: [] },
      rpc: claimRpcs(),
    })
    const anthropic = fakeAnthropic([])
    expect((await agent.processConversation(fakeDb, 'conv_1', { anthropic })).skipped).toBe('locked')
    expect(anthropic.beta.messages.create).not.toHaveBeenCalled()
  })

  it('el prompt de sistema usa los cargos reales de fees.mjs', () => {
    const s = agent.buildSystemPrompt('2026-10-12')
    expect(s).toContain('8% + IVA')
    expect(s).toContain('$10.000')
    expect(s).toContain('/organizadores/registro')
  })
})
