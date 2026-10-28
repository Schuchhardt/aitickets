// Reporte semanal para productores: reglas y cálculo, sin base de datos ni envío. Lo usan el envío
// (weekly-report-send.mjs), las sugerencias con IA (weekly-report-ai.mjs), la plantilla del correo y los tests.
//
// Reglas (pedido del dueño, oct 2026):
//   * Sale los domingos, hora de Chile. La semana reportada va del domingo anterior 00:00 al domingo del envío 00:00
//     (domingo a sábado completos): semanas contiguas, sin huecos ni ventas contadas dos veces.
//   * Solo a productoras con eventos activos: publicados, no cancelados ni archivados, no demo y que aún no terminan.
//   * Un evento creado el sábado de esa semana (o después) no entra: casi no tiene datos. Si la productora no tiene
//     otro evento activo, ese domingo no recibe reporte.
//   * Por evento: entradas y dinero de la semana (sin cortesías ni transferencias, src/lib/orderKinds.ts), la semana
//     anterior para comparar, total vendido vs capacidad, visitas y canales.
//   * Canal de una venta: ref (link de promotor) o utm_source/utm_medium de la orden; sin seguimiento = "Directo".
//     Canal de una visita: sus UTM o, si no trae, el sitio de donde llegó (referrer).
//   * Mejor canal: el que más entradas vendió con seguimiento; si ninguna venta de la semana lo trae, la fuente con
//     más visitas (sin contar Directo ni "otros sitios").
//   * Sugerencias: las escribe la IA según el canal que funciona (siempre una de contenido y una de publicidad); sin
//     IA o si falla, fallbackSuggestions() con reglas fijas para que el correo nunca salga sin ideas.
//   * Anuncios creados desde AI Tickets (Meta vía Zernio, netlify/lib/zernio-ads.mjs): su link trae
//     utm_source=meta&utm_medium=paid&utm_campaign=ad-<id>, así que el canal "Facebook e Instagram (anuncios)" y el
//     bloque de anuncios del evento muestran cuánto se gastó y cuántas entradas vendió cada uno en la semana.
import { EVENT_TIMEZONE, addDays, todayInTimeZone, zonedDateTimeToUtc } from './dates.mjs'
import { isCourtesyOrder, isTransferOrder, orderSoldQty } from './order-kinds.mjs'
import { adEfficiency, formatBudget, salesByAd } from './zernio-ads.mjs'
import { isDemoEventSlug } from '../../src/lib/demoEvent.mjs'

export const WEEKLY_REPORT_TOPIC = 'weekly_report'
export const REPORTS_TABLE = 'aitickets_weekly_reports'
export const USER_OPTOUTS_TABLE = 'aitickets_user_email_optouts'
/** Quiénes reciben el reporte: dueños/administradores de la productora (src/lib/supabaseServer.ts ORG_ADMIN_ROLES). */
export const REPORT_RECIPIENT_ROLES = Object.freeze(['admin', 'producer'])
/** Eventos que se cargan por productora y los que se muestran en cada correo (el resto, con un link al panel). */
export const MAX_EVENTS_PER_ORG = 15
export const MAX_EVENTS_PER_EMAIL = 6
export const SUGGESTIONS_PER_EVENT = 3
/** utm_campaign de los links que trae el correo: así la productora ve en sus canales lo que vendieron esas ideas. */
export const REPORT_UTM_CAMPAIGN = 'reporte-semanal'

const DAY_MS = 86_400_000

/** Interruptor general: WEEKLY_REPORTS_ENABLED=false apaga el envío del domingo (las vistas previas manuales siguen). */
export const weeklyReportsEnabled = () => String(globalThis.process?.env?.WEEKLY_REPORTS_ENABLED ?? '').trim().toLowerCase() !== 'false'

const weekdayOf = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * Semana del reporte para `now`: la que termina el domingo más reciente (hoy, si es domingo) a las 00:00 de Chile.
 * newEventCutoffAt = sábado 00:00 de esa semana: un evento creado desde ese momento no entra.
 */
export function reportWeek(now = new Date()) {
  const today = todayInTimeZone(EVENT_TIMEZONE, now)
  const dow = weekdayOf(today)
  const weekEnd = addDays(today, -dow)
  const weekStart = addDays(weekEnd, -7)
  return {
    weekStart,
    weekEnd,
    /** Último día incluido (sábado), para mostrar "del 18 al 24 de octubre". */
    lastDay: addDays(weekEnd, -1),
    startAt: zonedDateTimeToUtc(weekStart, '00:00'),
    endAt: zonedDateTimeToUtc(weekEnd, '00:00'),
    prevStartAt: zonedDateTimeToUtc(addDays(weekStart, -7), '00:00'),
    newEventCutoffAt: zonedDateTimeToUtc(addDays(weekEnd, -1), '00:00'),
    isSunday: dow === 0,
  }
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** "del 18 al 24 de octubre" / "del 27 de septiembre al 3 de octubre" / "del 28 de diciembre de 2025 al 3 de enero de 2026". */
export function weekLabel(week) {
  const [y1, m1, d1] = week.weekStart.split('-').map(Number)
  const [y2, m2, d2] = week.lastDay.split('-').map(Number)
  if (y1 !== y2) return `del ${d1} de ${MONTHS[m1 - 1]} de ${y1} al ${d2} de ${MONTHS[m2 - 1]} de ${y2}`
  if (m1 !== m2) return `del ${d1} de ${MONTHS[m1 - 1]} al ${d2} de ${MONTHS[m2 - 1]}`
  return `del ${d1} al ${d2} de ${MONTHS[m2 - 1]}`
}

/**
 * ¿El evento entra en el reporte de esta semana? Publicado, no cancelado ni archivado, no demo, creado antes del
 * sábado de la semana y con end_date en el futuro.
 */
export function isReportableEvent(event, week, now = new Date()) {
  if (!event || event.status !== 'published' || event.cancelled_at || event.archived_at || isDemoEventSlug(event.slug)) return false
  const created = Date.parse(event.created_at)
  if (!Number.isFinite(created) || created >= week.newEventCutoffAt.getTime()) return false
  const ends = Date.parse(event.end_date)
  return Number.isFinite(ends) && ends > now.getTime()
}

// ---------------------------------------------------------------------------
// Canales
// ---------------------------------------------------------------------------

/** Canales que la IA puede nombrar en una sugerencia (y para los que el correo arma un link con seguimiento). */
export const SUGGESTION_CHANNELS = Object.freeze(['instagram', 'facebook', 'meta', 'tiktok', 'whatsapp', 'email', 'google', 'x', 'youtube', 'promoter', 'other'])

const NETWORKS = [
  { key: 'instagram', label: 'Instagram', source: /^(ig|insta|instagram)/, referrer: /instagram\./ },
  // utm_source=meta: anuncios de Meta, que salen en Facebook e Instagram (los creados desde AI Tickets lo usan)
  { key: 'meta', label: 'Facebook e Instagram', source: /^meta/, referrer: /^$/ },
  { key: 'facebook', label: 'Facebook', source: /^(fb|facebook)/, referrer: /(^|\.)facebook\.|(^|\.)fb\.|m\.me$|messenger\./ },
  { key: 'tiktok', label: 'TikTok', source: /^tik[-_ ]?tok/, referrer: /tiktok\./ },
  { key: 'whatsapp', label: 'WhatsApp', source: /^(wa|wsp|whatsapp)/, referrer: /whatsapp\.|wa\.me$/ },
  { key: 'google', label: 'Google', source: /^(google|gads|adwords)/, referrer: /(^|\.)google\./ },
  { key: 'email', label: 'Email', source: /^(e-?mail|mail|newsletter|mailchimp|brevo)/, referrer: /mail\./ },
  { key: 'x', label: 'X (Twitter)', source: /^(x|twitter)$/, referrer: /(^|\.)(twitter|x)\.com$|^t\.co$/ },
  { key: 'youtube', label: 'YouTube', source: /^(youtube|yt)/, referrer: /youtube\.|youtu\.be$/ },
  { key: 'linkedin', label: 'LinkedIn', source: /^linkedin/, referrer: /linkedin\.|lnkd\.in$/ },
]
const PAID_MEDIUM = /^(cpc|ppc|cpm|cpv|paid|paid[-_]?social|paidsocial|ads?|display|sponsored|pagad[oa])$/
const PAID_SOURCE_SUFFIX = /[-_.]?ads$/

/** Deja solo [a-z0-9._-] (los UTM y ref los escribe cualquier visitante: nunca se muestran ni se mandan a la IA crudos). */
export function cleanAttr(value, max = 40) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
}

const DIRECT = Object.freeze({ key: 'direct', label: 'Directo / sin seguimiento', network: null, paid: false, tracked: false })
const OTHER_SITES = Object.freeze({ key: 'other', label: 'Otros sitios', network: null, paid: false, tracked: false })

/** Canal desde UTM: { key, label, network, paid, tracked }. */
function channelFromUtm(source, medium) {
  const src = cleanAttr(source)
  const med = cleanAttr(medium)
  if (!src) return null
  const paid = PAID_MEDIUM.test(med) || PAID_SOURCE_SUFFIX.test(src)
  const base = src.replace(PAID_SOURCE_SUFFIX, '') || src
  const net = NETWORKS.find((n) => n.source.test(base))
  const key = net ? net.key : `src:${base}`
  const label = net ? net.label : base.charAt(0).toUpperCase() + base.slice(1)
  return { key: paid ? `${key}:ads` : key, label: paid ? `${label} (anuncios)` : label, network: net?.key || null, paid, tracked: true }
}

/** Canal de una orden pagada: ref (promotor) > UTM > Directo. */
export function orderChannel(order) {
  const ref = cleanAttr(order?.ref)
  if (ref) return { key: `ref:${ref}`, label: `Promotor ${ref}`, network: 'promoter', paid: false, tracked: true, ref }
  return channelFromUtm(order?.utm_source, order?.utm_medium) || DIRECT
}

function referrerHost(referrer) {
  try {
    return new URL(String(referrer)).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Canal de una visita: sus UTM o el sitio de origen (referrer). Las visitas desde AI Tickets mismo cuentan como Directo. */
export function visitChannel(visit, { ownHosts = [] } = {}) {
  const utm = channelFromUtm(visit?.utm_source, visit?.utm_medium)
  if (utm) return utm
  const host = referrerHost(visit?.referrer)
  if (!host || ownHosts.includes(host)) return DIRECT
  const net = NETWORKS.find((n) => n.referrer.test(host))
  return net ? { key: net.key, label: net.label, network: net.key, paid: false, tracked: false } : OTHER_SITES
}

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

const inRange = (iso, from, to) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) && t >= from.getTime() && t < to.getTime()
}
const pct = (part, total) => (total > 0 ? Math.round((part / total) * 1000) / 10 : null)
/** Variación porcentual vs la semana anterior (null si antes fue 0: no hay base para comparar). */
export const changePct = (current, previous) => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : null)

/** Capacidad a la venta: suma de total_quantity sin el tipo de cortesía (is_gift); null si algún tipo no tiene tope. */
export function saleCapacity(tickets) {
  const forSale = (tickets || []).filter((t) => t && t.is_gift !== true)
  if (!forSale.length || forSale.some((t) => t.total_quantity == null)) return null
  return forSale.reduce((s, t) => s + (Number(t.total_quantity) || 0), 0)
}

/** Mejor canal de una lista de canales con { tickets, revenue_clp, visits }. */
export function pickBestChannel(channels) {
  const bySales = channels
    .filter((c) => c.tracked && c.tickets > 0)
    .sort((a, b) => b.tickets - a.tickets || b.revenue_clp - a.revenue_clp)[0]
  if (bySales) return { ...bySales, basis: 'sales' }
  const byVisits = channels
    .filter((c) => c.key !== DIRECT.key && c.key !== OTHER_SITES.key && c.visits > 0)
    .sort((a, b) => b.visits - a.visits)[0]
  return byVisits ? { ...byVisits, basis: 'visits' } : null
}

/**
 * Cifras de un evento para el reporte.
 * @param {{ event: any, orders: any[], visits: any[], tickets: any[], week: ReturnType<typeof reportWeek>, now?: Date, ownHosts?: string[], ads?: any[] }} p
 *   orders: órdenes pagadas del evento (todas: el total vendido sale de aquí); visits: al menos las de las 2 últimas semanas.
 *   ads: anuncios del evento que corrieron en la semana ({ id, status, ad_type, headline, currency, week_spend, week_clicks,
 *   week_impressions }; week_spend null si Zernio no respondió). Sus ventas de la semana salen de las órdenes.
 */
export function computeEventMetrics({ event, orders, visits, tickets, week, now = new Date(), ownHosts = [], ads = [] }) {
  const sales = (orders || []).filter((o) => o && !isCourtesyOrder(o) && !isTransferOrder(o))
  const blank = () => ({ tickets: 0, revenue_clp: 0, orders: 0 })
  const current = blank()
  const previous = blank()
  const total = blank()
  const channels = new Map()
  const codes = new Map()
  const channelRow = (ch) => {
    if (!channels.has(ch.key)) channels.set(ch.key, { key: ch.key, label: ch.label, network: ch.network, paid: ch.paid, tracked: ch.tracked, ref: ch.ref || null, tickets: 0, revenue_clp: 0, orders: 0, visits: 0 })
    return channels.get(ch.key)
  }

  for (const o of sales) {
    const qty = orderSoldQty(o)
    const amount = Number(o.amount) || 0
    total.tickets += qty
    total.revenue_clp += amount
    total.orders += 1
    if (inRange(o.created_at, week.startAt, week.endAt)) {
      current.tickets += qty
      current.revenue_clp += amount
      current.orders += 1
      const row = channelRow(orderChannel(o))
      row.tickets += qty
      row.revenue_clp += amount
      row.orders += 1
      const code = cleanAttr(o.discount_code, 30)
      if (code) codes.set(code, (codes.get(code) || 0) + 1)
    } else if (inRange(o.created_at, week.prevStartAt, week.startAt)) {
      previous.tickets += qty
      previous.revenue_clp += amount
      previous.orders += 1
    }
  }

  let weekVisits = 0
  let prevVisits = 0
  const unique = new Set()
  for (const v of visits || []) {
    if (inRange(v.created_at, week.startAt, week.endAt)) {
      weekVisits += 1
      if (v.ip_hash) unique.add(v.ip_hash)
      channelRow(visitChannel(v, { ownHosts })).visits += 1
    } else if (inRange(v.created_at, week.prevStartAt, week.startAt)) {
      prevVisits += 1
    }
  }

  const channelList = [...channels.values()].sort((a, b) => b.tickets - a.tickets || b.revenue_clp - a.revenue_clp || b.visits - a.visits)
  const trackedTickets = channelList.filter((c) => c.tracked).reduce((n, c) => n + c.tickets, 0)
  const capacity = saleCapacity(tickets)
  const startMs = Date.parse(event.start_date)
  const topCode = [...codes.entries()].sort((a, b) => b[1] - a[1])[0]
  const best = pickBestChannel(channelList)
  const adSales = salesByAd(sales, { from: week.startAt, to: week.endAt })
  const adRows = (ads || []).map((a) => {
    const sold = adSales.get(Number(a.id)) || { tickets: 0, revenue_clp: 0, orders: 0 }
    return {
      id: Number(a.id),
      status: a.status,
      ad_type: a.ad_type || 'standalone',
      headline: a.headline || null,
      currency: a.currency || 'CLP',
      spend: a.week_spend ?? null,
      clicks: a.week_clicks ?? null,
      impressions: a.week_impressions ?? null,
      tickets: sold.tickets,
      revenue_clp: sold.revenue_clp,
      ...adEfficiency(a.week_spend, sold.tickets, sold.revenue_clp, a.currency || 'CLP'),
    }
  })

  return {
    event_id: Number(event.id),
    name: String(event.name || event.title || 'Tu evento'),
    slug: event.slug || '',
    start_date: event.start_date || null,
    end_date: event.end_date || null,
    days_until: Number.isFinite(startMs) ? Math.max(0, Math.ceil((startMs - now.getTime()) / DAY_MS)) : null,
    week: current,
    previous_week: previous,
    tickets_change_pct: changePct(current.tickets, previous.tickets),
    total,
    capacity,
    remaining: capacity == null ? null : Math.max(0, capacity - total.tickets),
    sell_through_pct: capacity ? Math.min(100, pct(total.tickets, capacity)) : null,
    traffic: {
      visits: weekVisits,
      unique_visitors: unique.size,
      previous_visits: prevVisits,
      conversion_pct: pct(current.orders, unique.size),
    },
    channels: channelList,
    best_channel: best ? { key: best.key, label: best.label, network: best.network, paid: best.paid, ref: best.ref, basis: best.basis, tickets: best.tickets, revenue_clp: best.revenue_clp, visits: best.visits } : null,
    tracked_share_pct: pct(trackedTickets, current.tickets),
    top_discount_code: topCode ? { code: topCode[0], orders: topCode[1] } : null,
    ads: adRows,
  }
}

/** Totales de varios eventos (encabezado del correo) y mejor canal sumando los canales de todos. */
export function summarizeEvents(metrics) {
  const sum = (pick) => metrics.reduce((n, m) => n + pick(m), 0)
  const merged = new Map()
  for (const m of metrics) {
    for (const c of m.channels) {
      const row = merged.get(c.key) || { ...c, tickets: 0, revenue_clp: 0, orders: 0, visits: 0 }
      row.tickets += c.tickets
      row.revenue_clp += c.revenue_clp
      row.orders += c.orders
      row.visits += c.visits
      merged.set(c.key, row)
    }
  }
  const tickets = sum((m) => m.week.tickets)
  const previous = sum((m) => m.previous_week.tickets)
  const best = pickBestChannel([...merged.values()])
  return {
    events: metrics.length,
    tickets,
    revenue_clp: sum((m) => m.week.revenue_clp),
    orders: sum((m) => m.week.orders),
    previous_tickets: previous,
    previous_revenue_clp: sum((m) => m.previous_week.revenue_clp),
    tickets_change_pct: changePct(tickets, previous),
    visits: sum((m) => m.traffic.visits),
    // Anuncios: gasto solo de cuentas en CLP (no se mezclan monedas)
    ad_spend_clp: metrics.reduce((n, m) => n + (m.ads || []).filter((a) => a.currency === 'CLP').reduce((x, a) => x + (Number(a.spend) || 0), 0), 0),
    ad_tickets: metrics.reduce((n, m) => n + (m.ads || []).reduce((x, a) => x + a.tickets, 0), 0),
    best_channel: best ? { key: best.key, label: best.label, network: best.network, basis: best.basis, tickets: best.tickets, revenue_clp: best.revenue_clp, visits: best.visits } : null,
  }
}

// ---------------------------------------------------------------------------
// Links y sugerencias
// ---------------------------------------------------------------------------

const UTM_MEDIUM = { email: 'email', google: 'search', other: 'referral' }

/**
 * Link del evento con seguimiento para una sugerencia: ref para promotores, UTM para el resto
 * (utm_medium=paid en las de publicidad, para que esas ventas aparezcan como "(anuncios)").
 */
export function trackingLink(publicUrl, { channel, type, ref } = {}) {
  if (!publicUrl) return ''
  let url
  try {
    url = new URL(publicUrl)
  } catch {
    return ''
  }
  const ch = SUGGESTION_CHANNELS.includes(channel) ? channel : 'other'
  if (ch === 'promoter') {
    url.searchParams.set('ref', cleanAttr(ref) || 'promotor')
    return url.toString()
  }
  url.searchParams.set('utm_source', ch === 'other' ? 'reporte' : ch)
  url.searchParams.set('utm_medium', type === 'ads' ? 'paid' : UTM_MEDIUM[ch] || 'social')
  url.searchParams.set('utm_campaign', REPORT_UTM_CAMPAIGN)
  return url.toString()
}

/** Red social para contenido/anuncios según el mejor canal (WhatsApp, email y Google no tienen "posts": Instagram). */
function contentNetwork(best) {
  const n = best?.network
  if (['instagram', 'facebook', 'tiktok', 'x', 'youtube'].includes(n)) return n
  return 'instagram'
}

const NET_LABEL = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', x: 'X', youtube: 'YouTube' }

/** Cómo reforzar cada canal (sugerencia 1 cuando ya sabemos qué funciona). */
const CHANNEL_PLAYS = {
  instagram: { title: 'Dale más fuerza a Instagram', body: 'Es tu canal que más vende: publica historias con cuenta regresiva y sticker de link, y deja el link con seguimiento en tu bio.' },
  facebook: { title: 'Sigue moviendo Facebook', body: 'Es lo que mejor te funciona: comparte el evento en grupos locales y de tu público, y fija la publicación en tu página.' },
  tiktok: { title: 'Aprovecha TikTok', body: 'Es tu mejor canal: sube videos cortos del ambiente o del line-up con el link en tu perfil, y responde comentarios con video.' },
  whatsapp: { title: 'Haz rendir WhatsApp', body: 'Tu público compra por WhatsApp: envía el link con seguimiento a tus listas de difusión y pídele a tu equipo que lo comparta en sus grupos.' },
  email: { title: 'Vuelve a escribirle a tu lista', body: 'El correo te está vendiendo: manda un recordatorio corto con la fecha, lo que van a vivir y un botón directo para comprar.' },
  google: { title: 'Te están buscando en Google', body: 'Llegan buscando el evento: revisa que el nombre y la descripción digan qué es, dónde y cuándo, con las palabras que usaría tu público.' },
  x: { title: 'Sigue la conversación en X', body: 'Es tu mejor canal: publica novedades del evento y fija la publicación con el link con seguimiento.' },
  youtube: { title: 'Saca partido a YouTube', body: 'Te llegan desde YouTube: agrega el link con seguimiento en la descripción y en el comentario fijado de tus videos.' },
  promoter: { title: 'Tu promotor está vendiendo', body: 'Dale un código de descuento exclusivo para su público y arma links de promotor para más personas de tu equipo.' },
  meta: { title: 'Tus anuncios están vendiendo', body: 'Los anuncios en Facebook e Instagram son tu canal que más vende: si el costo por entrada te conviene, súbeles el presupuesto o alárgalos unos días.' },
}

/**
 * Idea de publicidad: con un anuncio corriendo, qué hacer según sus números de la semana; si no, probar uno chico
 * (creándolo en AI Tickets cuando los anuncios están disponibles, adsInApp).
 */
function adsSuggestion(m, net, adsInApp) {
  const running = (m.ads || []).filter((a) => a.spend > 0).sort((a, b) => b.spend - a.spend)[0]
  if (running) {
    const spent = formatBudget(running.spend, running.currency)
    if (running.tickets > 0) {
      return {
        type: 'ads',
        channel: 'meta',
        title: 'Ajusta tu anuncio según lo que vende',
        body: `Tu anuncio gastó ${spent} esta semana y vendió ${running.tickets} ${running.tickets === 1 ? 'entrada' : 'entradas'}${running.cost_per_ticket != null ? ` (${formatBudget(running.cost_per_ticket, running.currency)} por entrada)` : ''}. Si te conviene, súbele el presupuesto o alárgalo unos días.`,
      }
    }
    return {
      type: 'ads',
      channel: 'meta',
      title: 'Cambia la imagen o el texto del anuncio',
      body: `Tu anuncio gastó ${spent} esta semana y todavía no vende entradas. Prueba otra imagen o un texto con la fecha y el lugar, o páusalo y crea uno nuevo cerca del lugar del evento.`,
    }
  }
  if (adsInApp) {
    return {
      type: 'ads',
      channel: 'meta',
      title: 'Prueba un anuncio chico',
      body: 'Crea en AI Tickets un anuncio de Facebook e Instagram con un monto bajo por 3 a 5 días, cerca del lugar del evento: te mostramos cuántas entradas vende.',
    }
  }
  return {
    type: 'ads',
    channel: net === 'tiktok' ? 'tiktok' : 'instagram',
    title: 'Prueba un anuncio chico',
    body: `Invierte un monto bajo durante 3 a 5 días en ${net === 'tiktok' ? 'TikTok' : 'Instagram y Facebook'}, segmentado cerca del lugar del evento, y usa el link de anuncios para ver cuánto vendió.`,
  }
}

/**
 * Sugerencias con reglas fijas (sin IA o si la IA falla). Siempre 3: reforzar el mejor canal (o medir), contenido
 * y publicidad; sin ventas en la semana, la primera es una oferta con fecha límite.
 * @param {any} m cifras de computeEventMetrics
 * @param {{ adsInApp?: boolean }} [opts] adsInApp: los anuncios se pueden crear desde AI Tickets (Zernio configurado)
 */
export function fallbackSuggestions(m, { adsInApp = false } = {}) {
  const best = m.best_channel
  const net = contentNetwork(best)
  const out = []
  if (m.week.tickets === 0 && (m.days_until == null || m.days_until > 1)) {
    out.push({ type: 'offer', channel: net, title: 'Activa la venta con una oferta', body: 'Esta semana no hubo ventas: crea un código de descuento con fecha límite (por ejemplo, 48 horas) y anúncialo en tus redes para dar un motivo para comprar hoy.' })
  } else if (best?.basis === 'sales') {
    const play = CHANNEL_PLAYS[best.network] || { title: `Refuerza ${best.label}`, body: 'Es el canal que más te vendió esta semana: vuelve a publicar ahí con el link con seguimiento y pídele a tu equipo que lo comparta.' }
    out.push({ type: 'channel', channel: best.network || 'other', ...play })
  } else if (best?.basis === 'visits') {
    out.push({ type: 'tracking', channel: best.network || net, title: `${best.label} te trae más visitas`, body: 'Pero las compras llegan sin seguimiento: usa ahí el link con seguimiento de este correo para saber cuántas entradas vende de verdad.' })
  } else {
    out.push({ type: 'tracking', channel: net, title: 'Mide qué canal te vende', body: 'Usa un link con seguimiento distinto en cada red, en WhatsApp y con cada promotor: el próximo domingo te diremos cuál vendió más.' })
  }
  const urgency = m.days_until != null && m.days_until <= 7 ? ' Quedan pocos días: usa una cuenta regresiva.' : ''
  out.push({
    type: 'content',
    channel: net,
    title: `Crea una publicación para ${NET_LABEL[net]}`,
    body: `Genera con IA en AI Tickets una publicación con imagen para ${NET_LABEL[net]}: muestra qué se va a vivir y termina con un llamado claro a comprar.${urgency}`,
  })
  out.push(adsSuggestion(m, net, adsInApp))
  return out.slice(0, SUGGESTIONS_PER_EVENT)
}

/** Ordena los eventos para el correo: los que vienen antes primero. */
export function sortEventsForReport(metrics) {
  return [...metrics].sort((a, b) => (Date.parse(a.start_date) || Infinity) - (Date.parse(b.start_date) || Infinity) || a.event_id - b.event_id)
}
