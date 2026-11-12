// MCP de administración: create_lead_proposal. Evento borrador en "Propuestas AI Tickets", link de vista previa
// (720 h), lead enlazado y touch kind=proposal. La URL se entrega una sola vez.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/pages/api/_lib/server-utils', async (orig) => ({ ...(await orig()), notifySlack: async () => {} }))
// El grafo del evento (lugar, funciones, entradas) tiene sus propios tests: aquí solo crea la fila del evento.
vi.mock('../../src/pages/api/_lib/events', async (orig) => ({
  ...(await orig()),
  createEventGraph: async ({ orgId }, input) => {
    const row = { id: 900 + db.tables.events.length, name: input.general.name, slug: `propuesta-${db.tables.events.length}`, status: 'draft', organization_id: orgId, created_at: new Date().toISOString() }
    db.tables.events.push(row)
    return row
  },
}))

const { getAdminTool } = await import('../../src/lib/admin-api/tools/index.ts')
const { runAdminTool } = await import('../../src/lib/admin-api/registry.ts')
const { resetSupportUserCache } = await import('../../src/lib/admin-api/context.ts')

const LEAD = '00000001-0000-4000-8000-000000000000'
const PROPOSALS_ORG = 77
const REASON = 'Propuesta para Next Producciones pedida por el dueño, 12-11'
const actx = () => ({ supabase: db, origin: 'https://aitickets.cl', requestUrl: new URL('https://aitickets.cl/api/admin/mcp'), keyKind: 'full', fingerprint: 'abcd1234', ipHash: 'f'.repeat(64) })
const call = (name, args) => runAdminTool(getAdminTool(name), getAdminTool(name).readOnly ? args : { ...args, reason: REASON }, actx())
const run = async (name, args) => {
  const out = await call(name, args)
  expect(out.ok, JSON.stringify(out)).toBe(true)
  return out.result
}
const lead = () => db.tables.aitickets_leads[0]
const EVENT = {
  name: 'Next Producciones — Fiesta de prueba',
  new_venue: { name: 'Club X', city: 'Santiago' },
  functions: [{ date: '2026-12-12', start_time: '22:00' }],
  ticket_types: [{ name: 'General', price: 10000 }],
}

beforeEach(() => {
  resetSupportUserCache()
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 1, public_name: 'AI Tickets' }, { id: PROPOSALS_ORG, public_name: 'Propuestas AI Tickets' }],
      events: [{ id: 149, name: 'Evento suelto', slug: 'evento-suelto', status: 'draft', organization_id: 1 }],
      aitickets_platform_settings: [{ key: 'support_user_id', value: 5 }, { key: 'proposals_org_id', value: PROPOSALS_ORG }],
      aitickets_event_preview_links: [{ id: '123e3347-0000-4000-8000-000000000000', event_id: 149, organization_id: 1, single_use: false, expires_at: null, revoked_at: null, consumed_at: null, view_count: 3, last_viewed_at: '2026-11-11T10:00:00Z', label: null, created_via: 'admin', created_at: '2026-11-10T00:00:00Z' }],
      aitickets_leads: [{
        id: LEAD, name_key: 'producer:next', org_name: 'Next Producciones', niche: 'fiestas', email: 'hola@next.cl', status: 'replied', manual_only: true,
        sequence_step: 1, next_action: 'proposal', proposal_event_id: null, proposal_preview_link_id: null, proposal_created_at: null, gmail_thread_id: 't1', created_at: '2026-11-01T00:00:00Z',
      }],
      aitickets_lead_touches: [],
      aitickets_lead_strategies: [],
      aitickets_suppressions: [],
      aitickets_admin_audit: [],
      aitickets_admin_confirmations: [],
      aitickets_admin_idempotency: [],
    },
  })
})

describe('create_lead_proposal', () => {
  it('crea el evento borrador en la org de propuestas, un link de 720 h, lo guarda en el lead y registra el touch', async () => {
    const before = Date.now()
    const r = await run('create_lead_proposal', { lead_id: LEAD, event: EVENT })
    expect(r).toMatchObject({ lead_id: LEAD, organization_id: PROPOSALS_ORG, event_status: 'draft' })
    expect(r.preview_url).toMatch(/^https:\/\/aitickets\.cl\/eventos\/.+\?preview=pv_/)

    const links = db.tables.aitickets_event_preview_links.filter((l) => l.event_id === r.event_id)
    const active = links.filter((l) => !l.revoked_at)
    expect(active).toHaveLength(1) // el link automático de 7 días de create_event queda revocado
    expect(active[0]).toMatchObject({ id: r.preview_link.id, organization_id: PROPOSALS_ORG, created_via: 'admin' })
    const hours = (Date.parse(active[0].expires_at) - before) / 3_600_000
    expect(hours).toBeGreaterThan(719.9)
    expect(hours).toBeLessThan(720.1)

    expect(lead()).toMatchObject({ proposal_event_id: r.event_id, proposal_preview_link_id: r.preview_link.id })
    expect(lead().proposal_created_at).toBeTruthy()
    expect(db.tables.aitickets_lead_touches).toHaveLength(1)
    expect(db.tables.aitickets_lead_touches[0]).toMatchObject({ kind: 'proposal', outcome: 'drafted', lead_id: LEAD, gmail_thread_id: 't1' })

    // La URL no queda en ninguna tabla
    expect(JSON.stringify(db.tables)).not.toContain(r.preview_url.split('preview=')[1])

    const detail = await run('get_lead', { lead_id: LEAD })
    expect(detail.proposal).toMatchObject({ event_id: r.event_id, preview_link: { id: r.preview_link.id, status: 'active', view_count: 0 }, opened: false })
    const list = await run('list_leads', { has_proposal: true, compact: true })
    expect(list.leads.map((l) => l.id)).toEqual([LEAD])
    expect(list.leads[0].notes).toBeUndefined()
    expect((await run('list_leads', { has_proposal: false })).total).toBe(0)
  })

  it('enlaza un evento existente con su link sin crear otro', async () => {
    const r = await run('create_lead_proposal', { lead_id: LEAD, event_id: 149, preview_link_id: '123e3347-0000-4000-8000-000000000000' })
    expect(r).toMatchObject({ event_id: 149, organization_id: 1, preview_url: null })
    expect(r.warnings.join(' ')).toMatch('Propuestas AI Tickets')
    expect(db.tables.aitickets_event_preview_links).toHaveLength(1)
    expect(lead()).toMatchObject({ proposal_event_id: 149, proposal_preview_link_id: '123e3347-0000-4000-8000-000000000000' })
    const detail = await run('get_lead', { lead_id: LEAD })
    expect(detail.proposal).toMatchObject({ opened: true, preview_link: { view_count: 3 } })
  })

  it('no pisa una propuesta existente sin replace; con replace revoca el link anterior', async () => {
    const first = await run('create_lead_proposal', { lead_id: LEAD, event: EVENT })
    const again = await call('create_lead_proposal', { lead_id: LEAD, event_id: 149 })
    expect(again).toMatchObject({ ok: false, code: 'conflict' })
    const second = await run('create_lead_proposal', { lead_id: LEAD, event_id: 149, replace: true })
    expect(second.preview_url).toBeTruthy()
    expect(db.tables.aitickets_event_preview_links.find((l) => l.id === first.preview_link.id).revoked_at).toBeTruthy()
    expect(lead().proposal_event_id).toBe(149)
  })

  it('sin la migración (sin proposals_org_id) responde unavailable', async () => {
    db.tables.aitickets_platform_settings = db.tables.aitickets_platform_settings.filter((s) => s.key !== 'proposals_org_id')
    const out = await call('create_lead_proposal', { lead_id: LEAD, event: EVENT })
    expect(out).toMatchObject({ ok: false, code: 'unavailable' })
    expect(db.tables.events).toHaveLength(1)
  })
})
