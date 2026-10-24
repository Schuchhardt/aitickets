// Envío del reporte semanal a productores (background function send-weekly-reports-background, los domingos).
// Las reglas y cifras están en weekly-report.mjs, las ideas con IA en weekly-report-ai.mjs y el correo en
// emails/weekly-report.mjs. Aquí: qué productoras, reclamo de la semana, destinatarios, envío y registro.
//
// - Productoras: las que tienen al menos un evento que entra en el reporte (isReportableEvent). Hasta
//   MAX_EVENTS_PER_ORG eventos por productora (los que vienen antes) y MAX_EVENTS_PER_EMAIL por correo.
// - Una vez por productora y semana: la fila de aitickets_weekly_reports (organization_id + week_start únicos) se
//   reclama ANTES de enviar. Una fila 'sending' de más de STALE_SENDING_MINUTES (la invocación murió) o 'failed' se
//   reintenta hasta MAX_ATTEMPTS: cada correo lleva Idempotency-Key por persona y semana (Resend no lo repite).
// - Destinatarios: miembros activos con rol admin o producer (dueños de la productora), con correo válido, sin quienes
//   se dieron de baja (aitickets_user_email_optouts topic 'weekly_report'). Si alguien del equipo está asignado solo a
//   algunos eventos (aitickets_event_staff), su correo trae solo esos.
// - Una llamada a la IA por productora; sin IA o si falla, sugerencias con reglas fijas (el correo sale igual).
// - Anuncios creados desde AI Tickets (Zernio): los que corrieron en la semana van con su gasto de la semana (Zernio)
//   y las entradas que vendieron (utm_campaign=ad-<id>); la idea de publicidad lleva a crear o ver el anuncio en el panel.
// - previewTo / dryRun (disparo manual): arman el reporte de UNA productora sin tocar el registro, para revisarlo
//   cualquier día; previewTo lo manda solo a esa dirección.
import { fetchAllRows } from './supabase.mjs'
import { sendEmail as defaultSendEmail, SITE_URL, formatRecipient, isValidEmail } from './mailer.mjs'
import { renderWeeklyReportEmail } from './emails/index.mjs'
import { getStaffEventIds } from './event-staff.mjs'
import { formatInstantLong } from './dates.mjs'
import { normalizePersonName, splitFullName } from './buyer-name.mjs'
import { signWeeklyReportOptoutToken } from './review-token.mjs'
import {
  REPORTS_TABLE,
  USER_OPTOUTS_TABLE,
  WEEKLY_REPORT_TOPIC,
  REPORT_RECIPIENT_ROLES,
  MAX_EVENTS_PER_ORG,
  MAX_EVENTS_PER_EMAIL,
  reportWeek,
  weekLabel,
  isReportableEvent,
  computeEventMetrics,
  summarizeEvents,
  sortEventsForReport,
  trackingLink,
} from './weekly-report.mjs'
import { generateAiSuggestions, mergeSuggestions } from './weekly-report-ai.mjs'
import { adAnalyticsSummary, adsEnabled } from './zernio-ads.mjs'

export const STALE_SENDING_MINUTES = 20
export const MAX_ATTEMPTS = 3

const EVENT_COLUMNS = 'id, name, title, slug, status, organization_id, created_at, start_date, end_date, cancelled_at, archived_at'
const ORDER_COLUMNS = 'created_at, amount, ticket_qty, ticket_details, payment_provider, ref, utm_source, utm_medium, utm_campaign, discount_code'
const VISIT_COLUMNS = 'created_at, ip_hash, referrer, utm_source, utm_medium'

const MAX_ADS_PER_ORG = 20
const NETWORK_LABEL = { instagram: 'Instagram', facebook: 'Facebook', meta: 'Facebook e Instagram', tiktok: 'TikTok', whatsapp: 'WhatsApp', email: 'tu correo', google: 'Google', x: 'X', youtube: 'YouTube', promoter: 'tu promotor', other: 'otros canales' }

const siteHost = () => {
  try {
    return new URL(SITE_URL).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export const eventPublicUrl = (slug) => (slug ? `${SITE_URL}/eventos/${encodeURIComponent(slug)}` : '')
export const weeklyReportUnsubscribeUrls = (token) =>
  token ? { page: `${SITE_URL}/reporte-semanal/baja?t=${encodeURIComponent(token)}`, oneClick: `${SITE_URL}/api/reporte-semanal/baja?t=${encodeURIComponent(token)}` } : null

/** Eventos que entran en el reporte de esta semana, agrupados por productora (los que vienen antes primero). */
async function findReportableEvents(supabase, week, now, organizationIds) {
  const rows = await fetchAllRows(() => {
    let q = supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('status', 'published')
      .gt('end_date', now.toISOString())
      .lt('created_at', week.newEventCutoffAt.toISOString())
    if (organizationIds?.length) q = q.in('organization_id', organizationIds)
    return q.order('id', { ascending: true })
  })
  const byOrg = new Map()
  for (const e of rows) {
    if (e.organization_id == null || !isReportableEvent(e, week, now)) continue
    const orgId = Number(e.organization_id)
    if (!byOrg.has(orgId)) byOrg.set(orgId, [])
    byOrg.get(orgId).push(e)
  }
  for (const [orgId, list] of byOrg) {
    const startsAt = (e) => Date.parse(e.start_date) || Date.parse(e.end_date) || 0
    byOrg.set(orgId, list.sort((a, b) => startsAt(a) - startsAt(b) || a.id - b.id).slice(0, MAX_EVENTS_PER_ORG))
  }
  return byOrg
}

/** Filas de esta semana por productora. Sin la tabla (migración pendiente) no se envía: no habría cómo no repetir. */
async function loadWeekLog(supabase, week) {
  const rows = await fetchAllRows(() =>
    supabase.from(REPORTS_TABLE).select('id, organization_id, status, attempts, claimed_at').eq('week_start', week.weekStart).order('organization_id', { ascending: true })
  ).catch((err) => {
    throw /does not exist|PGRST205|42P01|schema cache/i.test(String(err?.message)) ? new Error(`falta la tabla ${REPORTS_TABLE} (migración 202610250300)`) : err
  })
  return new Map(rows.map((r) => [Number(r.organization_id), r]))
}

/** ¿Se puede volver a tomar esta fila? 'failed' o 'sending' abandonada, con intentos disponibles. */
export function isRetryable(row, now = new Date()) {
  if (!row || (Number(row.attempts) || 0) >= MAX_ATTEMPTS) return false
  if (row.status === 'failed') return true
  if (row.status !== 'sending') return false
  const claimed = Date.parse(row.claimed_at)
  return !Number.isFinite(claimed) || now.getTime() - claimed > STALE_SENDING_MINUTES * 60_000
}

/** Reclama la semana de una productora. Devuelve { id, attempts } o null si ya la tiene otra ejecución. */
async function claimReport(supabase, orgId, week, existing, now) {
  const claimedAt = now.toISOString()
  if (!existing) {
    const { data, error } = await supabase
      .from(REPORTS_TABLE)
      .insert({ organization_id: orgId, week_start: week.weekStart, status: 'sending', attempts: 1, claimed_at: claimedAt })
      .select('id')
      .single()
    if (error?.code === '23505') return null
    if (error) throw error
    return { id: data.id, attempts: 1 }
  }
  if (!isRetryable(existing, now)) return null
  const attempts = (Number(existing.attempts) || 0) + 1
  const { data, error } = await supabase
    .from(REPORTS_TABLE)
    .update({ status: 'sending', attempts, claimed_at: claimedAt, error: null })
    .eq('id', existing.id)
    .eq('status', existing.status)
    .eq('claimed_at', existing.claimed_at)
    .select('id')
  if (error) throw error
  return data?.length ? { id: existing.id, attempts } : null
}

async function finishReport(supabase, claim, patch) {
  const { error } = await supabase.from(REPORTS_TABLE).update(patch).eq('id', claim.id)
  if (error) console.error(`weekly-report: no se pudo cerrar el reporte ${claim.id}:`, error.message)
}

/** Dueños de la productora que reciben el reporte, con sus eventos permitidos (null = todos). */
async function loadRecipients(supabase, orgId) {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, email, role, active')
    .eq('organization_id', orgId)
    .in('role', REPORT_RECIPIENT_ROLES)
  if (error) throw error
  const candidates = (users || []).filter((u) => u.active !== false && isValidEmail(String(u.email || '').trim().toLowerCase()))
  if (!candidates.length) return []
  const { data: optouts, error: oError } = await supabase
    .from(USER_OPTOUTS_TABLE)
    .select('user_id')
    .eq('topic', WEEKLY_REPORT_TOPIC)
    .in('user_id', candidates.map((u) => u.id))
  if (oError) throw oError
  const optedOut = new Set((optouts || []).map((o) => Number(o.user_id)))
  const seen = new Set()
  const out = []
  for (const u of candidates) {
    const email = String(u.email).trim().toLowerCase()
    if (optedOut.has(Number(u.id)) || seen.has(email)) continue
    seen.add(email)
    out.push({ id: Number(u.id), name: u.name || '', email, eventIds: await getStaffEventIds(supabase, u.id) })
  }
  return out
}

/**
 * Anuncios de la productora (Zernio) que corrieron en la semana, por evento, con su gasto, clics e impresiones de la
 * semana. Nunca lanza: el reporte sale igual sin anuncios. Sin Zernio configurado, sin la migración 202610250400 o si
 * falla la lectura, ninguno. Si Zernio no responde por un anuncio su gasto queda null (el correo lo muestra sin cifra);
 * tras una caída (red, timeout, 5xx) no se le pregunta por los demás.
 * @returns {Promise<Map<number, any[]>>}
 */
async function loadWeekAds(supabase, organizationId, eventIds, week) {
  try {
    return await loadWeekAdsUnsafe(supabase, organizationId, eventIds, week)
  } catch (err) {
    console.error(`weekly-report: anuncios de la organización ${organizationId}:`, err?.message)
    return new Map()
  }
}

async function loadWeekAdsUnsafe(supabase, organizationId, eventIds, week) {
  const byEvent = new Map()
  if (!adsEnabled() || !eventIds.length) return byEvent
  const { data, error } = await supabase
    .from('ad_campaigns')
    .select('id, event_id, status, ad_type, headline, currency, zernio_ad_id, created_at, end_date')
    .eq('organization_id', organizationId)
    .eq('provider', 'zernio')
    .in('event_id', eventIds)
    .lt('created_at', week.endAt.toISOString())
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    if (['42703', '42P01', 'PGRST204', 'PGRST205'].includes(String(error.code))) return byEvent
    throw error
  }
  const ran = (data || [])
    .filter((a) => a.zernio_ad_id && !['creating', 'error'].includes(a.status) && !(a.end_date && Date.parse(a.end_date) < week.startAt.getTime()))
    .slice(0, MAX_ADS_PER_ORG)
  let zernioDown = false
  for (const a of ran) {
    let stats = null
    if (!zernioDown) {
      try {
        stats = (await adAnalyticsSummary(a.zernio_ad_id, week.weekStart, week.lastDay, { timeoutMs: 10_000 })).summary
      } catch (err) {
        zernioDown = !err?.status || err.status >= 500
        console.warn(`weekly-report: métricas del anuncio ${a.id}:`, err?.status || '', err?.message)
      }
    }
    const row = {
      ...a,
      week_spend: stats ? Number(stats.spend) || 0 : null,
      week_clicks: stats ? Number(stats.clicks) || 0 : null,
      week_impressions: stats ? Number(stats.impressions) || 0 : null,
    }
    const id = Number(a.event_id)
    if (!byEvent.has(id)) byEvent.set(id, [])
    byEvent.get(id).push(row)
  }
  return byEvent
}

/** Órdenes pagadas, visitas de las 2 últimas semanas y tipos de entrada de un evento -> cifras del reporte. */
async function loadEventMetrics(supabase, event, week, now, ads = []) {
  const [orders, visits, ticketsRes] = await Promise.all([
    fetchAllRows(() => supabase.from('event_orders').select(ORDER_COLUMNS).eq('event_id', event.id).eq('status', 'paid').order('created_at', { ascending: true })),
    fetchAllRows(() =>
      supabase
        .from('event_visits')
        .select(VISIT_COLUMNS)
        .eq('event_id', event.id)
        .gte('created_at', week.prevStartAt.toISOString())
        .lt('created_at', week.endAt.toISOString())
        .order('created_at', { ascending: true })
    ),
    supabase.from('event_tickets').select('id, total_quantity, is_gift').eq('event_id', event.id),
  ])
  if (ticketsRes.error) throw ticketsRes.error
  return computeEventMetrics({ event, orders, visits, tickets: ticketsRes.data || [], week, now, ownHosts: [siteHost()].filter(Boolean), ads })
}

/** Datos extra que ve la IA (descripción y lugar). Si falla, las ideas salen igual, solo con las cifras. */
async function loadEventContext(supabase, eventIds) {
  const { data, error } = await supabase.from('events').select('id, description, location').in('id', eventIds)
  if (error) {
    console.warn('weekly-report: sin descripción de los eventos:', error.message)
    return new Map()
  }
  return new Map((data || []).map((e) => [Number(e.id), e]))
}

const startsLabel = (m) => (m.start_date ? formatInstantLong(m.start_date) : '')

/** Sugerencias con link (con seguimiento) y acción al panel, listas para la plantilla. */
function presentSuggestions(m, aiEntry, { adsInApp = false } = {}) {
  const publicUrl = eventPublicUrl(m.slug)
  const ref = m.best_channel?.network === 'promoter' ? m.best_channel.ref : null
  const hasAds = (m.ads || []).length > 0
  return mergeSuggestions(aiEntry?.suggestions, m, { adsInApp }).map((s) => {
    const out = { type: s.type, channel: s.channel, title: s.title, body: s.body, action: null, trackingUrl: '', trackingLabel: '' }
    const channelName = NETWORK_LABEL[s.channel] || 'ese canal'
    if (s.type === 'content') out.action = { href: `${SITE_URL}/dashboard/promote/create?event=${m.event_id}`, label: 'Crear el post con IA' }
    if (s.type === 'offer') out.action = { href: `${SITE_URL}/dashboard/descuentos`, label: 'Crear un código de descuento' }
    if (s.type === 'ads' && adsInApp) {
      // El anuncio se crea (o se ajusta) en el panel y su link ya mide las ventas: no hace falta copiar un link
      out.action = hasAds
        ? { href: `${SITE_URL}/dashboard/promote?tab=ads`, label: 'Ver mis anuncios' }
        : { href: `${SITE_URL}/dashboard/promote/ads/create?event=${m.event_id}`, label: 'Crear el anuncio en AI Tickets' }
      return out
    }
    if (s.type !== 'offer') {
      out.trackingUrl = trackingLink(publicUrl, { channel: s.channel, type: s.type, ref })
      out.trackingLabel = s.type === 'ads' ? 'Link para tus anuncios' : s.channel === 'promoter' ? 'Link de tu promotor' : `Link con seguimiento para ${channelName}`
    }
    return out
  })
}

/** Vista de un evento para la plantilla. */
function presentEvent(m, aiEntry, opts = {}) {
  return {
    event_id: m.event_id,
    name: m.name,
    dateLabel: startsLabel(m),
    daysUntil: m.days_until,
    publicUrl: eventPublicUrl(m.slug),
    analyticsUrl: `${SITE_URL}/dashboard/events/${m.event_id}/analytics`,
    createPostUrl: `${SITE_URL}/dashboard/promote/create?event=${m.event_id}`,
    week: m.week,
    tickets_change_pct: m.tickets_change_pct,
    total_tickets: m.total.tickets,
    capacity: m.capacity,
    sell_through_pct: m.sell_through_pct,
    visits: m.traffic.visits,
    conversion_pct: m.traffic.conversion_pct,
    channels: m.channels.filter((c) => c.tickets > 0 || c.visits > 0).slice(0, 5),
    bestChannel: m.best_channel,
    insight: aiEntry?.insight || '',
    ads: m.ads || [],
    suggestions: presentSuggestions(m, aiEntry, opts),
  }
}

/** Lo que se guarda en aitickets_weekly_reports.summary (soporte; sin datos de compradores). */
function reportSummary({ week, totals, metrics, ai, results }) {
  return {
    week_label: weekLabel(week),
    totals,
    events: metrics.map((m) => ({
      event_id: m.event_id,
      name: m.name,
      tickets: m.week.tickets,
      revenue_clp: m.week.revenue_clp,
      best_channel: m.best_channel?.label || null,
      ads: (m.ads || []).map((a) => ({ id: a.id, spend: a.spend, tickets: a.tickets, revenue_clp: a.revenue_clp })),
    })),
    ai: ai ? { provider: ai.provider, model: ai.model } : null,
    recipients: results,
  }
}

/**
 * Arma y envía el reporte de UNA productora. No toca aitickets_weekly_reports (lo hace runWeeklyReports).
 * @returns {Promise<{ status: 'sent' | 'skipped' | 'failed', reason?: string, sent: number, failed: number, events: number, ai: any, summary: any, preview?: any[] }>}
 */
export async function buildAndSendOrgReport(supabase, { orgId, events, week, now, sendEmail, suggest, previewTo = null, dryRun = false }) {
  const { data: org, error: orgError } = await supabase.from('organizations').select('id, public_name').eq('id', orgId).maybeSingle()
  if (orgError) throw orgError
  const recipients = previewTo ? [{ id: null, name: '', email: previewTo, eventIds: null }] : await loadRecipients(supabase, orgId)
  if (!recipients.length) return { status: 'skipped', reason: 'no_recipients', sent: 0, failed: 0, events: events.length, ai: null, summary: null }

  const adsByEvent = await loadWeekAds(supabase, orgId, events.map((e) => Number(e.id)), week)
  const metrics = []
  for (const e of events) metrics.push(await loadEventMetrics(supabase, e, week, now, adsByEvent.get(Number(e.id)) || []))
  const visibleFor = (r) => sortEventsForReport(r.eventIds ? metrics.filter((m) => r.eventIds.includes(m.event_id)) : metrics)
  const shownIds = new Set(recipients.flatMap((r) => visibleFor(r).slice(0, MAX_EVENTS_PER_EMAIL).map((m) => m.event_id)))
  const shown = metrics.filter((m) => shownIds.has(m.event_id))
  if (!shown.length) return { status: 'skipped', reason: 'no_visible_events', sent: 0, failed: 0, events: metrics.length, ai: null, summary: null }

  const label = weekLabel(week)
  const adsInApp = adsEnabled()
  const orgTotals = summarizeEvents(metrics)
  const context = await loadEventContext(supabase, shown.map((m) => m.event_id))
  let ai = null
  try {
    ai = await suggest({
      orgName: org?.public_name || '',
      weekLabel: label,
      totals: orgTotals,
      adsInApp,
      events: shown.map((m) => ({ metrics: m, context: { startsLabel: startsLabel(m), place: context.get(m.event_id)?.location || null, description: context.get(m.event_id)?.description || '' } })),
    })
  } catch (err) {
    console.error(`weekly-report: sugerencias de la organización ${orgId}:`, err?.message)
  }
  const views = new Map(shown.map((m) => [m.event_id, presentEvent(m, ai?.byEvent?.get(m.event_id), { adsInApp })]))

  const results = []
  const previews = []
  let sent = 0
  let failed = 0
  for (const r of recipients) {
    const visible = visibleFor(r)
    if (!visible.length) continue
    const totals = summarizeEvents(visible)
    const listed = visible.slice(0, MAX_EVENTS_PER_EMAIL).map((m) => views.get(m.event_id)).filter(Boolean)
    const token = r.id ? signWeeklyReportOptoutToken({ userId: r.id }) : ''
    const unsub = weeklyReportUnsubscribeUrls(token)
    const { subject, html, text } = await renderWeeklyReportEmail({
      recipientName: splitFullName(r.name).firstName,
      orgName: org?.public_name || '',
      weekLabel: label,
      // El resumen de la IA habla de toda la productora: solo va a quien ve todos sus eventos
      summary: r.eventIds ? '' : ai?.summary || '',
      totals,
      events: listed,
      moreEvents: visible.length - listed.length,
      dashboardUrl: `${SITE_URL}/dashboard`,
      unsubscribeUrl: unsub?.page,
    })
    if (dryRun) {
      previews.push({ to: r.email, subject, events: listed.map((e) => ({ event_id: e.event_id, suggestions: e.suggestions.map((s) => `${s.type}: ${s.title}`) })) })
      continue
    }
    try {
      await sendEmail({
        to: formatRecipient(normalizePersonName(r.name), r.email),
        subject: previewTo ? `[Vista previa] ${subject}` : subject,
        html,
        text,
        tags: ['weekly-report'],
        ...(unsub ? { headers: { 'List-Unsubscribe': `<${unsub.oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
        ...(previewTo ? {} : { idempotencyKey: `weekly-report-${orgId}-${week.weekStart}-${r.id}` }),
      })
      sent += 1
      results.push({ user_id: r.id, status: 'sent' })
    } catch (err) {
      failed += 1
      results.push({ user_id: r.id, status: 'failed', error: String(err?.message || err).slice(0, 200) })
      console.error(`weekly-report: correo a la persona ${r.id} de la organización ${orgId} falló:`, err?.message)
    }
  }
  const summary = reportSummary({ week, totals: orgTotals, metrics, ai, results })
  if (dryRun) return { status: 'skipped', reason: 'dry_run', sent: 0, failed: 0, events: metrics.length, ai, summary, preview: previews }
  const status = sent ? 'sent' : failed ? 'failed' : 'skipped'
  return { status, ...(status === 'skipped' ? { reason: 'no_visible_events' } : {}), sent, failed, events: metrics.length, ai, summary }
}

/**
 * Envía los reportes de la semana que falten. Nunca lanza por una productora: la registra y sigue.
 * @param {any} supabase cliente con service role
 * @param {{ now?: Date, deadline?: number, sendEmail?: Function, suggest?: Function, organizationIds?: number[] | null,
 *   force?: boolean, previewTo?: string | null, dryRun?: boolean }} [opts]
 *   force: corre aunque no sea domingo (disparo manual; igual no repite una semana ya enviada).
 */
export async function runWeeklyReports(supabase, opts = {}) {
  const { now = new Date(), deadline = Infinity, sendEmail = defaultSendEmail, suggest = generateAiSuggestions, organizationIds = null, force = false, previewTo = null, dryRun = false } = opts
  const week = reportWeek(now)
  const manual = Boolean(previewTo || dryRun)
  const result = { week: week.weekStart, organizations: 0, sent: 0, skipped: 0, failed: 0, emails: 0, emailsFailed: 0, pending: 0, errors: [] }
  if (!week.isSunday && !force && !manual) return { ...result, skipped_run: 'not_sunday' }
  if (manual && organizationIds?.length !== 1) throw new Error('previewTo/dryRun requieren exactamente un organizationId')

  const byOrg = await findReportableEvents(supabase, week, now, organizationIds)
  const log = manual ? new Map() : await loadWeekLog(supabase, week)
  const orgIds = [...byOrg.keys()].sort((a, b) => a - b)
  result.organizations = orgIds.length
  if (manual) result.preview = []

  for (const orgId of orgIds) {
    if (Date.now() > deadline) {
      result.pending += 1
      continue
    }
    let claim = null
    try {
      if (!manual) {
        claim = await claimReport(supabase, orgId, week, log.get(orgId), now)
        if (!claim) continue
      }
      const out = await buildAndSendOrgReport(supabase, { orgId, events: byOrg.get(orgId), week, now, sendEmail, suggest, previewTo, dryRun })
      result.emails += out.sent
      result.emailsFailed += out.failed
      if (out.status === 'sent') result.sent += 1
      else if (out.status === 'failed') result.failed += 1
      else result.skipped += 1
      if (manual) result.preview.push({ organization_id: orgId, ...out, ai: out.ai ? { provider: out.ai.provider, model: out.ai.model } : null })
      if (claim) {
        await finishReport(supabase, claim, {
          status: out.status,
          sent_at: out.status === 'sent' ? new Date().toISOString() : null,
          recipients: out.sent,
          events: out.events,
          ai_provider: out.ai?.provider || 'rules',
          summary: out.summary,
          error: out.status === 'failed' ? 'todos los correos fallaron' : out.reason || null,
        })
      }
    } catch (err) {
      result.failed += 1
      const message = String(err?.message || err).slice(0, 300)
      result.errors.push({ organization_id: orgId, error: message })
      console.error(`weekly-report: organización ${orgId}:`, message)
      if (claim) await finishReport(supabase, claim, { status: 'failed', error: message })
    }
  }
  return result
}
