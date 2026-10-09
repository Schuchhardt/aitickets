// POST /api/send-event-notification (contrato C8) — encola el aviso a los asistentes de un evento.
// Autorización: header x-internal-secret (llamada servidor→servidor desde /api/events/update)
// o sesión de productor (admin/producer/editor) dueño del evento.
// Body: { eventId, changeType, changeDescription }
//
// El envío masivo corre en la background function send-event-notification-background (hasta 15 min):
// aquí solo se valida, se autoriza y se reenvía con x-internal-secret. Responde 202 { queued: true }.
import { getSupabaseAdmin, getOwnedEvent, hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { getSessionContextWithRefresh, jsonWithCookies, EVENT_MANAGER_ROLES } from '../../lib/session.mjs'
import { notifySlack } from '../../lib/slack.mjs'

const CHANGE_TYPES = ['date_change', 'venue_change', 'cancellation', 'general_update']
const BACKGROUND_PATH = '/.netlify/functions/send-event-notification-background'

/**
 * Origen confiable para la llamada con x-internal-secret: DEPLOY_URL (mismo deploy) y luego SITE_URL.
 * Nunca se deriva de req.url/Host (un dominio propio de productor es alias del sitio y podría apuntar a
 * un servidor ajeno) ni de process.env.URL. En desarrollo local sin esas variables, solo localhost.
 */
function functionsOrigin(req) {
  const trusted = (process.env.DEPLOY_URL || process.env.SITE_URL || '').trim().replace(/\/+$/, '')
  if (/^https?:\/\//i.test(trusted)) return trusted
  // Solo en desarrollo local (sin DEPLOY_URL/SITE_URL) se acepta el origen de la request, y solo si es localhost.
  try {
    const u = new URL(req.url)
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return u.origin
  } catch { /* req sin URL absoluta */ }
  return ''
}

export default async function handler(req) {
  let setCookies = []
  const respond = (body, status) => jsonWithCookies(body, status, setCookies)

  if (req.method !== 'POST') return json({ message: 'Método no permitido' }, 405)

  let body
  try {
    body = await req.json()
  } catch {
    return json({ message: 'Solicitud inválida' }, 400)
  }

  const eventId = Number(body?.eventId)
  const changeType = String(body?.changeType || '')
  const changeDescription = typeof body?.changeDescription === 'string' ? body.changeDescription.trim().slice(0, 2000) : ''
  if (!Number.isInteger(eventId) || !CHANGE_TYPES.includes(changeType) || !changeDescription) {
    return json({ message: 'eventId, changeType y changeDescription son requeridos' }, 400)
  }

  try {
    let event
    let requestedBy
    if (hasValidInternalSecret(req)) {
      const { data } = await getSupabaseAdmin().from('events').select('id, name').eq('id', eventId).maybeSingle()
      event = data
      requestedBy = { type: 'internal' }
    } else {
      const session = await getSessionContextWithRefresh(req)
      setCookies = session.setCookies
      if (!session.ctx) return respond({ message: 'No autorizado' }, 401)
      if (!EVENT_MANAGER_ROLES.includes(session.ctx.dbUser.role || '')) return respond({ message: 'No autorizado' }, 403)
      event = await getOwnedEvent(eventId, session.ctx.dbUser.organization_id, 'id, name', session.ctx.dbUser.id)
      requestedBy = { type: 'user', userId: session.ctx.dbUser.id, organizationId: session.ctx.dbUser.organization_id }
    }
    if (!event) return respond({ message: 'Evento no encontrado' }, 404)

    const secret = process.env.INTERNAL_API_SECRET
    const origin = functionsOrigin(req)
    if (!secret || !origin) {
      console.error('send-event-notification: falta', !secret ? 'INTERNAL_API_SECRET' : 'origen para la background function')
      return respond({ message: 'Servicio de notificaciones no configurado', queued: false }, 503)
    }

    let status = 0
    try {
      const res = await fetch(`${origin}${BACKGROUND_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({ eventId: event.id, changeType, changeDescription, requestedBy }),
        signal: AbortSignal.timeout(10_000),
      })
      status = res.status
    } catch (err) {
      console.error('send-event-notification: no se pudo encolar', err?.message)
    }

    if (status !== 202 && status !== 200) {
      await notifySlack(`⚠️ No se pudo encolar el aviso "${changeType}" del evento #${event.id} (${String(event.name || '').slice(0, 80)}): status ${status || 'sin respuesta'}`)
      return respond({ message: 'No se pudo encolar la notificación', queued: false }, 502)
    }

    return respond({ message: 'Notificación en cola: los asistentes la recibirán en los próximos minutos', queued: true }, 202)
  } catch (error) {
    console.error('Error en send-event-notification:', error?.message)
    return respond({ message: 'Error interno' }, 500)
  }
}

export const config = {
  path: ['/api/send-event-notification'],
}
