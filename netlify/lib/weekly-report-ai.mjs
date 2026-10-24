// Sugerencias con IA del reporte semanal (weekly-report-send.mjs): UNA llamada a Claude por productora con las cifras
// de sus eventos, salida JSON estructurada (output_config.format) y validación de lo que vuelve.
//
// - Modelo: WEEKLY_REPORT_MODEL, si no ANTHROPIC_MODEL, si no el mismo del asistente (claude-opus-5-5), esfuerzo bajo
//   y fallback del servidor si el modelo rechaza ("default"). WEEKLY_REPORT_AI=off la apaga.
// - Nunca lanza: sin API key, con error, rechazo, respuesta cortada o JSON inválido devuelve null y el correo sale con
//   fallbackSuggestions() (reglas fijas). Lo que sí vuelve se limpia: sin URLs (los links los arma el servidor), sin
//   markdown, con largo máximo, solo event_id pedidos y canales conocidos; si falta la de contenido o la de
//   publicidad se completa con la de reglas fijas.
// - Los datos que se mandan son de la propia productora (nombre, descripción, cifras) y los canales ya vienen
//   saneados (cleanAttr): los UTM los escribe cualquier visitante y nunca llegan crudos al modelo.
import Anthropic from '@anthropic-ai/sdk'

import { DEFAULT_ANTHROPIC_MODEL } from './assistant-llm.mjs'
import { SUGGESTION_CHANNELS, SUGGESTIONS_PER_EVENT, fallbackSuggestions } from './weekly-report.mjs'

const env = (name) => {
  const value = globalThis.process?.env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

export const SUGGESTION_TYPES = Object.freeze(['channel', 'tracking', 'offer', 'content', 'ads'])
const REQUEST_TIMEOUT_MS = 60_000
const MAX_OUTPUT_TOKENS = 8000
const LIMITS = { summary: 320, insight: 260, title: 70, body: 300 }

export const isReportAiConfigured = () => env('WEEKLY_REPORT_AI').toLowerCase() !== 'off' && Boolean(env('ANTHROPIC_API_KEY'))

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'events'],
  properties: {
    summary: { type: 'string', description: 'Una o dos frases para abrir el correo: cómo le fue a la productora esta semana en conjunto.' },
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['event_id', 'insight', 'suggestions'],
        properties: {
          event_id: { type: 'integer' },
          insight: { type: 'string', description: 'Una frase con la lectura de la semana del evento, con cifras de los datos.' },
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['type', 'channel', 'title', 'body'],
              properties: {
                type: { type: 'string', enum: [...SUGGESTION_TYPES] },
                channel: { type: 'string', enum: [...SUGGESTION_CHANNELS] },
                title: { type: 'string' },
                body: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
}

const SYSTEM = [
  'Eres el estratega de marketing de AI Tickets, una ticketera chilena. Cada domingo le escribes a una productora de eventos su reporte semanal.',
  'Recibes en JSON los datos reales de la semana de sus eventos activos: entradas vendidas y dinero (CLP), la semana anterior, capacidad, visitas a la página del evento y canales.',
  'Canales: las ventas traen canal solo si se compraron con un link con seguimiento (UTM o ref de promotor); las demás quedan como "Directo / sin seguimiento". Las visitas traen canal por sus UTM o por el sitio de donde llegaron. best_channel es el canal que más vendió con seguimiento (basis "sales") o, si ninguna venta lo trae, la fuente con más visitas (basis "visits"). tracked_share_pct es el % de las entradas de la semana que llegaron con seguimiento.',
  '',
  'Para cada evento escribe:',
  '- insight: una frase con la lectura de la semana, usando cifras de los datos (qué canal está funcionando y qué significa).',
  `- suggestions: exactamente ${SUGGESTIONS_PER_EVENT} acciones concretas para esta semana, en este orden:`,
  '  1) type "channel": cómo reforzar best_channel con una acción específica de ese canal. Si best_channel es null, su basis es "visits" o tracked_share_pct es menor a 50, usa type "tracking": que use un link con seguimiento distinto por canal para saber qué vende (si hay un canal con visitas, nómbralo). Si el evento no vendió nada en la semana y falta más de un día, usa type "offer": un código de descuento o preventa con fecha límite.',
  '  2) type "content": una pieza de contenido para crear con el generador de posts con IA de AI Tickets, pensada para el canal que funciona (o Instagram si no hay datos): formato (reel, carrusel, historia, video corto), el gancho y qué mostrar.',
  '  3) type "ads": publicidad pagada. Si el evento ya tiene anuncios (ads, de la semana: spend, tickets, cost_per_ticket, roas), decide con esos números: si venden a un costo por entrada razonable frente al precio promedio (week.revenue_clp / week.tickets), sugiere subir el presupuesto o alargarlo; si gastan sin vender, cambiar imagen o texto, o pausarlo. Si no tiene anuncios, una prueba chica y medible: monto diario y duración en CLP, y a quién apuntar (cerca del lugar del evento). Cuando ads_in_app es true, el anuncio se crea desde AI Tickets en 3 pasos (Facebook e Instagram, channel "meta") y mide solo cuántas entradas vende; si es false, en Instagram/Facebook o TikTok usando el link de anuncios del correo.',
  '- channel: la red o canal al que apunta cada acción; "promoter" para promotores (ref), "other" si no aplica ninguno.',
  'Adapta las ideas a la urgencia: días que faltan para el evento (days_until) y cuánto queda por vender (sell_through_pct).',
  'summary: una o dos frases para abrir el correo sobre la semana de la productora en conjunto.',
  '',
  'Reglas: español de Chile, tuteo, cercano y directo, sin exagerar. title de máximo 8 palabras; body de máximo 2 frases (unos 250 caracteres). Usa solo las cifras del JSON: no inventes artistas, precios, fechas, beneficios ni resultados. No incluyas URLs ni links (el correo agrega los links con seguimiento). Sin markdown, sin emojis y sin comillas tipográficas innecesarias.',
].join('\n')

/** Texto limpio para el correo: sin URLs, sin markdown ni caracteres de control, con largo máximo (corta en palabra). */
export function cleanSuggestionText(value, max) {
  let s = String(value ?? '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[*_#`>|]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
  if (s.length > max) {
    const cut = s.slice(0, max - 1)
    s = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(max * 0.6))).replace(/[\s,;:.-]+$/, '')}…`
  }
  return s
}

function cleanSuggestion(raw) {
  if (!raw || typeof raw !== 'object') return null
  const type = SUGGESTION_TYPES.includes(raw.type) ? raw.type : null
  const title = cleanSuggestionText(raw.title, LIMITS.title)
  const body = cleanSuggestionText(raw.body, LIMITS.body)
  if (!type || !title || !body) return null
  return { type, channel: SUGGESTION_CHANNELS.includes(raw.channel) ? raw.channel : 'other', title, body }
}

/** Con la lista llena, cuál se cambia por una obligatoria: la última de un tipo repetido, si no la última no obligatoria. */
function replaceableIndex(list) {
  const repeated = (i) => list.filter((s) => s.type === list[i].type).length > 1
  for (let i = list.length - 1; i >= 0; i -= 1) if (repeated(i)) return i
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].type !== 'content' && list[i].type !== 'ads') return i
  return list.length - 1
}

/**
 * Sugerencias finales de un evento: las de la IA (limpias) completadas con las de reglas fijas para que siempre haya
 * SUGGESTIONS_PER_EVENT, con al menos una de contenido y una de publicidad.
 */
export function mergeSuggestions(aiSuggestions, metrics, opts = {}) {
  const fallback = fallbackSuggestions(metrics, opts)
  const list = (Array.isArray(aiSuggestions) ? aiSuggestions : []).map(cleanSuggestion).filter(Boolean).slice(0, SUGGESTIONS_PER_EVENT)
  for (const required of ['content', 'ads']) {
    if (list.some((s) => s.type === required)) continue
    const fill = fallback.find((s) => s.type === required)
    if (list.length < SUGGESTIONS_PER_EVENT) {
      list.push(fill)
      continue
    }
    list[replaceableIndex(list)] = fill
  }
  for (const s of fallback) {
    if (list.length >= SUGGESTIONS_PER_EVENT) break
    if (!list.some((x) => x.type === s.type)) list.push(s)
  }
  // Orden estable: canal/medición/oferta, contenido, publicidad
  const rank = { channel: 0, tracking: 0, offer: 0, content: 1, ads: 2 }
  return list.slice(0, SUGGESTIONS_PER_EVENT).sort((a, b) => rank[a.type] - rank[b.type])
}

const stripHtml = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/\s+/g, ' ').trim()

/** Datos del evento que ve la IA (compactos: solo lo que sirve para decidir). */
export function eventPromptData(m, context = {}) {
  return {
    event_id: m.event_id,
    name: m.name,
    starts: context.startsLabel || null,
    days_until: m.days_until,
    place: context.place || null,
    about: stripHtml(context.description).slice(0, 400) || null,
    week: m.week,
    previous_week: m.previous_week,
    tickets_change_pct: m.tickets_change_pct,
    total_sold: m.total.tickets,
    capacity: m.capacity,
    sell_through_pct: m.sell_through_pct,
    visits: m.traffic.visits,
    unique_visitors: m.traffic.unique_visitors,
    conversion_pct: m.traffic.conversion_pct,
    channels: m.channels.slice(0, 6).map((c) => ({ channel: c.label, tracked: c.tracked, tickets: c.tickets, revenue_clp: c.revenue_clp, visits: c.visits })),
    best_channel: m.best_channel ? { channel: m.best_channel.label, network: m.best_channel.network, basis: m.best_channel.basis, tickets: m.best_channel.tickets, visits: m.best_channel.visits } : null,
    tracked_share_pct: m.tracked_share_pct,
    top_discount_code: m.top_discount_code,
    ads: (m.ads || []).map((a) => ({ status: a.status, currency: a.currency, spend: a.spend, clicks: a.clicks, tickets: a.tickets, revenue_clp: a.revenue_clp, cost_per_ticket: a.cost_per_ticket, roas: a.roas })),
  }
}

let sharedClient = null
function defaultClient() {
  if (!sharedClient) sharedClient = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY'), timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 })
  return sharedClient
}

/**
 * Pide las sugerencias de una productora. events: [{ metrics, context: { startsLabel, place, description } }].
 * @returns {Promise<{ provider: string, model: string, summary: string, byEvent: Map<number, { insight: string, suggestions: any[] }> } | null>}
 */
export async function generateAiSuggestions({ orgName, weekLabel, totals, events, adsInApp = false }, { client } = {}) {
  if (!events?.length) return null
  if (!client && !isReportAiConfigured()) return null
  const model = env('WEEKLY_REPORT_MODEL') || env('ANTHROPIC_MODEL') || DEFAULT_ANTHROPIC_MODEL
  const data = {
    organization: String(orgName || '').slice(0, 120),
    week: weekLabel,
    totals: { tickets: totals.tickets, revenue_clp: totals.revenue_clp, previous_tickets: totals.previous_tickets, tickets_change_pct: totals.tickets_change_pct, visits: totals.visits, ad_spend_clp: totals.ad_spend_clp, ad_tickets: totals.ad_tickets },
    ads_in_app: Boolean(adsInApp),
    events: events.map((e) => eventPromptData(e.metrics, e.context)),
  }
  let response
  try {
    response = await (client || defaultClient()).beta.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Datos de la semana (JSON):\n${JSON.stringify(data)}` }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })
  } catch (err) {
    console.error('[weekly-report] error de Claude:', err?.status || '', String(err?.message || err).slice(0, 300))
    return null
  }
  if (!response || response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
    console.warn('[weekly-report] Claude no completó las sugerencias:', response?.stop_reason)
    return null
  }
  const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    console.warn('[weekly-report] respuesta de Claude no es JSON')
    return null
  }
  const wanted = new Set(events.map((e) => e.metrics.event_id))
  const byEvent = new Map()
  for (const item of Array.isArray(parsed?.events) ? parsed.events : []) {
    const id = Number(item?.event_id)
    if (!wanted.has(id) || byEvent.has(id)) continue
    byEvent.set(id, { insight: cleanSuggestionText(item.insight, LIMITS.insight), suggestions: Array.isArray(item.suggestions) ? item.suggestions : [] })
  }
  if (!byEvent.size) return null
  return { provider: 'anthropic', model: String(response.model || model), summary: cleanSuggestionText(parsed.summary, LIMITS.summary), byEvent }
}
