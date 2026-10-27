// Cálculos y demos de la landing de productores (/organizadores, docs/specs/rediseno/SPEC_landing_productores_aitickets.md).
// Sin dependencias de Node: lo usan las islas Vue de la landing y los tests (tests/unit/producer-landing.test.mjs).
// Los montos salen de fees.mjs (la misma regla del checkout): nunca escribir cargos ni IVA a mano.
import { computeFeeSplit } from '../../../netlify/lib/fees.mjs'

export { formatCLP } from '../event/eventView.js'

/** Evento de ejemplo de los mockups (cifras ficticias: siempre con el rótulo "Datos de ejemplo"). */
export const DEMO_EVENT_NAME = 'Stand-up de Viernes'

/**
 * Medios de la landing. Portada: clip y foto de referencia generados con IA (public/landing, ver
 * docs/specs/rediseno/README.md): reemplazar por un clip real con permiso. Video del modal: el demo actual (21 s, sin
 * subtítulos todavía; por eso el botón dice "21 s" y no "1 min").
 */
export const LANDING_MEDIA = Object.freeze({
  coverVideo: '/landing/cover-standup.mp4',
  coverPoster: '/landing/aitk-hero-standup.jpg',
  coverPosterWidth: 1344,
  coverPosterHeight: 768,
  // Póster en AVIF/WebP (§9, LCP), generado con sharp desde el JPG: regenerar si cambia la foto
  coverPosterSources: [
    {
      type: 'image/avif',
      srcset:
        '/landing/aitk-hero-standup-640.avif 640w, /landing/aitk-hero-standup-1024.avif 1024w, /landing/aitk-hero-standup-1344.avif 1344w',
    },
    {
      type: 'image/webp',
      srcset:
        '/landing/aitk-hero-standup-640.webp 640w, /landing/aitk-hero-standup-1024.webp 1024w, /landing/aitk-hero-standup-1344.webp 1344w',
    },
  ],
  demoVideo: '/videos/aitickets-demo.mp4',
  demoPoster: '/videos/aitickets-demo-poster.jpg',
  demoDurationLabel: '21 s',
  demoCaptions: '',
})

/** Rango de la calculadora (§5.3): el input acepta cualquier precio hasta MAX; los sliders van de min a max. */
export const CALC_PRICE = Object.freeze({ min: 1000, max: 100000, step: 500, default: 10000, inputMax: 10_000_000 })
export const CALC_QTY = Object.freeze({ min: 10, max: 1000, step: 10, default: 100, inputMax: 100_000 })

/** Entero ≥ 0 a partir de lo que escribe la persona ("10.000", "$ 4500"), acotado a max. */
export function parseAmount(text, max) {
  const digits = String(text ?? '').replace(/\D/g, '').slice(0, 9)
  const n = digits ? parseInt(digits, 10) : 0
  return Math.min(Math.max(n, 0), max)
}

/**
 * Cuánto paga el comprador y cuánto recibe el productor por una entrada de `price`, según quién paga el cargo.
 * payer: 'buyer' (por defecto, el comprador paga el cargo encima) | 'producer' (lo absorbe el productor).
 * total = lo que recibe el productor por `qty` entradas.
 */
export function priceQuote(price, payer = 'buyer', qty = 1) {
  const split = computeFeeSplit(price, { absorbed: payer === 'producer' })
  return {
    price: split.subtotal,
    fee: split.feeNet,
    iva: split.feeIva,
    buyerPays: split.total,
    perTicket: split.producerNet,
    total: split.producerNet * Math.max(0, Math.round(Number(qty) || 0)),
  }
}

// ---- Demo del calendario de difusión automática (§5.4b) ----
// Semana de ejemplo: lunes 19 a domingo 25 de octubre, "hoy" es el miércoles y la función es el viernes.
// La cadencia replica la real (src/lib/socialSeriesCadence.ts): la última semana sale una historia diaria y un post de
// feed diario hasta el día anterior; el día de la función, solo la historia de la mañana. Las horas llegan por props
// desde DEFAULT_CADENCE para no desalinearse.
export const MK_WEEK = Object.freeze([
  { dow: 'LUN', num: 19 },
  { dow: 'MAR', num: 20 },
  { dow: 'MIÉ', num: 21 },
  { dow: 'JUE', num: 22 },
  { dow: 'VIE', num: 23 },
  { dow: 'SÁB', num: 24 },
  { dow: 'DOM', num: 25 },
])
export const MK_TODAY = 2
export const MK_SHOW = 4

/**
 * Días de la semana de ejemplo con sus publicaciones. on = { story, post }; times = { daily, eventDay } (HH:MM).
 * Cada slot: { kind, label, time, state: 'past' | 'today' | 'future' }.
 */
export function marketingWeek(on, times) {
  return MK_WEEK.map((day, i) => {
    const slots = []
    const state = i < MK_TODAY ? 'past' : i === MK_TODAY ? 'today' : 'future'
    if (on.story && i <= MK_SHOW) slots.push({ kind: 'story', label: 'Historia', time: i === MK_SHOW ? times.eventDay : times.daily, state })
    if (on.post && i < MK_SHOW) slots.push({ kind: 'post', label: 'Post', time: times.daily, state })
    return { ...day, isToday: i === MK_TODAY, isShow: i === MK_SHOW, slots }
  })
}

export const marketingPostCount = (week) => week.reduce((n, d) => n + d.slots.length, 0)
