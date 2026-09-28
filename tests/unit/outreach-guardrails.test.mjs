// Guardarraíles del outreach (netlify/lib/outreach/guardrails.mjs + config.mjs) con Supabase en memoria.
// Interruptor, supresión, topes, ventana de envío, ventana de recontacto y legalReady.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { counterRpc, createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { getOutreachConfig, realSendingBlockers } from '../../netlify/lib/outreach/config.mjs'
import {
  addBusinessDays,
  bumpCounter,
  canSend,
  counterKeys,
  escapeLike,
  isSuppressed,
  isWithinSendWindow,
  santiagoParts,
  suppress,
} from '../../netlify/lib/outreach/guardrails.mjs'

// Lunes 28-sep-2026 12:00 en Chile (UTC-3 con horario de verano)
const MON_NOON = new Date('2026-09-28T15:00:00Z')
const MON_NIGHT = new Date('2026-09-28T23:30:00Z') // 20:30 en Chile
const SATURDAY = new Date('2026-10-03T15:00:00Z')

const lead = (overrides = {}) => ({
  id: 'lead-1',
  email: 'contacto@teatrocamino.cl',
  domain: 'teatrocamino.cl',
  status: 'enriched',
  country: 'CL',
  sequence_step: 0,
  last_contacted_at: null,
  organization_id: null,
  ...overrides,
})

const cfg = (overrides = {}) => ({ ...getOutreachConfig(), enabled: true, dryRun: true, ...overrides })

function db(tables = {}) {
  return createFakeSupabase({
    tables: { aitickets_outreach_state: [{ key: 'paused', value: { paused: false } }], aitickets_suppressions: [], organizations: [], aitickets_leads: [], ...tables },
    rpc: counterRpc(),
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('configuración por defecto (todo apagado y seguro)', () => {
  it('sin env: deshabilitado, dry-run, sin auto-respuesta, proveedor dryrun, LIA no aprobada', () => {
    const c = getOutreachConfig()
    expect(c).toMatchObject({ enabled: false, dryRun: true, autoReply: false, liaApproved: false, provider: 'dryrun', dailyCap: 20, perMailboxCap: 15, maxFollowups: 2, recontactDays: 180 })
    expect(c.countries).toEqual(['CL'])
  })

  it('valores fuera de rango se acotan; proveedor desconocido cae a dryrun', () => {
    vi.stubEnv('OUTREACH_DAILY_CAP', '100000')
    vi.stubEnv('OUTREACH_RECONTACT_DAYS', '1')
    vi.stubEnv('OUTREACH_PROVIDER', 'mailgun')
    const c = getOutreachConfig()
    expect(c.dailyCap).toBe(200)
    expect(c.recontactDays).toBe(30)
    expect(c.provider).toBe('dryrun')
  })

  it('realSendingBlockers lista todo lo que falta, en orden', () => {
    expect(realSendingBlockers(getOutreachConfig(), false)).toEqual(['outreach_disabled', 'legal_not_ready', 'lia_not_approved', 'dry_run', 'provider_dryrun'])
    expect(realSendingBlockers(cfg({ dryRun: false, liaApproved: true, provider: 'instantly' }), true)).toEqual([])
  })
})

describe('canSend', () => {
  it('interruptor: OUTREACH_ENABLED=false bloquea todo, incluso borradores', async () => {
    const supabase = db()
    expect(await canSend(supabase, lead(), MON_NOON)).toEqual({ ok: false, reason: 'outreach_disabled' })
    expect(await canSend(supabase, lead(), MON_NOON, { cfg: cfg({ enabled: false }) })).toEqual({ ok: false, reason: 'outreach_disabled' })
    // Ni siquiera consulta la BD
    expect(supabase.calls).toHaveLength(0)
  })

  it('dry-run habilitado en horario → ok', async () => {
    expect(await canSend(db(), lead(), MON_NOON, { cfg: cfg() })).toEqual({ ok: true })
  })

  it('envío real: legalReady() viene listo con los datos de Chanium, LLC fijados por defecto', async () => {
    const real = cfg({ dryRun: false, liaApproved: true, provider: 'instantly' })
    expect(await canSend(db(), lead(), MON_NOON, { cfg: real, dryRun: false })).toEqual({ ok: true })
    vi.stubEnv('CHANIUM_LEGAL_ADDRESS', '8 The Green, Dover, DE 19901, EE.UU.')
    vi.stubEnv('CHANIUM_LEGAL_EMAIL', 'legal@aitickets.cl')
    expect(await canSend(db(), lead(), MON_NOON, { cfg: real, dryRun: false })).toEqual({ ok: true })
  })

  it('envío real exige la evaluación de interés legítimo aprobada', async () => {
    vi.stubEnv('CHANIUM_LEGAL_ADDRESS', '8 The Green, Dover, DE 19901, EE.UU.')
    vi.stubEnv('CHANIUM_LEGAL_EMAIL', 'legal@aitickets.cl')
    const real = cfg({ dryRun: false, liaApproved: false, provider: 'instantly' })
    expect(await canSend(db(), lead(), MON_NOON, { cfg: real, dryRun: false })).toEqual({ ok: false, reason: 'lia_not_approved' })
  })

  it('pausa operativa', async () => {
    const supabase = db({ aitickets_outreach_state: [{ key: 'paused', value: { paused: true } }] })
    expect(await canSend(supabase, lead(), MON_NOON, { cfg: cfg() })).toEqual({ ok: false, reason: 'paused' })
  })

  it('suprimido por email (sin distinguir mayúsculas)', async () => {
    const supabase = db({ aitickets_suppressions: [{ id: 1, email: 'contacto@teatrocamino.cl', domain: null }] })
    expect(await canSend(supabase, lead({ email: 'Contacto@TeatroCamino.cl' }), MON_NOON, { cfg: cfg() })).toEqual({ ok: false, reason: 'suppressed' })
  })

  it('suprimido por dominio', async () => {
    const supabase = db({ aitickets_suppressions: [{ id: 1, email: null, domain: 'teatrocamino.cl' }] })
    expect(await canSend(supabase, lead({ email: 'otra@teatrocamino.cl' }), MON_NOON, { cfg: cfg() })).toEqual({ ok: false, reason: 'suppressed' })
  })

  it('un dominio de correo gratuito nunca bloquea a otros usuarios de ese dominio', async () => {
    const supabase = db({ aitickets_suppressions: [{ id: 1, email: null, domain: 'gmail.com' }] })
    expect(await canSend(supabase, lead({ email: 'productora@gmail.com', domain: null }), MON_NOON, { cfg: cfg() })).toEqual({ ok: true })
  })

  it('ya es cliente (organization_id, converted o email de una organización)', async () => {
    expect((await canSend(db(), lead({ organization_id: 5 }), MON_NOON, { cfg: cfg() })).reason).toBe('already_customer')
    expect((await canSend(db(), lead({ status: 'converted' }), MON_NOON, { cfg: cfg() })).reason).toBe('status_converted')
    const supabase = db({ organizations: [{ id: 9, email: 'CONTACTO@teatrocamino.cl' }] })
    expect(await canSend(supabase, lead(), MON_NOON, { cfg: cfg() })).toEqual({ ok: false, reason: 'already_customer' })
  })

  it('solo leads enriquecidos o contactados, con email y del país habilitado', async () => {
    expect((await canSend(db(), lead({ status: 'new' }), MON_NOON, { cfg: cfg() })).reason).toBe('status_new')
    expect((await canSend(db(), lead({ email: 'no-es-email' }), MON_NOON, { cfg: cfg() })).reason).toBe('no_email')
    expect((await canSend(db(), lead({ country: 'AR' }), MON_NOON, { cfg: cfg() })).reason).toBe('country_not_enabled')
    expect((await canSend(db(), null, MON_NOON, { cfg: cfg() })).reason).toBe('no_lead')
  })

  it('secuencia terminada después de los seguimientos permitidos', async () => {
    expect((await canSend(db(), lead({ status: 'contacted', sequence_step: 3 }), MON_NOON, { cfg: cfg() })).reason).toBe('sequence_complete')
    expect(await canSend(db(), lead({ status: 'contacted', sequence_step: 2, last_contacted_at: '2026-09-20T12:00:00Z' }), MON_NOON, { cfg: cfg() })).toEqual({ ok: true })
  })

  it('ventana de recontacto: no reiniciar la secuencia antes de 180 días', async () => {
    const recent = new Date(MON_NOON.getTime() - 30 * 86_400_000).toISOString()
    const old = new Date(MON_NOON.getTime() - 200 * 86_400_000).toISOString()
    expect(await canSend(db(), lead({ last_contacted_at: recent }), MON_NOON, { cfg: cfg() })).toEqual({ ok: false, reason: 'recontact_window' })
    expect(await canSend(db(), lead({ last_contacted_at: old }), MON_NOON, { cfg: cfg() })).toEqual({ ok: true })
  })

  it('ventana de envío: lunes a viernes 09-17 hora de Chile', async () => {
    expect(await canSend(db(), lead(), SATURDAY, { cfg: cfg() })).toEqual({ ok: false, reason: 'outside_send_window' })
    expect(await canSend(db(), lead(), MON_NIGHT, { cfg: cfg() })).toEqual({ ok: false, reason: 'outside_send_window' })
  })

  it('tope diario (borradores y envíos cuentan por separado)', async () => {
    const supabase = db()
    await bumpCounter(supabase, counterKeys.draftsToday(MON_NOON), 20)
    expect(await canSend(supabase, lead(), MON_NOON, { cfg: cfg() })).toEqual({ ok: false, reason: 'daily_cap' })
    expect(await canSend(supabase, lead(), MON_NOON, { cfg: cfg({ dailyCap: 21 }) })).toEqual({ ok: true })
  })

  it('tope por casilla en envío real', async () => {
    vi.stubEnv('CHANIUM_LEGAL_ADDRESS', '8 The Green, Dover, DE 19901, EE.UU.')
    vi.stubEnv('CHANIUM_LEGAL_EMAIL', 'legal@aitickets.cl')
    const real = cfg({ dryRun: false, liaApproved: true, provider: 'instantly' })
    const supabase = db()
    await bumpCounter(supabase, counterKeys.mailboxToday('Ventas@AiTickets.cl', MON_NOON), 15)
    expect(await canSend(supabase, lead(), MON_NOON, { cfg: real, dryRun: false, mailbox: 'ventas@aitickets.cl' })).toEqual({ ok: false, reason: 'mailbox_cap' })
    expect(await canSend(supabase, lead(), MON_NOON, { cfg: real, dryRun: false, mailbox: 'otra@aitickets.cl' })).toEqual({ ok: true })
  })

  it('falla cerrado ante un error de BD', async () => {
    const supabase = db()
    supabase.failOn('aitickets_suppressions', 'select', { code: '500', message: 'boom' })
    expect(await canSend(supabase, lead(), MON_NOON, { cfg: cfg() })).toEqual({ ok: false, reason: 'guardrail_error' })
  })
})

describe('supresión', () => {
  it('isSuppressed: sin email válido se trata como suprimido', async () => {
    expect(await isSuppressed(db(), '')).toBe(true)
    expect(await isSuppressed(db(), 'contacto@teatro.cl')).toBe(false)
  })

  it('suppress() es idempotente y detiene la secuencia del lead', async () => {
    const supabase = db({ aitickets_leads: [{ id: 'lead-1', email: 'contacto@teatro.cl', domain: 'teatro.cl', status: 'contacted', next_action_at: '2026-10-01' }] })
    expect(await suppress(supabase, { email: 'Contacto@Teatro.cl', reason: 'unsubscribe' })).toEqual({ ok: true })
    expect(await suppress(supabase, { email: 'contacto@teatro.cl', reason: 'unsubscribe' })).toEqual({ ok: true })
    expect(supabase.tables.aitickets_suppressions).toHaveLength(1)
    expect(supabase.tables.aitickets_suppressions[0]).toMatchObject({ email: 'contacto@teatro.cl', domain: null, reason: 'unsubscribe' })
    expect(supabase.tables.aitickets_leads[0]).toMatchObject({ status: 'suppressed', next_action_at: null })
    expect(await isSuppressed(supabase, 'contacto@teatro.cl')).toBe(true)
  })

  it('nunca suprime un dominio de correo gratuito', async () => {
    const supabase = db()
    expect(await suppress(supabase, { domain: 'gmail.com', reason: 'bot_optout' })).toEqual({ ok: false, reason: 'nothing_to_suppress' })
    expect(supabase.tables.aitickets_suppressions).toHaveLength(0)
  })

  it('suprime por dominio registrable (subdominio → dominio)', async () => {
    const supabase = db()
    await suppress(supabase, { domain: 'www.teatro.cl', reason: 'bot_optout' })
    expect(supabase.tables.aitickets_suppressions[0]).toMatchObject({ email: null, domain: 'teatro.cl' })
    expect(await isSuppressed(supabase, 'cualquiera@teatro.cl')).toBe(true)
  })

  it('escapeLike escapa comodines de LIKE', () => {
    expect(escapeLike('a_b%c\\d')).toBe('a\\_b\\%c\\\\d')
  })
})

describe('tiempo (America/Santiago)', () => {
  it('santiagoParts', () => {
    expect(santiagoParts(MON_NOON)).toEqual({ date: '2026-09-28', weekday: 1, hour: 12 })
    expect(santiagoParts(SATURDAY).weekday).toBe(6)
    // 02:00 UTC del martes es todavía lunes en Chile
    expect(santiagoParts(new Date('2026-09-29T02:00:00Z')).date).toBe('2026-09-28')
  })

  it('isWithinSendWindow: bordes 09:00 incluido y 17:00 excluido', () => {
    const c = getOutreachConfig()
    expect(isWithinSendWindow(new Date('2026-09-28T12:00:00Z'), c)).toBe(true) // 09:00
    expect(isWithinSendWindow(new Date('2026-09-28T11:59:00Z'), c)).toBe(false) // 08:59
    expect(isWithinSendWindow(new Date('2026-09-28T19:59:00Z'), c)).toBe(true) // 16:59
    expect(isWithinSendWindow(new Date('2026-09-28T20:00:00Z'), c)).toBe(false) // 17:00
    expect(isWithinSendWindow(new Date('2026-10-04T15:00:00Z'), c)).toBe(false) // domingo
  })

  it('addBusinessDays salta fines de semana', () => {
    const friday = new Date('2026-10-02T15:00:00Z')
    expect(santiagoParts(addBusinessDays(friday, 1)).date).toBe('2026-10-05')
    expect(santiagoParts(addBusinessDays(friday, 4)).date).toBe('2026-10-08')
    expect(santiagoParts(addBusinessDays(MON_NOON, 5)).date).toBe('2026-10-05')
  })

  it('counterKeys usa la fecha de Chile', () => {
    expect(counterKeys.sentToday(MON_NOON)).toBe('sent:2026-09-28')
    expect(counterKeys.draftsToday(MON_NOON)).toBe('drafts:2026-09-28')
    expect(counterKeys.mailboxToday('A@B.cl', MON_NOON)).toBe('sent:2026-09-28:a@b.cl')
    expect(counterKeys.llmTokensToday(MON_NOON)).toBe('llm_tokens:2026-09-28')
  })
})
