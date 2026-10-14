// Eventos de demostración: siempre visibles en /eventos, con fecha dinámica y sin venta real.
// Los usan la página pública (src/pages/eventos/[slug].astro), el listado (src/pages/eventos/index.astro),
// el asistente IA y la función de compra (netlify/functions/*), que los rechaza en el servidor.
// Las filas (evento, recinto, funciones, entradas) las siembran db/migrations/202610090100_event_cover_and_demo_events.sql
// 202610140200_demo_events_free_and_tour.sql, 202610140300_demo_event_standup.sql y 202610150400_demo_event_teatro.sql.

export const DEMO_EVENT_SLUG = 'evento-demo-aitickets'
export const DEMO_TIMEZONE = 'America/Santiago'

/**
 * Regla de fecha de cada evento demo. `endTime`: pasada esta hora del día de la función, salta a la siguiente.
 *   last_day_of_month  último día del mes
 *   weekday            próximo día de la semana `weekday` (0 = domingo … 6 = sábado)
 *   day_of_month       día `day` del mes
 * `anchor` (eventos con varias funciones, p. ej. una gira): fecha guardada de la PRIMERA función. Cada función
 * se corre a la fecha dinámica manteniendo su distancia en días desde el ancla (y así su día de la semana).
 * Sin ancla, todas las funciones caen en la fecha dinámica.
 */
export const DEMO_EVENTS = Object.freeze([
  { slug: DEMO_EVENT_SLUG, rule: 'last_day_of_month', endTime: '22:30' },
  { slug: 'evento-demo-concierto', rule: 'weekday', weekday: 6, endTime: '23:30' },
  { slug: 'evento-demo-feria', rule: 'day_of_month', day: 15, endTime: '20:00' },
  // Gratis (registro inline): todos los jueves
  { slug: 'evento-demo-gratis', rule: 'weekday', weekday: 4, endTime: '21:00' },
  // Gira: 5 funciones en 3 ciudades a partir del próximo viernes
  { slug: 'evento-demo-gira', rule: 'weekday', weekday: 5, endTime: '23:00', anchor: '2026-10-23' },
  // Teatro: todos los domingos
  { slug: 'evento-demo-teatro', rule: 'weekday', weekday: 0, endTime: '20:10' },
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

const ymdToUtc = (ymd) => {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/**
 * Fecha (YYYY-MM-DD) a mostrar para una función de un evento demo, a partir de su fecha guardada.
 * Con `anchor` respeta la separación entre funciones; sin ancla devuelve getDemoEventDate.
 */
export function getDemoFunctionDate(storedDate, now = new Date(), slug = DEMO_EVENT_SLUG) {
  const base = getDemoEventDate(now, slug)
  const cfg = DEMO_EVENTS.find((e) => e.slug === slug)
  if (!cfg?.anchor || !storedDate) return base
  const offsetDays = Math.round((ymdToUtc(storedDate) - ymdToUtc(cfg.anchor)) / 86400000)
  return toYmd(new Date(ymdToUtc(base) + offsetDays * 86400000))
}
