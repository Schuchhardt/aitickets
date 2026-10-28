// Datos y cálculos de la landing de clubs y discotecas (/ticketera-discotecas,
// docs/specs/rediseno/SPEC_landing_clubs_aitickets.md). Sin dependencias de Node: lo usan las secciones Astro, las islas
// Vue y los tests. Los montos y plazos NO se escriben aquí: el cargo sale de fees.mjs (priceQuote de producerLanding.js),
// la hora de cobro de cada noche de PAYOUT_RELEASE_HOURS (legal.mjs, con el cruce de medianoche de functionEnd en
// ledger.ts) y la serie de redes de DEFAULT_CADENCE (socialSeriesCadence.ts), que la página pasa por props para no
// cargar ese módulo en el navegador.
// Nombres de club, noches, RRPP y cuenta de Instagram: ficticios (§0.9). Antes de publicar, revisar que no coincidan con
// clubs o personas reales de Chile. Toda card con cifras dice "ejemplo".
import { PAYOUT_RELEASE_HOURS } from '../../../../netlify/lib/legal.mjs'
import { EVENT_TIMEZONE } from '../../../../netlify/lib/dates.mjs'
import { formatCLP } from '../producerLanding.js'
import { seriesMarks } from '../musica/musicaLanding.js'

/**
 * Fotos de la página. Son las de referencia generadas con IA (public/landing, ver docs/specs/rediseno/fotos-nicho.md):
 * antes de publicar van fotos reales de clubs que usen AI Tickets, con autorización escrita del local y, si se
 * reconocen, de las personas (§0.7 y §8). Mismo bloqueo de publicación que las de stand-up.
 * Cada una con AVIF/WebP a varios anchos (generados con sharp desde el JPG: regenerar si cambia la foto). La del hero de
 * referencia mide 1024 px de ancho: la real debe venir a 2400 px y entonces se suman 1344/2048 (§7).
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

export const CLUB_PHOTOS = Object.freeze({
  hero: photo('aitk-club-pista', 1024, 688, [640, 1024]),
  manager: photo('aitk-club-manager', 896, 1120, [480, 896]),
  puerta: photo('aitk-club-puerta', 896, 1120, [480, 896]),
  vip: photo('aitk-club-vip', 896, 1120, [480, 896]),
})

/** Días de la semana en el orden de la grilla del mes (0 = lunes), como los escribe un letrero */
export const WEEKDAYS = Object.freeze(['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'])

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}
const pad = (n) => String(n).padStart(2, '0')
const clock = (minutes) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`
const num = (n) => n.toLocaleString('es-CL')

// ---- La noche de ejemplo (hero §4.1, mesas §4.7, precio §4.8) ----

export const CLUB_NAME = 'Club ejemplo'
export const NIGHT_NAME = 'Viernes Ultravioleta'
export const NIGHT_EVENT_URL = 'aitickets.cl/eventos/viernes-ultravioleta'

/**
 * Tipos de entrada de la noche de ejemplo: cada uno es un tipo de entrada con precio (la lista es de $0) y cupo
 * (EditEventForm.vue). Las cortesías no se venden: se envían desde el panel (CourtesyTicketsForm.vue) y no cuentan como
 * venta. capacity = cupo del tipo de entrada; en mesas, el cupo cuenta mesas (una mesa para N emite N QR, buildAttendeeRows).
 */
export const CLUB_TICKETS = Object.freeze({
  lista: { name: 'Lista free', short: 'Lista', price: 0, capacity: 200 },
  cover: { name: 'Cover', short: 'Cover', price: 10000, capacity: 300 },
  mesa: { name: 'Mesa VIP', short: 'Mesa', price: 180000, capacity: 10, detail: 'hasta 6 personas' },
  cortesia: { name: 'Cortesías', short: 'Cortesía', price: 0, capacity: 30 },
})
export const TICKET_KINDS = Object.freeze(['lista', 'cover', 'mesa', 'cortesia'])

/** Mensajes del letrero LED de la card "Esta noche" (C4: rota cada 3 s) */
export const HERO_SIGN = Object.freeze(['Abrimos 23:30', 'Lista free · inscripción hasta 00:30', 'Quedan 3 mesas'])

/** Filas de la card "Esta noche": tipo, precio y estado. fee = en vez del estado va SERVICE_FEE_NOTE (lo pone la sección). */
export const HERO_ROWS = Object.freeze([
  { name: CLUB_TICKETS.lista.name, price: CLUB_TICKETS.lista.price, state: 'Quedan 40' },
  { name: CLUB_TICKETS.cover.name, price: CLUB_TICKETS.cover.price, state: null, fee: true },
  { name: `${CLUB_TICKETS.mesa.name} · ${CLUB_TICKETS.mesa.detail}`, price: CLUB_TICKETS.mesa.price, state: 'Quedan 3' },
])

// ---- Cuándo se cobra cada noche (§4.2, §4.5, §4.8) ----

/**
 * Cuándo queda disponible lo de una noche que empieza el día `weekday` (0 = lunes) a `start` y termina a `end`: si
 * termina antes de empezar, cruzó la medianoche (como functionEnd de src/lib/producer-api/ledger.ts), y se libera
 * PAYOUT_RELEASE_HOURS después del término. Devuelve el día y la hora ("LUN 05:00").
 */
export function payoutAt(weekday, start, end, hours = PAYOUT_RELEASE_HOURS) {
  let endAt = weekday * 1440 + toMinutes(end)
  if (toMinutes(end) < toMinutes(start)) endAt += 1440
  const at = endAt + hours * 60
  const day = Math.floor(at / 1440) % 7
  const time = clock(at % 1440)
  return { weekday: day, time, label: `${WEEKDAYS[day]} ${time}` }
}

// ---- Armas el mes (§4.2) ----

/** Noches que se repiten cada semana (ejemplo). weekday: 0 = lunes. */
export const CLUB_NIGHTS = Object.freeze([
  { weekday: 3, name: 'Jueves Retro', start: '23:00', end: '04:00' },
  { weekday: 4, name: 'Viernes Ultravioleta', start: '23:30', end: '05:00' },
  { weekday: 5, name: 'Sábado Club', start: '23:30', end: '05:00' },
])
export const MONTH_WEEKS = 5
export const MONTH_DAYS = 31
/** Semana actual (0-4): las anteriores ya se realizaron y las siguientes muestran cuántas entradas quedan */
export const MONTH_CURRENT_WEEK = 2
/** "Quedan N" de las noches futuras, por semana (índice) y día */
const MONTH_LEFT = { 3: { 3: 140, 4: 96, 5: 118 }, 4: { 3: 180, 4: 152, 5: 164 } }

/**
 * Calendario de ejemplo de 5 semanas × 7 días (el mes empieza un lunes; los últimos días son del mes siguiente). Cada
 * noche lleva su horario, sus entradas y la hora de cobro (payoutAt).
 */
export function clubMonth() {
  return Array.from({ length: MONTH_WEEKS }, (_, week) => {
    const state = week < MONTH_CURRENT_WEEK ? 'past' : week === MONTH_CURRENT_WEEK ? 'current' : 'future'
    const days = WEEKDAYS.map((label, weekday) => {
      const n = week * 7 + weekday + 1
      const night = CLUB_NIGHTS.find((x) => x.weekday === weekday)
      return {
        weekday,
        label,
        day: n > MONTH_DAYS ? n - MONTH_DAYS : n,
        outside: n > MONTH_DAYS,
        night: night
          ? {
              ...night,
              payout: payoutAt(weekday, night.start, night.end).label,
              tickets: [CLUB_TICKETS.lista.short, CLUB_TICKETS.cover.short, CLUB_TICKETS.mesa.short].join(', '),
              left: MONTH_LEFT[week]?.[weekday] ?? null,
            }
          : null,
      }
    })
    return { week, state, days }
  })
}

/**
 * Texto del tooltip de una noche: "VIE 23:30 → 05:00 · Lista, Cover, Mesa · disponible el LUN 05:00". "Disponible" y no
 * "se cobra" (como NightLive y PAYOUT_SCHEDULE_TEXT de legal.mjs): a esa hora se puede pedir el retiro, que se transfiere
 * en hasta PAYOUT_BUSINESS_DAYS días hábiles.
 */
export const nightTooltip = (day) =>
  `${day.label} ${day.night.start} → ${day.night.end} · ${day.night.tickets} · disponible el ${day.night.payout}`

// ---- Tu noche en historias (§4.3) ----

/**
 * La serie de la semana hasta el viernes con la cadencia real (DEFAULT_CADENCE, misma regla que planSlots y que la
 * landing de música: seriesMarks). Con una noche semanal se está dentro de la banda diaria: historia todos los días,
 * post hasta D-feed_posts_to_days y la historia del día a las event_day_time. Un día por posición, de SÁB a VIE.
 */
export function weekSeries(cadence, nightWeekday = 4) {
  return seriesMarks(cadence, 6).map((m) => ({
    ...m,
    weekday: WEEKDAYS[(nightWeekday - m.day + 7) % 7],
    time: m.day === 0 ? cadence.event_day_time : cadence.default_time,
  }))
}

/** Demo de anuncios (§4.3): presupuesto diario y días de la demo (1-5; en el panel, hasta AD_LIMITS.maxDays) */
export const CLUB_ADS_DEMO = Object.freeze({ budgetMin: 3000, budgetMax: 50000, budgetStep: 1000, budget: 5000, daysMax: 5, days: 3, ageMax: 35 })

// ---- La lista de los RRPP (§4.4) ----

/**
 * Ranking de ejemplo: visitas, inscritos en la lista free y entradas de cover y mesa que trajo cada link. Los ingresos
 * (lo que recibe el club, sin cargo) se calculan con los precios de CLUB_TICKETS. La venta directa no tiene link ni
 * visitas: su nombre es DIRECT_CHANNEL de src/lib/eventAnalytics.ts (la página lo pasa por props).
 * Totales: lista 186 (como el panel de la noche a las 22:00) y 7 de 10 mesas.
 */
export const RRPP_ROWS = Object.freeze([
  { id: 'cata', name: 'Cata R.', visits: 412, lista: 64, cover: 38, mesa: 2 },
  { id: 'nico', name: 'Nico V.', visits: 298, lista: 51, cover: 22, mesa: 1 },
  { id: 'javi', name: 'Javi M.', visits: 190, lista: 27, cover: 19, mesa: 0 },
  { id: 'instagram', name: 'Bio de Instagram', visits: 520, lista: 33, cover: 41, mesa: 1 },
])
export const RRPP_DIRECT = Object.freeze({ id: 'directo', visits: null, lista: 11, cover: 56, mesa: 3, direct: true })

/** Lo que recibe el club por una fila: Σ cantidad × precio de cada tipo de entrada */
export const rrppRevenue = (row) => TICKET_KINDS.reduce((sum, kind) => sum + (row[kind] || 0) * CLUB_TICKETS[kind].price, 0)

/** Filas del ranking con su ingreso, en el orden de RRPP_ROWS y la venta directa al final */
export function rrppBoard(directLabel) {
  return [...RRPP_ROWS, { ...RRPP_DIRECT, name: directLabel }].map((row) => ({ ...row, revenue: rrppRevenue(row) }))
}

/** Orden del ranking: por inscritos en la lista ('lista') o por ingresos ('revenue'), de mayor a menor */
export const sortRrpp = (rows, by) => [...rows].sort((a, b) => b[by] - a[by] || a.name.localeCompare(b.name))

/** Link de ejemplo de un RRPP (ref, como TrackingLinkBuilder.vue) */
export const rrppLink = (row) => `${NIGHT_EVENT_URL}?ref=${row.id}`

// ---- La noche en vivo (§4.5) ----

/** Aforo del local (ejemplo) */
export const NIGHT_CAPACITY = 600
/** El crossfader va de 22:00 a 05:00 en pasos de 15 min: posiciones 0 a 28 */
export const NIGHT_START = '22:00'
export const NIGHT_STEPS = 28
/** Noche de la sección: viernes 23:30 → 05:00 (la hora de cobro sale de payoutAt) */
export const LIVE_NIGHT = Object.freeze({ weekday: 4, start: '23:30', end: '05:00' })

/**
 * Llegadas de cada tramo de 15 min (índice = posición del crossfader al final del tramo; la 0 no tiene tramo). Es la
 * curva de la noche: la puerta abre a las 23:30, pico entre las 00:30 y la 01:30 y nadie entra pasadas las 03:00.
 * Sumas: 24 a las 23:30, 212 a las 00:30, 455 a la 01:30 y 498 desde las 03:00.
 */
export const NIGHT_ARRIVALS = Object.freeze([
  0, 0, 0, 0, 0, 0, 24, 30, 42, 52, 64, 72, 78, 55, 38, 14, 10, 8, 5, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0,
])

/**
 * Fotogramas de la noche (§4.5): ingresados y emitidas por tipo de entrada en seis momentos. Entre fotogramas se
 * interpola (nightState). Al final: emitidas 200 + 300 + 9 + 30 = 539 (la fila de mesas cuenta mesas, igual que el cupo;
 * con "Personas por entrada" cada mesa trae 6 QR, pero el resumen del ejemplo no los desglosa) e ingresaron 178 + 283 + 9 + 28 = 498. Las sumas las cuadra tests/unit/clubs-landing.test.mjs.
 * sign: mensaje del letrero de la puerta ({cover} = precio del cover, {pct} = aforo del momento).
 */
export const NIGHT_FRAMES = Object.freeze([
  { step: 0, sign: 'Abrimos 23:30', inside: { lista: 0, cover: 0, mesa: 0, cortesia: 0 }, issued: { lista: 186, cover: 176, mesa: 7, cortesia: 30 } },
  { step: 6, sign: 'Lista free · trae tu QR', inside: { lista: 18, cover: 4, mesa: 0, cortesia: 2 }, issued: { lista: 194, cover: 214, mesa: 8, cortesia: 30 } },
  {
    step: 10,
    sign: 'Lista free cerrada · cover {cover}',
    listClosed: true,
    inside: { lista: 120, cover: 70, mesa: 4, cortesia: 18 },
    issued: { lista: 200, cover: 252, mesa: 8, cortesia: 30 },
  },
  { step: 14, sign: 'Queda 1 mesa', inside: { lista: 171, cover: 251, mesa: 8, cortesia: 25 }, issued: { lista: 200, cover: 290, mesa: 9, cortesia: 30 } },
  { step: 20, sign: 'Aforo {pct}%', inside: { lista: 178, cover: 283, mesa: 9, cortesia: 28 }, issued: { lista: 200, cover: 300, mesa: 9, cortesia: 30 } },
  { step: 28, sign: 'Gracias · hasta el viernes', inside: { lista: 178, cover: 283, mesa: 9, cortesia: 28 }, issued: { lista: 200, cover: 300, mesa: 9, cortesia: 30 } },
])
/** Posición donde la noche se detiene al correr sola (01:30) y donde queda con "reducir movimiento" o sin JS */
export const NIGHT_PEAK_STEP = 14
/** Hora en que se cierra la inscripción a la lista (la del fotograma que la cierra) */
export const LIST_CLOSES_AT = clock(toMinutes(NIGHT_START) + NIGHT_FRAMES.find((f) => f.listClosed).step * 15)

const sum = (byKind) => TICKET_KINDS.reduce((s, k) => s + byKind[k], 0)

/** Hora de una posición del crossfader ("01:30") */
export const stepTime = (step) => clock(toMinutes(NIGHT_START) + step * 15)

/** Ingresados acumulados hasta una posición */
export const insideAt = (step) => NIGHT_ARRIVALS.slice(0, step + 1).reduce((s, n) => s + n, 0)

/**
 * Reparte `total` entre los tipos de entrada interpolando entre dos fotogramas según cuánto de la diferencia ya entró,
 * con resto mayor para que la suma dé exacto.
 */
function splitInside(from, to, total) {
  const span = sum(to.inside) - sum(from.inside)
  const share = span ? (total - sum(from.inside)) / span : 0
  const exact = TICKET_KINDS.map((k) => from.inside[k] + (to.inside[k] - from.inside[k]) * share)
  const out = exact.map(Math.floor)
  let rest = total - out.reduce((s, n) => s + n, 0)
  const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (const [, i] of order) {
    if (rest <= 0) break
    out[i] += 1
    rest -= 1
  }
  return Object.fromEntries(TICKET_KINDS.map((k, i) => [k, out[i]]))
}

/** Estado completo de la noche en una posición del crossfader (0 = 22:00 … 28 = 05:00) */
export function nightState(step) {
  const s = Math.max(0, Math.min(NIGHT_STEPS, Math.round(step)))
  const i = NIGHT_FRAMES.findLastIndex((f) => f.step <= s)
  const from = NIGHT_FRAMES[i]
  const to = NIGHT_FRAMES[Math.min(i + 1, NIGHT_FRAMES.length - 1)]
  const t = to.step === from.step ? 0 : (s - from.step) / (to.step - from.step)
  const total = insideAt(s)
  const inside = splitInside(from, to, total)
  const issued = Object.fromEntries(TICKET_KINDS.map((k) => [k, Math.round(from.issued[k] + (to.issued[k] - from.issued[k]) * t)]))
  const pct = Math.round((total / NIGHT_CAPACITY) * 100)
  const arrivals = Array.from({ length: 12 }, (_, j) => NIGHT_ARRIVALS[s - 11 + j] ?? 0)
  const sign = from.sign.replace('{cover}', formatCLP(CLUB_TICKETS.cover.price)).replace('{pct}', String(pct))
  return {
    step: s,
    time: stepTime(s),
    inside: total,
    pct,
    /** LED de la barra de aforo encendidos (de 30) */
    segments: Math.round((total / NIGHT_CAPACITY) * 30),
    byKind: TICKET_KINDS.map((k) => ({ kind: k, name: CLUB_TICKETS[k].name, inside: inside[k], issued: issued[k] })),
    issuedTotal: sum(issued),
    arrivals,
    last15: NIGHT_ARRIVALS[s],
    sign,
    listClosed: NIGHT_FRAMES.some((f) => f.listClosed && f.step <= s),
    tablesSold: issued.mesa,
    tablesTotal: CLUB_TICKETS.mesa.capacity,
    opened: s >= NIGHT_FRAMES[1].step,
    final: s === NIGHT_STEPS,
  }
}

/** Mayor llegada de la noche (alto de las barras) */
export const ARRIVALS_MAX = Math.max(...NIGHT_ARRIVALS)

/** Cuándo se cobra la noche de la sección ("LUN 05:00") */
export const LIVE_PAYOUT = payoutAt(LIVE_NIGHT.weekday, LIVE_NIGHT.start, LIVE_NIGHT.end).label

/**
 * Respuesta del asistente de IA a "¿Cuánta gente hay adentro?" con los mismos datos del panel (como get_checkin_stats:
 * ingresados por tipo y llegadas de los últimos 15 minutos).
 */
export function aiAnswer(state) {
  const by = Object.fromEntries(state.byKind.map((r) => [r.kind, r]))
  const detail = `De la lista free entraron ${num(by.lista.inside)} de ${num(by.lista.issued)}; de cover, ${num(by.cover.inside)}; mesas, ${num(by.mesa.inside)} de ${num(by.mesa.issued)}; cortesías, ${num(by.cortesia.inside)}.`
  if (!state.opened) {
    return `Todavía no abre: la puerta abre a las ${LIVE_NIGHT.start}. Hay ${num(by.lista.issued)} inscritos en la lista free (de ${num(CLUB_TICKETS.lista.capacity)}) y van ${num(state.tablesSold)} de ${num(state.tablesTotal)} mesas vendidas.`
  }
  if (state.final) {
    return `La noche terminó: entraron ${num(state.inside)} de ${num(state.issuedTotal)} entradas emitidas (${state.pct}% del aforo). ${detail}`
  }
  return `Hay ${num(state.inside)} personas adentro (${state.pct}% del aforo). ${detail} En los últimos 15 minutos entraron ${num(state.last15)}.`
}

/** Texto accesible del crossfader: "01:30, 455 personas adentro" */
export const nightValueText = (state) => `${state.time}, ${num(state.inside)} personas adentro`

/** Los seis momentos para la tabla sin JS (§4.5) */
export const NIGHT_TABLE = NIGHT_FRAMES.map((f) => nightState(f.step))

// ---- Precio (§4.8) ----

/** Presets de la calculadora "cierre de caja" y el rango del cover */
export const CASH_PRESETS = Object.freeze([
  { id: 'lista', label: CLUB_TICKETS.lista.name, price: CLUB_TICKETS.lista.price },
  { id: 'cover', label: CLUB_TICKETS.cover.name, price: CLUB_TICKETS.cover.price },
  { id: 'mesa', label: 'Mesa', price: CLUB_TICKETS.mesa.price },
])
export const CLUB_COVER_RANGE = Object.freeze({ min: 0, max: 60000, step: 500 })

// ---- Cierre (§4.12) ----

const CHILE_WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

/** Día de la semana (0 = lunes) y minuto del día en hora de Chile (EVENT_TIMEZONE) */
export function chileClock(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: EVENT_TIMEZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  )
  return { weekday: CHILE_WEEKDAYS[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}

/**
 * Cuenta regresiva al próximo viernes a la hora de apertura, en hora de Chile, sin segundos ("FALTAN 3 D 07 H 12 MIN":
 * el letrero lo pasa a mayúsculas). Si ya pasó la hora de este viernes, cuenta al siguiente.
 */
export function countdownToNight(now = new Date(), { weekday = LIVE_NIGHT.weekday, start = LIVE_NIGHT.start } = {}) {
  const c = chileClock(now)
  let diff = (weekday - c.weekday) * 1440 + toMinutes(start) - c.minutes
  diff = ((diff % 10080) + 10080) % 10080
  if (diff === 0) diff = 10080
  const days = Math.floor(diff / 1440)
  const hours = Math.floor((diff % 1440) / 60)
  const minutes = diff % 60
  return { days, hours, minutes, label: `Faltan ${days} d ${pad(hours)} h ${pad(minutes)} min` }
}
