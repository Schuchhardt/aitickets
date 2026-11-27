// Avisos push del panel de productores (PWA): rutas /api/push/* (vapid-key, subscribe, unsubscribe) y
// netlify/lib/push.mjs (envío por organización, limpieza de suscripciones vencidas, "Nueva venta").
// Sin red ni BD: Supabase es el doble en memoria de tests/fixtures/fake-supabase.mjs y web-push es un doble.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const state = vi.hoisted(() => ({ session: null, sendResults: {} }))
let db

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db }))
vi.mock('../../netlify/lib/supabase.mjs', async (importOriginal) => ({ ...(await importOriginal()), getSupabaseAdmin: () => db }))
vi.mock('../../src/lib/supabaseServer', async (importOriginal) => ({
  ...(await importOriginal()),
  getSessionContext: vi.fn(async () => state.session),
}))
vi.mock('web-push', () => {
  const sendNotification = vi.fn(async (sub) => {
    const code = state.sendResults[sub.endpoint]
    if (code) throw Object.assign(new Error(`push ${code}`), { statusCode: code })
    return { statusCode: 201 }
  })
  return { sendNotification }
})

const { GET: vapidKeyGET } = await import('../../src/pages/api/push/vapid-key.ts')
const { POST: subscribePOST } = await import('../../src/pages/api/push/subscribe.ts')
const { POST: unsubscribePOST } = await import('../../src/pages/api/push/unsubscribe.ts')
const { sendPushToOrg, notifyProducerSale } = await import('../../netlify/lib/push.mjs')
const webpush = await import('web-push')

const TABLE = 'aitickets_push_subscriptions'
const ORIGIN = 'https://aitickets.test'
const session = (orgId = 10, authId = 'auth-1') => ({ authUser: { id: authId }, dbUser: { id: 1, organization_id: orgId, role: 'producer' } })

async function call(handler, body, method = 'POST') {
  const url = new URL(`${ORIGIN}/api/push/x`)
  const init = { method, headers: { 'content-type': 'application/json', 'user-agent': 'TestUA' } }
  if (method !== 'GET') init.body = typeof body === 'string' ? body : JSON.stringify(body ?? {})
  const request = new Request(url, init)
  const res = await handler({ request, url, cookies: { get: () => undefined }, locals: {} })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const SUB = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p-key', auth: 'a-key' } }

beforeEach(() => {
  db = createFakeSupabase({
    tables: { [TABLE]: [], events: [{ id: 'ev-1', organization_id: 10, name: 'Stand-up' }] },
  })
  state.session = null
  state.sendResults = {}
  webpush.sendNotification.mockClear()
  vi.stubEnv('VAPID_PUBLIC_KEY', 'pub-key')
  vi.stubEnv('VAPID_PRIVATE_KEY', 'priv-key')
})
afterEach(() => vi.unstubAllEnvs())

describe('rutas /api/push', () => {
  it('vapid-key: entrega la clave pública, o 404 si no está configurada', async () => {
    expect(await call(vapidKeyGET, null, 'GET')).toEqual({ status: 200, body: { publicKey: 'pub-key' } })
    vi.stubEnv('VAPID_PUBLIC_KEY', '')
    expect((await call(vapidKeyGET, null, 'GET')).status).toBe(404)
  })

  it('subscribe: exige sesión', async () => {
    const res = await call(subscribePOST, SUB)
    expect(res.status).toBe(401)
    expect(db.tables[TABLE]).toHaveLength(0)
  })

  it('subscribe: valida el cuerpo', async () => {
    state.session = session()
    expect((await call(subscribePOST, '{no json')).status).toBe(400)
    expect((await call(subscribePOST, { endpoint: SUB.endpoint })).status).toBe(400)
  })

  it('subscribe: guarda la suscripción con el usuario y la organización de la sesión (y no duplica el endpoint)', async () => {
    state.session = session(10, 'auth-1')
    expect((await call(subscribePOST, { ...SUB, organization_id: 99 })).status).toBe(200)
    expect((await call(subscribePOST, SUB)).status).toBe(200)
    expect(db.tables[TABLE]).toHaveLength(1)
    expect(db.tables[TABLE][0]).toMatchObject({ user_id: 'auth-1', organization_id: 10, endpoint: SUB.endpoint, p256dh: 'p-key', auth: 'a-key', user_agent: 'TestUA' })
  })

  it('unsubscribe: solo borra la suscripción propia', async () => {
    db.tables[TABLE].push({ id: 1, user_id: 'auth-otro', organization_id: 10, endpoint: SUB.endpoint, p256dh: 'p', auth: 'a' })
    state.session = session(10, 'auth-1')
    expect((await call(unsubscribePOST, { endpoint: SUB.endpoint })).status).toBe(200)
    expect(db.tables[TABLE]).toHaveLength(1)
    state.session = session(10, 'auth-otro')
    expect((await call(unsubscribePOST, { endpoint: SUB.endpoint })).status).toBe(200)
    expect(db.tables[TABLE]).toHaveLength(0)
  })

  it('unsubscribe: exige sesión y endpoint', async () => {
    expect((await call(unsubscribePOST, { endpoint: 'x' })).status).toBe(401)
    state.session = session()
    expect((await call(unsubscribePOST, {})).status).toBe(400)
  })
})

describe('netlify/lib/push.mjs', () => {
  const seed = () => {
    db.tables[TABLE].push(
      { id: 1, user_id: 'u1', organization_id: 10, endpoint: 'https://push/ok', p256dh: 'p', auth: 'a' },
      { id: 2, user_id: 'u2', organization_id: 10, endpoint: 'https://push/gone', p256dh: 'p', auth: 'a' },
      { id: 3, user_id: 'u3', organization_id: 20, endpoint: 'https://push/otra-org', p256dh: 'p', auth: 'a' },
    )
  }

  it('envía solo a la organización y limpia las suscripciones vencidas (410)', async () => {
    seed()
    state.sendResults['https://push/gone'] = 410
    const r = await sendPushToOrg(10, { title: 'Hola', body: 'x' })
    expect(r).toEqual({ sent: 1, failed: 1, cleaned: 1 })
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2)
    const [, payload, options] = webpush.sendNotification.mock.calls[0]
    expect(JSON.parse(payload)).toMatchObject({ title: 'Hola', body: 'x', url: '/dashboard' })
    expect(options.vapidDetails).toMatchObject({ publicKey: 'pub-key', privateKey: 'priv-key' })
    expect(db.tables[TABLE].map((s) => s.id)).toEqual([1, 3])
  })

  it('no hace nada sin claves VAPID', async () => {
    seed()
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    expect(await sendPushToOrg(10, { title: 'x' })).toEqual({ sent: 0, failed: 0, cleaned: 0 })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('nunca lanza si la base falla', async () => {
    seed()
    db.failOn(TABLE, 'select', { code: '42P01', message: 'no existe' })
    await expect(sendPushToOrg(10, { title: 'x' })).resolves.toEqual({ sent: 0, failed: 0, cleaned: 0 })
  })

  it('notifyProducerSale: "Nueva venta" con entradas, monto y evento', async () => {
    seed()
    await notifyProducerSale(db, { id: 'ord-1', event_id: 'ev-1', ticket_details: [{ quantity: 2 }, { quantity: 1 }] }, 15000)
    const payload = JSON.parse(webpush.sendNotification.mock.calls[0][1])
    expect(payload.title).toBe('Nueva venta')
    expect(payload.body).toMatch(/^3 entradas · \$15\.000 CLP · Stand-up$/)
    expect(payload.url).toBe('/dashboard/events/ev-1')
    expect(payload.tag).toBe('sale-ord-1')
  })
})
