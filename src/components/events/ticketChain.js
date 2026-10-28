// Tandas encadenadas en los formularios de evento: "Se abre al agotarse <otra entrada>" (opensAfterId).
// El servidor valida lo mismo (validateFormTicketChain en src/pages/api/_lib/events.ts y chainError en
// netlify/lib/tickets.mjs); aquí solo se ofrecen opciones que tienen sentido.

const hasLimit = (t) => t.quantity !== null && t.quantity !== '' && t.quantity !== undefined && Number(t.quantity) > 0
const isSet = (v) => v !== '' && v !== null && v !== undefined

/** ¿Siguiendo la cadena desde `from` se llega a `targetId`? (evita círculos) */
function leadsTo(tickets, from, targetId) {
  const byId = new Map(tickets.map((t) => [String(t.id), t]))
  const seen = new Set()
  for (let t = from; t && !seen.has(String(t.id)); t = isSet(t.opensAfterId) ? byId.get(String(t.opensAfterId)) : null) {
    if (String(t.id) === String(targetId)) return true
    seen.add(String(t.id))
  }
  return false
}

/** Entradas que pueden ser la tanda anterior de `ticket`: otras, con cupo y sin formar un círculo. */
export const chainOptions = (tickets, ticket) =>
  tickets.filter((o) => String(o.id) !== String(ticket.id) && hasLimit(o) && !leadsTo(tickets, o, ticket.id))

/** Quita encadenamientos que dejaron de valer (la anterior se borró o quedó sin cupo). */
export function pruneChain(tickets) {
  for (const t of tickets) {
    if (!isSet(t.opensAfterId)) continue
    if (!chainOptions(tickets, t).some((o) => String(o.id) === String(t.opensAfterId))) t.opensAfterId = ''
  }
}

/** Texto para el resumen: "se abre al agotarse Preventa 1" o "". */
export function chainSummary(tickets, ticket) {
  if (!isSet(ticket.opensAfterId)) return ''
  const prev = tickets.find((o) => String(o.id) === String(ticket.opensAfterId))
  return prev ? `se abre al agotarse ${prev.name || 'la anterior'}` : ''
}
