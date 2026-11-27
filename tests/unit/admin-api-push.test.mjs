// MCP de administración: send_test_push (notificación push de prueba a una organización o a un usuario).
// Supabase falso y web-push doble: sin red.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const state = vi.hoisted(() => ({ fail: {} }))
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))
vi.mock('../../netlify/lib/supabase.mjs', async (orig) => ({ ...(await orig()), getSupabaseAdmin: () => db }))
vi.mock('web-push', () => ({
  sendNotification: vi.fn(async (sub) => {
    const code = state.fail[sub.endpoint]
    if (code) throw Object.assign(new Error(`push ${code}`), { statusCode: code })
    return { statusCode: 201 }
  }),
}))

const { getAdminTool } = await import('../../src/lib/admin-api/tools/index.ts')
const { runAdminTool } = await import('../../src/lib/admin-api/registry.ts')
const webpush = await import('web-push')

const actx = () => ({ supabase: db, origin: 'https://aitickets.cl', requestUrl: new URL('https://aitickets.cl/api/admin/mcp'), keyKind: 'full', fingerprint: 'abcd1234', ipHash: 'f'.repeat(64) })
const raw = (args) => runAdminTool(getAdminTool('send_test_push'), args, actx())
const REASON = 'Probar avisos push pedido por el dueño'

async function confirmAndRun(args) {
  const first = await raw({ reason: REASON, ...args })
  expect(first.ok, JSON.stringify(first)).toBe(true)
  expect(first.result.status).toBe('confirmation_required')
  const second = await raw({ reason: REASON, ...args, confirmation_token: first.result.confirmation_token })
  expect(second.ok, JSON.stringify(second)).toBe(true)
  return { first: first.result, second: second.result }
}

const sub = (id, user_id, organization_id) => ({ id, user_id, organization_id, endpoint: `https://push/${id}`, p256dh: 'p', auth: 'a' })

beforeEach(() => {
  state.fail = {}
  webpush.sendNotification.mockClear()
  vi.stubEnv('VAPID_PUBLIC_KEY', 'pub')
  vi.stubEnv('VAPID_PRIVATE_KEY', 'priv')
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Productora Siete' }, { id: 8, public_name: 'Productora Ocho' }],
      users: [
        { id: 1, name: 'Ana', organization_id: 7, auth_user_id: 'auth-ana' },
        { id: 2, name: 'Bruno', organization_id: 7, auth_user_id: 'auth-bruno' },
        { id: 3, name: 'Sin cuenta', organization_id: 7, auth_user_id: null },
      ],
      aitickets_push_subscriptions: [sub(1, 'auth-ana', 7), sub(2, 'auth-ana', 7), sub(3, 'auth-bruno', 7)],
      aitickets_admin_audit: [],
      aitickets_admin_confirmations: [],
      aitickets_admin_idempotency: [],
    },
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('send_test_push', () => {
  it('a un usuario: confirma con el número de dispositivos y envía solo a los suyos', async () => {
    const { first, second } = await confirmAndRun({ user_id: 1, body: 'Hola Ana' })
    expect(first.summary).toMatch(/Ana \(Productora Siete\): 2 dispositivo/)
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2)
    expect(second).toMatchObject({ organization_id: 7, user_id: 1, sent: 2, failed: 0, cleaned: 0 })
    const payload = JSON.parse(webpush.sendNotification.mock.calls[0][1])
    expect(payload).toMatchObject({ title: 'AI Tickets', body: 'Hola Ana', url: '/dashboard', tag: 'admin-test-push' })
  })

  it('a una organización: todos sus dispositivos; limpia los vencidos', async () => {
    state.fail['https://push/3'] = 410
    const { second } = await confirmAndRun({ organization_id: 7, title: 'Prueba', url: '/dashboard/events' })
    expect(second).toMatchObject({ organization_id: 7, organization_name: 'Productora Siete', sent: 2, failed: 1, cleaned: 1 })
    expect(db.tables.aitickets_push_subscriptions.map((s) => s.id)).toEqual([1, 2])
  })

  it('no envía nada en la primera llamada (confirmación)', async () => {
    const first = await raw({ reason: REASON, organization_id: 7 })
    expect(first.result.status).toBe('confirmation_required')
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('sin dispositivos o sin claves VAPID responde conflict', async () => {
    const none = await raw({ reason: REASON, organization_id: 8 })
    expect(none.ok).toBe(false)
    expect(JSON.stringify(none)).toMatch(/Activar/)
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    const noKeys = await raw({ reason: REASON, organization_id: 7 })
    expect(noKeys.ok).toBe(false)
    expect(JSON.stringify(noKeys)).toMatch(/VAPID/)
  })

  it('valida el destino: uno de los dos, usuario existente y con cuenta', async () => {
    expect((await raw({ reason: REASON })).ok).toBe(false)
    expect((await raw({ reason: REASON, organization_id: 7, user_id: 1 })).ok).toBe(false)
    expect(JSON.stringify(await raw({ reason: REASON, user_id: 99 }))).toMatch(/search_users/)
    expect(JSON.stringify(await raw({ reason: REASON, user_id: 3 }))).toMatch(/cuenta de acceso/)
  })

  it('exige motivo (es una escritura)', async () => {
    expect((await raw({ organization_id: 7 })).ok).toBe(false)
  })
})
