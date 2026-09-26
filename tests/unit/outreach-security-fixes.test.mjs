// Correcciones de seguridad/cumplimiento del outreach: formulario /web-gratis (sin match por dominio),
// idempotencia del webhook (no pierde bajas), bloqueo en Instantly con reintento, webhook obligatorio
// para envío real y referidos solo del mismo dominio.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { createInboundLead } from '../../netlify/lib/outreach/sources/inbound.mjs'
import { processInstantlyWebhook } from '../../netlify/lib/outreach/webhook.mjs'
import { blockAtProvider, retryPendingBlocks } from '../../netlify/lib/outreach/provider-block.mjs'
import { selectProvider } from '../../netlify/lib/outreach/providers/index.mjs'
import { getOutreachConfig } from '../../netlify/lib/outreach/config.mjs'
import { handleIntent } from '../../netlify/lib/outreach/classify.mjs'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const scraped = { id: 'victim', email: 'contacto@productora-victima.cl', domain: 'productora-victima.cl', org_name: 'Víctima', status: 'contacted', source_refs: [], consent_at: null, lawful_basis: 'legitimate_interest_b2b' }

describe('createInboundLead: nunca reutiliza un lead ajeno por dominio', () => {
  it('sitio de otro lead + gmail → lead nuevo sin dominio, el lead original queda intacto', async () => {
    const supabase = createFakeSupabase({ tables: { aitickets_leads: [{ ...scraped }] } })
    const r = await createInboundLead(supabase, { orgName: 'x', email: 'attacker@gmail.com', website: 'https://productora-victima.cl' })
    expect(r.created).toBe(true)
    expect(r.domainConflict).toBe(true)
    expect(r.leadId).not.toBe('victim')
    const victim = supabase.tables.aitickets_leads.find((l) => l.id === 'victim')
    expect(victim).toMatchObject({ status: 'contacted', consent_at: null, lawful_basis: 'legitimate_interest_b2b', org_name: 'Víctima' })
    const mine = supabase.tables.aitickets_leads.find((l) => l.id === r.leadId)
    expect(mine).toMatchObject({ email: 'attacker@gmail.com', domain: null, lawful_basis: 'consent' })
  })

  it('correo corporativo con dominio que ya tiene otro lead → lead nuevo sin dominio', async () => {
    const supabase = createFakeSupabase({ tables: { aitickets_leads: [{ ...scraped }] } })
    const r = await createInboundLead(supabase, { orgName: 'x', email: 'otra@productora-victima.cl' })
    expect(r).toMatchObject({ created: true, domainConflict: true })
    expect(supabase.tables.aitickets_leads.find((l) => l.id === 'victim').consent_at).toBeNull()
  })

  it('mismo email exacto → actualiza consentimiento y solo completa campos vacíos', async () => {
    const supabase = createFakeSupabase({ tables: { aitickets_leads: [{ ...scraped, city: null }] } })
    const r = await createInboundLead(supabase, { orgName: 'Otro nombre', email: 'Contacto@productora-victima.cl', city: 'Santiago' })
    expect(r).toMatchObject({ leadId: 'victim', created: false })
    expect(supabase.tables.aitickets_leads[0]).toMatchObject({ lawful_basis: 'consent', status: 'interested', org_name: 'Víctima', city: 'Santiago' })
  })

  it('sitio no respaldado por el correo no reclama el dominio', async () => {
    const supabase = createFakeSupabase({ tables: { aitickets_leads: [] } })
    await createInboundLead(supabase, { orgName: 'x', email: 'yo@gmail.com', website: 'competidor.cl' })
    expect(supabase.tables.aitickets_leads[0].domain).toBeNull()
    await createInboundLead(supabase, { orgName: 'y', email: 'hola@miproductora.cl', website: 'https://www.miproductora.cl' })
    expect(supabase.tables.aitickets_leads[1].domain).toBe('miproductora.cl')
  })
})

describe('processInstantlyWebhook: un fallo no consume el evento', () => {
  it('si suppress falla, borra el marcador y el reintento sí suprime', async () => {
    const supabase = createFakeSupabase({ tables: { aitickets_leads: [], aitickets_suppressions: [], aitickets_outreach_events: [] } })
    const payload = { event_type: 'lead_unsubscribed', lead_email: 'a@teatro.cl', timestamp: '2026-09-28T15:00:00Z' }
    supabase.failOn('aitickets_suppressions', 'insert', { code: '08006', message: 'conexión' })
    await expect(processInstantlyWebhook(supabase, payload)).rejects.toThrow()
    expect(supabase.tables.aitickets_outreach_events).toHaveLength(0)
    const r = await processInstantlyWebhook(supabase, payload)
    expect(r.body).toMatchObject({ action: 'suppressed' })
    expect(supabase.tables.aitickets_suppressions).toHaveLength(1)
  })

  it('queja/spam → supresión y evento complaint', async () => {
    const supabase = createFakeSupabase({ tables: { aitickets_leads: [], aitickets_suppressions: [], aitickets_outreach_events: [] } })
    await processInstantlyWebhook(supabase, { event_type: 'email_marked_as_spam', lead_email: 'b@teatro.cl' })
    expect(supabase.tables.aitickets_suppressions[0]).toMatchObject({ email: 'b@teatro.cl', reason: 'complaint' })
    expect(supabase.tables.aitickets_outreach_events.map((e) => e.type)).toContain('complaint')
  })
})

describe('blockAtProvider', () => {
  const tables = () => ({
    aitickets_leads: [{ id: 'l1', email: 'a@teatro.cl' }],
    aitickets_outreach_messages: [{ id: 'm1', lead_id: 'l1', direction: 'out', provider: 'instantly', provider_message_id: 'inst-lead-1', step: 0 }],
    aitickets_outreach_events: [],
  })

  it('bloquea y elimina el lead de la campaña; si falla deja pendiente y el tick lo reintenta', async () => {
    vi.stubEnv('INSTANTLY_API_KEY', 'k')
    const calls = []
    let fail = true
    vi.stubGlobal('fetch', async (url, init) => {
      calls.push(`${init.method} ${url}`)
      if (fail) return new Response('{"error":"down"}', { status: 503 })
      return new Response('{}', { status: 200 })
    })
    const supabase = createFakeSupabase({ tables: tables() })
    const r = await blockAtProvider(supabase, { email: 'a@teatro.cl', leadId: 'l1', source: 'test' })
    expect(r).toMatchObject({ ok: false, pending: true })
    expect(supabase.tables.aitickets_outreach_events[0].type).toBe('provider_block_pending')
    expect(calls.some((c) => c.startsWith('DELETE') && c.endsWith('/leads/inst-lead-1'))).toBe(true)

    fail = false
    const out = await retryPendingBlocks(supabase)
    expect(out).toEqual({ retried: 1, done: 1 })
    expect(supabase.tables.aitickets_outreach_events[0].type).toBe('provider_block_done')
  })

  it('sin clave de Instantly y sin envíos por Instantly → nada que hacer', async () => {
    const supabase = createFakeSupabase({ tables: { ...tables(), aitickets_outreach_messages: [] } })
    expect(await blockAtProvider(supabase, { email: 'a@teatro.cl', leadId: 'l1' })).toMatchObject({ ok: true, skipped: true })
  })
})

describe('selectProvider: webhook obligatorio para Instantly', () => {
  it('sin OUTREACH_WEBHOOK_SECRET → dry-run con webhook_not_configured', () => {
    vi.stubEnv('INSTANTLY_API_KEY', 'k')
    vi.stubEnv('INSTANTLY_CAMPAIGN_ID', 'c')
    const cfg = { ...getOutreachConfig(), provider: 'instantly' }
    const r = selectProvider(cfg)
    expect(r.dryRun).toBe(true)
    expect(r.blockers).toContain('webhook_not_configured')
  })
})

describe('handleIntent referral: solo mismo dominio', () => {
  const lead = { id: 'lead-1', email: 'contacto@teatro.cl', domain: 'teatro.cl', org_name: 'Teatro', status: 'contacted' }
  const inbound = { id: 'msg-in-1', provider: 'dryrun' }
  const db = () => createFakeSupabase({ tables: { aitickets_leads: [{ ...lead }], aitickets_outreach_messages: [{ id: 'msg-in-1', direction: 'in' }], aitickets_outreach_events: [] } })

  it('otro dominio → no crea lead', async () => {
    const supabase = db()
    const r = await handleIntent({ supabase, lead, inbound, result: { intent: 'referral', confidence: 0.9, referral_email: 'victim@corp.com' } })
    expect(r.action).toBe('lost')
    expect(supabase.tables.aitickets_leads).toHaveLength(1)
  })

  it('mismo dominio → crea lead referido', async () => {
    const supabase = db()
    const r = await handleIntent({ supabase, lead, inbound, result: { intent: 'referral', confidence: 0.9, referral_email: 'produccion@teatro.cl' } })
    expect(r.action).toBe('referral_created')
    expect(supabase.tables.aitickets_leads.find((l) => l.email === 'produccion@teatro.cl')).toMatchObject({ source: 'referral', status: 'new' })
  })
})
