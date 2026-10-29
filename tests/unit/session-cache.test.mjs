// Caché corta de getSessionContext (src/lib/supabaseServer.ts): al navegar entre secciones del panel la sesión se
// valida contra Supabase Auth una vez cada 30 s por token, y el logout o un cambio del usuario la invalidan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const getUser = vi.fn()

vi.mock('../../src/lib/auth-helpers', () => ({
  getSupabaseAdmin: () => Object.assign(db, { auth: { getUser } }),
  getSupabaseAnon: () => db,
  createEphemeralAuthClient: () => db,
}))

const { getSessionContext, forgetCachedSession, forgetCachedSessionsOfUser } = await import('../../src/lib/supabaseServer.ts')

const ctx = (token) => ({ cookies: { get: (name) => (name === 'sb-access-token' && token ? { value: token } : undefined) } })

beforeEach(() => {
  vi.useFakeTimers()
  db = createFakeSupabase({
    tables: {
      users: [{ id: 1, auth_user_id: 'auth-1', name: 'Ana', email: 'ana@x.cl', organization_id: 7, role: 'producer', active: true }],
      organizations: [{ id: 7, email_verified_at: '2026-01-01T00:00:00Z', terms_accepted_at: '2026-01-01T00:00:00Z' }],
    },
  })
  getUser.mockReset()
  getUser.mockImplementation(async (token) => (token.startsWith('ok') ? { data: { user: { id: 'auth-1' } }, error: null } : { data: { user: null }, error: { message: 'bad' } }))
})

afterEach(() => vi.useRealTimers())

describe('getSessionContext con caché', () => {
  it('valida el token una vez y lo reutiliza hasta que vence (30 s)', async () => {
    const first = await getSessionContext(ctx('ok-a'))
    expect(first.dbUser).toMatchObject({ id: 1, organization_id: 7 })
    await getSessionContext(ctx('ok-a'))
    expect(getUser).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(31_000)
    await getSessionContext(ctx('ok-a'))
    expect(getUser).toHaveBeenCalledTimes(2)
  })

  it('no guarda sesiones inválidas', async () => {
    expect(await getSessionContext(ctx('bad-1'))).toBeNull()
    expect(await getSessionContext(ctx('bad-1'))).toBeNull()
    expect(getUser).toHaveBeenCalledTimes(2)
    expect(await getSessionContext(ctx(null))).toBeNull()
  })

  it('logout y cambios del usuario la invalidan', async () => {
    await getSessionContext(ctx('ok-b'))
    forgetCachedSession('ok-b')
    await getSessionContext(ctx('ok-b'))
    expect(getUser).toHaveBeenCalledTimes(2)
    forgetCachedSessionsOfUser(1)
    db.tables.users[0].active = false
    expect(await getSessionContext(ctx('ok-b'))).toBeNull()
    expect(getUser).toHaveBeenCalledTimes(3)
  })
})
