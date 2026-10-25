// MCP de administración: finanzas de plataforma, flujo de retiros (datos para transferir → registrar pagado →
// aviso al productor), reembolsos, verificación de cuentas, moderación, perfil, notas, ayuda para entrar y bandeja.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const sent = []
let failEmail = false
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))
vi.mock('../../netlify/lib/mailer.mjs', async (orig) => {
  const real = await orig()
  return {
    ...real,
    sendEmail: vi.fn(async (msg) => {
      if (failEmail) throw new Error('Resend 500: caído')
      sent.push(msg)
      return { id: 'em_1' }
    }),
  }
})
const verificationSent = []
const magicSent = []
vi.mock('../../src/lib/email-verification', () => ({
  getOrgVerification: async (orgId) => ({ verified: orgId === 8 ? false : true, termsAcceptedAt: null }),
  sendVerificationEmail: async (msg) => verificationSent.push(msg),
}))
vi.mock('../../src/lib/magic-link', () => ({
  isAiticketsIdentity: () => true,
  reserveAuthLinkSend: async () => true,
  sendMagicLinkEmail: async (msg) => magicSent.push(msg),
}))

const { generateAdminKey } = await import('../../src/lib/admin-api/auth.ts')
const { resetSupportUserCache } = await import('../../src/lib/admin-api/context.ts')
const { getAdminTool } = await import('../../src/lib/admin-api/tools/index.ts')
const { runAdminTool } = await import('../../src/lib/admin-api/registry.ts')
const { payoutSlackSql } = await import('../../src/lib/producer-api/tools/finance.ts')
const adminRoute = await import('../../src/pages/api/admin/mcp.ts')

const SITE = 'https://aitickets.cl'
const DAY = 86400000
const iso = (ms) => new Date(Date.now() + ms).toISOString()
const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const R1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REV = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

// Emula las funciones de 202610270100_payout_ops.sql (lo que importa aquí: transiciones, force y el trigger)
function setPayoutStatus({ p_payout_id, p_status, p_reference, p_failure_reason, p_actor, p_force }, state) {
  const p = state.aitickets_payouts.find((r) => r.id === p_payout_id)
  if (!p) throw new Error(`No existe el retiro ${p_payout_id}`)
  if (p.status === p_status) return { payout_id: p.id, organization_id: p.organization_id, amount: p.amount, status: p.status, reference: p.reference, changed: false }
  if (!['requested', 'processing'].includes(p.status)) throw new Error(`El retiro está '${p.status}'`)
  if (p_status === 'paid') {
    if (!p_reference) throw new Error('Indica p_reference')
    const acc = state.organization_payout_accounts.find((a) => a.organization_id === p.organization_id)
    if (!p_force && (!acc?.verified_at)) throw new Error('La cuenta bancaria no está verificada')
  }
  Object.assign(p, { status: p_status, reference: p_reference ?? p.reference, failure_reason: p_failure_reason ?? p.failure_reason, processed_by: p_actor, paid_at: p_status === 'paid' ? new Date().toISOString() : p.paid_at })
  for (const w of state.event_withdrawals) if (w.payout_id === p.id) w.status = p_status
  return { payout_id: p.id, organization_id: p.organization_id, amount: p.amount, status: p.status, paid_at: p.paid_at, reference: p.reference, failure_reason: p.failure_reason, processed_by: p.processed_by, changed: true }
}

let full
let readonly
beforeEach(() => {
  sent.length = 0
  verificationSent.length = 0
  magicSent.length = 0
  failEmail = false
  full = generateAdminKey()
  readonly = generateAdminKey()
  process.env.SITE_URL = SITE
  process.env.ADMIN_MCP_ENABLED = 'true'
  process.env.AITICKETS_ADMIN_KEY_SHA256 = full.hash
  process.env.AITICKETS_ADMIN_READONLY_KEY_SHA256 = readonly.hash
  resetSupportUserCache()
  db = createFakeSupabase({
    tables: {
      aitickets_platform_settings: [{ key: 'support_user_id', value: 900 }],
      organizations: [
        { id: 7, public_name: 'Productora Siete', email: 'contacto@siete.cl', legal_name: null, legal_id: null, phone: null, website: null, instagram: null, facebook: null, tiktok: null, email_verified_at: iso(-100 * DAY) },
        { id: 8, public_name: 'Ocho Eventos', email: 'ocho@ocho.cl', email_verified_at: null },
      ],
      users: [
        { id: 1, name: 'Ana Pérez', email: 'ana@siete.cl', organization_id: 7, role: 'producer', active: true, auth_user_id: 'auth-ana' },
        { id: 2, name: 'Oscar', email: 'oscar@ocho.cl', organization_id: 8, role: 'producer', active: true, auth_user_id: 'auth-oscar' },
        { id: 3, name: 'Sin cuenta', email: 'sin@siete.cl', organization_id: 7, role: 'viewer', active: true, auth_user_id: null },
      ],
      organization_payout_accounts: [
        { organization_id: 7, bank_name: 'BancoEstado', bank_account_type: 'Cuenta Vista / CuentaRUT', bank_account_number: '000123456789', bank_account_holder: 'Ana Pérez', bank_account_rut: '12.345.678-9', verified_at: iso(-50 * DAY), bank_changed_at: iso(-60 * DAY), updated_at: iso(-60 * DAY) },
        { organization_id: 8, bank_name: 'Santander', bank_account_type: 'Cuenta Corriente', bank_account_number: '9876543210', bank_account_holder: 'Oscar Díaz', bank_account_rut: '11.111.111-1', verified_at: null, bank_changed_at: iso(-1 * DAY), updated_at: iso(-1 * DAY) },
      ],
      aitickets_payouts: [
        { id: P1, organization_id: 7, amount: 150000, status: 'requested', bank_name: 'BancoEstado', bank_account_type: 'Cuenta Vista / CuentaRUT', bank_account_last4: '6789', requested_via: 'dashboard', created_at: iso(-3 * DAY), reference: null, failure_reason: null },
        { id: P2, organization_id: 8, amount: 50000, status: 'requested', bank_name: 'Santander', bank_account_last4: '3210', requested_via: 'mcp', created_at: iso(-2 * DAY), reference: null, failure_reason: null },
      ],
      event_withdrawals: [
        { id: 1, payout_id: P1, event_id: 10, amount: 150000, status: 'requested', account_number: '•••• 6789' },
        { id: 2, payout_id: P2, event_id: 11, amount: 50000, status: 'requested', account_number: '•••• 3210' },
      ],
      events: [
        { id: 10, name: 'Fiesta Siete', slug: 'fiesta-siete', status: 'published', organization_id: 7, start_date: iso(-20 * DAY), end_date: iso(-20 * DAY + 3600000), created_at: iso(-60 * DAY) },
        { id: 11, name: 'Concierto Ocho', slug: 'concierto-ocho', status: 'published', organization_id: 8, start_date: iso(-10 * DAY), end_date: iso(-10 * DAY + 3600000), created_at: iso(-30 * DAY) },
      ],
      event_orders: [
        { id: 'o1', event_id: 10, status: 'paid', created_at: iso(-25 * DAY), amount: 100000, ticket_fee: 8000, service_fee_tax: 1520, total_payment: 109520, payment_fee: 3000, ticket_qty: 10, ticket_details: [{ name: 'General', quantity: 10, price: 10000 }], payment_provider: 'flow', buyer_email: 'comprador@mail.cl', payment_external_id: 'FLOW-1', email_sent_at: iso(-25 * DAY) },
        { id: 'o2', event_id: 11, status: 'paid', created_at: iso(-12 * DAY), amount: 50000, ticket_fee: 4000, service_fee_tax: 760, total_payment: 54760, payment_fee: 1500, ticket_qty: 5, ticket_details: [{ name: 'General', quantity: 5, price: 10000 }], payment_provider: 'flow', buyer_email: 'otro@mail.cl', payment_external_id: 'FLOW-2', email_sent_at: iso(-12 * DAY) },
        { id: 'o3', event_id: 11, status: 'review', created_at: iso(-1 * DAY), amount: 10000, total_payment: 10952, payment_external_id: 'FLOW-3' },
        { id: 'o4', event_id: 10, status: 'paid', created_at: iso(-2 * DAY), amount: 10000, ticket_fee: 800, service_fee_tax: 152, total_payment: 10952, payment_fee: 300, ticket_qty: 1, ticket_details: [{ name: 'General', quantity: 1, price: 10000 }], payment_provider: 'flow', email_sent_at: null },
      ],
      aitickets_refunds: [
        { id: R1, organization_id: 7, event_id: 10, order_id: 'o1', kind: 'partial', ticket_amount: 10000, fee_amount: 952, total_amount: 10952, source: 'refund_order', status: 'requested', requested_via: 'mcp', created_at: iso(-1 * DAY) },
      ],
      aitickets_event_reviews: [{ id: REV, event_id: 10, organization_id: 7, rating: 1, public_comment: 'malo', public_status: 'visible', email: 'x@y.cl', verified_via: 'order', created_at: iso(-5 * DAY) }],
      aitickets_event_review_photos: [],
      aitickets_admin_notes: [],
      aitickets_admin_audit: [],
      aitickets_admin_confirmations: [],
      aitickets_admin_idempotency: [],
      aitickets_outreach_state: [{ key: 'paused', value: { paused: true, reason: 'rebotes', at: iso(-DAY) }, updated_at: iso(-DAY) }],
    },
    unique: { aitickets_admin_idempotency: [['tool', 'idem_key']] },
    rpc: {
      aitickets_set_payout_status: setPayoutStatus,
      aitickets_verify_payout_account: ({ p_organization_id, p_decision, p_verified_by, p_notes, p_expected_last4 }, state) => {
        const acc = state.organization_payout_accounts.find((a) => a.organization_id === p_organization_id)
        if (p_expected_last4 && !acc.bank_account_number.endsWith(p_expected_last4)) throw new Error(`La cuenta registrada termina en ${acc.bank_account_number.slice(-4)} y no en ${p_expected_last4}`)
        Object.assign(acc, { verified_at: p_decision === 'approve' ? new Date().toISOString() : null, verified_by: p_verified_by, verification_notes: p_notes })
        return { organization_id: p_organization_id, decision: p_decision, account_last4: acc.bank_account_number.slice(-4) }
      },
      aitickets_set_refund_status: ({ p_refund_id, p_status, p_provider_reference, p_reason }, state) => {
        const r = state.aitickets_refunds.find((x) => x.id === p_refund_id)
        Object.assign(r, { status: p_status, provider_reference: p_provider_reference, failure_reason: p_reason })
        return { refund_id: r.id, event_id: r.event_id, status: r.status, changed: true }
      },
    },
  })
  db.auth = {
    admin: {
      getUserById: async (id) => ({ data: { user: id === 'auth-ana' ? { id, email: 'ana@siete.cl', app_metadata: { app: 'aitickets' } } : id === 'auth-oscar' ? { id, email: 'oscar@ocho.cl', app_metadata: {} } : null } }),
    },
  }
})

afterEach(() => {
  for (const k of ['SITE_URL', 'ADMIN_MCP_ENABLED', 'AITICKETS_ADMIN_KEY_SHA256', 'AITICKETS_ADMIN_READONLY_KEY_SHA256']) delete process.env[k]
})

const actx = (keyKind = 'full') => ({ supabase: db, origin: SITE, requestUrl: new URL(`${SITE}/api/admin/mcp`), keyKind, fingerprint: 'abcd1234', ipHash: 'f'.repeat(64) })
const run = (name, args, keyKind) => runAdminTool(getAdminTool(name), args, actx(keyKind))
/** Primera llamada (confirmación) y segunda con el token. */
async function confirmAndRun(name, args) {
  const first = await run(name, args)
  expect(first.ok, JSON.stringify(first)).toBe(true)
  expect(first.result.status).toBe('confirmation_required')
  const second = await run(name, { ...args, confirmation_token: first.result.confirmation_token })
  return { first, second }
}

describe('retiros', () => {
  it('list_payout_requests: pendientes con señales, saldo y reparto, del más antiguo al más nuevo', async () => {
    const r = await run('list_payout_requests', {})
    expect(r.ok).toBe(true)
    expect(r.result.payouts.map((p) => p.payout_id)).toEqual([P1, P2])
    const [siete, ocho] = r.result.payouts
    expect(siete).toMatchObject({ organization: { id: 7, name: 'Productora Siete' }, amount_clp: 150000, account_last4: '6789', consistent: true })
    expect(siete.flags).toMatchObject({ account_not_verified: false, account_changed_after_request: false, last4_mismatch: false })
    expect(siete.events[0]).toMatchObject({ event_id: 10, name: 'Fiesta Siete', amount_clp: 150000 })
    expect(ocho.flags).toMatchObject({ account_not_verified: true })
    expect(ocho.warnings.join(' ')).toMatch(/NO está verificada/)
    expect(r.result.open_total_clp).toBe(200000)
    expect(JSON.stringify(r.result)).not.toContain('000123456789')
  })

  it('get_payout_transfer_details: datos completos solo con la llave completa, y queda en la bitácora', async () => {
    const r = await run('get_payout_transfer_details', { payout_id: P1 })
    expect(r.result.transfer).toMatchObject({ bank: 'BancoEstado', account_number: '000123456789', holder_name: 'Ana Pérez', holder_rut: '12.345.678-9', notify_email: 'contacto@siete.cl', suggested_comment: 'AI Tickets retiro 11111111' })
    expect(r.result.amount_clp).toBe(150000)
    expect(r.result.warnings).toEqual([])
    const audit = db.tables.aitickets_admin_audit.at(-1)
    expect(audit).toMatchObject({ tool: 'get_payout_transfer_details', organization_id: 7, target: `payout:${P1}` })
    expect(JSON.stringify(audit)).not.toContain('000123456789')

    const ro = await run('get_payout_transfer_details', { payout_id: P1 }, 'readonly')
    expect(ro).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('mark_payout_paid: exige reason, confirma, registra, avisa al productor por correo y sincroniza el reparto', async () => {
    const noReason = await run('mark_payout_paid', { payout_id: P1, reference: 'TRX-123' })
    expect(noReason).toMatchObject({ ok: false, code: 'invalid_input' })

    const args = { payout_id: P1, reference: 'TRX-123', reason: 'Transferí el retiro pedido por Slack' }
    const first = await run('mark_payout_paid', args)
    expect(first.result.status).toBe('confirmation_required')
    expect(first.result.summary).toMatch(/PAGADO.*150\.000.*TRX-123/)
    expect(db.tables.aitickets_payouts[0].status).toBe('requested') // la primera llamada no ejecuta nada
    expect(sent).toHaveLength(0)
    const second = await run('mark_payout_paid', { ...args, confirmation_token: first.result.confirmation_token })
    expect(second.ok).toBe(true)
    expect(second.result).toMatchObject({ status: 'paid', changed: true, email_sent: true })
    expect(db.tables.aitickets_payouts[0]).toMatchObject({ status: 'paid', reference: 'TRX-123', processed_by: 'admin:abcd1234' })
    expect(db.tables.event_withdrawals[0].status).toBe('paid')
    expect(sent).toHaveLength(1)
    expect(sent[0].to[0]).toMatch(/ana@siete\.cl/)
    expect(sent[0].subject).toMatch(/150\.000/)
    expect(sent[0].html).toContain('TRX-123')
    expect(sent[0].html).not.toContain('000123456789')
  })

  it('mark_payout_paid: titular distinto de la identidad verificada (Didit) se niega sin force', async () => {
    db.tables.organization_payout_accounts[0].holder_match_status = 'mismatch'
    const blocked = await run('mark_payout_paid', { payout_id: P1, reference: 'TRX-55', reason: 'Pago del retiro de Siete' })
    expect(blocked).toMatchObject({ ok: false, code: 'conflict' })
    expect(blocked.message).toMatch(/no se transfiere a terceros/)
    db.tables.organization_payout_accounts[0].holder_match_status = 'match'
    const ok = await run('mark_payout_paid', { payout_id: P1, reference: 'TRX-55', reason: 'Pago del retiro de Siete' })
    expect(ok.result.status).toBe('confirmation_required')
  })

  it('mark_payout_paid: con la cuenta sin verificar se niega antes de confirmar; con force pide confirmación con advertencias', async () => {
    const blocked = await run('mark_payout_paid', { payout_id: P2, reference: 'TRX-9', reason: 'Pago del retiro de Ocho' })
    expect(blocked).toMatchObject({ ok: false, code: 'conflict' })
    expect(blocked.message).toMatch(/force=true/)
    const forced = await run('mark_payout_paid', { payout_id: P2, reference: 'TRX-9', force: true, reason: 'Ya transferí a la cuenta correcta' })
    expect(forced.result.status).toBe('confirmation_required')
    expect(forced.result.warnings.join(' ')).toMatch(/NO está verificada/)
  })

  it('si el correo al productor falla, el pago igual queda registrado', async () => {
    failEmail = true
    const { second } = await confirmAndRun('mark_payout_paid', { payout_id: P1, reference: 'TRX-777', reason: 'Transferencia hecha' })
    expect(second.ok).toBe(true)
    expect(second.result).toMatchObject({ status: 'paid', email_sent: false })
    expect(db.tables.aitickets_payouts[0].status).toBe('paid')
  })

  it('mark_payout_failed: el retiro queda fallido y se avisa al productor', async () => {
    const { second } = await confirmAndRun('mark_payout_failed', { payout_id: P1, reason_for_producer: 'La cuenta fue cerrada por el banco', reason: 'El banco rechazó la transferencia' })
    expect(second.result).toMatchObject({ status: 'failed', email_sent: true })
    expect(db.tables.event_withdrawals[0].status).toBe('failed')
    expect(sent[0].subject).toMatch(/No pudimos transferir/)
  })

  it('un error de la función SQL (P0001) llega como conflict con su mensaje', async () => {
    db.tables.aitickets_payouts[0].status = 'cancelled'
    const r = await run('mark_payout_paid', { payout_id: P1, reference: 'TRX-1', reason: 'probando un retiro anulado' })
    expect(r).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('la llave de solo lectura no puede escribir', async () => {
    const r = await run('mark_payout_paid', { payout_id: P1, reference: 'TRX-1', reason: 'intento con solo lectura' }, 'readonly')
    expect(r).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('el aviso de Slack del retiro sugiere el camino por Claude', () => {
    expect(payoutSlackSql(7, P1)).toContain(`«paga el retiro ${P1}»`)
    expect(payoutSlackSql(7, P1)).toContain("aitickets_set_payout_status")
  })
})

describe('cuentas bancarias', () => {
  it('verify_payout_account: aprueba con confirmación y quien verifica es la huella de la llave', async () => {
    const { first, second } = await confirmAndRun('verify_payout_account', { organization_id: 8, decision: 'approve', expected_last4: '3210', reason: 'Revisé la cuenta con el certificado del banco' })
    expect(first.result.summary).toMatch(/APROBAR.*Santander.*3210/)
    expect(first.result.summary).not.toContain('9876543210')
    expect(second.ok).toBe(true)
    expect(db.tables.organization_payout_accounts[1]).toMatchObject({ verified_by: 'admin:abcd1234' })
    expect(db.tables.organization_payout_accounts[1].verified_at).toBeTruthy()
  })

  it('rechazar exige notes', async () => {
    const r = await run('verify_payout_account', { organization_id: 8, decision: 'reject', reason: 'El titular no calza' })
    expect(r).toMatchObject({ ok: false, code: 'invalid_input' })
  })
})

describe('reembolsos', () => {
  it('list_refund_requests trae la referencia de Flow y el correo del comprador (sensible)', async () => {
    const r = await run('list_refund_requests', {})
    expect(r.result.refunds[0]).toMatchObject({ refund_id: R1, flow_reference: 'FLOW-1', buyer_email: 'comprador@mail.cl', total_amount_clp: 10952 })
    expect((await run('list_refund_requests', {}, 'readonly')).code).toBe('forbidden')
  })

  it('mark_refund_completed exige la referencia de Flow y confirma', async () => {
    const missing = await run('mark_refund_completed', { refund_id: R1, reason: 'Devuelto en Flow' })
    expect(missing).toMatchObject({ ok: false, code: 'invalid_input' })
    const { second } = await confirmAndRun('mark_refund_completed', { refund_id: R1, provider_reference: 'FLOW-RF-9', reason: 'Devuelto en el panel de Flow' })
    expect(second.ok).toBe(true)
    expect(db.tables.aitickets_refunds[0]).toMatchObject({ status: 'completed', provider_reference: 'FLOW-RF-9' })
  })
})

describe('moderación, perfil, notas y ayuda para entrar', () => {
  it('moderate_review oculta y vuelve a mostrar', async () => {
    const r = await run('moderate_review', { review_id: REV, action: 'hide', reason: 'El productor reportó un comentario ofensivo' })
    expect(r.result).toMatchObject({ status: 'hidden', previous_status: 'visible', changed: true, event_id: 10 })
    expect(db.tables.aitickets_event_reviews[0].public_status).toBe('hidden')
    const both = await run('moderate_review', { review_id: REV, photo_id: REV, action: 'show', reason: 'mal uso de argumentos' })
    expect(both).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('update_organization valida y devuelve antes/después', async () => {
    const bad = await run('update_organization', { organization_id: 7, legal_id: '123', reason: 'Productor pidió cambiar su RUT' })
    expect(bad).toMatchObject({ ok: false, code: 'invalid_input' })
    const empty = await run('update_organization', { organization_id: 7, public_name: '', reason: 'probando nombre vacío' })
    expect(empty).toMatchObject({ ok: false, code: 'invalid_input' })
    const ok = await run('update_organization', { organization_id: 7, public_name: 'Siete Producciones', instagram: '@siete', reason: 'Productor pidió el cambio por WhatsApp' })
    expect(ok.result).toMatchObject({ changed_fields: ['public_name', 'instagram'], before: { public_name: 'Productora Siete' }, after: { public_name: 'Siete Producciones' } })
    expect(db.tables.organizations[0].public_name).toBe('Siete Producciones')
  })

  it('notas internas', async () => {
    await run('add_organization_note', { organization_id: 7, body: 'Prefiere WhatsApp. Cuenta verificada con certificado.', reason: 'Contexto de soporte' })
    const r = await run('list_organization_notes', { organization_id: 7 })
    expect(r.result.notes[0].body).toMatch(/WhatsApp/)
  })

  it('send_login_help: solo al correo registrado; verificación solo si falta', async () => {
    const magic = await run('send_login_help', { email: 'ANA@siete.cl', kind: 'magic_link', reason: 'No puede entrar, pidió link' })
    expect(magic.result).toMatchObject({ sent: true, sent_to: 'ana@siete.cl', user_id: 1 })
    expect(magicSent[0]).toMatchObject({ email: 'ana@siete.cl', purpose: 'login' })
    const already = await run('send_login_help', { user_id: 1, kind: 'verification_email', reason: 'Dice que no le llegó la verificación' })
    expect(already).toMatchObject({ ok: false, code: 'conflict' })
    const verify = await run('send_login_help', { user_id: 2, kind: 'verification_email', reason: 'No le llegó la verificación' })
    expect(verify.result.sent).toBe(true)
    expect(verificationSent[0]).toMatchObject({ email: 'oscar@ocho.cl', orgName: 'Ocho Eventos' })
    const noAuth = await run('send_login_help', { user_id: 3, kind: 'magic_link', reason: 'probando sin cuenta' })
    expect(noAuth).toMatchObject({ ok: false, code: 'conflict' })
  })
})

describe('bandeja, salud y finanzas', () => {
  it('list_pending_operations: secciones por urgencia con la herramienta para resolver', async () => {
    const r = await run('list_pending_operations', {})
    const keys = r.result.sections.map((s) => s.key)
    expect(keys[0]).toBe('payouts')
    expect(keys).toEqual(expect.arrayContaining(['payouts', 'refunds', 'orders_in_review', 'paid_without_email', 'payout_accounts_to_verify', 'outreach']))
    const accounts = r.result.sections.find((s) => s.key === 'payout_accounts_to_verify')
    expect(accounts.items).toEqual([expect.objectContaining({ organization: { id: 8, name: 'Ocho Eventos' }, account_last4: '3210' })])
    expect(r.result.sections.find((s) => s.key === 'paid_without_email').items[0].order_id).toBe('o4')
    expect(r.result.sections.find((s) => s.key === 'outreach').items[0]).toMatchObject({ type: 'paused', reason: 'rebotes' })
    expect(JSON.stringify(r.result)).not.toContain('9876543210')
  })

  it('get_system_health no falla con tablas inexistentes', async () => {
    const r = await run('get_system_health', {})
    expect(r.ok).toBe(true)
    expect(r.result.alerts.join(' ')).toMatch(/Outreach en pausa/)
  })

  it('get_platform_finance: ingresos de AI Tickets, IVA, costo Flow, reembolsos y margen', async () => {
    const r = await run('get_platform_finance', { preset: '30d' })
    expect(r.ok).toBe(true)
    expect(r.result.sales).toMatchObject({ paid_orders: 3, gross_sales_clp: 109520 + 54760 + 10952 })
    expect(r.result.aitickets).toMatchObject({ service_fee_net_clp: 12800, service_fee_iva_clp: 2432, flow_cost_clp: 4800, refunded_fee_absorbed_clp: 952, margin_clp: 12800 - 4800 - 952 })
    expect(r.result.payouts.open_now).toMatchObject({ count: 2, total_clp: 200000 })
    expect(r.result.by_organization[0].organization.id).toBe(7)
    expect(r.result.owed_to_producers_now.organizations).toBe(2)
  })

  it('las herramientas nuevas aparecen en tools/list (y las sensibles no con la llave de solo lectura)', async () => {
    const list = async (key) => {
      const res = await adminRoute.POST({
        request: new Request(`${SITE}/api/admin/mcp`, { method: 'POST', headers: { host: 'aitickets.cl', 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
      })
      return (await res.json()).result.tools.map((t) => t.name)
    }
    const fullNames = await list(full.key)
    expect(fullNames).toEqual(expect.arrayContaining(['list_payout_requests', 'get_payout_transfer_details', 'mark_payout_paid', 'list_pending_operations', 'get_platform_finance', 'send_login_help']))
    const roNames = await list(readonly.key)
    expect(roNames).toContain('list_payout_requests')
    expect(roNames).not.toContain('get_payout_transfer_details')
    expect(roNames).not.toContain('list_refund_requests')
    expect(roNames).not.toContain('mark_payout_paid')
  })

  it('prompts de operación', async () => {
    const res = await adminRoute.POST({
      request: new Request(`${SITE}/api/admin/mcp`, { method: 'POST', headers: { host: 'aitickets.cl', 'Content-Type': 'application/json', Authorization: `Bearer ${full.key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'prompts/list' }) }),
    })
    const names = (await res.json()).result.prompts.map((p) => p.name)
    expect(names).toEqual(expect.arrayContaining(['ayudar_productor', 'revisar_productor', 'pagar_retiros', 'bandeja_operacion', 'cierre_mensual', 'reporte_plataforma']))
  })
})
