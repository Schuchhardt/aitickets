// Identidad del productor (Didit) y titular de la cuenta = identidad verificada.
// netlify/lib/identity.mjs (lógica pura), src/lib/producerIdentity.ts (BD), la regla de publicación en
// setEventStatus y el bloqueo de retiros en request_payout.
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import {
  canonicalJson,
  computeHolderMatch,
  extractIdentity,
  mapDiditStatus,
  namesOverlap,
  normalizeRut,
  orgIdFromVendorData,
  vendorDataFor,
  verifyDiditWebhook,
  createDiditSession,
  diditConfig,
} from '../../netlify/lib/identity.mjs'

let db
const slack = []
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/pages/api/_lib/server-utils', async (importOriginal) => ({
  ...(await importOriginal()),
  notifySlack: async (text) => {
    slack.push(text)
  },
}))

const { applyDiditDecision, recomputeHolderMatch, identityPublishBlocker, paidCapacity, ticketsRequireIdentity } = await import('../../src/lib/producerIdentity.ts')
const { setEventStatus, EventInputError } = await import('../../src/pages/api/_lib/events.ts')

describe('RUT', () => {
  it('normaliza y valida el dígito verificador', () => {
    expect(normalizeRut('12.345.678-5')).toBe('12345678-5')
    expect(normalizeRut('123456785')).toBe('12345678-5')
    expect(normalizeRut('76.123.456-0')).toBe('76123456-0')
    expect(normalizeRut('11.111.111-1')).toBe('11111111-1')
    expect(normalizeRut('12.345.678-9')).toBeNull() // DV incorrecto
    expect(normalizeRut('abc')).toBeNull()
    expect(normalizeRut('')).toBeNull()
  })
  it('DV K en mayúscula', () => {
    // 10.000.013-K
    expect(normalizeRut('10000013-k')).toBe('10000013-K')
  })
})

describe('titular de la cuenta = identidad verificada', () => {
  const org = { identity_status: 'approved', identity_rut: '12345678-5', identity_name: 'ANA MARÍA PÉREZ SOTO', legal_id: '76.123.456-0' }
  it('coincide con la persona verificada (nombre laxo)', () => {
    expect(computeHolderMatch(org, { bank_account_rut: '12.345.678-5', bank_account_holder: 'Ana Perez' }).status).toBe('match')
    expect(namesOverlap('Ana Perez', 'ANA MARÍA PÉREZ SOTO')).toBe(true)
  })
  it('coincide con la empresa que representa', () => {
    expect(computeHolderMatch(org, { bank_account_rut: '76123456-0', bank_account_holder: 'Productora SpA' }).status).toBe('match')
  })
  it('cuenta de un tercero => mismatch', () => {
    expect(computeHolderMatch(org, { bank_account_rut: '11.111.111-1', bank_account_holder: 'Juan Tercero' }).status).toBe('mismatch')
  })
  it('mismo RUT con otro nombre => mismatch', () => {
    expect(computeHolderMatch(org, { bank_account_rut: '12345678-5', bank_account_holder: 'Juan Tercero' }).status).toBe('mismatch')
  })
  it('sin identidad aprobada o sin cuenta => pending', () => {
    expect(computeHolderMatch({ ...org, identity_status: 'pending' }, { bank_account_rut: '12345678-5' }).status).toBe('pending')
    expect(computeHolderMatch(org, null).status).toBe('pending')
  })
})

describe('Didit: estados, decisión y vendor_data', () => {
  it('mapea estados', () => {
    expect(mapDiditStatus('Approved')).toBe('approved')
    expect(mapDiditStatus('Declined')).toBe('declined')
    expect(mapDiditStatus('In Review')).toBe('in_review')
    expect(mapDiditStatus('In Progress')).toBe('pending')
    expect(mapDiditStatus('Expired')).toBe('declined')
    expect(mapDiditStatus('???')).toBeNull()
  })
  it('extrae nombre y RUN de id_verifications (v3) o id_verification (v2)', () => {
    expect(extractIdentity({ id_verifications: [{ status: 'Approved', first_name: 'Ana', last_name: 'Pérez', document_number: 'A123', personal_number: '12.345.678-5' }] })).toEqual({
      name: 'Ana Pérez',
      rut: '12345678-5',
    })
    expect(extractIdentity({ id_verification: { full_name: 'Ana Pérez', document_number: '123456785' } })).toEqual({ name: 'Ana Pérez', rut: '12345678-5' })
    expect(extractIdentity({})).toEqual({ name: null, rut: null })
  })
  it('vendor_data ida y vuelta', () => {
    expect(orgIdFromVendorData(vendorDataFor(7))).toBe(7)
    expect(orgIdFromVendorData('user:7')).toBeNull()
  })
})

describe('firma del webhook', () => {
  const secret = 'whsec_test'
  const body = { session_id: 's1', status: 'Approved', vendor_data: 'org:7', decision: { b: 1, a: 'ñandú' } }
  const raw = JSON.stringify(body)
  const now = Date.now()
  const ts = String(Math.floor(now / 1000))

  it('X-Signature-V2 sobre JSON canónico', () => {
    expect(canonicalJson(body)).toBe('{"decision":{"a":"ñandú","b":1},"session_id":"s1","status":"Approved","vendor_data":"org:7"}')
    const sig = createHmac('sha256', secret).update(canonicalJson(body)).digest('hex')
    const out = verifyDiditWebhook({ rawBody: raw, headers: { 'x-signature-v2': sig, 'x-timestamp': ts }, secret, now })
    expect(out.ok).toBe(true)
    expect(out.payload.session_id).toBe('s1')
  })
  it('X-Signature sobre el body crudo (Headers)', () => {
    const sig = createHmac('sha256', secret).update(raw).digest('hex')
    expect(verifyDiditWebhook({ rawBody: raw, headers: new Headers({ 'X-Signature': sig, 'X-Timestamp': ts }), secret, now }).ok).toBe(true)
  })
  it('rechaza firma inválida, timestamp viejo o sin secreto', () => {
    const sig = createHmac('sha256', secret).update(canonicalJson(body)).digest('hex')
    expect(verifyDiditWebhook({ rawBody: raw, headers: { 'x-signature-v2': 'deadbeef', 'x-timestamp': ts }, secret, now }).ok).toBe(false)
    expect(verifyDiditWebhook({ rawBody: raw, headers: { 'x-signature-v2': sig, 'x-timestamp': String(Math.floor(now / 1000) - 3600) }, secret, now }).ok).toBe(false)
    expect(verifyDiditWebhook({ rawBody: raw, headers: { 'x-signature-v2': sig }, secret: '', now }).ok).toBe(false)
  })
})

describe('cliente Didit', () => {
  it('sin configuración no llama a la red', async () => {
    const fetchImpl = vi.fn()
    await expect(createDiditSession({ orgId: 7, callback: 'x', config: diditConfig(() => ''), fetchImpl })).rejects.toMatchObject({ code: 'not_configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('crea la sesión con x-api-key, workflow y vendor_data', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ session_id: 'sess1', url: 'https://verify.didit.me/x' }), { status: 201 }))
    const config = diditConfig((n) => ({ DIDIT_API_KEY: 'k', DIDIT_WORKFLOW_ID: 'wf' })[n] || '')
    const out = await createDiditSession({ orgId: 7, callback: 'https://aitickets.cl/dashboard/settings', config, fetchImpl })
    expect(out).toMatchObject({ sessionId: 'sess1', url: 'https://verify.didit.me/x' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://verification.didit.me/v3/session/')
    expect(init.headers['x-api-key']).toBe('k')
    expect(JSON.parse(init.body)).toMatchObject({ workflow_id: 'wf', vendor_data: 'org:7' })
  })
})

function seed({ identity = {}, account = {}, tickets = [{ id: 1, event_id: 10, price: 5000, is_gift: false }] } = {}) {
  slack.length = 0
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Mi Productora', legal_id: null, identity_status: null, identity_session_id: 'sess1', ...identity }],
      organization_payout_accounts: [{ organization_id: 7, bank_account_rut: '12.345.678-5', bank_account_holder: 'Ana Pérez', holder_match_status: null, ...account }],
      events: [{ id: 10, name: 'Fiesta', status: 'draft', accessibility: 'public', organization_id: 7, start_date: '2026-12-01T22:00:00Z' }],
      event_dates: [],
      event_tickets: tickets,
    },
  })
}

describe('decisión de Didit en la organización', () => {
  beforeEach(() => seed())
  it('aprobada: guarda nombre y RUT (sin imágenes) y recalcula el titular', async () => {
    const status = await applyDiditDecision(db, 7, {
      sessionId: 'sess1',
      status: 'Approved',
      decision: { id_verifications: [{ status: 'Approved', first_name: 'Ana', last_name: 'Pérez', personal_number: '12345678-5', front_image: 'https://x' }] },
    })
    expect(status).toBe('approved')
    const org = db.tables.organizations[0]
    expect(org).toMatchObject({ identity_status: 'approved', identity_name: 'Ana Pérez', identity_rut: '12345678-5', identity_kind: 'person' })
    expect(org.identity_verified_at).toBeTruthy()
    expect(JSON.stringify(org)).not.toContain('front_image')
    expect(db.tables.organization_payout_accounts[0].holder_match_status).toBe('match')
  })
  it('aprobada sin RUN legible => en revisión manual', async () => {
    const status = await applyDiditDecision(db, 7, { sessionId: 'sess1', status: 'Approved', decision: { id_verifications: [{ status: 'Approved', full_name: 'Ana' }] } })
    expect(status).toBe('in_review')
    expect(slack.some((t) => t.includes('RUN'))).toBe(true)
  })
  it('una sesión vieja no pisa la vigente', async () => {
    expect(await applyDiditDecision(db, 7, { sessionId: 'otra', status: 'Declined' })).toBeNull()
    expect(db.tables.organizations[0].identity_status).toBeNull()
  })
  it('cuenta de un tercero => mismatch y aviso a Slack', async () => {
    seed({ identity: { identity_status: 'approved', identity_rut: '12345678-5', identity_name: 'Ana Pérez' }, account: { bank_account_rut: '11.111.111-1', bank_account_holder: 'Juan' } })
    expect((await recomputeHolderMatch(db, 7)).status).toBe('mismatch')
    expect(db.tables.organization_payout_accounts[0].holder_match_status).toBe('mismatch')
    expect(slack.some((t) => t.includes('Titular'))).toBe(true)
  })
})

describe('publicar exige identidad verificada si hay entradas pagadas', () => {
  const ev = { id: 10, status: 'draft', accessibility: 'public', start_date: '2026-12-01T22:00:00Z' }
  it('bloquea evento pagado sin identidad', async () => {
    seed()
    expect(await identityPublishBlocker(db, 7, 10)).toMatch(/verificar tu identidad/)
    await expect(setEventStatus(ev, 7, 'published')).rejects.toBeInstanceOf(EventInputError)
    expect(db.tables.events[0].status).toBe('draft')
  })
  it('evento pagado de hasta 10 cupos se publica sin identidad', async () => {
    seed({ tickets: [{ id: 1, event_id: 10, price: 5000, is_gift: false, total_quantity: 10 }] })
    await setEventStatus(ev, 7, 'published')
    expect(db.tables.events[0].status).toBe('published')
  })
  it('evento gratuito se publica sin identidad', async () => {
    seed({ tickets: [{ id: 1, event_id: 10, price: 0, is_gift: false }] })
    await setEventStatus(ev, 7, 'published')
    expect(db.tables.events[0].status).toBe('published')
  })
  it('con identidad aprobada se publica', async () => {
    seed({ identity: { identity_status: 'approved', identity_rut: '12345678-5' } })
    await setEventStatus(ev, 7, 'published')
    expect(db.tables.events[0].status).toBe('published')
  })
  it('pasar a borrador nunca se bloquea', async () => {
    seed()
    await setEventStatus({ ...ev, status: 'published' }, 7, 'draft')
    expect(db.tables.events[0].status).toBe('draft')
  })
})

describe('umbral de 10 cupos pagados', () => {
  it('suma solo entradas pagadas sin cortesías; sin límite = null', () => {
    expect(paidCapacity([{ price: 5000, total_quantity: 6 }, { price: 0, total_quantity: 500 }, { price: 3000, total_quantity: 4, is_gift: true }])).toBe(6)
    expect(paidCapacity([{ price: 5000, total_quantity: null }])).toBeNull()
  })
  it('hasta 10 cupos pagados no exige identidad; más de 10 o sin límite sí', () => {
    expect(ticketsRequireIdentity([{ price: 0, total_quantity: null }])).toBe(false)
    expect(ticketsRequireIdentity([{ price: 5000, total_quantity: 4 }, { price: 8000, total_quantity: 6 }])).toBe(false)
    expect(ticketsRequireIdentity([{ price: 5000, total_quantity: 11 }])).toBe(true)
    expect(ticketsRequireIdentity([{ price: 5000, total_quantity: null }])).toBe(true)
  })
})
