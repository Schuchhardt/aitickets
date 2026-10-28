// Editor de funciones de los formularios de evento: "Repetir" (crea de una vez las funciones de un patrón) y
// "Copiar las entradas a cada función". El patrón es el mismo que usa la API (src/lib/functionPattern.mjs) y el
// servidor vuelve a validar el tope de funciones (src/pages/api/_lib/events.ts).
import { MAX_FUNCTIONS, patternError, repeatDates } from '../../lib/functionPattern.mjs'

const isSet = (v) => v !== '' && v !== null && v !== undefined
const keyOf = (d) => `${d.date}|${String(d.startTime || '').slice(0, 5)}`

/**
 * Qué haría el patrón en la ubicación `locIndex`, sin tocar nada.
 * @returns {{ error: string|null, dates: string[], skipped: number, total: number }}
 */
export function planRepeat(locations, locIndex, pattern) {
  const error = patternError(pattern)
  if (error) return { error, dates: [], skipped: 0, total: 0 }
  if (!pattern.startTime) return { error: 'Indica la hora de inicio.', dates: [], skipped: 0, total: 0 }
  const loc = locations[locIndex]
  const existing = new Set(loc.dates.filter((d) => d.date).map(keyOf))
  const all = repeatDates(pattern)
  const dates = all.filter((date) => !existing.has(keyOf({ date, startTime: pattern.startTime })))
  const current = locations.reduce((n, l) => n + l.dates.filter((d) => d.date).length, 0)
  const total = current + dates.length
  if (!all.length) return { error: 'Ningún día del período cae en los días elegidos.', dates, skipped: 0, total }
  if (!dates.length) return { error: 'Esas funciones ya están en la lista.', dates, skipped: all.length, total }
  if (total > MAX_FUNCTIONS) {
    return {
      error: `Quedarían ${total} funciones y el máximo es ${MAX_FUNCTIONS}. Acorta el período o elige menos días.`,
      dates,
      skipped: all.length - dates.length,
      total,
    }
  }
  return { error: null, dates, skipped: all.length - dates.length, total }
}

/** Agrega las funciones del patrón (reemplaza las filas sin fecha) y las ordena. Devuelve el plan aplicado. */
export function applyRepeat(locations, locIndex, pattern, newId) {
  const plan = planRepeat(locations, locIndex, pattern)
  if (plan.error) return plan
  const loc = locations[locIndex]
  const added = plan.dates.map((date) => ({ id: newId(), date, startTime: pattern.startTime, endTime: pattern.endTime || '' }))
  loc.dates = [...loc.dates.filter((d) => d.date), ...added].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  return plan
}

/**
 * Copiar las entradas a cada función. Toma como modelo las entradas de la primera función que tenga entradas
 * propias; si ninguna tiene, las de "Todas las funciones", que pasan a ser de la primera función (así cada
 * función queda con su propio cupo). Crea una copia para cada función que todavía no tiene entradas propias,
 * con las tandas encadenadas dentro de la misma función.
 * `canPin(ticket)`: si una entrada de "Todas las funciones" se puede asignar a una función (en el editor, solo
 * las nuevas: las guardadas pueden tener ventas que valen para cualquier función).
 * @returns {{ error: string|null, template: object[], targets: Array<string|number> }}
 */
export function planTicketCopy(tickets, functionIds, { canPin = () => true } = {}) {
  const ids = functionIds.map(String)
  const ownTickets = (fid) => tickets.filter((t) => isSet(t.eventDateId) && String(t.eventDateId) === fid)
  const templateFn = ids.find((fid) => ownTickets(fid).length)
  let template
  let pinTo = null
  if (templateFn) {
    template = ownTickets(templateFn)
  } else {
    template = tickets.filter((t) => !isSet(t.eventDateId))
    pinTo = functionIds[0]
    if (template.some((t) => !canPin(t))) {
      return {
        error: 'Tus entradas guardadas valen para todas las funciones y pueden tener ventas: asígnale una función a cada una antes de copiarlas.',
        template: [],
        targets: [],
        pinBlocked: true,
      }
    }
  }
  const source = templateFn ?? (pinTo != null ? String(pinTo) : null)
  const targets = functionIds.filter((fid) => String(fid) !== source && !ownTickets(String(fid)).length)
  if (ids.length < 2) return { error: 'Agrega más de una función para copiar las entradas.', template, targets: [] }
  if (!template.length) return { error: 'Primero crea las entradas de una función.', template, targets: [] }
  if (!targets.length) return { error: 'Todas las funciones ya tienen sus propias entradas.', template, targets }
  return { error: null, template, targets, pinTo }
}

export function applyTicketCopy(tickets, functionIds, newId, options) {
  const plan = planTicketCopy(tickets, functionIds, options)
  if (plan.error) return plan
  if (plan.pinTo != null) for (const t of plan.template) t.eventDateId = plan.pinTo
  for (const target of plan.targets) {
    const idMap = new Map(plan.template.map((t) => [String(t.id), newId()]))
    for (const t of plan.template) {
      tickets.push({
        ...t,
        id: idMap.get(String(t.id)),
        eventDateId: target,
        opensAfterId: isSet(t.opensAfterId) ? idMap.get(String(t.opensAfterId)) ?? '' : '',
      })
    }
  }
  return { ...plan, created: plan.template.length * plan.targets.length }
}
