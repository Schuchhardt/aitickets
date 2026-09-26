// Guardarraíles del outreach: interruptor, pausa, supresión, topes, ventana de envío y auto-pausa.
// canSend() se llama ANTES de cada envío (o borrador en dry-run). Falla cerrado: ante un error de BD
// devuelve {ok:false}.
import { legalReady } from '../legal.mjs'
import { getOutreachConfig, realSendingBlockers, SEND_TIMEZONE } from './config.mjs'
import { emailDomain, isFreeMailDomain, normalizeEmail, registrableDomain } from './domains.mjs'
import { notifyOutreach } from './notify.mjs'
import { syncProviderCampaign } from './provider-campaign.mjs'

const PAUSE_KEY = 'paused'

/** Escapa comodines de LIKE (% _ \\) para comparar exacto sin distinguir mayúsculas. */
export const escapeLike = (v) => String(v ?? '').replace(/[\\%_]/g, (c) => `\\${c}`)

// ---------- tiempo ----------

/** Partes de fecha/hora en America/Santiago: {date:'YYYY-MM-DD', weekday:1..7 (lunes=1), hour}. */
export function santiagoParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: SEND_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  )
  const weekdays = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdays[parts.weekday] || 0,
    hour: Number(parts.hour) % 24,
  }
}

export function isWithinSendWindow(now = new Date(), cfg = getOutreachConfig()) {
  const { weekday, hour } = santiagoParts(now)
  const w = cfg.sendWindow
  return w.days.includes(weekday) && hour >= w.startHour && hour < w.endHour
}

/** Suma N días hábiles (lunes a viernes, sin feriados) a partir de `from`. */
export function addBusinessDays(from, days) {
  const d = new Date(from)
  let added = 0
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1)
    const wd = santiagoParts(d).weekday
    if (wd >= 1 && wd <= 5) added++
  }
  return d
}

// ---------- pausa ----------

export async function isPaused(supabase) {
  const { data, error } = await supabase.from('aitickets_outreach_state').select('value').eq('key', PAUSE_KEY).maybeSingle()
  if (error) throw new Error(`outreach_state: ${error.message}`)
  return Boolean(data?.value?.paused)
}

export async function setPaused(supabase, paused, reason = '') {
  const value = { paused: Boolean(paused), reason: String(reason || '').slice(0, 500), at: new Date().toISOString() }
  const { error } = await supabase
    .from('aitickets_outreach_state')
    .upsert({ key: PAUSE_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(`outreach_state: ${error.message}`)
  // La pausa en la BD no detiene lo que Instantly ya tiene programado: pausar/reactivar la campaña.
  // syncProviderCampaign nunca lanza; si falla avisa fuerte por Slack y outreach-tick reintenta.
  const campaign = await syncProviderCampaign(supabase, { paused: value.paused, reason: value.reason, force: value.paused })
  return { ...value, campaign }
}

// ---------- contadores ----------

export async function bumpCounter(supabase, key, delta = 1) {
  const { data, error } = await supabase.rpc('aitickets_outreach_bump_counter', { p_key: key, p_delta: delta })
  if (error) throw new Error(`bump_counter: ${error.message}`)
  return Number(data) || 0
}

export async function readCounter(supabase, key) {
  const { data, error } = await supabase.from('aitickets_outreach_state').select('value').eq('key', key).maybeSingle()
  if (error) throw new Error(`outreach_state: ${error.message}`)
  return Number(data?.value?.count) || 0
}

export const counterKeys = {
  sentToday: (now = new Date()) => `sent:${santiagoParts(now).date}`,
  draftsToday: (now = new Date()) => `drafts:${santiagoParts(now).date}`,
  mailboxToday: (mailbox, now = new Date()) => `sent:${santiagoParts(now).date}:${String(mailbox || '').toLowerCase()}`,
  llmTokensToday: (now = new Date()) => `llm_tokens:${santiagoParts(now).date}`,
}

// ---------- supresión ----------

/** true si el email (o su dominio, salvo correo gratuito) está suprimido. */
export async function isSuppressed(supabase, email) {
  const e = normalizeEmail(email)
  if (!e) return true // sin email válido no se contacta
  const domain = registrableDomain(emailDomain(e))
  const { data: byEmail, error: e1 } = await supabase.from('aitickets_suppressions').select('id').eq('email', e).limit(1)
  if (e1) throw new Error(`suppressions: ${e1.message}`)
  if (byEmail?.length) return true
  if (domain && !isFreeMailDomain(domain)) {
    const { data: byDomain, error: e2 } = await supabase
      .from('aitickets_suppressions')
      .select('id')
      .eq('domain', domain)
      .is('email', null)
      .limit(1)
    if (e2) throw new Error(`suppressions: ${e2.message}`)
    if (byDomain?.length) return true
  }
  return false
}

export async function isDomainSuppressed(supabase, domain) {
  const d = String(domain || '').toLowerCase()
  if (!d || isFreeMailDomain(d)) return false
  const { data, error } = await supabase.from('aitickets_suppressions').select('id').eq('domain', d).is('email', null).limit(1)
  if (error) throw new Error(`suppressions: ${error.message}`)
  return Boolean(data?.length)
}

/**
 * Registra una supresión (idempotente) y detiene cualquier secuencia del lead afectado.
 * Nunca suprime un dominio de correo gratuito (bloquearía a todo gmail.com): en ese caso solo el email.
 */
export async function suppress(supabase, { email, domain, reason, source } = {}) {
  const e = normalizeEmail(email) || null
  let d = domain ? registrableDomain(domain) || String(domain).toLowerCase() : null
  if (d && isFreeMailDomain(d)) d = null
  if (!e && !d) return { ok: false, reason: 'nothing_to_suppress' }
  const row = { email: e, domain: e ? null : d, reason: reason || 'manual', source: source ? String(source).slice(0, 200) : null }

  const exists = e ? await supabase.from('aitickets_suppressions').select('id').eq('email', e).limit(1)
    : await supabase.from('aitickets_suppressions').select('id').eq('domain', d).is('email', null).limit(1)
  if (exists.error) throw new Error(`suppressions: ${exists.error.message}`)
  if (!exists.data?.length) {
    const { error } = await supabase.from('aitickets_suppressions').insert(row)
    // 23505 = otra solicitud la insertó en paralelo: ya está suprimido.
    if (error && error.code !== '23505') throw new Error(`suppressions: ${error.message}`)
  }

  // Detener secuencias: por email, y por dominio si corresponde.
  const stop = { status: 'suppressed', next_action_at: null, updated_at: new Date().toISOString() }
  if (e) {
    await supabase.from('aitickets_leads').update(stop).eq('email', e).not('status', 'in', '(converted)')
  }
  if (d) {
    await supabase.from('aitickets_leads').update(stop).eq('domain', d).not('status', 'in', '(converted)')
  }
  return { ok: true }
}

// ---------- canSend ----------

/**
 * ¿Se puede enviar (o, en dry-run, generar el borrador) a este lead ahora?
 * @param {object} supabase cliente service role
 * @param {object} lead fila de aitickets_leads
 * @param {Date} now
 * @param {{cfg?: object, dryRun?: boolean, mailbox?: string}} opts
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function canSend(supabase, lead, now = new Date(), opts = {}) {
  const cfg = opts.cfg || getOutreachConfig()
  const dryRun = opts.dryRun ?? (cfg.dryRun || cfg.provider === 'dryrun')
  try {
    if (!cfg.enabled) return { ok: false, reason: 'outreach_disabled' }
    if (!dryRun) {
      const blockers = realSendingBlockers(cfg, legalReady())
      if (blockers.length) return { ok: false, reason: blockers[0] }
    }
    if (await isPaused(supabase)) return { ok: false, reason: 'paused' }

    if (!lead || !lead.id) return { ok: false, reason: 'no_lead' }
    const email = normalizeEmail(lead.email)
    if (!email) return { ok: false, reason: 'no_email' }
    if (!['enriched', 'contacted'].includes(lead.status)) return { ok: false, reason: `status_${lead.status}` }
    if (lead.organization_id || lead.status === 'converted') return { ok: false, reason: 'already_customer' }
    if (cfg.countries.length && lead.country && !cfg.countries.includes(String(lead.country).toUpperCase())) {
      return { ok: false, reason: 'country_not_enabled' }
    }
    const step = Number(lead.sequence_step) || 0
    if (step > cfg.maxFollowups) return { ok: false, reason: 'sequence_complete' }
    if (step === 0 && lead.last_contacted_at) {
      const days = (now.getTime() - new Date(lead.last_contacted_at).getTime()) / 86_400_000
      if (days < cfg.recontactDays) return { ok: false, reason: 'recontact_window' }
    }

    if (await isSuppressed(supabase, email)) return { ok: false, reason: 'suppressed' }
    if (lead.domain && (await isDomainSuppressed(supabase, lead.domain))) return { ok: false, reason: 'suppressed' }

    // ¿Ya es cliente? (organizations.email igual al del lead)
    const { data: orgs, error: orgErr } = await supabase.from('organizations').select('id').ilike('email', escapeLike(email)).limit(1)
    if (orgErr) throw new Error(`organizations: ${orgErr.message}`)
    if (orgs?.length) return { ok: false, reason: 'already_customer' }

    if (!isWithinSendWindow(now, cfg)) return { ok: false, reason: 'outside_send_window' }

    const dailyKey = dryRun ? counterKeys.draftsToday(now) : counterKeys.sentToday(now)
    if ((await readCounter(supabase, dailyKey)) >= cfg.dailyCap) return { ok: false, reason: 'daily_cap' }
    if (!dryRun && opts.mailbox) {
      if ((await readCounter(supabase, counterKeys.mailboxToday(opts.mailbox, now))) >= cfg.perMailboxCap) {
        return { ok: false, reason: 'mailbox_cap' }
      }
    }
    return { ok: true }
  } catch (err) {
    console.error('[outreach] canSend error:', err?.message)
    return { ok: false, reason: 'guardrail_error' }
  }
}

// ---------- canReply ----------

/**
 * Motivos de canSend que NO aplican a una respuesta a alguien que nos escribió (ventana y topes del envío
 * en frío, estado/paso de la secuencia). Todo lo demás (pausa, supresión, apagado, legal, cliente,
 * guardrail_error...) bloquea la respuesta: se falla cerrado.
 */
const REPLY_IGNORABLE_REASONS = new Set(['outside_send_window', 'daily_cap', 'mailbox_cap', 'recontact_window', 'sequence_complete'])

/**
 * ¿Se puede responder (envío real) en el hilo de este lead? Política única para la respuesta automática
 * a "interested" (classify.mjs) y la aprobación humana desde Slack (approve.ts).
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function canReply(supabase, lead, now = new Date(), { cfg = getOutreachConfig() } = {}) {
  const check = await canSend(supabase, { ...lead, status: 'contacted', sequence_step: 0, last_contacted_at: null }, now, { cfg, dryRun: false })
  if (check.ok) return { ok: true }
  const reason = check.reason || 'guardrail_error'
  if (REPLY_IGNORABLE_REASONS.has(reason) || reason.startsWith('status_')) return { ok: true }
  return { ok: false, reason }
}

// ---------- auto-pausa ----------

export const AUTO_PAUSE_THRESHOLDS = { bounce: 0.03, complaint: 0.001, unsubscribe: 0.05, window: 100, minSample: 10 }

/** Calcula tasas sobre los últimos 100 envíos y pausa si se superan los umbrales. */
export async function checkAutoPause(supabase) {
  const t = AUTO_PAUSE_THRESHOLDS
  const { data: sent, error } = await supabase
    .from('aitickets_outreach_messages')
    .select('id, lead_id, sent_at')
    .eq('direction', 'out')
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(t.window)
  if (error) throw new Error(`auto-pause: ${error.message}`)
  const sends = sent?.length || 0
  if (!sends) return { paused: false, sends: 0 }
  const leadIds = [...new Set(sent.map((m) => m.lead_id).filter(Boolean))]
  const since = sent[sent.length - 1].sent_at
  const { data: events, error: evErr } = await supabase
    .from('aitickets_outreach_events')
    .select('type, lead_id')
    .in('lead_id', leadIds)
    .gte('created_at', since)
    .in('type', ['bounce_hard', 'complaint', 'unsubscribe'])
  if (evErr) throw new Error(`auto-pause: ${evErr.message}`)
  const count = (type) => new Set((events || []).filter((e) => e.type === type).map((e) => e.lead_id)).size
  const rates = {
    bounce: count('bounce_hard') / sends,
    complaint: count('complaint') / sends,
    unsubscribe: count('unsubscribe') / sends,
  }
  const reasons = []
  if (rates.complaint > t.complaint) reasons.push(`quejas ${(rates.complaint * 100).toFixed(1)}%`)
  if (sends >= t.minSample && rates.bounce > t.bounce) reasons.push(`rebotes ${(rates.bounce * 100).toFixed(1)}%`)
  if (sends >= t.minSample && rates.unsubscribe > t.unsubscribe) reasons.push(`bajas ${(rates.unsubscribe * 100).toFixed(1)}%`)
  if (!reasons.length) return { paused: false, sends, rates }

  const reason = `Auto-pausa: ${reasons.join(', ')} en los últimos ${sends} envíos`
  if (!(await isPaused(supabase))) {
    await setPaused(supabase, true, reason)
    await supabase.from('aitickets_outreach_events').insert({ type: 'auto_paused', payload: { rates, sends, reasons } })
    await notifyOutreach(`⛔ Outreach pausado automáticamente. ${reason}. Revisa y despausa en aitickets_outreach_state (key=paused).`)
  }
  return { paused: true, sends, rates, reason }
}
