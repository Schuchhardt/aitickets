// Herramientas de equipo (team.ts), aceptación de invitaciones (team-accept.ts) y acceso por evento.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const sent = []
vi.mock('../../netlify/lib/mailer.mjs', () => ({
  sendEmail: vi.fn(async (msg) => { sent.push(msg); return { id: 'email_1' } }),
  isValidEmail: (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
  formatRecipient: (name, email) => (name ? `${name} <${email}>` : email),
}))
vi.mock('../../netlify/lib/emails/team.mjs', () => ({
  renderTeamInvitationEmail: async ({ url }) => ({ subject: 'Invitación', html: `<a href="${url}">ok</a>`, text: url }),
}))

const { teamTools } = await import('../../src/lib/producer-api/tools/team.ts')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { acceptTeamInvitation } = await import('../../src/lib/team-accept.ts')
const { hashInvitationToken, generateInvitationToken } = await import('../../src/lib/team-invitations.ts')
const { getStaffEventIds, canAccessEventByStaff } = await import('../../netlify/lib/event-staff.mjs')

const tool = (name) => teamTools.find((t) => t.name === name)
let db
const ctxFor = (userId = 1, role = 'producer', scopes = ['read', 'team']) => ({
  supabase: db,
  actor: { keyId: 'k1', userId, orgId: 7, role, name: 'Ana', email: 'ana@prod.cl', scopes, eventIds: null },
  origin: 'https://aitickets.test',
  requestUrl: new URL('https://aitickets.test/api/mcp'),
  channel: 'mcp',
})
const call = (name, args, ctx = ctxFor()) => runTool(tool(name), args, ctx)

beforeEach(() => {
  sent.length = 0
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Prod SpA' }, { id: 8, public_name: 'Otra' }],
      users: [
        { id: 1, name: 'Ana', email: 'ana@prod.cl', organization_id: 7, role: 'producer', active: true, auth_user_id: 'au1' },
        { id: 2, name: 'Bea', email: 'bea@prod.cl', organization_id: 7, role: 'admin', active: true, auth_user_id: 'au2' },
        { id: 3, name: 'Val', email: 'val@prod.cl', organization_id: 7, role: 'validator', active: true, auth_user_id: 'au3' },
        { id: 4, name: 'Out', email: 'out@otra.cl', organization_id: 8, role: 'admin', active: true },
        { id: 5, name: 'Old', email: 'old@prod.cl', organization_id: 7, role: 'editor', active: false, auth_user_id: 'au5' },
      ],
      events: [{ id: 10, organization_id: 7 }, { id: 11, organization_id: 7 }, { id: 20, organization_id: 8 }],
      aitickets_event_staff: [],
      aitickets_team_invitations: [],
      aitickets_api_keys: [{ id: 'key-3', user_id: 3, organization_id: 7, revoked_at: null }],
      aitickets_oauth_grants: [],
      aitickets_api_audit: [],
      aitickets_api_idempotency: [],
    },
    unique: { aitickets_api_idempotency: [['organization_id', 'tool', 'idem_key']] },
  })
})

describe('list_members / list_roles', () => {
  it('lista miembros con etiqueta de rol y eventos asignados', async () => {
    db.tables.aitickets_event_staff.push({ organization_id: 7, event_id: 10, user_id: 3 })
    const out = await call('list_members', {})
    expect(out.ok).toBe(true)
    const members = out.result.members
    expect(members.map((m) => m.id)).toEqual([1, 2, 3, 5])
    expect(members.find((m) => m.id === 3)).toMatchObject({ role_label: 'Puerta', event_access: { restricted: true, event_ids: [10] } })
    expect(members.find((m) => m.id === 1)).toMatchObject({ is_owner: true, is_you: true })
  })

  it('list_roles incluye finanzas y solo lectura con permisos', async () => {
    const out = await call('list_roles', {})
    const roles = out.result.roles.map((r) => r.role)
    expect(roles).toEqual(expect.arrayContaining(['producer', 'admin', 'finance', 'editor', 'validator', 'viewer']))
    expect(out.result.roles.find((r) => r.role === 'producer').assignable).toBe(false)
  })

  it('sin scope team: forbidden', async () => {
    const out = await call('list_members', {}, ctxFor(1, 'producer', ['read']))
    expect(out).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('un validador no puede invitar (rol)', async () => {
    const out = await call('invite_member', { email: 'x@y.cl', role: 'viewer' }, ctxFor(3, 'validator'))
    expect(out).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('invite_member', () => {
  it('crea la invitación (solo hash), envía correo y no devuelve el token', async () => {
    const out = await call('invite_member', { email: 'Nuevo@Prod.cl', name: 'Nuevo', role: 'validator', event_ids: [10] })
    expect(out.ok).toBe(true)
    const inv = db.tables.aitickets_team_invitations[0]
    expect(inv).toMatchObject({ email: 'nuevo@prod.cl', role: 'validator', event_ids: [10], organization_id: 7 })
    expect(inv.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(out.result)).not.toMatch(/aitinv_/)
    expect(out.result.email_sent).toBe(true)
    expect(sent).toHaveLength(1)
    const token = sent[0].text.match(/aitinv_[A-Za-z0-9_-]+/)[0]
    expect(hashInvitationToken(token)).toBe(inv.token_hash)
    expect(db.tables.aitickets_api_audit.at(-1).summary).not.toMatch(/@/)
  })

  it('rechaza correos de otra organización, miembros activos y eventos ajenos', async () => {
    expect(await call('invite_member', { email: 'out@otra.cl', role: 'viewer' })).toMatchObject({ ok: false, code: 'conflict' })
    expect(await call('invite_member', { email: 'bea@prod.cl', role: 'viewer' })).toMatchObject({ ok: false, code: 'conflict' })
    expect(await call('invite_member', { email: 'z@prod.cl', role: 'viewer', event_ids: [20] })).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('solo el dueño invita administradores', async () => {
    expect(await call('invite_member', { email: 'z@prod.cl', role: 'admin' }, ctxFor(2, 'admin'))).toMatchObject({ ok: false, code: 'forbidden' })
    expect((await call('invite_member', { email: 'z@prod.cl', role: 'admin' })).ok).toBe(true)
  })

  it('reinvitar revoca la pendiente anterior; idempotency_key repite la respuesta', async () => {
    await call('invite_member', { email: 'z@prod.cl', role: 'viewer' })
    const second = await call('invite_member', { email: 'z@prod.cl', role: 'finance', idempotency_key: 'inv-0001' })
    expect(second.result.replaced_pending_invitations).toBe(1)
    const replay = await call('invite_member', { email: 'z@prod.cl', role: 'finance', idempotency_key: 'inv-0001' })
    expect(replay.result).toMatchObject({ invitation_id: second.result.invitation_id, idempotent_replay: true })
    expect(db.tables.aitickets_team_invitations).toHaveLength(2)
    expect(db.tables.aitickets_team_invitations[0].revoked_at).toBeTruthy()
  })
})

describe('update_member_role / remove_member', () => {
  it('cambia rol; no al dueño ni a sí mismo; admin solo por el dueño', async () => {
    expect((await call('update_member_role', { user_id: 3, role: 'finance' })).result).toMatchObject({ changed: true, role: 'finance' })
    expect(db.tables.users.find((u) => u.id === 3).role).toBe('finance')
    expect(await call('update_member_role', { user_id: 1, role: 'viewer' }, ctxFor(2, 'admin'))).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await call('update_member_role', { user_id: 2, role: 'viewer' }, ctxFor(2, 'admin'))).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await call('update_member_role', { user_id: 3, role: 'admin' }, ctxFor(2, 'admin'))).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('remove_member desactiva y revoca llaves', async () => {
    db.supabase = db
    db.auth = { admin: { getUserById: async () => ({ data: { user: { app_metadata: { app: 'aitickets' } } } }), updateUserById: vi.fn(async () => ({})) } }
    const out = await call('remove_member', { user_id: 3 })
    expect(out.result).toMatchObject({ active: false, api_keys_revoked: 1 })
    expect(db.tables.users.find((u) => u.id === 3).active).toBe(false)
    expect(db.tables.aitickets_api_keys[0].revoked_at).toBeTruthy()
    expect(db.auth.admin.updateUserById).toHaveBeenCalledWith('au3', { ban_duration: '876000h' })
    expect(await call('remove_member', { user_id: 1 })).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await call('remove_member', { user_id: 1 }, ctxFor(1))).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('solo el dueño da, quita o invita el rol de finanzas', async () => {
    const admin = ctxFor(2, 'admin')
    expect(await call('invite_member', { email: 'conta@prod.cl', role: 'finance' }, admin)).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await call('update_member_role', { user_id: 3, role: 'finance' }, admin)).toMatchObject({ ok: false, code: 'forbidden' })
    expect((await call('update_member_role', { user_id: 3, role: 'finance' })).ok).toBe(true)
    expect(await call('update_member_role', { user_id: 3, role: 'editor' }, admin)).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await call('remove_member', { user_id: 3 }, admin)).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('remove_member revoca los links de puerta que creó', async () => {
    db.auth = { admin: { getUserById: async () => ({ data: { user: { app_metadata: {} } } }), updateUserById: vi.fn() } }
    db.tables.aitickets_checkin_links = [
      { id: 'l1', organization_id: 7, event_id: 10, created_by: 3, revoked_at: null },
      { id: 'l2', organization_id: 7, event_id: 10, created_by: 1, revoked_at: null },
    ]
    const out = await call('remove_member', { user_id: 3 })
    expect(out.result.door_links_revoked).toBe(1)
    expect(db.tables.aitickets_checkin_links.find((l) => l.id === 'l1').revoked_at).toBeTruthy()
    expect(db.tables.aitickets_checkin_links.find((l) => l.id === 'l2').revoked_at).toBeNull()
  })
})

describe('invitaciones y acceso por evento', () => {
  it('list_invitations y revoke_invitation', async () => {
    await call('invite_member', { email: 'z@prod.cl', role: 'viewer' })
    db.tables.aitickets_team_invitations[0].id = '11111111-2222-3333-4444-555555555555'
    const list = await call('list_invitations', {})
    expect(list.result.invitations[0]).toMatchObject({ status: 'pending', role_label: 'Solo lectura' })
    const id = list.result.invitations[0].id
    expect((await call('revoke_invitation', { invitation_id: id })).result).toMatchObject({ status: 'revoked', changed: true })
    expect((await call('list_invitations', { status: 'revoked' })).result.count).toBe(1)
  })

  it('assign_event_staff agrega, quita y reemplaza', async () => {
    expect((await call('assign_event_staff', { user_id: 3, add_event_ids: [10, 11] })).result.event_access).toEqual({ restricted: true, event_ids: [10, 11] })
    expect((await call('assign_event_staff', { user_id: 3, remove_event_ids: [11] })).result.event_access.event_ids).toEqual([10])
    expect(await call('assign_event_staff', { user_id: 3, remove_event_ids: [10] })).toMatchObject({ ok: false, code: 'conflict' })
    expect((await call('assign_event_staff', { user_id: 3, replace_event_ids: [] })).result.event_access.restricted).toBe(false)
    expect(db.tables.aitickets_event_staff).toHaveLength(0)
    expect(await call('assign_event_staff', { user_id: 3, add_event_ids: [20] })).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('assign_event_staff: no sobre uno mismo; un actor limitado no amplía accesos', async () => {
    expect(await call('assign_event_staff', { user_id: 2, replace_event_ids: [10] }, ctxFor(2, 'admin'))).toMatchObject({ ok: false, code: 'forbidden' })
    const limited = { ...ctxFor(2, 'admin'), actor: { ...ctxFor(2, 'admin').actor, eventIds: [10] } }
    expect(await call('assign_event_staff', { user_id: 3, add_event_ids: [11] }, limited)).toMatchObject({ ok: false, code: 'forbidden' })
    db.tables.aitickets_event_staff.push({ organization_id: 7, event_id: 10, user_id: 3 })
    expect(await call('assign_event_staff', { user_id: 3, replace_event_ids: [] }, limited)).toMatchObject({ ok: false, code: 'forbidden' })
    expect((await call('assign_event_staff', { user_id: 3, replace_event_ids: [10] }, limited)).ok).toBe(true)
  })

  it('event-staff.mjs restringe solo a quien tiene filas y tolera tabla inexistente', async () => {
    db.tables.aitickets_event_staff.push({ organization_id: 7, event_id: 10, user_id: 3 })
    expect(await getStaffEventIds(db, 3)).toEqual([10])
    expect(await getStaffEventIds(db, 1)).toBeNull()
    expect(await canAccessEventByStaff(db, 3, 11)).toBe(false)
    expect(await canAccessEventByStaff(db, 3, '10')).toBe(true)
    db.failOn('aitickets_event_staff', 'select', { code: '42P01', message: 'no existe' })
    expect(await getStaffEventIds(db, 3)).toBeNull()
  })

  it('event-staff.mjs falla cerrado ante otros errores de lectura', async () => {
    db.failOn('aitickets_event_staff', 'select', { code: '57014', message: 'timeout' }, { once: false })
    expect(await getStaffEventIds(db, 3)).toEqual([])
    expect(await canAccessEventByStaff(db, 3, 10)).toBe(false)
  })
})

describe('acceptTeamInvitation', () => {
  const NOW = new Date('2026-10-09T12:00:00Z')
  const session = { access_token: 'at', refresh_token: 'rt' }
  const addInvitation = (extra = {}) => {
    const { hash } = generateInvitationToken()
    const row = {
      id: '00000000-0000-0000-0000-00000000000a', organization_id: 7, email: 'nuevo@prod.cl', name: 'Nuevo', role: 'validator',
      event_ids: [10], token_hash: hash, invited_by: 1, expires_at: '2026-10-16T12:00:00Z', accepted_at: null, revoked_at: null, ...extra,
    }
    db.tables.aitickets_team_invitations.push(row)
    return row
  }
  const authFor = (ok = true) => ({ auth: { signInWithPassword: vi.fn(async () => (ok ? { data: { session, user: { id: 'au-new' } }, error: null } : { data: {}, error: { message: 'Invalid login' } })) } })

  it('crea la cuenta, la fila users, el acceso por evento y marca la invitación', async () => {
    const inv = addInvitation()
    db.auth = { admin: { createUser: vi.fn(async () => ({ data: { user: { id: 'au-new' } }, error: null })) } }
    const res = await acceptTeamInvitation(db, authFor(), inv, { name: 'Nuevo', password: 'secreto123' }, NOW)
    expect(res).toMatchObject({ ok: true, role: 'validator', redirectTo: '/dashboard/events' })
    const user = db.tables.users.find((u) => u.email === 'nuevo@prod.cl')
    expect(user).toMatchObject({ organization_id: 7, role: 'validator', active: true, auth_user_id: 'au-new' })
    expect(db.auth.admin.createUser.mock.calls[0][0].app_metadata).toEqual({ app: 'aitickets' })
    expect(db.tables.aitickets_event_staff).toEqual([expect.objectContaining({ event_id: 10, user_id: user.id })])
    expect(db.tables.aitickets_team_invitations[0]).toMatchObject({ accepted_user_id: user.id })
    expect(db.tables.aitickets_team_invitations[0].accepted_at).toBeTruthy()
    // un solo uso
    const again = await acceptTeamInvitation(db, authFor(), db.tables.aitickets_team_invitations[0], { name: 'X', password: 'secreto123' }, NOW)
    expect(again).toMatchObject({ ok: false, code: 'accepted' })
  })

  it('si no se puede guardar el acceso por evento, aborta y no deja un miembro sin restricción', async () => {
    const inv = addInvitation()
    db.auth = { admin: { createUser: vi.fn(async () => ({ data: { user: { id: 'au-new' } }, error: null })) } }
    db.failOn('aitickets_event_staff', 'insert', { code: '57014', message: 'timeout' })
    const res = await acceptTeamInvitation(db, authFor(), inv, { name: 'Nuevo', password: 'secreto123' }, NOW)
    expect(res).toMatchObject({ ok: false })
    expect(db.tables.users.find((u) => u.email === 'nuevo@prod.cl')?.active).toBe(false)
    expect(db.tables.aitickets_team_invitations[0].accepted_at).toBeNull()
  })

  it('si los eventos de la invitación ya no existen, no crea nada', async () => {
    const inv = addInvitation()
    db.tables.events = db.tables.events.filter((e) => e.id !== 10)
    db.auth = { admin: { createUser: vi.fn() } }
    const res = await acceptTeamInvitation(db, authFor(), inv, { name: 'Nuevo', password: 'secreto123' }, NOW)
    expect(res).toMatchObject({ ok: false, code: 'events_gone' })
    expect(db.auth.admin.createUser).not.toHaveBeenCalled()
  })

  it('reactiva a un miembro desactivado de la misma organización si la contraseña es correcta', async () => {
    const inv = addInvitation({ email: 'old@prod.cl', role: 'finance', event_ids: [] })
    db.auth = { admin: { getUserById: async () => ({ data: { user: { app_metadata: { app: 'aitickets' }, banned_until: '2100-01-01T00:00:00Z' } } }), updateUserById: vi.fn(async () => ({})) } }
    const bad = await acceptTeamInvitation(db, authFor(false), inv, { password: 'mala' }, NOW)
    expect(bad).toMatchObject({ ok: false, code: 'wrong_password' })
    expect(db.tables.aitickets_team_invitations[0].accepted_at).toBeNull()
    expect(db.auth.admin.updateUserById).toHaveBeenLastCalledWith('au5', { ban_duration: '876000h' })
    const ok = await acceptTeamInvitation(db, authFor(true), db.tables.aitickets_team_invitations[0], { password: 'buena' }, NOW)
    expect(ok).toMatchObject({ ok: true, role: 'finance', redirectTo: '/dashboard/finance' })
    expect(db.tables.users.find((u) => u.id === 5)).toMatchObject({ active: true, role: 'finance' })
  })

  it('rechaza correos de otra organización, vencidas y revocadas', async () => {
    expect(await acceptTeamInvitation(db, authFor(), addInvitation({ email: 'out@otra.cl' }), { password: 'secreto123' }, NOW)).toMatchObject({ ok: false, code: 'other_org' })
    expect(await acceptTeamInvitation(db, authFor(), { ...addInvitation(), expires_at: '2026-10-01T00:00:00Z' }, { password: 'x' }, NOW)).toMatchObject({ ok: false, code: 'expired' })
    expect(await acceptTeamInvitation(db, authFor(), { ...addInvitation(), revoked_at: '2026-10-02T00:00:00Z' }, { password: 'x' }, NOW)).toMatchObject({ ok: false, code: 'revoked' })
    expect(await acceptTeamInvitation(db, authFor(), null, { password: 'x' }, NOW)).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('correo ya existente en Auth (otra app): vincula con su contraseña', async () => {
    const inv = addInvitation({ email: 'shared@mail.cl' })
    db.auth = { admin: { createUser: async () => ({ data: null, error: { message: 'A user with this email address has already been registered' } }) } }
    const res = await acceptTeamInvitation(db, authFor(true), inv, { name: 'Sha', password: 'otraapp123' }, NOW)
    expect(res.ok).toBe(true)
    expect(db.tables.users.find((u) => u.email === 'shared@mail.cl')).toMatchObject({ auth_user_id: 'au-new', organization_id: 7 })
  })
})
