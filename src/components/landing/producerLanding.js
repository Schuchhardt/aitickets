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
  // MP4 (H.264, faststart) y WebM (VP9, ~30% del peso), generados con scripts/landing-media.mjs
  coverVideo: '/landing/cover-standup.mp4',
  coverVideoWebm: '/landing/cover-standup.webm',
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
  // Demo del modal: MP4 (faststart) + WebM (VP9) y póster en WebP, generados con scripts/landing-media.mjs
  demoVideo: '/videos/aitickets-demo.mp4',
  demoVideoWebm: '/videos/aitickets-demo.webm',
  demoPoster: '/videos/aitickets-demo-poster.webp',
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
/** Días antes de la función en que sale el reel: REEL_DAYS de socialSeriesCadence.ts (no se importa: arrastra código de servidor). */
export const MK_REEL_DAYS = 3

/**
 * Días de la semana de ejemplo con sus publicaciones. on = { story, post, reel? }; times = { daily, eventDay } (HH:MM).
 * El reel (con el video del evento) sale una vez, MK_REEL_DAYS antes de la primera función.
 * showDays: índices de MK_WEEK con función (por defecto solo el viernes). Con varias funciones la serie se replanifica
 * hacia la siguiente cuando pasa una (socialSeries.ts, "siguiente función"): cada día con función tiene su historia de
 * la mañana, el día entre dos funciones sigue la historia diaria y los posts de feed terminan antes de la primera.
 * Cada slot: { kind, label, time, state: 'past' | 'today' | 'future' }.
 */
export function marketingWeek(on, times, showDays = [MK_SHOW]) {
  const firstShow = Math.min(...showDays)
  const lastShow = Math.max(...showDays)
  return MK_WEEK.map((day, i) => {
    const slots = []
    const isShow = showDays.includes(i)
    const state = i < MK_TODAY ? 'past' : i === MK_TODAY ? 'today' : 'future'
    if (on.story && i <= lastShow) slots.push({ kind: 'story', label: 'Historia', time: isShow ? times.eventDay : times.daily, state })
    if (on.post && i < firstShow) slots.push({ kind: 'post', label: 'Publicación', time: times.daily, state })
    if (on.reel && i === Math.max(0, firstShow - MK_REEL_DAYS)) slots.push({ kind: 'reel', label: 'Reel', time: times.daily, state })
    return { ...day, isToday: i === MK_TODAY, isShow, slots }
  })
}

export const marketingPostCount = (week) => week.reduce((n, d) => n + d.slots.length, 0)
