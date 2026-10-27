// Datos y cálculos de la landing de seminarios (/ticketera-seminarios, docs/specs/rediseno/SPEC_landing_seminarios_aitickets.md).
// Sin dependencias de Node: lo usan las secciones Astro, las islas Vue y los tests. Los montos y plazos NO se escriben
// aquí: el cargo sale de fees.mjs (priceQuote de producerLanding.js), el convenio de discounts.mjs
// (computeDiscountedTotals, la misma cuenta del checkout), la hora de cobro de PAYOUT_RELEASE_HOURS (legal.mjs, como
// functionEnd y lastFunctionEnd en ledger.ts) y los rótulos de la card de ejemplo de cardState / cardLabel /
// cardFunctionChips (eventView.js) sobre un evento sintético, como en talleres.
// Evento, organización, expositores, asistentes, empresas y códigos: ficticios (§0.10). Nunca nombres de universidades,
// gremios, colegios profesionales o empresas reales; antes de publicar, revisar que "Jornada Equipos 2026" y los demás
// no coincidan con eventos o personas reales de Chile (Preguntas abiertas 18). Toda card con datos dice "ejemplo".
import { EVENT_TIMEZONE, addDays, formatFunctionLabel, todayInTimeZone, zonedDateTimeToUtc } from '../../../../netlify/lib/dates.mjs'
import { computeDiscountedTotals } from '../../../../netlify/lib/discounts.mjs'
import { PAYOUT_RELEASE_HOURS } from '../../../../netlify/lib/legal.mjs'
import {
  cardFunctionChips,
  cardLabel,
  cardState,
  formatLongDate,
  formatSaleStart,
  formatShortDate,
  formatTimeRange,
  minFinalPrice,
} from '../../event/eventView.js'
import { priceQuote } from '../producerLanding.js'

/**
 * Fotos de la página. Son las de referencia generadas con IA (public/landing, ver docs/specs/rediseno/fotos-nicho.md):
 * antes de publicar van fotos reales de seminarios de organizadores que usen AI Tickets, con autorización escrita del
 * organizador y, si se reconocen, de expositores y asistentes (§0.8 y §8). Mismo bloqueo de publicación que las otras
 * landings. La de acreditación muestra una pistola lectora (AI Tickets escanea con la cámara del celular): no se muestra
 * (SHOW_DESK_PHOTO) hasta tener una con celular.
 * Cada una con AVIF/WebP a varios anchos (generados con sharp desde el JPG: regenerar si cambia la foto). La del hero de
 * referencia mide 1024 px de ancho: la real debe venir a 2400 px y entonces se suman 1344/2048 (§7). La del hero se
 * repite recortada en las historias de Instagram (mismo archivo: una sola descarga).
 */
const photo = (name, width, height, widths) => ({
  src: `/landing/${name}.jpg`,
  width,
  height,
  sources: ['avif', 'webp'].map((ext) => ({
    type: `image/${ext}`,
    srcset: widths.map((w) => `/landing/${name}-${w}.${ext} ${w}w`).join(', '),
  })),
})

export const SEMINAR_PHOTOS = Object.freeze({
  hero: photo('aitk-seminario-sala', 1024, 688, [640, 1024]),
  organizadora: photo('aitk-seminario-organizadora', 896, 1120, [480, 896]),
  networking: photo('aitk-seminario-networking', 896, 1120, [480, 896]),
  acreditacion: photo('aitk-seminario-acreditacion', 896, 1120, [480, 896]),
})

/** Alt de las fotos (§9) */
export const PHOTO_ALT = Object.freeze({
  hero: 'Expositor hablando frente a una audiencia en una sala de conferencias con vista a la cordillera',
  organizadora: 'Organizadora revisando el programa en su notebook detrás del escenario',
  networking: 'Asistentes conversando con café en la pausa de un seminario',
  // Alt de la foto con celular que debe reemplazar a la de referencia (la de referencia no se muestra: SHOW_DESK_PHOTO)
  acreditacion: 'Acreditación en el hall: un asistente muestra el QR de su entrada en el celular',
})

/**
 * La foto del hall en la mesa de acreditación (§4.7) es "solo staging": la de referencia muestra una pistola lectora y
 * AI Tickets escanea con la cámara del celular. El sitio no tiene un entorno de staging propio (el merge publica), así
 * que queda apagada y, como pide §4.7 cuando no hay foto con celular, la columna muestra los ítems. Con una foto real
 * con celular (mismo nombre de archivo, regenerando AVIF/WebP), se pone en true.
 */
export const SHOW_DESK_PHOTO = false

/**
 * Telón del proyector en la foto del hero, en fracciones de la imagen (§4.1). Medido a ojo sobre
 * aitk-seminario-sala.jpg (1024×688): el telón va de x 537 a 998 y de y 10 a 345 px, pero desde y ≈ 300 lo tapan las
 * cabezas del público, así que la lámina ocupa solo la parte libre. Cada foto real trae el suyo.
 */
export const HERO_SCREEN_RECT = Object.freeze({ x: 0.527, y: 0.022, w: 0.444, h: 0.41 })

// ---- El evento de ejemplo (todo el sitio, §4.1) ----

export const SEMINAR_NAME = 'Jornada Equipos 2026'
export const SEMINAR_EVENT_URL = 'aitickets.cl/eventos/jornada-equipos-2026'
export const SEMINAR_VENUE = 'Centro de eventos en Providencia'
export const SEMINAR_CITY = 'Providencia'
/** Organización y RUT de la página de ejemplo: ficticios y evidentes (Preguntas abiertas 18) */
export const SEMINAR_ORG = 'Red de Gestión SpA (ejemplo)'
export const SEMINAR_RUT = '00.000.000-0'
/** Jueves (getUTCDay) */
const THURSDAY = 4
/** El Día 1 cae al menos estos días después de la fecha de build */
export const SEMINAR_MIN_DAYS_AHEAD = 35

/** Día 1 de la jornada (YYYY-MM-DD): el jueves que cae al menos 35 días después de `now`, en hora de Chile */
export function seminarDate(now = new Date()) {
  const base = addDays(todayInTimeZone(EVENT_TIMEZONE, now), SEMINAR_MIN_DAYS_AHEAD)
  const weekday = new Date(`${base}T12:00:00Z`).getUTCDay() // 0 = domingo
  return addDays(base, (THURSDAY - weekday + 7) % 7)
}

// ---- Formatos y programa (§4.3) ----

/**
 * Bloques de ejemplo por formato. kind: 'talk' | 'pause' (café, almuerzo, acreditación: en gris con pictograma).
 * focus: el bloque que el puntero marca al cambiar de formato (el keynote). key: identifica el bloque entre formatos
 * (FLIP: los que se repiten no salen ni entran).
 */
const block = (time, title, kind = 'talk', focus = false) => ({ key: `${time}-${title}`, time, title, kind, focus })
const MORNING = [
  block('08:30', 'Acreditación', 'pause'),
  block('09:00', 'Bienvenida'),
  block('09:15', 'Keynote · Paula Ríos', 'talk', true),
  block('10:30', 'Café', 'pause'),
  block('11:00', 'Panel: equipos híbridos · Tomás Vidal, Fernanda Lagos'),
]

/**
 * Los tres formatos: cada día es una función (con su horario) y sus bloques. Congreso: Día 1 de 09:00 a 18:00 y Día 2
 * de 09:00 a 13:30 (§4.1); seminario de 08:30 a 13:00; charla de 19:00 a 20:45.
 */
export const FORMATS = Object.freeze([
  {
    id: 'charla',
    label: 'Charla',
    days: [
      {
        start: '19:00',
        end: '20:45',
        blocks: [block('19:00', 'Recepción', 'pause'), block('19:15', 'Cómo medir lo que aprende un equipo · Paula Ríos', 'talk', true), block('20:15', 'Preguntas')],
      },
    ],
  },
  { id: 'seminario', label: 'Seminario de un día', days: [{ start: '08:30', end: '13:00', blocks: [...MORNING, block('12:30', 'Cierre')] }] },
  {
    id: 'congreso',
    label: 'Congreso de dos días',
    days: [
      { start: '09:00', end: '18:00', blocks: [...MORNING, block('12:30', 'Almuerzo', 'pause'), block('14:00', 'Sesiones de la tarde'), block('17:30', 'Cierre del día')] },
      {
        start: '09:00',
        end: '13:30',
        blocks: [block('09:00', 'Keynote · Diego Mardones', 'talk', true), block('10:30', 'Café', 'pause'), block('11:00', 'Panel de cierre'), block('13:00', 'Conclusiones')],
      },
    ],
  },
])
export const DEFAULT_FORMAT = 'congreso'
export function formatById(id) {
  const format = FORMATS.find((f) => f.id === id) ?? FORMATS.find((f) => f.id === DEFAULT_FORMAT)
  if (!format) throw new Error(`Falta el formato ${DEFAULT_FORMAT}`)
  return format
}

/** Alcance de una entrada: una función ('d1', 'd2') o todas ('all'). La regla del producto: una o todas, nunca dos de tres */
export const SCOPE_ALL = 'all'

/**
 * Tipos de entrada de ejemplo por formato, con su alcance por defecto. student: la quita o la agrega el toggle
 * "+ Entrada estudiante"; main: la entrada general, la que espera a que cierre la preventa.
 */
const PAID_TICKETS = {
  congreso: [
    { id: 'pase', name: 'Pase completo', price: 60000, capacity: 120, scope: SCOPE_ALL, main: true },
    { id: 'dia1', name: 'Solo día 1', price: 40000, capacity: 60, scope: 'd1' },
    { id: 'dia2', name: 'Solo día 2', price: 30000, capacity: 40, scope: 'd2' },
    { id: 'estudiante', name: 'Estudiante', price: 25000, capacity: 40, scope: SCOPE_ALL, student: true },
  ],
  seminario: [
    { id: 'general', name: 'General', price: 35000, capacity: 150, scope: 'd1', main: true },
    { id: 'estudiante', name: 'Estudiante', price: 15000, capacity: 40, scope: 'd1', student: true },
  ],
  charla: [{ id: 'general', name: 'General', price: 8000, capacity: 120, scope: 'd1', main: true }],
}
/**
 * Preventa de ejemplo (toggle "Preventa hasta el {fecha}"). La spec solo da la del congreso ($50.000 × 50, todos los
 * días); seminario y charla llevan una proporcional para que el toggle sirva en los tres formatos.
 */
const PRESALE_TICKETS = {
  congreso: { id: 'preventa', name: 'Preventa', price: 50000, capacity: 50, scope: SCOPE_ALL },
  seminario: { id: 'preventa', name: 'Preventa', price: 28000, capacity: 50, scope: 'd1' },
  charla: { id: 'preventa', name: 'Preventa', price: 6000, capacity: 40, scope: 'd1' },
}
const FREE_TICKET = { id: 'inscripcion', name: 'Inscripción', price: 0, capacity: 120, main: true }
/** La preventa cierra 14 días antes del Día 1, a las 10:00 (desde ahí se vende la general) */
export const PRESALE_CLOSE_DAYS = 14
export const PRESALE_CLOSE_TIME = '10:00'

/**
 * Modelo del programa (§4.3): funciones (una por día, con fecha y horario), tipos de entrada con su alcance y aforo
 * (suma de cupos). mode: 'paid' | 'free'. options: { student, presale, scopes: { [idEntrada]: 'd1' | 'd2' | 'all' } }.
 * En un evento de una función, todo vale para esa función ('d1'). Gratis: un solo tipo, "Inscripción", para todos los
 * días en el congreso.
 */
export function programModel(format, mode = 'paid', { student = true, presale = false, scopes = {} } = {}, date = seminarDate()) {
  const f = formatById(format)
  const functions = f.days.map((d, i) => ({ id: `d${i + 1}`, label: `Día ${i + 1}`, date: addDays(date, i), start: d.start, end: d.end, blocks: d.blocks }))
  const multi = functions.length > 1
  const valid = new Set([...functions.map((fn) => fn.id), ...(multi ? [SCOPE_ALL] : [])])
  let tickets
  if (mode === 'free') {
    tickets = [{ ...FREE_TICKET, scope: multi ? SCOPE_ALL : 'd1' }]
  } else {
    tickets = PAID_TICKETS[f.id].filter((t) => student || !t.student)
    if (presale) tickets = [PRESALE_TICKETS[f.id], ...tickets]
  }
  tickets = tickets.map((t) => {
    const wanted = scopes[t.id]
    const scope = wanted && valid.has(wanted) ? wanted : valid.has(t.scope) ? t.scope : functions[0].id
    return { ...t, scope }
  })
  return { format: f.id, mode, functions, tickets, capacity: tickets.reduce((s, t) => s + t.capacity, 0), presale: mode === 'paid' && presale }
}

/** Columnas de la matriz de acceso: una por función y, si hay más de una, "Todos los días" */
export function matrixColumns(model) {
  const cols = model.functions.map((fn) => ({ id: fn.id, label: fn.label }))
  return model.functions.length > 1 ? [...cols, { id: SCOPE_ALL, label: 'Todos los días' }] : cols
}

/** "Día 1" / "Todas las funciones" (como lo dice el panel) */
export const scopeLabel = (model, scope) => (scope === SCOPE_ALL ? 'Todas las funciones' : model.functions.find((fn) => fn.id === scope)?.label ?? '')

/** "Jue 3 dic · 09:00 – 18:00" de una función */
export const functionLine = (fn) => `${formatShortDate(fn.date)} · ${formatTimeRange({ start_time: fn.start, end_time: fn.end })}`

/** "En tu panel" (§4.3) */
export function panelSummary(model) {
  const n = model.functions.length
  const k = model.tickets.length
  return {
    functions: `${n} ${n === 1 ? 'función' : 'funciones'}`,
    functionLines: model.functions.map((fn) => `${fn.label} · ${functionLine(fn)}`),
    tickets: `${k} ${k === 1 ? 'tipo de entrada' : 'tipos de entrada'}`,
    ticketLines: model.tickets.map((t) => ({ name: t.name, scope: scopeLabel(model, t.scope) })),
    capacity: `Aforo ${model.capacity.toLocaleString('es-CL')}`,
    /** Lo que se anuncia al cambiar algo (useDelayedAnnouncement) */
    announce: `${n} ${n === 1 ? 'función' : 'funciones'}, ${k} ${k === 1 ? 'tipo de entrada' : 'tipos de entrada'}, aforo ${model.capacity.toLocaleString('es-CL')}`,
  }
}

/** Cierre de la preventa (ISO): PRESALE_CLOSE_DAYS antes del Día 1, a las PRESALE_CLOSE_TIME en hora de Chile */
export const presaleCloseIso = (date = seminarDate()) => zonedDateTimeToUtc(addDays(date, -PRESALE_CLOSE_DAYS), PRESALE_CLOSE_TIME).toISOString()
/** "Preventa hasta el Jue 19 nov" */
export const presaleToggleLabel = (date = seminarDate()) => `Preventa hasta el ${formatShortDate(addDays(date, -PRESALE_CLOSE_DAYS))}`

/** Cupos que quedan con el toggle "Casi lleno" (gratis): 12 de 120 → "Gratis · Quedan 12 cupos" */
export const ALMOST_FULL_LEFT = 12

/**
 * Evento sintético para preguntarle a eventView.js lo que mostraría la card real: las funciones con su lugar, cada
 * entrada amarrada a su función (event_date_id) o a todas (null), con su precio final (priceQuote: el cargo incluido) y
 * su cupo. Con preventa, la entrada general espera en unavailable_tickets ("upcoming", sales_start = cierre de la
 * preventa). almostFull: la inscripción gratis con ALMOST_FULL_LEFT cupos.
 */
export function previewEvent(model, { almostFull = false, date = seminarDate() } = {}) {
  const single = model.functions.length === 1
  const venue = { name: SEMINAR_VENUE, city: SEMINAR_CITY }
  const dates = model.functions.map((fn) => ({ id: fn.id, date: fn.date, start_time: fn.start, end_time: fn.end, venue }))
  const all = model.tickets.map((t) => ({
    id: t.id,
    ticket_name: t.name,
    price: t.price,
    final_price: priceQuote(t.price).buyerPays,
    total_quantity: t.capacity,
    remaining: almostFull && t.price === 0 ? ALMOST_FULL_LEFT : t.capacity,
    event_date_id: single || t.scope === SCOPE_ALL ? null : t.scope,
  }))
  const waiting = (t) => model.presale && model.tickets.find((m) => m.id === t.id)?.main
  const tickets = all.filter((t) => !waiting(t))
  const unavailable_tickets = all.filter(waiting).map((t) => ({ ...t, reason: 'upcoming', sales_start: presaleCloseIso(date) }))
  return {
    id: 'seminario-ejemplo',
    name: SEMINAR_NAME,
    is_demo: true,
    status: 'published',
    dates,
    tickets,
    unavailable_tickets,
    sale_state: 'on_sale',
  }
}

/**
 * El "ahora" de la card de ejemplo: el día del build (SEMINAR_MIN_DAYS_AHEAD antes del Día 1), sacado de la fecha que
 * llega por props y no del reloj de quien visita. La página es prerender: si nadie despliega en semanas, con el reloj
 * real la jornada quedaría en el pasado y el cliente no diría lo mismo que el HTML (desfase de hidratación).
 */
const previewNow = (date) => new Date(`${addDays(date, -SEMINAR_MIN_DAYS_AHEAD)}T12:00:00Z`)

/**
 * "Lo que ve tu público" (§4.3): el estado, el rótulo y los chips de la card real (cardState / cardLabel /
 * cardFunctionChips), el precio que muestra (el final, con el cargo incluido: "por entrada, incluye cargo"), el botón y
 * la fila del checkout de cada entrada ("Disponible desde el {formatSaleStart}" si espera la preventa).
 */
export function buyerCard(model, opts = {}) {
  const event = previewEvent(model, opts)
  const now = previewNow(opts.date ?? seminarDate())
  const state = cardState(event, now)
  const label = cardLabel(event, state, { now })
  const chips = cardFunctionChips(event, { now }).chips.map((c) => c.label)
  const free = state === 'free' || state === 'free_full'
  const cta = free ? 'Confirmar asistencia' : state === 'paid_simple' ? 'Comprar entrada' : 'Elegir entradas'
  const price = free ? null : state === 'paid_simple' ? event.tickets[0].final_price : minFinalPrice(event)
  const rows = model.tickets.map((t) => {
    const waiting = event.unavailable_tickets.find((u) => u.id === t.id)
    return { id: t.id, name: t.name, price: t.price, opens: waiting ? `Disponible desde el ${formatSaleStart(waiting.sales_start)}` : null }
  })
  return { state, label: label?.text ?? null, tone: label?.tone ?? 'neutral', chips, cta, price, from: state === 'paid_multi', free, rows }
}

/**
 * La agenda en la descripción (§4.3): un título por día ("Jueves 3 de diciembre") y una línea por bloque, como queda con
 * los títulos y listas que acepta la descripción (sanitize.ts).
 */
export function agendaText(model) {
  const now = new Date(`${model.functions[0].date}T12:00:00Z`)
  return model.functions.map((fn) => ({
    heading: `${model.functions.length > 1 ? `${fn.label} · ` : ''}${formatLongDate(fn.date, { now })}`,
    items: fn.blocks.map((b) => `${b.time} ${b.title}`),
  }))
}

// ---- Fechas, cobro por jornada (§0.3, §4.8) ----

/** "Sáb 5 dic, 18:00" de un instante, en hora de Chile */
function chileLabel(at) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: EVENT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  return `${formatShortDate(`${parts.year}-${parts.month}-${parts.day}`)}, ${parts.hour}:${parts.minute}`
}

/**
 * Cuándo queda disponible lo de una función: término + PAYOUT_RELEASE_HOURS (functionEnd de ledger.ts). Una orden con
 * pase completo (event_date_id NULL) o con entradas de varios días se libera con la ÚLTIMA función (lastFunctionEnd).
 */
export function releaseAt(date, end, hours = PAYOUT_RELEASE_HOURS) {
  const at = new Date(zonedDateTimeToUtc(date, end).getTime() + hours * 3600 * 1000)
  return { iso: at.toISOString(), label: chileLabel(at) }
}

/** La jornada de ejemplo: fechas, horarios y la hora de cobro de cada entrada del congreso */
export function seminarSchedule(now = new Date()) {
  const d1 = seminarDate(now)
  const d2 = addDays(d1, 1)
  const [day1, day2] = formatById('congreso').days
  const fn1 = { date: d1, start_time: day1.start }
  const fn2 = { date: d2, start_time: day2.start }
  return {
    d1,
    d2,
    /** "Jue 3 dic" / "Vie 4 dic" */
    short1: formatShortDate(d1),
    short2: formatShortDate(d2),
    /** Rótulo de la función como lo dice el escáner (formatFunctionLabel de dates.mjs, sin lugar): "Vie 4 dic · 09:00" */
    fnLabel1: formatFunctionLabel(fn1, { withPlace: false }),
    fnLabel2: formatFunctionLabel(fn2, { withPlace: false }),
    /** Fecha de la cotización: la de hoy (build) */
    today: formatShortDate(todayInTimeZone(EVENT_TIMEZONE, now)),
    release: {
      day1: releaseAt(d1, day1.end),
      /** Solo día 2 y pase completo: la última función */
      last: releaseAt(d2, day2.end),
    },
  }
}

/**
 * Texto del cobro por jornada (§0.3). La regla no existe como texto en legal.mjs: se arma aquí con PAYOUT_RELEASE_HOURS
 * siguiendo ledger.ts (cada orden con el término de su función; el pase completo, event_date_id NULL, con la última).
 */
export const dayReleaseText = `Lo de cada día queda disponible ${PAYOUT_RELEASE_HOURS} h después de que termina; el pase completo, ${PAYOUT_RELEASE_HOURS} h después del último día`
export const congressReleaseText = `En un congreso, lo de cada día se libera con ese día; lo del pase completo, ${PAYOUT_RELEASE_HOURS} h después del último día.`
/**
 * Garantía de plazo de la sección Precio (§4.8). La spec pide PAYOUT_SHORT_TEXT, pero ese texto habla de "cada show" y
 * no calza con una jornada; se arma aquí con la misma constante (como talleres) y con la regla completa de ledger.ts: el
 * pase completo no se cobra por día, sino con el último.
 */
export const payoutGuaranteeText = `Cobras por jornada: lo de cada día, ${PAYOUT_RELEASE_HOURS} h después de que termina; el pase completo, ${PAYOUT_RELEASE_HOURS} h después del último`

// ---- Hero (§4.1): las láminas que proyecta la pantalla ----

/** Inscritos por tipo de entrada (suman 248 de 260 cupos) */
export const HERO_REGISTERED = Object.freeze([
  { id: 'pase', name: 'Pase completo', count: 110 },
  { id: 'dia1', name: 'Solo día 1', count: 60 },
  { id: 'dia2', name: 'Solo día 2', count: 38 },
  { id: 'estudiante', name: 'Estudiante', count: 40 },
])
export const SEMINAR_CAPACITY = PAID_TICKETS.congreso.reduce((s, t) => s + t.capacity, 0)
/** Cortesías (expositores, auspiciadores y prensa): el escáner cuenta todas las entradas emitidas */
export const SEMINAR_COURTESIES = 24
export const registeredTotal = () => HERO_REGISTERED.reduce((s, r) => s + r.count, 0)
/** Entradas emitidas (las que cuenta el escáner): inscritos + cortesías */
export const ISSUED_TICKETS = HERO_REGISTERED.reduce((s, r) => s + r.count, 0) + SEMINAR_COURTESIES

/** Las tres láminas (avanzan cada HERO_SLIDE_MS solo mientras se ven) */
export const HERO_SLIDES = Object.freeze(['programa', 'inscritos', 'acreditacion'])
export const HERO_SLIDE_MS = 6000

// ---- Empresas (§4.4) ----

export const TEAM_ORDER = Object.freeze({
  buyer: 'Marcela Ortiz',
  area: 'Personas y Cultura',
  qty: 8,
  ticketId: 'pase',
  ticket: 'Pase completo',
  recipients: ['Jorge Peña', 'Valentina Díaz', 'Ignacio Rojas'],
  holder: { index: 1, name: 'Valentina Díaz', email: 'valentina@empresa-ejemplo.cl' },
})
/** Total pagado de la compra de la empresa: 8 × lo que paga el público por un pase (priceQuote): $525.696 */
export const teamOrderTotal = () => priceQuote(PAID_TICKETS.congreso[0].price).buyerPays * TEAM_ORDER.qty

/**
 * Tope de entradas por compra que acepta el asistente de IA (max_per_order: maximum 50 en el esquema de
 * src/lib/producer-api/tools/tickets.ts; no hay constante exportada: el test lo compara con el archivo). No se importa de
 * ahí: tickets.ts es un módulo de servidor (Supabase, identidad del productor) y este archivo lo cargan las islas en el
 * navegador (TeamOrder.vue).
 */
export const MAX_PER_ORDER_AI = 50

/** Convenio de ejemplo: 20% sobre el pase completo (código válido: DISCOUNT_CODE_RE) */
export const AGREEMENT = Object.freeze({ code: 'COLEGIO20', discount: { kind: 'percent', value: 20 }, price: PAID_TICKETS.congreso[0].price })
/** Lo que paga el socio con el código, cargo incluido (computeDiscountedTotals): $60.000 → $52.570 */
export const agreementTotals = () => computeDiscountedTotals(AGREEMENT.price, AGREEMENT.discount)

// ---- Difusión (§4.5) ----

const PRICE_OF = Object.fromEntries(PAID_TICKETS.congreso.map((t) => [t.id, t.price]))
/**
 * Canales de las métricas del evento (trackingChannel de eventAnalytics.ts: "ref:paula-rios"; la venta directa se
 * llama DIRECT_CHANNEL y llega por props). Entradas por tipo; los ingresos salen de los precios del congreso de §4.3 (y
 * el canal del convenio, con el descuento de COLEGIO20 por entrada, computeDiscountedTotals). Suman los 248 inscritos.
 */
const CHANNEL_ROWS = [
  { id: 'paula-rios', label: 'ref:paula-rios', who: 'Expositora', visits: 380, mix: { pase: 28, dia1: 6, dia2: 2, estudiante: 4 } },
  { id: 'colegio', label: 'ref:colegio', who: 'Convenio', visits: 210, mix: { pase: 22, dia1: 2, dia2: 0, estudiante: 0 }, agreement: true },
  { id: 'linkedin', label: 'LinkedIn', who: 'origen de la visita', visits: 520, mix: { pase: 18, dia1: 8, dia2: 4, estudiante: 2 } },
  { id: 'instagram', label: 'Instagram (bio)', who: '', visits: 640, mix: { pase: 10, dia1: 6, dia2: 6, estudiante: 14 } },
  { id: 'invite', label: 'ref:invite', who: 'Invitar a alguien', visits: 90, mix: { pase: 9, dia1: 2, dia2: 1, estudiante: 0 } },
  { id: 'directo', label: null, who: '', visits: 980, mix: { pase: 23, dia1: 36, dia2: 25, estudiante: 20 } },
]
export function seminarChannels(directLabel) {
  return CHANNEL_ROWS.map(({ mix, agreement, ...row }) => {
    const tickets = Object.values(mix).reduce((s, n) => s + n, 0)
    const revenue = Object.entries(mix).reduce((s, [id, n]) => {
      const price = agreement ? computeDiscountedTotals(PRICE_OF[id], AGREEMENT.discount).subtotal : PRICE_OF[id]
      return s + price * n
    }, 0)
    return { ...row, label: row.label ?? directLabel, tickets, revenue }
  })
}
/** Orden de la tabla: por entradas ('tickets') o por ingresos ('revenue'), de mayor a menor */
export const sortChannels = (rows, by) => [...rows].sort((a, b) => b[by] - a[by] || a.id.localeCompare(b.id))
/** Link de ejemplo de un expositor (ref, como TrackingLinkBuilder.vue) */
export const channelLink = (id) => `${SEMINAR_EVENT_URL}?ref=${id}`

/**
 * Historias de Instagram (§4.5): D-10, D-3 (quedan 26 de 260: 10%, bajo el umbral de escasez) y D-1. remaining = entradas
 * que quedan (pieceText solo lo muestra la última semana y la página solo si isScarce).
 */
export const STORY_FRAMES = Object.freeze([
  { id: 'd10', days: 10, remaining: null },
  { id: 'd3', days: 3, remaining: 26 },
  { id: 'd1', days: 1, remaining: null },
])
/** ¿La serie mostraría "Quedan N"? Solo bajo scarcity_threshold_pct % del aforo (socialSeries.ts) */
export const isScarce = (remaining, threshold, capacity = SEMINAR_CAPACITY) => remaining != null && remaining > 0 && (remaining / capacity) * 100 < threshold

/** Demo de anuncios (§4.5): presupuesto diario y días de la demo (1-7; en el panel, hasta AD_LIMITS.maxDays) */
export const SEMINAR_ADS_DEMO = Object.freeze({ budgetMin: 3000, budgetMax: 50000, budgetStep: 1000, budget: 8000, daysMax: 7, days: 3, mobileDays: 3, ageMax: 65 })

// ---- Antes del día (§4.6) ----

export const SEMINAR_WALL_COUNTS = Object.freeze({ '🙌': 46, '🎉': 21, '❤️': 12, '🔥': 9 })
export const SEMINAR_WALL_POSTS = Object.freeze([
  { id: 'p1', name: 'Camila R.', role: 'Área de Personas', emoji: '🙌', when: 'hace 2 h', text: 'Vamos 4 del área de Personas. ¿Alguien más de Concepción?', tint: '#CFEAE5' },
  { id: 'p2', name: 'Felipe A.', role: 'Analista de desarrollo', emoji: '🎉', when: 'ayer', text: 'Primera vez en la jornada. Nos vemos en el café.', tint: '#E9EAE3' },
  { id: 'p3', name: 'Rocío M.', role: 'Jefa de proyectos', emoji: '❤️', when: 'ayer', text: 'Llevo preguntas para el panel de cierre.', tint: '#FFFFFF' },
])

// ---- Mesa de acreditación (§4.7) ----

/** Acreditadas por mesa al empezar la demo (la mesa 2 sube con cada caso válido): 71 + 64 + 75 = 210 → 214 */
export const DESK_TABLES = Object.freeze([
  { id: 1, start: 71 },
  { id: 2, start: 64, live: true },
  { id: 3, start: 75 },
])
export const DESK_START = DESK_TABLES.reduce((s, t) => s + t.start, 0)
/** Pendientes de sincronizar antes de la demo (una válida que se hizo sin señal) */
export const DESK_PENDING = 1
/** Siluetas de la fila */
export const DESK_QUEUE = 8

/**
 * Los cinco casos de la mesa, con los textos reales de ValidateQR.vue (deskMessage). offline: sin señal (la válida queda
 * pendiente de sincronizar). kind: 'ok' | 'mismatch' (aviso de otra función con "Validar"/"Cancelar") | 'manual'
 * (búsqueda por nombre). credential: la credencial que se imprime (tipo y trama).
 */
export const DESK_CASES = Object.freeze([
  { id: 'asistente', kind: 'ok', name: 'Carolina Muñoz', org: 'Empresa ejemplo', type: 'Solo día 1', offline: false, credential: 'asistente', note: null },
  { id: 'estudiante', kind: 'ok', name: 'Diego Fuentes', org: 'Universidad ejemplo', type: 'Estudiante', offline: true, credential: 'estudiante', note: 'Pide la credencial de estudiante.' },
  { id: 'otro-dia', kind: 'mismatch', name: 'Andrea Soto', org: 'Fundación ejemplo', type: 'Solo día 2', offline: true, credential: 'asistente', note: null },
  { id: 'sin-qr', kind: 'manual', name: 'Rodrigo Pérez', org: 'Empresa ejemplo', type: 'Pase completo', offline: false, credential: 'asistente', search: 'Rodrigo', note: null },
  { id: 'cortesia', kind: 'ok', name: 'Paula Ríos', org: 'Expositora', type: 'Cortesía', offline: false, credential: 'expositora', note: null },
])

/** Bandas de la credencial: texto y trama (nunca solo color) */
export const CREDENTIAL_TYPES = Object.freeze({
  asistente: { label: 'Asistente', pattern: 'solid' },
  expositora: { label: 'Expositora', pattern: 'ink' },
  estudiante: { label: 'Estudiante', pattern: 'stripes' },
  cortesia: { label: 'Cortesía', pattern: 'outline' },
  organizadora: { label: 'Organizadora', pattern: 'ink' },
})

/**
 * Mensaje del escáner tal cual (ValidateQR.vue). Con la entrada de otra función, el resultado lleva " · Ojo: entrada para
 * {función}" (fnLabel = formatFunctionLabel de la función de la entrada).
 */
export function deskMessage(c, fnLabel = '') {
  const pending = c.offline ? ' (pendiente de sincronizar)' : ''
  if (c.kind === 'manual') return `✅ Entrada validada manualmente para ${c.name}${pending}`
  const warning = c.kind === 'mismatch' && fnLabel ? ` · Ojo: entrada para ${fnLabel}` : ''
  return `✅ Entrada validada con éxito para ${c.name}${pending}${warning}`
}
/** Aviso del escáner con la entrada de otra función (ValidateQR.vue) */
export const mismatchWarning = (fnLabel) => `⚠️ Esta entrada es para otra función: ${fnLabel}. Puedes validarla de todas formas si corresponde.`

// ---- Precio (§4.8) ----

/** Líneas por defecto de la cotización: las del congreso de §4.3 */
export const quoteLines = () => PAID_TICKETS.congreso.map((t) => ({ id: t.id, name: t.name, price: t.price, qty: t.capacity }))
export const QUOTE_LINES_MAX = 5
export const QUOTE_LINES_MIN = 1
/** Líneas que suma "+ Línea" (en orden) */
export const QUOTE_EXTRA_LINES = Object.freeze([
  { id: 'socio', name: 'Socio con convenio', price: 48000, qty: 30 },
  { id: 'preventa', name: 'Preventa', price: 50000, qty: 50 },
  { id: 'general', name: 'General', price: 45000, qty: 40 },
])

// ---- Después (§4.9) ----

/** Distribución de estrellas de ejemplo (%), de 5 a 1 */
export const SURVEY_DISTRIBUTION = Object.freeze({ 5: 61, 4: 27, 3: 9, 2: 2, 1: 1 })
/** Promedio de la distribución (4,45 → "4,5" con formatRating) */
export const surveyAverage = (dist = SURVEY_DISTRIBUTION) => {
  const total = Object.values(dist).reduce((s, n) => s + n, 0)
  return Object.entries(dist).reduce((s, [stars, n]) => s + Number(stars) * n, 0) / total
}

// ---- Header (§3): la pantalla "Ahora / A continuación" ----

export const SCREEN_SECTIONS = Object.freeze([
  'Apertura',
  'Para quién',
  'El programa',
  'Empresas',
  'Difusión',
  'Antes del día',
  'Acreditación',
  'Precio',
  'Después',
  'Preguntas',
  'Cierre',
])

/** "jue" de "Jue 3 dic" (para "JUE 3 DIC" en las columnas del programa) */
export const weekdayOf = (date) => formatShortDate(date).split(' ')[0]

/**
 * QR decorativo de la credencial (§1 y §7): un SVG precalculado de 21×21 módulos (patrones de posición y módulos
 * pseudoaleatorios fijos). No es un código válido ni se genera en el cliente; va con aria-hidden.
 */
export const DECOR_QR_PATH = 'M0 0h1v1h-1zM1 0h1v1h-1zM2 0h1v1h-1zM3 0h1v1h-1zM4 0h1v1h-1zM5 0h1v1h-1zM6 0h1v1h-1zM0 1h1v1h-1zM6 1h1v1h-1zM0 2h1v1h-1zM2 2h1v1h-1zM3 2h1v1h-1zM4 2h1v1h-1zM6 2h1v1h-1zM0 3h1v1h-1zM2 3h1v1h-1zM3 3h1v1h-1zM4 3h1v1h-1zM6 3h1v1h-1zM0 4h1v1h-1zM2 4h1v1h-1zM3 4h1v1h-1zM4 4h1v1h-1zM6 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM0 6h1v1h-1zM1 6h1v1h-1zM2 6h1v1h-1zM3 6h1v1h-1zM4 6h1v1h-1zM5 6h1v1h-1zM6 6h1v1h-1zM14 0h1v1h-1zM15 0h1v1h-1zM16 0h1v1h-1zM17 0h1v1h-1zM18 0h1v1h-1zM19 0h1v1h-1zM20 0h1v1h-1zM14 1h1v1h-1zM20 1h1v1h-1zM14 2h1v1h-1zM16 2h1v1h-1zM17 2h1v1h-1zM18 2h1v1h-1zM20 2h1v1h-1zM14 3h1v1h-1zM16 3h1v1h-1zM17 3h1v1h-1zM18 3h1v1h-1zM20 3h1v1h-1zM14 4h1v1h-1zM16 4h1v1h-1zM17 4h1v1h-1zM18 4h1v1h-1zM20 4h1v1h-1zM14 5h1v1h-1zM20 5h1v1h-1zM14 6h1v1h-1zM15 6h1v1h-1zM16 6h1v1h-1zM17 6h1v1h-1zM18 6h1v1h-1zM19 6h1v1h-1zM20 6h1v1h-1zM0 14h1v1h-1zM1 14h1v1h-1zM2 14h1v1h-1zM3 14h1v1h-1zM4 14h1v1h-1zM5 14h1v1h-1zM6 14h1v1h-1zM0 15h1v1h-1zM6 15h1v1h-1zM0 16h1v1h-1zM2 16h1v1h-1zM3 16h1v1h-1zM4 16h1v1h-1zM6 16h1v1h-1zM0 17h1v1h-1zM2 17h1v1h-1zM3 17h1v1h-1zM4 17h1v1h-1zM6 17h1v1h-1zM0 18h1v1h-1zM2 18h1v1h-1zM3 18h1v1h-1zM4 18h1v1h-1zM6 18h1v1h-1zM0 19h1v1h-1zM6 19h1v1h-1zM0 20h1v1h-1zM1 20h1v1h-1zM2 20h1v1h-1zM3 20h1v1h-1zM4 20h1v1h-1zM5 20h1v1h-1zM6 20h1v1h-1zM10 0h1v1h-1zM11 0h1v1h-1zM12 0h1v1h-1zM8 1h1v1h-1zM10 1h1v1h-1zM11 2h1v1h-1zM9 3h1v1h-1zM11 3h1v1h-1zM9 4h1v1h-1zM11 4h1v1h-1zM9 5h1v1h-1zM10 5h1v1h-1zM12 5h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM11 7h1v1h-1zM12 7h1v1h-1zM1 8h1v1h-1zM4 8h1v1h-1zM6 8h1v1h-1zM7 8h1v1h-1zM8 8h1v1h-1zM10 8h1v1h-1zM11 8h1v1h-1zM12 8h1v1h-1zM15 8h1v1h-1zM18 8h1v1h-1zM0 9h1v1h-1zM2 9h1v1h-1zM3 9h1v1h-1zM5 9h1v1h-1zM6 9h1v1h-1zM7 9h1v1h-1zM9 9h1v1h-1zM11 9h1v1h-1zM12 9h1v1h-1zM17 9h1v1h-1zM0 10h1v1h-1zM1 10h1v1h-1zM4 10h1v1h-1zM5 10h1v1h-1zM8 10h1v1h-1zM9 10h1v1h-1zM12 10h1v1h-1zM14 10h1v1h-1zM15 10h1v1h-1zM17 10h1v1h-1zM18 10h1v1h-1zM0 11h1v1h-1zM2 11h1v1h-1zM3 11h1v1h-1zM4 11h1v1h-1zM6 11h1v1h-1zM7 11h1v1h-1zM8 11h1v1h-1zM10 11h1v1h-1zM12 11h1v1h-1zM13 11h1v1h-1zM14 11h1v1h-1zM15 11h1v1h-1zM18 11h1v1h-1zM19 11h1v1h-1zM2 12h1v1h-1zM3 12h1v1h-1zM4 12h1v1h-1zM8 12h1v1h-1zM10 12h1v1h-1zM14 12h1v1h-1zM15 12h1v1h-1zM17 12h1v1h-1zM9 13h1v1h-1zM14 13h1v1h-1zM15 13h1v1h-1zM16 13h1v1h-1zM18 13h1v1h-1zM8 14h1v1h-1zM10 14h1v1h-1zM12 14h1v1h-1zM15 14h1v1h-1zM16 14h1v1h-1zM17 14h1v1h-1zM9 15h1v1h-1zM10 15h1v1h-1zM13 15h1v1h-1zM17 15h1v1h-1zM12 16h1v1h-1zM13 16h1v1h-1zM14 16h1v1h-1zM15 16h1v1h-1zM17 16h1v1h-1zM18 16h1v1h-1zM8 17h1v1h-1zM12 17h1v1h-1zM15 17h1v1h-1zM18 17h1v1h-1zM19 17h1v1h-1zM9 18h1v1h-1zM10 18h1v1h-1zM11 18h1v1h-1zM12 18h1v1h-1zM13 18h1v1h-1zM14 18h1v1h-1zM16 18h1v1h-1zM17 18h1v1h-1zM18 18h1v1h-1zM19 18h1v1h-1zM8 19h1v1h-1zM10 19h1v1h-1zM11 19h1v1h-1zM12 19h1v1h-1zM13 19h1v1h-1zM16 19h1v1h-1zM17 19h1v1h-1zM9 20h1v1h-1zM10 20h1v1h-1zM11 20h1v1h-1zM13 20h1v1h-1zM8 6h1v1h-1zM6 10h1v1h-1zM6 12h1v1h-1z'
