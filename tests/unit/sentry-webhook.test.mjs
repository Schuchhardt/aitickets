// POST /api/webhooks/sentry: 404 sin secreto, firma, JSON y guardado sin duplicados. Supabase falso, sin Slack.
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

const mocks = vi.hoisted(() => ({ db: null, serverEnv: vi.fn(() => undefined), notifySlack: vi.fn(async () => {}) }))
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => mocks.db }))
vi.mock('../../src/pages/api/_lib/server-utils', () => ({ serverEnv: mocks.serverEnv }))
vi.mock('../../netlify/lib/slack.mjs', () => ({ notifySlack: mocks.notifySlack }))

const { POST } = await import('../../src/pages/api/webhooks/sentry.ts')

const SECRET = 'client-secret-de-prueba'
const issue = { id: '6011223344', shortId: 'AITICKETS-1A', title: 'TypeError: x', level: 'error', status: 'unresolved', project: { id: '4510110385897472', slug: 'aitickets' }, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(), count: '1', userCount: 1 }
const request = (payload, { resource = 'issue', secret = SECRET, raw, tamper = false } = {}) => {
  const body = raw ?? JSON.stringify(payload)
  const sig = createHmac('sha256', secret).update(body).digest('hex')
  return new Request('https://aitickets.cl/api/webhooks/sentry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'sentry-hook-resource': resource, 'sentry-hook-signature': tamper ? `${sig[0] === '0' ? '1' : '0'}${sig.slice(1)}` : sig },
    body,
  })
}
const call = (req) => POST({ request: req })

beforeEach(() => {
  mocks.db = createFakeSupabase({ tables: { aitickets_error_issues: [] }, unique: { aitickets_error_issues: [['sentry_issue_id']] }, defaults: { aitickets_error_issues: { notified_at: null, triage_status: 'new' } } })
  mocks.serverEnv.mockReset()
  mocks.serverEnv.mockImplementation((name) => (name === 'SENTRY_CLIENT_SECRET' ? SECRET : undefined))
  mocks.notifySlack.mockClear()
})

describe('POST /api/webhooks/sentry', () => {
  it('404 si SENTRY_CLIENT_SECRET no está configurado', async () => {
    mocks.serverEnv.mockImplementation(() => undefined)
    expect((await call(request({ data: { issue } }))).status).toBe(404)
  })

  it('401 con firma inválida y 400 con JSON inválido', async () => {
    expect((await call(request({ data: { issue } }, { tamper: true }))).status).toBe(401)
    expect((await call(request({ data: { issue } }, { secret: 'otro' }))).status).toBe(401)
    expect((await call(request(null, { raw: '{no es json' }))).status).toBe(400)
    expect(mocks.db.tables.aitickets_error_issues).toHaveLength(0)
  })

  it('guarda el issue una sola vez y avisa a Slack una sola vez', async () => {
    const first = await call(request({ action: 'created', data: { issue } }))
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ ok: true, created: true })
    const again = await call(request({ action: 'created', data: { issue } }))
    expect(await again.json()).toMatchObject({ ok: true, created: false })
    expect(mocks.db.tables.aitickets_error_issues).toHaveLength(1)
    expect(mocks.notifySlack).toHaveBeenCalledTimes(1)
  })

  it('no guarda issues de otros proyectos de la organización', async () => {
    const res = await call(request({ action: 'created', data: { issue: { ...issue, project: { id: '4510083517775872', slug: 'aitickets-lambda' } } } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, ignored: expect.stringMatching(/otro proyecto/) })
    expect(mocks.db.tables.aitickets_error_issues).toHaveLength(0)
  })

  it('ignora recursos que no maneja', async () => {
    const res = await call(request({ action: 'created', data: {} }, { resource: 'installation' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, ignored: expect.any(String) })
  })

  it('500 si la BD falla (Sentry reintenta)', async () => {
    mocks.db.failOn('aitickets_error_issues', 'insert', { code: 'XX000', message: 'caída' })
    expect((await call(request({ data: { issue } }))).status).toBe(500)
  })
})
