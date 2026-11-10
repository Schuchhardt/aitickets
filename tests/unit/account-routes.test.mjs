// Rutas de cuenta del panel: POST /api/users/update (Mi perfil), POST /api/organizations/update (organización y
// datos para pagos) y POST /api/identity/start (verificación de identidad con Didit). Cubre permisos por rol
// (producer, admin, finance, editor, validator, viewer), que solo se toque la fila propia / la organización propia
// (nunca la de otra organización, aunque el cuerpo traiga otro id) y lo que se escribe.
// Sin red ni BD: Supabase es el doble en memoria de tests/fixtures/fake-supabase.mjs y Didit/Slack son dobles.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const state = vi.hoisted(() => ({ session: null }))
let db

vi.mock('../../src/lib/auth-helpers', () => ({
  getSupabaseAdmin: () => db,
  getFriendlyErrorMessage: (e) => String(e?.message || e),
  createEphemeralAuthClient: () => null,
}))
vi.mock('../../src/lib/supabaseServer', async (importOriginal) => {
  const orig = await importOriginal()
  return {
    ...orig,
    getSessionContext: vi.fn(async () => state.session),
    forgetCachedSessionsOfUser: vi.fn(orig.forgetCachedSessionsOfUser),
  }
})
vi.mock('../../src/pages/api/_lib/server-utils', async (importOriginal) => ({ ...(await importOriginal()), notifySlack: vi.fn(async () => {}) }))
vi.mock('../../netlify/lib/identity.mjs', async (importOriginal) => ({ ...(await importOriginal()), createDiditSession: vi.fn() }))

const { POST: userUpdatePOST } = await import('../../src/pages/api/users/update.ts')
const { POST: orgUpdatePOST } = await import('../../src/pages/api/organizations/update.ts')
const { POST: identityStartPOST } = await import('../../src/pages/api/identity/start.ts')
const supabaseServer = await import('../../src/lib/supabaseServer')
const { notifySlack } = await import('../../src/pages/api/_lib/server-utils')
const { createDiditSession, DiditError } = await import('../../netlify/lib/identity.mjs')

const ORIGIN = 'https://aitickets.test'
const ROLES = ['producer', 'admin', 'finance', 'editor', 'validator', 'viewer']
const ID_BY_ROLE = { producer: 1, admin: 2, finance: 3, editor: 4, validator: 5, viewer: 6 }
const AITICKETS = { app: 'aitickets' }

const sessionFor = (userId, authExtra = {}) => {
  const u = db.tables.users.find((x) => x.id === userId)
  return {
    authUser: { id: u.auth_user_id, email: u.email, app_metadata: AITICKETS, user_metadata: { full_name: u.name, avatar_url: 'https://img/a.png' }, ...authExtra },
    dbUser: { id: u.id, name: u.name, email: u.email, organization_id: u.organization_id, role: u.role, active: true },
  }
}
const loginAs = (role, authExtra) => { state.session = sessionFor(ID_BY_ROLE[role], authExtra) }

async function call(handler, body, { raw, path = '/api/x' } = {}) {
  const url = new URL(`${ORIGIN}${path}`)
  const request = new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body ?? {}) })
  const res = await handler({ request, url, cookies: { get: () => undefined, set: () => {}, delete: () => {} }, locals: {} })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const user = (id) => db.tables.users.find((u) => u.id === id)
const org = (id) => db.tables.organizations.find((o) => o.id === id)
const payout = (orgId) => db.tables.organization_payout_accounts.find((p) => p.organization_id === orgId)
const clone = (v) => JSON.parse(JSON.stringify(v))
const writes = (table) => db.calls.filter((c) => c.table === table && c.op !== 'select')

beforeEach(() => {
  vi.clearAllMocks()
  db = createFakeSupabase({
    tables: {
      organizations: [
        { id: 7, public_name: 'Prod SpA', email: 'hola@prod.cl', phone: '+56911111111', identity_status: null, identity_rut: null, identity_name: null, legal_name: null, legal_id: null },
        { id: 8, public_name: 'Otra', email: 'hola@otra.cl', phone: '+56922222222', identity_status: 'approved', legal_name: 'Otra SpA', legal_id: '76123456-0' },
      ],
      users: [
        { id: 1, name: 'Ana', email: 'ana@prod.cl', phone: null, organization_id: 7, role: 'producer', active: true, auth_user_id: 'au1' },
        { id: 2, name: 'Bea', email: 'bea@prod.cl', phone: null, organization_id: 7, role: 'admin', active: true, auth_user_id: 'au2' },
        { id: 3, name: 'Fio', email: 'fio@prod.cl', phone: null, organization_id: 7, role: 'finance', active: true, auth_user_id: 'au3' },
        { id: 4, name: 'Eli', email: 'eli@prod.cl', phone: null, organization_id: 7, role: 'editor', active: true, auth_user_id: 'au4' },
        { id: 5, name: 'Val', email: 'val@prod.cl', phone: null, organization_id: 7, role: 'validator', active: true, auth_user_id: 'au5' },
        { id: 6, name: 'Vio', email: 'vio@prod.cl', phone: null, organization_id: 7, role: 'viewer', active: true, auth_user_id: 'au6' },
        { id: 20, name: 'Out', email: 'out@otra.cl', phone: '+56933333333', organization_id: 8, role: 'producer', active: true, auth_user_id: 'au20' },
      ],
      organization_payout_accounts: [
        { organization_id: 8, legal_name: 'Otra SpA', legal_rut: '76123456-0', bank_name: 'Banco Otra', bank_account_number: '000111222333', bank_account_rut: '76123456-0', verified_at: '2026-01-01T00:00:00Z' },
      ],
    },
  })
  db.auth = { admin: { updateUserById: vi.fn(async () => ({ data: {}, error: null })) } }
  loginAs('producer')
})

// ---------------------------------------------------------------------------------------------------------------
describe('POST /api/users/update (Mi perfil)', () => {
  it('sin sesión: 401 sin tocar nada', async () => {
    state.session = null
    const before = clone(db.tables.users)
    const r = await call(userUpdatePOST, { full_name: 'X', phone: '1' })
    expect(r.status).toBe(401)
    expect(db.tables.users).toEqual(before)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it.each(ROLES)('rol %s: actualiza SOLO su propia fila (nombre y teléfono)', async (role) => {
    loginAs(role)
    const id = ID_BY_ROLE[role]
    const before = clone(db.tables.users)
    const r = await call(userUpdatePOST, { full_name: '  Nombre Nuevo  ', phone: ' +56 9 1234 5678 ' })
    expect(r.status).toBe(200)
    expect(user(id)).toMatchObject({ name: 'Nombre Nuevo', phone: '+56 9 1234 5678', role, organization_id: 7, email: before.find((u) => u.id === id).email })
    expect(user(id).updated_at).toEqual(expect.any(String))
    expect(db.tables.users.filter((u) => u.id !== id)).toEqual(before.filter((u) => u.id !== id))
    expect(supabaseServer.forgetCachedSessionsOfUser).toHaveBeenCalledWith(id)
  })

  it('ignora id, organización, rol, correo y active del cuerpo: no se puede escalar ni tocar a otro', async () => {
    loginAs('viewer')
    const before = clone(db.tables.users)
    const r = await call(userUpdatePOST, { id: 20, userId: 1, organization_id: 8, role: 'producer', email: 'yo@hack.cl', active: false, full_name: 'Vio' })
    expect(r.status).toBe(200)
    expect(user(6)).toMatchObject({ role: 'viewer', organization_id: 7, email: 'vio@prod.cl', active: true })
    expect(user(1)).toEqual(before.find((u) => u.id === 1))
    expect(user(20)).toEqual(before.find((u) => u.id === 20))
    const upd = writes('users')
    expect(upd).toHaveLength(1)
    expect(upd[0].filters).toEqual([{ col: 'id', op: 'eq', value: 6 }])
    expect(Object.keys(upd[0].values).sort()).toEqual(['name', 'phone', 'updated_at'])
  })

  it('campos ausentes o que no son texto no viajan en el UPDATE (no borran el dato guardado)', async () => {
    await call(userUpdatePOST, { phone: '+56900000000' })
    const wire = JSON.parse(JSON.stringify(writes('users')[0].values)) // supabase-js descarta los undefined
    expect(wire).not.toHaveProperty('name')
    expect(wire.phone).toBe('+56900000000')
    await call(userUpdatePOST, { full_name: 'Ana', phone: 56912345678 })
    expect(JSON.parse(JSON.stringify(writes('users')[1].values))).not.toHaveProperty('phone')
  })

  it('recorta nombre (150) y teléfono (50)', async () => {
    await call(userUpdatePOST, { full_name: 'a'.repeat(400), phone: '9'.repeat(80) })
    expect(user(1).name).toHaveLength(150)
    expect(user(1).phone).toHaveLength(50)
  })

  it('cuenta de AI Tickets: actualiza también la metadata de Auth conservando la existente', async () => {
    await call(userUpdatePOST, { full_name: 'Ana María', phone: '+569' })
    expect(db.auth.admin.updateUserById).toHaveBeenCalledWith('au1', { user_metadata: { full_name: 'Ana María', avatar_url: 'https://img/a.png', phone: '+569' } })
  })

  it('cuenta de Auth de otra app (proyecto compartido): no toca Auth', async () => {
    loginAs('editor', { app_metadata: { provider: 'google' } })
    const r = await call(userUpdatePOST, { full_name: 'Elisa' })
    expect(r.status).toBe(200)
    expect(user(4).name).toBe('Elisa')
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('un error de Auth no hace fallar el guardado', async () => {
    db.auth.admin.updateUserById.mockResolvedValueOnce({ data: null, error: { message: 'auth down' } })
    const r = await call(userUpdatePOST, { full_name: 'Ana María' })
    expect(r.status).toBe(200)
    expect(user(1).name).toBe('Ana María')
  })

  it('error de la BD: 500, sin tocar Auth ni la caché', async () => {
    db.failOn('users', 'update', { code: '57014', message: 'timeout' })
    const r = await call(userUpdatePOST, { full_name: 'Ana María' })
    expect(r.status).toBe(500)
    expect(user(1).name).toBe('Ana')
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
    expect(supabaseServer.forgetCachedSessionsOfUser).not.toHaveBeenCalled()
  })

  it('JSON inválido: 400 sin escribir', async () => {
    const r = await call(userUpdatePOST, null, { raw: '{no json' })
    expect(r.status).toBe(400)
    expect(writes('users')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('POST /api/organizations/update', () => {
  const update = (body, opts) => call(orgUpdatePOST, body, opts)
  const BANK = {
    bank_name: 'Banco Estado', bank_account_type: 'Cuenta Vista', bank_account_number: '1234567890123',
    bank_account_holder: 'Ana Pérez', bank_account_rut: '12.345.678-5',
  }

  it('sin sesión: 401', async () => {
    state.session = null
    expect((await update({ public_name: 'X' })).status).toBe(401)
    expect(writes('organizations')).toHaveLength(0)
  })

  it.each(['editor', 'validator', 'viewer'])('rol %s: 403 sin escribir nada (ni perfil ni datos de pago)', async (role) => {
    loginAs(role)
    const orgs = clone(db.tables.organizations)
    const accounts = clone(db.tables.organization_payout_accounts)
    for (const body of [{ public_name: 'Hack' }, BANK, { legal_name: 'Hack SpA' }]) {
      expect((await update(body)).status).toBe(403)
    }
    expect(db.tables.organizations).toEqual(orgs)
    expect(db.tables.organization_payout_accounts).toEqual(accounts)
    expect(notifySlack).not.toHaveBeenCalled()
  })

  it('el perfil lo editan producer y admin; los datos para pagos, solo producer y finanzas', async () => {
    const profile = []
    const payouts = []
    for (const role of ROLES) {
      loginAs(role)
      if ((await update({ phone: `+569${role.length}` })).status === 200) profile.push(role)
      if ((await update({ legal_name: `Prod ${role}` })).status === 200) payouts.push(role)
    }
    expect(profile).toEqual(['producer', 'admin'])
    expect(payouts).toEqual(['producer', 'finance'])
  })

  it.each(['producer', 'admin'])('rol %s: edita el perfil de SU organización; un id en el cuerpo no cambia el destino', async (role) => {
    loginAs(role)
    const other = clone(org(8))
    const r = await update({ id: 8, organization_id: 8, public_name: '  Nueva Prod  ', email: 'contacto@prod.cl', phone: null })
    expect(r.status).toBe(200)
    expect(org(7)).toMatchObject({ public_name: 'Nueva Prod', email: 'contacto@prod.cl', phone: null })
    expect(org(8)).toEqual(other)
    const upd = writes('organizations')
    expect(upd).toHaveLength(1)
    expect(upd[0].filters).toEqual([{ col: 'id', op: 'eq', value: 7 }])
    expect(upd[0].values).toEqual({ public_name: 'Nueva Prod', email: 'contacto@prod.cl', phone: null })
  })

  it('finanzas: puede guardar los datos de pago de su organización', async () => {
    loginAs('finance')
    const r = await update({ ...BANK, legal_name: 'Prod SpA', legal_rut: '76.123.456-0', organization_id: 8 })
    expect(r.status).toBe(200)
    expect(payout(7)).toMatchObject({ ...BANK, legal_name: 'Prod SpA', legal_rut: '76.123.456-0', organization_id: 7, updated_by: 3 })
    // La cuenta de la otra organización no se toca
    expect(payout(8)).toMatchObject({ bank_account_number: '000111222333', verified_at: '2026-01-01T00:00:00Z' })
  })

  it('finanzas: 403 si incluye CUALQUIER campo del perfil, y no guarda tampoco los datos de pago', async () => {
    loginAs('finance')
    const orgs = clone(db.tables.organizations)
    for (const body of [{ public_name: 'Hack' }, { email: 'x@y.cl' }, { phone: null }, { ...BANK, phone: '+569' }]) {
      const r = await update(body)
      expect(r.status).toBe(403)
      expect(r.body.message).toMatch(/datos para pagos/)
    }
    expect(db.tables.organizations).toEqual(orgs)
    expect(payout(7)).toBeUndefined()
  })

  it('validaciones: nombre obligatorio, RUT del titular y de la empresa, y nada que actualizar', async () => {
    expect((await update({ public_name: '   ' })).body.message).toMatch(/obligatorio/)
    expect((await update({ public_name: null })).status).toBe(400)
    expect((await update({ ...BANK, bank_account_rut: '12345' })).body.message).toMatch(/RUT del titular/)
    expect((await update({ legal_rut: 'abc' })).body.message).toMatch(/RUT de la empresa/)
    expect((await update({ legal_id: 'abc' })).body.message).toMatch(/RUT de la empresa/) // nombre antiguo del campo
    expect((await update({})).body.message).toMatch(/Nada que actualizar/)
    expect((await update({ role: 'producer', organization_id: 8, verified_at: null })).status).toBe(400)
    expect(writes('organizations')).toHaveLength(0)
    expect(writes('organization_payout_accounts')).toHaveLength(0)
  })

  it('recorta los textos a su largo máximo', async () => {
    await update({ public_name: 'n'.repeat(500), phone: '9'.repeat(100) })
    expect(org(7).public_name).toHaveLength(150)
    expect(org(7).phone).toHaveLength(50)
  })

  it('legal_id (formulario antiguo) se guarda como legal_rut y se copia normalizado a la organización', async () => {
    const r = await update({ legal_id: '76.123.456-0', legal_name: 'Prod SpA' })
    expect(r.status).toBe(200)
    expect(payout(7)).toMatchObject({ legal_rut: '76.123.456-0', legal_name: 'Prod SpA' })
    expect(org(7)).toMatchObject({ legal_name: 'Prod SpA', legal_id: '76123456-0' })
    expect(org(8)).toMatchObject({ legal_name: 'Otra SpA', legal_id: '76123456-0' })
    expect(notifySlack).not.toHaveBeenCalled() // sin cambio bancario no se avisa
  })

  it('un administrador no cambia la cuenta bancaria (los retiros se transfieren ahí): 403 sin guardar', async () => {
    loginAs('admin')
    const before = clone(payout(7) ?? null)
    const r = await update(BANK)
    expect(r.status).toBe(403)
    expect(r.body.message).toMatch(/dueño de la cuenta o finanzas/)
    expect(payout(7) ?? null).toEqual(before)
  })

  it('cambio de cuenta bancaria: guarda y avisa a AI Tickets (informativo) SOLO con los últimos 4 dígitos', async () => {
    loginAs('producer')
    const r = await update(BANK)
    expect(r.status).toBe(200)
    const saved = payout(7)
    expect(saved).toMatchObject({ ...BANK, organization_id: 7, updated_by: 1 })
    expect(saved.updated_at).toEqual(expect.any(String))
    const upsert = writes('organization_payout_accounts').find((c) => c.op === 'upsert')
    expect(upsert.values.organization_id).toBe(7)

    expect(notifySlack).toHaveBeenCalledTimes(1)
    const msg = notifySlack.mock.calls[0][0]
    expect(msg).toMatch(/Cuenta bancaria actualizada/)
    expect(msg).not.toMatch(/verificar|aitickets_verify_payout_account|select /)
    expect(msg).toMatch(/Prod SpA \(#7\)/)
    expect(msg).toMatch(/Ana · ana@prod\.cl \(#1\)/)
    expect(msg).toMatch(/\*\*\*\*0123/)
    expect(msg).not.toContain(BANK.bank_account_number)
    expect(msg).not.toContain('000111222333')
  })

  it('si los datos bancarios no cambiaron, no avisa', async () => {
    db.tables.organization_payout_accounts.push({ organization_id: 7, ...BANK })
    expect((await update(BANK)).status).toBe(200)
    expect(notifySlack).not.toHaveBeenCalled()
  })

  it('error al guardar la organización: 500', async () => {
    db.failOn('organizations', 'update', { code: '57014', message: 'timeout' })
    const r = await update({ public_name: 'Nueva' })
    expect(r.status).toBe(500)
    expect(org(7).public_name).toBe('Prod SpA')
  })

  it('error al guardar los datos de pago: 500 sin avisar', async () => {
    db.failOn('organization_payout_accounts', 'upsert', { code: '57014', message: 'timeout' })
    const r = await update(BANK)
    expect(r.status).toBe(500)
    expect(payout(7)).toBeUndefined()
    expect(notifySlack).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('POST /api/identity/start', () => {
  const start = (body, opts) => call(identityStartPOST, body, { path: '/api/identity/start', ...opts })

  beforeEach(() => {
    createDiditSession.mockResolvedValue({ sessionId: 'didit-sess-1', url: 'https://verify.didit.me/s/abc', status: 'Not Started' })
  })

  it('sin sesión: 401 sin llamar a Didit', async () => {
    state.session = null
    expect((await start({ consent: true })).status).toBe(401)
    expect(createDiditSession).not.toHaveBeenCalled()
  })

  it.each(['finance', 'editor', 'validator', 'viewer'])('rol %s: 403 sin llamar a Didit ni tocar la organización', async (role) => {
    loginAs(role)
    const before = clone(db.tables.organizations)
    const r = await start({ consent: true })
    expect(r.status).toBe(403)
    expect(createDiditSession).not.toHaveBeenCalled()
    expect(db.tables.organizations).toEqual(before)
  })

  it('exige el consentimiento expreso (consent === true)', async () => {
    for (const body of [{}, { consent: false }, { consent: 'true' }, { consent: 1 }]) {
      const r = await start(body)
      expect(r.status).toBe(400)
      expect(r.body.message).toMatch(/biométricos/)
    }
    expect((await start(null, { raw: '{no json' })).status).toBe(400)
    expect(createDiditSession).not.toHaveBeenCalled()
    expect(writes('organizations')).toHaveLength(0)
  })

  it.each(['producer', 'admin'])('rol %s: crea la sesión de Didit para SU organización y la marca pendiente', async (role) => {
    loginAs(role)
    const other = clone(org(8))
    const r = await start({ consent: true, organization_id: 8 })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ url: 'https://verify.didit.me/s/abc' })
    expect(createDiditSession).toHaveBeenCalledWith({ orgId: 7, callback: `${ORIGIN}/dashboard/settings?identidad=volver#identidad` })
    expect(org(7)).toMatchObject({ identity_session_id: 'didit-sess-1', identity_status: 'pending' })
    expect(org(7).identity_consent_at).toEqual(expect.any(String))
    expect(org(7).identity_checked_at).toBe(org(7).identity_consent_at)
    expect(org(8)).toEqual(other)
    const upd = writes('organizations')
    expect(upd).toHaveLength(1)
    expect(upd[0].filters).toEqual([{ col: 'id', op: 'eq', value: 7 }])
  })

  it('usa SITE_URL (sin "/" final) para el regreso, no el host de la petición', async () => {
    vi.stubEnv('SITE_URL', 'https://aitickets.cl/')
    await start({ consent: true })
    expect(createDiditSession).toHaveBeenCalledWith({ orgId: 7, callback: 'https://aitickets.cl/dashboard/settings?identidad=volver#identidad' })
  })

  it('identidad ya aprobada: 409 sin crear otra sesión', async () => {
    org(7).identity_status = 'approved'
    const r = await start({ consent: true })
    expect(r.status).toBe(409)
    expect(createDiditSession).not.toHaveBeenCalled()
    expect(org(7).identity_status).toBe('approved')
  })

  it('una verificación rechazada se puede reintentar', async () => {
    org(7).identity_status = 'declined'
    expect((await start({ consent: true })).status).toBe(200)
    expect(org(7).identity_status).toBe('pending')
  })

  it('organización inexistente: 404', async () => {
    state.session.dbUser.organization_id = 99
    expect((await start({ consent: true })).status).toBe(404)
    expect(createDiditSession).not.toHaveBeenCalled()
  })

  it('Didit sin configurar: 503; error del proveedor: 502; la organización no cambia', async () => {
    createDiditSession.mockRejectedValueOnce(new DiditError('not_configured', 'La verificación no está configurada.'))
    expect((await start({ consent: true })).status).toBe(503)
    createDiditSession.mockRejectedValueOnce(new DiditError('provider_error', 'Didit respondió 500', 500))
    const r = await start({ consent: true })
    expect(r.status).toBe(502)
    expect(r.body.message).toBe('Didit respondió 500')
    expect(org(7).identity_status).toBeNull()
    expect(writes('organizations')).toHaveLength(0)
  })

  it('error inesperado (p. ej. al guardar): 500 genérico', async () => {
    db.failOn('organizations', 'update', { code: '57014', message: 'statement timeout' })
    const r = await start({ consent: true })
    expect(r.status).toBe(500)
    expect(r.body.message).not.toMatch(/timeout/)
  })
})
