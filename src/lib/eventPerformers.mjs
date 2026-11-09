// Artistas, elenco o expositores de un evento (events.performers, migración 202611090100).
//
// Para qué: la página del evento los muestra en "Participan" y el JSON-LD (schema.org/Event, src/lib/eventJsonLd.ts)
// los publica como `performer`, un campo recomendado de los resultados enriquecidos de eventos de Google. Sin
// artistas cargados, el JSON-LD usa los expositores de la agenda (performersFromAgenda); si tampoco hay, no inventa.
//
// Forma guardada: [{ name: "Ana Tijoux", type: "person" | "group" }] (máx. MAX_PERFORMERS). Lo usan el panel
// (PerformersEditor.vue → /api/events/create|update), la API de productores (create_event / update_event / get_event)
// y la página pública (src/lib/eventPage.ts).

export const PERFORMER_TYPES = Object.freeze(['person', 'group'])
export const MAX_PERFORMERS = 30
export const MAX_PERFORMER_NAME = 100

const cleanName = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

/**
 * Lista normalizada: acepta [{ name, type }] o ["Nombre"]; descarta vacíos y repetidos (sin distinguir mayúsculas),
 * recorta nombres largos y se queda con los primeros MAX_PERFORMERS. Cualquier otra cosa → [].
 * @param {unknown} raw
 * @returns {Array<{ name: string, type: 'person' | 'group' }>}
 */
export function normalizePerformers(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const item of raw) {
    const name = cleanName(typeof item === 'string' ? item : item?.name).slice(0, MAX_PERFORMER_NAME).trim()
    if (!name) continue
    const key = name.toLocaleLowerCase('es')
    if (seen.has(key)) continue
    seen.add(key)
    const type = typeof item === 'object' && item?.type === 'group' ? 'group' : 'person'
    out.push({ name, type })
    if (out.length >= MAX_PERFORMERS) break
  }
  return out
}

/** Valor para guardar en events.performers: null si no hay artistas. */
export const performersForDb = (raw) => {
  const list = normalizePerformers(raw)
  return list.length ? list : null
}

/**
 * Expositores de la agenda (aitickets_event_agenda.speakers, texto libre: "Ana Pérez (Empresa X), Juan Soto") como
 * artistas: separa por coma, punto y coma, "·" o " / " y quita lo que va entre paréntesis (la empresa o el cargo).
 * @param {Array<{ blocks?: Array<{ speakers?: string | null }> }>} groups agenda por día (agendaGroups) o bloques sueltos
 */
export function performersFromAgenda(groups) {
  const blocks = (Array.isArray(groups) ? groups : []).flatMap((g) => (Array.isArray(g?.blocks) ? g.blocks : [g]))
  const names = []
  for (const block of blocks) {
    // Primero se quitan los paréntesis: "(CEO, Startup)" lleva comas que no separan personas
    const speakers = typeof block?.speakers === 'string' ? block.speakers.replace(/\([^)]*\)/g, ' ') : ''
    for (const part of speakers.split(/[,;]|\s·\s|\s\/\s/)) {
      const name = cleanName(part)
      if (name.length >= 2) names.push(name)
    }
  }
  return normalizePerformers(names)
}

/** `performer` del JSON-LD: Person o PerformingGroup (banda, compañía, coro). */
export const performerJsonLd = (performers) =>
  normalizePerformers(performers).map((p) => ({ '@type': p.type === 'group' ? 'PerformingGroup' : 'Person', name: p.name }))
