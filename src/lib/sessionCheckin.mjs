// Ingreso por función de las entradas multifunción (pase de varios días, taller de varias sesiones): una entrada
// "para todas las funciones" de un evento con más de una función entra una vez en cada función. Lógica pura,
// compartida por el servidor (netlify/lib/checkin.mjs) y el escáner (ValidateQR.vue, también sin conexión).

const TIME_ZONE = 'America/Santiago'
/** Una función "está por empezar" desde 2 horas antes: dos funciones el mismo día se distinguen por la hora. */
const EARLY_MINUTES = 120
/** Sin hora de término, una función se da por terminada 12 horas después de empezar… */
const DEFAULT_LENGTH_MINUTES = 12 * 60
/** …y, si cruza la medianoche, a más tardar a las 06:00 del día siguiente. */
const NIGHT_END_MINUTES = 6 * 60

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

const toDate = (at) => (at instanceof Date ? at : new Date(at ?? Date.now()))
/** Fecha YYYY-MM-DD en hora de Chile. */
export const santiagoDay = (at) => dayFmt.format(toDate(at))
const minutesOf = (hhmm) => {
  const [h, m] = String(hhmm || '00:00').slice(0, 5).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
const dayNumber = (ymd) => {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/**
 * Hasta qué minuto del día SIGUIENTE sigue la función `d` (0 si termina el mismo día). Con end_time anterior a la
 * hora de inicio, ese end_time; sin end_time, inicio + 12 h, a más tardar las 06:00.
 */
function overnightUntil(d) {
  if (!d?.start_time) return 0
  const start = minutesOf(d.start_time)
  if (d.end_time) {
    const end = minutesOf(d.end_time)
    return end < start ? end : 0
  }
  return Math.max(0, Math.min(start + DEFAULT_LENGTH_MINUTES - 24 * 60, NIGHT_END_MINUTES))
}

/** La entrada vale para todas las funciones de un evento que tiene varias. */
export function isMultiSession(eventDateId, dates) {
  return (eventDateId === null || eventDateId === undefined || eventDateId === '') && Array.isArray(dates) && dates.length > 1
}

/**
 * La función que se está validando en el momento `at`: la de hoy (hora de Chile). Con varias el mismo día, la última
 * que ya empezó o empieza dentro de 2 horas (si ninguna, la primera del día). Si hoy no hay función, la más cercana
 * (a igual distancia, la que viene). Una función de anoche que cruza la medianoche (fiesta de 22:00 a 05:00) sigue
 * siendo la que se valida en la madrugada, mientras no haya empezado una de hoy.
 */
export function pickSession(dates, at = new Date()) {
  if (!Array.isArray(dates) || !dates.length) return null
  const today = santiagoDay(at)
  const t = dayNumber(today)
  const now = minutesOf(timeFmt.format(toDate(at)))
  const sorted = [...dates].sort((a, b) => `${a.date}|${a.start_time || ''}`.localeCompare(`${b.date}|${b.start_time || ''}`))
  const todays = sorted.filter((d) => String(d.date).slice(0, 10) === today)
  const started = todays.filter((d) => minutesOf(d.start_time) - EARLY_MINUTES <= now)
  if (started.length) return started[started.length - 1]
  const lastNight = sorted.filter((d) => dayNumber(d.date) === t - 1 && now < overnightUntil(d))
  if (lastNight.length) return lastNight[lastNight.length - 1]
  if (todays.length) return todays[0]
  let best = null
  let bestDist = Infinity
  for (const d of sorted) {
    const diff = dayNumber(d.date) - t
    const dist = Math.abs(diff) - (diff > 0 ? 0.5 : 0)
    if (dist < bestDist) {
      best = d
      bestDist = dist
    }
  }
  return best
}

/**
 * La entrada como la ve el escáner en la función actual: una multifunción está 'validated' solo si ya entró a ESA
 * función. `session_checkins` ([{ event_date_id, checked_in_at }]) lo agrega el servidor; si falta (tabla aún sin
 * migrar), la entrada se deja tal cual (regla de un solo ingreso).
 */
export function sessionView(attendee, dates, at = new Date()) {
  const eventDateId = attendee?.event_tickets?.event_date_id ?? attendee?.event_date_id ?? null
  if (!Array.isArray(attendee?.session_checkins) || !isMultiSession(eventDateId, dates)) return attendee
  const status = attendee.ticket_status ?? attendee.status ?? 'active'
  if (status !== 'active' && status !== 'validated') return attendee
  const session = pickSession(dates, at)
  const hit = attendee.session_checkins.find((c) => String(c.event_date_id) === String(session?.id))
  return {
    ...attendee,
    ticket_status: status,
    status: hit ? 'validated' : 'active',
    validated_at: hit ? hit.checked_in_at : null,
    session_date_id: session?.id ?? null,
    sessions_attended: attendee.session_checkins.length,
    sessions_total: dates.length,
  }
}

/** Marca localmente (escáner offline) el ingreso de una multifunción a la función actual. */
export function addLocalSessionCheckin(attendee, dates, checkedInAt, at = new Date()) {
  if (!Array.isArray(attendee?.session_checkins)) return attendee
  const session = pickSession(dates, at)
  if (!session || attendee.session_checkins.some((c) => String(c.event_date_id) === String(session.id))) return attendee
  return { ...attendee, session_checkins: [...attendee.session_checkins, { event_date_id: session.id, checked_in_at: checkedInAt }] }
}
