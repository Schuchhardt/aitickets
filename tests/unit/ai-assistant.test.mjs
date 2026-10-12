// Asistente de la página del evento: el prompt se arma con netlify/lib/event-context.mjs.
// Regresión: buildSystemPrompt usaba feeAbsorbed fuera de su alcance (ReferenceError => 500 en cada mensaje).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const createMock = vi.fn()
let fakeDb

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    constructor() {
      this.beta = { messages: { create: (...a) => createMock(...a) } }
    }
  }
  Anthropic.RateLimitError = class extends Error {}
  return { default: Anthropic }
})
vi.mock('../../netlify/lib/rate-limit.mjs', () => ({ rateLimit: async () => ({ allowed: true }) }))
vi.mock('../../netlify/lib/supabase.mjs', async (importOriginal) => ({ ...(await importOriginal()), getSupabaseAdmin: () => fakeDb }))

const { default: handler } = await import('../../netlify/functions/ai-assistant/index.mjs')

const request = (body) => new Request('https://aitickets.test/api/ai-assistant', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': '203.0.113.5' },
  body: JSON.stringify(body),
})

describe('ai-assistant', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    createMock.mockReset().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hola' }] })
  })

  for (const feeAbsorbed of [false, true]) {
    it(`responde con entradas pagadas (fee_absorbed=${feeAbsorbed})`, async () => {
      fakeDb = createFakeSupabase({
        tables: {
          events: [{ id: 9, slug: 'jazz', name: 'Jazz', description: 'desc', status: 'published', fee_absorbed: feeAbsorbed }],
          event_dates: [],
          event_tickets: [{ id: 1, event_id: 9, ticket_name: 'General', price: 10000, status: 'available' }],
          event_faqs: [],
        },
      })
      const res = await handler(request({ eventId: 9, messages: [{ role: 'user', text: '¿cuánto cuesta?' }] }), {})
      expect(res.status).toBe(200)
      expect((await res.json()).message).toBe('Hola')
      const { system } = createMock.mock.calls[0][0]
      expect(system).toContain('Información del evento (ID 9)')
      expect(system).toContain(feeAbsorbed ? 'cargo por servicio está incluido' : 'cargo por servicio del 8%')
    })
  }
})
