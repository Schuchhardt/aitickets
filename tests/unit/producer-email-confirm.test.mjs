// Confirmación del correo del productor en Supabase Auth (proyecto compartido con otras apps):
// - /api/auth/register crea la cuenta con email_confirm:false y NO inicia sesión.
// - Solo el enlace de verificación (confirmProducerEmail) confirma la cuenta en Auth, ANTES de marcar la
//   organización, y nunca toca la confirmación de una identidad de otra app.
// - /api/auth/login traduce "Email not confirmed" de Supabase a email_not_verified (con reenvío).
// Sin red ni BD: el cliente de Supabase es un doble en memoria.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  admin: null,
  ephemeral: null,
}))

vi.mock('../../src/lib/auth-helpers', () => ({
  getSupabaseAdmin: () => state.admin,
  createEphemeralAuthClient: () => state.ephemeral,
  getFriendlyErrorMessage: (e) => e?.message || 'error',
}))
vi.mock('../../src/lib/sites', () => ({
  ensureOrgSite: vi.fn(async () => ({ slug: 'productora' })),
  invalidateSiteCache: vi.fn(),
}))
vi.mock('../../netlify/lib/mailer.mjs', () => ({ sendEmail: vi.fn(async () => ({ id: 'x' })) }))
vi.mock('../../netlify/lib/emails/index.mjs', () => ({
  renderVerifyEmail: vi.fn(async () => ({ subject: 's', html: 'h', text: 't' })),
}))
vi.mock('../../src/lib/turnstile', () => ({ verifyTurnstileToken: vi.fn(async () => ({ success: true })) }))
vi.mock('../../src/pages/api/_lib/server-utils', () => ({
  createEphemeralAuthClient: () => state.ephemeral,
  notifySlack: vi.fn(async () => {}),
}))

const { confirmProducerEmail, signEmailVerifyToken } = await import('../../src/lib/email-verification.ts')
const { POST: register } = await import('../../src/pages/api/auth/register.ts')
const { POST: login } = await import('../../src/pages/api/auth/login.ts')

const UID = '11111111-2222-3333-4444-555555555555'
const EMAIL = 'productora@example.cl'

/** Doble del query builder de PostgREST: registra cada operación y responde según `tables`. */
function fakeAdmin({ authUser = null, tables = {}, updateUserError = null, createUser = null } = {}) {
  const log = []
  const from = (table) => {
    const op = { table, action: 'select', payload: null, filters: [] }
    const result = () => {
      log.push(op)
      const handler = tables[table]
      return handler ? handler(op) : { data: null, error: null }
    }
    const b = {
      select() { return b },
      insert(p) { op.action = 'insert'; op.payload = p; return b },
      update(p) { op.action = 'update'; op.payload = p; return b },
      delete() { op.action = 'delete'; return b },
      eq(c, v) { op.filters.push(['eq', c, v]); return b },
      is(c, v) { op.filters.push(['is', c, v]); return b },
      maybeSingle: async () => result(),
      single: async () => result(),
      then(res, rej) { return Promise.resolve(result()).then(res, rej) },
    }
    return b
  }
  const auth = {
    admin: {
      getUserById: vi.fn(async () => ({ data: { user: authUser }, error: authUser ? null : { message: 'not found' } })),
      updateUserById: vi.fn(async () => {
        log.push({ table: 'auth', action: 'confirm' })
        return { data: {}, error: updateUserError }
      }),
      createUser: vi.fn(async () => createUser || { data: { user: { id: UID } }, error: null }),
      deleteUser: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      generateLink: vi.fn(async () => ({ data: null, error: { message: 'no debería llamarse' } })),
    },
  }
  return { from, auth, log }
}

const orgTables = ({ verified = false } = {}) => ({
  users: () => ({ data: { id: 7, organization_id: 42 }, error: null }),
  organizations: (op) => {
    if (op.action === 'select') {
      return { data: { id: 42, email_verified_at: verified ? '2026-09-01T00:00:00Z' : null, terms_accepted_at: '2026-09-28T00:00:00Z', public_name: 'Productora' }, error: null }
    }
    return { data: null, error: null }
  },
})

beforeEach(() => {
  vi.stubEnv('EMAIL_VERIFY_SECRET', 'test-email-verify-secret-0123456789')
  state.admin = null
  state.ephemeral = null
})

describe('confirmProducerEmail', () => {
  it('confirma en Auth la cuenta de AI Tickets ANTES de marcar la organización', async () => {
    const admin = fakeAdmin({
      authUser: { id: UID, email: EMAIL, email_confirmed_at: null, app_metadata: { app: 'aitickets' } },
      tables: orgTables(),
    })
    state.admin = admin
    const res = await confirmProducerEmail(signEmailVerifyToken(UID, EMAIL))
    expect(res).toMatchObject({ ok: true, alreadyVerified: false, authConfirmed: true, uid: UID, email: EMAIL })
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledWith(UID, { email_confirm: true })
    const confirmIdx = admin.log.findIndex((o) => o.action === 'confirm')
    const markIdx = admin.log.findIndex((o) => o.table === 'organizations' && o.action === 'update' && o.payload?.email_verified_at)
    expect(confirmIdx).toBeGreaterThanOrEqual(0)
    expect(markIdx).toBeGreaterThan(confirmIdx)
  })

  it('si no se puede confirmar en Auth, no marca la organización', async () => {
    const admin = fakeAdmin({
      authUser: { id: UID, email: EMAIL, email_confirmed_at: null, app_metadata: { app: 'aitickets' } },
      tables: orgTables(),
      updateUserError: { message: 'boom' },
    })
    state.admin = admin
    const res = await confirmProducerEmail(signEmailVerifyToken(UID, EMAIL))
    expect(res).toEqual({ ok: false, error: 'server' })
    expect(admin.log.some((o) => o.table === 'organizations' && o.action === 'update')).toBe(false)
  })

  it('no toca la confirmación de una identidad de otra app (camino de recuperación del registro)', async () => {
    const admin = fakeAdmin({
      authUser: { id: UID, email: EMAIL, email_confirmed_at: null, app_metadata: { provider: 'email' } },
      tables: orgTables(),
    })
    state.admin = admin
    const res = await confirmProducerEmail(signEmailVerifyToken(UID, EMAIL))
    expect(res).toMatchObject({ ok: true, authConfirmed: false })
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled()
    expect(admin.log.some((o) => o.table === 'organizations' && o.action === 'update' && o.payload?.email_verified_at)).toBe(true)
  })

  it('una cuenta ya confirmada no se vuelve a confirmar', async () => {
    const admin = fakeAdmin({
      authUser: { id: UID, email: EMAIL, email_confirmed_at: '2026-09-01T00:00:00Z', app_metadata: { app: 'aitickets' } },
      tables: orgTables({ verified: true }),
    })
    state.admin = admin
    const res = await confirmProducerEmail(signEmailVerifyToken(UID, EMAIL))
    expect(res).toMatchObject({ ok: true, alreadyVerified: true, authConfirmed: true })
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('el enlace enviado a otro correo no confirma nada', async () => {
    const admin = fakeAdmin({
      authUser: { id: UID, email: 'otra@example.cl', email_confirmed_at: null, app_metadata: { app: 'aitickets' } },
      tables: orgTables(),
    })
    state.admin = admin
    const res = await confirmProducerEmail(signEmailVerifyToken(UID, EMAIL))
    expect(res).toEqual({ ok: false, error: 'invalid' })
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled()
  })
})

const jsonRequest = (url, body) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function apiContext(request) {
  const cookies = { set: vi.fn(), delete: vi.fn(), get: vi.fn() }
  return { request, cookies, url: new URL(request.url), locals: {} }
}

describe('/api/auth/register', () => {
  const body = {
    email: 'Productora@Example.cl',
    password: 'Secreta123!',
    name: 'Ana',
    organizationName: 'Productora',
    acceptedTerms: true,
    cfToken: 'ok',
  }

  it('crea la cuenta SIN confirmar (app_metadata aitickets) y no inicia sesión', async () => {
    const admin = fakeAdmin({
      tables: {
        organizations: () => ({ data: { id: 42 }, error: null }),
        users: () => ({ data: null, error: null }),
      },
    })
    state.admin = admin
    const signIn = vi.fn()
    state.ephemeral = { auth: { signInWithPassword: signIn } }
    const ctx = apiContext(jsonRequest('https://aitickets.cl/api/auth/register', body))
    const res = await register(ctx)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data).toMatchObject({ ok: true, needsVerification: true, emailSent: true })
    expect(admin.auth.admin.createUser).toHaveBeenCalledTimes(1)
    const args = admin.auth.admin.createUser.mock.calls[0][0]
    expect(args.email).toBe('productora@example.cl')
    expect(args.email_confirm).toBe(false)
    expect(args.app_metadata).toEqual({ app: 'aitickets' })
    // Sin sesión: ni login con contraseña, ni magic link, ni cookies, ni confirmación en Auth
    expect(signIn).not.toHaveBeenCalled()
    expect(admin.auth.admin.generateLink).not.toHaveBeenCalled()
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled()
    expect(ctx.cookies.set).not.toHaveBeenCalled()
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('cuenta de Auth existente de otra app: exige la contraseña y no cambia su confirmación', async () => {
    const admin = fakeAdmin({
      createUser: { data: { user: null }, error: { message: 'A user with this email address has already been registered' } },
      tables: {
        organizations: () => ({ data: { id: 42 }, error: null }),
        users: () => ({ data: null, error: null }),
      },
    })
    state.admin = admin
    const signIn = vi.fn(async () => ({ data: { user: null, session: null }, error: { message: 'Invalid login credentials' } }))
    state.ephemeral = { auth: { signInWithPassword: signIn } }
    const res = await register(apiContext(jsonRequest('https://aitickets.cl/api/auth/register', body)))
    expect(res.status).toBe(400)
    expect(signIn).toHaveBeenCalledWith({ email: 'productora@example.cl', password: 'Secreta123!' })
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled()
    expect(admin.log.some((o) => o.table === 'organizations' && o.action === 'insert')).toBe(false)
  })

  it('camino de recuperación con la contraseña correcta: completa el registro sin confirmar en Auth', async () => {
    const admin = fakeAdmin({
      createUser: { data: { user: null }, error: { message: 'User already registered' } },
      tables: {
        organizations: () => ({ data: { id: 42 }, error: null }),
        users: () => ({ data: null, error: null }),
      },
    })
    state.admin = admin
    const signIn = vi.fn(async () => ({ data: { user: { id: UID }, session: { access_token: 'a', refresh_token: 'r' } }, error: null }))
    state.ephemeral = { auth: { signInWithPassword: signIn } }
    const ctx = apiContext(jsonRequest('https://aitickets.cl/api/auth/register', body))
    const res = await register(ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ needsVerification: true })
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled()
    expect(ctx.cookies.set).not.toHaveBeenCalled()
  })
})

describe('/api/auth/register — registro en dos pasos', () => {
  it('solo correo y contraseña: organización con nombre provisorio, onboarding pendiente y next firmado en el enlace', async () => {
    const admin = fakeAdmin({
      tables: {
        organizations: () => ({ data: { id: 42 }, error: null }),
        users: () => ({ data: null, error: null }),
      },
    })
    state.admin = admin
    state.ephemeral = { auth: { signInWithPassword: vi.fn() } }
    const { sendEmail } = await import('../../netlify/lib/mailer.mjs')
    const { renderVerifyEmail } = await import('../../netlify/lib/emails/index.mjs')
    renderVerifyEmail.mockClear()
    const res = await register(apiContext(jsonRequest('https://aitickets.cl/api/auth/register', {
      email: 'nueva@prod.cl', password: 'Secreta123', acceptedTerms: true, cfToken: 'ok', next: '/dashboard/ia',
    })))
    expect(res.status).toBe(200)
    const orgInsert = admin.log.find((o) => o.table === 'organizations' && o.action === 'insert')
    expect(orgInsert.payload).toMatchObject({ public_name: 'Mi productora', onboarding_pending: true, email: 'nueva@prod.cl' })
    const userInsert = admin.log.find((o) => o.table === 'users' && o.action === 'insert')
    expect(userInsert.payload).toMatchObject({ name: null, organization_id: 42 })
    // El sitio se crea al completar el onboarding (con el nombre real)
    const { ensureOrgSite } = await import('../../src/lib/sites')
    expect(ensureOrgSite).not.toHaveBeenCalledWith(42, 'Mi productora')
    // El enlace del correo lleva el destino firmado
    const url = renderVerifyEmail.mock.calls.at(-1)[0].url
    const token = new URL(url).searchParams.get('t')
    const { verifyEmailVerifyToken } = await import('../../src/lib/email-verification.ts')
    expect(verifyEmailVerifyToken(token)).toMatchObject({ ok: true, next: '/dashboard/ia' })
    expect(sendEmail).toHaveBeenCalled()
  })

  it('rechaza correo inválido o contraseña corta', async () => {
    state.admin = fakeAdmin()
    const bad = await register(apiContext(jsonRequest('https://aitickets.cl/api/auth/register', { email: 'x', password: 'Secreta123', acceptedTerms: true, cfToken: 'ok' })))
    expect(bad.status).toBe(400)
    const short = await register(apiContext(jsonRequest('https://aitickets.cl/api/auth/register', { email: 'a@b.cl', password: '123', acceptedTerms: true, cfToken: 'ok' })))
    expect(short.status).toBe(400)
    expect(state.admin.auth.admin.createUser).not.toHaveBeenCalled()
  })
})

describe('/api/auth/login', () => {
  it('"Email not confirmed" de Supabase => 403 email_not_verified con reenvío', async () => {
    state.admin = fakeAdmin()
    state.ephemeral = {
      auth: {
        signInWithPassword: vi.fn(async () => ({
          data: { user: null, session: null },
          error: { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 },
        })),
      },
    }
    const ctx = apiContext(jsonRequest('https://aitickets.cl/api/auth/login', { email: EMAIL, password: 'x' }))
    const res = await login(ctx)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'email_not_verified', canResend: true })
    expect(ctx.cookies.set).not.toHaveBeenCalled()
  })

  it('también reconoce el mensaje sin código (versiones antiguas de GoTrue)', async () => {
    state.admin = fakeAdmin()
    state.ephemeral = {
      auth: { signInWithPassword: vi.fn(async () => ({ data: { user: null, session: null }, error: { message: 'Email not confirmed' } })) },
    }
    const res = await login(apiContext(jsonRequest('https://aitickets.cl/api/auth/login', { email: EMAIL, password: 'x' })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('email_not_verified')
  })

  it('credenciales inválidas siguen siendo 401 (sin ofrecer reenvío)', async () => {
    state.admin = fakeAdmin()
    state.ephemeral = {
      auth: { signInWithPassword: vi.fn(async () => ({ data: { user: null, session: null }, error: { message: 'Invalid login credentials', code: 'invalid_credentials' } })) },
    }
    const res = await login(apiContext(jsonRequest('https://aitickets.cl/api/auth/login', { email: EMAIL, password: 'x' })))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBeUndefined()
  })
})
