// Mapa de asientos (entradas numeradas, migración 202611020100). Lógica pura: la usan el panel (editor del mapa), la
// página del evento (selector de asientos), /api/purchase-ticket, la emisión de entradas y la API de productores.
//
// Un mapa se guarda en event_locations.seat_map (el que se vende, por ubicación del evento) y en venues.seat_map
// (el último guardado de esa sala, para reutilizarlo en el próximo evento). NULL = entrada general (sin asientos).
//
// seat_map = {
//   version: 1,
//   template: 'cine-mediano' | ... | 'en-blanco',   (solo informativo: de qué plantilla partió)
//   stage: 'Pantalla',                              (texto de la franja de adelante: Pantalla, Escenario)
//   sections: [{
//     id: 'platea',            (estable: forma parte de la clave de cada asiento)
//     name: 'Platea',
//     rows: 10,                (filas, de adelante hacia atrás)
//     seatsPerRow: 14,
//     firstRow: 'A',           (letra de la primera fila; las siguientes siguen el abecedario)
//     aisles: [4, 10],         (pasillo después del asiento N)
//     removed: ['C-1', 'C-2'], (huecos: asientos que no existen, "<fila>-<n>")
//   }]
// }
// Clave de un asiento: "<sección>:<fila>:<n>" (p. ej. "platea:C:7"). Es lo que se reserva por función en
// aitickets_event_seats (único por función) y lo que queda en event_attendees.seat_key.

export const SEAT_MAP_VERSION = 1
export const MAX_SECTIONS = 8
export const MAX_ROWS = 40
export const MAX_SEATS_PER_ROW = 60
export const MAX_SEATS = 3000
/** Máximo de asientos por compra (igual que el máximo de entradas por compra por defecto). */
export const MAX_SEATS_PER_ORDER = 10

const ROW_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')
const int = (v, min, max, fallback) => {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)

/** Etiqueta de la fila i (0 = la primera) a partir de la letra inicial: A..Z, luego AA, AB... */
export function rowLabel(firstRow, i) {
  const start = Math.max(0, ROW_LETTERS.indexOf(String(firstRow || 'A').toUpperCase()))
  const n = start + i
  if (n < 26) return ROW_LETTERS[n]
  return ROW_LETTERS[Math.floor(n / 26) - 1] + ROW_LETTERS[n % 26]
}

// ---------------------------------------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------------------------------------

const section = (id, name, rows, seatsPerRow, extra = {}) => ({ id, name, rows, seatsPerRow, firstRow: 'A', aisles: [], removed: [], ...extra })

export const SEAT_MAP_TEMPLATES = [
  {
    id: 'cine-pequeno',
    name: 'Sala de cine pequeña',
    description: 'Una platea de 8 filas × 12 asientos. Para salas de unas 100 butacas.',
    build: () => ({ stage: 'Pantalla', sections: [section('platea', 'Platea', 8, 12)] }),
  },
  {
    id: 'cine-mediano',
    name: 'Sala de cine con pasillos',
    description: '12 filas × 16 asientos con dos pasillos. Para salas de unas 190 butacas.',
    build: () => ({ stage: 'Pantalla', sections: [section('platea', 'Platea', 12, 16, { aisles: [4, 12] })] }),
  },
  {
    id: 'cine-preferencial',
    name: 'Cine con zona preferencial',
    description: 'General adelante y preferencial atrás, cada una con su precio.',
    build: () => ({
      stage: 'Pantalla',
      sections: [
        section('general', 'General', 8, 14, { aisles: [7] }),
        section('preferencial', 'Preferencial', 4, 14, { aisles: [7], firstRow: 'I' }),
      ],
    }),
  },
  {
    id: 'teatro',
    name: 'Teatro: platea y balcón',
    description: 'Platea con pasillo central y un balcón atrás.',
    build: () => ({
      stage: 'Escenario',
      sections: [
        section('platea', 'Platea', 12, 18, { aisles: [9] }),
        section('balcon', 'Balcón', 5, 18, { aisles: [9] }),
      ],
    }),
  },
  {
    id: 'auditorio',
    name: 'Auditorio con pasillo central',
    description: '15 filas × 20 asientos con un pasillo al medio.',
    build: () => ({ stage: 'Escenario', sections: [section('platea', 'Platea', 15, 20, { aisles: [10] })] }),
  },
  {
    id: 'sala-chica',
    name: 'Sala chica / café concert',
    description: '6 filas × 10 asientos. Para stand-up o música en vivo.',
    build: () => ({ stage: 'Escenario', sections: [section('sala', 'Sala', 6, 10)] }),
  },
  {
    id: 'en-blanco',
    name: 'En blanco',
    description: 'Una sección de 10 × 10 para armar a tu medida.',
    build: () => ({ stage: 'Escenario', sections: [section('sala', 'Sala', 10, 10)] }),
  },
]

/** Mapa nuevo desde una plantilla (por defecto, la sala de cine pequeña). */
export function seatMapFromTemplate(templateId) {
  const tpl = SEAT_MAP_TEMPLATES.find((t) => t.id === templateId) || SEAT_MAP_TEMPLATES[0]
  return normalizeSeatMap({ version: SEAT_MAP_VERSION, template: tpl.id, ...tpl.build() })
}

// ---------------------------------------------------------------------------------------------------------
// Normalización y recorrido
// ---------------------------------------------------------------------------------------------------------

/**
 * Mapa normalizado y acotado, o null si no hay mapa (entrada general). Ids de sección únicos y estables; los
 * pasillos y huecos fuera de rango se descartan. Respeta MAX_SEATS recortando filas de las últimas secciones.
 */
export function normalizeSeatMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const srcSections = Array.isArray(raw.sections) ? raw.sections.slice(0, MAX_SECTIONS) : []
  const ids = new Set()
  const sections = []
  let total = 0
  for (const [i, s] of srcSections.entries()) {
    if (!s || typeof s !== 'object') continue
    const name = text(s.name, 40) || `Sección ${i + 1}`
    let id = slug(s.id) || slug(name) || `s${i + 1}`
    while (ids.has(id)) id = `${id}-${i + 1}`
    const seatsPerRow = int(s.seatsPerRow, 1, MAX_SEATS_PER_ROW, 10)
    let rows = int(s.rows, 1, MAX_ROWS, 10)
    const room = Math.floor((MAX_SEATS - total) / seatsPerRow)
    if (room < 1) break
    rows = Math.min(rows, room)
    const firstRow = ROW_LETTERS.includes(String(s.firstRow || '').toUpperCase()) && String(s.firstRow).length === 1 ? String(s.firstRow).toUpperCase() : 'A'
    const aisles = [...new Set((Array.isArray(s.aisles) ? s.aisles : []).map((a) => Math.floor(Number(a))).filter((a) => a >= 1 && a < seatsPerRow))].sort((a, b) => a - b)
    const validRows = new Set(Array.from({ length: rows }, (_, r) => rowLabel(firstRow, r)))
    const removed = [...new Set((Array.isArray(s.removed) ? s.removed : []).map(String).filter((k) => {
      const m = /^([A-Z]{1,2})-(\d{1,3})$/.exec(k)
      return m && validRows.has(m[1]) && Number(m[2]) >= 1 && Number(m[2]) <= seatsPerRow
    }))]
    ids.add(id)
    sections.push({ id, name, rows, seatsPerRow, firstRow, aisles, removed })
    total += rows * seatsPerRow
  }
  if (!sections.length) return null
  return {
    version: SEAT_MAP_VERSION,
    template: text(raw.template, 40) || null,
    stage: text(raw.stage, 30) || 'Escenario',
    sections,
  }
}

export const seatKey = (sectionId, row, n) => `${sectionId}:${row}:${n}`

/** Filas de una sección para dibujarla: [{ label, seats: [{ n, key, removed, aisleAfter }] }] */
export function sectionRows(sec) {
  const removed = new Set(sec.removed || [])
  const aisles = new Set(sec.aisles || [])
  return Array.from({ length: sec.rows }, (_, r) => {
    const label = rowLabel(sec.firstRow, r)
    return {
      label,
      seats: Array.from({ length: sec.seatsPerRow }, (_, j) => {
        const n = j + 1
        return { n, key: seatKey(sec.id, label, n), removed: removed.has(`${label}-${n}`), aisleAfter: aisles.has(n) }
      }),
    }
  })
}

/** Todos los asientos que existen (sin huecos): [{ key, sectionId, sectionName, row, n }] */
export function listSeats(map) {
  const out = []
  for (const sec of map?.sections || []) {
    for (const row of sectionRows(sec)) {
      for (const s of row.seats) if (!s.removed) out.push({ key: s.key, sectionId: sec.id, sectionName: sec.name, row: row.label, n: s.n })
    }
  }
  return out
}

/** Índice clave → asiento. */
export function seatIndex(map) {
  return new Map(listSeats(map).map((s) => [s.key, s]))
}

/** Asientos por sección: { [sectionId]: n } */
export function seatCountBySection(map) {
  const out = {}
  for (const s of listSeats(map)) out[s.sectionId] = (out[s.sectionId] || 0) + 1
  return out
}

export const totalSeats = (map) => listSeats(map).length

/** "Fila C · Asiento 7", con la sección adelante si el mapa tiene más de una. */
export function seatLabel(map, key) {
  const s = seatIndex(map).get(key)
  if (!s) return ''
  const base = `Fila ${s.row} · Asiento ${s.n}`
  return (map.sections?.length || 0) > 1 ? `${s.sectionName} · ${base}` : base
}

/** Secciones permitidas de una entrada: null = todas. */
export function normalizeSeatSections(raw, map) {
  if (!Array.isArray(raw) || !raw.length) return null
  const valid = new Set((map?.sections || []).map((s) => s.id))
  const ids = [...new Set(raw.map(String).filter((id) => !map || valid.has(id)))]
  return ids.length ? ids : null
}

const allows = (ticket, sectionId) => !Array.isArray(ticket.seat_sections) || !ticket.seat_sections.length || ticket.seat_sections.includes(sectionId)

/**
 * Asigna cada asiento elegido a una entrada de la compra respetando las secciones de cada tipo de entrada
 * (emparejamiento bipartito: con secciones restringidas el orden importa).
 * lines: [{ id, quantity, seat_sections? }]; keys: claves elegidas.
 * Devuelve [{ key, ticketId }] o { error } si los asientos no calzan con las entradas.
 */
export function assignSeatsToLines(map, lines, keys) {
  const index = seatIndex(map)
  const slots = []
  for (const l of lines || []) for (let i = 0; i < Number(l.quantity || 0); i++) slots.push(l)
  const seats = [...new Set(keys || [])]
  if (seats.length !== slots.length) return { error: `Elige ${slots.length} ${slots.length === 1 ? 'asiento' : 'asientos'}.` }
  for (const k of seats) if (!index.has(k)) return { error: 'Uno de los asientos ya no existe. Vuelve a elegir.' }
  // Kuhn: asiento → slot
  const slotOf = new Array(slots.length).fill(-1)
  const tryAssign = (si, seen) => {
    const sec = index.get(seats[si]).sectionId
    for (let j = 0; j < slots.length; j++) {
      if (seen[j] || !allows(slots[j], sec)) continue
      seen[j] = true
      if (slotOf[j] === -1 || tryAssign(slotOf[j], seen)) {
        slotOf[j] = si
        return true
      }
    }
    return false
  }
  for (let si = 0; si < seats.length; si++) {
    if (!tryAssign(si, new Array(slots.length).fill(false))) {
      const s = index.get(seats[si])
      return { error: `${s.sectionName} · Fila ${s.row} · Asiento ${s.n} no corresponde a las entradas que elegiste.` }
    }
  }
  // En el orden en que se eligieron los asientos
  return slotOf
    .map((si, j) => ({ si, key: seats[si], ticketId: Number(slots[j].id) }))
    .sort((a, b) => a.si - b.si)
    .map(({ key, ticketId }) => ({ key, ticketId }))
}

/**
 * Cupo de una entrada numerada: asientos de sus secciones en cada función donde vale.
 * maps: Map(eventDateId → seat_map de la ubicación de esa función); eventDateId null = todas las funciones.
 */
export function seatedTicketCapacity(ticket, maps) {
  const ids = ticket.event_date_id ? [String(ticket.event_date_id)] : [...maps.keys()].map(String)
  let total = 0
  for (const id of ids) {
    const map = maps.get(id) || maps.get(Number(id))
    if (!map) continue
    const counts = seatCountBySection(map)
    for (const [sec, n] of Object.entries(counts)) if (allows(ticket, sec)) total += n
  }
  return total
}

/** Asientos de `protectedKeys` (vendidos o reservados) que ya no existen en `nextMap` (null = sin mapa). */
export function missingSeats(nextMap, protectedKeys) {
  const idx = nextMap ? seatIndex(nextMap) : new Map()
  return [...new Set(protectedKeys || [])].filter((k) => !idx.has(k))
}

/**
 * Elige `n` asientos libres para asignarlos sin que nadie los elija (cortesías): de preferencia juntos en una fila,
 * en las filas del medio hacia atrás y centrados. Si no hay n juntos, los mejores libres por fila. [] si no alcanza.
 * taken: Set o Array de claves ocupadas; sections: ids permitidos (null = todas).
 * @param {any} map
 * @param {Set<string>|string[]} taken
 * @param {number} n
 * @param {string[]|null} [sections]
 * @returns {string[]}
 */
export function pickBestSeats(map, taken, n, sections = null) {
  const busy = taken instanceof Set ? taken : new Set(taken || [])
  const rows = []
  for (const sec of map?.sections || []) {
    if (Array.isArray(sections) && sections.length && !sections.includes(sec.id)) continue
    sectionRows(sec).forEach((row, r) => {
      // Prioridad: cerca del 60 % de la profundidad de la sección
      rows.push({ sec, row, score: Math.abs(r - (sec.rows - 1) * 0.6) })
    })
  }
  rows.sort((a, b) => a.score - b.score)
  // 1. Juntos: tramos de asientos libres sin pasillo ni huecos de por medio
  for (const { row, sec } of rows) {
    const runs = []
    let run = []
    for (const s of row.seats) {
      if (!s.removed && !busy.has(s.key)) run.push(s)
      else if (run.length) (runs.push(run), (run = []))
      if (s.aisleAfter && run.length) (runs.push(run), (run = []))
    }
    if (run.length) runs.push(run)
    let best = null
    const center = (sec.seatsPerRow + 1) / 2
    for (const r of runs) {
      for (let i = 0; i + n <= r.length; i++) {
        const mid = (r[i].n + r[i + n - 1].n) / 2
        const d = Math.abs(mid - center)
        if (!best || d < best.d) best = { d, seats: r.slice(i, i + n) }
      }
    }
    if (best) return best.seats.map((s) => s.key)
  }
  // 2. Separados: los primeros libres según la prioridad de filas
  const out = []
  for (const { row } of rows) {
    for (const s of row.seats) {
      if (out.length >= n) break
      if (!s.removed && !busy.has(s.key)) out.push(s.key)
    }
  }
  return out.length >= n ? out : []
}
