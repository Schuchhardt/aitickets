// Eventos de demostración: siempre visibles en /eventos, con fecha dinámica y sin venta real.
// Los usan la página pública (src/pages/eventos/[slug].astro), el listado (src/pages/eventos/index.astro),
// el asistente IA y la función de compra (netlify/functions/*), que los rechaza en el servidor.
// Las filas (evento, recinto, funciones, entradas) las siembra db/migrations/202610090100_demo_events.sql.

export const DEMO_EVENT_SLUG = 'evento-demo-aitickets'
export const DEMO_TIMEZONE = 'America/Santiago'

/**
 * Regla de fecha de cada evento demo. `endTime`: pasada esta hora del día de la función, salta a la siguiente.
 *   last_day_of_month  último día del mes
 *   weekday            próximo día de la semana `weekday` (0 = domingo … 6 = sábado)
 *   day_of_month       día `day` del mes
 */
export const DEMO_EVENTS = Object.freeze([
  { slug: DEMO_EVENT_SLUG, rule: 'last_day_of_month', endTime: '22:30' },
  { slug: 'evento-demo-concierto', rule: 'weekday', weekday: 6, endTime: '23:30' },
  { slug: 'evento-demo-feria', rule: 'day_of_month', day: 15, endTime: '20:00' },
])

export const DEMO_EVENT_SLUGS = Object.freeze(DEMO_EVENTS.map((e) => e.slug))

export const isDemoEventSlug = (slug) => DEMO_EVENT_SLUGS.includes(slug)

const pad = (n) => String(n).padStart(2, '0')
const lastDayOfMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate() // month 1-12
const toYmd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

function chileParts(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: DEMO_TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(p => [p.type, p.value])
  )
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), time: `${parts.hour}:${parts.minute}` }
}

/** Fecha (YYYY-MM-DD) de la función del evento demo `slug` (por defecto, el de stand-up) en hora de Chile. */
export function getDemoEventDate(now = new Date(), slug = DEMO_EVENT_SLUG) {
  const cfg = DEMO_EVENTS.find((e) => e.slug === slug) || DEMO_EVENTS[0]
  const { year, month, day, time } = chileParts(now)
  const today = new Date(Date.UTC(year, month - 1, day))
  const todayPassed = time >= cfg.endTime

  if (cfg.rule === 'weekday') {
    let diff = (cfg.weekday - today.getUTCDay() + 7) % 7
    if (diff === 0 && todayPassed) diff = 7
    return toYmd(new Date(today.getTime() + diff * 86400000))
  }

  let y = year
  let m = month
  const dayIn = (yy, mm) => (cfg.rule === 'day_of_month' ? Math.min(cfg.day, lastDayOfMonth(yy, mm)) : lastDayOfMonth(yy, mm))
  const target = dayIn(y, m)
  if (day > target || (day === target && todayPassed)) {
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return `${y}-${pad(m)}-${pad(dayIn(y, m))}`
}
