// Vigilancia de riesgo y liberación de fondos (la corre netlify/functions/funds-watch cada hora). Avisa a Slack:
//   1) Riesgo: recalcula el score de los eventos publicados que no han terminado (event-risk.mjs) y avisa cuando uno
//      pasa a riesgo ALTO.
//   2) Función sin check-ins: una función con entradas pagadas que terminó hace entre 2 y 26 h con menos del
//      CHECKIN_ALERT_THRESHOLD de ingresos registrados (lo vendido quedará retenido hasta que el productor acredite).
//   3) Pico de reclamos/contracargos: DISPUTE_SPIKE_EVENT o más abiertos en 24 h para un evento, o DISPUTE_SPIKE_TOTAL
//      en total.
// Cada aviso se registra una sola vez en notification_log (channel 'slack', type ops_*), así no se repite.
import { zonedDateTimeToUtc } from './dates.mjs'
import { refreshEventRisk } from './event-risk.mjs'
import { notifySlack } from './slack.mjs'

export const CHECKIN_ALERT_THRESHOLD = 0.3
export const DISPUTE_SPIKE_EVENT = 3
export const DISPUTE_SPIKE_TOTAL = 5

const MISSING = ['42P01', 'PGRST205', '42703', 'PGRST204']
const isMissing = (err) => MISSING.includes(String(err?.code || ''))

async function alreadyLogged(supabase, eventId, type) {
  const { data, error } = await supabase.from('notification_log').select('id').eq('event_id', eventId).eq('type', type).eq('channel', 'slack').limit(1)
  if (error) return false
  return Boolean(data && data.length)
}

async function logOnce(supabase, eventId, type) {
  const { error } = await supabase.from('notification_log').insert({ event_id: eventId, type, channel: 'slack', status: 'sent' })
  if (error) console.warn('notification_log (funds-watch):', error.message)
}

/** Fin de una función en UTC (fecha + hora de término o 23:59, hora de Chile; cruza la medianoche si corresponde). */
// Misma regla que functionEnd() de src/lib/producer-api/ledger.ts.
export function endOf(fn) {
  if (!fn?.date) return null
  const start = String(fn.start_time || '00:00')
  const endTime = fn.end_time ? String(fn.end_time) : '23:59'
  let end = zonedDateTimeToUtc(String(fn.date).slice(0, 10), endTime)
  if (!end) return null
  if (fn.end_time && endTime.slice(0, 5) < start.slice(0, 5)) end = new Date(end.getTime() + 86400000)
  return end
}

export async function watchRisk(supabase, { now = new Date(), limit = 300 } = {}) {
  const { data: events, error } = await supabase
    .from('events')
    .select('id, name, slug, organization_id, end_date')
    .eq('status', 'published')
    .is('cancelled_at', null)
    .gte('end_date', new Date(now).toISOString())
    .limit(limit)
  if (error) {
    if (isMissing(error)) return { checked: 0, alerted: 0 }
    throw error
  }
  let alerted = 0
  for (const ev of events || []) {
    let risk
    try {
      risk = await refreshEventRisk(supabase, ev.id, { now })
    } catch (err) {
      console.error(`funds-watch riesgo #${ev.id}:`, err?.message)
      continue
    }
    if (risk?.level !== 'high' || !risk.changed) continue
    if (await alreadyLogged(supabase, ev.id, 'ops_risk_high')) continue
    await notifySlack(
      `⚠️ *Evento pasó a riesgo ALTO*\n• *Evento:* ${ev.name} (#${ev.id}, org ${ev.organization_id})\n• *Score:* ${risk.score} · reserva ${risk.reserve_pct}%` +
        `\n• *Señales:* ${risk.signals.map((s) => s.label).join(', ') || '—'}\n• *Link:* https://aitickets.cl/eventos/${ev.slug}`,
    )
    await logOnce(supabase, ev.id, 'ops_risk_high')
    alerted += 1
  }
  return { checked: (events || []).length, alerted }
}

export async function watchLowCheckins(supabase, { now = new Date() } = {}) {
  const nowMs = new Date(now).getTime()
  const from = new Date(nowMs - 3 * 86400000).toISOString().slice(0, 10)
  const to = new Date(nowMs).toISOString().slice(0, 10)
  const { data: fns, error } = await supabase.from('event_dates').select('id, event_id, date, start_time, end_time').gte('date', from).lte('date', to).limit(2000)
  if (error) {
    if (isMissing(error)) return { checked: 0, alerted: 0 }
    throw error
  }
  let alerted = 0
  let checked = 0
  for (const fn of fns || []) {
    const end = endOf(fn)
    if (!end) continue
    const hours = (nowMs - end.getTime()) / 3600000
    if (hours < 2 || hours > 26) continue
    checked += 1
    const type = `ops_low_checkins:${fn.id}`
    if (await alreadyLogged(supabase, fn.event_id, type)) continue
    const { data: tickets } = await supabase.from('event_tickets').select('id').eq('event_id', fn.event_id).eq('event_date_id', fn.id)
    const ticketIds = (tickets || []).map((t) => t.id)
    if (!ticketIds.length) continue
    const { data: attendees } = await supabase
      .from('event_attendees')
      .select('id, status, validated_at, event_order_id')
      .eq('event_id', fn.event_id)
      .in('event_ticket_id', ticketIds)
      .not('event_order_id', 'is', null)
      .limit(20000)
    const sold = (attendees || []).filter((a) => a.status !== 'cancelled')
    if (!sold.length) continue
    const checkedIn = sold.filter((a) => a.validated_at || a.status === 'validated').length
    const ratio = checkedIn / sold.length
    if (ratio >= CHECKIN_ALERT_THRESHOLD) continue
    const { data: ev } = await supabase.from('events').select('id, name, organization_id, cancelled_at').eq('id', fn.event_id).maybeSingle()
    if (!ev || ev.cancelled_at) continue
    await notifySlack(
      `🚪 *Función terminada con pocos check-ins*\n• *Evento:* ${ev.name} (#${ev.id}, org ${ev.organization_id})\n• *Función:* ${fn.date} ${String(fn.start_time || '').slice(0, 5)}` +
        `\n• *Check-ins:* ${checkedIn} de ${sold.length} entradas (${Math.round(ratio * 100)}%)\n• Lo vendido queda retenido hasta que el productor acredite que se realizó.`,
    )
    await logOnce(supabase, fn.event_id, type)
    alerted += 1
  }
  return { checked, alerted }
}

export async function watchDisputes(supabase, { now = new Date() } = {}) {
  const since = new Date(new Date(now).getTime() - 86400000).toISOString()
  const { data: disputes, error } = await supabase.from('aitickets_disputes').select('id, event_id, amount, created_at').gte('created_at', since).limit(5000)
  if (error) {
    if (isMissing(error)) return { disputes: 0, alerted: 0 }
    throw error
  }
  const byEvent = new Map()
  for (const d of disputes || []) byEvent.set(d.event_id, (byEvent.get(d.event_id) || 0) + 1)
  const day = new Date(now).toISOString().slice(0, 10)
  const spiking = [...byEvent.entries()].filter(([, n]) => n >= DISPUTE_SPIKE_EVENT)
  const total = (disputes || []).length
  if (!spiking.length && total < DISPUTE_SPIKE_TOTAL) return { disputes: total, alerted: 0 }
  const anchor = spiking[0]?.[0] ?? disputes[0].event_id
  const type = `ops_dispute_spike:${day}`
  if (await alreadyLogged(supabase, anchor, type)) return { disputes: total, alerted: 0 }
  await notifySlack(
    `💳 *Pico de reclamos/contracargos (24 h)*\n• *Total:* ${total}\n` +
      (spiking.length ? `• *Por evento:* ${spiking.map(([id, n]) => `#${id}: ${n}`).join(', ')}\n` : '') +
      '• Revisa aitickets_disputes y considera pausar las ventas o la devolución directa.',
  )
  await logOnce(supabase, anchor, type)
  return { disputes: total, alerted: 1 }
}

export async function runFundsWatch(supabase, opts = {}) {
  const out = {}
  for (const [key, fn] of [
    ['risk', watchRisk],
    ['low_checkins', watchLowCheckins],
    ['disputes', watchDisputes],
  ]) {
    try {
      out[key] = await fn(supabase, opts)
    } catch (err) {
      console.error(`funds-watch ${key}:`, err?.message)
      out[key] = { error: String(err?.message || err) }
    }
  }
  return out
}
