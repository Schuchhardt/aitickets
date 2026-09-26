// Cortar el envío en el proveedor (Instantly) cuando alguien se da de baja.
// Con Instantly la secuencia completa (ait_followup1/2) queda programada en el proveedor al primer envío,
// así que suprimir en nuestra BD no basta: hay que bloquear el email en el workspace y eliminar el lead
// de la campaña. Si falla (endpoint caído, clave inválida, etc.) NO se ignora: se avisa por Slack y queda
// un evento 'provider_block_pending' que outreach-tick reintenta hasta que funcione ('provider_block_done').
import { isFreeMailDomain, normalizeEmail, registrableDomain } from './domains.mjs'
import { notifyOutreach } from './notify.mjs'
import * as instantly from './providers/instantly.mjs'

const PENDING = 'provider_block_pending'
const DONE = 'provider_block_done'

/** Ids de lead en Instantly (providerMessageId del paso 0) de los envíos reales a este lead/email. */
async function instantlyLeadIds(supabase, { leadId, email }) {
  let ids = leadId ? [leadId] : []
  if (!ids.length && email) {
    const { data } = await supabase.from('aitickets_leads').select('id').eq('email', email)
    ids = (data || []).map((r) => r.id)
  }
  if (!ids.length) return { leadIds: [], sentViaInstantly: false }
  const { data, error } = await supabase
    .from('aitickets_outreach_messages')
    .select('provider_message_id, step')
    .in('lead_id', ids)
    .eq('direction', 'out')
    .eq('provider', 'instantly')
    .not('provider_message_id', 'is', null)
  if (error) throw new Error(`messages: ${error.message}`)
  const rows = data || []
  // Solo el paso 0 (sendInitial) crea el lead en Instantly; las respuestas guardan ids de correo.
  const leadIdsAtProvider = [...new Set(rows.filter((r) => r.step === 0).map((r) => r.provider_message_id))]
  return { leadIds: leadIdsAtProvider, sentViaInstantly: rows.length > 0 }
}

async function attempt(supabase, { email, leadId, timeoutMs }) {
  const { leadIds, sentViaInstantly } = await instantlyLeadIds(supabase, { leadId, email })
  if (!process.env.INSTANTLY_API_KEY) {
    // Sin clave no se puede bloquear; solo es un problema si alguna vez se envió por Instantly.
    return sentViaInstantly ? { ok: false, error: 'INSTANTLY_API_KEY no configurado' } : { ok: true, skipped: true }
  }
  const blocked = await instantly.blockEmail(email, { timeoutMs })
  let deleted = true
  for (const id of leadIds) deleted = (await instantly.deleteLead(id, { timeoutMs })) && deleted
  if (blocked && deleted) return { ok: true }
  return { ok: false, error: `${blocked ? '' : 'blocklist falló; '}${deleted ? '' : 'eliminar lead de campaña falló'}`.trim() }
}

/**
 * Bloquea el email en el proveedor. Nunca lanza: en caso de fallo avisa por Slack y deja un pendiente.
 * @param {any} supabase cliente service role
 * @param {{email: string, leadId?: string | null, source?: string}} p
 * @returns {Promise<{ok: boolean, pending?: boolean, skipped?: boolean}>}
 */
export async function blockAtProvider(supabase, { email, leadId = null, source = '' }) {
  const e = normalizeEmail(email)
  if (!e) return { ok: false }
  let r
  try {
    r = await attempt(supabase, { email: e, leadId })
  } catch (err) {
    r = { ok: false, error: String(err?.message || err) }
  }
  if (r.ok) return r
  let queued = false
  try {
    const { error } = await supabase.from('aitickets_outreach_events').insert({
      lead_id: leadId || null,
      type: PENDING,
      payload: { email: e, source: String(source).slice(0, 80), error: String(r.error || '').slice(0, 300), attempts: 1 },
    })
    if (error) throw new Error(error.message)
    queued = true
  } catch (err) {
    console.error('[outreach] provider_block_pending:', err?.message)
  }
  await notifyOutreach(`🚨 Baja de ${e} registrada en AI Tickets, pero NO se pudo bloquear en Instantly (${r.error || 'error'}). ${queued ? 'Se reintentará automáticamente; ' : 'NO quedó en cola de reintento: bloquéalo a mano. '}Revísalo en Instantly para que no reciba seguimientos.`)
  return { ok: false, pending: true }
}

/**
 * Opt-out por dominio (formulario /bot): bloquea en el proveedor cada email de los leads de ese dominio
 * (columna domain o email @dominio). blockAtProvider ya omite los que nunca se enviaron por Instantly
 * cuando no hay clave, y deja pendiente + Slack si falla. Nunca lanza.
 */
export async function blockDomainAtProvider(supabase, { domain, source = '' }) {
  const d = registrableDomain(String(domain || ''))
  if (!d || isFreeMailDomain(d)) return { ok: true, emails: 0 }
  const emails = new Set()
  try {
    const byDomain = await supabase.from('aitickets_leads').select('email').eq('domain', d).not('email', 'is', null).limit(50)
    if (byDomain.error) throw new Error(byDomain.error.message)
    const byEmail = await supabase.from('aitickets_leads').select('email').ilike('email', `%@${d.replace(/[\\%_]/g, (c) => `\\${c}`)}`).limit(50)
    if (byEmail.error) throw new Error(byEmail.error.message)
    for (const r of [...(byDomain.data || []), ...(byEmail.data || [])]) {
      const e = normalizeEmail(r.email)
      if (e) emails.add(e)
    }
  } catch (err) {
    await notifyOutreach(`🚨 Opt-out del dominio ${d} registrado, pero no se pudieron listar sus leads para bloquearlos en Instantly (${String(err?.message || err).slice(0, 200)}). Revísalo a mano.`)
    return { ok: false, emails: 0 }
  }
  let ok = true
  for (const email of emails) ok = (await blockAtProvider(supabase, { email, source })).ok !== false && ok
  return { ok, emails: emails.size }
}

/**
 * Reintenta los bloqueos pendientes (llamado desde outreach-tick, aunque OUTREACH_ENABLED=false).
 * Con presupuesto de tiempo: la función programada muere a los 30 s, así que no se empieza una fila nueva
 * pasado `budgetMs`, y cada llamada a Instantly usa un timeout corto.
 */
export async function retryPendingBlocks(supabase, { limit = 5, budgetMs = 8_000, callTimeoutMs = 4_000 } = {}) {
  const started = Date.now()
  const { data, error } = await supabase
    .from('aitickets_outreach_events')
    .select('id, lead_id, payload')
    .eq('type', PENDING)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`pending blocks: ${error.message}`)
  const out = { retried: 0, done: 0 }
  for (const row of data || []) {
    if (Date.now() - started > budgetMs) {
      out.outOfTime = true
      break
    }
    const email = normalizeEmail(row.payload?.email)
    out.retried++
    let r
    try {
      r = email ? await attempt(supabase, { email, leadId: row.lead_id, timeoutMs: callTimeoutMs }) : { ok: true }
    } catch (err) {
      r = { ok: false, error: String(err?.message || err) }
    }
    if (r.ok) {
      out.done++
      await supabase.from('aitickets_outreach_events').update({ type: DONE, payload: { ...(row.payload || {}), done_at: new Date().toISOString() } }).eq('id', row.id)
      continue
    }
    const attempts = (Number(row.payload?.attempts) || 1) + 1
    await supabase.from('aitickets_outreach_events').update({ payload: { ...(row.payload || {}), attempts, error: String(r.error || '').slice(0, 300) } }).eq('id', row.id)
    // Recordatorio a un humano cada 6 intentos (~2 h con el tick cada 20 min).
    if (attempts % 6 === 0) await notifyOutreach(`🚨 Sigue sin poder bloquearse ${email} en Instantly (${attempts} intentos): ${r.error || 'error'}. Bloquéalo a mano.`)
  }
  return out
}
