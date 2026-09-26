// Endurecimiento del outreach: interruptor de emergencia en Instantly (pausa de campaña), seguimientos
// siempre con pie legal, respuestas que respetan pausa/supresión, reintentos con presupuesto, anti-SSRF del
// crawler, robots.txt según RFC 9309 y doble opt-in del formulario /web-gratis.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { counterRpc, createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { getOutreachConfig } from '../../netlify/lib/outreach/config.mjs'
import { canReply, setPaused } from '../../netlify/lib/outreach/guardrails.mjs'
import { syncProviderCampaign } from '../../netlify/lib/outreach/provider-campaign.mjs'
import * as instantly from '../../netlify/lib/outreach/providers/instantly.mjs'
import { composeFollowup } from '../../netlify/lib/outreach/compose.mjs'
import { handleIntent } from '../../netlify/lib/outreach/classify.mjs'
import { blockDomainAtProvider, retryPendingBlocks } from '../../netlify/lib/outreach/provider-block.mjs'
import { assertPublicUrl, crawlSite, isBlockedIp, loadRobots } from '../../netlify/lib/outreach/enrich.mjs'
import { confirmInboundPending, createInboundPending } from '../../netlify/lib/outreach/sources/inbound.mjs'
import { signInboundConfirmToken, verifyInboundConfirmToken } from '../../netlify/lib/outreach/tokens.mjs'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function instantlyEnv() {
  vi.stubEnv('INSTANTLY_API_KEY', 'k')
  vi.stubEnv('INSTANTLY_CAMPAIGN_ID', 'camp-1')
}

function recordFetch(handler = () => new Response('{}', { status: 200 })) {
  const calls = []
  vi.stubGlobal('fetch', async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' })
    return handler(String(url), init)
  })
  return calls
}

const stateDb = (extra = {}) => createFakeSupabase({ tables: { aitickets_outreach_state: [{ key: 'paused', value: { paused: false } }], ...extra } })

describe('interruptor de emergencia: pausa de la campaña de Instantly', () => {
  it('setPaused(true) pausa la campaña (POST /campaigns/{id}/pause)', async () => {
    instantlyEnv()
    const calls = recordFetch()
    const supabase = stateDb()
    const r = await setPaused(supabase, true, 'quejas 0.5%')
    expect(r.campaign).toMatchObject({ action: 'paused', ok: true })
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/campaigns/camp-1/pause'))).toBe(true)
    const st = supabase.tables.aitickets_outreach_state.find((s) => s.key === 'provider_campaign')
    expect(st.value).toMatchObject({ state: 'paused', paused_by_us: true, pending: false })
  })

  it('OUTREACH_ENABLED=false → el tick pausa; si falla queda pendiente, avisa por Slack y reintenta', async () => {
    instantlyEnv()
    vi.stubEnv('SLACK_OUTREACH_WEBHOOK_URL', 'https://hooks.slack.test/x')
    let fail = true
    const slack = []
    const calls = recordFetch((url, init) => {
      if (url.startsWith('https://hooks.slack.test')) { slack.push(JSON.parse(init.body).text); return new Response('ok') }
      return fail ? new Response('{"e":1}', { status: 503 }) : new Response('{}')
    })
    const supabase = stateDb()
    const cfg = { ...getOutreachConfig(), enabled: false }
    const r1 = await syncProviderCampaign(supabase, { paused: false, cfg })
    expect(r1.ok).toBe(false)
    expect(slack.some((t) => /NO se pudo pausar la campaña/.test(t))).toBe(true)
    expect(supabase.tables.aitickets_outreach_state.find((s) => s.key === 'provider_campaign').value).toMatchObject({ pending: true, desired: 'paused' })

    fail = false
    const r2 = await syncProviderCampaign(supabase, { paused: false, cfg })
    expect(r2).toMatchObject({ action: 'paused', ok: true })
    // Ya pausada: no vuelve a llamar a la API.
    const before = calls.length
    expect(await syncProviderCampaign(supabase, { paused: false, cfg })).toMatchObject({ action: 'noop' })
    expect(calls.length).toBe(before)
  })

  it('solo reactiva una campaña que pausamos nosotros', async () => {
    instantlyEnv()
    vi.stubEnv('OUTREACH_WEBHOOK_SECRET', 's')
    vi.stubEnv('CHANIUM_LEGAL_ADDRESS', 'Dirección 123')
    vi.stubEnv('CHANIUM_LEGAL_EMAIL', 'legal@aitickets.cl')
    const calls = recordFetch()
    const cfg = { ...getOutreachConfig(), enabled: true, dryRun: false, liaApproved: true, provider: 'instantly' }
    // Estado desconocido (la campaña la maneja el equipo): no se toca.
    expect(await syncProviderCampaign(stateDb(), { paused: false, cfg })).toMatchObject({ action: 'noop' })
    expect(calls).toHaveLength(0)
    // Pausada por nosotros → se reactiva.
    const supabase = stateDb({})
    supabase.tables.aitickets_outreach_state.push({ key: 'provider_campaign', value: { state: 'paused', paused_by_us: true } })
    expect(await syncProviderCampaign(supabase, { paused: false, cfg })).toMatchObject({ action: 'resumed' })
    expect(calls.some((c) => c.url.endsWith('/campaigns/camp-1/activate'))).toBe(true)
  })

  it('sin Instantly configurado no hace nada', async () => {
    expect(await syncProviderCampaign(stateDb(), { paused: true })).toMatchObject({ action: 'not_configured', ok: true })
  })
})

describe('Instantly: los seguimientos nunca salen sin pie legal', () => {
  const lead = { id: 'lead-1', email: 'contacto@teatro.cl', org_name: 'Teatro', upcoming_event: { name: 'Obra' } }

  it('rechaza inscribir con menos de 2 seguimientos o sin pie', async () => {
    instantlyEnv()
    vi.stubEnv('OUTREACH_UNSUB_SECRET', 'u')
    const calls = recordFetch()
    const cfg = getOutreachConfig()
    const f1 = composeFollowup({ lead, step: 1, cfg })
    const initial = f1.text
    await expect(instantly.sendInitial({ lead, subject: 's', text: initial, followups: [{ subject: f1.subject, text: f1.text }] })).rejects.toThrow(/2 seguimientos/)
    await expect(instantly.sendInitial({ lead, subject: 's', text: initial, followups: [{ subject: 'a', text: f1.text }, { subject: 'b', text: '' }] })).rejects.toThrow(/pie legal/)
    expect(calls).toHaveLength(0)
  })

  it('con 2 seguimientos válidos envía los 4 campos (textos y asuntos)', async () => {
    instantlyEnv()
    vi.stubEnv('OUTREACH_UNSUB_SECRET', 'u')
    let body = null
    recordFetch((_url, init) => { body = JSON.parse(init.body); return new Response('{"id":"x"}') })
    const cfg = getOutreachConfig()
    const fs = [1, 2].map((step) => composeFollowup({ lead, step, cfg }))
    await instantly.sendInitial({ lead, subject: 's', text: fs[0].text, followups: fs.map((f) => ({ subject: f.subject, text: f.text })) })
    expect(body.custom_variables.ait_followup2).toContain('/api/outreach/unsubscribe?t=')
    expect(body.custom_variables.ait_followup1_subject).toMatch(/^Seguimiento:/)
    expect(body.custom_variables.ait_followup2_subject).not.toMatch(/^Re:/)
  })

  it('con provider=instantly, OUTREACH_MAX_FOLLOWUPS se ignora (la campaña tiene 2 pasos fijos)', () => {
    vi.stubEnv('OUTREACH_PROVIDER', 'instantly')
    vi.stubEnv('OUTREACH_MAX_FOLLOWUPS', '0')
    expect(getOutreachConfig().maxFollowups).toBe(2)
  })
})

describe('canReply: política única para responder (auto y aprobación)', () => {
  const lead = { id: 'l1', email: 'contacto@teatro.cl', domain: 'teatro.cl', status: 'interested', country: 'CL' }
  const cfg = () => ({ ...getOutreachConfig(), enabled: true, dryRun: false, liaApproved: true, provider: 'instantly' })
  const legal = () => {
    vi.stubEnv('CHANIUM_LEGAL_ADDRESS', 'Dirección 123')
    vi.stubEnv('CHANIUM_LEGAL_EMAIL', 'legal@aitickets.cl')
  }
  const tables = (paused = false) => ({ aitickets_outreach_state: [{ key: 'paused', value: { paused } }], aitickets_suppressions: [], organizations: [] })
  // Sábado de noche: fuera de la ventana de envío, que no aplica a respuestas.
  const SAT_NIGHT = new Date('2026-10-04T02:00:00Z')

  it('fuera de la ventana de envío → permitido', async () => {
    legal()
    expect(await canReply(createFakeSupabase({ tables: tables(), rpc: counterRpc() }), lead, SAT_NIGHT, { cfg: cfg() })).toEqual({ ok: true })
  })
  it('pausado → bloqueado', async () => {
    legal()
    expect(await canReply(createFakeSupabase({ tables: tables(true) }), lead, SAT_NIGHT, { cfg: cfg() })).toEqual({ ok: false, reason: 'paused' })
  })
  it('suprimido → bloqueado', async () => {
    legal()
    const db = createFakeSupabase({ tables: { ...tables(), aitickets_suppressions: [{ id: 1, email: 'contacto@teatro.cl' }] } })
    expect(await canReply(db, lead, SAT_NIGHT, { cfg: cfg() })).toEqual({ ok: false, reason: 'suppressed' })
  })
  it('error de BD al revisar supresión → bloqueado (guardrail_error)', async () => {
    legal()
    const db = createFakeSupabase({ tables: tables() })
    db.failOn('aitickets_suppressions', 'select', { code: '08006', message: 'timeout' })
    expect(await canReply(db, lead, SAT_NIGHT, { cfg: cfg() })).toEqual({ ok: false, reason: 'guardrail_error' })
  })
})

describe('respuesta automática a "interested" respeta la pausa', () => {
  it('pausado → no llama al proveedor, va a Slack como borrador', async () => {
    instantlyEnv()
    vi.stubEnv('OUTREACH_ENABLED', 'true')
    vi.stubEnv('OUTREACH_DRY_RUN', 'false')
    vi.stubEnv('OUTREACH_PROVIDER', 'instantly')
    vi.stubEnv('OUTREACH_LIA_APPROVED', 'true')
    vi.stubEnv('OUTREACH_AUTO_REPLY', 'true')
    vi.stubEnv('OUTREACH_WEBHOOK_SECRET', 's')
    vi.stubEnv('OUTREACH_UNSUB_SECRET', 'u')
    vi.stubEnv('LEAD_TOKEN_SECRET', 'l')
    vi.stubEnv('CHANIUM_LEGAL_ADDRESS', 'Dirección 123')
    vi.stubEnv('CHANIUM_LEGAL_EMAIL', 'legal@aitickets.cl')
    const calls = recordFetch()
    const lead = { id: 'l1', email: 'contacto@teatro.cl', domain: 'teatro.cl', status: 'replied', country: 'CL', org_name: 'Teatro' }
    const inbound = { id: 'in-1', provider: 'instantly', provider_message_id: 'em-1', mailbox: 'hola@outreach.cl', thread_id: 't', body_text: 'Sí, me interesa' }
    const supabase = createFakeSupabase({
      tables: {
        aitickets_outreach_state: [{ key: 'paused', value: { paused: true } }],
        aitickets_suppressions: [], organizations: [], aitickets_leads: [{ ...lead }],
        aitickets_outreach_messages: [{ ...inbound, direction: 'in' }], aitickets_outreach_events: [],
      },
    })
    const r = await handleIntent({ supabase, lead, inbound, result: { intent: 'interested', confidence: 0.99, via: 'llm' } })
    expect(r.action).toBe('escalated')
    expect(calls.some((c) => c.url.includes('/emails/reply'))).toBe(false)
    expect(supabase.tables.aitickets_outreach_messages.some((m) => m.status === 'draft')).toBe(true)
  })
})

describe('bloqueo en el proveedor', () => {
  it('opt-out por dominio bloquea los emails de los leads de ese dominio', async () => {
    instantlyEnv()
    const calls = recordFetch()
    const supabase = createFakeSupabase({
      tables: {
        aitickets_leads: [
          { id: 'a', email: 'contacto@teatro.cl', domain: 'teatro.cl' },
          { id: 'b', email: 'prod@teatro.cl', domain: null },
          { id: 'c', email: 'otro@otro.cl', domain: 'otro.cl' },
        ],
        aitickets_outreach_messages: [], aitickets_outreach_events: [],
      },
    })
    const r = await blockDomainAtProvider(supabase, { domain: 'www.teatro.cl', source: 'bot_page' })
    expect(r).toMatchObject({ ok: true, emails: 2 })
    const blocked = calls.filter((c) => c.url.endsWith('/block-lists-entries'))
    expect(blocked).toHaveLength(2)
  })

  it('retryPendingBlocks respeta el presupuesto de tiempo', async () => {
    instantlyEnv()
    recordFetch(async () => { await new Promise((r) => setTimeout(r, 30)); return new Response('{}', { status: 503 }) })
    const pending = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, type: 'provider_block_pending', lead_id: null, payload: { email: `a${i}@teatro.cl`, attempts: 1 } }))
    const supabase = createFakeSupabase({ tables: { aitickets_outreach_events: pending, aitickets_leads: [], aitickets_outreach_messages: [] } })
    const out = await retryPendingBlocks(supabase, { budgetMs: 10 })
    expect(out.retried).toBe(1)
    expect(out.outOfTime).toBe(true)
    // La fila intentada sí quedó con attempts incrementado.
    expect(supabase.tables.aitickets_outreach_events[0].payload.attempts).toBe(2)
  })
})

describe('crawler: anti-SSRF', () => {
  it('clasifica IPs no públicas', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00:ec2::254', '::ffff:127.0.0.1', '::ffff:7f00:1', 'not-an-ip']) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
    for (const ip of ['8.8.8.8', '200.1.2.3', '2800:3f0:4001::1']) expect(isBlockedIp(ip), ip).toBe(false)
  })

  it('rechaza IP literal, puertos raros, hosts internos y hosts que resuelven a privadas', async () => {
    const pub = async () => [{ address: '200.1.2.3' }]
    await expect(assertPublicUrl('http://127.0.0.1:9001/2018-06-01/runtime/invocation/next', { lookup: pub })).rejects.toThrow(/ssrf_blocked/)
    await expect(assertPublicUrl('http://[::1]/', { lookup: pub })).rejects.toThrow(/ssrf_blocked/)
    await expect(assertPublicUrl('https://teatro.cl:8443/', { lookup: pub })).rejects.toThrow(/puerto/)
    await expect(assertPublicUrl('http://localhost/', { lookup: pub })).rejects.toThrow(/ssrf_blocked/)
    await expect(assertPublicUrl('https://evil.cl/', { lookup: async () => [{ address: '200.1.2.3' }, { address: '10.0.0.5' }] })).rejects.toThrow(/no pública/)
    await expect(assertPublicUrl('https://teatro.cl/contacto', { lookup: pub })).resolves.toBeTruthy()
  })

  it('una redirección a una IP interna se corta antes del fetch', async () => {
    const lookup = async (host) => (host === 'evil.cl' ? [{ address: '200.1.2.3' }] : [{ address: '169.254.169.254' }])
    const calls = recordFetch((url) => (url.startsWith('https://evil.cl')
      ? new Response('', { status: 302, headers: { location: 'http://metadata.evil-internal.cl/latest/meta-data/' } })
      : new Response('secreto', { status: 200, headers: { 'content-type': 'text/plain' } })))
    const r = await crawlSite('https://evil.cl', { lookup })
    expect(r.pages).toHaveLength(0)
    expect(calls.every((c) => c.url.startsWith('https://evil.cl'))).toBe(true)
  })

  it('máximo 3 redirecciones', async () => {
    const lookup = async () => [{ address: '200.1.2.3' }]
    let n = 0
    const calls = recordFetch(() => new Response('', { status: 301, headers: { location: `https://teatro.cl/r${++n}` } }))
    expect(await loadRobots('https://teatro.cl', { lookup })).toEqual([{ path: '/', allow: false }])
    expect(calls).toHaveLength(4) // original + 3 saltos
  })
})

describe('robots.txt (RFC 9309)', () => {
  const lookup = async () => [{ address: '200.1.2.3' }]
  const robotsWith = (status) => { recordFetch(() => new Response('x', { status, headers: { 'content-type': 'text/plain' } })) }

  it('5xx, 429, 401 y 403 → Disallow: /', async () => {
    for (const status of [500, 503, 429, 401, 403]) {
      robotsWith(status)
      expect(await loadRobots('https://teatro.cl', { lookup }), String(status)).toEqual([{ path: '/', allow: false }])
    }
  })
  it('404/410 → sin reglas', async () => {
    for (const status of [404, 410]) {
      robotsWith(status)
      expect(await loadRobots('https://teatro.cl', { lookup })).toEqual([])
    }
  })
  it('error de red → Disallow: / y crawlSite lo marca como no disponible (reintentable)', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('ECONNRESET') })
    expect(await loadRobots('https://teatro.cl', { lookup })).toEqual([{ path: '/', allow: false }])
    expect(await crawlSite('https://teatro.cl', { lookup })).toMatchObject({ pages: [], robotsUnavailable: true })
  })
})

describe('/web-gratis: doble opt-in', () => {
  const victim = { id: 'victim', email: 'contacto@productora-x.cl', domain: 'productora-x.cl', org_name: 'X', status: 'suppressed', source_refs: [], consent_at: null, lawful_basis: 'legitimate_interest_b2b' }

  it('el envío del formulario no toca el lead existente', async () => {
    const supabase = createFakeSupabase({ tables: { aitickets_leads: [{ ...victim }], aitickets_outreach_events: [] } })
    const id = await createInboundPending(supabase, { email: 'Contacto@productora-x.cl', orgName: 'Atacante' })
    expect(id).toBeTruthy()
    expect(supabase.tables.aitickets_leads[0]).toMatchObject({ status: 'suppressed', consent_at: null, lawful_basis: 'legitimate_interest_b2b' })
    expect(supabase.tables.aitickets_outreach_events[0]).toMatchObject({ type: 'inbound_pending' })
  })

  it('al confirmar: consentimiento registrado, pero un lead suprimido sigue suprimido; idempotente', async () => {
    const supabase = createFakeSupabase({ tables: { aitickets_leads: [{ ...victim }], aitickets_outreach_events: [] } })
    const id = await createInboundPending(supabase, { email: 'contacto@productora-x.cl', orgName: 'X' })
    expect(await confirmInboundPending(supabase, { pendingId: id, email: 'otra@x.cl' })).toBeNull()
    const r = await confirmInboundPending(supabase, { pendingId: id, email: 'contacto@productora-x.cl' })
    expect(r).toMatchObject({ leadId: 'victim', created: false })
    expect(supabase.tables.aitickets_leads[0]).toMatchObject({ status: 'suppressed', lawful_basis: 'consent' })
    expect(await confirmInboundPending(supabase, { pendingId: id, email: 'contacto@productora-x.cl' })).toMatchObject({ leadId: 'victim', alreadyConfirmed: true })
  })

  it('token de confirmación firmado, con propósito propio', () => {
    vi.stubEnv('LEAD_TOKEN_SECRET', 'secreto')
    const t = signInboundConfirmToken('123', 'A@B.cl')
    expect(verifyInboundConfirmToken(t)).toEqual({ pendingId: '123', email: 'a@b.cl' })
  })
})
