// Registro en dos pasos (src/lib/onboarding.ts) y cuentas creadas con Google (src/lib/google-auth.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db }))

const onboarding = await import('../../src/lib/onboarding.ts')
const google = await import('../../src/lib/google-auth.ts')

const googleUser = (over = {}) => ({
  id: 'auth-g1',
  email: 'Ana@Gmail.com',
  email_confirmed_at: '2026-10-08T10:00:00Z',
  created_at: new Date().toISOString(),
  user_metadata: { full_name: 'Ana Pérez' },
  app_metadata: { provider: 'google' },
  ...over,
})

beforeEach(() => {
  db = createFakeSupabase({ tables: { organizations: [], users: [], aitickets_leads: [] } })
  db.auth = { admin: { updateUserById: vi.fn(async () => ({ data: {}, error: null })) } }
})

describe('safeNextPath / afterSignupPath', () => {
  it('solo rutas del panel u OAuth', () => {
    expect(onboarding.safeNextPath('/dashboard/ia')).toBe('/dashboard/ia')
    expect(onboarding.safeNextPath('/oauth/authorize?client_id=x')).toBe('/oauth/authorize?client_id=x')
    for (const bad of ['https://evil.com', '//evil.com', '/dashboardx', '/organizadores', '/dashboard\\x', '/dashboard/ia\nSet-Cookie:x', null, 42]) {
      expect(onboarding.safeNextPath(bad)).toBeNull()
    }
  })

  it('el destino final marca la bienvenida en el panel', () => {
    expect(onboarding.afterSignupPath('/dashboard/ia')).toBe('/dashboard/ia?bienvenida=1')
    expect(onboarding.afterSignupPath('/oauth/authorize?x=1')).toBe('/oauth/authorize?x=1')
    expect(onboarding.afterSignupPath(null)).toBe('/dashboard?bienvenida=1')
    expect(onboarding.onboardingUrl('/dashboard/ia')).toBe('/organizadores/bienvenida?next=%2Fdashboard%2Fia')
    expect(onboarding.onboardingUrl('https://evil.com')).toBe('/organizadores/bienvenida')
  })

  it('isOnboardingPending lee la organización', async () => {
    db.tables.organizations.push({ id: 1, onboarding_pending: true }, { id: 2, onboarding_pending: false })
    expect(await onboarding.isOnboardingPending(1)).toBe(true)
    expect(await onboarding.isOnboardingPending(2)).toBe(false)
  })
})

describe('ensureGoogleProducer', () => {
  it('cuenta nueva: organización verificada con onboarding pendiente y perfil', async () => {
    const res = await google.ensureGoogleProducer(googleUser(), { attribution: { utm_source: 'landing', utm_campaign: 'ia' } })
    expect(res).toMatchObject({ ok: true, created: true, onboardingPending: true })
    const org = db.tables.organizations[0]
    expect(org).toMatchObject({ public_name: 'Mi productora', email: 'ana@gmail.com', onboarding_pending: true, email_verified_for: 'ana@gmail.com', signup_utm_campaign: 'ia' })
    expect(org.email_verified_at).toBeTruthy()
    expect(org.terms_accepted_at).toBeTruthy()
    expect(db.tables.users[0]).toMatchObject({ auth_user_id: 'auth-g1', organization_id: org.id, name: 'Ana Pérez', role: 'producer' })
    expect(db.auth.admin.updateUserById).toHaveBeenCalledWith('auth-g1', { app_metadata: { provider: 'google', app: 'aitickets' } })
  })

  it('fila creada por el trigger handle_new_user (sin organización): la completa en vez de duplicarla', async () => {
    db.tables.users.push({ id: 9, auth_user_id: 'auth-g1', organization_id: null, email: 'ana@gmail.com', role: 'admin' })
    const res = await google.ensureGoogleProducer(googleUser())
    expect(res).toMatchObject({ ok: true, created: true, onboardingPending: true })
    expect(db.tables.users).toHaveLength(1)
    expect(db.tables.users[0]).toMatchObject({ id: 9, organization_id: db.tables.organizations[0].id, name: 'Ana Pérez' })
  })

  it('usuario existente: inicia sesión sin crear nada', async () => {
    db.tables.organizations.push({ id: 5, email_verified_at: '2026-01-01', onboarding_pending: false })
    db.tables.users.push({ id: 9, auth_user_id: 'auth-g1', organization_id: 5, active: true, email: 'ana@gmail.com' })
    const res = await google.ensureGoogleProducer(googleUser())
    expect(res).toEqual({ ok: true, created: false, orgId: 5, onboardingPending: false })
    expect(db.tables.organizations).toHaveLength(1)
  })

  it('perfil antiguo sin auth_user_id: lo liga a la identidad de Google y entra a su organización', async () => {
    db.tables.organizations.push({ id: 9, email_verified_at: null, onboarding_pending: false })
    db.tables.users.push({ id: 22, auth_user_id: null, organization_id: 9, email: 'ana@gmail.com', role: null, active: true })
    const res = await google.ensureGoogleProducer(googleUser())
    expect(res).toEqual({ ok: true, created: false, orgId: 9, onboardingPending: false })
    expect(db.tables.users[0]).toMatchObject({ id: 22, auth_user_id: 'auth-g1', role: 'admin' })
    expect(db.tables.organizations).toHaveLength(1)
    expect(db.tables.organizations[0].email_verified_at).toBeTruthy()
  })

  it('el correo ya es de otra cuenta de AI Tickets: no se fusiona', async () => {
    db.tables.users.push({ id: 9, auth_user_id: 'otra-identidad', organization_id: 5, email: 'ana@gmail.com' })
    expect(await google.ensureGoogleProducer(googleUser())).toEqual({ ok: false, error: 'email_in_use' })
    expect(db.tables.organizations).toHaveLength(0)
  })

  it('sin correo verificado por Google: rechaza', async () => {
    expect(await google.ensureGoogleProducer(googleUser({ email_confirmed_at: null }))).toEqual({ ok: false, error: 'no_email' })
  })

  it('identidad antigua de otra app: no la marca como de AI Tickets', async () => {
    await google.ensureGoogleProducer(googleUser({ created_at: '2024-01-01T00:00:00Z' }))
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled()
  })

  it('estado de la cookie: ida y vuelta y entradas inválidas', () => {
    const s = { v: 'verifier', next: '/dashboard/ia', attribution: { utm_source: 'x' }, lead: null }
    expect(google.decodeGoogleState(google.encodeGoogleState(s))).toEqual(s)
    expect(google.decodeGoogleState('basura')).toBeNull()
    expect(google.decodeGoogleState(undefined)).toBeNull()
  })
})
