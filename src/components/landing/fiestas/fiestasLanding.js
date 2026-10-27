// Datos y cálculos de la landing de fiestas (/ticketera-fiestas, docs/specs/rediseno/SPEC_landing_fiestas_aitickets.md).
// Sin dependencias de Node: lo usan las secciones Astro, las islas Vue y los tests. Los montos y plazos NO se escriben
// aquí: el cargo sale de fees.mjs (priceQuote de producerLanding.js), los descuentos de los promotores de discounts.mjs
// (computeDiscountedTotals, la misma cuenta del checkout y del panel), la hora de cobro de PAYOUT_RELEASE_HOURS
// (legal.mjs, con el cruce de medianoche de payoutAt, como functionEnd en ledger.ts) y los textos de las historias de
// pieceText (socialSeriesRender.ts), que la página llama al construir y pasa por props.
// Nombres de fiesta, productora, promotores y cuenta de Instagram: ficticios (§0.10). Antes de publicar, revisar que no
// coincidan con fiestas, productoras o personas reales de Chile. Nunca nombres de universidades. Toda card con cifras
// dice "ejemplo".
import { EVENT_TIMEZONE, addDays, todayInTimeZone, zonedDateTimeToUtc } from '../../../../netlify/lib/dates.mjs'
import { computeDiscountedTotals } from '../../../../netlify/lib/discounts.mjs'
import { formatShortDate, stockSummary } from '../../event/eventView.js'
import { formatCLP, priceQuote } from '../producerLanding.js'
import { payoutAt } from '../clubs/clubsLanding.js'

/**
 * Fotos de la página. Son las de referencia generadas con IA (public/landing, ver docs/specs/rediseno/fotos-nicho.md):
 * antes de publicar van fotos reales de fiestas de productoras que usen AI Tickets, con autorización escrita de la
 * productora y, si se reconocen, de las personas (§0.8 y §8). Mismo bloqueo de publicación que las de stand-up.
 * Cada una con AVIF/WebP a varios anchos (generados con sharp desde el JPG: regenerar si cambia la foto). La del hero de
 * referencia mide 1024 px de ancho: la real debe venir a 2400 px y entonces se suman 1344/2048 (§7). La del hero se
 * repite recortada (historias, teléfono, hoja de contactos) con el mismo archivo: una sola descarga.
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

export const PARTY_PHOTOS = Object.freeze({
  hero: photo('aitk-fiesta-pista', 1024, 688, [640, 1024]),
  universitaria: photo('aitk-fiesta-universitaria', 896, 1120, [480, 896]),
  promotor: photo('aitk-fiesta-promotor', 896, 1120, [480, 896]),
  montaje: photo('aitk-fiesta-montaje', 896, 1120, [480, 896]),
  publico: photo('aitk-publico', 1344, 768, [640, 1024, 1344]),
})

/** Alt de las fotos (§9) */
export const PHOTO_ALT = Object.freeze({
  hero: 'Gente saltando con los brazos arriba en una fiesta en un galpón, con confeti en el aire',
  universitaria: 'Grupo de amigos sacándose una selfie en una fiesta al aire libre al atardecer',
  promotor: 'Promotora mostrando su celular a un amigo en una barra',
  montaje: 'Equipo de producción colgando luces y armando el lugar de la fiesta',
  publico: 'Público de una fiesta frente al escenario',
})

// ---- La fiesta de ejemplo (todo el sitio, §4.1) ----

export const PARTY_NAME = 'Fiesta Disquete'
export const PARTY_EVENT_URL = 'aitickets.cl/eventos/fiesta-disquete'
export const PARTY_VENUE = 'Galpón en Santiago'
export const PARTY_START = '23:00'
export const PARTY_END = '05:00'
/** Sábado (0 = lunes, como WEEKDAYS de clubs) */
const SATURDAY = 5
/** La fiesta cae al menos estos días después de la fecha de build */
export const PARTY_MIN_DAYS_AHEAD = 28

/** Fecha de la fiesta de ejemplo (YYYY-MM-DD): el sábado que cae al menos 28 días después de `now`, en hora de Chile */
export function partyDate(now = new Date()) {
  const base = addDays(todayInTimeZone(EVENT_TIMEZONE, now), PARTY_MIN_DAYS_AHEAD)
  const weekday = new Date(`${base}T12:00:00Z`).getUTCDay() // 0 = domingo
  return addDays(base, (6 - weekday + 7) % 7)
}

// ---- Las etapas (§4.3) ----

/** Cada etapa abre un lunes a las 20:00: D-26, D-19, D-12 y D-5 (con menos etapas, las primeras fechas) */
export const STAGE_OPEN_DAYS = Object.freeze([26, 19, 12, 5])
export const STAGE_OPEN_TIME = '20:00'
/** Colores de pulsera por orden de etapa */
export const STAGE_COLORS = Object.freeze(['amarillo', 'naranja', 'crema', 'tinta'])
/** Rangos del editor de etapas (precio ±$1.000, cupo ±25) */
export const STAGE_PRICE = Object.freeze({ min: 1000, max: 60000, step: 1000 })
export const STAGE_QTY = Object.freeze({ min: 25, max: 500, step: 25 })
export const STAGE_COUNTS = Object.freeze([2, 3, 4])

const PRESETS = [
  { name: 'Preventa 1', price: 8000, capacity: 150 },
  { name: 'Preventa 2', price: 10000, capacity: 200 },
  { name: 'Preventa 3', price: 12000, capacity: 200 },
  { name: 'General', price: 15000, capacity: 150 },
]

/**
 * Etapas por defecto según cuántas son: 4 = Preventa 1, 2, 3 y General; 3 = Preventa 1, 2 y General; 2 = Preventa y
 * General. Cada una con su color y su apertura (días antes de la fiesta).
 */
export function defaultStages(count = 4) {
  const picks = count === 2 ? [{ ...PRESETS[0], name: 'Preventa' }, PRESETS[3]] : count === 3 ? [PRESETS[0], PRESETS[1], PRESETS[3]] : PRESETS
  return picks.map((s, i) => ({ ...s, color: STAGE_COLORS[i], opensDay: STAGE_OPEN_DAYS[i] }))
}

/**
 * Fechas de la fiesta de ejemplo: inicio y término (cruza la medianoche), apertura de cada etapa (ISO, en hora de Chile)
 * y la hora de cobro (término + PAYOUT_RELEASE_HOURS). stamp = fecha estampada de cámara desechable ("'26 11 28").
 */
export function partySchedule(now = new Date()) {
  const date = partyDate(now)
  const [y, m, d] = date.split('-')
  return {
    date,
    /** "Sáb 28 nov" (eventView.js); la página lo pasa a mayúsculas */
    short: formatShortDate(date),
    startIso: zonedDateTimeToUtc(date, PARTY_START).toISOString(),
    endIso: zonedDateTimeToUtc(addDays(date, 1), PARTY_END).toISOString(),
    openings: STAGE_OPEN_DAYS.map((days) => zonedDateTimeToUtc(addDays(date, -days), STAGE_OPEN_TIME).toISOString()),
    stamp: `'${y.slice(2)} ${m} ${d}`,
    payout: payoutAt(SATURDAY, PARTY_START, PARTY_END),
  }
}

/** "Abre lun 2 nov, 20:00" de la etapa i (eventView.js, sin el año) */
export const openingLabel = (schedule, i) => `Abre ${formatShortDate(addDays(schedule.date, -STAGE_OPEN_DAYS[i])).toLowerCase()}, ${STAGE_OPEN_TIME}`

/**
 * Demanda de ejemplo por día (D-26 a D-1). Los saltos son los días en que abre una etapa (el "drop"). El precio no
 * cambia la demanda: por eso el rótulo "ritmo de ventas inventado, no una predicción".
 */
export const PRESALE_DEMAND = Object.freeze({
  26: 70, 25: 30, 24: 22, 23: 18, 22: 25, 21: 20, 20: 24, 19: 45, 18: 20, 17: 16, 16: 18, 15: 30, 14: 28,
  13: 22, 12: 40, 11: 18, 10: 20, 9: 22, 8: 26, 7: 30, 6: 28, 5: 35, 4: 25, 3: 30, 2: 28, 1: 32,
})
export const PRESALE_FIRST_DAY = 26
/** Milisegundos por día de la simulación (≈ 7 s en total) */
export const PRESALE_DAY_MS = 260

const totalsOf = (stages, sold) => ({
  sold: sold.reduce((s, n) => s + n, 0),
  total: stages.reduce((s, st) => s + st.capacity, 0),
  revenue: stages.reduce((s, st, i) => s + priceQuote(st.price, 'buyer', sold[i]).total, 0),
})

/**
 * La preventa día a día (§4.3), pura: la usan la escalera y los tests.
 * - Hay una etapa a la venta a la vez. Cada etapa abre en su fecha; si la anterior aún tenía cupo, se cierra con lo
 *   vendido (como end_date = apertura de la siguiente).
 * - Si una etapa se agota antes de que abra la siguiente, la simulación se detiene (pause) y espera una decisión en
 *   `choices` (en orden): 'advance' abre la siguiente ese mismo día con lo que queda de la demanda del día; 'wait' no
 *   vende nada hasta la fecha de la siguiente (esa demanda se pierde).
 * Devuelve los fotogramas por día ({ day, sold, status, current, waiting, soldOut: [etapas agotadas ese día] }), la
 * pausa pendiente (o null), si terminó y si se agotó todo, y los totales: vendidas, cupo total, lo que recibes si el
 * público paga el cargo (priceQuote) y la demanda perdida.
 * status de cada etapa: 'upcoming' | 'available' | 'sold_out' | 'closed' (cerró con cupo al abrir la siguiente).
 */
export function playPresale(stages, choices = [], demand = PRESALE_DEMAND) {
  const n = stages.length
  const sold = stages.map(() => 0)
  const status = stages.map(() => 'upcoming')
  const opened = stages.map(() => null)
  const frames = []
  const decisions = []
  let current = -1
  let waiting = false
  let lost = 0
  let ci = 0
  const result = (extra) => ({ frames, decisions, lost, ...totalsOf(stages, sold), ...extra })

  for (let day = PRESALE_FIRST_DAY; day >= 1; day--) {
    let left = demand[day] ?? 0
    const soldOut = []
    // Apertura programada: la etapa abre en su fecha y la que estaba a la venta, si tenía cupo, se cierra
    const k = stages.findIndex((s, i) => i > current && s.opensDay === day)
    if (k >= 0) {
      for (let j = Math.max(current, 0); j < k; j++) if (status[j] === 'available' || status[j] === 'upcoming') status[j] = 'closed'
      current = k
      status[k] = 'available'
      opened[k] = day
      waiting = false
    }
    while (left > 0 && current >= 0 && !waiting && status[current] === 'available') {
      const take = Math.min(stages[current].capacity - sold[current], left)
      sold[current] += take
      left -= take
      if (sold[current] < stages[current].capacity) break
      status[current] = 'sold_out'
      soldOut.push(current)
      const next = current + 1
      if (next >= n) break
      // La siguiente abre después de hoy (si abriera hoy, ya estaría a la venta): ¿la adelantamos?
      const pause = { stage: current, next, day, days: opened[current] - day }
      const choice = choices[ci]
      if (!choice) {
        frames.push({ day, sold: [...sold], status: [...status], current, waiting, soldOut })
        return result({ pause, done: false, allSoldOut: false })
      }
      ci++
      decisions.push({ ...pause, choice })
      if (choice === 'advance') {
        current = next
        status[next] = 'available'
        opened[next] = day
      } else {
        waiting = true
      }
    }
    lost += left
    frames.push({ day, sold: [...sold], status: [...status], current, waiting, soldOut })
    if (status[n - 1] === 'sold_out') return result({ pause: null, done: true, allSoldOut: true })
  }
  return result({ pause: null, done: true, allSoldOut: false })
}

/** "la 2" para "Preventa 2"; "la General" para el resto */
const stageShort = (name) => {
  const m = /^Preventa (\d+)$/.exec(name)
  return m ? `la ${m[1]}` : `la ${name}`
}

/** Textos del sticker de la pausa: "Preventa 1: agotada en 4 días." / "¿Abrimos la 2?" / "Adelantar la Preventa 2" */
export function pauseCopy(stages, pause) {
  const name = stages[pause.stage].name
  const next = stages[pause.next].name
  const when = pause.days === 0 ? 'el mismo día' : `en ${pause.days} ${pause.days === 1 ? 'día' : 'días'}`
  return {
    title: `${name}: agotada ${when}.`,
    question: `¿Abrimos ${stageShort(next)}?`,
    advance: `Adelantar la ${next}`,
    wait: 'Esperar al lunes',
  }
}

/** Contador grande de la escalera: "D-26" … "D-1", y al final "SÁB: FIESTA" o "AGOTADO" */
export function presaleCounter(frame, result) {
  if (result?.done && result.frames.at(-1) === frame) return result.allSoldOut ? 'Agotado' : 'Sáb: fiesta'
  return frame ? `D-${frame.day}` : `D-${PRESALE_FIRST_DAY}`
}

/**
 * "Así lo ve tu público" (BuyerPreview): las filas del checkout con sus rótulos reales (CheckoutStepChoose.vue): la
 * agotada "Agotada", la que está a la venta con su precio y las que abren después "Disponible desde el {fecha}". Una
 * etapa que cerró con cupo al abrir la siguiente ya no se muestra (eventPage.ts solo atenúa agotadas y por abrir).
 * label = rótulo de la card (cardLabel): "Últimas entradas" con el mismo criterio de poco stock que la página del evento
 * (stockSummary de eventView.js sobre las entradas a la venta: quedan 10 o menos, o el 15% o menos), "Agotado" si se
 * agotó todo. La spec §4.3 decía "menos del 30%": manda el producto.
 */
export function buyerRows(stages, frame) {
  const status = frame?.status ?? stages.map(() => 'upcoming')
  const sold = frame?.sold ?? stages.map(() => 0)
  const rows = stages
    .map((s, i) => ({ i, name: s.name, price: s.price, color: s.color, status: status[i], left: s.capacity - sold[i], capacity: s.capacity }))
    .filter((r) => r.status !== 'closed')
  // event.tickets de la página real (eventPage.ts) = solo las entradas a la venta con cupo
  const tickets = rows.filter((r) => r.status === 'available' && r.left > 0).map((r) => ({ remaining: r.left, total_quantity: r.capacity }))
  const label = rows.length && rows.every((r) => r.status === 'sold_out')
    ? 'Agotado'
    : stockSummary({ tickets })?.few
      ? 'Últimas entradas'
      : null
  return { rows, label }
}

/** Tabla sin JS de la escalera: etapa, precio, cupo, apertura y lo que recibes si se vende todo */
export function presaleTable(stages, schedule) {
  return stages.map((s, i) => ({
    name: s.name,
    price: formatCLP(s.price),
    capacity: s.capacity,
    opens: openingLabel(schedule, i),
    gets: formatCLP(priceQuote(s.price, 'buyer', s.capacity).total),
  }))
}

// ---- Los promos (§4.4) ----

/** Todos los códigos: 10% sobre la Preventa 2 */
export const PROMO_DISCOUNT = Object.freeze({ kind: 'percent', value: 10 })
export const PROMO_TICKET_PRICE = PRESETS[1].price

/**
 * Plancha de stickers de ejemplo: compras con el código, entradas por compra y máximo de usos. "FENA10" y no "FEÑA10"
 * como la spec: un código solo acepta A-Z, 0-9, "_" y "-" (DISCOUNT_CODE_RE de discounts.mjs).
 */
export const PROMO_CODES = Object.freeze([
  { code: 'CATA10', who: 'Cata · promotora', purchases: 44, perOrder: 2, maxUses: 60, shape: 'burst', tone: 'amarillo' },
  { code: 'CEE10', who: 'Centro de estudiantes', purchases: 52, perOrder: 3, maxUses: 80, shape: 'circle', tone: 'cobalto' },
  { code: 'FENA10', who: 'Feña · promotor', purchases: 31, perOrder: 2, maxUses: 60, shape: 'pill', tone: 'naranja' },
  { code: 'TOPO10', who: 'DJ Topo', purchases: 18, perOrder: 1, maxUses: 40, shape: 'heart', tone: 'crema' },
  { code: 'MEMES10', who: '@memes.ejemplo', purchases: 12, perOrder: 2, maxUses: 40, shape: 'ticket', tone: 'crema' },
  { code: 'JAVI10', who: 'Javi · promotor', purchases: 7, perOrder: 4, maxUses: 40, shape: 'pill', tone: 'amarillo' },
])

/**
 * Las columnas del panel (DiscountCodesManager.vue) para un código: usos (uno por orden pagada), compras, descuento
 * otorgado y ventas (subtotal ya descontado). Cada orden se calcula con computeDiscountedTotals, como el checkout.
 */
export function promoStats(row, price = PROMO_TICKET_PRICE, discount = PROMO_DISCOUNT) {
  const order = computeDiscountedTotals(row.perOrder * price, discount)
  return {
    ...row,
    uses: row.purchases,
    discount: order.discountAmount * row.purchases,
    sales: order.subtotal * row.purchases,
    exhausted: row.purchases >= row.maxUses,
  }
}

export const promoSheet = () => PROMO_CODES.map((row) => promoStats(row))

/** Orden de la plancha: por ventas ('sales') o por usos ('uses'), de mayor a menor */
export const sortPromos = (rows, by) => [...rows].sort((a, b) => b[by] - a[by] || a.code.localeCompare(b.code))

/**
 * Vista "Links": canales de las métricas de la fiesta (trackingChannel de eventAnalytics.ts: "ref:cata"; la venta
 * directa se llama DIRECT_CHANNEL y llega por props). Los cuatro traen visitas: channelConversion cuenta también las
 * visitas sin ref ni utm en el canal directo. Ingresos = entradas × precio de la Preventa 2.
 */
export function promoChannels(directLabel) {
  return [
    { id: 'cata', label: 'ref:cata', visits: 412, tickets: 74 },
    { id: 'instagram', label: 'Instagram (bio)', visits: 960, tickets: 118 },
    { id: 'invite', label: 'ref:invite · Invitar a alguien', visits: 140, tickets: 46 },
    { id: 'directo', label: directLabel, visits: 820, tickets: 92 },
  ].map((row) => ({ ...row, revenue: row.tickets * PROMO_TICKET_PRICE }))
}

/** Link de ejemplo de un promotor (ref, como TrackingLinkBuilder.vue) */
export const promoLink = (id) => `${PARTY_EVENT_URL}?ref=${id}`

// ---- La última semana (§4.5) ----

/** Aforo de la fiesta de ejemplo (suma de los cupos de las cuatro etapas) */
export const PARTY_CAPACITY = PRESETS.reduce((s, x) => s + x.capacity, 0)

/**
 * Los cinco cuadros de la tira de negativo: D-10, D-7 (quedan 180 de 700: 26%, bajo el umbral de escasez), D-3, D-1 y
 * agotado. remaining = entradas que quedan (pieceText solo lo muestra la última semana). No se muestra la pieza del día
 * de la fiesta (Preguntas abiertas 16).
 */
export const STORY_FRAMES = Object.freeze([
  { id: 'd10', label: 'D-10', days: 10, variant: 'countdown', remaining: null },
  { id: 'd7', label: 'D-7', days: 7, variant: 'countdown', remaining: 180 },
  { id: 'd3', label: 'D-3', days: 3, variant: 'countdown', remaining: 64 },
  { id: 'd1', label: 'D-1', days: 1, variant: 'countdown', remaining: null },
  { id: 'agotado', label: 'Agotado', days: 1, variant: 'sold_out', remaining: null },
])

/** ¿La serie mostraría "Quedan N"? Solo bajo scarcity_threshold_pct % del aforo (socialSeries.ts) */
export const isScarce = (remaining, threshold, capacity = PARTY_CAPACITY) => remaining != null && remaining > 0 && (remaining / capacity) * 100 < threshold

/** Demo de anuncios (§4.5): presupuesto diario y días de la demo (1-5; en el panel, hasta AD_LIMITS.maxDays) */
export const PARTY_ADS_DEMO = Object.freeze({ budgetMin: 3000, budgetMax: 50000, budgetStep: 1000, budget: 5000, daysMax: 5, days: 3, ageMax: 25 })

// ---- La fiesta empieza antes (§4.6) ----

export const PARTY_WALL_COUNTS = Object.freeze({ '🔥': 64, '🥳': 41, '💃': 27, '🙌': 18 })
export const PARTY_WALL_POSTS = Object.freeze([
  { id: 'p1', name: 'Coni R.', emoji: '🔥', when: 'hace 1 h', text: 'Vamos 8 de la carrera 🔥', tint: '#FFE14D' },
  { id: 'p2', name: 'Mati G.', emoji: '🙌', when: 'hace 3 h', text: '¿Alguien de Maipú para compartir el auto?', tint: '#FFB48A' },
  { id: 'p3', name: 'Fran S.', emoji: '🥳', when: 'ayer', text: 'La del año pasado fue la mejor. Repito.', tint: '#C9CCFF' },
])

// ---- La noche (§4.7) ----

/** Ingresados al final de la noche (ejemplo) */
export const NIGHT_CHECKED_IN = 642

/**
 * Los cuatro casos del escáner, con los textos reales de ValidateQR.vue. kind: 'ok' (banner lima) | 'used' (banner rojo
 * del producto). type = tipo de entrada que ve la puerta.
 */
export const SCAN_CASES = Object.freeze([
  { id: 'preventa', kind: 'ok', name: 'Coni Rojas', type: 'Preventa 2', note: null },
  { id: 'alumno', kind: 'ok', name: 'Mati González', type: 'Alumno', note: 'Pide la credencial' },
  { id: 'usado', kind: 'used', name: null, type: null, note: 'El pantallazo que ya entró no entra de nuevo.' },
  { id: 'cortesia', kind: 'ok', name: 'DJ Topo', type: 'Cortesía', note: null },
])
export const SCAN_START = 318
export const SCAN_PENDING = 3

/** Mensaje del escáner tal cual (ValidateQR.vue): offline, la válida queda pendiente de sincronizar */
export const scanMessage = (c) =>
  c.kind === 'used' ? '❌ Este ticket ya fue validado' : `✅ Entrada validada con éxito para ${c.name} (pendiente de sincronizar)`

// ---- El día después (§4.9) ----

/** Hoja de contactos: seis fotos de desechable (mismos archivos, recortes distintos), con giros alternados */
export const CONTACT_SHEET = Object.freeze([
  { photo: 'hero', position: '30% 40%', tilt: -3 },
  { photo: 'universitaria', position: '50% 30%', tilt: 2 },
  { photo: 'publico', position: '60% 50%', tilt: -1.5 },
  { photo: 'hero', position: '75% 55%', tilt: 2.5 },
  { photo: 'universitaria', position: '50% 75%', tilt: -2 },
  { photo: 'hero', position: '55% 85%', tilt: 1.5 },
])

// ---- Precio (§4.8) ----

/** Etapas de la calculadora: hasta 4 y al menos 1 */
export const CALC_STAGES_MAX = 4
export const CALC_STAGES_MIN = 1

// ---- Cierre (§4.12) ----

export const BAND_NAME_MAX = 24
/** Pulsera del cierre: "FIESTA DISQUETE · PREVENTA 1 · N° 0001"; con un nombre, "FIESTA {NOMBRE} · PREVENTA 1" */
export function bandText(name = '') {
  const clean = String(name).replace(/\s+/g, ' ').trim().slice(0, BAND_NAME_MAX).toUpperCase()
  const party = clean ? (/^FIESTA\b/.test(clean) ? clean : `FIESTA ${clean}`) : PARTY_NAME.toUpperCase()
  return `${party} · PREVENTA 1`
}

// ---- Confeti estático (§1): posiciones fijas por sección ----

const CONFETTI_COLORS = ['amarillo', 'naranja', 'cobalto', 'crema']
/**
 * @param {[number, number, number][]} points [x %, y %, giro en grados]
 * @returns {{ x: number, y: number, r: number, shape: 'dot' | 'bar', color: string, i: number }[]}
 */
const confettiSet = (points) =>
  points.map(([x, y, r], i) => ({ x, y, r, shape: i % 3 === 2 ? 'dot' : 'bar', color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], i }))

export const CONFETTI = Object.freeze({
  hero: confettiSet([
    [3, 12, 20], [9, 88, -35], [18, 4, 60], [44, 95, 15], [52, 6, -20], [61, 92, 40],
    [70, 3, -60], [84, 10, 30], [96, 22, -15], [97, 64, 50], [91, 94, -40], [33, 97, 10],
  ]),
  night: confettiSet([[4, 8, 30], [14, 94, -20], [48, 4, 50], [86, 6, -40], [96, 40, 20], [92, 92, -10], [60, 96, 35], [30, 3, -55], [2, 58, 15], [74, 2, 25]]),
  closing: confettiSet([
    [4, 10, 25], [12, 84, -30], [22, 6, 55], [30, 92, -10], [41, 3, 35], [55, 95, -45], [63, 8, 15],
    [72, 90, 40], [80, 4, -25], [88, 80, 60], [95, 14, -50], [97, 52, 20], [7, 48, -15], [50, 50, 70],
  ]),
})
