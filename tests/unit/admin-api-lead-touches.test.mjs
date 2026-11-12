// MCP de administración: log_lead_touch. Un touch es una fila que avanza (drafted → sent → replied/bounced).
// Regresión: `sent` sin borrador previo insertaba drafted_at = null y chocaba con el NOT NULL de la tabla.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))

const { getAdminTool } = await import('../../src/lib/admin-api/tools/index.ts')
const { runAdminTool } = await import('../../src/lib/admin-api/registry.ts')

const LEAD = '00000001-0000-4000-8000-000000000000'
const REASON = 'Importación desde Gmail pedida por el dueño, 10-11'
const SENT_AT = '2026-11-04T21:31:32.000Z'
const actx = () => ({ supabase: db, origin: 'https://aitickets.cl', requestUrl: new URL('https://aitickets.cl/api/admin/mcp'), keyKind: 'full', fingerprint: 'abcd1234', ipHash: 'f'.repeat(64) })
const run = async (name, args, withReason = true) => {
  const out = await runAdminTool(getAdminTool(name), withReason ? { ...args, reason: REASON } : args, actx())
  expect(out.ok, JSON.stringify(out)).toBe(true)
  return out.result
}
const touches = () => db.tables.aitickets_lead_touches
const lead = () => db.tables.aitickets_leads[0]

beforeEach(() => {
  db = createFakeSupabase({
    tables: {
      aitickets_leads: [{
        id: LEAD, name_key: 'producer:p1', org_name: 'Productora 1', lead_type: 'producer', niche: 'talleres', domain: 'p1.cl', email: 'hola@p1.cl',
        source: 'sdr_talleres', status: 'new', manual_only: true, sequence_step: 0, next_action: 'draft_t1', next_action_at: null, gmail_thread_id: null,
        contact_sources: [], notes: null, created_at: '2026-11-01T00:00:00Z',
      }],
      aitickets_lead_touches: [],
      aitickets_suppressions: [],
      aitickets_admin_audit: [],
      aitickets_admin_confirmations: [],
      aitickets_admin_idempotency: [],
    },
    unique: { aitickets_admin_idempotency: [['tool', 'idem_key']] },
  })
})

describe('log_lead_touch', () => {
  it('sent sin borrador previo crea la fila con drafted_at (nunca null) y corre el reloj desde el envío real', async () => {
    const r = await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, subject: 'Tus talleres', gmail_message_id: 'm1', gmail_thread_id: 't1', occurred_at: SENT_AT })
    expect(r).toMatchObject({ action: 'sent', new_status: 'contacted', next_action: 'draft_t2', touch_updated: false })
    expect(touches()).toHaveLength(1)
    expect(touches()[0]).toMatchObject({ outcome: 'sent', kind: 'outreach', step: 1, drafted_at: SENT_AT, sent_at: SENT_AT, gmail_message_id: 'm1' })
    expect(lead()).toMatchObject({ status: 'contacted', sequence_step: 1, last_contacted_at: SENT_AT, gmail_thread_id: 't1', next_action: 'draft_t2' })
    expect(lead().next_action_at).toBe('2026-11-08T21:31:32.000Z')
  })

  it('sent después de drafted actualiza la misma fila y conserva drafted_at', async () => {
    const drafted = await run('log_lead_touch', { lead_id: LEAD, action: 'drafted', step: 1, subject: 'Borrador', gmail_draft_id: 'd1', strategy_slug: 'talleres-cupos', occurred_at: '2026-11-03T12:00:00.000Z' })
    expect(lead().status).toBe('queued')
    const sent = await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, gmail_message_id: 'm1', occurred_at: SENT_AT })
    expect(sent).toMatchObject({ touch_id: drafted.touch_id, touch_updated: true, new_status: 'contacted' })
    expect(touches()).toHaveLength(1)
    expect(touches()[0]).toMatchObject({ outcome: 'sent', drafted_at: '2026-11-03T12:00:00.000Z', sent_at: SENT_AT, subject: 'Borrador', gmail_draft_id: 'd1', gmail_message_id: 'm1', strategy_slug: 'talleres-cupos' })
  })

  it('sent calza el borrador por gmail_draft_id aunque haya otro borrador del mismo paso', async () => {
    const a = await run('log_lead_touch', { lead_id: LEAD, action: 'drafted', step: 1, gmail_draft_id: 'd1' })
    await run('log_lead_touch', { lead_id: LEAD, action: 'drafted', step: 1, gmail_draft_id: 'd2' })
    const sent = await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, gmail_draft_id: 'd1', occurred_at: SENT_AT })
    expect(sent.touch_id).toBe(a.touch_id)
    expect(touches().map((t) => t.outcome).sort()).toEqual(['drafted', 'sent'])
  })

  it('replied cierra el envío en la misma fila (sent_at + reply_at) y corta la secuencia', async () => {
    const sent = await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, strategy_slug: 'talleres-cupos', occurred_at: SENT_AT })
    const replied = await run('log_lead_touch', { lead_id: LEAD, action: 'replied', reply_sentiment: 'positive', occurred_at: '2026-11-06T21:31:32.000Z' })
    expect(replied).toMatchObject({ touch_id: sent.touch_id, touch_updated: true, new_status: 'replied', next_action: 'reply' })
    expect(touches()).toHaveLength(1)
    expect(touches()[0]).toMatchObject({ outcome: 'replied', kind: 'outreach', reply_sentiment: 'positive', sent_at: SENT_AT, reply_at: '2026-11-06T21:31:32.000Z' })
    expect(lead().next_action_at).toBeNull()

    // El embudo cuenta la fila respondida también como contactada: 1 de 1, no 1 de 0.
    const funnel = await run('get_lead_funnel', {}, false)
    const bucket = funnel.funnel.find((b) => b.strategy_slug === 'talleres-cupos')
    expect(bucket, JSON.stringify(funnel)).toMatchObject({ contacted: 1, replied: 1, response_rate_pct: 100, avg_days_to_reply: 2 })
  })

  it('bounced cierra el envío y deja el lead inválido', async () => {
    const sent = await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, occurred_at: SENT_AT })
    const bounced = await run('log_lead_touch', { lead_id: LEAD, action: 'bounced', step: 1 })
    expect(bounced).toMatchObject({ touch_id: sent.touch_id, touch_updated: true, new_status: 'invalid' })
    expect(touches()[0]).toMatchObject({ outcome: 'bounced', sent_at: SENT_AT })
    expect(lead()).toMatchObject({ status: 'invalid', invalid_reason: 'bounced', next_action: 'none' })
  })

  it('replied sin envío registrado crea una fila reply con drafted_at', async () => {
    const r = await run('log_lead_touch', { lead_id: LEAD, action: 'replied', reply_sentiment: 'neutral', occurred_at: SENT_AT })
    expect(r.touch_updated).toBe(false)
    expect(touches()[0]).toMatchObject({ outcome: 'replied', kind: 'reply', drafted_at: SENT_AT, reply_at: SENT_AT, sent_at: null })
  })
})
