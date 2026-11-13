// Bandeja de errores (netlify/lib/sentry-issues.mjs): firma del webhook, datos personales fuera, sin duplicados,
// regresiones y un solo aviso a Slack por cosa. Supabase y Sentry falsos: sin red.
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import {
  handleSentryWebhook,
  ingestIssue,
  redactText,
  runSentrySync,
  sentryConfig,
  summarizeEvent,
  verifySentrySignature,
} from '../../netlify/lib/sentry-issues.mjs'

const NOW = new Date('2026-11-12T15:00:00Z')
const issue = (extra = {}) => ({
  id: '6011223344',
  shortId: 'AITICKETS-1A',
  title: "TypeError: Cannot read properties of undefined (reading 'price')",
  culprit: 'src/pages/api/orders/create.ts in POST',
  level: 'error',
  platform: 'javascript',
  status: 'unresolved',
  permalink: 'https://acme.sentry.io/issues/6011223344/',
  firstSeen: '2026-11-12T14:00:00Z',
  lastSeen: '2026-11-12T14:30:00Z',
  count: '3',
  userCount: 2,
  ...extra,
})

let db
let notify
beforeEach(() => {
  db = createFakeSupabase({ tables: { aitickets_error_issues: [] }, unique: { aitickets_error_issues: [['sentry_issue_id']] }, defaults: { aitickets_error_issues: { triage_status: 'new', notified_at: null } } })
  notify = vi.fn(async () => {})
})
const rows = () => db.tables.aitickets_error_issues

describe('verifySentrySignature', () => {
  const body = JSON.stringify({ action: 'created', data: { issue: issue() } })
  const sig = createHmac('sha256', 'shh').update(body).digest('hex')
  it('acepta la firma correcta y rechaza las demás', () => {
    expect(verifySentrySignature('shh', body, sig)).toBe(true)
    expect(verifySentrySignature('otro', body, sig)).toBe(false)
    expect(verifySentrySignature('shh', `${body} `, sig)).toBe(false)
    expect(verifySentrySignature('shh', body, null)).toBe(false)
    expect(verifySentrySignature('shh', body, 'abc')).toBe(false)
  })
})

describe('redactText', () => {
  it('oculta correos, RUT, teléfonos, tokens y query strings', () => {
    const out = redactText(
      'Falló para ana.perez@gmail.com RUT 12.345.678-5 tel +56 9 1234 5678 en https://aitickets.cl/r?token=abc&x=1 Bearer sk_live_abcdefgh12345 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl key a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
    )
    expect(out).not.toMatch(/ana\.perez|12\.345\.678|1234 5678|token=abc|sk_live|eyJhbGci|a1b2c3d4e5f6a1b2/)
    expect(out).toContain('[email]')
    expect(out).toContain('[rut]')
    expect(out).toContain('https://aitickets.cl/r?[query]')
  })
  it('deja intacto un mensaje técnico', () => {
    const msg = "TypeError: Cannot read properties of undefined (reading 'price')"
    expect(redactText(msg)).toBe(msg)
  })
})

describe('ingestIssue', () => {
  it('crea una sola fila por issue y avisa una sola vez, aunque lleguen webhook y cron', async () => {
    const a = await ingestIssue(db, issue(), { now: NOW, notify })
    const b = await ingestIssue(db, issue({ count: '5', lastSeen: '2026-11-12T14:45:00Z' }), { now: NOW, notify })
    expect(a).toMatchObject({ ok: true, created: true, notified: true })
    expect(b).toMatchObject({ ok: true, created: false, notified: false })
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({ event_count: 5, last_seen: '2026-11-12T14:45:00.000Z', triage_status: 'new' })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toContain('AITICKETS-1A')
  })

  it('no retrocede conteos ni last_seen con datos más viejos', async () => {
    await ingestIssue(db, issue({ count: '10', lastSeen: '2026-11-12T14:50:00Z' }), { now: NOW, notify })
    await ingestIssue(db, issue({ count: '4', lastSeen: '2026-11-12T14:10:00Z' }), { now: NOW, notify })
    expect(rows()[0]).toMatchObject({ event_count: 10, last_seen: '2026-11-12T14:50:00.000Z' })
  })

  it('no avisa errores viejos (primera sincronización) ni warnings', async () => {
    await ingestIssue(db, issue({ id: '1', firstSeen: '2026-10-01T00:00:00Z' }), { now: NOW, notify })
    await ingestIssue(db, issue({ id: '2', level: 'warning' }), { now: NOW, notify })
    expect(rows()).toHaveLength(2)
    expect(notify).not.toHaveBeenCalled()
  })

  it('una regresión (resuelto + evento nuevo) vuelve a new y avisa una vez', async () => {
    await ingestIssue(db, issue(), { now: NOW, notify })
    Object.assign(rows()[0], { triage_status: 'fixed', pr_url: 'https://github.com/x/y/pull/1' })
    await ingestIssue(db, issue({ status: 'resolved' }), { now: NOW, notify })
    expect(rows()[0].sentry_status).toBe('resolved')

    const back = issue({ status: 'unresolved', lastSeen: '2026-11-12T14:59:00Z' })
    const r1 = await ingestIssue(db, back, { now: NOW, notify })
    const r2 = await ingestIssue(db, back, { now: NOW, notify })
    expect(r1).toMatchObject({ regressed: true, notified: true })
    expect(r2).toMatchObject({ regressed: false, notified: false })
    expect(rows()[0]).toMatchObject({ sentry_status: 'unresolved', triage_status: 'new', regressed_at: NOW.toISOString() })
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify.mock.calls[1][0]).toContain('Volvió')
  })

  it('reabrir a mano en Sentry (sin evento nuevo) no es regresión', async () => {
    await ingestIssue(db, issue({ status: 'resolved' }), { now: NOW, notify })
    const r = await ingestIssue(db, issue({ status: 'unresolved' }), { now: NOW, notify })
    expect(r.regressed).toBe(false)
    expect(rows()[0].sentry_status).toBe('unresolved')
  })

  it('guarda el título sin datos personales y rechaza ids inválidos', async () => {
    await ingestIssue(db, issue({ title: 'Error: correo duplicado juan@x.cl' }), { now: NOW, notify })
    expect(rows()[0].title).toBe('Error: correo duplicado [email]')
    expect(await ingestIssue(db, issue({ id: '../1' }), { now: NOW, notify })).toEqual({ ok: false, reason: 'invalid_issue' })
  })

  it('descarta permalinks que no son de Sentry', async () => {
    await ingestIssue(db, issue({ permalink: 'https://evil.example/x' }), { now: NOW, notify })
    expect(rows()[0].permalink).toBeNull()
  })
})

describe('handleSentryWebhook', () => {
  it('issue: guarda; installation: ignora', async () => {
    expect(await handleSentryWebhook(db, { resource: 'issue', payload: { action: 'created', data: { issue: issue() } }, config: null, notify })).toMatchObject({ ok: true, created: true })
    expect(await handleSentryWebhook(db, { resource: 'installation', payload: {}, config: null, notify })).toMatchObject({ ok: true, ignored: expect.any(String) })
  })

  it('event_alert: lee el issue de la API', async () => {
    const config = sentryConfig({ SENTRY_API_TOKEN: 't', SENTRY_ORG: 'acme' })
    const fetchImpl = vi.fn(async (url) => {
      expect(url).toBe('https://sentry.io/api/0/organizations/acme/issues/6011223344/')
      return new Response(JSON.stringify(issue()), { status: 200 })
    })
    const r = await handleSentryWebhook(db, { resource: 'event_alert', payload: { data: { event: { issue_id: '6011223344' } } }, config, notify, fetchImpl })
    expect(r).toMatchObject({ ok: true, created: true })
  })
})

describe('runSentrySync', () => {
  it('pagina con Link y guarda sin duplicar', async () => {
    const config = sentryConfig({ SENTRY_API_TOKEN: 't', SENTRY_ORG: 'acme' })
    const page2 = 'https://sentry.io/api/0/organizations/acme/issues/?cursor=2'
    const fetchImpl = vi.fn(async (url) => {
      if (url === page2) return new Response(JSON.stringify([issue({ id: '2', shortId: 'AITICKETS-2' }), issue()]), { status: 200 })
      expect(url).toContain('project=4510110385897472')
      expect(url).toContain('query=lastSeen%3A-24h')
      return new Response(JSON.stringify([issue()]), { status: 200, headers: { link: `<${page2}>; rel="next"; results="true"; cursor="2"` } })
    })
    const r = await runSentrySync(db, config, { notify, fetchImpl, now: () => NOW })
    expect(r).toMatchObject({ checked: 3, created: 2, failed: 0, truncated: false })
    expect(rows()).toHaveLength(2)
  })

  it('no sigue un cursor hacia otro host', async () => {
    const config = sentryConfig({ SENTRY_API_TOKEN: 't', SENTRY_ORG: 'acme' })
    const fetchImpl = vi.fn(async () => new Response('[]', { status: 200, headers: { link: '<https://evil.example/x>; rel="next"; results="true"' } }))
    await expect(runSentrySync(db, config, { notify, fetchImpl })).rejects.toThrow(/inesperada/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('sentryConfig', () => {
  it('exige token y organización válidos', () => {
    expect(sentryConfig({})).toBeNull()
    expect(sentryConfig({ SENTRY_API_TOKEN: 't', SENTRY_ORG: 'acme/../x' })).toBeNull()
    expect(sentryConfig({ SENTRY_API_TOKEN: 't', SENTRY_ORG: 'acme', SENTRY_PROJECT_ID: '99' })).toMatchObject({ org: 'acme', projectId: '99' })
  })
})

describe('summarizeEvent', () => {
  it('frames propios primero (del más reciente), código alrededor y sin datos personales', () => {
    const event = {
      eventID: 'e1',
      dateCreated: '2026-11-12T14:30:00Z',
      tags: [{ key: 'release', value: 'abc123' }, { key: 'user.email', value: 'x@y.cl' }, { key: 'url', value: 'https://aitickets.cl/e?t=secret' }],
      entries: [
        {
          type: 'exception',
          data: {
            values: [
              {
                type: 'TypeError',
                value: 'no se encontró pedro@gmail.com',
                mechanism: { type: 'generic', handled: false },
                stacktrace: {
                  frames: [
                    { filename: 'node_modules/astro/x.js', function: 'run', lineNo: 1, inApp: false },
                    { filename: 'src/lib/a.ts', function: 'outer', lineNo: 10, inApp: true },
                    { filename: 'src/lib/b.ts', function: 'inner', lineNo: 20, colNo: 5, inApp: true, context: [[19, 'const t = x'], [20, 'return t.price'], [21, '}']] },
                  ],
                },
              },
            ],
          },
        },
        { type: 'request', data: { method: 'POST', url: 'https://aitickets.cl/api/orders?email=a@b.cl' } },
        { type: 'breadcrumbs', data: { values: [{ timestamp: 't', category: 'fetch', message: 'GET', data: { url: 'https://x.cl/a?k=1', status_code: 500 } }] } },
      ],
    }
    const s = summarizeEvent(event)
    expect(s.exceptions[0]).toMatchObject({ type: 'TypeError', value: 'no se encontró [email]', handled: false, frames_total: 3, only_in_app: true })
    expect(s.exceptions[0].frames.map((f) => f.function)).toEqual(['inner', 'outer'])
    expect(s.exceptions[0].frames[0].code).toContain('> 20 | return t.price')
    expect(s.tags).toEqual({ release: 'abc123', url: 'https://aitickets.cl/e?[query]' })
    expect(s.request).toEqual({ method: 'POST', url: 'https://aitickets.cl/api/orders?[query]' })
    expect(s.breadcrumbs[0]).toMatchObject({ category: 'fetch', url: 'https://x.cl/a?[query]', status: 500 })
  })
})
