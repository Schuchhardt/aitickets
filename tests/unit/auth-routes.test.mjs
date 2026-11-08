// Rutas de autenticación del productor: /api/auth/logout, /api/auth/session, /api/auth/set-password,
// /api/auth/verify-email, /api/auth/resend-verification, /api/auth/magic-link, /api/auth/change-password (retirada,
// 410) y la revocación OAuth (/api/oauth/revoke, RFC 7009).
// La sesión es la REAL de src/lib/supabaseServer.ts (cookies + Supabase Auth + fila en public.users + organización
// verificada) sobre el doble en memoria de Supabase: así se prueba también que el logout invalida la caché de
// sesiones. Correo, CAPTCHA y la confirmación del correo son dobles. Sin red ni BD.
//
// Ojo: resend-verification y magic-link guardan sus límites por IP / correo / usuario en memoria del módulo, que
// sobrevive entre tests: cada test usa una IP y correos propios (nextIp / uniqueEmail).
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { fakePassword, fakeSecret } from '../fixtures/fake-credentials.mjs'

const NEW_PW = fakePassword('nueva')
const OLD_PW = fakePassword('old')
const CLIENT_SECRET = fakeSecret('aits')
const EMAIL_VERIFY_SECRET = fakeSecret('ev')
const BUYER_SECRET = fakeSecret('buyer')

const state = vi.hoisted(() => ({ ephemeral: null }))
let db

vi.mock('../../src/lib/auth-helpers', () => ({
  getSupabaseAdmin: () => db,
  createEphemeralAuthClient: () => state.ephemeral,
  getFriendlyErrorMessage: (e) => String(e?.message || e),
}))
vi.mock('../../netlify/lib/mailer.mjs', () => ({
  sendEmail: vi.fn(async () => ({ id: 'email_1' })),
  isValidEmail: (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
  formatRecipient: (name, email) => (name ? `${name} <${email}>` : email),
}))
vi.mock('../../src/lib/email-verification', async (importOriginal) => ({
  ...(await importOriginal()),
  confirmProducerEmail: vi.fn(),
  sendVerificationEmail: vi.fn(async () => ({ id: 'verify_1' })),
}))
vi.mock('../../src/lib/magic-link', async (importOriginal) => ({
  ...(await importOriginal()),
  sendMagicLinkEmail: vi.fn(async () => ({ id: 'link_1' })),
}))
vi.mock('../../src/lib/turnstile', () => ({ verifyTurnstileToken: vi.fn(async () => ({ success: true })) }))

const logoutRoute = await import('../../src/pages/api/auth/logout.ts')
const { GET: sessionGET } = await import('../../src/pages/api/auth/session.ts')
const { POST: setPasswordPOST } = await import('../../src/pages/api/auth/set-password.ts')
const verifyEmailRoute = await import('../../src/pages/api/auth/verify-email.ts')
const { POST: resendPOST } = await import('../../src/pages/api/auth/resend-verification.ts')
const { POST: magicLinkPOST } = await import('../../src/pages/api/auth/magic-link.ts')
const changePasswordRoute = await import('../../src/pages/api/auth/change-password.ts')
const revokeRoute = await import('../../src/pages/api/oauth/revoke.ts')
const { getSessionContext } = await import('../../src/lib/supabaseServer.ts')
const { confirmProducerEmail, sendVerificationEmail } = await import('../../src/lib/email-verification')
const { sendMagicLinkEmail, signPwResetCookie, PW_RESET_COOKIE } = await import('../../src/lib/magic-link')
const { verifyTurnstileToken } = await import('../../src/lib/turnstile')
const { signBuyerSession } = await import('../../netlify/lib/buyer-session.mjs')
const { hashApiKey } = await import('../../src/lib/producer-api/keys.ts')

const ORIGIN = 'https://aitickets.test'
const AITICKETS = { app: 'aitickets' }

// ---------- dobles ----------
let accounts // usuarios de Supabase Auth por id
let tokens // access token -> id de Auth
let seq = 0
const nextIp = () => `198.51.100.${++seq % 250}-${seq}`
const uniqueEmail = (prefix = 'p') => `${prefix}${++seq}@prod.cl`

/** Inicia sesión: un access token nuevo (único en todo el archivo, por la caché de sesiones de 30 s). */
const loginToken = (authId) => {
  const t = `tok-${++seq}`
  tokens.set(t, authId)
  return t
}

function cookieJar(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    get: vi.fn((name) => (store.has(name) ? { value: store.get(name) } : undefined)),
    set: vi.fn((name, value) => { store.set(name, value) }),
    delete: vi.fn((name) => { store.delete(name) }),
    has: (name) => store.has(name),
  }
}

async function call(handler, { method = 'POST', body, raw, contentType = 'application/json', headers = {}, cookies = cookieJar(), path = '/api/auth/x', locals = {} } = {}) {
  const url = new URL(`${ORIGIN}${path}`)
  const init = { method, headers: { ...(contentType ? { 'content-type': contentType } : {}), ...headers } }
  if (!['GET', 'OPTIONS'].includes(method)) init.body = raw ?? JSON.stringify(body ?? {})
  const res = await handler({
    request: new Request(url, init),
    url,
    cookies,
    locals,
    redirect: (to, status = 302) => new Response(null, { status, headers: { Location: to } }),
  })
  const text = await res.text()
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  return { status: res.status, body: parsed, headers: res.headers, cookies }
}

const writes = (table) => db.calls.filter((c) => c.table === table && c.op !== 'select')

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('EMAIL_VERIFY_SECRET', EMAIL_VERIFY_SECRET)
  accounts = {
    au1: { id: 'au1', email: 'ana@prod.cl', app_metadata: AITICKETS, user_metadata: {}, email_confirmed_at: '2026-01-01T00:00:00Z' },
    au2: { id: 'au2', email: 'bea@prod.cl', app_metadata: AITICKETS, user_metadata: {} },
    au3: { id: 'au3', email: 'sin-org@mail.cl', app_metadata: AITICKETS, user_metadata: {} },
    au4: { id: 'au4', email: 'nueva@prod.cl', app_metadata: AITICKETS, user_metadata: {} },
    // Identidad de otra app del proyecto Auth compartido, sin fila en public.users
    au5: { id: 'au5', email: 'otra@app.cl', app_metadata: { provider: 'email', app: 'otra-app' }, user_metadata: {} },
    au20: { id: 'au20', email: 'out@otra.cl', app_metadata: AITICKETS, user_metadata: {} },
  }
  tokens = new Map()
  db = createFakeSupabase({
    tables: {
      organizations: [
        { id: 7, public_name: '  Prod SpA ', email_verified_at: '2026-01-01T00:00:00Z' },
        { id: 8, public_name: 'Otra Productora', email_verified_at: '2026-01-01T00:00:00Z' },
        { id: 9, public_name: 'Nueva Prod', email_verified_at: null, terms_accepted_at: '2026-10-01T00:00:00Z', onboarding_pending: false },
      ],
      users: [
        { id: 1, name: 'Ana María Pérez', email: 'ana@prod.cl', organization_id: 7, role: 'producer', active: true, auth_user_id: 'au1' },
        { id: 2, name: 'Bea', email: 'bea@prod.cl', organization_id: 7, role: 'admin', active: false, auth_user_id: 'au2' },
        { id: 3, name: 'Sin Org', email: 'sin-org@mail.cl', organization_id: null, role: null, active: true, auth_user_id: 'au3' },
        { id: 4, name: 'Nueva', email: 'nueva@prod.cl', organization_id: 9, role: 'producer', active: true, auth_user_id: 'au4' },
        { id: 20, name: 'Out', email: 'out@otra.cl', organization_id: 8, role: 'producer', active: true, auth_user_id: 'au20' },
      ],
      aitickets_auth_link_sends: [],
    },
    // sent_at tiene DEFAULT now() en la BD
    defaults: { aitickets_auth_link_sends: { sent_at: new Date().toISOString() } },
  })
  db.auth = {
    getUser: vi.fn(async (token) => {
      const u = accounts[tokens.get(token)]
      return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }
    }),
    admin: {
      getUserById: vi.fn(async (id) => (accounts[id] ? { data: { user: accounts[id] }, error: null } : { data: { user: null }, error: { message: 'User not found' } })),
      updateUserById: vi.fn(async (id) => ({ data: { user: accounts[id] }, error: null })),
      signOut: vi.fn(async () => ({ data: {}, error: null })),
    },
  }
})

// ---------------------------------------------------------------------------------------------------------------
describe('POST /api/auth/logout', () => {
  it('revoca la sesión en Supabase y borra las cookies de sesión y la pista', async () => {
    const token = loginToken('au1')
    const cookies = cookieJar({ 'sb-access-token': token, 'sb-refresh-token': 'rt', ait_p: '1', otra: 'x' })
    const r = await call(logoutRoute.POST, { cookies })
    expect(r.status).toBe(200)
    expect(db.auth.admin.signOut).toHaveBeenCalledWith(token)
    for (const name of ['sb-access-token', 'sb-refresh-token', 'ait_p']) {
      expect(cookies.delete).toHaveBeenCalledWith(name, { path: '/' })
      expect(cookies.has(name)).toBe(false)
    }
    expect(cookies.has('otra')).toBe(true)
  })

  it('sin sesión: igual responde 200 y limpia, sin llamar a Supabase', async () => {
    const cookies = cookieJar({ ait_p: '1' })
    const r = await call(logoutRoute.POST, { cookies })
    expect(r.status).toBe(200)
    expect(db.auth.admin.signOut).not.toHaveBeenCalled()
    expect(cookies.has('ait_p')).toBe(false)
  })

  it('si Supabase falla al revocar (error o excepción), igual cierra la sesión local', async () => {
    db.auth.admin.signOut.mockResolvedValueOnce({ error: { message: 'session not found' } })
    let cookies = cookieJar({ 'sb-access-token': loginToken('au1') })
    expect((await call(logoutRoute.POST, { cookies })).status).toBe(200)
    expect(cookies.has('sb-access-token')).toBe(false)

    db.auth.admin.signOut.mockRejectedValueOnce(new Error('red'))
    cookies = cookieJar({ 'sb-access-token': loginToken('au1') })
    expect((await call(logoutRoute.POST, { cookies })).status).toBe(200)
    expect(cookies.has('sb-access-token')).toBe(false)
  })

  it('invalida la sesión en caché: el mismo token se vuelve a validar contra Auth después del logout', async () => {
    const token = loginToken('au1')
    const ctx = { cookies: cookieJar({ 'sb-access-token': token }) }
    expect((await getSessionContext(ctx))?.dbUser.id).toBe(1)
    expect((await getSessionContext(ctx))?.dbUser.id).toBe(1)
    expect(db.auth.getUser).toHaveBeenCalledTimes(1) // la segunda vino de la caché

    await call(logoutRoute.POST, { cookies: cookieJar({ 'sb-access-token': token }) })
    tokens.delete(token) // Supabase ya no acepta el token revocado
    expect(await getSessionContext(ctx)).toBeNull()
    expect(db.auth.getUser).toHaveBeenCalledTimes(2)
  })

  it('solo POST (un GET de terceros no puede cerrar la sesión)', () => {
    expect(logoutRoute.GET).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('GET /api/auth/session', () => {
  const get = (cookies) => call(sessionGET, { method: 'GET', cookies })

  it('sin cookies: nadie, sin consultar la BD, y sin caché compartida', async () => {
    const r = await get(cookieJar())
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ producer: null, buyer: null })
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(db.calls).toHaveLength(0)
  })

  it('productor con sesión: solo su primer nombre y el nombre de SU organización', async () => {
    const r = await get(cookieJar({ 'sb-access-token': loginToken('au1'), ait_p: '1' }))
    expect(r.body).toEqual({ producer: { name: 'Ana', organization: 'Prod SpA' }, buyer: null })
    const out = await get(cookieJar({ 'sb-access-token': loginToken('au20') }))
    expect(out.body.producer).toEqual({ name: 'Out', organization: 'Otra Productora' })
  })

  it.each([
    ['token inválido', () => 'tok-falso'],
    ['usuario desactivado', () => loginToken('au2')],
    ['usuario sin organización', () => loginToken('au3')],
    ['organización sin correo verificado', () => loginToken('au4')],
    ['identidad de otra app sin fila en users', () => loginToken('au5')],
  ])('%s: producer null y se borra la pista vieja (ait_p)', async (_label, token) => {
    const cookies = cookieJar({ 'sb-access-token': token(), ait_p: '1' })
    const r = await get(cookies)
    expect(r.status).toBe(200)
    expect(r.body.producer).toBeNull()
    expect(cookies.delete).toHaveBeenCalledWith('ait_p', { path: '/' })
  })

  it('si validar la sesión lanza, responde igual (producer null)', async () => {
    db.auth.getUser.mockRejectedValueOnce(new Error('auth caído'))
    const r = await get(cookieJar({ 'sb-access-token': loginToken('au1') }))
    expect(r.status).toBe(200)
    expect(r.body.producer).toBeNull()
  })

  it('asistente con sesión de "Mis entradas": devuelve solo su correo', async () => {
    vi.stubEnv('BUYER_SESSION_SECRET', BUYER_SECRET)
    const r = await get(cookieJar({ ait_buyer: signBuyerSession('Comprador@Mail.cl'), ait_b: '1' }))
    expect(r.body).toEqual({ producer: null, buyer: { email: 'comprador@mail.cl' } })
  })

  it('pista de asistente vieja (cookie inválida o vencida): se borran la cookie y la pista', async () => {
    vi.stubEnv('BUYER_SESSION_SECRET', BUYER_SECRET)
    const cookies = cookieJar({ ait_buyer: 'falsa.firma', ait_b: '1' })
    const r = await get(cookies)
    expect(r.body.buyer).toBeNull()
    expect(cookies.delete).toHaveBeenCalledWith('ait_buyer', { path: '/' })
    expect(cookies.delete).toHaveBeenCalledWith('ait_b', { path: '/' })
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('POST /api/auth/set-password', () => {
  const setPassword = (body, { authId = 'au1', resetFor = authId, token, raw, extraCookies = {} } = {}) => {
    const access = token ?? (authId ? loginToken(authId) : undefined)
    const jar = {}
    if (access) jar['sb-access-token'] = access
    if (resetFor) jar[PW_RESET_COOKIE] = signPwResetCookie(resetFor)
    const cookies = cookieJar({ ...jar, ...extraCookies })
    return call(setPasswordPOST, { body, raw, cookies })
  }

  it('sin sesión: 401', async () => {
    const r = await setPassword({ password: NEW_PW }, { authId: null, resetFor: 'au1' })
    expect(r.status).toBe(401)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('sin la cookie del enlace, con la de OTRO usuario o vencida: 403 link_required', async () => {
    expect((await setPassword({ password: NEW_PW }, { resetFor: null })).body.code).toBe('link_required')
    expect((await setPassword({ password: NEW_PW }, { resetFor: 'au20' })).status).toBe(403)
    const old = signPwResetCookie('au1', { now: Date.now() - 31 * 60 * 1000 })
    const r = await setPassword({ password: NEW_PW }, { resetFor: null, extraCookies: { [PW_RESET_COOKIE]: old } })
    expect(r).toMatchObject({ status: 403, body: { code: 'link_required' } })
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('valida el cuerpo y el largo de la contraseña (8 a 72)', async () => {
    expect((await setPassword(null, { raw: '{no json' })).status).toBe(400)
    expect((await setPassword({ password: 'x'.repeat(7) })).status).toBe(400)
    expect((await setPassword({ password: 12345678 })).status).toBe(400)
    expect((await setPassword({ password: 'x'.repeat(73) })).status).toBe(400)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('miembro desactivado o identidad sin fila en users (otra app): 403', async () => {
    expect((await setPassword({ password: NEW_PW }, { authId: 'au2' })).status).toBe(403)
    expect((await setPassword({ password: NEW_PW }, { authId: 'au5' })).status).toBe(403)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('happy path: cambia la contraseña de SU cuenta, borra la cookie del enlace y cierra las OTRAS sesiones', async () => {
    const token = loginToken('au1')
    const cookies = cookieJar({ 'sb-access-token': token, [PW_RESET_COOKIE]: signPwResetCookie('au1') })
    const r = await call(setPasswordPOST, { body: { password: 'x'.repeat(72), userId: 'au20' }, cookies })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(db.auth.admin.updateUserById).toHaveBeenCalledTimes(1)
    expect(db.auth.admin.updateUserById).toHaveBeenCalledWith('au1', { password: 'x'.repeat(72) })
    expect(cookies.delete).toHaveBeenCalledWith(PW_RESET_COOKIE, { path: '/' })
    expect(db.auth.admin.signOut).toHaveBeenCalledWith(token, 'others')
    expect(cookies.has('sb-access-token')).toBe(true) // la sesión actual sigue
  })

  it('contraseña débil según Auth: 400; otro error: 500; la cookie del enlace se conserva', async () => {
    db.auth.admin.updateUserById.mockResolvedValueOnce({ data: null, error: { message: 'Password should be at least 10 characters' } })
    let r = await setPassword({ password: NEW_PW })
    expect(r.status).toBe(400)
    expect(r.body.message).toMatch(/débil/)
    expect(r.cookies.delete).not.toHaveBeenCalled()

    db.auth.admin.updateUserById.mockResolvedValueOnce({ data: null, error: { message: 'Database error' } })
    r = await setPassword({ password: NEW_PW })
    expect(r.status).toBe(500)
    expect(r.cookies.delete).not.toHaveBeenCalled()
    expect(db.auth.admin.signOut).not.toHaveBeenCalled()
  })

  it('si no se pueden cerrar las otras sesiones, la contraseña igual queda cambiada', async () => {
    db.auth.admin.signOut.mockRejectedValueOnce(new Error('red'))
    expect((await setPassword({ password: NEW_PW })).status).toBe(200)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('/api/auth/verify-email', () => {
  it('GET nunca confirma (los escáneres de correo hacen GET): redirige 303 a la página con el botón', async () => {
    const withToken = await verifyEmailRoute.GET({ url: new URL(`${ORIGIN}/api/auth/verify-email?t=abc.def&x=1`), redirect: (to, status) => new Response(null, { status, headers: { Location: to } }) })
    expect(withToken.status).toBe(303)
    expect(withToken.headers.get('location')).toBe('/organizadores/verificar?t=abc.def')
    const without = await verifyEmailRoute.GET({ url: new URL(`${ORIGIN}/api/auth/verify-email`), redirect: (to, status) => new Response(null, { status, headers: { Location: to } }) })
    expect(without.headers.get('location')).toBe('/organizadores/verificar')
    const injected = await verifyEmailRoute.GET({ url: new URL(`${ORIGIN}/api/auth/verify-email?t=${encodeURIComponent('a&next=https://evil.cl')}`), redirect: (to, status) => new Response(null, { status, headers: { Location: to } }) })
    expect(injected.headers.get('location')).toBe(`/organizadores/verificar?t=${encodeURIComponent('a&next=https://evil.cl').replace(/%20/g, '+')}`)
    expect(new URL(injected.headers.get('location'), ORIGIN).searchParams.get('next')).toBeNull()
    expect(confirmProducerEmail).not.toHaveBeenCalled()
  })

  it('POST JSON confirma con el token y responde ok', async () => {
    confirmProducerEmail.mockResolvedValueOnce({ ok: true, alreadyVerified: false, slug: 'prod-spa', uid: 'au4', email: 'nueva@prod.cl' })
    const r = await call(verifyEmailRoute.POST, { body: { t: 'tok.firma' } })
    expect(confirmProducerEmail).toHaveBeenCalledWith('tok.firma')
    expect(r).toMatchObject({ status: 200, body: { ok: true, alreadyVerified: false, slug: 'prod-spa' } })
    expect(r.body.uid).toBeUndefined()
    expect(r.body.email).toBeUndefined()
  })

  it('POST de formulario también', async () => {
    confirmProducerEmail.mockResolvedValueOnce({ ok: true, alreadyVerified: true, slug: null })
    const r = await call(verifyEmailRoute.POST, { raw: new URLSearchParams({ t: 'form.tok' }).toString(), contentType: 'application/x-www-form-urlencoded' })
    expect(confirmProducerEmail).toHaveBeenCalledWith('form.tok')
    expect(r.body.alreadyVerified).toBe(true)
  })

  it.each([['server', 500], ['not_found', 404], ['invalid', 400], ['expired', 400]])('error %s => %i', async (error, status) => {
    confirmProducerEmail.mockResolvedValueOnce({ ok: false, error })
    const r = await call(verifyEmailRoute.POST, { body: { t: 'x' } })
    expect(r).toMatchObject({ status, body: { ok: false, error } })
  })

  it('cuerpo ilegible o token que no es texto: se valida como token vacío', async () => {
    confirmProducerEmail.mockResolvedValue({ ok: false, error: 'invalid' })
    expect((await call(verifyEmailRoute.POST, { raw: '{no json' })).status).toBe(400)
    expect((await call(verifyEmailRoute.POST, { body: { t: { $ne: null } } })).status).toBe(400)
    expect(confirmProducerEmail.mock.calls.map((c) => c[0])).toEqual(['', ''])
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('POST /api/auth/resend-verification', () => {
  /** Productor recién registrado (organización sin verificar) con un correo propio de este test. */
  function pendingProducer({ email = uniqueEmail('pend'), app = AITICKETS, onboarding = false, authEmail = email } = {}) {
    const n = ++seq
    const orgId = 100 + n
    db.tables.organizations.push({ id: orgId, public_name: `Prod ${n}`, email_verified_at: null, terms_accepted_at: '2026-10-01T00:00:00Z', onboarding_pending: onboarding })
    db.tables.users.push({ id: 500 + n, name: `Prod ${n}`, email, organization_id: orgId, role: 'producer', active: true, auth_user_id: `au-p${n}` })
    accounts[`au-p${n}`] = { id: `au-p${n}`, email: authEmail, app_metadata: { ...app, provider: 'email' }, user_metadata: {} }
    return { email, uid: `au-p${n}`, orgId, name: `Prod ${n}`, orgName: `Prod ${n}` }
  }
  const resend = (body, { ip = nextIp(), raw } = {}) => call(resendPOST, { body, raw, headers: { 'x-nf-client-connection-ip': ip } })
  const GENERIC = expect.objectContaining({ ok: true, message: expect.stringMatching(/Si el correo corresponde/) })

  it('cuerpo o correo inválido: 400', async () => {
    expect((await resend(null, { raw: '{no json' })).status).toBe(400)
    for (const email of ['', 'no-es-correo', 'a@b', 'a b@c.cl', `${'x'.repeat(250)}@prod.cl`, 42]) {
      expect((await resend({ email })).status).toBe(400)
    }
    expect(sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('happy path: envía el enlace a la cuenta pendiente y guarda el enfriamiento en app_metadata (conservándola)', async () => {
    const p = pendingProducer()
    const r = await resend({ email: `  ${p.email.toUpperCase()} `, next: '/dashboard/events?x=1' })
    expect(r).toMatchObject({ status: 200, body: GENERIC })
    expect(sendVerificationEmail).toHaveBeenCalledWith({ uid: p.uid, email: p.email, name: p.name, orgName: p.orgName, next: '/dashboard/events?x=1' })
    const [uid, attrs] = db.auth.admin.updateUserById.mock.calls[0]
    expect(uid).toBe(p.uid)
    expect(attrs.app_metadata).toMatchObject({ app: 'aitickets', provider: 'email', email_verify_sent_at: expect.any(String) })
  })

  it('next inseguro (otro sitio) se descarta; con el onboarding pendiente no se usa el nombre provisorio', async () => {
    const p = pendingProducer({ onboarding: true })
    await resend({ email: p.email, next: 'https://evil.cl/dashboard' })
    expect(sendVerificationEmail).toHaveBeenCalledWith(expect.objectContaining({ next: null, orgName: null }))
  })

  it('misma respuesta (y sin envío) si el correo no existe, ya está verificado, no tiene organización o Auth tiene otro correo', async () => {
    const changed = pendingProducer({ authEmail: 'otro@correo.cl' })
    const responses = []
    for (const email of [uniqueEmail('nadie'), 'ana@prod.cl', 'sin-org@mail.cl', changed.email]) {
      responses.push(await resend({ email }))
    }
    for (const r of responses) expect(r).toMatchObject({ status: 200, body: GENERIC })
    expect(new Set(responses.map((r) => JSON.stringify(r.body))).size).toBe(1)
    expect(sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('enfriamiento de 2 minutos por cuenta (solo cuentas de AI Tickets)', async () => {
    const recent = pendingProducer({ app: { ...AITICKETS, email_verify_sent_at: new Date(Date.now() - 60_000).toISOString() } })
    await resend({ email: recent.email })
    expect(sendVerificationEmail).not.toHaveBeenCalled()

    const old = pendingProducer({ app: { ...AITICKETS, email_verify_sent_at: new Date(Date.now() - 3 * 60_000).toISOString() } })
    await resend({ email: old.email })
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1)
  })

  it('cuenta de Auth de otra app: se envía pero NO se escribe su app_metadata', async () => {
    const p = pendingProducer({ app: { app: 'otra-app' } })
    await resend({ email: p.email })
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('límite por correo: 3 por hora (aunque cambie la IP)', async () => {
    const email = uniqueEmail('lim')
    const statuses = []
    for (let i = 0; i < 4; i++) statuses.push((await resend({ email })).status)
    expect(statuses).toEqual([200, 200, 200, 429])
  })

  it('límite por IP: 10 por hora (aunque cambie el correo)', async () => {
    const ip = nextIp()
    const statuses = []
    for (let i = 0; i < 11; i++) statuses.push((await resend({ email: uniqueEmail('ip') }, { ip })).status)
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it('si el envío falla, responde lo mismo (no revela nada)', async () => {
    const p = pendingProducer()
    sendVerificationEmail.mockRejectedValueOnce(new Error('Resend 500'))
    expect(await resend({ email: p.email })).toMatchObject({ status: 200, body: GENERIC })
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('POST /api/auth/magic-link', () => {
  const link = (body, { ip = nextIp(), cookies = cookieJar(), raw, locals } = {}) =>
    call(magicLinkPOST, { body, raw, cookies, locals, headers: { 'x-nf-client-connection-ip': ip } })
  const withSession = (authId) => cookieJar({ 'sb-access-token': loginToken(authId) })
  const GENERIC = expect.objectContaining({ ok: true, message: expect.stringMatching(/Si el correo corresponde a una cuenta de AI Tickets/) })

  it('cuerpo inválido o propósito desconocido: 400', async () => {
    expect((await link(null, { raw: '{no json' })).status).toBe(400)
    expect((await link({ email: 'ana@prod.cl' })).status).toBe(400)
    expect((await link({ email: 'ana@prod.cl', purpose: 'login' })).status).toBe(400)
    expect(sendMagicLinkEmail).not.toHaveBeenCalled()
  })

  describe('change-password (con sesión)', () => {
    it('sin sesión, o con la de un miembro desactivado: 401', async () => {
      expect((await link({ purpose: 'change-password' })).status).toBe(401)
      expect((await link({ purpose: 'change-password' }, { cookies: withSession('au2') })).status).toBe(401)
      expect(sendMagicLinkEmail).not.toHaveBeenCalled()
    })

    it('envía el enlace al correo DE LA SESIÓN (nunca a uno del cuerpo) y registra el envío', async () => {
      const r = await link({ purpose: 'change-password', email: 'atacante@mail.cl' }, { cookies: withSession('au1') })
      expect(r.status).toBe(200)
      expect(r.body.message).toContain('ana@prod.cl')
      expect(sendMagicLinkEmail).toHaveBeenCalledWith({ uid: 'au1', email: 'ana@prod.cl', name: 'Ana María Pérez', purpose: 'change-password' })
      expect(db.tables.aitickets_auth_link_sends).toEqual([expect.objectContaining({ auth_user_id: 'au1', purpose: 'change-password' })])
    })

    it('un segundo pedido dentro de 60 s: 429 y sin segundo correo (límite durable)', async () => {
      expect((await link({ purpose: 'change-password' }, { cookies: withSession('au20') })).status).toBe(200)
      expect((await link({ purpose: 'change-password' }, { cookies: withSession('au20') })).status).toBe(429)
      expect(sendMagicLinkEmail).toHaveBeenCalledTimes(1)
    })

    it('si el correo no sale: 502', async () => {
      sendMagicLinkEmail.mockRejectedValueOnce(new Error('Resend 500'))
      expect((await link({ purpose: 'change-password' }, { cookies: withSession('au1') })).status).toBe(502)
    })
  })

  describe('recovery (sin sesión)', () => {
    it('correo inválido: 400', async () => {
      for (const email of ['', 'x', 'a@b', null]) expect((await link({ purpose: 'recovery', email })).status).toBe(400)
    })

    it('misma respuesta y en (al menos) el mismo tiempo exista o no la cuenta; solo envía a la cuenta real', async () => {
      const t0 = Date.now()
      const [exists, missing] = await Promise.all([
        link({ purpose: 'recovery', email: ' ANA@prod.cl ' }),
        link({ purpose: 'recovery', email: uniqueEmail('nadie') }),
      ])
      expect(Date.now() - t0).toBeGreaterThanOrEqual(650)
      expect(exists).toMatchObject({ status: 200, body: GENERIC })
      expect(missing.body).toEqual(exists.body)
      expect(sendMagicLinkEmail).toHaveBeenCalledTimes(1)
      expect(sendMagicLinkEmail).toHaveBeenCalledWith({ uid: 'au1', email: 'ana@prod.cl', name: 'Ana María Pérez', purpose: 'recovery' })
    })

    it('no envía a un miembro desactivado, a un correo repetido en dos filas ni si Auth tiene otro correo', async () => {
      db.tables.users.push({ id: 30, name: 'Dup A', email: 'dup@prod.cl', organization_id: 7, role: 'viewer', active: true, auth_user_id: 'au1' })
      db.tables.users.push({ id: 31, name: 'Dup B', email: 'dup@prod.cl', organization_id: 8, role: 'viewer', active: true, auth_user_id: 'au20' })
      db.tables.users.push({ id: 32, name: 'Cambió', email: 'viejo@prod.cl', organization_id: 7, role: 'viewer', active: true, auth_user_id: 'au4' })
      const rs = await Promise.all(['bea@prod.cl', 'dup@prod.cl', 'viejo@prod.cl'].map((email) => link({ purpose: 'recovery', email })))
      for (const r of rs) expect(r).toMatchObject({ status: 200, body: GENERIC })
      expect(sendMagicLinkEmail).not.toHaveBeenCalled()
    })

    it('con Turnstile configurado: CAPTCHA inválido => 400 sin buscar la cuenta', async () => {
      vi.stubEnv('TURNSTILE_SECRET_KEY', fakeSecret('ts'))
      verifyTurnstileToken.mockResolvedValueOnce({ success: false, message: 'CAPTCHA inválido' })
      const r = await link({ purpose: 'recovery', email: 'ana@prod.cl', cfToken: 'malo' }, { ip: '203.0.113.50' })
      expect(r).toMatchObject({ status: 400, body: { message: 'CAPTCHA inválido' } })
      expect(verifyTurnstileToken).toHaveBeenCalledWith(expect.objectContaining({ token: 'malo', remoteip: '203.0.113.50' }))
      expect(db.calls.some((c) => c.table === 'users')).toBe(false)
      expect(sendMagicLinkEmail).not.toHaveBeenCalled()
    })

    it('en producción sin TURNSTILE_SECRET_KEY: 503 (falla cerrado)', async () => {
      vi.stubEnv('PROD', true)
      const r = await link({ purpose: 'recovery', email: 'ana@prod.cl' })
      expect(r.status).toBe(503)
      expect(sendMagicLinkEmail).not.toHaveBeenCalled()
    })

    it('límite por correo: 3 por hora (aunque cambie la IP)', async () => {
      const email = uniqueEmail('rec')
      const statuses = (await Promise.all([1, 2, 3, 4].map(() => link({ purpose: 'recovery', email })))).map((r) => r.status).sort()
      expect(statuses).toEqual([200, 200, 200, 429])
    })

    it('en Netlify, la búsqueda y el envío corren en waitUntil (fuera de la respuesta)', async () => {
      const pending = []
      const thisArgs = []
      const netlifyContext = { waitUntil: vi.fn(function (p) { thisArgs.push(this); pending.push(p) }) }
      const r = await link({ purpose: 'recovery', email: 'ana@prod.cl' }, { locals: { netlify: { context: netlifyContext } } })
      expect(r).toMatchObject({ status: 200, body: GENERIC })
      expect(netlifyContext.waitUntil).toHaveBeenCalledTimes(1)
      expect(thisArgs[0]).toBe(netlifyContext) // se llama con su contexto (Netlify lo exige)
      expect(pending[0]).toBeInstanceOf(Promise)
      await Promise.all(pending)
      expect(sendMagicLinkEmail).toHaveBeenCalledTimes(1)
    })
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('POST /api/auth/change-password (retirada)', () => {
  it('responde 410 y apunta a magic-link, sin tocar Auth aunque haya sesión', async () => {
    const cookies = cookieJar({ 'sb-access-token': loginToken('au1') })
    const r = await call(changePasswordRoute.POST, { body: { currentPassword: OLD_PW, newPassword: NEW_PW }, cookies })
    expect(r.status).toBe(410)
    expect(r.body).toMatchObject({ code: 'moved', next: '/api/auth/magic-link' })
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
    expect(db.calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('/api/oauth/revoke (RFC 7009)', () => {
  const sha256 = (v) => createHash('sha256').update(v).digest('hex')
  const form = (params, headers = {}) => call(revokeRoute.POST, { raw: new URLSearchParams(params).toString(), contentType: 'application/x-www-form-urlencoded', headers, path: '/api/oauth/revoke' })
  const basic = (id, secret) => ({ authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` })
  const grant = (id) => db.tables.aitickets_oauth_grants.find((g) => g.id === id)
  const key = (id) => db.tables.aitickets_api_keys.find((k) => k.id === id)

  beforeEach(() => {
    db.tables.aitickets_oauth_clients = [
      { client_id: 'aitc_pub', client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'], token_endpoint_auth_method: 'none', client_secret_hash: null },
      { client_id: 'aitc_conf', client_name: 'Server', redirect_uris: ['https://srv.cl/cb'], token_endpoint_auth_method: 'client_secret_basic', client_secret_hash: sha256(CLIENT_SECRET) },
      { client_id: 'aitc_other', client_name: 'Otra', redirect_uris: ['https://otra.cl/cb'], token_endpoint_auth_method: 'none', client_secret_hash: null },
    ]
    db.tables.aitickets_oauth_grants = [
      { id: 'g1', client_id: 'aitc_pub', organization_id: 7, refresh_hash: sha256('rt_pub'), revoked_at: null },
      { id: 'g2', client_id: 'aitc_other', organization_id: 8, refresh_hash: sha256('rt_other'), revoked_at: null },
      { id: 'g3', client_id: 'aitc_conf', organization_id: 7, refresh_hash: sha256('rt_conf'), revoked_at: null },
    ]
    db.tables.aitickets_api_keys = [
      { id: 'k1', organization_id: 7, key_hash: hashApiKey('at_pub_1'), oauth_grant_id: 'g1', revoked_at: null },
      { id: 'k2', organization_id: 8, key_hash: hashApiKey('at_other'), oauth_grant_id: 'g2', revoked_at: null },
      { id: 'k3', organization_id: 7, key_hash: hashApiKey('at_pub_2'), oauth_grant_id: 'g1', revoked_at: null },
      { id: 'k4', organization_id: 7, key_hash: hashApiKey('aitk_personal'), oauth_grant_id: null, revoked_at: null }, // llave personal (no OAuth)
    ]
  })

  it('OPTIONS: preflight CORS', async () => {
    const res = await revokeRoute.OPTIONS({ request: new Request(`${ORIGIN}/api/oauth/revoke`, { method: 'OPTIONS' }) })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('cliente desconocido o sin client_id: 401 invalid_client sin revocar nada', async () => {
    for (const params of [{ client_id: 'aitc_nope', token: 'rt_pub' }, { token: 'rt_pub' }]) {
      const r = await form(params)
      expect(r).toMatchObject({ status: 401, body: { error: 'invalid_client' } })
    }
    expect(writes('aitickets_oauth_grants')).toHaveLength(0)
    expect(writes('aitickets_api_keys')).toHaveLength(0)
  })

  it('refresh token: revoca la conexión y todos sus access tokens; nada de otros clientes', async () => {
    const r = await form({ client_id: 'aitc_pub', token: 'rt_pub', token_type_hint: 'refresh_token' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({})
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(grant('g1').revoked_at).toEqual(expect.any(String))
    expect(key('k1').revoked_at).toEqual(expect.any(String))
    expect(key('k3').revoked_at).toEqual(expect.any(String))
    for (const g of ['g2', 'g3']) expect(grant(g).revoked_at).toBeNull()
    for (const k of ['k2', 'k4']) expect(key(k).revoked_at).toBeNull()
  })

  it('access token (JSON): revoca solo esa llave, no la conexión', async () => {
    const r = await call(revokeRoute.POST, { body: { client_id: 'aitc_pub', token: 'at_pub_1' }, path: '/api/oauth/revoke' })
    expect(r.status).toBe(200)
    expect(key('k1').revoked_at).toEqual(expect.any(String))
    expect(key('k3').revoked_at).toBeNull()
    expect(grant('g1').revoked_at).toBeNull()
  })

  it('un cliente no puede revocar tokens de OTRO cliente ni llaves personales (responde 200 igual)', async () => {
    for (const token of ['rt_other', 'at_other', 'rt_conf', 'aitk_personal']) {
      const r = await form({ client_id: 'aitc_pub', token })
      expect(r.status).toBe(200)
    }
    for (const g of ['g1', 'g2', 'g3']) expect(grant(g).revoked_at).toBeNull()
    for (const k of ['k1', 'k2', 'k3', 'k4']) expect(key(k).revoked_at).toBeNull()
  })

  it('token desconocido o vacío: 200 sin escribir', async () => {
    expect((await form({ client_id: 'aitc_pub', token: 'no-existe' })).status).toBe(200)
    expect((await form({ client_id: 'aitc_pub' })).status).toBe(200)
    expect(db.tables.aitickets_oauth_grants.every((g) => g.revoked_at === null)).toBe(true)
    expect(db.tables.aitickets_api_keys.every((k) => k.revoked_at === null)).toBe(true)
  })

  it('cliente confidencial: exige su secreto (Basic o en el cuerpo)', async () => {
    expect((await form({ client_id: 'aitc_conf', token: 'rt_conf' })).status).toBe(401)
    expect((await form({ token: 'rt_conf' }, basic('aitc_conf', fakeSecret('wrong')))).status).toBe(401)
    expect(grant('g3').revoked_at).toBeNull()
    expect((await form({ token: 'rt_conf' }, basic('aitc_conf', CLIENT_SECRET))).status).toBe(200)
    expect(grant('g3').revoked_at).toEqual(expect.any(String))
    grant('g3').revoked_at = null
    expect((await form({ client_id: 'aitc_conf', client_secret: CLIENT_SECRET, token: 'rt_conf' })).status).toBe(200)
    expect(grant('g3').revoked_at).toEqual(expect.any(String))
  })

  it('error inesperado: 500 server_error', async () => {
    const from = db.from
    db.from = (table) => {
      if (table === 'aitickets_oauth_grants') throw new Error('conexión perdida')
      return from(table)
    }
    const r = await form({ client_id: 'aitc_pub', token: 'rt_pub' })
    expect(r).toMatchObject({ status: 500, body: { error: 'server_error' } })
  })
})
