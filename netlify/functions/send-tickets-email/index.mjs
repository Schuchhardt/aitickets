// POST /api/send-tickets-email (contrato C6)
// Solo llamadas servidor→servidor con header `x-internal-secret: $INTERNAL_API_SECRET`.
// Body: { orderId, force? }. Idempotente vía event_orders.email_sent_at salvo force=true (reenvío).
import { hasValidInternalSecret, json } from '../../lib/supabase.mjs'
import { sendOrderTicketsEmail } from '../../lib/tickets-email.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req) {
  if (req.method !== 'POST') return json({ message: 'Método no permitido' }, 405)
  if (!hasValidInternalSecret(req)) return json({ message: 'No autorizado' }, 401)

  let body
  try {
    body = await req.json()
  } catch {
    return json({ message: 'Solicitud inválida' }, 400)
  }

  const orderId = String(body?.orderId || '')
  if (!UUID_RE.test(orderId)) return json({ message: 'ID de orden requerido' }, 400)

  const result = await sendOrderTicketsEmail(orderId, { force: body?.force === true })
  switch (result.status) {
    case 'sent':
      return json({ message: 'Email enviado exitosamente', orderId }, 200)
    case 'already_sent':
      return json({ message: 'El email ya había sido enviado', orderId, alreadySent: true }, 200)
    case 'not_found':
      return json({ message: 'Orden no encontrada' }, 404)
    case 'not_paid':
      return json({ message: 'La orden no está pagada' }, 409)
    default:
      return json({ message: 'Error enviando email' }, 500)
  }
}

export const config = {
  path: ['/api/send-tickets-email'],
}
