// Reglas transversales de la API v2: permisos por rol, confirmación en el servidor (dos llamadas) e idempotencia.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/pages/api/_lib/server-utils', async (orig) => ({ ...(await orig()), notifySlack: async () => {} }))

const { runTool, effectiveSchema } = await import('../../src/lib/producer-api/registry.ts')
const { roleAllows } = await import('../../src/lib/producer-api/permissions.ts')

beforeEach(() => {
  db = createFakeSupabase({
    tables: {
      events: [
        { id: 10, name: 'Fiesta', slug: 'fiesta', status: 'draft', organization_id: 7 },
        { id: 11, name: 'Otra', slug: 'otra', status: 'draft', organization_id: 7 },
      ],
      aitickets_api_audit: [],
      aitickets_api_confirmations: [],
      aitickets_api_idempotency: [],
    },
  })
})

const ctxFor = (over = {}) => ({
  supabase: db,
  actor: { keyId: 'k1', userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'a@b.cl', scopes: ['read', 'write', 'publish', 'attendees', 'finance', 'team'], eventIds: null, ...over },
  origin: 'https://aitickets.test',
  requestUrl: new URL('https://aitickets.test/api/mcp'),
  channel: 'mcp',
})

let calls
const tool = {
  name: 'move_money',
  title: 't',
  description: 'd',
  scope: 'finance',
  permission: 'finance.manage',
  confirm: async (args) => ({ message: `Mover ${args.amount}` }),
  inputSchema: { type: 'object', required: ['amount'], additionalProperties: false, properties: { amount: { type: 'integer', minimum: 1 } } },
  handler: async (args) => {
    calls += 1
    return { moved: args.amount, n: calls }
  },
}

describe('permisos por rol', () => {
  it('matriz: dueño y finanzas retiran; admin, marketing y puerta no', () => {
    expect(roleAllows('producer', 'finance.manage')).toBe(true)
    expect(roleAllows('finance', 'finance.manage')).toBe(true)
    expect(roleAllows('admin', 'finance.manage')).toBe(false)
    expect(roleAllows('editor', 'finance.manage')).toBe(false)
    expect(roleAllows('validator', 'events.write')).toBe(false)
    expect(roleAllows('viewer', 'events.read')).toBe(true)
    expect(roleAllows('viewer', 'attendees.read')).toBe(false)
  })

  it('rechaza por rol aunque la llave tenga el scope', async () => {
    calls = 0
    const out = await runTool(tool, { amount: 5 }, ctxFor({ role: 'editor' }))
    expect(out).toMatchObject({ ok: false, code: 'forbidden' })
    expect(out.message).toMatch(/Finanzas/)
    expect(calls).toBe(0)
  })

  it('acceso por evento: un usuario asignado solo a un evento no ve otro', async () => {
    const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')
    const ctx = ctxFor({ role: 'validator', eventIds: [10] })
    expect((await runTool(getTool('get_event'), { event_id: 11 }, ctx)).code).toBe('forbidden')
    const list = await runTool(getTool('list_events'), {}, ctx)
    expect(list.result.events.map((e) => e.id)).toEqual([10])
  })
})

describe('confirmación en el servidor', () => {
  it('agrega confirmation_token e idempotency_key al schema publicado', () => {
    const props = effectiveSchema(tool).properties
    expect(props.confirmation_token).toBeDefined()
    expect(props.idempotency_key).toBeDefined()
  })

  it('primera llamada solo resume; la segunda con el token ejecuta una vez; reintento devuelve lo mismo', async () => {
    calls = 0
    const ctx = ctxFor()
    const first = await runTool(tool, { amount: 5 }, ctx)
    expect(first.ok).toBe(true)
    expect(first.result.status).toBe('confirmation_required')
    expect(first.result.summary).toBe('Mover 5')
    expect(calls).toBe(0)
    expect(db.tables.aitickets_api_audit).toHaveLength(0)
    const token = first.result.confirmation_token

    // Argumentos distintos con el mismo token: rechazado
    const tampered = await runTool(tool, { amount: 500, confirmation_token: token }, ctx)
    expect(tampered).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(calls).toBe(0)

    const second = await runTool(tool, { amount: 5, confirmation_token: token }, ctx)
    expect(second).toMatchObject({ ok: true, result: { moved: 5, n: 1 } })
    expect(db.tables.aitickets_api_audit.at(-1)).toMatchObject({ tool: 'move_money', ok: true })

    // Reintento con el mismo token (p. ej. se cortó la respuesta): no repite la acción
    db.failOn('aitickets_api_idempotency', 'insert', { code: '23505', message: 'duplicate key' })
    const retry = await runTool(tool, { amount: 5, confirmation_token: token }, ctx)
    expect(retry).toMatchObject({ ok: true, result: { moved: 5, n: 1, idempotent_replay: true } })
    expect(calls).toBe(1)
  })

  it('token de otro usuario o vencido no sirve', async () => {
    calls = 0
    const first = await runTool(tool, { amount: 5 }, ctxFor())
    const token = first.result.confirmation_token
    const other = await runTool(tool, { amount: 5, confirmation_token: token }, ctxFor({ userId: 2, role: 'finance' }))
    expect(other).toMatchObject({ ok: false, code: 'invalid_input' })
    db.tables.aitickets_api_confirmations[0].expires_at = '2000-01-01T00:00:00Z'
    const expired = await runTool(tool, { amount: 5, confirmation_token: token }, ctxFor())
    expect(expired).toMatchObject({ ok: false, code: 'conflict' })
    expect(calls).toBe(0)
  })

  it('si la acción falla, se libera la clave de idempotencia', async () => {
    const failing = { ...tool, confirm: undefined, idempotent: true, handler: async () => { throw new Error('boom') } }
    const out = await runTool(failing, { amount: 1, idempotency_key: 'clave-123456' }, ctxFor())
    expect(out).toMatchObject({ ok: false, code: 'internal' })
    expect(db.tables.aitickets_api_idempotency).toHaveLength(0)
  })

  it('set_event_status pide confirmación antes de publicar', async () => {
    const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')
    const first = await runTool(getTool('set_event_status'), { event_id: 10, status: 'published' }, ctxFor())
    expect(first.result.status).toBe('confirmation_required')
    expect(db.tables.events[0].status).toBe('draft')
  })
})
