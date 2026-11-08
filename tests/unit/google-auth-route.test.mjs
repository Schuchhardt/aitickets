// GET /api/auth/google: inicia "Continuar con Google". La cuenta que resulta (ensureGoogleProducer: dueño 'producer'
// de su organización nueva) se prueba en signup-onboarding.test.mjs; aquí, el inicio del flujo.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ enabled: true, startGoogleAuth: vi.fn() }))
vi.mock('../../src/lib/google-auth', () => ({
  GOOGLE_STATE_COOKIE: 'aitk_google',
  isGoogleAuthEnabled: () => mocks.enabled,
  startGoogleAuth: mocks.startGoogleAuth,
  encodeGoogleState: (s) => `enc:${JSON.stringify(s)}`,
}))
vi.mock('../../src/lib/lead-token', () => ({
  verifyLeadToken: (t) => (t === 'lead-ok' ? { leadId: 42 } : null),
}))

const { GET } = await import('../../src/pages/api/auth/google.ts')

const call = (qs = '') => {
  const cookies = { set: vi.fn() }
  const redirect = vi.fn((to, status) => ({ to, status }))
  const url = new URL(`https://aitickets.test/api/auth/google${qs}`)
  return { res: GET({ url, cookies, redirect }), cookies, redirect }
}

beforeEach(() => {
  mocks.enabled = true
  mocks.startGoogleAuth.mockReset().mockResolvedValue({ url: 'https://supabase.test/auth/v1/authorize?provider=google', state: { v: 'verifier', next: null } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/auth/google', () => {
  it('apagado: vuelve al registro con error, conservando solo un next seguro', async () => {
    mocks.enabled = false
    expect(await call('?next=/dashboard/ia').res).toEqual({ to: '/organizadores/registro?error=google&next=%2Fdashboard%2Fia', status: 303 })
    expect(await call('?next=https://evil.com').res).toEqual({ to: '/organizadores/registro?error=google', status: 303 })
    expect(mocks.startGoogleAuth).not.toHaveBeenCalled()
  })

  it('redirige a Google con el verifier en una cookie httpOnly acotada a /auth/google', async () => {
    const { res, cookies } = call('?next=/dashboard&utm_source=ig&utm_campaign=x&lead=lead-ok')
    expect(await res).toEqual({ to: 'https://supabase.test/auth/v1/authorize?provider=google', status: 303 })
    expect(mocks.startGoogleAuth).toHaveBeenCalledWith('https://aitickets.test', {
      next: '/dashboard',
      attribution: { utm_source: 'ig', utm_campaign: 'x' },
      lead: '42',
    })
    const [name, value, opts] = cookies.set.mock.calls[0]
    expect(name).toBe('aitk_google')
    expect(value).toMatch(/^enc:/)
    expect(opts).toMatchObject({ path: '/auth/google', httpOnly: true, sameSite: 'lax', maxAge: 600 })
  })

  it('un lead inválido no se atribuye y un next externo se descarta', async () => {
    await call('?next=//evil.com&lead=falso').res
    expect(mocks.startGoogleAuth).toHaveBeenCalledWith('https://aitickets.test', { next: null, attribution: {}, lead: null })
  })

  it('si Supabase falla, vuelve al registro sin cookie', async () => {
    mocks.startGoogleAuth.mockRejectedValue(new Error('down'))
    const { res, cookies } = call()
    expect(await res).toEqual({ to: '/organizadores/registro?error=google', status: 303 })
    expect(cookies.set).not.toHaveBeenCalled()
  })
})
