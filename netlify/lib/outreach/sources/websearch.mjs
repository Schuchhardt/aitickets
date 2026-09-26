// Fuente búsqueda web con Claude (herramienta server-side web_search): DESHABILITADA (stub).
// Cada búsqueda tiene costo; si se habilita, limitar con LEADS_WEBSEARCH_MAX y el tope diario de tokens,
// y exigir que cada candidato traiga evidence_url (registro de origen del dato).
export const key = 'websearch'

export async function discover() {
  return { candidates: [], stats: { skipped: true, reason: 'fuente deshabilitada (stub)' } }
}
