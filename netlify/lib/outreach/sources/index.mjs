// Orquestación del descubrimiento: corre las fuentes habilitadas (en aitickets_lead_sources) como máximo
// una vez al día, deduplica por dominio registrable y email, y registra cursor/last_result.
import { getOutreachConfig } from '../config.mjs'
import { isFreeMailDomain, normalizeEmail } from '../domains.mjs'
import { isDomainSuppressed } from '../guardrails.mjs'
import * as chilecultura from './chilecultura.mjs'
import * as places from './places.mjs'
import * as ticketing from './ticketing.mjs'
import * as websearch from './websearch.mjs'

/** Fuentes automáticas (inbound_form, csv_import y referral entran por otros caminos). */
export const DISCOVERY_SOURCES = { chilecultura, places, websearch, ticketing }
const MIN_HOURS_BETWEEN_RUNS = 20

/**
 * Inserta o actualiza un lead a partir de un candidato. Devuelve 'inserted' | 'updated' | 'skipped'.
 * - Dedupe por dominio (nunca por dominio de correo gratuito) y por lower(email).
 * - Nunca revive leads suprimidos, convertidos, perdidos o inválidos.
 */
export async function upsertCandidate(supabase, sourceKey, c) {
  const domain = c.domain && !isFreeMailDomain(c.domain) ? c.domain : null
  const email = normalizeEmail(c.email) || null
  if (domain && (await isDomainSuppressed(supabase, domain))) return 'skipped'

  let existing = null
  if (domain) {
    const { data } = await supabase.from('aitickets_leads').select('id, status, source_refs, upcoming_event').eq('domain', domain).maybeSingle()
    existing = data
  }
  if (!existing && email) {
    const { data } = await supabase.from('aitickets_leads').select('id, status, source_refs, upcoming_event').eq('email', email).maybeSingle()
    existing = data
  }
  const ref = c.source_ref || { source: sourceKey, seen_at: new Date().toISOString() }
  if (existing) {
    if (['suppressed', 'converted', 'lost', 'invalid'].includes(existing.status)) return 'skipped'
    const refs = Array.isArray(existing.source_refs) ? existing.source_refs : []
    const already = refs.some((r) => r?.source === ref.source && r?.url === ref.url)
    const patch = { updated_at: new Date().toISOString() }
    if (!already) patch.source_refs = [...refs, ref].slice(-20)
    // Actualiza el evento solo si el lead todavía no fue contactado (para no cambiar la personalización a mitad de secuencia).
    if (c.upcoming_event && ['new', 'enriched'].includes(existing.status)) patch.upcoming_event = c.upcoming_event
    await supabase.from('aitickets_leads').update(patch).eq('id', existing.id)
    return 'updated'
  }
  const { error } = await supabase.from('aitickets_leads').insert({
    org_name: c.org_name || null,
    domain,
    website: c.website || null,
    country: c.country || 'CL',
    city: c.city || null,
    categories: c.categories || [],
    email,
    email_source_url: email ? c.email_source_url || ref.url || null : null,
    email_found_at: email ? new Date().toISOString() : null,
    current_ticketing: c.current_ticketing || null,
    upcoming_event: c.upcoming_event || null,
    source: sourceKey,
    source_refs: [ref],
    status: 'new',
  })
  if (error) {
    if (error.code === '23505') return 'skipped'
    throw new Error(`lead insert: ${error.message}`)
  }
  return 'inserted'
}

/** Corre el descubrimiento. `force` ignora la espera de 20 h entre corridas de una fuente. */
export async function runDiscovery({ supabase, force = false } = {}) {
  const cfg = getOutreachConfig()
  if (!cfg.enabled) return { skipped: 'outreach_disabled' }
  const { data: rows, error } = await supabase.from('aitickets_lead_sources').select('key, enabled, last_run_at')
  if (error) throw new Error(`lead_sources: ${error.message}`)
  const results = {}
  let budgetLeft = cfg.discoverMaxPerRun
  for (const row of rows || []) {
    const source = DISCOVERY_SOURCES[row.key]
    if (!source || !row.enabled) continue
    if (!force && row.last_run_at && Date.now() - new Date(row.last_run_at).getTime() < MIN_HOURS_BETWEEN_RUNS * 3600_000) {
      results[row.key] = { skipped: 'ran_recently' }
      continue
    }
    if (budgetLeft <= 0) break
    const summary = { inserted: 0, updated: 0, skipped: 0 }
    let lastResult
    try {
      const { candidates, stats } = await source.discover({ maxCandidates: budgetLeft, cfg })
      for (const c of candidates) {
        const r = await upsertCandidate(supabase, row.key, c)
        summary[r]++
        if (r === 'inserted') budgetLeft--
        if (budgetLeft <= 0) break
      }
      lastResult = { ok: true, ...summary, stats, at: new Date().toISOString() }
    } catch (err) {
      lastResult = { ok: false, error: String(err?.message || err).slice(0, 500), at: new Date().toISOString() }
    }
    await supabase
      .from('aitickets_lead_sources')
      .update({ last_run_at: new Date().toISOString(), last_result: lastResult, cursor: { last_run: new Date().toISOString() } })
      .eq('key', row.key)
    results[row.key] = lastResult
  }
  return results
}
