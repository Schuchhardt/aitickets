// Rutas del panel "Mi equipo": GET /api/team/list, POST /api/team/toggle-status, POST /api/team/update y
// POST /api/team/accept-invitation (envoltorio HTTP de src/lib/team-accept.ts, que se prueba aparte en
// producer-api-team.test.mjs). Cubre permisos por rol (producer, admin, finance, editor, validator, viewer),
// aislamiento por organización (un miembro de otra organización nunca se toca), los resguardos propios de cada
// ruta (dueño, finanzas, último administrador, uno mismo, cuentas de Auth de otras apps) y lo que se escribe.
// Sin red ni BD: Supabase es el doble en memoria de tests/fixtures/fake-supabase.mjs.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { fakePassword, fakeSecret } from '../fixtures/fake-credentials.mjs'
const INVITE_PW = fakePassword('inv')
const WRONG_PW = fakePassword('wrong')

const state = vi.hoisted(() => ({ session: null, ephemeral: null }))
let db

vi.mock('../../src/lib/auth-helpers', () => ({
  getSupabaseAdmin: () => db,
  getFriendlyErrorMessage: (e) => String(e?.message || e),
  createEphemeralAuthClient: () => state.ephemeral,
}))
// Todo lo de supabaseServer es real (ORG_ADMIN_ROLES, hasRole, cookies, recordLogin) salvo la sesión.
vi.mock('../../src/lib/supabaseServer', async (importOriginal) => {
  const orig = await importOriginal()
  return {
    ...orig,
    getSessionContext: vi.fn(async () => state.session),
    forgetCachedSessionsOfUser: vi.fn(orig.forgetCachedSessionsOfUser),
    setSessionCookies: vi.fn(orig.setSessionCookies),
    recordLogin: vi.fn(orig.recordLogin),
  }
})
vi.mock('../../netlify/lib/rate-limit.mjs', () => ({ rateLimit: vi.fn(async () => ({ allowed: true, source: 'memory' })) }))
vi.mock('../../src/lib/team-accept', async (importOriginal) => {
  const orig = await importOriginal()
  return { ...orig, acceptTeamInvitation: vi.fn(orig.acceptTeamInvitation) }
})

const { GET: listGET } = await import('../../src/pages/api/team/list.ts')
const { POST: togglePOST } = await import('../../src/pages/api/team/toggle-status.ts')
const { POST: updatePOST } = await import('../../src/pages/api/team/update.ts')
const { POST: acceptPOST } = await import('../../src/pages/api/team/accept-invitation.ts')
const supabaseServer = await import('../../src/lib/supabaseServer')
const { rateLimit } = await import('../../netlify/lib/rate-limit.mjs')
const { acceptTeamInvitation } = await import('../../src/lib/team-accept')
const { generateInvitationToken } = await import('../../src/lib/team-invitations.ts')

const ORIGIN = 'https://aitickets.test'
const ROLES = ['producer', 'admin', 'finance', 'editor', 'validator', 'viewer']
const ADMIN_ROLES = ['producer', 'admin']
const NON_ADMIN_ROLES = ['finance', 'editor', 'validator', 'viewer']
// Un miembro de la organización 7 por rol (el id de cada uno)
const ID_BY_ROLE = { producer: 1, admin: 2, finance: 3, editor: 4, validator: 5, viewer: 6 }

// Cuentas de Supabase Auth (proyecto compartido con otras apps): solo las 'aitickets' se pueden bloquear o
// cambiar de correo desde AI Tickets.
const AITICKETS = { app: 'aitickets' }
let authAccounts

/**
 * countActiveOrgAdmins (src/pages/api/team/_team.ts) filtra con .or("active.is.null,active.eq.true"). El doble no
 * soporta .or() a propósito; se traduce SOLO esa expresión a su equivalente (active distinto de false) y cualquier
 * otra sigue lanzando, para que un filtro nuevo no pase en falso.
 */
function withActiveOr(fake) {
  const from = fake.from
  fake.from = (table) => {
    const b = from(table)
    b.or = (expr) => {
      if (expr !== 'active.is.null,active.eq.true') throw new Error(`fake-supabase: .or(${expr}) no soportado en este test`)
      return b.not('active', 'eq', false)
    }
    return b
  }
  return fake
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

const sessionFor = (userId) => {
  const u = db.tables.users.find((x) => x.id === userId)
  return {
    authUser: { id: u.auth_user_id, email: u.email, app_metadata: AITICKETS, user_metadata: {} },
    dbUser: { id: u.id, name: u.name, email: u.email, organization_id: u.organization_id, role: u.role, active: true },
  }
}
const loginAs = (role) => { state.session = sessionFor(ID_BY_ROLE[role]) }

async function call(handler, { method = 'POST', body, raw, headers = {}, cookies = cookieJar() } = {}) {
  const url = new URL(`${ORIGIN}/api/team`)
  const init = { method, headers: { 'content-type': 'application/json', ...headers } }
  if (method !== 'GET') init.body = raw ?? JSON.stringify(body ?? {})
  const res = await handler({ request: new Request(url, init), url, cookies, locals: {}, redirect: (to, status = 302) => new Response(null, { status, headers: { Location: to } }) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, cookies }
}

const user = (id) => db.tables.users.find((u) => u.id === id)
const snapshotUsers = () => JSON.parse(JSON.stringify(db.tables.users))
const writes = (table) => db.calls.filter((c) => c.table === table && c.op !== 'select')

beforeEach(() => {
  vi.clearAllMocks()
  authAccounts = {
    au1: { id: 'au1', email: 'ana@prod.cl', app_metadata: AITICKETS },
    au2: { id: 'au2', email: 'bea@prod.cl', app_metadata: AITICKETS },
    au3: { id: 'au3', email: 'fio@prod.cl', app_metadata: AITICKETS },
    au4: { id: 'au4', email: 'eli@prod.cl', app_metadata: AITICKETS },
    au5: { id: 'au5', email: 'val@prod.cl', app_metadata: AITICKETS },
    au6: { id: 'au6', email: 'vio@prod.cl', app_metadata: AITICKETS },
    // Cuenta creada por otra app del proyecto compartido
    au7: { id: 'au7', email: 'gus@mail.cl', app_metadata: { provider: 'google', app: 'otra-app' } },
    au20: { id: 'au20', email: 'out@otra.cl', app_metadata: AITICKETS },
    au21: { id: 'au21', email: 'own@otra.cl', app_metadata: AITICKETS },
  }
  db = withActiveOr(createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Prod SpA' }, { id: 8, public_name: 'Otra' }],
      users: [
        { id: 1, name: 'Ana', email: 'ana@prod.cl', organization_id: 7, role: 'producer', active: true, auth_user_id: 'au1', created_at: '2026-01-01T00:00:00Z' },
        { id: 2, name: 'Bea', email: 'bea@prod.cl', organization_id: 7, role: 'admin', active: true, auth_user_id: 'au2', created_at: '2026-01-02T00:00:00Z' },
        { id: 3, name: 'Fio', email: 'fio@prod.cl', organization_id: 7, role: 'finance', active: true, auth_user_id: 'au3', created_at: '2026-01-03T00:00:00Z' },
        { id: 4, name: 'Eli', email: 'eli@prod.cl', organization_id: 7, role: 'editor', active: true, auth_user_id: 'au4', created_at: '2026-01-04T00:00:00Z' },
        { id: 5, name: 'Val', email: 'val@prod.cl', organization_id: 7, role: 'validator', active: true, auth_user_id: 'au5', created_at: '2026-01-05T00:00:00Z' },
        { id: 6, name: 'Vio', email: 'vio@prod.cl', organization_id: 7, role: 'viewer', active: true, auth_user_id: 'au6', created_at: '2026-01-06T00:00:00Z' },
        { id: 7, name: 'Gus', email: 'gus@mail.cl', organization_id: 7, role: 'editor', active: true, auth_user_id: 'au7', created_at: '2026-01-07T00:00:00Z' },
        { id: 8, name: 'Nil', email: 'nil@prod.cl', organization_id: 7, role: 'viewer', active: true, auth_user_id: null, created_at: '2026-01-08T00:00:00Z' },
        // Otra organización
        { id: 20, name: 'Out', email: 'out@otra.cl', organization_id: 8, role: 'admin', active: true, auth_user_id: 'au20', created_at: '2026-01-01T00:00:00Z' },
        { id: 21, name: 'Own', email: 'own@otra.cl', organization_id: 8, role: 'producer', active: true, auth_user_id: 'au21', created_at: '2026-01-01T00:00:00Z' },
      ],
      events: [{ id: 10, organization_id: 7 }],
      aitickets_checkin_links: [],
      aitickets_team_invitations: [],
      aitickets_event_staff: [],
    },
  }))
  db.auth = {
    admin: {
      getUserById: vi.fn(async (id) => (authAccounts[id] ? { data: { user: authAccounts[id] }, error: null } : { data: { user: null }, error: { message: 'User not found' } })),
      updateUserById: vi.fn(async (id) => ({ data: { user: authAccounts[id] || null }, error: null })),
      createUser: vi.fn(async () => ({ data: { user: { id: 'au-new' } }, error: null })),
    },
  }
  state.ephemeral = null
  loginAs('producer')
})

// ---------------------------------------------------------------------------------------------------------------
describe('GET /api/team/list', () => {
  it('sin sesión: 401 y no lee el equipo', async () => {
    state.session = null
    const r = await call(listGET, { method: 'GET' })
    expect(r.status).toBe(401)
    expect(db.calls.some((c) => c.table === 'users')).toBe(false)
  })

  it.each(NON_ADMIN_ROLES)('rol %s: 403 sin leer el equipo', async (role) => {
    loginAs(role)
    const r = await call(listGET, { method: 'GET' })
    expect(r.status).toBe(403)
    expect(db.calls.some((c) => c.table === 'users')).toBe(false)
  })

  it.each(ADMIN_ROLES)('rol %s: lista solo los miembros de SU organización', async (role) => {
    loginAs(role)
    const r = await call(listGET, { method: 'GET' })
    expect(r.status).toBe(200)
    expect(r.body.currentUserRole).toBe(role)
    expect(r.body.members.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(r.body.members.some((m) => m.organization_id === 8 || m.id === 20 || m.id === 21)).toBe(false)
    const q = db.calls.find((c) => c.table === 'users' && c.op === 'select')
    expect(q.filters).toContainEqual({ col: 'organization_id', op: 'eq', value: 7 })
  })

  it('el rol permitido es exactamente producer y admin', async () => {
    const allowed = []
    for (const role of ROLES) {
      loginAs(role)
      if ((await call(listGET, { method: 'GET' })).status === 200) allowed.push(role)
    }
    expect(allowed).toEqual(['producer', 'admin'])
  })

  it('error de la BD: 500', async () => {
    db.failOn('users', 'select', { code: '57014', message: 'timeout' })
    const r = await call(listGET, { method: 'GET' })
    expect(r.status).toBe(500)
    expect(r.body.members).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('POST /api/team/toggle-status', () => {
  const toggle = (body) => call(togglePOST, { body })

  it('sin sesión: 401 sin tocar nada', async () => {
    state.session = null
    const before = snapshotUsers()
    const r = await toggle({ userId: 5, active: false })
    expect(r.status).toBe(401)
    expect(db.tables.users).toEqual(before)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it.each(NON_ADMIN_ROLES)('rol %s: 403 y el miembro no cambia', async (role) => {
    loginAs(role)
    const target = role === 'viewer' ? 4 : 6
    const before = snapshotUsers()
    const r = await toggle({ userId: target, active: false })
    expect(r.status).toBe(403)
    expect(db.tables.users).toEqual(before)
    expect(writes('users')).toHaveLength(0)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it.each(ADMIN_ROLES)('rol %s: puede desactivar a un miembro de su organización', async (role) => {
    loginAs(role)
    const r = await toggle({ userId: 5, active: false })
    expect(r.status).toBe(200)
    expect(user(5).active).toBe(false)
  })

  it('datos inválidos: 400', async () => {
    for (const body of [{ userId: 5 }, { active: false }, { userId: 5, active: 'false' }, { userId: 0, active: false }, null]) {
      expect((await toggle(body)).status).toBe(400)
    }
    expect(writes('users')).toHaveLength(0)
  })

  it('JSON inválido: 400 y nada cambia', async () => {
    const r = await call(togglePOST, { raw: '{no json' })
    expect(r.status).toBe(400)
    expect(writes('users')).toHaveLength(0)
  })

  it.each(ADMIN_ROLES)('rol %s: un miembro de OTRA organización es 404 y su fila no cambia', async (role) => {
    loginAs(role)
    const before = snapshotUsers()
    db.tables.aitickets_checkin_links.push({ id: 'lx', organization_id: 8, created_by: 20, revoked_at: null })
    for (const userId of [20, 21]) {
      const r = await toggle({ userId, active: false })
      expect(r.status).toBe(404)
    }
    expect(db.tables.users).toEqual(before)
    expect(db.tables.aitickets_checkin_links[0].revoked_at).toBeNull()
    expect(db.auth.admin.getUserById).not.toHaveBeenCalled()
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('id inexistente: 404', async () => {
    expect((await toggle({ userId: 999, active: false })).status).toBe(404)
  })

  it.each(ADMIN_ROLES)('rol %s: no puede desactivarse a sí mismo', async (role) => {
    loginAs(role)
    const r = await toggle({ userId: ID_BY_ROLE[role], active: false })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/propia cuenta/)
    expect(user(ID_BY_ROLE[role]).active).toBe(true)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('el dueño (producer) solo lo puede (des)activar otro producer', async () => {
    db.tables.users.push({ id: 9, name: 'Pia', email: 'pia@prod.cl', organization_id: 7, role: 'producer', active: true, auth_user_id: null })
    loginAs('admin')
    expect((await toggle({ userId: 1, active: false })).status).toBe(403)
    expect(user(1).active).toBe(true)
    user(9).active = false
    expect((await toggle({ userId: 9, active: true })).status).toBe(403)
    expect(user(9).active).toBe(false)

    loginAs('producer')
    expect((await toggle({ userId: 9, active: true })).status).toBe(200)
    expect(user(9).active).toBe(true)
    expect((await toggle({ userId: 9, active: false })).status).toBe(200)
    expect(user(9).active).toBe(false)
  })

  it('un miembro de finanzas solo lo puede (des)activar el dueño', async () => {
    loginAs('admin')
    const r = await toggle({ userId: 3, active: false })
    expect(r.status).toBe(403)
    expect(r.body.error).toMatch(/finanzas/)
    expect(user(3).active).toBe(true)
    user(3).active = false
    expect((await toggle({ userId: 3, active: true })).status).toBe(403)
    expect(user(3).active).toBe(false)

    loginAs('producer')
    expect((await toggle({ userId: 3, active: true })).status).toBe(200)
    expect(user(3).active).toBe(true)
    expect((await toggle({ userId: 3, active: false })).status).toBe(200)
    expect(user(3).active).toBe(false)
  })

  it('un admin puede desactivar a otro admin mientras quede un administrador activo', async () => {
    db.tables.users.push({ id: 10, name: 'Ada', email: 'ada@prod.cl', organization_id: 7, role: 'admin', active: true, auth_user_id: null })
    loginAs('admin')
    expect((await toggle({ userId: 10, active: false })).status).toBe(200)
    expect(user(10).active).toBe(false)
  })

  it('no deja a la organización sin administradores activos (sesión en caché desactualizada)', async () => {
    // Ana (producer) fue desactivada hace segundos pero su sesión sigue en la caché de 30 s: si desactiva a Bea,
    // la organización quedaría sin ningún administrador activo.
    user(1).active = false
    const r = await toggle({ userId: 2, active: false })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/último administrador/)
    expect(user(2).active).toBe(true)
    // Otra organización con administradores activos no cuenta
    expect(user(20).active).toBe(true)
    const count = db.calls.find((c) => c.table === 'users' && c.filters.some((f) => f.col === 'role' && f.op === 'in'))
    expect(count.filters).toEqual(expect.arrayContaining([
      { col: 'organization_id', op: 'eq', value: 7 },
      { col: 'id', op: 'neq', value: 2 },
    ]))
  })

  it('un administrador con active NULL cuenta como activo', async () => {
    user(1).active = null
    expect((await toggle({ userId: 2, active: false })).status).toBe(200)
    expect(user(2).active).toBe(false)
  })

  it('reactivar no exige administradores restantes', async () => {
    user(1).active = false
    user(2).active = false
    expect((await toggle({ userId: 2, active: true })).status).toBe(200)
    expect(user(2).active).toBe(true)
  })

  it('desactivar: guarda active=false, revoca SUS links de puerta de esta organización, bloquea el login y olvida su sesión', async () => {
    loginAs('admin')
    const before = snapshotUsers()
    db.tables.aitickets_checkin_links.push(
      { id: 'l1', organization_id: 7, created_by: 5, revoked_at: null },
      { id: 'l2', organization_id: 7, created_by: 1, revoked_at: null },
      { id: 'l3', organization_id: 8, created_by: 5, revoked_at: null },
      { id: 'l4', organization_id: 7, created_by: 5, revoked_at: '2026-01-01T00:00:00Z' },
    )
    const r = await toggle({ userId: 5, active: false })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ message: 'Usuario desactivado exitosamente', active: false })

    expect(user(5)).toMatchObject({ active: false, role: 'validator', organization_id: 7 })
    expect(user(5).updated_at).toEqual(expect.any(String))
    // Nadie más cambió
    expect(db.tables.users.filter((u) => u.id !== 5)).toEqual(before.filter((u) => u.id !== 5))
    const upd = writes('users')
    expect(upd).toHaveLength(1)
    expect(upd[0].filters).toEqual(expect.arrayContaining([{ col: 'id', op: 'eq', value: 5 }, { col: 'organization_id', op: 'eq', value: 7 }]))

    const links = Object.fromEntries(db.tables.aitickets_checkin_links.map((l) => [l.id, l.revoked_at]))
    expect(links.l1).toEqual(expect.any(String))
    expect(links.l2).toBeNull()
    expect(links.l3).toBeNull()
    expect(links.l4).toBe('2026-01-01T00:00:00Z')

    expect(db.auth.admin.updateUserById).toHaveBeenCalledTimes(1)
    expect(db.auth.admin.updateUserById).toHaveBeenCalledWith('au5', { ban_duration: '876000h' })
    expect(supabaseServer.forgetCachedSessionsOfUser).toHaveBeenCalledWith(5)
  })

  it('reactivar: active=true, desbloquea el login y no toca los links', async () => {
    user(5).active = false
    db.tables.aitickets_checkin_links.push({ id: 'l1', organization_id: 7, created_by: 5, revoked_at: '2026-02-01T00:00:00Z' })
    const r = await toggle({ userId: 5, active: true })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ message: 'Usuario reactivado exitosamente', active: true })
    expect(user(5).active).toBe(true)
    expect(db.tables.aitickets_checkin_links[0].revoked_at).toBe('2026-02-01T00:00:00Z')
    expect(writes('aitickets_checkin_links')).toHaveLength(0)
    expect(db.auth.admin.updateUserById).toHaveBeenCalledWith('au5', { ban_duration: 'none' })
  })

  it('cuenta de Auth de otra app: se desactiva en users pero NO se bloquea su login en Auth', async () => {
    const r = await toggle({ userId: 7, active: false })
    expect(r.status).toBe(200)
    expect(user(7).active).toBe(false)
    expect(db.auth.admin.getUserById).toHaveBeenCalledWith('au7')
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('miembro sin cuenta de Auth: se desactiva sin consultar Auth', async () => {
    const r = await toggle({ userId: 8, active: false })
    expect(r.status).toBe(200)
    expect(user(8).active).toBe(false)
    expect(db.auth.admin.getUserById).not.toHaveBeenCalled()
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('si Auth no encuentra la cuenta, no intenta bloquearla', async () => {
    delete authAccounts.au5
    expect((await toggle({ userId: 5, active: false })).status).toBe(200)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('error al guardar: 500, sin bloquear el login ni revocar links', async () => {
    db.tables.aitickets_checkin_links.push({ id: 'l1', organization_id: 7, created_by: 5, revoked_at: null })
    db.failOn('users', 'update', { code: '57014', message: 'statement timeout' })
    const r = await toggle({ userId: 5, active: false })
    expect(r.status).toBe(500)
    expect(user(5).active).toBe(true)
    expect(db.tables.aitickets_checkin_links[0].revoked_at).toBeNull()
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
    expect(supabaseServer.forgetCachedSessionsOfUser).not.toHaveBeenCalled()
  })

  it('un error de Auth al bloquear no revierte la desactivación (getSessionContext ya rechaza inactivos)', async () => {
    db.auth.admin.updateUserById.mockResolvedValueOnce({ data: null, error: { message: 'auth down' } })
    const r = await toggle({ userId: 5, active: false })
    expect(r.status).toBe(200)
    expect(user(5).active).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('POST /api/team/update', () => {
  const edit = (body) => call(updatePOST, { body })
  const asIs = (id, extra = {}) => ({ userId: id, name: user(id).name, email: user(id).email, role: user(id).role, ...extra })

  it('sin sesión: 401 sin tocar nada', async () => {
    state.session = null
    const before = snapshotUsers()
    expect((await edit(asIs(5, { name: 'Hack' }))).status).toBe(401)
    expect(db.tables.users).toEqual(before)
  })

  it.each(NON_ADMIN_ROLES)('rol %s: 403 y el miembro no cambia', async (role) => {
    loginAs(role)
    const before = snapshotUsers()
    const target = role === 'viewer' ? 4 : 6
    const r = await edit(asIs(target, { name: 'Cambiado', role: 'admin' }))
    expect(r.status).toBe(403)
    expect(db.tables.users).toEqual(before)
    expect(writes('users')).toHaveLength(0)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it.each(NON_ADMIN_ROLES)('rol %s: tampoco puede subirse a sí mismo a admin', async (role) => {
    loginAs(role)
    const id = ID_BY_ROLE[role]
    expect((await edit(asIs(id, { role: 'admin' }))).status).toBe(403)
    expect(user(id).role).toBe(role)
  })

  it.each(ADMIN_ROLES)('rol %s: edita nombre y rol de un miembro de su organización', async (role) => {
    loginAs(role)
    const r = await edit(asIs(5, { name: '  Valentina  ', role: 'editor' }))
    expect(r.status).toBe(200)
    expect(user(5)).toMatchObject({ name: 'Valentina', role: 'editor', email: 'val@prod.cl', organization_id: 7 })
  })

  it('campos requeridos, email y rol válidos: 400', async () => {
    const before = snapshotUsers()
    for (const body of [
      { userId: 5, name: 'X', email: 'x@y.cl' },
      { userId: 5, name: '   ', email: 'x@y.cl', role: 'viewer' },
      { name: 'X', email: 'x@y.cl', role: 'viewer' },
      { userId: 5, name: 'X', role: 'viewer' },
    ]) {
      const r = await edit(body)
      expect(r.status).toBe(400)
      expect(r.body.error).toMatch(/requeridos/)
    }
    expect((await edit(asIs(5, { email: 'no-es-correo' }))).body.error).toMatch(/Email inválido/)
    for (const role of ['producer', 'owner', 'superadmin', 'ADMIN']) {
      const r = await edit(asIs(5, { role }))
      expect(r.status).toBe(400)
      expect(r.body.error).toMatch(/Rol no válido/)
    }
    expect(db.tables.users).toEqual(before)
  })

  it.each(ADMIN_ROLES)('rol %s: un miembro de OTRA organización es 404 y su fila no cambia', async (role) => {
    loginAs(role)
    const before = snapshotUsers()
    for (const userId of [20, 21]) {
      const r = await edit({ userId, name: 'Hack', email: user(userId).email, role: 'viewer' })
      expect(r.status).toBe(404)
    }
    expect(db.tables.users).toEqual(before)
    expect(db.auth.admin.getUserById).not.toHaveBeenCalled()
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('un admin no puede editar al dueño (ni su nombre ni su correo)', async () => {
    loginAs('admin')
    const before = snapshotUsers()
    expect((await edit(asIs(1, { name: 'Otra' }))).status).toBe(403)
    expect((await edit(asIs(1, { email: 'yo@admin.cl' }))).status).toBe(403)
    expect((await edit(asIs(1, { role: 'viewer' }))).status).toBe(403)
    expect(db.tables.users).toEqual(before)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('el dueño se edita a sí mismo: conserva "producer" aunque el formulario mande "admin"', async () => {
    const r = await edit(asIs(1, { name: 'Ana María', role: 'admin' }))
    expect(r.status).toBe(200)
    expect(user(1)).toMatchObject({ name: 'Ana María', role: 'producer' })
    expect((await edit(asIs(1, { role: 'producer' }))).status).toBe(200)
    expect(user(1).role).toBe('producer')
  })

  it.each(['editor', 'validator', 'viewer'])('nadie puede quitarse su propio rol de administrador (producer → %s)', async (role) => {
    const r = await edit(asIs(1, { role }))
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/propio rol de administrador/)
    expect(user(1).role).toBe('producer')
  })

  it('un admin tampoco puede quitarse su propio rol de administrador', async () => {
    loginAs('admin')
    const r = await edit(asIs(2, { role: 'viewer' }))
    expect(r.status).toBe(400)
    expect(user(2).role).toBe('admin')
  })

  it('solo el dueño da el rol de finanzas', async () => {
    loginAs('admin')
    const r = await edit(asIs(5, { role: 'finance' }))
    expect(r.status).toBe(403)
    expect(r.body.error).toMatch(/finanzas/)
    expect(user(5).role).toBe('validator')
    // ni a sí mismo
    expect((await edit(asIs(2, { role: 'finance' }))).status).toBe(403)
    expect(user(2).role).toBe('admin')

    loginAs('producer')
    expect((await edit(asIs(5, { role: 'finance' }))).status).toBe(200)
    expect(user(5).role).toBe('finance')
  })

  it('solo el dueño quita el rol de finanzas', async () => {
    loginAs('admin')
    for (const role of ['editor', 'admin', 'viewer']) {
      expect((await edit(asIs(3, { role }))).status).toBe(403)
      expect(user(3).role).toBe('finance')
    }
    loginAs('producer')
    expect((await edit(asIs(3, { role: 'viewer' }))).status).toBe(200)
    expect(user(3).role).toBe('viewer')
  })

  it('un admin puede corregir el NOMBRE de un miembro de finanzas si no cambia su rol', async () => {
    loginAs('admin')
    expect((await edit(asIs(3, { name: 'Fiorella' }))).status).toBe(200)
    expect(user(3)).toMatchObject({ name: 'Fiorella', role: 'finance' })
  })

  // Cambiar el correo de otra persona es tomar su cuenta: "¿Olvidaste tu contraseña?" (/api/auth/magic-link) manda el
  // acceso al correo nuevo. Un admin no puede hacerlo con roles que no puede dar (admin y finanzas: retiros, reembolsos,
  // cuenta bancaria); solo el dueño. Antes un admin podía y entraba como finanzas.
  it('un admin NO puede cambiar el correo de un miembro de finanzas (sería tomar su cuenta)', async () => {
    loginAs('admin')
    const r = await edit(asIs(3, { email: 'bea.personal@mail.cl' }))
    expect(r.status).toBe(403)
    expect(user(3).email).toBe('fio@prod.cl')
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('un admin tampoco cambia el correo de otro admin; sí el suyo y el de un editor', async () => {
    db.tables.users.push({ id: 10, name: 'Ada', email: 'ada@prod.cl', organization_id: 7, role: 'admin', active: true, auth_user_id: 'au10' })
    loginAs('admin')
    expect((await edit(asIs(10, { email: 'ada.otra@mail.cl' }))).status).toBe(403)
    expect(user(10).email).toBe('ada@prod.cl')
    expect((await edit(asIs(2, { email: 'bea.nueva@prod.cl' }))).status).toBe(200)
    expect(user(2).email).toBe('bea.nueva@prod.cl')
    expect((await edit(asIs(4, { email: 'eli.nueva@prod.cl' }))).status).toBe(200)
    expect(user(4).email).toBe('eli.nueva@prod.cl')
  })

  it('el dueño sí puede cambiar el correo de finanzas y de un admin', async () => {
    loginAs('producer')
    expect((await edit(asIs(3, { email: 'fio.nueva@prod.cl' }))).status).toBe(200)
    expect(user(3).email).toBe('fio.nueva@prod.cl')
    expect((await edit(asIs(2, { email: 'bea.nueva@prod.cl' }))).status).toBe(200)
    expect(user(2).email).toBe('bea.nueva@prod.cl')
  })

  it('un producer no puede bajar de rol a otro producer (el dueño conserva su rol)', async () => {
    db.tables.users.push({ id: 9, name: 'Pia', email: 'pia@prod.cl', organization_id: 7, role: 'producer', active: true, auth_user_id: null })
    loginAs('producer')
    const r = await edit(asIs(9, { role: 'viewer' }))
    expect(r.status).toBe(403)
    expect(user(9).role).toBe('producer')
    expect((await edit(asIs(9, { role: 'admin', name: 'Pía' }))).status).toBe(200)
    expect(user(9)).toMatchObject({ name: 'Pía', role: 'producer' })
  })

  it('no deja a la organización sin administradores activos (sesión en caché desactualizada)', async () => {
    user(1).active = false // Ana fue desactivada hace segundos; su sesión sigue en la caché
    const r = await edit(asIs(2, { role: 'editor' }))
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/al menos un administrador activo/)
    expect(user(2).role).toBe('admin')
  })

  it('bajar a un admin a editor con el dueño activo: permitido', async () => {
    const r = await edit(asIs(2, { role: 'editor' }))
    expect(r.status).toBe(200)
    expect(user(2).role).toBe('editor')
  })

  it('cambiar el correo (cuenta de AI Tickets): primero Auth y luego users, normalizado', async () => {
    const r = await edit(asIs(4, { name: 'Elisa', email: '  Elisa.Nueva@Prod.CL ' }))
    expect(r.status).toBe(200)
    expect(db.auth.admin.updateUserById).toHaveBeenCalledWith('au4', { user_metadata: { full_name: 'Elisa' }, email: 'elisa.nueva@prod.cl' })
    expect(user(4)).toMatchObject({ name: 'Elisa', email: 'elisa.nueva@prod.cl', role: 'editor' })
    expect(supabaseServer.forgetCachedSessionsOfUser).toHaveBeenCalledWith(4)
    const upd = writes('users')
    expect(upd).toHaveLength(1)
    expect(upd[0].filters).toEqual(expect.arrayContaining([{ col: 'id', op: 'eq', value: 4 }, { col: 'organization_id', op: 'eq', value: 7 }]))
  })

  it('solo nombre (cuenta de AI Tickets): actualiza el nombre también en Auth, sin tocar el correo', async () => {
    expect((await edit(asIs(4, { name: 'Elisa' }))).status).toBe(200)
    expect(db.auth.admin.updateUserById).toHaveBeenCalledWith('au4', { user_metadata: { full_name: 'Elisa' } })
  })

  it('correo ya usado por otro usuario (de cualquier organización): 400 sin cambios', async () => {
    const before = snapshotUsers()
    for (const email of ['VAL@prod.cl', 'out@otra.cl']) {
      const r = await edit(asIs(4, { email }))
      expect(r.status).toBe(400)
      expect(r.body.error).toMatch(/ya está en uso/)
    }
    expect(db.tables.users).toEqual(before)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('los comodines de ILIKE (_ y %) del correo nuevo se escapan', async () => {
    // "e_i@prod.cl" sin escapar coincidiría con "eli@prod.cl"... que es el propio usuario: se usa otro
    db.tables.users.push({ id: 11, name: 'Axb', email: 'axb@prod.cl', organization_id: 8, role: 'viewer', active: true })
    expect((await edit(asIs(4, { email: 'a_b@prod.cl' }))).status).toBe(200)
    expect(user(4).email).toBe('a_b@prod.cl')
    expect((await edit(asIs(5, { email: '%@prod.cl' }))).status).toBe(200)
    expect(user(5).email).toBe('%@prod.cl')
  })

  it('cuenta de Auth de otra app: no se puede cambiar el correo (400) y no se toca Auth', async () => {
    const before = snapshotUsers()
    const r = await edit(asIs(7, { email: 'gus.nuevo@mail.cl' }))
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/otros servicios/)
    expect(db.tables.users).toEqual(before)
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('cuenta de Auth de otra app: el nombre y el rol se cambian solo en users', async () => {
    const r = await edit(asIs(7, { name: 'Gustavo', role: 'viewer' }))
    expect(r.status).toBe(200)
    expect(user(7)).toMatchObject({ name: 'Gustavo', role: 'viewer', email: 'gus@mail.cl' })
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('miembro sin cuenta de Auth: no se le cambia el correo; el nombre sí', async () => {
    expect((await edit(asIs(8, { email: 'nil2@prod.cl' }))).status).toBe(400)
    expect(user(8).email).toBe('nil@prod.cl')
    expect((await edit(asIs(8, { name: 'Nilda' }))).status).toBe(200)
    expect(user(8).name).toBe('Nilda')
    expect(db.auth.admin.getUserById).not.toHaveBeenCalled()
  })

  it('si Auth rechaza el correo nuevo: 400 y users no cambia', async () => {
    db.auth.admin.updateUserById.mockResolvedValueOnce({ data: null, error: { message: 'A user with this email address has already been registered' } })
    const before = snapshotUsers()
    const r = await edit(asIs(4, { email: 'ya@existe.cl' }))
    expect(r.status).toBe(400)
    expect(db.tables.users).toEqual(before)
    expect(writes('users')).toHaveLength(0)
  })

  it('si Auth falla al cambiar solo el nombre, igual se guarda en users', async () => {
    db.auth.admin.updateUserById.mockResolvedValueOnce({ data: null, error: { message: 'auth down' } })
    expect((await edit(asIs(4, { name: 'Elisa' }))).status).toBe(200)
    expect(user(4).name).toBe('Elisa')
  })

  it('error al guardar en users: 500', async () => {
    db.failOn('users', 'update', { code: '57014', message: 'statement timeout' })
    const r = await edit(asIs(5, { name: 'Valentina' }))
    expect(r.status).toBe(500)
    expect(user(5).name).toBe('Val')
    expect(supabaseServer.forgetCachedSessionsOfUser).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------------------------------------------
describe('POST /api/team/accept-invitation (ruta)', () => {
  const NOW_PLUS = (days) => new Date(Date.now() + days * 86_400_000).toISOString()
  const session = { access_token: 'at-123', refresh_token: 'rt-456' }
  let token

  function addInvitation(extra = {}) {
    const generated = generateInvitationToken()
    token = generated.token
    const row = {
      id: '00000000-0000-4000-8000-00000000000a', organization_id: 7, email: 'nuevo@prod.cl', name: 'Nuevo', role: 'validator',
      event_ids: [], token_hash: generated.hash, invited_by: 1, expires_at: NOW_PLUS(5), accepted_at: null, revoked_at: null, ...extra,
    }
    db.tables.aitickets_team_invitations.push(row)
    return row
  }
  const accept = (body, { ip = '203.0.113.9', cookies = cookieJar(), raw } = {}) =>
    call(acceptPOST, { body, raw, cookies, headers: { 'x-nf-client-connection-ip': ip } })

  beforeEach(() => {
    state.session = null // ruta pública: la protege el token
    state.ephemeral = { auth: { signInWithPassword: vi.fn(async () => ({ data: { session, user: { id: 'au-new' } }, error: null })) } }
  })

  it('límite de intentos por IP: 429 sin cargar la invitación', async () => {
    addInvitation()
    rateLimit.mockResolvedValueOnce({ allowed: false, source: 'db' })
    const r = await accept({ token, password: INVITE_PW })
    expect(r.status).toBe(429)
    expect(rateLimit).toHaveBeenCalledWith('team:accept', '203.0.113.9', expect.objectContaining({ windowSeconds: 600, max: 15, supabase: db }))
    expect(db.calls.some((c) => c.table === 'aitickets_team_invitations')).toBe(false)
    expect(acceptTeamInvitation).not.toHaveBeenCalled()
  })

  it('JSON inválido: 400', async () => {
    const r = await accept(undefined, { raw: '{no json' })
    expect(r.status).toBe(400)
    expect(acceptTeamInvitation).not.toHaveBeenCalled()
  })

  it('happy path: crea la cuenta, deja la sesión en cookies, registra el ingreso y redirige según el rol', async () => {
    addInvitation()
    const cookies = cookieJar()
    const r = await accept({ token, name: 'Nuevo Miembro', password: INVITE_PW }, { cookies })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, redirectTo: '/validador' })

    // La invitación cargada por el token llega a acceptTeamInvitation con el cliente efímero (no el admin)
    const [supabaseArg, authArg, invitationArg, input] = acceptTeamInvitation.mock.calls[0]
    expect(supabaseArg).toBe(db)
    expect(authArg).toBe(state.ephemeral)
    expect(invitationArg).toMatchObject({ email: 'nuevo@prod.cl', organization_id: 7 })
    expect(input).toEqual({ name: 'Nuevo Miembro', password: INVITE_PW })

    const created = db.tables.users.find((u) => u.email === 'nuevo@prod.cl')
    expect(created).toMatchObject({ organization_id: 7, role: 'validator', active: true, auth_user_id: 'au-new' })
    expect(db.tables.aitickets_team_invitations[0].accepted_at).toEqual(expect.any(String))

    expect(cookies.store.get('sb-access-token')).toBe('at-123')
    expect(cookies.store.get('sb-refresh-token')).toBe('rt-456')
    expect(cookies.store.get('ait_p')).toBe('1')
    expect(supabaseServer.recordLogin).toHaveBeenCalledWith({ id: created.id })
    expect(created.login_count).toBe(1)
    expect(created.last_access_at).toEqual(expect.any(String))
  })

  it('token desconocido o mal formado: 404 de la librería, sin cookies', async () => {
    addInvitation()
    for (const bad of ['aitinv_no-existe-pero-tiene-forma-valida-123456789', 'x', null]) {
      const cookies = cookieJar()
      const r = await accept({ token: bad, password: INVITE_PW }, { cookies })
      expect(r.status).toBe(404)
      expect(r.body.code).toBe('not_found')
      expect(cookies.set).not.toHaveBeenCalled()
    }
    expect(acceptTeamInvitation.mock.calls.every((c) => c[2] === null)).toBe(true)
    expect(supabaseServer.recordLogin).not.toHaveBeenCalled()
  })

  it('traduce los rechazos de la librería a su status (vencida 410, usada 409, otra organización 409)', async () => {
    addInvitation({ expires_at: NOW_PLUS(-1) })
    let r = await accept({ token, password: INVITE_PW })
    expect(r).toMatchObject({ status: 410, body: { code: 'expired' } })

    db.tables.aitickets_team_invitations.length = 0
    addInvitation({ accepted_at: '2026-10-01T00:00:00Z' })
    r = await accept({ token, password: INVITE_PW })
    expect(r).toMatchObject({ status: 409, body: { code: 'accepted' } })

    db.tables.aitickets_team_invitations.length = 0
    addInvitation({ email: 'out@otra.cl' })
    const before = snapshotUsers()
    r = await accept({ token, password: INVITE_PW })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('other_org')
    // El miembro de la otra organización no se mueve
    expect(db.tables.users).toEqual(before)
    expect(supabaseServer.setSessionCookies).not.toHaveBeenCalled()
  })

  it('cualquier otro { ok:false } de la librería se devuelve tal cual, sin sesión', async () => {
    addInvitation()
    acceptTeamInvitation.mockResolvedValueOnce({ ok: false, status: 401, code: 'wrong_password', message: 'Contraseña incorrecta' })
    const cookies = cookieJar()
    const r = await accept({ token, password: WRONG_PW }, { cookies })
    expect(r).toEqual({ status: 401, body: { code: 'wrong_password', message: 'Contraseña incorrecta' }, cookies })
    expect(cookies.set).not.toHaveBeenCalled()
    expect(supabaseServer.recordLogin).not.toHaveBeenCalled()
  })

  it('si la librería lanza: 500 genérico y sin cookies', async () => {
    addInvitation()
    acceptTeamInvitation.mockRejectedValueOnce(Object.assign(new Error('statement timeout'), { code: '57014' }))
    const cookies = cookieJar()
    const r = await accept({ token, password: INVITE_PW }, { cookies })
    expect(r.status).toBe(500)
    expect(r.body.message).not.toMatch(/timeout/)
    expect(cookies.set).not.toHaveBeenCalled()
  })

  it('error leyendo la invitación: se trata como inexistente (404)', async () => {
    addInvitation()
    db.failOn('aitickets_team_invitations', 'select', { code: '57014', message: 'timeout' })
    const r = await accept({ token, password: INVITE_PW })
    expect(r.status).toBe(404)
  })
})
