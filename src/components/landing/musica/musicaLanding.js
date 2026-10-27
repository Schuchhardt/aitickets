// Datos y cálculos de la landing de música en vivo (/ticketera-musica-en-vivo,
// docs/specs/rediseno/SPEC_landing_musica_aitickets.md). Sin dependencias de Node: lo usan las secciones Astro, las
// islas Vue y los tests. Los montos y plazos NO se escriben aquí: salen de fees.mjs / legal.mjs (vía producerLanding.js
// y la página; el eje de la curva usa PAYOUT_RELEASE_HOURS), el tope de fechas de MAX_EVENT_FUNCTIONS (producerFaq.ts,
// la página lo pasa como {maxFunctions}) y la cadencia de redes de DEFAULT_CADENCE (socialSeriesCadence.ts), que la
// página pasa por props para no cargar ese módulo en el navegador.
// Nombres de bandas y salas: ficticios (§0.9). Antes de publicar, revisar que no coincidan con bandas o salas chilenas
// reales (Preguntas abiertas 11). Toda card con cifras dice "ejemplo".
import { PAYOUT_RELEASE_HOURS } from '../../../../netlify/lib/legal.mjs'

/**
 * Fotos de la página. Son las de referencia generadas con IA (public/landing, ver docs/specs/rediseno/README.md y
 * fotos-nicho.md): antes de publicar van fotos reales de shows de productoras, bandas o salas que usen AI Tickets, con
 * autorización escrita (§0.7 y §8). Mismo bloqueo de publicación que las de stand-up y academias.
 * Cada una con AVIF/WebP a varios anchos (generados con sharp desde el JPG: regenerar si cambia la foto). La del hero
 * de referencia mide 1024 px de ancho: el duotono y el grano lo disimulan, pero la real debe venir a 2400 px (§7).
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

export const MUSIC_PHOTOS = Object.freeze({
  hero: photo('aitk-musica-sala', 1024, 688, [640, 1024]),
  publico: photo('aitk-musica', 896, 1152, [480, 896]),
  puerta: photo('aitk-puerta-qr', 896, 1152, [480, 896]),
})

/**
 * Talón de ejemplo del hero (§4.1) y tandas de la demo (§4.4). Las tandas son tipos de entrada con precio y cupo
 * (EditEventForm.vue); "Desde el 1 dic" es la ventana de venta de la entrada (init_date), que la página del evento
 * muestra atenuada igual que aquí. Precios sin cargo: el talón dice "+ cargo por servicio" con SERVICE_FEE_NOTE.
 */
export const GIG_DEMO = Object.freeze({
  band: 'Niebla Norte',
  title: 'Lanzamiento de "Ruta 5"',
  when: 'Sáb 14 dic · 21:00',
  venue: 'Sala ejemplo, Santiago',
  number: 'N.º 0142',
})

export const TIERS = Object.freeze([
  { name: 'Preventa 1', price: 8000, capacity: 100, sold: 100 },
  { name: 'Preventa 2', price: 10000, capacity: 150, sold: 112 },
  { name: 'General', price: 12000, capacity: 250, sold: 0, opens: 'Desde el 1 dic' },
])

/** Estado de una tanda: agotada, a la venta (con las que quedan) o todavía sin abrir. */
export function tierState(tier) {
  if (tier.opens) return { kind: 'upcoming', label: tier.opens, fill: 0 }
  const left = Math.max(0, tier.capacity - tier.sold)
  if (left === 0) return { kind: 'soldout', label: 'Agotada', fill: 1 }
  return { kind: 'selling', label: `Quedan ${left}`, fill: tier.sold / tier.capacity }
}

/** La tanda que ve el público como disponible: la primera que no está agotada ni por abrir. */
export const currentTier = (tiers = TIERS) => tiers.find((t) => tierState(t).kind === 'selling') || null

/**
 * "¿Quién eres?" del cartel (§4.2). word = palabra del cartel que se pinta de rojo; lines = las tres líneas (link =
 * enlace interno opcional, §9). Las que dependen de constantes las completa la página: {payoutShort} con
 * PAYOUT_SHORT_TEXT de legal.mjs y {maxFunctions} con MAX_EVENT_FUNCTIONS de producerFaq.ts (el tope de schedule.ts).
 */
export const AUDIENCES = Object.freeze([
  {
    id: 'band',
    label: 'Banda o solista',
    words: ['Bandas', 'Solistas'],
    lines: [
      { title: 'Vende tu lanzamiento sin depender de nadie.', text: 'Tu página de venta, tu cobro y tu puerta, aunque toques en un bar sin ticketera.' },
      { title: 'Un link para cada integrante.', text: 'Cada uno comparte el suyo y ves cuántas entradas movió.' },
      {
        title: 'Tu web gratis con tus fechas.',
        text: 'Una página con tu cartelera en aitickets.cl/o/tu-banda, sin pagar hosting.',
        link: { href: '/web-gratis', label: 'Ver la web gratis' },
      },
    ],
  },
  {
    id: 'producer',
    label: 'Productora',
    words: ['Productoras'],
    lines: [
      { title: 'Varias fechas y ciudades en un evento.', text: 'Hasta {maxFunctions} fechas, cada una con su lugar, sus entradas y su cobro.' },
      { title: 'Un link por banda del cartel, medio o campaña.', text: 'Sabes quién llenó la sala antes de armar el próximo cartel.' },
      { title: 'Equipo con su rol.', text: 'Puerta, Marketing, Finanzas o Solo lectura: cada uno ve lo suyo.' },
    ],
  },
  {
    id: 'venue',
    label: 'Sala o venue',
    words: ['Salas'],
    lines: [
      {
        title: 'Toda tu cartelera en tu propia web.',
        text: 'Una página gratis con tus próximas fechas en aitickets.cl/o/tu-sala, cada una vendiendo entradas.',
        link: { href: '/web-gratis', label: 'Ver la web gratis' },
      },
      { title: 'La puerta de cada noche, ordenada.', text: 'Tu equipo escanea con el celular, aunque el subterráneo no tenga señal.' },
      { title: 'Cobras cada fecha por separado.', text: '{payoutShort}.' },
    ],
  },
])

/** Líneas del cartel tipográfico (§4.2), de mayor a menor */
export const POSTER_LINES = Object.freeze([
  ['Bandas', 'Solistas'],
  ['Productoras', 'Salas'],
  ['Tocatas', 'Ciclos', 'Lanzamientos', 'Festivales', 'Giras'],
])

// ---- La curva de un concierto (§4.3) ----
// Ilustración: entradas vendidas por día de un concierto de 400 entradas, de D-46 hasta que se libera el cobro de la
// fecha (PAYOUT_RELEASE_HOURS de legal.mjs después del show: hoy 48 h, +2 días). Pico de preventa en D-45/D-44, meseta
// y segunda ola desde D-7. Sin números en el eje Y.
const RELEASE_DAYS = PAYOUT_RELEASE_HOURS / 24
export const CURVE_DOMAIN = Object.freeze({ from: -46, to: RELEASE_DAYS })
export const CURVE_POINTS = Object.freeze([
  [-46, 0],
  [-45, 52],
  [-44, 100],
  [-43, 46],
  [-41, 20],
  [-38, 11],
  [-33, 8],
  [-26, 9],
  [-19, 10],
  [-13, 13],
  [-9, 17],
  [-7, 30],
  [-5, 44],
  [-3, 58],
  [-1, 78],
  [0, 88],
  [RELEASE_DAYS / 2, 6],
  [RELEASE_DAYS, 0],
])
export const CURVE_TOTAL = 400

/** Día de la curva y vendidas acumuladas en cada uno de los seis momentos (0 → 160 → 210 → 330 → 400 → 400). */
export const CURVE_MOMENTS = Object.freeze([
  { day: -45, sold: 0 },
  { day: -44, sold: 160 },
  { day: -30, sold: 210 },
  { day: -7, sold: 330 },
  { day: 0, sold: 400 },
  { day: RELEASE_DAYS, sold: 400 },
])

/** Marcas del eje X */
export const CURVE_TICKS = Object.freeze([
  { day: -45, label: 'D-45' },
  { day: -30, label: 'D-30' },
  { day: -7, label: 'D-7' },
  { day: 0, label: 'Show' },
  { day: RELEASE_DAYS, label: `+${PAYOUT_RELEASE_HOURS} h` },
])

/** Valor de la curva en un día (interpolación lineal entre los puntos dados) */
export function curveValue(day, points = CURVE_POINTS) {
  if (day <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x0, y0] = points[i - 1]
    if (day <= x1) return y0 + ((y1 - y0) * (day - x0)) / (x1 - x0)
  }
  return points[points.length - 1][1]
}

/** Fracción del ancho donde cae el show: las horas hasta el cobro ocupan el resto, para que "Show" y "+48 h" no se pisen */
const CURVE_SHOW_AT = 0.86

/**
 * Escalas del gráfico: día → x y valor → y, dentro de un SVG de width × height con `pad` (márgenes en px). El eje X
 * va por tramos: de D-46 al show en el 86 % del ancho y las PAYOUT_RELEASE_HOURS siguientes en el resto. El valor
 * máximo (100) queda a 8 % del borde superior.
 */
export function curveScales(width, height, pad = { top: 16, right: 16, bottom: 32, left: 16 }) {
  const { from, to } = CURVE_DOMAIN
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const frac = (day) => (day <= 0 ? ((day - from) / -from) * CURVE_SHOW_AT : CURVE_SHOW_AT + (day / to) * (1 - CURVE_SHOW_AT))
  const x = (day) => pad.left + frac(day) * innerW
  const y = (value) => pad.top + innerH - (value / 108) * innerH
  return { x, y, baseline: pad.top + innerH }
}

/**
 * Path SVG suave (Catmull-Rom pasado a Bézier cúbicas) que pasa por cada punto de la curva. fill = true cierra el
 * área contra la línea base para el relleno.
 */
export function curvePath(width, height, { fill = false, pad } = {}) {
  const { x, y, baseline } = curveScales(width, height, pad)
  const pts = CURVE_POINTS.map(([d, v]) => [x(d), y(v)])
  const r = (n) => Math.round(n * 10) / 10
  let d = `M${r(pts[0][0])} ${r(pts[0][1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    // Tensión 1/6 y sin pasar bajo la línea base ni sobre el borde (la curva no "rebota" bajo cero)
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(baseline, p1[1] + (p2[1] - p0[1]) / 6)]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(baseline, p2[1] - (p3[1] - p1[1]) / 6)]
    d += ` C${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(p2[0])} ${r(p2[1])}`
  }
  if (fill) d += ` L${r(pts[pts.length - 1][0])} ${r(baseline)} L${r(pts[0][0])} ${r(baseline)} Z`
  return d
}

// ---- El cartel, con un link por banda (§4.5) ----
// Ventas por link de ejemplo. El último es la venta directa (DIRECT_CHANNEL de src/lib/eventAnalytics.ts: la página
// lo pasa por props). DJ Kilómetro 0 suma su fila porque en el afiche cada nombre es un botón.
export const LINEUP = Object.freeze([
  { id: 'niebla-norte', name: 'Niebla Norte', tickets: 112, poster: 1 },
  { id: 'los-trasnoche', name: 'Los Trasnoche', tickets: 64, poster: 2 },
  { id: 'maria-paz-rivas', name: 'María Paz Rivas', tickets: 41, poster: 2 },
  { id: 'dj-kilometro-0', name: 'DJ Kilómetro 0', tickets: 17, poster: 3 },
  { id: 'radio-ejemplo', name: 'Radio ejemplo · entrevista', tickets: 23 },
])
export const LINEUP_DIRECT_TICKETS = 58
export const LINEUP_EVENT_URL = 'aitickets.cl/eventos/festival-ejemplo'
export const LINEUP_POSTER_META = 'Vie 21 feb · Sala ejemplo · Santiago · ejemplo'

/** Link de ejemplo con seguimiento de una fila (utm_source, como TrackingLinkBuilder.vue) */
export const lineupLink = (row) => `${LINEUP_EVENT_URL}?utm_source=${row.id}`

/** Escala (0-1) de la barra de cada fila respecto de la que más vendió (incluida la venta directa) */
export function lineupScales(rows = LINEUP, direct = LINEUP_DIRECT_TICKETS) {
  const max = Math.max(direct, ...rows.map((r) => r.tickets), 1)
  return { rows: rows.map((r) => r.tickets / max), direct: direct / max }
}

// ---- Una gira, un solo evento (§4.6) ----
export const TOUR_DATES = Object.freeze([
  { when: 'Vie 07 mar · 21:00', city: 'Valparaíso', venue: 'Sala ejemplo', status: { kind: 'left', label: 'Quedan 40' } },
  { when: 'Sáb 08 mar · 21:30', city: 'Santiago', venue: 'Teatro ejemplo', status: { kind: 'soldout', label: 'Agotado' } },
  { when: 'Vie 14 mar · 21:00', city: 'Concepción', venue: 'Bar ejemplo', status: { kind: 'tier', label: 'Preventa 2' } },
  { when: 'Sáb 15 mar · 22:00', city: 'Temuco', venue: 'Centro cultural ejemplo', status: { kind: 'upcoming', label: 'Venta abre el 20 feb' } },
])

// ---- Tu fecha en Instagram (§4.8) ----

/**
 * Marcas de la serie automática de D-`fromDays` al día del show, calculadas con la cadencia real (DEFAULT_CADENCE de
 * src/lib/socialSeriesCadence.ts, la misma regla de planSlots): historia diaria de D-daily_from_days a D-0, antes una
 * cada sparse_every_days días desde D-sparse_start_days hacia atrás, y post de feed de D-feed_posts_from_days a
 * D-feed_posts_to_days (nunca el día del show). Devuelve un día por posición, de D-fromDays a D-0.
 */
export function seriesMarks(cadence, fromDays = 14) {
  const stories = new Set()
  for (let d = 0; d <= Math.min(cadence.daily_from_days, fromDays); d++) stories.add(d)
  for (let d = cadence.sparse_start_days; d <= fromDays; d += cadence.sparse_every_days) stories.add(d)
  const days = []
  for (let d = fromDays; d >= 0; d--) {
    const post = d > 0 && d >= cadence.feed_posts_to_days && d <= cadence.feed_posts_from_days
    days.push({ day: d, label: d === 0 ? 'Show' : `D-${d}`, story: stories.has(d), post })
  }
  return days
}

export const seriesCounts = (marks) => ({
  stories: marks.filter((m) => m.story).length,
  posts: marks.filter((m) => m.post).length,
})

/** Demo de anuncios (§4.8): el slider de presupuesto y los días de la demo. Los días van de AD_LIMITS.minDays a 7. */
export const ADS_DEMO = Object.freeze({ budgetMin: 3000, budgetMax: 50000, budgetStep: 1000, budget: 5000, daysMax: 7, days: 3 })

/** Rango del slider de la calculadora (§4.9) */
export const MUSIC_CALC_PRICE = Object.freeze({ min: 2000, max: 60000, step: 500, default: 12000 })
