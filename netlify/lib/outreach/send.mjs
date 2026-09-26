// Corrida de envío: toma un lote de leads con acción vencida, revisa guardarraíles, redacta y envía
// (o, en dry-run, publica el borrador en Slack).
import { getOutreachConfig } from './config.mjs'
import { composeFollowup, composeInitial } from './compose.mjs'
import { addBusinessDays, bumpCounter, canSend, checkAutoPause, counterKeys, isPaused, isWithinSendWindow, readCounter } from './guardrails.mjs'
import { createRunBudget } from './llm.mjs'
import { notifyOutreach } from './notify.mjs'
import { selectProvider } from './providers/index.mjs'
import { INSTANTLY_SEQUENCE_FOLLOWUPS } from './providers/instantly.mjs'

const MAX_RUN_MS = 12 * 60 * 1000 // las background functions tienen 15 min
const STOP_REASONS = new Set(['outreach_disabled', 'paused', 'outside_send_window', 'daily_cap', 'mailbox_cap', 'guardrail_error',
  'dry_run', 'provider_dryrun', 'legal_not_ready', 'lia_not_approved'])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function updateLead(supabase, id, patch) {
  const { error } = await supabase.from('aitickets_leads').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('[outreach] lead update:', error.message)
}

/** Libera el "lease" de 30 min que puso aitickets_claim_outreach_batch para que se reintente luego. */
async function release(supabase, lead) {
  await updateLead(supabase, lead.id, { next_action_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
}

export async function runSendBatch({ supabase, now = new Date() } = {}) {
  const started = Date.now()
  const cfg = getOutreachConfig()
  if (!cfg.enabled) return { skipped: 'outreach_disabled' }
  // Sin secreto de baja no hay enlace de baja firmado: ningún correo (ni borrador) pasaría la validación.
  if (!process.env.OUTREACH_UNSUB_SECRET) return { skipped: 'missing_OUTREACH_UNSUB_SECRET' }
  const { provider, dryRun, blockers } = selectProvider(cfg)
  if (!dryRun) {
    const pause = await checkAutoPause(supabase)
    if (pause.paused) return { skipped: 'auto_paused', reason: pause.reason }
  }
  if (await isPaused(supabase)) return { skipped: 'paused' }
  if (!isWithinSendWindow(now, cfg)) return { skipped: 'outside_send_window' }

  const dailyKey = dryRun ? counterKeys.draftsToday(now) : counterKeys.sentToday(now)
  const remaining = cfg.dailyCap - (await readCounter(supabase, dailyKey))
  if (remaining <= 0) return { skipped: 'daily_cap' }
  const limit = Math.min(remaining, dryRun ? 5 : 2)

  const { data: batch, error } = await supabase.rpc('aitickets_claim_outreach_batch', { p_limit: limit })
  if (error) throw new Error(`claim batch: ${error.message}`)
  const summary = { mode: dryRun ? 'dry_run' : provider.name, blockers, claimed: batch?.length || 0, sent: 0, drafts: 0, skipped: {}, failed: 0 }
  const budget = createRunBudget(cfg)

  for (const [i, lead] of (batch || []).entries()) {
    if (Date.now() - started > MAX_RUN_MS) { await release(supabase, lead); continue }
    const check = await canSend(supabase, lead, new Date(), { cfg, dryRun })
    if (!check.ok) {
      summary.skipped[check.reason] = (summary.skipped[check.reason] || 0) + 1
      if (check.reason === 'suppressed') await updateLead(supabase, lead.id, { status: 'suppressed', next_action_at: null })
      else if (check.reason === 'already_customer') await updateLead(supabase, lead.id, { status: 'converted', next_action_at: null })
      else if (check.reason === 'sequence_complete') await updateLead(supabase, lead.id, { status: 'lost', next_action_at: null })
      else if (check.reason === 'recontact_window' || check.reason === 'no_email' || check.reason === 'country_not_enabled') {
        await updateLead(supabase, lead.id, { next_action_at: null })
      } else await release(supabase, lead)
      if (STOP_REASONS.has(check.reason)) {
        for (const rest of batch.slice(i + 1)) await release(supabase, rest)
        break
      }
      continue
    }

    const step = Number(lead.sequence_step) || 0
    const mail = step === 0 ? await composeInitial({ supabase, budget, lead, cfg }) : composeFollowup({ lead, step, cfg })
    if (!mail.validation.ok) {
      summary.failed++
      await supabase.from('aitickets_outreach_messages').insert({
        lead_id: lead.id, direction: 'out', step, provider: provider.name, subject: mail.subject, body_text: mail.text,
        status: 'failed', error: `validación: ${mail.validation.errors.join('; ')}`.slice(0, 1000),
      })
      await updateLead(supabase, lead.id, { next_action_at: null })
      await notifyOutreach(`⚠️ Correo para ${lead.email} no pasó la validación: ${mail.validation.errors.join('; ')}`)
      continue
    }

    // Con Instantly la secuencia completa (inicial + seguimientos) se entrega de una vez como variables, y
    // la campaña tiene un número FIJO de pasos: se construyen TODOS. Si alguno no pasa la validación no se
    // inscribe al lead (falla cerrado): un paso con variable vacía saldría sin pie legal ni enlace de baja.
    let followups = []
    if (step === 0 && !dryRun && provider.name === 'instantly') {
      const composed = Array.from({ length: INSTANTLY_SEQUENCE_FOLLOWUPS }, (_, k) => composeFollowup({ lead, step: k + 1, cfg }))
      const bad = composed.map((f, k) => (f.validation.ok ? null : `seguimiento ${k + 1}: ${f.validation.errors.join('; ')}`)).filter(Boolean)
      if (bad.length) {
        summary.failed++
        await supabase.from('aitickets_outreach_messages').insert({
          lead_id: lead.id, direction: 'out', step, provider: provider.name, subject: mail.subject, body_text: mail.text,
          status: 'failed', error: `validación: ${bad.join(' | ')}`.slice(0, 1000),
        })
        await updateLead(supabase, lead.id, { next_action_at: null })
        await notifyOutreach(`⚠️ No se inscribió a ${lead.email} en Instantly: ${bad.join(' | ')}`)
        continue
      }
      followups = composed.map((f) => ({ subject: f.subject, text: f.text }))
    }

    let result
    try {
      result = await provider.sendInitial({ lead, subject: mail.subject, text: mail.text, step, followups })
    } catch (err) {
      summary.failed++
      await supabase.from('aitickets_outreach_messages').insert({
        lead_id: lead.id, direction: 'out', step, provider: provider.name, subject: mail.subject, body_text: mail.text,
        status: 'failed', error: String(err?.message || err).slice(0, 1000),
      })
      await updateLead(supabase, lead.id, { next_action_at: addBusinessDays(new Date(), 1).toISOString() })
      await notifyOutreach(`⚠️ Falló el envío a ${lead.email}: ${String(err?.message || err).slice(0, 300)}`)
      continue
    }

    const sentAt = new Date()
    const { data: msg } = await supabase
      .from('aitickets_outreach_messages')
      .insert({
        lead_id: lead.id, direction: 'out', step, provider: provider.name, provider_message_id: result.providerMessageId,
        thread_id: result.threadId, mailbox: result.mailbox, subject: mail.subject, body_text: mail.text,
        status: result.status, sent_at: result.status === 'sent' ? sentAt.toISOString() : null,
        ai_payload: { used_llm: Boolean(mail.usedLlm) },
      })
      .select('id')
      .single()
    await bumpCounter(supabase, dailyKey, 1)

    if (result.status === 'draft') {
      summary.drafts++
      // Dry-run: no cuenta como contacto. Se vuelve a proponer en 3 días hábiles como máximo.
      await updateLead(supabase, lead.id, { next_action_at: addBusinessDays(sentAt, 3).toISOString() })
      continue
    }

    summary.sent++
    await supabase.from('aitickets_outreach_events').insert({ lead_id: lead.id, message_id: msg?.id || null, type: 'sent', payload: { step, provider: provider.name } })
    const nextStep = result.sequenceManagedByProvider ? cfg.maxFollowups + 1 : step + 1
    const nextAt = !result.sequenceManagedByProvider && step < cfg.maxFollowups
      ? addBusinessDays(sentAt, cfg.followupDelaysDays[step] || 7).toISOString()
      : null
    await updateLead(supabase, lead.id, { status: 'contacted', sequence_step: nextStep, last_contacted_at: sentAt.toISOString(), next_action_at: nextAt })

    // Espaciado aleatorio entre envíos reales (no en dry-run), sin pasar el tiempo máximo.
    if (i < batch.length - 1) {
      const { min, max } = cfg.spacingSeconds
      const wait = (min + Math.random() * (max - min)) * 1000
      if (Date.now() - started + wait < MAX_RUN_MS) await sleep(wait)
    }
  }
  summary.llm = { tokens: budget.used, calls: budget.calls }
  return summary
}
