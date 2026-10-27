// Datos y cálculos de la landing de teatro (/ticketera-teatro, docs/specs/rediseno/SPEC_landing_teatro_aitickets.md).
// Sin dependencias de Node: lo usan las secciones Astro, las islas Vue y los tests. Los montos y plazos NO se escriben
// aquí: los precios finales salen de priceQuote (fees.mjs, la fórmula del checkout), el plazo de cobro de legal.mjs y el
// tope de funciones de MAX_EVENT_FUNCTIONS (producerFaq.ts), que la página pasa como {maxFunctions}.
// Nombres de la obra, la compañía, la sala y las personas: ficticios (§0.9). Antes de publicar, revisar que no
// coincidan con obras, compañías o salas chilenas reales (Preguntas abiertas 9). Toda card con cifras dice "ejemplo".
import { formatCLP, priceQuote } from '../producerLanding.js'

/**
 * Fotos de la página. Son las de referencia generadas con IA (public/landing, ver docs/specs/rediseno/README.md y
 * fotos-nicho.md): antes de publicar van fotos reales de funciones de compañías o salas que usen AI Tickets, con
 * autorización escrita del elenco, la sala y, si se reconoce, del público (§0.7 y §8). Mismo bloqueo de publicación que
 * las de stand-up y música.
 * Cada una con AVIF/WebP a varios anchos (generados con sharp desde el JPG: regenerar si cambia la foto). La del hero
 * de referencia mide 1024 px de ancho: la viñeta y el foco lo disimulan, pero la real debe venir a 2400 px (§7).
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

export const THEATRE_PHOTOS = Object.freeze({
  hero: photo('aitk-teatro-funcion', 1024, 688, [640, 1024]),
  ensayo: photo('aitk-teatro-ensayo', 896, 1120, [480, 896]),
  telon: photo('aitk-teatro', 896, 1152, [480, 896]),
})

/** Obra de ejemplo de los mockups (§4.1) */
export const PLAY_DEMO = Object.freeze({
  title: 'Marea baja',
  company: 'Compañía La Grieta',
  venue: 'Sala ejemplo',
  city: 'Santiago',
  handle: 'compania.ejemplo',
})

// ---- Funciones y entradas de ejemplo (§4.3, Escena 1) ----
// Temporada de 16 funciones, jueves a domingo del 5 al 29 de noviembre: jueves a sábado 20:30, domingo 19:00. Cada
// función tiene 80 de aforo (tipos de entrada amarrados a esa función, EditEventForm.vue paso 3).
export const SEASON_CAPACITY = 80
const WEEKDAYS = Object.freeze([
  { short: 'JUE', label: 'Jue', long: 'jueves', time: '20:30' },
  { short: 'VIE', label: 'Vie', long: 'viernes', time: '20:30' },
  { short: 'SÁB', label: 'Sáb', long: 'sábado', time: '20:30' },
  { short: 'DOM', label: 'Dom', long: 'domingo', time: '19:00' },
])
export const SEASON_WEEKDAYS = WEEKDAYS.map((d) => d.short)

/** Las 16 funciones en orden de calendario: { id, day, weekday, label ("Vie 6 nov · 20:30"), aria, thursday } */
export const SEASON_FUNCTIONS = Object.freeze(
  Array.from({ length: 16 }, (_, i) => {
    const week = Math.floor(i / 4)
    const wd = WEEKDAYS[i % 4]
    const day = 5 + week * 7 + (i % 4)
    return Object.freeze({
      id: `f${i + 1}`,
      index: i,
      week,
      day,
      weekday: wd.long,
      short: wd.short,
      time: wd.time,
      label: `${wd.label} ${day} nov · ${wd.time}`,
      long: `${wd.long} ${day} de noviembre a las ${wd.time}`,
      thursday: i % 4 === 0,
      premiere: i === 0,
    })
  }),
)

/**
 * Tipos de entrada de la obra de ejemplo. Precios sin cargo: lo que ve el público se calcula con priceQuote (precio
 * final con cargo incluido, como el checkout real). "Jueves popular" está amarrada a los jueves (sin el estreno).
 */
export const TICKET_TYPES = Object.freeze([
  { id: 'general', name: 'General', price: 10000 },
  { id: 'estudiante', name: 'Estudiante y adulto mayor', price: 7000 },
  { id: 'jueves', name: 'Jueves popular', price: 6000, thursdayOnly: true },
])

/** Entradas que se pueden elegir en una función, con su precio final (cargo incluido, priceQuote → fees.mjs) */
export function ticketsFor(fn) {
  return TICKET_TYPES.filter((t) => !t.thursdayOnly || (fn.thursday && !fn.premiere)).map((t) => ({
    ...t,
    final: priceQuote(t.price).buyerPays,
  }))
}

/** "Desde $X" de la lista de funciones: solo si esa función tiene otro precio que el resto (los jueves populares) */
export function functionFrom(fn) {
  if (!fn.thursday || fn.premiere) return null
  return `Desde ${formatCLP(Math.min(...ticketsFor(fn).map((t) => t.final)))}`
}

/**
 * Estado de cada función en el selector (§4.3), con los mismos rótulos que la página real (eventView.js):
 * el estreno agotado, el viernes con las últimas y el resto disponible.
 */
export const PICKER_STATUS = Object.freeze({ f1: 'soldout', f2: 'last' })
export const PICKER_VISIBLE = 5

// ---- Estados de una función (cartelera y selector) ----
export const STATE_LABELS = Object.freeze({
  available: 'Disponible',
  last: 'Últimas',
  soldout: 'Agotada',
  done: 'Realizada',
})
/** Quedan 10 o menos: "Últimas" */
export const LAST_TICKETS = 10
/** Bajo el 40 % vendido, el jueves de la semana en curso "se afloja" (cartelera, Semana 3) */
const LOW_FILL = 0.4

// ---- La temporada (§4.4, firma): cartelera de 16 funciones que avanza con el fader ----
// Entradas vendidas por función en cada paso del fader (de 0 a SEASON_CAPACITY), y cuántas funciones ya se hicieron.
// Las que ya se hicieron mantienen su venta final. Reseñas: promedio y cantidad (null antes de la primera función).
export const SEASON_STEPS = Object.freeze([
  {
    id: 'estreno',
    label: 'Estreno',
    short: 'Estreno',
    done: 0,
    sold: [80, 72, 44, 30, 12, 8, 15, 6, 4, 6, 9, 3, 2, 3, 5, 2],
    reviews: null,
  },
  {
    id: 'semana-2',
    label: 'Semana 2',
    short: 'S2',
    done: 4,
    sold: [80, 78, 76, 61, 38, 55, 72, 41, 10, 14, 22, 9, 5, 8, 12, 6],
    reviews: { avg: 4.8, count: 37 },
  },
  {
    id: 'semana-3',
    label: 'Semana 3',
    short: 'S3',
    done: 8,
    sold: [80, 78, 76, 61, 52, 74, 80, 66, 24, 58, 73, 47, 18, 30, 44, 26],
    reviews: { avg: 4.7, count: 81 },
  },
  {
    id: 'ultimas',
    label: 'Últimas funciones',
    short: 'Últimas',
    done: 12,
    sold: [80, 78, 76, 61, 52, 74, 80, 66, 41, 77, 80, 72, 71, 80, 80, 80],
    reviews: { avg: 4.8, count: 129 },
  },
  {
    id: 'telon',
    label: 'Bajó el telón',
    short: 'Telón',
    done: 16,
    sold: [80, 78, 76, 61, 52, 74, 80, 66, 41, 77, 80, 72, 76, 80, 80, 80],
    reviews: { avg: 4.8, count: 171 },
  },
])
export const SEASON_LAST_STEP = SEASON_STEPS.length - 1

/**
 * Celdas de la cartelera en un paso: { ...función, sold, fill (0-1), state, payout, low, text }.
 * state: 'done' si la función ya se hizo; si no, 'soldout' / 'last' / 'available' según lo que queda.
 * payout: la función ya se hizo y es de la última semana realizada (lo de esa semana está "Lista para retirar"; lo de
 * las anteriores ya se retiró). low: el jueves de la semana en curso con menos de LOW_FILL vendido (en Semana 3, el
 * "¿El jueves se afloja?" del panel; la barra va en marfil). text: lo que lee el lector de pantalla ("Jueves 5 de
 * noviembre, 20:30, agotada").
 */
export function seasonCells(step) {
  const s = SEASON_STEPS[step]
  const lastDoneWeek = s.done ? Math.floor((s.done - 1) / 4) : -1
  const currentWeek = Math.floor(s.done / 4)
  return SEASON_FUNCTIONS.map((fn) => {
    const sold = s.sold[fn.index]
    const left = SEASON_CAPACITY - sold
    const done = fn.index < s.done
    const state = done ? 'done' : left <= 0 ? 'soldout' : left <= LAST_TICKETS ? 'last' : 'available'
    const payout = done && fn.week === lastDoneWeek
    const low = !done && fn.thursday && fn.week === currentWeek && sold / SEASON_CAPACITY < LOW_FILL
    const status = STATE_LABELS[state].toLowerCase() + (payout ? ', lista para retirar' : '')
    const day = fn.weekday.charAt(0).toUpperCase() + fn.weekday.slice(1)
    return { ...fn, sold, fill: sold / SEASON_CAPACITY, state, payout, low, text: `${day} ${fn.day} de noviembre, ${fn.time}, ${status}` }
  })
}

/** Contadores de la cartelera en un paso: funciones realizadas, entradas vendidas y reseñas */
export function seasonCounters(step) {
  const s = SEASON_STEPS[step]
  return {
    done: s.done,
    total: SEASON_FUNCTIONS.length,
    sold: s.sold.reduce((a, b) => a + b, 0),
    reviews: s.reviews,
  }
}

/** Promedio de reseñas en es-CL ("4,8") */
export const formatRating = (avg) => avg.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// ---- Reparto (§4.2): quién hace qué, como programa de mano ----
// who con {maxFunctions}: lo completa la página con MAX_EVENT_FUNCTIONS. star = la fila lleva el asterisco de TERMS_NOTE.
export const REPARTO = Object.freeze([
  { id: 'boleteria', role: 'La boletería', who: 'AI Tickets, las 24 horas', href: '#obra' },
  { id: 'funciones', role: 'Las funciones', who: 'Hasta {maxFunctions}, cada una con su aforo', href: '#obra' },
  { id: 'prensa', role: 'La prensa', who: 'Cortesías con su QR', href: '#prensa' },
  { id: 'difusion', role: 'La difusión', who: 'Tu Instagram, todos los días de la temporada', href: '#difusion' },
  { id: 'puerta', role: 'La puerta', who: 'Tu equipo, con el celular', href: '#puerta' },
  { id: 'plata', role: 'La plata', who: 'Tu cuenta, función por función', href: '#precio', star: true },
  { id: 'publico', role: 'El público', who: 'Invitado a tu próxima obra', href: '#temporada' },
])

export const REPARTO_KINDS = Object.freeze([
  'Teatro independiente',
  'Salas',
  'Microteatro',
  'Teatro familiar',
  'Funciones para colegios',
  'Festivales',
  'Giras',
])

// ---- El elenco también vende (§4.3, Escena 3): ventas por link de ejemplo ----
// La última fila es la venta directa (DIRECT_CHANNEL de src/lib/eventAnalytics.ts: la página lo pasa por props).
export const LINK_SALES = Object.freeze([
  { id: 'elenco-catalina', name: 'Elenco · Catalina', tickets: 46 },
  { id: 'sala-ejemplo', name: 'Sala ejemplo', tickets: 31 },
  { id: 'radio-ejemplo', name: 'Radio ejemplo · entrevista', tickets: 12 },
])
export const LINK_SALES_DIRECT = 64

/** Escala (0-1) de la barra de cada fila respecto de la que más vendió (incluida la venta directa) */
export function linkScales(rows = LINK_SALES, direct = LINK_SALES_DIRECT) {
  const max = Math.max(direct, ...rows.map((r) => r.tickets), 1)
  return { rows: rows.map((r) => r.tickets / max), direct: direct / max }
}

// ---- Tres llamadas (§4.6) ----
export const LLAMADAS = Object.freeze([
  {
    numeral: 'I',
    tag: 'El día antes',
    title: 'Todos saben a qué hora y dónde.',
    text: 'El día antes de cada función, quienes tienen entrada para esa función reciben un recordatorio por correo con su QR. Tú no mandas nada.',
  },
  {
    numeral: 'II',
    tag: 'En la puerta',
    title: 'Tu equipo escanea con el celular.',
    text: 'Aunque la sala no tenga señal: la lista se descarga antes y se sincroniza cuando vuelve la conexión. Una entrada usada no vuelve a entrar. Si alguien llega con la entrada de otra noche, el escáner te lo dice y tú decides si pasa.',
  },
  {
    numeral: 'III',
    tag: 'Comenzamos',
    title: 'Sala llena, y lo ves en vivo.',
    text: 'El escáner cuenta las entradas validadas sobre el total. ¿Alguien llegó sin la entrada en el celular? Se busca por nombre y se le reenvía al correo. Las cortesías entran con su propio QR.',
  },
])

/** Escáner de la puerta (§4.6): los dos estados reales de ValidateQR.vue que alterna la demo */
export const SCANNER_DEMO = Object.freeze({
  valid: { ticket: 'General', when: 'Vie 6 nov · 20:30', name: 'Catalina R.' },
  otherFunction: { when: 'Jue 5 nov · 20:30' },
  checkedIn: 78,
  capacity: 80,
  intervalMs: 2600,
})

// ---- Para salas (§4.8): cartelera web de ejemplo ----
export const VENUE_BILL = Object.freeze({
  url: 'aitickets.cl/o/sala-ejemplo',
  plays: [
    { title: 'Marea baja', when: 'Jue a dom · hasta 29 nov' },
    { title: 'El último tren', when: 'Vie y sáb · desde 4 dic' },
    { title: 'Cuentos de la orilla', when: 'Familiar · domingos 12:00' },
  ],
})

/** Rango del slider de la calculadora del programa (§4.7) */
export const THEATRE_CALC_PRICE = Object.freeze({ min: 2000, max: 40000, step: 500, default: 10000 })
