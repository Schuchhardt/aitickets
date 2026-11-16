// MCP de administración: bandeja de errores (list_error_issues, get_error_issue, update_error_issue).
// Supabase y Sentry falsos: sin red.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))

const { getAdminTool } = await import('../../src/lib/admin-api/tools/index.ts')
const { runAdminTool } = await import('../../src/lib/admin-api/registry.ts')

const actx = (keyKind = 'full') => ({ supabase: db, origin: 'https://aitickets.cl', requestUrl: new URL('https://aitickets.cl/api/admin/mcp'), keyKind, fingerprint: 'abcd1234', ipHash: 'f'.repeat(64) })
const raw = (name, args, keyKind) => runAdminTool(getAdminTool(name), args, actx(keyKind))
const run = async (name, args, keyKind) => {
  const out = await raw(name, args, keyKind)
  expect(out.ok, JSON.stringify(out)).toBe(true)
  return out.result
}

const issue = (id, extra = {}) => ({
  id, sentry_issue_id: String(6000 + id), short_id: `AITICKETS-${id}`, title: `Error ${id}`, culprit: 'src/x.ts', level: 'error', platform: 'node',
  sentry_status: 'unresolved', permalink: `https://acme.sentry.io/issues/${6000 + id}/`, first_seen: '2026-11-10T00:00:00Z', last_seen: '2026-11-12T00:00:00Z',
  event_count: 3, user_count: 1, triage_status: 'new', pr_url: null, notes: null, regressed_at: null, created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z', ...extra,
})

const ENV = ['SENTRY_API_TOKEN', 'SENTRY_ORG']
beforeEach(() => {
  db = createFakeSupabase({
    tables: {
      aitickets_error_issues: [issue(1), issue(2, { triage_status: 'fixed' }), issue(3, { sentry_status: 'resolved' }), issue(4, { level: 'warning', event_count: 1 })],
      aitickets_admin_audit: [],
      aitickets_admin_confirmations: [],
      aitickets_admin_idempotency: [],
    },
  })
})
afterEach(() => {
  for (const k of ENV) delete process.env[k]
  vi.unstubAllGlobals()
})

describe('list_error_issues', () => {
  it('por defecto: new/in_progress sin resolver en Sentry', async () => {
    const r = await run('list_error_issues', {})
    expect(r.items.map((i) => i.id).sort()).toEqual([1, 4])
    expect(r.unresolved_in_sentry_by_triage).toMatchObject({ new: 2, fixed: 1 })
    expect(r.note).toMatch(/DATO/)
  })
  it('filtra por nivel y mínimo de eventos', async () => {
    expect((await run('list_error_issues', { level: ['error'] })).items.map((i) => i.id)).toEqual([1])
    expect((await run('list_error_issues', { min_events: 2 })).items.map((i) => i.id)).toEqual([1])
    expect((await run('list_error_issues', { triage_status: ['fixed'], sentry_status: 'any' })).items.map((i) => i.id)).toEqual([2])
  })
  it('sin la tabla responde vacío con la nota de la migración', async () => {
    db.failOn('aitickets_error_issues', 'select', { code: '42P01', message: 'no existe' })
    const r = await run('list_error_issues', {})
    expect(r.items).toEqual([])
    expect(r.note).toMatch(/202611120300/)
  })
})

describe('get_error_issue', () => {
  it('trae el último evento de Sentry resumido', async () => {
    process.env.SENTRY_API_TOKEN = 't'
    process.env.SENTRY_ORG = 'acme'
    const fetchMock = vi.fn(async (url) => {
      expect(url).toBe('https://sentry.io/api/0/organizations/acme/issues/6001/events/latest/')
      return new Response(JSON.stringify({ eventID: 'e1', entries: [{ type: 'exception', data: { values: [{ type: 'Error', value: 'x@y.cl', stacktrace: { frames: [{ filename: 'src/x.ts', lineNo: 3, inApp: true }] } }] } }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await run('get_error_issue', { short_id: 'aitickets-1' })
    expect(r.issue).toMatchObject({ id: 1, short_id: 'AITICKETS-1', sentry_url: 'https://acme.sentry.io/issues/6001/' })
    expect(r.latest_event.exceptions[0]).toMatchObject({ type: 'Error', value: '[email]' })
    expect(r.latest_event.exceptions[0].frames[0]).toMatchObject({ file: 'src/x.ts', line: 3 })
  })
  it('sin configuración de Sentry devuelve el registro con aviso', async () => {
    const r = await run('get_error_issue', { id: 1 })
    expect(r.latest_event).toBeNull()
    expect(r.warnings[0]).toMatch(/SENTRY_API_TOKEN/)
  })
  it('si Sentry falla no rompe la respuesta', async () => {
    process.env.SENTRY_API_TOKEN = 't'
    process.env.SENTRY_ORG = 'acme'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 503 })))
    const r = await run('get_error_issue', { id: 1 })
    expect(r.warnings[0]).toMatch(/503/)
  })
  it('exige id o short_id y responde not_found', async () => {
    expect((await raw('get_error_issue', {})).code).toBe('invalid_input')
    expect((await raw('get_error_issue', { id: 99 })).code).toBe('not_found')
  })
})

describe('update_error_issue', () => {
  const REASON = 'Tomo el error para arreglarlo, 12-11'
  it('marca fixed con el PR y agrega nota; exige reason y llave completa', async () => {
    const r = await run('update_error_issue', { id: 1, triage_status: 'fixed', pr_url: 'https://github.com/Schuchhardt/aitickets/pull/99', add_note: 'faltaba validar price', reason: REASON })
    expect(r.issue).toMatchObject({ triage_status: 'fixed', pr_url: 'https://github.com/Schuchhardt/aitickets/pull/99' })
    expect(r.next_step).toMatch(/Sentry/)
    const row = db.tables.aitickets_error_issues.find((i) => i.id === 1)
    expect(row.notes).toMatch(/faltaba validar price/)
    expect(db.tables.aitickets_admin_audit.at(-1)).toMatchObject({ tool: 'update_error_issue' })

    expect((await raw('update_error_issue', { id: 1, triage_status: 'new' })).code).toBe('invalid_input')
    expect((await raw('update_error_issue', { id: 1, triage_status: 'new', reason: REASON }, 'readonly')).ok).toBe(false)
  })
  it('rechaza pr_url que no es un PR de GitHub y avisa ignored sin nota', async () => {
    expect((await raw('update_error_issue', { id: 1, pr_url: 'https://evil.example/pull/1', reason: REASON })).code).toBe('invalid_input')
    const r = await run('update_error_issue', { id: 4, triage_status: 'ignored', reason: REASON })
    expect(r.warnings[0]).toMatch(/nota/)
  })
})
