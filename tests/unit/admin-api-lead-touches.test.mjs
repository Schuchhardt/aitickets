// MCP de administración: log_lead_touch. Un touch es una fila que avanza (drafted → sent → replied/bounced).
// drafted_at solo existe si hubo borrador (la columna es nullable desde 202611110200).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))

const { getAdminTool } = await import('../../src/lib/admin-api/tools/index.ts')
const { runAdminTool } = await import('../../src/lib/admin-api/registry.ts')

const LEAD = '00000001-0000-4000-8000-000000000000'
const REASON = 'Importación desde Gmail pedida por el dueño, 10-11'
const SENT_AT = '2026-11-04T21:31:32.000Z'
const REPLY_AT = '2026-11-06T21:31:32.000Z'
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
      aitickets_lead_strategies: [{ slug: 'talleres-cupos', niche: 'talleres', name: 'Cupos', status: 'active' }],
      aitickets_admin_audit: [],
      aitickets_admin_confirmations: [],
      aitickets_admin_idempotency: [],
    },
    unique: { aitickets_admin_idempotency: [['tool', 'idem_key']] },
  })
})

describe('log_lead_touch', () => {
  it('sent sin borrador previo crea la fila sin drafted_at y corre el reloj desde el envío real', async () => {
    const r = await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, subject: 'Tus talleres', gmail_message_id: 'm1', gmail_thread_id: 't1', occurred_at: SENT_AT })
    expect(r).toMatchObject({ action: 'sent', new_status: 'contacted', next_action: 'draft_t2', touch_updated: false })
    expect(touches()).toHaveLength(1)
    expect(touches()[0]).toMatchObject({ outcome: 'sent', kind: 'outreach', step: 1, drafted_at: null, sent_at: SENT_AT, gmail_message_id: 'm1' })
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

  it('replied sin envío registrado crea una fila reply sin drafted_at', async () => {
    const r = await run('log_lead_touch', { lead_id: LEAD, action: 'replied', reply_sentiment: 'neutral', occurred_at: SENT_AT })
    expect(r.touch_updated).toBe(false)
    expect(touches()[0]).toMatchObject({ outcome: 'replied', kind: 'reply', drafted_at: null, reply_at: SENT_AT, sent_at: null })
  })

  it('replied guarda el id de la respuesta aparte y no pisa el asunto ni el id del correo enviado', async () => {
    await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, subject: 'Tus talleres', gmail_message_id: 'sent-1', occurred_at: SENT_AT })
    await run('log_lead_touch', { lead_id: LEAD, action: 'replied', reply_sentiment: 'positive', subject: 'Re: Tus talleres', gmail_message_id: 'reply-1', occurred_at: REPLY_AT })
    expect(touches()[0]).toMatchObject({ subject: 'Tus talleres', gmail_message_id: 'sent-1', reply_gmail_message_id: 'reply-1' })
  })

  it('replied devuelve next_action_at = null, igual que lo que guarda', async () => {
    await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, occurred_at: SENT_AT })
    expect(lead().next_action_at).not.toBeNull()
    const r = await run('log_lead_touch', { lead_id: LEAD, action: 'replied', reply_sentiment: 'positive', occurred_at: REPLY_AT })
    expect(r).toMatchObject({ next_action: 'reply', next_action_at: null })
    expect(lead().next_action_at).toBeNull()
  })

  it('la misma respuesta (mismo gmail_message_id) no se cuenta dos veces', async () => {
    await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, occurred_at: SENT_AT })
    await run('log_lead_touch', { lead_id: LEAD, action: 'replied', reply_sentiment: 'positive', gmail_message_id: 'reply-1', occurred_at: REPLY_AT })
    const again = await run('log_lead_touch', { lead_id: LEAD, action: 'replied', reply_sentiment: 'positive', gmail_message_id: 'reply-1', occurred_at: REPLY_AT })
    expect(again).toMatchObject({ duplicate: true })
    expect(touches()).toHaveLength(1)
  })

  it('importación fuera de orden: el sent que llega después de la respuesta se fusiona con ella y no reinicia la secuencia', async () => {
    await run('log_lead_touch', { lead_id: LEAD, action: 'replied', reply_sentiment: 'positive', gmail_message_id: 'reply-1', occurred_at: REPLY_AT })
    expect(lead()).toMatchObject({ status: 'replied', next_action: 'reply', next_action_at: null })

    const sent = await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, subject: 'Tus talleres', gmail_message_id: 'sent-1', strategy_slug: 'talleres-cupos', occurred_at: SENT_AT })
    expect(sent).toMatchObject({ touch_updated: true, merged_with_reply: true, new_status: 'replied', next_action: 'reply', next_action_at: null, sequence_step: 1 })
    expect(touches()).toHaveLength(1)
    expect(touches()[0]).toMatchObject({ kind: 'outreach', outcome: 'replied', sent_at: SENT_AT, reply_at: REPLY_AT, gmail_message_id: 'sent-1', reply_gmail_message_id: 'reply-1', subject: 'Tus talleres', step: 1 })
    expect(lead()).toMatchObject({ status: 'replied', next_action: 'reply', next_action_at: null, sequence_step: 1, last_contacted_at: SENT_AT })

    // Repetir la respuesta no crea otra fila: el embudo la cuenta una vez.
    await run('log_lead_touch', { lead_id: LEAD, action: 'replied', reply_sentiment: 'positive', gmail_message_id: 'reply-1', occurred_at: REPLY_AT })
    expect(touches()).toHaveLength(1)
    const funnel = await run('get_lead_funnel', {}, false)
    expect(funnel.funnel.find((b) => b.strategy_slug === 'talleres-cupos')).toMatchObject({ contacted: 1, replied: 1 })
  })

  it.each(['replied', 'interested', 'converted', 'lost', 'suppressed'])('sent sobre un lead %s solo registra el envío', async (status) => {
    Object.assign(lead(), { status, next_action: status === 'replied' ? 'reply' : 'none', next_action_at: null, sequence_step: 1, last_contacted_at: '2026-11-01T00:00:00.000Z' })
    const r = await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 2, occurred_at: SENT_AT })
    expect(r).toMatchObject({ new_status: status, next_action_at: null, sequence_step: 2 })
    expect(r.note).toMatch(status)
    expect(lead()).toMatchObject({ status, next_action_at: null, sequence_step: 2, last_contacted_at: SENT_AT })
  })

  it('sent de un paso anterior no retrocede la secuencia ni last_contacted_at', async () => {
    Object.assign(lead(), { status: 'contacted', sequence_step: 2, next_action: 'draft_t3', next_action_at: '2026-11-20T00:00:00.000Z', last_contacted_at: '2026-11-15T00:00:00.000Z' })
    const r = await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, occurred_at: SENT_AT })
    expect(r).toMatchObject({ new_status: 'contacted', sequence_step: 2, next_action: 'draft_t3', next_action_at: '2026-11-20T00:00:00.000Z' })
    expect(lead().last_contacted_at).toBe('2026-11-15T00:00:00.000Z')
  })

  it('avisa si la estrategia no está en el catálogo', async () => {
    const r = await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, strategy_slug: 'no-existe', occurred_at: SENT_AT })
    expect(r.warnings.join(' ')).toMatch('no-existe')
  })
})

describe('update_lead_touch / delete_lead_touch', () => {
  it('etiqueta varios envíos con su estrategia y rechaza otros campos en lote', async () => {
    const a = await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, occurred_at: SENT_AT })
    const b = await run('log_lead_touch', { lead_id: LEAD, action: 'drafted', step: 2 })
    const r = await run('update_lead_touch', { touch_ids: [a.touch_id, b.touch_id], strategy_slug: 'talleres-cupos', cta: 'demo' })
    expect(r).toMatchObject({ updated: 2, lead_ids: [LEAD] })
    expect(touches().every((t) => t.strategy_slug === 'talleres-cupos' && t.cta === 'demo')).toBe(true)

    const bad = await runAdminTool(getAdminTool('update_lead_touch'), { touch_ids: [a.touch_id], subject: 'x', reason: REASON }, actx())
    expect(bad).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('corrige un touch y null borra un valor', async () => {
    const a = await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, subject: 'Mal', occurred_at: SENT_AT })
    const r = await run('update_lead_touch', { touch_id: a.touch_id, subject: null, step: 2 })
    expect(r.touch).toMatchObject({ subject: null, step: 2 })
  })

  it('borrar pide confirmación y después borra', async () => {
    const a = await run('log_lead_touch', { lead_id: LEAD, action: 'sent', step: 1, occurred_at: SENT_AT })
    const first = await run('delete_lead_touch', { touch_id: a.touch_id })
    expect(first.status).toBe('confirmation_required')
    expect(touches()).toHaveLength(1)
    const done = await run('delete_lead_touch', { touch_id: a.touch_id, confirmation_token: first.confirmation_token })
    expect(done).toMatchObject({ deleted: true, lead_id: LEAD })
    expect(touches()).toHaveLength(0)
  })
})
