// Liberación condicionada de fondos (ledger.ts), score de riesgo (event-risk.mjs), documentos del evento,
// devolución directa desde admin y acreditación de funciones.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { computeOrgLedger, CHECKIN_RELEASE_THRESHOLD } = await import('../../src/lib/producer-api/ledger.ts')
const { scoreEventRisk, refreshEventRisk } = await import('../../netlify/lib/event-risk.mjs')
const { permitStatusFor, missingDocumentKinds } = await import('../../src/lib/eventDocuments.ts')
const { checkAdminSecret, directRefundEvent } = await import('../../src/lib/adminDirectRefund.ts')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')

const DAY = 86400000
const iso = (ms) => new Date(Date.now() + ms).toISOString()
const chileDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(Date.now() + ms))

function seed({ org = {}, account = {}, event = {}, attendees, tables = {} } = {}) {
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, created_at: iso(-400 * DAY), identity_status: 'approved', identity_verified_at: iso(-30 * DAY), ...org }],
      organization_payout_accounts: [{ organization_id: 7, verified_at: iso(-10 * DAY), removed_at: null, holder_match_status: 'match', ...account }],
      events: [{ id: 40, name: 'Festival', status: 'published', organization_id: 7, end_date: null, fee_absorbed: false, reserve_pct: 0, ...event }],
      event_dates: [{ id: 401, event_id: 40, date: chileDate(-4 * DAY), start_time: '20:00', end_time: '23:00' }],
      event_tickets: [{ id: 1, event_id: 40, event_date_id: 401 }],
      event_orders: [
        { id: 'a', event_id: 40, status: 'paid', amount: 10000, ticket_qty: 1 },
        { id: 'b', event_id: 40, status: 'paid', amount: 10000, ticket_qty: 1 },
      ],
      event_attendees: attendees || [
        { event_id: 40, event_order_id: 'a', event_ticket_id: 1, status: 'validated', validated_at: iso(-4 * DAY) },
        { event_id: 40, event_order_id: 'b', event_ticket_id: 1, status: 'active', validated_at: null },
      ],
      aitickets_refunds: [],
      event_withdrawals: [],
      aitickets_disputes: [],
      aitickets_api_audit: [],
      aitickets_api_confirmations: [],
      aitickets_api_idempotency: [],
      ...tables,
    },
  })
}

beforeEach(() => seed())

describe('liberación condicionada', () => {
  it('con todo en regla libera la función', async () => {
    const l = await computeOrgLedger(db, 7)
    expect(l.events[0]).toMatchObject({ available: 20000, held: 0, pending: 0 })
    expect(l.events[0].functions[0]).toMatchObject({ release_status: 'released', released: true, checkins: 1, checkin_ratio: 0.5 })
    expect(l.hold_reasons).toEqual([])
  })

  it('identidad sin aprobar retiene todo con motivo visible', async () => {
    seed({ org: { identity_status: 'pending', identity_verified_at: null } })
    const l = await computeOrgLedger(db, 7)
    expect(l.events[0]).toMatchObject({ available: 0, held: 20000, retained: 20000 })
    expect(l.hold_reasons.map((r) => r.code)).toEqual(['identity_pending'])
    expect(l.events[0].functions[0].release_status).toBe('held')
  })

  it('cuenta sin verificar o titular distinto retienen', async () => {
    seed({ account: { verified_at: null } })
    expect((await computeOrgLedger(db, 7)).hold_reasons.map((r) => r.code)).toEqual(['bank_unverified'])
    seed({ account: { holder_match_status: 'mismatch' } })
    expect((await computeOrgLedger(db, 7)).hold_reasons.map((r) => r.code)).toEqual(['holder_mismatch'])
    seed({ account: { holder_match_status: null } })
    expect((await computeOrgLedger(db, 7)).hold_reasons.map((r) => r.code)).toEqual(['holder_unchecked'])
  })

  it(`check-ins bajo ${CHECKIN_RELEASE_THRESHOLD * 100}% retienen hasta que el productor acredite la función`, async () => {
    seed({
      attendees: [
        { event_id: 40, event_order_id: 'a', event_ticket_id: 1, status: 'active' },
        { event_id: 40, event_order_id: 'b', event_ticket_id: 1, status: 'active' },
      ],
    })
    let l = await computeOrgLedger(db, 7)
    expect(l.events[0]).toMatchObject({ available: 0, held: 20000 })
    expect(l.events[0].functions[0].hold_reasons.map((r) => r.code)).toEqual(['low_checkins'])

    db.tables.event_dates[0].held_attested_at = iso(-1 * DAY)
    l = await computeOrgLedger(db, 7)
    expect(l.events[0]).toMatchObject({ available: 20000, held: 0 })
  })

  it('un contracargo abierto retiene la función', async () => {
    seed({ tables: { aitickets_disputes: [{ id: 'd1', event_id: 40, event_date_id: 401, order_id: 'a', status: 'open' }] } })
    const l = await computeOrgLedger(db, 7)
    expect(l.events[0].hold_reasons.map((r) => r.code)).toContain('open_disputes')
    expect(l.events[0].available).toBe(0)
    db.tables.aitickets_disputes[0].status = 'won'
    expect((await computeOrgLedger(db, 7)).events[0].available).toBe(20000)
  })

  it('reserva por riesgo: retiene el % hasta 60 días después de la función y luego libera', async () => {
    seed({ event: { reserve_pct: 30, risk_level: 'medium' } })
    let l = (await computeOrgLedger(db, 7)).events[0]
    expect(l).toMatchObject({ available: 14000, reserve_amount: 6000, held: 6000, pending: 0 })
    expect(l.reserve_release_at).toBeTruthy()
    expect(l.functions[0].release_status).toBe('held')

    db.tables.event_dates[0].date = chileDate(-70 * DAY)
    l = (await computeOrgLedger(db, 7)).events[0]
    expect(l).toMatchObject({ available: 20000, reserve_amount: 0, held: 0 })
  })

  it('funciones por realizarse siguen pendientes (no retenidas)', async () => {
    seed({ org: { identity_status: null }, tables: { event_dates: [{ id: 401, event_id: 40, date: chileDate(5 * DAY), start_time: '20:00' }] } })
    const l = (await computeOrgLedger(db, 7)).events[0]
    expect(l).toMatchObject({ available: 0, held: 0, pending: 20000 })
  })
})

describe('score de riesgo', () => {
  it('productor con historial, dirección y aforo chico: bajo, sin reserva', () => {
    const r = scoreEventRisk({ orgCreatedAt: iso(-400 * DAY), priorHeldEvents: 3, hasExactAddress: true, capacity: 200, potentialAmount: 2_000_000 })
    expect(r).toMatchObject({ level: 'low', reserve_pct: 0, requires_documents: false, signals: [] })
  })

  it('productor nuevo: medio (30%)', () => {
    const r = scoreEventRisk({ orgCreatedAt: iso(-5 * DAY), priorHeldEvents: 0, hasExactAddress: true, capacity: 200 })
    expect(r).toMatchObject({ level: 'medium', reserve_pct: 30 })
    expect(r.signals.map((s) => s.code)).toEqual(['new_producer'])
  })

  it('nuevo + masivo + sin dirección: alto (100%) y exige documentos', () => {
    const r = scoreEventRisk({ orgCreatedAt: iso(-5 * DAY), priorHeldEvents: 0, hasExactAddress: false, capacity: 3000, isMassive: true })
    expect(r).toMatchObject({ level: 'high', reserve_pct: 100, requires_documents: true })
  })

  it('pico de ventas y teléfono compartido suman señales', () => {
    const r = scoreEventRisk({ priorHeldEvents: 2, orgCreatedAt: iso(-400 * DAY), ticketsLast24h: 120, avgDailyTicketsBefore: 5, maxEmailsPerPhone: 6 })
    expect(r.signals.map((s) => s.code)).toEqual(['sales_spike', 'shared_buyer'])
  })

  it('refreshEventRisk guarda el resultado y respeta risk_locked', async () => {
    seed({ org: { created_at: iso(-3 * DAY) }, tables: { event_locations: [], venues: [] } })
    const r = await refreshEventRisk(db, 40)
    expect(r.level).not.toBe('low')
    expect(db.tables.events[0]).toMatchObject({ risk_level: r.level, reserve_pct: r.reserve_pct })

    db.tables.events[0] = { ...db.tables.events[0], risk_locked: true, reserve_pct: 0, risk_level: 'low' }
    const locked = await refreshEventRisk(db, 40)
    expect(locked.locked).toBe(true)
    expect(db.tables.events[0].reserve_pct).toBe(0)
  })
})

describe('documentos y autorización', () => {
  it('evento masivo sin autorización aprobada: en trámite', () => {
    expect(permitStatusFor({ is_massive: true }, [])).toBe('pending')
    expect(permitStatusFor({ is_massive: true }, [{ kind: 'delegacion_presidencial', status: 'approved', created_at: iso(0) }])).toBe('approved')
    expect(permitStatusFor({ is_massive: false }, [])).toBe('none')
    expect(
      permitStatusFor({ is_massive: true }, [
        { kind: 'delegacion_presidencial', status: 'approved', created_at: iso(-2 * DAY) },
        { kind: 'delegacion_presidencial', status: 'rejected', created_at: iso(-1 * DAY) },
      ]),
    ).toBe('rejected')
  })

  it('documentos faltantes según masivo / exige documentos', () => {
    expect(missingDocumentKinds({ is_massive: true }, [{ kind: 'venue_permit', status: 'pending', created_at: iso(0) }])).toEqual(['delegacion_presidencial', 'rc_insurance'])
    expect(missingDocumentKinds({ requires_documents: true }, [])).toEqual(['venue_permit', 'rc_insurance'])
    expect(missingDocumentKinds({}, [])).toEqual([])
  })
})

describe('devolución directa (admin)', () => {
  const req = (secret) => new Request('https://aitickets.cl/api/admin/events/direct-refund', { method: 'POST', headers: secret ? { 'x-admin-secret': secret } : {} })
  const SECRET = 'x'.repeat(32)

  it('exige ADMIN_API_SECRET de largo mínimo y lo compara', () => {
    expect(checkAdminSecret(req(SECRET), undefined)).toBe('disabled')
    expect(checkAdminSecret(req('corto'), 'corto')).toBe('disabled')
    expect(checkAdminSecret(req(), SECRET)).toBe('unauthorized')
    expect(checkAdminSecret(req('y'.repeat(32)), SECRET)).toBe('unauthorized')
    expect(checkAdminSecret(req(SECRET), SECRET)).toBe('ok')
  })

  it('rechaza códigos de motivo desconocidos', async () => {
    await expect(
      directRefundEvent({ supabase: db, eventId: 40, reasonCode: 'porque_si', admin: 'ops', requestUrl: new URL('https://aitickets.cl'), origin: 'https://aitickets.cl' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('dry run devuelve el resumen sin cancelar nada', async () => {
    const out = await directRefundEvent({
      supabase: db,
      eventId: 40,
      reasonCode: 'fraud',
      admin: 'ops',
      dryRun: true,
      requestUrl: new URL('https://aitickets.cl'),
      origin: 'https://aitickets.cl',
    })
    expect(out.dry_run).toBe(true)
    expect(out.summary.details.paid_orders).toBe(2)
    expect(db.tables.events[0].cancelled_at).toBeUndefined()
    expect(db.tables.aitickets_refunds).toHaveLength(0)
  })
})

describe('acreditar función', () => {
  const ctx = (role = 'producer') => ({
    supabase: db,
    actor: { keyId: null, userId: 1, orgId: 7, role, name: 'Ana', email: 'ana@prod.cl', scopes: ['read', 'write', 'publish', 'attendees', 'finance', 'team'], eventIds: null },
    origin: 'https://aitickets.cl',
    requestUrl: new URL('https://aitickets.cl/api/events/attest'),
    channel: 'dashboard',
  })

  it('marca la función, queda en la bitácora y libera lo retenido por check-ins', async () => {
    seed({ attendees: [{ event_id: 40, event_order_id: 'a', event_ticket_id: 1, status: 'active' }, { event_id: 40, event_order_id: 'b', event_ticket_id: 1, status: 'active' }] })
    const out = await runTool(getTool('attest_function_held'), { event_id: 40, event_date_id: 401, note: 'Asistieron ~200 personas; fotos en IG' }, ctx())
    expect(out.ok).toBe(true)
    expect(db.tables.event_dates[0].held_attested_at).toBeTruthy()
    expect(out.result.available_now).toBe(20000)
    expect(db.tables.aitickets_api_audit.at(-1)).toMatchObject({ tool: 'attest_function_held', ok: true })
  })

  it('no permite acreditar una función futura ni a un rol sin finance.manage', async () => {
    seed({ tables: { event_dates: [{ id: 401, event_id: 40, date: chileDate(3 * DAY), start_time: '20:00' }] } })
    expect(await runTool(getTool('attest_function_held'), { event_id: 40, event_date_id: 401, note: 'ya fue' }, ctx())).toMatchObject({ ok: false, code: 'conflict' })
    expect(await runTool(getTool('attest_function_held'), { event_id: 40, event_date_id: 401, note: 'ya fue' }, ctx('editor'))).toMatchObject({ ok: false, code: 'forbidden' })
  })
})
