// Repetir funciones con un patrón ("jueves a domingo, 20:00, hasta el 30 de noviembre").
// Lo usan el editor de funciones de los formularios de evento y la herramienta update_event_functions
// (src/lib/producer-api/tools/schedule.ts), para que los dos creen exactamente las mismas fechas.

/** Tope de funciones por evento (formularios y API). */
export const MAX_FUNCTIONS = 60

/** Días de la semana en el orden chileno (lunes primero). `day` = Date#getUTCDay(). */
export const WEEKDAYS = Object.freeze([
  { key: 'lunes', short: 'L', label: 'lun', day: 1 },
  { key: 'martes', short: 'M', label: 'mar', day: 2 },
  { key: 'miercoles', short: 'M', label: 'mié', day: 3 },
  { key: 'jueves', short: 'J', label: 'jue', day: 4 },
  { key: 'viernes', short: 'V', label: 'vie', day: 5 },
  { key: 'sabado', short: 'S', label: 'sáb', day: 6 },
  { key: 'domingo', short: 'D', label: 'dom', day: 0 },
])

/** Un patrón no puede abarcar más que esto (evita bucles con fechas mal escritas). */
const MAX_SPAN_DAYS = 731
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const parseDay = (s) => {
  if (!DATE_RE.test(String(s || ''))) return null
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null
}
const toKey = (date) => date.toISOString().slice(0, 10)

/** Acepta claves ('jueves'), números de getUTCDay (4) o ambos mezclados. */
const dayNumbers = (weekdays) =>
  new Set(
    (weekdays || [])
      .map((w) => (typeof w === 'number' ? w : WEEKDAYS.find((d) => d.key === String(w).toLowerCase())?.day))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  )

/** Motivo por el que el patrón no sirve, o null. */
export function patternError({ weekdays, from, until }) {
  const start = parseDay(from)
  const end = parseDay(until)
  if (!start) return 'Indica desde qué fecha repetir.'
  if (!end) return 'Indica hasta qué fecha repetir.'
  if (end < start) return 'La fecha de término es anterior a la de inicio.'
  if ((end - start) / 86400_000 > MAX_SPAN_DAYS) return 'El patrón no puede abarcar más de dos años.'
  if (!dayNumbers(weekdays).size) return 'Elige al menos un día de la semana.'
  return null
}

/** Fechas (YYYY-MM-DD, ambas puntas incluidas) que caen en los días elegidos. [] si el patrón no sirve. */
export function repeatDates({ weekdays, from, until }) {
  if (patternError({ weekdays, from, until })) return []
  const days = dayNumbers(weekdays)
  const out = []
  const end = parseDay(until)
  for (let d = parseDay(from); d <= end; d = new Date(d.getTime() + 86400_000)) {
    if (days.has(d.getUTCDay())) out.push(toKey(d))
  }
  return out
}

/** "jue a dom" / "lun, mié y vie" para resúmenes. */
export function weekdaysLabel(weekdays) {
  const days = dayNumbers(weekdays)
  const picked = WEEKDAYS.filter((d) => days.has(d.day))
  if (!picked.length) return ''
  const idx = picked.map((d) => WEEKDAYS.indexOf(d))
  const consecutive = idx.length > 2 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
  if (picked.length === 7) return 'todos los días'
  if (consecutive) return `${picked[0].label} a ${picked[picked.length - 1].label}`
  const labels = picked.map((d) => d.label)
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`
}
