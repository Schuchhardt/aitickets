// Evento de demostración: siempre visible, con fecha dinámica (último día del mes) y sin venta real.
// Lo usan la página pública (src/pages/eventos/[slug].astro), el asistente IA y la función de compra
// (netlify/functions/*), que lo rechaza en el servidor.

export const DEMO_EVENT_SLUG = 'evento-demo-aitickets'
export const DEMO_TIMEZONE = 'America/Santiago'
// Hora de término de la función demo: pasada esta hora del último día, la fecha salta al mes siguiente
const DEMO_END_TIME = '22:30'

export const isDemoEventSlug = (slug) => slug === DEMO_EVENT_SLUG

const pad = (n) => String(n).padStart(2, '0')
const lastDayOfMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate() // month 1-12

/** Fecha (YYYY-MM-DD) de la función demo: último día del mes en curso en Chile, o del siguiente si ya pasó. */
export function getDemoEventDate(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: DEMO_TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(p => [p.type, p.value])
  )
  let year = Number(parts.year)
  let month = Number(parts.month)
  const day = Number(parts.day)
  const time = `${parts.hour}:${parts.minute}`

  if (day === lastDayOfMonth(year, month) && time >= DEMO_END_TIME) {
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`
}
