// Agenda del evento (aitickets_event_agenda, migración 202610300200): bloques con hora, título, expositores y sala,
// cada uno de una función (día) o de todas. La editan el panel (EventAgendaManager.vue → /api/events/agenda) y el
// asistente de IA (get_event_agenda / update_event_agenda); la muestran la página del evento (eventPage.ts →
// EventSections.vue, sección "Agenda") y su asistente (netlify/functions/ai-assistant).
// Sin la tabla (deploy preview sin migrar) la agenda está vacía y la página no muestra la sección.
import { formatFunctionLabel } from '../../netlify/lib/dates.mjs'

export const AGENDA_TABLE = 'aitickets_event_agenda'
export const MAX_AGENDA_BLOCKS = 150
export const AGENDA_LIMITS = Object.freeze({ title: 160, speakers: 300, room: 80 })

const MISSING_TABLE = new Set(['42P01', 'PGRST205'])
export const isMissingAgendaTable = (error) =>
  MISSING_TABLE.has(error?.code) || (/aitickets_event_agenda/.test(error?.message || '') && /does not exist|schema cache/i.test(error?.message || ''))

/** Error de validación con el mensaje para el productor. */
export class AgendaError extends Error {
  constructor(message, { unavailable = false } = {}) {
    super(message)
    this.unavailable = unavailable
  }
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

/** "9:00", "09:00" o "09:00:00" => "09:00"; si no es una hora válida, null. */
export function normalizeTime(value) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

/**
 * Valida la agenda que manda el panel o la API y la deja ordenada (por día, hora y orden de llegada).
 * @param {unknown} raw lista de { function_id?, start, end?, title, speakers?, room? }
 * @param {Array<number|string>} functionIds funciones del evento
 * @returns {Array<{ function_id: number|null, start: string, end: string|null, title: string, speakers: string|null, room: string|null, position: number }>}
 */
export function normalizeAgenda(raw, functionIds = []) {
  if (!Array.isArray(raw)) throw new AgendaError('La agenda debe ser una lista de bloques.')
  if (raw.length > MAX_AGENDA_BLOCKS) throw new AgendaError(`La agenda puede tener hasta ${MAX_AGENDA_BLOCKS} bloques.`)
  const valid = new Set(functionIds.map(String))
  const order = new Map(functionIds.map((id, i) => [String(id), i]))
  const blocks = raw.map((b, i) => {
    const n = i + 1
    const title = clean(b?.title)
    if (!title) throw new AgendaError(`Al bloque ${n} le falta el título.`)
    if (title.length > AGENDA_LIMITS.title) throw new AgendaError(`El título del bloque ${n} es muy largo (máximo ${AGENDA_LIMITS.title} caracteres).`)
    const start = normalizeTime(b?.start)
    if (!start) throw new AgendaError(`La hora de inicio del bloque ${n} no es válida (usa HH:MM).`)
    const rawEnd = b?.end == null || b?.end === '' ? null : b.end
    const end = rawEnd == null ? null : normalizeTime(rawEnd)
    if (rawEnd != null && !end) throw new AgendaError(`La hora de término del bloque ${n} no es válida (usa HH:MM).`)
    if (end && end <= start) throw new AgendaError(`En el bloque ${n} la hora de término debe ser después del inicio.`)
    const speakers = clean(b?.speakers) || null
    if (speakers && speakers.length > AGENDA_LIMITS.speakers) throw new AgendaError(`Los expositores del bloque ${n} son muy largos (máximo ${AGENDA_LIMITS.speakers} caracteres).`)
    const room = clean(b?.room) || null
    if (room && room.length > AGENDA_LIMITS.room) throw new AgendaError(`La sala del bloque ${n} es muy larga (máximo ${AGENDA_LIMITS.room} caracteres).`)
    const fn = b?.function_id == null || b?.function_id === '' ? null : Number(b.function_id)
    if (fn !== null && !valid.has(String(fn))) throw new AgendaError(`La función del bloque ${n} no es de este evento.`)
    return { function_id: fn, start, end, title, speakers, room, i }
  })
  const fnRank = (id) => (id === null ? -1 : order.get(String(id)) ?? 0)
  blocks.sort((a, b) => fnRank(a.function_id) - fnRank(b.function_id) || a.start.localeCompare(b.start) || a.i - b.i)
  return blocks.map(({ i: _i, ...b }, k) => ({ ...b, position: k }))
}

/** Fila de la BD => bloque (horas HH:MM). */
export const agendaFromRow = (r) => ({
  id: r.id ?? null,
  function_id: r.event_date_id ?? null,
  start: normalizeTime(r.starts_at) || '00:00',
  end: r.ends_at ? normalizeTime(r.ends_at) : null,
  title: r.title,
  speakers: r.speakers || null,
  room: r.room || null,
  position: Number(r.position) || 0,
})

/** Bloques de un evento, ordenados. Sin la tabla o con error: []. */
export async function loadAgenda(supabase, eventId) {
  const { data, error } = await supabase
    .from(AGENDA_TABLE)
    .select('id, event_date_id, starts_at, ends_at, title, speakers, room, position')
    .eq('event_id', eventId)
    .order('position', { ascending: true })
    .order('id', { ascending: true })
  if (error) {
    if (!isMissingAgendaTable(error)) console.error('loadAgenda:', error.message)
    return []
  }
  return (data || []).map(agendaFromRow)
}

/**
 * Reemplaza la agenda del evento por `blocks` (ya normalizados). Primero inserta los nuevos y después borra los
 * anteriores: si algo falla a mitad, queda la agenda anterior (o repetida), nunca vacía.
 * Lanza AgendaError si la tabla no existe todavía.
 */
export async function saveAgenda(supabase, eventId, blocks) {
  const { data: before, error: readError } = await supabase.from(AGENDA_TABLE).select('id').eq('event_id', eventId)
  if (readError) {
    if (isMissingAgendaTable(readError)) throw new AgendaError('La agenda aún no está disponible. Intenta más tarde.', { unavailable: true })
    throw new Error(readError.message)
  }
  if (blocks.length) {
    const rows = blocks.map((b) => ({
      event_id: eventId,
      event_date_id: b.function_id,
      starts_at: b.start,
      ends_at: b.end,
      title: b.title,
      speakers: b.speakers,
      room: b.room,
      position: b.position,
    }))
    const { error } = await supabase.from(AGENDA_TABLE).insert(rows)
    if (error) throw new Error(error.message)
  }
  const oldIds = (before || []).map((r) => r.id)
  if (oldIds.length) {
    const { error } = await supabase.from(AGENDA_TABLE).delete().eq('event_id', eventId).in('id', oldIds)
    if (error) throw new Error(error.message)
  }
  return loadAgenda(supabase, eventId)
}

/**
 * Agenda agrupada por función para la página: primero los bloques de todas las funciones ("Todos los días"),
 * después cada función en orden. Con una sola función (o sin funciones) va un solo grupo sin título.
 * El título de cada día es "Día 1 · Jue 3 dic"; si dos funciones caen el mismo día, lleva la hora en vez de "Día N".
 * Un bloque de una función que ya no existe cuenta como de todas.
 * @param {Array<any>} blocks
 * @param {Array<{ id: any, date: string, start_time?: string|null }>} dates funciones del evento
 */
export function agendaGroups(blocks, dates = []) {
  if (!blocks?.length) return []
  const fns = [...(dates || [])]
    .filter((d) => d?.id != null && d.date)
    .sort((a, b) => `${a.date}|${a.start_time || ''}`.localeCompare(`${b.date}|${b.start_time || ''}`))
  const multi = fns.length > 1
  const sameDay = new Set(fns.map((d) => String(d.date).slice(0, 10))).size < fns.length
  const known = new Set(fns.map((d) => String(d.id)))
  const keyOf = (b) => (multi && b.function_id != null && known.has(String(b.function_id)) ? String(b.function_id) : 'all')
  const byKey = new Map()
  for (const b of blocks) {
    const key = keyOf(b)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(b)
  }
  const sortBlocks = (list) =>
    [...list]
      .sort((a, b) => a.start.localeCompare(b.start) || (a.position ?? 0) - (b.position ?? 0))
      .map((b) => ({ id: b.id ?? null, start: b.start, end: b.end, title: b.title, speakers: b.speakers, room: b.room }))
  const groups = []
  if (byKey.has('all')) groups.push({ key: 'all', function_id: null, title: multi ? 'Todos los días' : null, blocks: sortBlocks(byKey.get('all')) })
  fns.forEach((d, i) => {
    const list = byKey.get(String(d.id))
    if (!list) return
    const day = formatFunctionLabel({ date: d.date }, { withPlace: false })
    const title = sameDay ? formatFunctionLabel({ date: d.date, start_time: d.start_time }, { withPlace: false }) : `Día ${i + 1} · ${day}`
    groups.push({ key: String(d.id), function_id: d.id, title, blocks: sortBlocks(list) })
  })
  return groups
}

/** "09:00 – 10:30" o "09:00". */
export const blockTime = (b) => (b.end ? `${b.start} – ${b.end}` : b.start)

/** La agenda en texto, una línea por bloque (asistente de la página y del productor). */
export function agendaText(groups) {
  return (groups || [])
    .map((g) => {
      const lines = g.blocks.map((b) => `- ${blockTime(b)} ${b.title}${b.speakers ? ` · ${b.speakers}` : ''}${b.room ? ` · ${b.room}` : ''}`)
      return [g.title ? `${g.title}:` : null, ...lines].filter(Boolean).join('\n')
    })
    .join('\n')
}
