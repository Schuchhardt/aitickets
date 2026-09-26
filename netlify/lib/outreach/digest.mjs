// Resumen diario del outreach para Slack.
import { getOutreachConfig } from './config.mjs'
import { isPaused } from './guardrails.mjs'
import { legalReady } from '../legal.mjs'
import { selectProvider } from './providers/index.mjs'

async function count(supabase, table, apply) {
  const { count: n, error } = await apply(supabase.from(table).select('id', { count: 'exact', head: true }))
  if (error) return null
  return n || 0
}

export async function buildDigest(supabase, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString()
  const cfg = getOutreachConfig()
  const { dryRun, blockers } = selectProvider(cfg)
  const [newLeads, enriched, invalid, drafts, sent, replies, suppressions, converted, interested] = await Promise.all([
    count(supabase, 'aitickets_leads', (q) => q.gte('created_at', since)),
    count(supabase, 'aitickets_leads', (q) => q.eq('status', 'enriched')),
    count(supabase, 'aitickets_leads', (q) => q.eq('status', 'invalid').gte('updated_at', since)),
    count(supabase, 'aitickets_outreach_messages', (q) => q.eq('direction', 'out').eq('status', 'draft').gte('created_at', since)),
    count(supabase, 'aitickets_outreach_messages', (q) => q.eq('direction', 'out').eq('status', 'sent').gte('created_at', since)),
    count(supabase, 'aitickets_outreach_messages', (q) => q.eq('direction', 'in').gte('created_at', since)),
    count(supabase, 'aitickets_suppressions', (q) => q.gte('created_at', since)),
    count(supabase, 'aitickets_leads', (q) => q.eq('status', 'converted').gte('updated_at', since)),
    count(supabase, 'aitickets_leads', (q) => q.eq('status', 'interested').gte('updated_at', since)),
  ])
  const { data: intents } = await supabase
    .from('aitickets_outreach_messages')
    .select('ai_intent')
    .eq('direction', 'in')
    .gte('created_at', since)
  const byIntent = {}
  for (const r of intents || []) byIntent[r.ai_intent || 'pendiente'] = (byIntent[r.ai_intent || 'pendiente'] || 0) + 1
  let paused = null
  try { paused = await isPaused(supabase) } catch { /* tabla ausente */ }

  const lines = [
    `📊 *Outreach — últimas 24 h*`,
    `Modo: ${!cfg.enabled ? 'APAGADO' : dryRun ? `dry-run (${blockers.join(', ') || 'dry_run'})` : cfg.provider}${paused ? ' · ⛔ PAUSADO' : ''}${legalReady() ? '' : ' · falta dirección legal'}`,
    `Leads nuevos: ${newLeads ?? '—'} · listos para contactar: ${enriched ?? '—'} · descartados: ${invalid ?? '—'}`,
    `Borradores: ${drafts ?? '—'} · enviados: ${sent ?? '—'} · respuestas: ${replies ?? '—'}${Object.keys(byIntent).length ? ` (${Object.entries(byIntent).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}`,
    `Interesados: ${interested ?? '—'} · convertidos: ${converted ?? '—'} · supresiones nuevas: ${suppressions ?? '—'}`,
  ]
  // Alerta si hay envíos reales pero ningún webhook llegó en 7 días (URL/secreto mal configurado en Instantly):
  // sin webhook no hay supresión de rebotes/bajas ni auto-pausa.
  if (!dryRun) {
    const week = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString()
    const [sentWeek, hooksWeek, pendingBlocks] = await Promise.all([
      count(supabase, 'aitickets_outreach_events', (q) => q.eq('type', 'sent').gte('created_at', week)),
      count(supabase, 'aitickets_outreach_events', (q) => q.ilike('type', 'webhook:%').gte('created_at', week)),
      count(supabase, 'aitickets_outreach_events', (q) => q.eq('type', 'provider_block_pending')),
    ])
    if (sentWeek && hooksWeek === 0) lines.push(`⚠️ ${sentWeek} envíos en 7 días y 0 webhooks recibidos: revisa el webhook de Instantly (URL y OUTREACH_WEBHOOK_SECRET).`)
    if (pendingBlocks) lines.push(`🚨 Bajas pendientes de bloquear en Instantly: ${pendingBlocks}.`)
  }
  return lines.join('\n')
}
