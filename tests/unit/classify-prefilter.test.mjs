// Pre-filtro de bajas del outreach (netlify/lib/outreach/classify.mjs), sin LLM.
// Una baja debe detectarse siempre (aunque OUTREACH_ENABLED=false); una respuesta que no es baja
// no debe suprimir al lead.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { INTENTS, classifyReply, handleIntent, isUnsubscribeReply, stripQuoted } from '../../netlify/lib/outreach/classify.mjs'

const { replies } = JSON.parse(readFileSync(new URL('../fixtures/replies.json', import.meta.url), 'utf8'))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('fixture de respuestas', () => {
  it('tiene ~40 respuestas etiquetadas con intenciones válidas', () => {
    expect(replies.length).toBeGreaterThanOrEqual(35)
    for (const r of replies) expect(INTENTS).toContain(r.intent)
    expect(new Set(replies.map((r) => r.intent)).size).toBeGreaterThanOrEqual(8)
  })
})

describe('isUnsubscribeReply', () => {
  it('detecta "NO", "baja" y "unsubscribe" en cualquier forma', () => {
    for (const t of ['NO', 'no', 'No.', 'no!', 'Baja', 'baja.', 'de baja', 'unsubscribe', 'Unsubscribe me', 'STOP', 'remover']) {
      expect(isUnsubscribeReply(t), t).toBe(true)
    }
  })

  it.each(replies.filter((r) => r.prefilter).map((r) => [r.text.slice(0, 40), r]))('baja detectada: %s', (_label, r) => {
    expect(isUnsubscribeReply(r.text)).toBe(true)
  })

  it.each(replies.filter((r) => !r.prefilter).map((r) => [r.text.slice(0, 40), r]))('no es baja: %s', (_label, r) => {
    expect(isUnsubscribeReply(r.text)).toBe(false)
  })

  it('ignora el texto citado del correo original', () => {
    expect(isUnsubscribeReply('Me interesa!\n\nOn Mon, Sep 28, 2026 at 10:00 AM AI Tickets wrote:\nSi no quieres recibir más correos, responde NO')).toBe(false)
    expect(isUnsubscribeReply('')).toBe(false)
    expect(isUnsubscribeReply('> baja')).toBe(false)
  })

  it('stripQuoted corta en "escribió:", "wrote:", "De:" y quita líneas con >', () => {
    expect(stripQuoted('Hola\n> citado\nChao')).toBe('Hola\nChao')
    expect(stripQuoted('Sí\nEl lun, 28 sept 2026, Ana <a@b.cl> escribió:\nNO')).toBe('Sí')
    expect(stripQuoted('Ok\r\nFrom: Ana <a@b.cl>\r\nNO')).toBe('Ok')
    expect(stripQuoted('Ok\n-----Original Message-----\nNO')).toBe('Ok')
  })
})

describe('classifyReply sin LLM', () => {
  it('una baja se clasifica por regex aunque el outreach esté apagado', async () => {
    const res = await classifyReply({ supabase: createFakeSupabase(), budget: null, text: 'Por favor denme de baja' })
    expect(res).toMatchObject({ intent: 'unsubscribe', confidence: 1, via: 'regex' })
  })

  it('con OUTREACH_ENABLED=false no llama al LLM y queda sin clasificar (va a un humano)', async () => {
    const res = await classifyReply({ supabase: createFakeSupabase(), budget: null, text: '¿Cuánto cuesta?' })
    expect(res).toEqual({ intent: null, confidence: 0, via: 'none' })
  })
})

describe('handleIntent: enrutamiento', () => {
  const lead = { id: 'lead-1', email: 'contacto@teatro.cl', org_name: 'Teatro', status: 'contacted' }
  const inbound = { id: 'msg-in-1', provider: 'dryrun', thread_id: 't1', mailbox: 'ventas@aitickets.cl', provider_message_id: 'pm1', body_text: 'x' }
  const db = () =>
    createFakeSupabase({
      tables: {
        aitickets_leads: [{ ...lead }],
        aitickets_outreach_messages: [{ id: 'msg-in-1', direction: 'in' }],
        aitickets_suppressions: [],
        aitickets_outreach_events: [],
      },
    })

  it('unsubscribe → supresión inmediata y evento', async () => {
    const supabase = db()
    expect(await handleIntent({ supabase, lead, inbound, result: { intent: 'unsubscribe', confidence: 1, via: 'regex' } })).toEqual({ action: 'suppressed' })
    expect(supabase.tables.aitickets_suppressions[0]).toMatchObject({ email: 'contacto@teatro.cl', reason: 'unsubscribe' })
    expect(supabase.tables.aitickets_leads[0].status).toBe('suppressed')
    expect(supabase.tables.aitickets_outreach_events.map((e) => e.type)).toContain('unsubscribe')
  })

  it('not_interested y hostile también suprimen', async () => {
    for (const intent of ['not_interested', 'hostile']) {
      const supabase = db()
      expect((await handleIntent({ supabase, lead, inbound, result: { intent, confidence: 0.9, via: 'llm' } })).action).toBe('suppressed')
      expect(supabase.tables.aitickets_suppressions).toHaveLength(1)
    }
  })

  it('interested con auto-respuesta apagada → borrador para un humano (nunca envía solo)', async () => {
    vi.stubEnv('OUTREACH_UNSUB_SECRET', 'unsub-secret-for-tests')
    vi.stubEnv('LEAD_TOKEN_SECRET', 'lead-secret-for-tests')
    const supabase = db()
    expect(await handleIntent({ supabase, lead, inbound, result: { intent: 'interested', confidence: 0.99, via: 'llm' } })).toEqual({ action: 'escalated' })
    expect(supabase.tables.aitickets_leads[0].status).toBe('interested')
    const drafts = supabase.tables.aitickets_outreach_messages.filter((m) => m.status === 'draft')
    expect(drafts).toHaveLength(1)
    expect(drafts[0].body_text).toContain('/organizadores/registro')
    expect(supabase.tables.aitickets_outreach_messages.some((m) => m.status === 'sent')).toBe(false)
  })

  it('question o sin clasificar → humano, sin supresión', async () => {
    for (const result of [{ intent: 'question', confidence: 0.9, via: 'llm' }, { intent: null, confidence: 0, via: 'none' }]) {
      const supabase = db()
      expect(await handleIntent({ supabase, lead, inbound, result })).toEqual({ action: 'escalated' })
      expect(supabase.tables.aitickets_leads[0].status).toBe('replied')
      expect(supabase.tables.aitickets_suppressions).toHaveLength(0)
    }
  })

  it('out_of_office reprograma; auto_other se ignora', async () => {
    const supabase = db()
    const res = await handleIntent({ supabase, lead, inbound, result: { intent: 'out_of_office', confidence: 0.9, return_date: '2099-01-10', via: 'llm' } })
    expect(res.action).toBe('rescheduled')
    expect(res.next_action_at.slice(0, 10) >= '2099-01-11').toBe(true)
    expect(await handleIntent({ supabase: db(), lead, inbound, result: { intent: 'auto_other', confidence: 0.9, via: 'llm' } })).toEqual({ action: 'ignored' })
  })

  it('referral con correo gratuito no crea un lead nuevo', async () => {
    const supabase = db()
    const res = await handleIntent({ supabase, lead, inbound, result: { intent: 'referral', confidence: 0.9, referral_email: 'pedro@gmail.com', via: 'llm' } })
    expect(res).toEqual({ action: 'lost' })
    expect(supabase.tables.aitickets_leads).toHaveLength(1)
  })

  it('referral con correo corporativo del mismo dominio crea un lead pendiente de enriquecer', async () => {
    const supabase = db()
    const res = await handleIntent({ supabase, lead, inbound, result: { intent: 'referral', confidence: 0.9, referral_email: 'Pedro@Teatro.cl', via: 'llm' } })
    expect(res).toEqual({ action: 'referral_created' })
    expect(supabase.tables.aitickets_leads.at(-1)).toMatchObject({ email: 'pedro@teatro.cl', status: 'new', source: 'referral' })
  })

  it('referral a otro dominio corporativo no crea lead (va a Slack para un humano)', async () => {
    const supabase = db()
    const res = await handleIntent({ supabase, lead, inbound, result: { intent: 'referral', confidence: 0.9, referral_email: 'Pedro@Productora.cl', via: 'llm' } })
    expect(res).toEqual({ action: 'lost' })
    expect(supabase.tables.aitickets_leads).toHaveLength(1)
  })
})
