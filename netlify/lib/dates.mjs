// Utilidades de fecha para las Netlify Functions.
// Los eventos ocurren en Chile: fechas y horas de event_dates se interpretan en America/Santiago.

export const EVENT_TIMEZONE = 'America/Santiago'

function tzOffsetMinutes(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p = Object.fromEntries(dtf.formatToParts(instant).map(x => [x.type, x.value]))
  const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second))
  return Math.round((asUTC - instant.getTime()) / 60000)
}

/** Convierte fecha (YYYY-MM-DD) + hora (HH:MM[:SS]) locales de `timeZone` a un Date (instante UTC). */
export function zonedDateTimeToUtc(dateStr, timeStr = '00:00', timeZone = EVENT_TIMEZONE) {
  if (!dateStr) return null
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number)
  const [hh = 0, mm = 0, ss = 0] = String(timeStr || '00:00').split(':').map(Number)
  if (!y || !m || !d) return null
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss)
  const off1 = tzOffsetMinutes(new Date(guess), timeZone)
  let result = guess - off1 * 60000
  const off2 = tzOffsetMinutes(new Date(result), timeZone)
  if (off2 !== off1) result = guess - off2 * 60000
  return new Date(result)
}

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria indicada. */
export function todayInTimeZone(timeZone = EVENT_TIMEZONE, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Suma días a una fecha YYYY-MM-DD (aritmética de calendario, sin zonas horarias). */
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** "sábado, 4 de octubre de 2026" para una fecha YYYY-MM-DD. */
export function formatDateOnlyLong(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-CL', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** "19:00" desde "19:00:00". */
export function formatTimeShort(timeStr) {
  if (!timeStr) return ''
  const [h, m] = String(timeStr).split(':')
  return `${h.padStart(2, '0')}:${(m || '00').padStart(2, '0')}`
}

/** Fecha larga + hora de un instante (timestamptz) en hora de Chile. */
export function formatInstantLong(value, includeTime = true) {
  if (!value) return ''
  const opts = { timeZone: EVENT_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
  if (includeTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit', hour12: false })
  return new Date(value).toLocaleString('es-CL', opts)
}

/** "19:00" de un instante (timestamptz) en hora de Chile. */
export function formatInstantTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleTimeString('es-CL', { timeZone: EVENT_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Dirección legible de un event_location (con join a venues). */
export function formatEventLocation(loc) {
  if (!loc) return ''
  const venue = loc.venues || {}
  // event_locations.name = 'Main' es un nombre interno que pone el dashboard: mostrar el del recinto
  const internalName = loc.name && loc.name !== 'Main' ? loc.name : ''
  const name = loc.display_name || venue.name || internalName || ''
  const address = loc.address_line1_override || venue.address_line1 || ''
  const city = loc.city_override || venue.city || ''
  return [name, address, city].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ')
}

/** Columnas para hacer join de event_dates -> event_locations -> venues. */
export const EVENT_DATE_COLUMNS = `
  id, date, start_time, end_time, event_location_id,
  event_locations (
    name, display_name, address_line1_override, city_override,
    venues ( name, address_line1, city )
  )
`

const SHORT_WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Etiqueta corta de una función (event_date): "Sáb 12 oct · 20:00 · Recinto" (contrato R1). */
export function formatFunctionLabel(ed, { withPlace = true } = {}) {
  if (!ed?.date) return ''
  const [y, m, d] = String(ed.date).slice(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12))
  const parts = [`${SHORT_WEEKDAYS[dt.getUTCDay()]} ${d} ${SHORT_MONTHS[m - 1]}`]
  if (ed.start_time) parts.push(formatTimeShort(ed.start_time))
  if (withPlace) {
    const place = ed.event_locations ? formatEventLocation(ed.event_locations).split(', ')[0] : ''
    if (place) parts.push(place)
  }
  return parts.join(' · ')
}
