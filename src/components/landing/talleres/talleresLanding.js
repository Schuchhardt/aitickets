// Datos y cálculos de la landing de talleres (/ticketera-talleres, docs/specs/rediseno/SPEC_landing_talleres_aitickets.md).
// Sin dependencias de Node: lo usan las secciones Astro, las islas Vue y los tests. Los montos y plazos NO se escriben
// aquí: los precios finales salen de priceQuote (fees.mjs, la fórmula del checkout) y el plazo de cobro de
// PAYOUT_RELEASE_HOURS (legal.mjs). Los rótulos de la página de inscripción de ejemplo son los de la página real: el
// armador arma un evento sintético (fakeEvent) y le pregunta a cardState / cardLabel / checkoutFunctions de eventView.js.
// Talleres, talleristas, espacios e inscritos: ficticios (§0.9). Antes de publicar, revisar que no coincidan con talleres
// o espacios chilenos reales (Preguntas abiertas 10). Toda card con datos dice "ejemplo".
import { cardLabel, cardState, checkoutFunctions } from '../../event/eventView.js'
import { formatCLP, priceQuote } from '../producerLanding.js'
import { PAYOUT_RELEASE_HOURS } from '../../../../netlify/lib/legal.mjs'

/**
 * Fotos de la página. Son las de referencia generadas con IA (public/landing, ver docs/specs/rediseno/README.md y
 * fotos-nicho.md): antes de publicar van fotos reales de talleres de talleristas o espacios que usen AI Tickets, con
 * autorización escrita de quien dicta y de quienes aparecen (y de sus apoderados si hay menores) (§0.7 y §8). Mismo
 * bloqueo de publicación que las de las otras landings.
 * Cada una con AVIF/WebP a varios anchos (generados con sharp desde el JPG: regenerar si cambia la foto). La del hero de
 * referencia mide 1024 px de ancho; la real debe venir a 2400 px (y entonces se agregan 1344 y 2048, §7).
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

export const WORKSHOP_PHOTOS = Object.freeze({
  hero: photo('aitk-taller-clase', 1024, 688, [640, 1024]),
  tallerista: photo('aitk-taller-tallerista', 896, 1120, [480, 896]),
  cierre: photo('aitk-taller', 896, 1152, [480, 896]),
})

/** Franja "Hecho para" del hero (§4.1): chips no clickeables */
export const MADE_FOR = Object.freeze([
  'Cerámica',
  'Cocina',
  'Fotografía',
  'Escritura',
  'Ilustración y acuarela',
  'Bordado y textil',
  'Carpintería',
  'Huerto y plantas',
  'Yoga y bienestar',
  'Talleres para niños',
  'Cursos cortos',
])

// ---- Plazo de un curso vendido con una sola entrada (§0.3) ----
// src/lib/producer-api/ledger.ts libera cada orden con la función de sus entradas; una entrada "para todas las
// funciones" (event_date_id NULL) se libera con la ÚLTIMA función del evento + PAYOUT_RELEASE_HOURS, no con la primera
// sesión. La regla no existe como texto en legal.mjs: se arma aquí con la constante.
export const courseReleaseText = `Lo del curso queda disponible ${PAYOUT_RELEASE_HOURS} h después de la última sesión`
/** Lo de cada fecha vendida por separado (entrada amarrada a una función): la regla general de legal.mjs */
export const dateReleaseText = `Lo de cada fecha queda disponible ${PAYOUT_RELEASE_HOURS} h después de que termina`
/**
 * Garantía de plazo de la sección Precio (§4.8). La spec pide PAYOUT_SHORT_TEXT, pero ese texto habla de "cada show"
 * (teatro) y no calza con el curso vendido con una sola entrada; se arma aquí con la misma constante.
 */
export const payoutGuaranteeText = `Lo tuyo, disponible ${PAYOUT_RELEASE_HOURS} h después de cada fecha (o de la última sesión del curso)`

// ---- Tu lista de pendientes, tachada (§4.2) ----
// star = la respuesta lleva el asterisco de TERMS_NOTE (plata)
export const PENDIENTES = Object.freeze([
  {
    id: 'cupos',
    before: 'Responder por DM si todavía queda cupo',
    after: 'La página muestra los cupos que quedan y se cierra sola cuando se llena.',
  },
  {
    id: 'transferencias',
    before: 'Revisar transferencias y pedir el pantallazo',
    after: 'Pagan con Webpay y cada inscripción aparece al instante en tu panel.',
  },
  {
    id: 'planilla',
    before: 'Anotar en una planilla quién pagó y para qué fecha',
    after: 'Tu lista de inscritos se arma sola en tu panel y la descargas cuando quieras.',
  },
  {
    id: 'direccion',
    before: 'Mandar la dirección y la hora, uno por uno',
    after: 'La entrada llega al correo con fecha, hora y lugar, y el día antes, un recordatorio.',
  },
  {
    id: 'lista',
    before: 'Contar quién llegó con una lista en papel',
    after: 'Pasas lista escaneando el QR o buscando el nombre en tu celular.',
  },
  {
    id: 'efectivo',
    before: 'Cobrar en efectivo el mismo día',
    after: `Cobras antes del taller. ${dateReleaseText}.`,
    star: true,
  },
])

// ---- Arma tu taller (§4.3, firma) ----
// Fechas de ejemplo en noviembre y diciembre de 2026 (calzan con el calendario: el sábado 14 de noviembre es sábado).
const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Formatos del segmented "¿Cómo es?" */
export const FORMATS = Object.freeze([
  { id: 'day', label: 'Un día' },
  { id: 'course', label: 'Curso de 4 sesiones' },
  { id: 'weekly', label: 'Todas las semanas' },
])
export const COURSE_SESSIONS = 4
/** "Todas las semanas": el evento de ejemplo tiene 8 fechas y el teléfono muestra las 4 próximas */
export const WEEKLY_DATES = 8
export const WEEKLY_VISIBLE = 4

/**
 * Presets de "¿Qué enseñas?" (todos ficticios). price: valor por fecha; coursePrice: el curso de 4 sesiones (0 = gratis).
 * start: primera fecha (YYYY-MM-DD); from/to: horario.
 */
export const WORKSHOP_PRESETS = Object.freeze([
  {
    id: 'ceramica',
    label: 'Cerámica',
    title: 'Torno para principiantes',
    host: 'Javiera M.',
    place: 'Taller ejemplo',
    city: 'Ñuñoa',
    price: 28000,
    coursePrice: 95000,
    seats: 10,
    start: '2026-11-14',
    from: '10:00',
    to: '13:00',
  },
  {
    id: 'cocina',
    label: 'Cocina',
    title: 'Pastas frescas en casa',
    host: 'Tomás R.',
    place: 'Cocina ejemplo',
    city: 'Providencia',
    price: 25000,
    coursePrice: 85000,
    seats: 12,
    start: '2026-11-12',
    from: '19:00',
    to: '22:00',
  },
  {
    id: 'fotografia',
    label: 'Fotografía',
    title: 'Fotografía con tu celular',
    host: 'Antonia P.',
    place: 'Estudio ejemplo',
    city: 'Valparaíso',
    price: 20000,
    coursePrice: 68000,
    seats: 15,
    start: '2026-11-14',
    from: '11:00',
    to: '13:30',
  },
  {
    id: 'escritura',
    label: 'Escritura',
    title: 'Escritura de crónica',
    host: 'Diego S.',
    place: 'Biblioteca ejemplo',
    city: 'Concepción',
    price: 0,
    coursePrice: 0,
    seats: 20,
    start: '2026-11-11',
    from: '19:00',
    to: '21:00',
  },
])

/** Rangos del armador: cupos por fecha y valor (con pago). fallbackPrice: al pasar a "Con pago" un taller gratis. */
export const BUILDER_SEATS = Object.freeze({ min: 4, max: 40, visibleBoxes: 20 })
export const BUILDER_PRICE = Object.freeze({ min: 5000, max: 120000, step: 1000, fallbackPrice: 15000 })
/** Estado inicial (y sin JS): Cerámica, un día, con pago, 7 de 10 */
export const BUILDER_INITIAL = Object.freeze({ preset: 'ceramica', format: 'day', enrolledGap: 3 })

export const presetById = (id) => WORKSHOP_PRESETS.find((p) => p.id === id) || WORKSHOP_PRESETS[0]

/** Valor inicial del taller con pago para un preset y formato (el curso cobra el ciclo completo) */
export function presetPrice(preset, format) {
  const value = format === 'course' ? preset.coursePrice : preset.price
  return value > 0 ? value : BUILDER_PRICE.fallbackPrice
}

/** Fechas del taller: n fechas semanales desde preset.start → [{ id, date, label ("Sáb 14 nov"), day, month }] */
export function workshopDates(preset, n) {
  const [y, m, d] = preset.start.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1, d + i * 7))
    const iso = date.toISOString().slice(0, 10)
    const weekday = WEEKDAY_SHORT[date.getUTCDay()]
    const month = MONTH_SHORT[date.getUTCMonth()]
    return { id: `d${i + 1}`, date: iso, day: date.getUTCDate(), month, weekday, label: `${weekday} ${date.getUTCDate()} ${month}` }
  })
}

/** "Sáb 14, 21 y 28 nov y sáb 5 dic · 10:00" (las fechas de un curso, agrupadas por mes) */
export function courseDatesLabel(dates, time) {
  const list = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : items[0])
  const months = []
  for (const d of dates) {
    const last = months.at(-1)
    if (last && last.month === d.month) last.days.push(d.day)
    else months.push({ month: d.month, weekday: d.weekday, days: [d.day] })
  }
  const parts = months.map((g, i) => `${i ? g.weekday.toLowerCase() : g.weekday} ${list(g.days)} ${g.month}`)
  return `${parts.join(' y ')} · ${time}`
}

// Inscritos de ejemplo en las fechas siguientes a la primera ("Todas las semanas"): menos que en la primera
const WEEKLY_FILL = [0.6, 0.4, 0.3, 0.2, 0.1, 0, 0]

/**
 * Evento sintético con la forma que recibe la página pública (src/lib/eventPage.ts: tickets a la venta con remaining y
 * total_quantity, unavailable_tickets, dates, sale_state), para pedirle los rótulos a eventView.js:
 *  - day: una fecha y una entrada con su cupo;
 *  - course: las 4 fechas y una entrada "para todas las funciones" (event_date_id null) con el cupo del curso;
 *  - weekly: 8 fechas y una entrada amarrada a cada una, con su cupo (la primera con los inscritos del slider).
 * Una entrada sin cupo deja de estar a la venta (unavailable_tickets); si no queda ninguna, el evento está agotado.
 */
export function fakeEvent({ preset, format, paid, price, seats, enrolled }) {
  const value = paid ? price : 0
  const final = paid ? priceQuote(price).buyerPays : 0
  const n = format === 'day' ? 1 : format === 'course' ? COURSE_SESSIONS : WEEKLY_DATES
  const venue = { name: preset.place, city: preset.city }
  const dates = workshopDates(preset, n).map((d) => ({ ...d, start_time: `${preset.from}:00`, venue }))
  const ticket = (id, name, taken, dateId = null) => ({
    id,
    name,
    price: value,
    final_price: final,
    total_quantity: seats,
    remaining: Math.max(0, seats - taken),
    event_date_id: dateId,
  })
  let all
  if (format === 'weekly') {
    all = dates.map((d, i) => ticket(`t${i + 1}`, 'General', i ? Math.min(seats, Math.round(enrolled * WEEKLY_FILL[i - 1])) : enrolled, d.id))
  } else {
    all = [ticket('t1', format === 'course' ? `Curso completo · ${COURSE_SESSIONS} sesiones` : 'General', enrolled)]
  }
  const tickets = all.filter((t) => t.remaining > 0)
  const unavailable_tickets = all.filter((t) => t.remaining <= 0).map((t) => ({ ...t, reason: 'sold_out' }))
  return {
    id: 'taller-ejemplo',
    name: preset.title,
    is_demo: true,
    status: 'published',
    dates,
    tickets,
    unavailable_tickets,
    sale_state: tickets.length ? 'on_sale' : 'sold_out',
  }
}

/** Estado de cada fecha en la lista del teléfono: el mismo texto que EventSections.vue (fnStatusLabel) */
export const FUNCTION_STATUS_LABELS = Object.freeze({ available: 'Disponible', few: 'Últimas', sold_out: 'Agotada' })

/**
 * Lo que muestra la página de inscripción de ejemplo para un estado del armador:
 * { state, label: { text, tone } | null, full, free, finalPrice, cta, waitlistCta, dates, functions, ticketName }.
 * label: el rótulo exacto de cardLabel (null = la card abre con el precio). full: la (primera) fecha está llena.
 * functions (solo weekly): las WEEKLY_VISIBLE próximas fechas con su estado por función (checkoutFunctions).
 */
export function previewModel(input) {
  const event = fakeEvent(input)
  const state = cardState(event)
  const label = cardLabel(event, state)
  const free = !input.paid
  const full = input.enrolled >= input.seats
  const time = input.preset.from
  const dates = event.dates
  let functions = []
  if (input.format === 'weekly') {
    const byId = new Map(checkoutFunctions(event).functions.map((f) => [f.id, f.status]))
    functions = dates.slice(0, WEEKLY_VISIBLE).map((d) => {
      const status = byId.get(d.id) || 'sold_out'
      return { id: d.id, label: `${d.label} · ${time}`, status, text: FUNCTION_STATUS_LABELS[status] }
    })
  }
  const soldOut = state === 'free_full' || state === 'sold_out'
  return {
    event,
    state,
    label,
    free,
    full,
    soldOut,
    finalPrice: free ? 'Gratis' : formatCLP(priceQuote(input.price).buyerPays),
    // Botón de la card real: gratis → RsvpForm; pagado de una entrada → EventActionCard (simpleCta); varias → "Elegir"
    cta: free ? 'Confirmar asistencia' : state === 'paid_multi' ? 'Elegir entradas' : 'Comprar entrada',
    // Lista de espera real: RsvpForm (gratis, modo full) / NotifyForm kind="sold_out" (pagado)
    waitlistCta: free ? 'Avisarme si se libera un cupo' : 'Avisarme si se liberan',
    dateLine: `${dates[0].label} · ${input.preset.from} a ${input.preset.to}`,
    courseLine: courseDatesLabel(dates, time),
    ticketName: input.format === 'course' ? `Curso completo · ${COURSE_SESSIONS} sesiones` : 'General',
    functions,
    moreDates: `Ver las ${dates.length} funciones`,
  }
}

/**
 * "Lo que AI Tickets hace por ti" (§4.3): notas del estado del armador → [{ id, text, star?, soon?, hint? }].
 * star = asterisco de TERMS_NOTE (plata); soon = "Pronto" (no existe en el producto, §0.6).
 */
export function builderNotes({ format, paid, enrolled, seats }) {
  const notes = [
    { id: 'qr', text: 'Cada inscripción llega con su QR al correo.' },
    { id: 'reminder', text: 'El día antes, un recordatorio con fecha, hora y lugar.' },
  ]
  if (!paid) notes.push({ id: 'free', text: 'Nadie paga cargo: la inscripción gratis no cuesta nada, ni a ti ni a tu gente.' })
  else notes.push({ id: 'webpay', text: 'Pagan con Webpay. Tú no revisas transferencias.' })
  if (format === 'course') {
    notes.push({ id: 'one-ticket', text: `Una sola inscripción para las ${COURSE_SESSIONS} sesiones.` })
    if (paid) notes.push({ id: 'payout', text: `${courseReleaseText}.`, star: true })
    notes.push({ id: 'session-reminder', text: 'Antes de cada sesión, un recordatorio extra que programas desde tu asistente de IA.' })
    notes.push({ id: 'roll', text: 'Pasar lista en cada sesión del curso', soon: true, hint: 'Hoy el QR se valida en la primera sesión.' })
  } else {
    if (paid) notes.push({ id: 'payout', text: `${dateReleaseText}.`, star: true })
    if (format === 'weekly') {
      notes.push({ id: 'own-seats', text: 'Cada fecha con sus propios cupos: tu gente elige la suya.' })
      notes.push({ id: 'duplicate', text: '¿El próximo mes? Duplicas el taller y agregas las fechas nuevas.' })
      notes.push({ id: 'repeat', text: 'Repetir "todos los sábados" en un paso', soon: true })
    }
  }
  if (enrolled >= seats) {
    // "Todas las semanas": solo se llena la primera fecha y la página la marca "Agotada" (el teléfono no muestra el aviso)
    if (format === 'weekly') notes.push({ id: 'full', text: 'Esa fecha se llenó: la página la marca Agotada y tu gente elige otra.' })
    else notes.push({ id: 'full', text: 'Se llenó: la página lo dice y anota a quien quiere cupo.' })
    notes.push({ id: 'waitlist', text: 'Ves esa lista en tu panel y les avisamos solos cuando se libera un cupo.' })
  }
  return notes
}

// ---- Fichero de formatos (§4.3) ----
// text con {maxFunctions}: lo completa la página con MAX_EVENT_FUNCTIONS (producerFaq.ts).
export const FORMAT_CARDS = Object.freeze([
  {
    id: 'day',
    title: 'Taller de un día',
    text: 'Una fecha, un tipo de entrada con su cupo. Si es gratis, la gente solo confirma con su nombre y correo.',
    note: 'el más simple: 10 minutos',
  },
  {
    id: 'course',
    title: 'Curso de varias sesiones',
    text: 'Un evento por curso, con todas sus fechas y una entrada "para todas las funciones" con el cupo del curso. ¿También clases sueltas? Suma entradas amarradas a cada fecha.',
    note: 'un evento por grupo = cobras al terminar ese curso',
  },
  {
    id: 'weekly',
    title: 'Taller que se repite',
    text: 'Un evento con las próximas fechas (hasta {maxFunctions}) y una entrada amarrada a cada una, con su cupo. Para el mes siguiente, lo duplicas y cambias las fechas.',
    note: 'cada sábado con su cupo',
  },
])

// ---- El día del taller: pasar lista (§4.5) ----
// Los dos casos especiales (Valentina, buscada por nombre, e Ignacio, QR repetido) van entre las mobileVisible primeras
// filas: en mobile se ven solo esas.
export const ROLL_DEMO = Object.freeze({
  when: 'Sáb 14 nov · 10:00',
  rows: Object.freeze([
    { id: 'camila', name: 'Camila R.', ticket: 'General' },
    { id: 'ignacio', name: 'Ignacio T.', ticket: 'General' },
    { id: 'fernanda', name: 'Fernanda L.', ticket: 'General' },
    { id: 'matias', name: 'Matías O.', ticket: 'General' },
    { id: 'josefa', name: 'Josefa A.', ticket: 'General' },
    { id: 'valentina', name: 'Valentina S.', ticket: 'General' },
    { id: 'benjamin', name: 'Benjamín C.', ticket: 'General' },
    { id: 'tomas', name: 'Tomás G.', ticket: 'General' },
    { id: 'antonia', name: 'Antonia V.', ticket: 'Cortesía' },
    { id: 'martin', name: 'Martín P.', ticket: 'General' },
  ]),
  /**
   * Pasos de la demo, uno cada intervalMs: se valida una fila (escaneando su QR), la sexta buscando el nombre y la
   * octava es un QR repetido (el estado real "Entrada ya validada" de ValidateQR.vue, que no suma). Termina en 9 de 10.
   */
  steps: Object.freeze([
    { row: 'camila', time: '10:00' },
    { row: 'ignacio', time: '10:01' },
    { row: 'fernanda', time: '10:01' },
    { row: 'matias', time: '10:02' },
    { row: 'josefa', time: '10:02' },
    { row: 'valentina', time: '10:03', search: 'vale' },
    { row: 'benjamin', time: '10:03' },
    { row: 'ignacio', time: '10:04', repeat: true },
    { row: 'tomas', time: '10:05' },
    { row: 'antonia', time: '10:06' },
  ]),
  intervalMs: 900,
  mobileVisible: 6,
})

/**
 * Estado de la lista después de `count` pasos: { present: { [row]: { time, search } }, repeats: { [row]: time },
 * checked, search, last }. last: el último paso (para la línea de estado).
 */
export function rollState(count) {
  const present = {}
  const repeats = {}
  let search = ''
  for (const step of ROLL_DEMO.steps.slice(0, count)) {
    if (step.repeat) repeats[step.row] = step.time
    else present[step.row] = { time: step.time, search: Boolean(step.search) }
    if (step.search) search = step.search
  }
  return { present, repeats, checked: Object.keys(present).length, search, last: ROLL_DEMO.steps[count - 1] || null }
}
export const ROLL_FINAL = ROLL_DEMO.steps.length

// ---- Difusión (§4.6) ----
export const LINK_SALES_DEMO = Object.freeze([
  { id: 'newsletter', name: 'Newsletter', tickets: 5 },
  { id: 'tienda', name: 'Tienda ejemplo', tickets: 3 },
  { id: 'instagram', name: 'Instagram', tickets: 2 },
])
export const DISCOUNT_DEMO = Object.freeze({ code: 'EXALUMNOS15', value: '15%', uses: 20, until: '30 nov' })

// ---- Después del taller (§4.7) ----
// Las audiencias son las del panel (INVITE_AUDIENCES de reviews.mjs, la página las pasa por props); aquí solo cuántas
// personas tiene cada una en el ejemplo. Se omite "Solo quienes calificaron" para que el segmented quepa.
export const INVITE_DEMO = Object.freeze({
  from: 'Torno para principiantes',
  to: 'Torno nivel 2',
  toWhen: 'desde el sáb 12 dic',
  counts: Object.freeze({ all: 36, checked_in: 33, promoters: 21 }),
  rating: 4.9,
  reviews: 18,
})

/**
 * Texto por defecto del correo de invitación: el mismo de invitationCopy (src/lib/invitations.ts), que no se puede
 * importar en el navegador (carga código de servidor). tests/unit/talleres-landing.test.mjs revisa que calcen.
 */
export const invitationBody = (sourceName, targetName) => `¡Gracias por acompañarnos en ${sourceName}! Nos encantaría verte en ${targetName}.`

// ---- Precio: la cuenta del cuaderno (§4.8) ----
export const SUM_PRICE = Object.freeze({ min: 5000, max: 120000, step: 1000, default: 25000 })
export const SUM_SEATS = Object.freeze({ min: 4, max: 40, default: 12 })

/** La cuenta: lo de priceQuote (fees.mjs) con los cupos como multiplicador del taller lleno */
export const notebookSum = (price, payer, seats) => priceQuote(price, payer, seats)

// ---- Para espacios (§4.9): web de ejemplo ----
// Cuatro talleres del espacio; el rótulo de cada ficha es el que da cardLabel a su próxima fecha (sin rótulo, la card
// real abre con el precio). price 0 = gratis.
export const SPACE_DEMO = Object.freeze({
  url: 'aitickets.cl/o/espacio-ejemplo',
  workshops: Object.freeze([
    { id: 'torno', title: 'Torno para principiantes', when: 'sábados', price: 28000, seats: 10, enrolled: 8 },
    { id: 'pastas', title: 'Pastas frescas', when: 'jueves', price: 25000, seats: 20, enrolled: 6 },
    { id: 'acuarela', title: 'Acuarela botánica', when: 'domingos', price: 0, seats: 12, enrolled: 8 },
    { id: 'huerto', title: 'Huerto en balcón', when: '1 sáb al mes', price: 0, seats: 40, enrolled: 10 },
  ]),
})

/** Fichas de la web del espacio: { ...taller, label: { text, tone } | null, finalPrice } */
export function spaceCards() {
  return SPACE_DEMO.workshops.map((w) => {
    const preset = { ...WORKSHOP_PRESETS[0], title: w.title }
    const paid = w.price > 0
    const model = previewModel({ preset, format: 'day', paid, price: w.price, seats: w.seats, enrolled: w.enrolled })
    return { ...w, label: model.label, finalPrice: model.finalPrice }
  })
}
