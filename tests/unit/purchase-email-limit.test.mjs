// El límite durable por email del comprador (purchase:email) se cuenta SOLO después de pasar Turnstile:
// solicitudes sin captcha válido no deben agotar el cupo de un comprador real.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rateLimitMock = vi.fn(async () => ({ allowed: true, source: 'db' }))
const verifyTurnstileMock = vi.fn()

vi.mock('../../netlify/lib/rate-limit.mjs', () => ({ rateLimit: (...a) => rateLimitMock(...a) }))
vi.mock('../../netlify/lib/turnstile.mjs', () => ({
  verifyTurnstile: (...a) => verifyTurnstileMock(...a),
  isTurnstileEnabled: () => true,
  turnstileSiteKey: () => 'site-key',
}))
vi.mock('../../netlify/lib/supabase.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getSupabaseAdmin: () => {
      throw new Error('stop-after-limits')
    },
  }
})

const { default: handler } = await import('../../netlify/functions/purchase-tickets/index.mjs')

function purchaseRequest(ip, extra = {}) {
  return new Request('https://example.test/api/purchase-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nf-client-connection-ip': ip },
    body: JSON.stringify({
      eventId: 1,
      buyer: { firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.com' },
      tickets: [{ id: 1, quantity: 1 }],
      termsAccepted: true,
      ...extra,
    }),
  })
}

const emailCalls = () => rateLimitMock.mock.calls.filter(([bucket]) => bucket === 'purchase:email')

beforeEach(() => {
  rateLimitMock.mockClear()
  verifyTurnstileMock.mockReset()
})

describe('purchase-tickets: límite por email después del captcha', () => {
  it('un captcha fallido responde 403 y no consume el cupo del email', async () => {
    verifyTurnstileMock.mockResolvedValue({ success: false, message: 'Completa la verificación de seguridad (CAPTCHA).' })
    for (let i = 0; i < 16; i++) {
      const res = await handler(purchaseRequest(`198.51.100.${i}`))
      expect(res.status).toBe(403)
    }
    expect(emailCalls()).toHaveLength(0)
    // El límite por IP sí se sigue contando antes del body
    expect(rateLimitMock.mock.calls.filter(([b]) => b === 'purchase:ip')).toHaveLength(16)
  })

  it('con captcha válido se cuenta el email (normalizado) y el 429 corta antes de tocar la BD', async () => {
    verifyTurnstileMock.mockResolvedValue({ success: true })
    rateLimitMock.mockImplementation(async (bucket) => ({ allowed: bucket !== 'purchase:email', source: 'db' }))
    const res = await handler(purchaseRequest('203.0.113.9', { cfToken: 'ok' }))
    expect(res.status).toBe(429)
    expect(emailCalls()).toHaveLength(1)
    expect(emailCalls()[0][1]).toBe('ana@example.com')
    expect(verifyTurnstileMock).toHaveBeenCalledTimes(1)
    rateLimitMock.mockImplementation(async () => ({ allowed: true, source: 'db' }))
  })
})
