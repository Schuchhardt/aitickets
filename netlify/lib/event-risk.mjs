// Score de riesgo por evento (Términos para productores §8: reserva para productores nuevos, eventos de alto monto
// o con señales de riesgo). Define el % de reserva que aplica el ledger (src/lib/producer-api/ledger.ts) y si el
// evento debe tener documentos (autorización de la Delegación Presidencial, permiso del lugar, póliza RC).
//
// Señales (cada una suma puntos; el total se acota a 100):
//   new_producer      organización con menos de NEW_PRODUCER_DAYS días o sin eventos anteriores realizados con ventas
//   no_address        el lugar no tiene dirección exacta (ni calle ni coordenadas)
//   large_capacity    aforo (suma de cupos de las entradas o capacidad del lugar) > LARGE_CAPACITY, o evento masivo
//   high_amount       monto potencial (precio × cupos) > HIGH_AMOUNT_CLP
//   sales_spike       ventas de las últimas 24 h muy por sobre el promedio diario anterior
//   shared_buyer      muchos compradores distintos (correo) con un mismo teléfono en el evento
//   device_cluster    muchas tarjetas distintas desde un mismo dispositivo. HOY NO HAY DATOS: ni Flow ni el checkout
//                     guardan huella de tarjeta o dispositivo; la señal se activa si quien llama pasa
//                     input.deviceCluster = true (gancho para cuando exista ese dato).
// Nivel: low < 25 ≤ medium < 50 ≤ high. Reserva: low 0%, medium 30%, high 100% (hasta 60 días después de la función).
//
// refreshEventRisk() guarda el resultado en events (risk_score, risk_level, risk_signals, reserve_pct,
// requires_documents) salvo que AI Tickets lo haya fijado a mano (risk_locked). Tolera columnas que aún no existen.
// No importa nada de Node para poder usarse desde Astro y desde Netlify Functions.

export const NEW_PRODUCER_DAYS = 90
export const LARGE_CAPACITY = 1000
export const HIGH_AMOUNT_CLP = 20_000_000
export const SPIKE_MIN_TICKETS = 50
export const SPIKE_FACTOR = 5
export const SHARED_BUYER_MIN_EMAILS = 5

export const RISK_WEIGHTS = Object.freeze({
  new_producer: 25,
  no_address: 20,
  large_capacity: 30,
  high_amount: 15,
  sales_spike: 20,
  shared_buyer: 25,
  device_cluster: 25,
})

export const RISK_SIGNAL_LABELS = Object.freeze({
  new_producer: 'Productor nuevo',
  no_address: 'Lugar sin dirección exacta',
  large_capacity: 'Aforo mayor a 1.000 o evento masivo',
  high_amount: 'Evento de alto monto',
  sales_spike: 'Ritmo de ventas anómalo',
  shared_buyer: 'Muchos compradores con un mismo teléfono',
  device_cluster: 'Muchas tarjetas desde un mismo dispositivo',
})

export const RESERVE_BY_LEVEL = Object.freeze({ low: 0, medium: 30, high: 100 })
export const RISK_LEVEL_LABELS = Object.freeze({ low: 'Bajo', medium: 'Medio', high: 'Alto' })

const MISSING = ['42P01', 'PGRST205', '42703', 'PGRST204']
const isMissing = (err) => MISSING.includes(String(err?.code || ''))

/**
 * Calcula el riesgo a partir de señales ya medidas (función pura).
 * input: { orgCreatedAt, priorHeldEvents, hasExactAddress, capacity, isMassive, potentialAmount,
 *          ticketsLast24h, avgDailyTicketsBefore, maxEmailsPerPhone, deviceCluster, now }
 */
export function scoreEventRisk(input = {}) {
  const now = input.now ? new Date(input.now) : new Date()
  const signals = []
  const orgAgeDays = input.orgCreatedAt ? (now.getTime() - new Date(input.orgCreatedAt).getTime()) / 86400000 : null
  if ((orgAgeDays != null && orgAgeDays < NEW_PRODUCER_DAYS) || !(Number(input.priorHeldEvents) > 0)) signals.push('new_producer')
  if (input.hasExactAddress === false) signals.push('no_address')
  if (input.isMassive || Number(input.capacity) > LARGE_CAPACITY) signals.push('large_capacity')
  if (Number(input.potentialAmount) > HIGH_AMOUNT_CLP) signals.push('high_amount')
  const last24 = Number(input.ticketsLast24h) || 0
  const avg = Number(input.avgDailyTicketsBefore) || 0
  if (last24 >= SPIKE_MIN_TICKETS && last24 >= SPIKE_FACTOR * Math.max(avg, 1)) signals.push('sales_spike')
  if (Number(input.maxEmailsPerPhone) >= SHARED_BUYER_MIN_EMAILS) signals.push('shared_buyer')
  if (input.deviceCluster) signals.push('device_cluster')

  const score = Math.min(100, signals.reduce((n, s) => n + RISK_WEIGHTS[s], 0))
  const level = score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low'
  const requiresDocuments = Boolean(input.isMassive || Number(input.capacity) > LARGE_CAPACITY || level === 'high')
  return {
    score,
    level,
    reserve_pct: RESERVE_BY_LEVEL[level],
    requires_documents: requiresDocuments,
    signals: signals.map((code) => ({ code, label: RISK_SIGNAL_LABELS[code], points: RISK_WEIGHTS[code] })),
  }
}

async function safeSelect(build) {
  const { data, error } = await build()
  if (error) {
    if (isMissing(error)) return null
    throw error
  }
  return data
}

/** Mide las señales de un evento en la base. */
export async function loadEventRiskInput(supabase, eventId, { now = new Date(), deviceCluster = false } = {}) {
  const event =
    (await safeSelect(() => supabase.from('events').select('id, organization_id, is_massive, end_date, created_at').eq('id', eventId).maybeSingle())) ||
    (await safeSelect(() => supabase.from('events').select('id, organization_id, end_date, created_at').eq('id', eventId).maybeSingle()))
  if (!event) return null
  const orgId = event.organization_id
  const nowIso = new Date(now).toISOString()

  const [org, priorEvents, tickets, locations, orders] = await Promise.all([
    safeSelect(() => supabase.from('organizations').select('id, created_at').eq('id', orgId).maybeSingle()),
    safeSelect(() => supabase.from('events').select('id, end_date').eq('organization_id', orgId).neq('id', eventId).lt('end_date', nowIso).limit(200)),
    safeSelect(() => supabase.from('event_tickets').select('id, price, total_quantity, is_gift').eq('event_id', eventId)),
    safeSelect(() =>
      supabase.from('event_locations').select('venue_id, capacity_override, address_line1_override').eq('event_id', eventId),
    ),
    safeSelect(() => supabase.from('event_orders').select('id, status, ticket_qty, buyer_email, buyer_phone, created_at').eq('event_id', eventId).eq('status', 'paid').limit(5000)),
  ])

  // Eventos anteriores realizados con al menos una venta pagada.
  let priorHeldEvents = 0
  const priorIds = (priorEvents || []).map((e) => e.id)
  if (priorIds.length) {
    const paid = await safeSelect(() => supabase.from('event_orders').select('event_id').in('event_id', priorIds).eq('status', 'paid').limit(1000))
    priorHeldEvents = new Set((paid || []).map((o) => String(o.event_id))).size
  }

  // Dirección exacta: calle (override o del lugar) o coordenadas.
  let hasExactAddress = null
  let venueCapacity = 0
  if (locations && locations.length) {
    const venueIds = locations.map((l) => l.venue_id).filter(Boolean)
    const venues = venueIds.length
      ? (await safeSelect(() => supabase.from('venues').select('id, address_line1, latitude, longitude, capacity').in('id', venueIds))) ||
        (await safeSelect(() => supabase.from('venues').select('id, address_line1, latitude, longitude').in('id', venueIds))) ||
        []
      : []
    hasExactAddress = locations.every((l) => {
      const v = venues.find((x) => String(x.id) === String(l.venue_id))
      return Boolean(String(l.address_line1_override || v?.address_line1 || '').trim() || (v?.latitude != null && v?.longitude != null))
    })
    for (const l of locations) {
      const v = venues.find((x) => String(x.id) === String(l.venue_id))
      venueCapacity = Math.max(venueCapacity, Number(l.capacity_override) || Number(v?.capacity) || 0)
    }
  } else if (locations) hasExactAddress = false

  const sellable = (tickets || []).filter((t) => !t.is_gift)
  const ticketCapacity = sellable.reduce((n, t) => n + (Number(t.total_quantity) || 0), 0)
  const potentialAmount = sellable.reduce((n, t) => n + (Number(t.price) || 0) * (Number(t.total_quantity) || 0), 0)

  const nowMs = new Date(now).getTime()
  let ticketsLast24h = 0
  let ticketsBefore = 0
  let firstSale = null
  const emailsByPhone = new Map()
  for (const o of orders || []) {
    const t = new Date(o.created_at).getTime()
    const qty = Number(o.ticket_qty) || 0
    if (nowMs - t <= 86400000) ticketsLast24h += qty
    else if (nowMs - t <= 15 * 86400000) {
      ticketsBefore += qty
      if (firstSale == null || t < firstSale) firstSale = t
    }
    const phone = String(o.buyer_phone || '').replace(/\D/g, '').slice(-9)
    const email = String(o.buyer_email || '').trim().toLowerCase()
    if (phone.length >= 8 && email) {
      const set = emailsByPhone.get(phone) || new Set()
      set.add(email)
      emailsByPhone.set(phone, set)
    }
  }
  const daysBefore = firstSale == null ? 0 : Math.max(1, Math.min(14, Math.ceil((nowMs - 86400000 - firstSale) / 86400000)))
  const avgDailyTicketsBefore = daysBefore ? ticketsBefore / daysBefore : 0
  const maxEmailsPerPhone = Math.max(0, ...[...emailsByPhone.values()].map((s) => s.size))

  return {
    eventId: Number(event.id),
    organizationId: orgId,
    orgCreatedAt: org?.created_at || null,
    priorHeldEvents,
    hasExactAddress,
    capacity: Math.max(ticketCapacity, venueCapacity),
    isMassive: Boolean(event.is_massive),
    potentialAmount,
    ticketsLast24h,
    avgDailyTicketsBefore,
    maxEmailsPerPhone,
    deviceCluster,
    now,
  }
}

/**
 * Recalcula y guarda el riesgo de un evento. Devuelve { ...score, previous_level, changed, locked } o null si no existe.
 * Con risk_locked = true no escribe nada (AI Tickets lo fijó a mano) y devuelve lo guardado.
 */
export async function refreshEventRisk(supabase, eventId, opts = {}) {
  const input = await loadEventRiskInput(supabase, eventId, opts)
  if (!input) return null
  const result = scoreEventRisk(input)
  const current = await safeSelect(() =>
    supabase.from('events').select('id, risk_level, risk_locked, reserve_pct, requires_documents').eq('id', eventId).maybeSingle(),
  )
  if (current === null) return { ...result, previous_level: null, changed: false, locked: false, persisted: false }
  if (current?.risk_locked) {
    return { ...result, level: current.risk_level || result.level, reserve_pct: current.reserve_pct ?? result.reserve_pct, previous_level: current.risk_level, changed: false, locked: true, persisted: true }
  }
  const { error } = await supabase
    .from('events')
    .update({
      risk_score: result.score,
      risk_level: result.level,
      risk_signals: result.signals,
      risk_computed_at: new Date().toISOString(),
      reserve_pct: result.reserve_pct,
      requires_documents: result.requires_documents,
    })
    .eq('id', eventId)
  if (error && !isMissing(error)) throw error
  return { ...result, previous_level: current?.risk_level ?? null, changed: (current?.risk_level ?? null) !== result.level, locked: false, persisted: !error }
}
