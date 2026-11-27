// Web Push para el panel de productores (PWA). Las claves VAPID salen de Netlify (VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT); sin ellas todo queda en no-op. Nada de aquí lanza: un aviso push nunca
// debe romper una venta, un correo o una herramienta del admin. Los llamadores lo esperan con await porque en
// una función serverless lo que no se espera puede quedar congelado al responder.
import { sendNotification } from 'web-push'
import { getSupabaseAdmin } from './supabase.mjs'

const TABLE = 'aitickets_push_subscriptions'
const SEND_TIMEOUT_MS = 5000
const EMPTY = { sent: 0, failed: 0, cleaned: 0 }

const env = (name) => globalThis.process?.env?.[name]

function getVapid() {
  const publicKey = env('VAPID_PUBLIC_KEY')
  const privateKey = env('VAPID_PRIVATE_KEY')
  const subject = env('VAPID_SUBJECT') || 'mailto:soporte@aitickets.cl'
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject }
}

function buildPayload({ title, body, url, tag, icon }) {
  return JSON.stringify({
    title: title || 'AI Tickets',
    body: body || '',
    url: url || '/dashboard',
    tag: tag || undefined,
    icon: icon || '/android-chrome-192x192.png',
  })
}

async function sendToSubscriptions(supabase, vapid, subscriptions, notification) {
  const payload = buildPayload(notification)
  const options = {
    vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    timeout: SEND_TIMEOUT_MS,
    TTL: 60 * 60 * 24,
  }

  const results = await Promise.all(
    subscriptions.map((sub) =>
      sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, options)
      .then(() => ({ id: sub.id, ok: true }))
      .catch((err) => ({ id: sub.id, ok: false, statusCode: err?.statusCode || 0 })),
    ),
  )

  const sent = results.filter((r) => r.ok).length
  // 404/410: el navegador anuló la suscripción (desinstaló la app, borró datos). Se limpia.
  const toDelete = results.filter((r) => !r.ok && (r.statusCode === 404 || r.statusCode === 410)).map((r) => r.id)
  if (toDelete.length) await supabase.from(TABLE).delete().in('id', toDelete)
  return { sent, failed: results.length - sent, cleaned: toDelete.length }
}

async function sendPushWhere(column, value, notification) {
  try {
    const vapid = getVapid()
    if (!vapid || value == null) return EMPTY
    const supabase = getSupabaseAdmin()
    const { data: subs, error } = await supabase.from(TABLE).select('id, endpoint, p256dh, auth').eq(column, value)
    if (error) {
      console.warn('push: no se pudieron leer las suscripciones:', error.message)
      return EMPTY
    }
    if (!subs?.length) return EMPTY
    return await sendToSubscriptions(supabase, vapid, subs, notification)
  } catch (err) {
    console.warn('push: error enviando notificaciones:', err?.message || err)
    return EMPTY
  }
}

/** true si las claves VAPID están configuradas (sin ellas los envíos son no-op). */
export function isPushConfigured() {
  return getVapid() !== null
}

/** Avisa a todos los navegadores suscritos de la organización. Nunca lanza. */
export function sendPushToOrg(orgId, notification) {
  return sendPushWhere('organization_id', orgId, notification)
}

/** Avisa a todos los navegadores suscritos de un usuario. Nunca lanza. */
export function sendPushToUser(userId, notification) {
  return sendPushWhere('user_id', userId, notification)
}

/** "Nueva venta" para el productor de una orden recién pagada. Nunca lanza. */
export async function notifyProducerSale(supabase, order, amount) {
  try {
    const { data: ev } = await supabase.from('events').select('organization_id, name').eq('id', order.event_id).maybeSingle()
    if (!ev?.organization_id) return EMPTY
    const lines = Array.isArray(order.ticket_details) ? order.ticket_details : []
    const qty = lines.reduce((s, t) => s + (Number(t?.quantity) || 0), 0)
    const parts = [
      qty ? `${qty} entrada${qty !== 1 ? 's' : ''}` : null,
      `$${Number(amount || 0).toLocaleString('es-CL')} CLP`,
      ev.name || null,
    ].filter(Boolean)
    return await sendPushToOrg(ev.organization_id, {
      title: 'Nueva venta',
      body: parts.join(' · ').slice(0, 120),
      url: `/dashboard/events/${order.event_id}`,
      tag: `sale-${order.id}`,
    })
  } catch (err) {
    console.warn('push: no se pudo avisar la venta:', err?.message || err)
    return EMPTY
  }
}
