// Muro de asistentes (reacción con emoji + mensaje corto) y mensajes de asistentes a la productora.
// Tablas: db/migrations/202610250100_attendee_feed_and_messages.sql. Solo servidor (service role).
//
// Quién puede publicar o escribir: quien tiene el link de una orden PAGADA con al menos una entrada vigente (el
// mismo criterio que /api/reviews/verify: quien tiene el link ya ve sus entradas). Publica como el comprador de
// esa orden (event_orders.buyer_email; fallback al registro attendees en órdenes antiguas).
// El muro solo lo ven quienes van al evento (páginas de orden y de entrada) y la productora en su panel.
import { reviewDisplayName, isLiveTicketStatus } from './reviews.mjs'
import { orderKind } from './order-kind.mjs'

export const FEED_TABLE = 'aitickets_event_feed_posts'
export const MESSAGES_TABLE = 'aitickets_attendee_messages'

/** Emojis permitidos (lista cerrada: el campo nunca guarda texto libre). */
export const FEED_EMOJIS = Object.freeze(['🔥', '🙌', '🎉', '❤️', '😍', '🤘', '💃', '🥳'])
export const FEED_MESSAGE_MAX = 280
export const FEED_PAGE = 60
export const MESSAGE_MIN = 2
export const MESSAGE_MAX = 2000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Caracteres de control (salvo salto de línea/tab) y marcas de dirección que permiten falsear el texto
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‎‏‪-‮⁦-⁩]/g

export const isOrderId = (value) => typeof value === 'string' && UUID_RE.test(value)

/** Emoji de la lista o null. Acepta el emoji sin el selector de variación (❤ => ❤️). */
export function normalizeFeedEmoji(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  return FEED_EMOJIS.find((e) => e === raw || e.replace(/️/g, '') === raw.replace(/️/g, '')) || null
}

/** Mensaje del muro: una línea, sin caracteres de control, máx. FEED_MESSAGE_MAX. Vacío => null. */
export function normalizeFeedMessage(value) {
  const clean = String(value ?? '')
    .replace(CONTROL_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean ? Array.from(clean).slice(0, FEED_MESSAGE_MAX).join('').trim() : null
}

/** Mensaje a la productora: respeta saltos de línea (máx. 2 seguidos), sin control. Muy corto => null. */
export function normalizeAttendeeMessage(value) {
  const clean = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_RE, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (clean.length < MESSAGE_MIN) return null
  return clean.slice(0, MESSAGE_MAX).trim()
}

/** Conteo de reacciones visibles: [{ emoji, count }] de mayor a menor (empate: orden de FEED_EMOJIS). */
export function summarizeReactions(rows) {
  const counts = new Map()
  for (const r of rows || []) {
    const e = normalizeFeedEmoji(r?.emoji)
    if (e) counts.set(e, (counts.get(e) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([emoji, count]) => ({ emoji, count }))
    .sort((a, b) => b.count - a.count || FEED_EMOJIS.indexOf(a.emoji) - FEED_EMOJIS.indexOf(b.emoji))
}

/** Publicación tal como la ven los asistentes (sin email). */
export function publicFeedPost(row, viewerEmail = '') {
  const mine = Boolean(viewerEmail) && String(row?.email || '').toLowerCase() === String(viewerEmail).toLowerCase()
  return {
    id: String(row.id),
    name: row.display_name || 'Asistente',
    emoji: normalizeFeedEmoji(row.emoji) || FEED_EMOJIS[0],
    message: row.message || null,
    created_at: row.created_at,
    mine,
    ...(mine && row.status === 'hidden' ? { hidden: true } : {}),
  }
}

/**
 * Titular de una orden: la orden pagada, su evento, el comprador y cuántas entradas vigentes tiene.
 * null si el id no es válido, la orden no existe, no está pagada o ya no tiene entradas vigentes.
 * @returns {Promise<null | { order: any, event: any, kind: 'rsvp' | 'courtesy' | 'transfer' | 'purchase', email: string, firstName: string, lastName: string, displayName: string | null, liveCount: number }>}
 */
export async function loadOrderHolder(supabase, orderId) {
  if (!isOrderId(orderId)) return null
  const { data: order, error } = await supabase
    .from('event_orders')
    .select('id, event_id, status, attendee_id, buyer_first_name, buyer_last_name, buyer_email, payment_provider, ticket_details, total_payment, amount')
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw error
  if (!order || order.status !== 'paid') return null

  const { data: tickets, error: ticketsError } = await supabase.from('event_attendees').select('id, status').eq('event_order_id', order.id).limit(500)
  if (ticketsError) throw ticketsError
  const liveCount = (tickets || []).filter((t) => isLiveTicketStatus(t.status)).length
  if (!liveCount) return null

  let person = order.buyer_email ? { first_name: order.buyer_first_name, last_name: order.buyer_last_name, email: order.buyer_email } : null
  if (!person && order.attendee_id != null) {
    const { data } = await supabase.from('attendees').select('first_name, last_name, email').eq('id', order.attendee_id).maybeSingle()
    person = data || null
  }
  const email = String(person?.email || '').trim().toLowerCase()
  if (!email) return null

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, name, slug, organization_id, start_date, end_date')
    .eq('id', order.event_id)
    .maybeSingle()
  if (eventError) throw eventError
  if (!event?.organization_id) return null

  const firstName = String(person?.first_name || '').trim()
  const lastName = String(person?.last_name || '').trim()
  return { order, event, kind: orderKind(order), email, firstName, lastName, displayName: reviewDisplayName(firstName, lastName), liveCount }
}

/**
 * Muro de un evento para quien lo mira: publicaciones visibles (las más nuevas primero), conteo de reacciones,
 * total de personas que reaccionaron y la publicación propia (aunque la productora la haya ocultado).
 */
export async function loadFeed(supabase, eventId, viewerEmail = '', { limit = FEED_PAGE } = {}) {
  const [visible, all, mine] = await Promise.all([
    supabase
      .from(FEED_TABLE)
      .select('id, email, display_name, emoji, message, status, created_at')
      .eq('event_id', eventId)
      .eq('status', 'visible')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase.from(FEED_TABLE).select('emoji').eq('event_id', eventId).eq('status', 'visible').limit(5000),
    viewerEmail
      ? supabase.from(FEED_TABLE).select('id, email, display_name, emoji, message, status, created_at').eq('event_id', eventId).eq('email', viewerEmail).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  const failed = visible.error || all.error || mine.error
  if (failed) throw failed
  const reactions = summarizeReactions(all.data || [])
  return {
    posts: (visible.data || []).map((r) => publicFeedPost(r, viewerEmail)),
    reactions,
    total: reactions.reduce((n, r) => n + r.count, 0),
    mine: mine.data ? publicFeedPost(mine.data, viewerEmail) : null,
  }
}

/** ¿Falta la migración del muro/mensajes? (deploy preview sin migrar) */
export function isMissingCommunitySchema(error) {
  const code = String(error?.code || '')
  return code === '42P01' || code === 'PGRST205' || /aitickets_(event_feed_posts|attendee_messages)/.test(String(error?.message || ''))
}
