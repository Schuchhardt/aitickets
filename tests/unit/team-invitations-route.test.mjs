// /api/team/invitations: el panel (Mi equipo) invita y anula con las mismas herramientas que el asistente de IA
// (invite_member / revoke_invitation), con la sesión del usuario. Reemplaza a POST /api/team/add.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const state = vi.hoisted(() => ({ auth: null }))
const sent = []
vi.mock('../../src/lib/producer-api/session', () => ({ dashboardToolContext: async () => state.auth }))
vi.mock('../../netlify/lib/mailer.mjs', () => ({
  sendEmail: vi.fn(async (msg) => { sent.push(msg); return { id: 'email_1' } }),
  isValidEmail: (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
  formatRecipient: (name, email) => (name ? `${name} <${email}>` : email),
}))
vi.mock('../../netlify/lib/emails/team.mjs', () => ({
  renderTeamInvitationEmail: async ({ url }) => ({ subject: 'Invitación', html: `<a href="${url}">ok</a>`, text: url }),
}))

const { POST, DELETE } = await import('../../src/pages/api/team/invitations.ts')

let db
const ctxFor = (userId, role) => ({
  ok: true,
  ctx: {
    supabase: db,
    actor: { keyId: null, userId, orgId: 7, role, name: 'Ana', email: 'ana@prod.cl', scopes: ['read', 'write', 'team'], eventIds: null },
    origin: 'https://aitickets.test',
    requestUrl: new URL('https://aitickets.test/api/team/invitations'),
    channel: 'dashboard',
  },
})
const req = (method, body) => ({ request: new Request('https://aitickets.test/api/team/invitations', { method, body: JSON.stringify(body) }), cookies: {} })

beforeEach(() => {
  sent.length = 0
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Escuela' }],
      users: [
        { id: 1, name: 'Ana', email: 'ana@prod.cl', organization_id: 7, role: 'producer', active: true, auth_user_id: 'au1' },
        { id: 4, name: 'Out', email: 'out@otra.cl', organization_id: 8, role: 'admin', active: true, auth_user_id: 'au4' },
        { id: 73, name: 'Romyna', email: 'psi@mail.cl', organization_id: null, role: 'admin', active: true, auth_user_id: 'au73' },
      ],
      events: [],
      aitickets_team_invitations: [],
      aitickets_api_audit: [],
      aitickets_api_idempotency: [],
    },
  })
  db.auth = { admin: { createUser: vi.fn(), getUserById: vi.fn(async () => ({ data: { user: null } })) } }
  state.auth = ctxFor(1, 'producer')
})

describe('POST /api/team/invitations', () => {
  it('correo nuevo: crea la invitación y envía el correo (sin crear cuentas ni mostrar el link)', async () => {
    const res = await POST(req('POST', { name: 'Romyna', email: ' Romy@Mail.cl ', role: 'validator' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, data: { email: 'romy@mail.cl', role: 'validator', email_sent: true } })
    expect(JSON.stringify(body)).not.toMatch(/aitinv_/)
    expect(db.tables.aitickets_team_invitations[0]).toMatchObject({ organization_id: 7, email: 'romy@mail.cl', name: 'Romyna', invited_via: 'dashboard' })
    expect(sent).toHaveLength(1)
    expect(db.auth.admin.createUser).not.toHaveBeenCalled()
    expect(db.tables.aitickets_api_audit.at(-1)).toMatchObject({ tool: 'invite_member' })
  })

  it('usuario sin organización (huérfano): se invita', async () => {
    const res = await POST(req('POST', { email: 'psi@mail.cl', role: 'viewer' }))
    expect(res.status).toBe(200)
  })

  it('correo de otra organización: 409 sin crear nada', async () => {
    const res = await POST(req('POST', { name: 'Out', email: 'out@otra.cl', role: 'viewer' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('conflict')
    expect(db.tables.aitickets_team_invitations).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  it('permisos: un administrador no invita administradores; un validador no invita', async () => {
    state.auth = ctxFor(2, 'admin')
    expect((await POST(req('POST', { email: 'x@y.cl', role: 'admin' }))).status).toBe(403)
    state.auth = ctxFor(3, 'validator')
    expect((await POST(req('POST', { email: 'x@y.cl', role: 'viewer' }))).status).toBe(403)
    state.auth = { ok: false, status: 401, error: 'Inicia sesión para continuar.' }
    expect((await POST(req('POST', { email: 'x@y.cl', role: 'viewer' }))).status).toBe(401)
  })

  it('rol inválido o correo inválido: 400', async () => {
    expect((await POST(req('POST', { email: 'x@y.cl', role: 'producer' }))).status).toBe(400)
    expect((await POST(req('POST', { email: 'no-es-correo', role: 'viewer' }))).status).toBe(400)
  })
})

describe('DELETE /api/team/invitations', () => {
  it('anula una invitación pendiente', async () => {
    const id = '00000000-0000-4000-8000-00000000000a'
    db.tables.aitickets_team_invitations.push({ id, organization_id: 7, email: 'romy@mail.cl', role: 'validator', expires_at: '2100-01-01T00:00:00Z', accepted_at: null, revoked_at: null })
    const res = await DELETE(req('DELETE', { invitation_id: id }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, data: { status: 'revoked', changed: true } })
    expect(db.tables.aitickets_team_invitations[0].revoked_at).toBeTruthy()
  })
})
