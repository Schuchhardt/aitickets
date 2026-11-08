// Alta directa de miembros desde el panel (src/lib/team-add.ts y POST /api/team/add).
//
// El doble de Auth reproduce lo que hace la BD real y que causó el bug de 07-11 (org 45):
//  - createUser dispara el trigger handle_new_user: inserta la fila de public.users SIN organización (role NULL,
//    migración 202611080100) salvo que el correo ya esté en public.users.
//  - public.users.email es UNIQUE (users_email_key): un INSERT con el mismo correo da 23505.
//  - users.auth_user_id referencia a auth.users SIN ON DELETE: deleteUser falla si queda una fila que lo apunta.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const session = vi.hoisted(() => ({ current: null, db: null }))
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => session.db }))
vi.mock('../../src/lib/supabaseServer', () => ({
  getSessionContext: async () => session.current,
  hasRole: (u, roles) => roles.includes(u?.role || ''),
  ORG_ADMIN_ROLES: ['admin', 'producer'],
}))

const { addTeamMember, isAuthEmailTaken } = await import('../../src/lib/team-add.ts')
const { POST: addRoute } = await import('../../src/pages/api/team/add.ts')

let db
let authUsers
let log

/** Auth falso con el trigger y el FK de producción. */
function fakeAuth({ triggerFails = false } = {}) {
  let seq = 0
  return {
    admin: {
      createUser: vi.fn(async ({ email, user_metadata, app_metadata }) => {
        if (authUsers.some((u) => u.email === email)) {
          return { data: { user: null }, error: { code: 'email_exists', message: 'A user with this email address has already been registered' } }
        }
        const user = { id: `au-${++seq}`, email, app_metadata, user_metadata, last_sign_in_at: null }
        authUsers.push(user)
        // trigger on_auth_user_created → public.handle_new_user()
        if (!triggerFails && !db.tables.users.some((u) => String(u.email).toLowerCase() === email)) {
          db.tables.users.push({ id: 900 + seq, auth_user_id: user.id, email, name: user_metadata?.full_name ?? null, organization_id: null, role: null, active: true })
        }
        return { data: { user }, error: null }
      }),
      deleteUser: vi.fn(async (id) => {
        if (db.tables.users.some((u) => u.auth_user_id === id)) {
          return { data: null, error: { message: 'Database error deleting user' } } // FK users_auth_user_id_fkey
        }
        authUsers = authUsers.filter((u) => u.id !== id)
        return { data: {}, error: null }
      }),
      getUserById: vi.fn(async (id) => ({ data: { user: authUsers.find((u) => u.id === id) || null }, error: null })),
      updateUserById: vi.fn(async () => ({ data: {}, error: null })),
    },
  }
}

const orphans = () => db.tables.users.filter((u) => u.organization_id == null)

beforeEach(() => {
  authUsers = [
    { id: 'au-ana', email: 'ana@prod.cl', app_metadata: { app: 'aitickets' }, last_sign_in_at: '2026-10-01T00:00:00Z' },
    { id: 'au-out', email: 'out@otra.cl', app_metadata: { app: 'aitickets' }, last_sign_in_at: '2026-10-01T00:00:00Z' },
  ]
  db = createFakeSupabase({
    tables: {
      users: [
        { id: 1, name: 'Ana', email: 'ana@prod.cl', organization_id: 7, role: 'producer', active: true, auth_user_id: 'au-ana' },
        { id: 4, name: 'Out', email: 'out@otra.cl', organization_id: 8, role: 'admin', active: true, auth_user_id: 'au-out' },
        { id: 5, name: 'Old', email: 'old@prod.cl', organization_id: 7, role: 'editor', active: false, auth_user_id: 'au-old' },
      ],
    },
    unique: { users: [['email']] },
  })
  db.auth = fakeAuth()
  log = { error: vi.fn(), warn: vi.fn() }
})

const add = (input, opts = {}) => addTeamMember(db, 7, { name: 'Romyna', email: 'romy@mail.cl', role: 'validator', ...input }, { log, ...opts })

describe('addTeamMember: correo nuevo', () => {
  it('actualiza la fila que creó el trigger (no INSERT): queda con org, rol y nombre, sin huérfanos', async () => {
    const res = await add({})
    expect(res).toMatchObject({ ok: true, adopted: false })
    expect(res.tempPassword).toMatch(/Aa1!$/)
    const rows = db.tables.users.filter((u) => u.email === 'romy@mail.cl')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: res.userId, organization_id: 7, role: 'validator', name: 'Romyna', active: true, auth_user_id: 'au-1' })
    expect(orphans()).toHaveLength(0)
    // Nunca un INSERT en users cuando el trigger ya creó la fila (era lo que chocaba con users_email_key)
    expect(db.calls.some((c) => c.table === 'users' && c.op === 'insert')).toBe(false)
    // La organización y el rol NO viajan en la metadata (el trigger también corre en el registro público)
    const args = db.auth.admin.createUser.mock.calls[0][0]
    expect(args.user_metadata).toEqual({ full_name: 'Romyna' })
    expect(JSON.stringify(args)).not.toMatch(/organization|validator/)
    expect(args.app_metadata).toEqual({ app: 'aitickets' })
  })

  it('si el trigger no creó la fila (se tragó un error), recién ahí inserta', async () => {
    db.auth = fakeAuth({ triggerFails: true })
    const res = await add({})
    expect(res).toMatchObject({ ok: true })
    expect(db.tables.users.find((u) => u.email === 'romy@mail.cl')).toMatchObject({ organization_id: 7, role: 'validator', auth_user_id: 'au-1' })
    expect(orphans()).toHaveLength(0)
  })

  it('falla después de createUser: borra la fila y LUEGO la cuenta de Auth, y loguea el error original', async () => {
    db.failOn('users', 'update', { code: '57014', message: 'canceling statement due to statement timeout' })
    const res = await add({})
    expect(res).toMatchObject({ ok: false, status: 500, code: 'internal' })
    expect(res.message).not.toMatch(/registrado/)
    expect(db.tables.users.some((u) => u.email === 'romy@mail.cl')).toBe(false)
    expect(authUsers.some((u) => u.email === 'romy@mail.cl')).toBe(false)
    expect(db.auth.admin.deleteUser).toHaveBeenCalledWith('au-1')
    expect(await db.auth.admin.deleteUser.mock.results[0].value).toMatchObject({ error: null })
    expect(log.error).toHaveBeenCalledWith('team/add: se revierte el alta:', expect.objectContaining({ code: '57014' }))
    // Reintentar funciona (antes: 400 "ya registrado" para siempre)
    expect(await add({})).toMatchObject({ ok: true })
  })

  it('duplicado real (correo registrado entre la búsqueda y el alta): 409 "ya registrado" y revierte', async () => {
    db.auth = fakeAuth({ triggerFails: true })
    const create = db.auth.admin.createUser
    db.auth.admin.createUser = vi.fn(async (args) => {
      db.tables.users.push({ id: 77, email: args.email, organization_id: 9, role: 'producer', auth_user_id: 'au-otro' })
      return create(args)
    })
    const res = await add({})
    expect(res).toMatchObject({ ok: false, status: 409, code: 'duplicate', message: 'Este correo electrónico ya está registrado.' })
    expect(authUsers.some((u) => u.id === 'au-1')).toBe(false)
    expect(db.tables.users.find((u) => u.id === 77)).toBeTruthy()
  })

  it('correo con cuenta de Auth de otra app (no en AI Tickets): 409 sin vincular ni crear nada', async () => {
    authUsers.push({ id: 'au-kefy', email: 'romy@mail.cl', app_metadata: {}, last_sign_in_at: '2026-09-01T00:00:00Z' })
    const res = await add({})
    expect(res).toMatchObject({ ok: false, status: 409, code: 'auth_exists' })
    expect(db.tables.users.some((u) => u.email === 'romy@mail.cl')).toBe(false)
  })

  it('otro error de createUser: 500 genérico y log del error original', async () => {
    db.auth.admin.createUser = vi.fn(async () => ({ data: { user: null }, error: { message: 'Database error creating new user', status: 500 } }))
    const res = await add({})
    expect(res).toMatchObject({ ok: false, status: 500, code: 'internal' })
    expect(log.error).toHaveBeenCalledWith('team/add: createUser falló:', expect.objectContaining({ message: 'Database error creating new user' }))
  })
})

describe('addTeamMember: correos existentes', () => {
  it('de otra organización: 409 y no crea ninguna cuenta de Auth', async () => {
    const res = await add({ email: 'out@otra.cl' })
    expect(res).toMatchObject({ ok: false, status: 409, code: 'other_org' })
    expect(db.auth.admin.createUser).not.toHaveBeenCalled()
    expect(db.tables.users.find((u) => u.id === 4)).toMatchObject({ organization_id: 8, role: 'admin' })
  })

  it('ya es miembro (activo o desactivado): 409 sin cambios', async () => {
    expect(await add({ email: 'ana@prod.cl' })).toMatchObject({ ok: false, status: 409, code: 'already_member' })
    const inactive = await add({ email: 'OLD@prod.cl' })
    expect(inactive).toMatchObject({ ok: false, status: 409, code: 'already_member' })
    expect(inactive.message).toMatch(/desactivada/)
    expect(db.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('huérfano de un alta fallida (cuenta nunca usada): se adopta y recibe contraseña temporal', async () => {
    authUsers.push({ id: 'au-71', email: 'romy@mail.cl', app_metadata: { app: 'aitickets' }, last_sign_in_at: null })
    db.tables.users.push({ id: 71, email: 'romy@mail.cl', name: 'Romyna Sánchez', organization_id: null, role: 'admin', active: true, auth_user_id: 'au-71' })
    const res = await add({ name: 'Romy' })
    expect(res).toMatchObject({ ok: true, adopted: true, userId: 71 })
    expect(res.tempPassword).toBeTruthy()
    expect(db.tables.users.find((u) => u.id === 71)).toMatchObject({ organization_id: 7, role: 'validator', name: 'Romyna Sánchez', active: true })
    expect(db.auth.admin.updateUserById).toHaveBeenCalledWith('au-71', { password: res.tempPassword })
    expect(db.auth.admin.createUser).not.toHaveBeenCalled()
    expect(orphans()).toHaveLength(0)
  })

  it('huérfano con una cuenta ya usada (p. ej. entró con Google): se adopta SIN tocar su contraseña', async () => {
    authUsers.push({ id: 'au-73', email: 'romy@mail.cl', app_metadata: { app: 'aitickets', providers: ['email', 'google'] }, last_sign_in_at: '2026-11-08T02:21:19Z' })
    db.tables.users.push({ id: 73, email: 'romy@mail.cl', name: null, organization_id: null, role: null, active: true, auth_user_id: 'au-73' })
    const res = await add({})
    expect(res).toMatchObject({ ok: true, adopted: true, tempPassword: null })
    expect(res.message).toMatch(/su contraseña/)
    expect(db.tables.users.find((u) => u.id === 73)).toMatchObject({ organization_id: 7, role: 'validator', name: 'Romyna' })
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('huérfano de otra app del proyecto (no creado por AI Tickets): no se le cambia la contraseña', async () => {
    authUsers.push({ id: 'au-x', email: 'romy@mail.cl', app_metadata: {}, last_sign_in_at: null })
    db.tables.users.push({ id: 80, email: 'romy@mail.cl', organization_id: null, role: null, active: true, auth_user_id: 'au-x' })
    expect(await add({})).toMatchObject({ ok: true, adopted: true, tempPassword: null })
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('fila antigua sin cuenta de Auth: se adopta y se le crea una cuenta vinculada', async () => {
    db.tables.users.push({ id: 3, email: 'romy@mail.cl', name: 'Joaquín', organization_id: null, role: 'admin', active: true, auth_user_id: null })
    const res = await add({})
    expect(res).toMatchObject({ ok: true, adopted: true, userId: 3 })
    expect(res.tempPassword).toBeTruthy()
    expect(db.tables.users.filter((u) => u.email === 'romy@mail.cl')).toEqual([expect.objectContaining({ id: 3, auth_user_id: 'au-1', organization_id: 7, role: 'validator' })])
  })

  it('carrera: otra organización adopta al huérfano primero => 409', async () => {
    db.tables.users.push({ id: 71, email: 'romy@mail.cl', organization_id: null, role: null, active: true, auth_user_id: null })
    const realFrom = db.from
    db.from = (table) => {
      const b = realFrom(table)
      const update = b.update
      b.update = (values, opts) => {
        db.tables.users.find((u) => u.id === 71).organization_id = 8
        return update(values, opts)
      }
      return b
    }
    expect(await add({})).toMatchObject({ ok: false, status: 409, code: 'other_org' })
  })
})

describe('POST /api/team/add', () => {
  const req = (body) => ({ request: new Request('https://aitickets.test/api/team/add', { method: 'POST', body: JSON.stringify(body) }) })
  beforeEach(() => {
    session.db = db
    session.current = { dbUser: { id: 1, organization_id: 7, role: 'producer' } }
  })

  it('200 con contraseña temporal; 409 para otra organización', async () => {
    const ok = await addRoute(req({ name: 'Romyna', email: ' Romy@Mail.cl ', role: 'validator' }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ message: 'Miembro agregado exitosamente', adopted: false, tempPassword: expect.any(String) })
    const other = await addRoute(req({ name: 'Out', email: 'out@otra.cl', role: 'viewer' }))
    expect(other.status).toBe(409)
    expect(await other.json()).toMatchObject({ code: 'other_org' })
  })

  it('valida rol y permisos', async () => {
    expect((await addRoute(req({ name: 'X', email: 'x@y.cl', role: 'producer' }))).status).toBe(400)
    session.current = { dbUser: { id: 2, organization_id: 7, role: 'admin' } }
    expect((await addRoute(req({ name: 'X', email: 'x@y.cl', role: 'finance' }))).status).toBe(403)
    session.current = { dbUser: { id: 3, organization_id: 7, role: 'validator' } }
    expect((await addRoute(req({ name: 'X', email: 'x@y.cl', role: 'viewer' }))).status).toBe(403)
  })
})

describe('isAuthEmailTaken', () => {
  it('reconoce los errores de correo ya registrado de Supabase Auth', () => {
    expect(isAuthEmailTaken({ code: 'email_exists' })).toBe(true)
    expect(isAuthEmailTaken({ message: 'A user with this email address has already been registered' })).toBe(true)
    expect(isAuthEmailTaken({ message: 'User already registered' })).toBe(true)
    expect(isAuthEmailTaken({ message: 'Database error creating new user' })).toBe(false)
    expect(isAuthEmailTaken(null)).toBe(false)
  })
})
