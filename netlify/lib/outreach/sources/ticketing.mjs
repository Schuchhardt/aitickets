// Fuente páginas públicas de ticketeras: DESHABILITADA y fuera de alcance (stub permanente).
// Eventbrite prohíbe el scraping en sus términos; Ticketplus/Puntoticket/Passline no fueron revisados.
// No habilitar sin revisión legal explícita del dueño.
export const key = 'ticketing'

export async function discover() {
  return { candidates: [], stats: { skipped: true, reason: 'fuente deshabilitada' } }
}
