// Fuente Google Places API (New): DESHABILITADA (stub). Tiene costo por consulta y sus términos solo
// permiten guardar place_id. Si se habilita en el futuro: Text Search con field mask mínimo, guardar solo
// place_id, y pedir websiteUri únicamente al enriquecer (nunca persistir otro contenido de Places).
// Requiere GOOGLE_PLACES_API_KEY (clave de servidor con tope de gasto) y LEADS_PLACES_MAX_QUERIES > 0.
export const key = 'places'

export async function discover() {
  return { candidates: [], stats: { skipped: true, reason: 'fuente deshabilitada (stub)' } }
}
