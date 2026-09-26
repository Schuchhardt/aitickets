// POST /api/purchase-ticket (contrato C5)
// Request: { eventId, buyer:{firstName,lastName,email,phone?}, tickets:[{id, quantity}], ref?, utm?:{source,medium,campaign} }
// El precio se calcula SIEMPRE en el servidor desde event_tickets; se ignora cualquier total/precio/evento del cliente.
// Respuesta: pagado -> { paymentLink } (sin orderId: el link /order/<id> da acceso a las entradas y solo
// se entrega por correo / página de retorno de Flow); gratis -> { orderId, redirectUrl: '/order/<orderId>' }
// Antiabuso: Cloudflare Turnstile (body.cfToken, si está configurado), rate limit en memoria por IP y
// máximo MAX_PENDING_PER_BUYER órdenes pendientes simultáneas por comprador + evento.
// GET /api/purchase-ticket -> { turnstileSiteKey } (clave pública para renderizar el widget).
import { getSupabaseAdmin, json } from '../../lib/supabase.mjs'
import { createFlowPayment } from '../../lib/flow.mjs'
import { verifyTurnstile, isTurnstileEnabled, turnstileSiteKey } from '../../lib/turnstile.mjs'
import { isValidEmail } from '../../lib/mailer.mjs'
import { todayInTimeZone, zonedDateTimeToUtc } from '../../lib/dates.mjs'
import {
  TICKET_COLUMNS,
  isTicketOnSale,
  maxPerPurchase,
  computeServiceFee,
  getSoldCounts,
  ensureOrderAttendees,
  PENDING_HOLD_MINUTES,
} from '../../lib/tickets.mjs'
import { sendOrderTicketsEmail } from '../../lib/tickets-email.mjs'
import { isDemoEventSlug } from '../../../src/lib/demoEvent.mjs'

const MAX_TICKET_LINES = 20
const MAX_PENDING_PER_BUYER = 2

// Rate limit best-effort por IP (memoria de la instancia: se reinicia en cold starts y no se comparte
// entre instancias; Turnstile es la barrera principal).
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX_REQUESTS = 20
const rateBuckets = new Map()

function isRateLimited(ip) {
  if (!ip) return false
  const now = Date.now()
  if (rateBuckets.size > 5000) {
    for (const [key, hits] of rateBuckets) if (!hits.length || now - hits[hits.length - 1] > RATE_WINDOW_MS) rateBuckets.delete(key)
  }
  const hits = (rateBuckets.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS)
  hits.push(now)
  rateBuckets.set(ip, hits)
  return hits.length > RATE_MAX_REQUESTS
}

function clientIp(req) {
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    ''
  )
}

const cleanText = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '')
const cleanAttr = (value) => {
  const v = cleanText(value, 100)
  return v ? v.replace(/[^\w.\-+ ]/g, '').slice(0, 100) || null : null
}

function validateRequest(body) {
  const eventId = Number(body?.eventId)
  if (!Number.isInteger(eventId) || eventId <= 0) return { error: 'Evento inválido' }

  const buyer = body?.buyer || {}
  const firstName = cleanText(buyer.firstName, 80)
  const lastName = cleanText(buyer.lastName, 80)
  const email = cleanText(buyer.email, 254).toLowerCase()
  const phone = cleanText(buyer.phone, 30).replace(/[^\d+\s()-]/g, '')
  if (firstName.length < 1) return { error: 'Ingresa tu nombre' }
  if (lastName.length < 1) return { error: 'Ingresa tu apellido' }
  if (!isValidEmail(email)) return { error: 'Ingresa un correo electrónico válido' }

  if (!Array.isArray(body?.tickets) || body.tickets.length === 0 || body.tickets.length > MAX_TICKET_LINES) {
    return { error: 'Selecciona al menos una entrada' }
  }
  const quantities = new Map()
  for (const t of body.tickets) {
    const id = Number(t?.id)
    const quantity = Number(t?.quantity)
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(quantity) || quantity < 0) {
      return { error: 'Selección de entradas inválida' }
    }
    if (quantity === 0) continue
    quantities.set(id, (quantities.get(id) || 0) + quantity)
  }
  if (quantities.size === 0) return { error: 'Selecciona al menos una entrada' }

  const utm = body?.utm && typeof body.utm === 'object' ? body.utm : {}
  return {
    eventId,
    cfToken: typeof body?.cfToken === 'string' ? body.cfToken : '',
    buyer: { firstName, lastName, email, phone: phone || null },
    quantities,
    attribution: {
      ref: cleanAttr(body?.ref),
      utm_source: cleanAttr(utm.source),
      utm_medium: cleanAttr(utm.medium),
      utm_campaign: cleanAttr(utm.campaign),
    },
  }
}

async function findOrCreateAttendee(supabase, buyer) {
  const { data: existing, error: fetchError } = await supabase
    .from('attendees')
    .select('id')
    .eq('email', buyer.email)
    .order('id', { ascending: true })
    .limit(1)
  if (fetchError) throw new Error(`Error buscando asistente: ${fetchError.message}`)
  if (existing?.length) return existing[0].id

  const { data: created, error: insertError } = await supabase
    .from('attendees')
    .insert([{ first_name: buyer.firstName, last_name: buyer.lastName, email: buyer.email, phone: buyer.phone }])
    .select('id')
    .single()
  if (insertError) throw new Error(`Error registrando asistente: ${insertError.message}`)
  return created.id
}

/** Término de una función (America/Santiago): date+end_time (cruza medianoche si end <= start), o start+3h, o fin del día. */
function functionEnd(d) {
  const date = String(d.date || '').slice(0, 10)
  if (!d.start_time) return zonedDateTimeToUtc(date, '23:59:59') || new Date(0)
  const start = zonedDateTimeToUtc(date, d.start_time)
  if (!start) return new Date(0)
  if (!d.end_time) return new Date(start.getTime() + 3 * 60 * 60 * 1000)
  let end = zonedDateTimeToUtc(date, d.end_time)
  if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000)
  return end
}

/** El evento sigue vigente si su end_date no pasó o tiene alguna función de hoy en adelante (C3). */
async function isEventStillOn(supabase, event) {
  if (!event.end_date || new Date(event.end_date) >= new Date()) return true
  const { count } = await supabase
    .from('event_dates')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id)
    .gte('date', todayInTimeZone())
  return (count || 0) > 0
}

export default async function handler(req) {
  if (req.method === 'GET') {
    return json({ turnstileSiteKey: isTurnstileEnabled() ? turnstileSiteKey() : null }, 200)
  }
  if (req.method !== 'POST') return json({ message: 'Método no permitido' }, 405)

  const ip = clientIp(req)
  if (isRateLimited(ip)) {
    return json({ message: 'Demasiados intentos. Espera unos minutos e intenta nuevamente.' }, 429)
  }

  let body
  try {
    body = await req.json()
  } catch {
    return json({ message: 'Solicitud inválida' }, 400)
  }

  const input = validateRequest(body)
  if (input.error) return json({ message: input.error }, 400)
  const { eventId, buyer, quantities, attribution, cfToken } = input

  const captcha = await verifyTurnstile(cfToken, ip)
  if (!captcha.success) return json({ message: captcha.message, captcha: true }, 403)

  try {
    const supabase = getSupabaseAdmin()

    // 1. Evento publicado y vigente
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, name, slug, status, end_date')
      .eq('id', eventId)
      .eq('status', 'published')
      .maybeSingle()
    if (eventError) throw new Error(`Error cargando evento: ${eventError.message}`)
    if (!event) return json({ message: 'El evento no está disponible para la venta' }, 404)
    if (isDemoEventSlug(event.slug)) return json({ message: 'Este es un evento de demostración: no se venden entradas.' }, 403)
    if (!(await isEventStillOn(supabase, event))) return json({ message: 'Este evento ya finalizó' }, 409)

    // 2. Tipos de entrada: deben pertenecer al evento y estar a la venta (C2)
    const ticketIds = [...quantities.keys()]
    const { data: tickets, error: ticketsError } = await supabase
      .from('event_tickets')
      .select(TICKET_COLUMNS)
      .eq('event_id', eventId)
      .in('id', ticketIds)
    if (ticketsError) throw new Error(`Error cargando entradas: ${ticketsError.message}`)

    const byId = new Map((tickets || []).map(t => [Number(t.id), t]))
    const now = new Date()
    for (const [id, qty] of quantities) {
      const ticket = byId.get(id)
      if (!ticket || !isTicketOnSale(ticket, now)) {
        return json({ message: 'Una de las entradas seleccionadas ya no está a la venta' }, 409)
      }
      const max = maxPerPurchase(ticket)
      if (qty > max) {
        return json({ message: `Puedes comprar como máximo ${max} entrada(s) de "${ticket.ticket_name}" por compra` }, 400)
      }
    }

    // 2b. R1: entradas de una función específica -> la función debe ser de este evento y no haber terminado
    const functionIds = [...new Set((tickets || []).map(t => t.event_date_id).filter(v => v != null).map(Number))]
    if (functionIds.length) {
      const { data: fnDates, error: fnError } = await supabase
        .from('event_dates')
        .select('id, date, start_time, end_time')
        .eq('event_id', eventId)
        .in('id', functionIds)
      if (fnError) throw new Error(`Error cargando funciones: ${fnError.message}`)
      const validFns = new Set((fnDates || []).filter(d => functionEnd(d) >= now).map(d => Number(d.id)))
      if (functionIds.some(id => !validFns.has(id))) {
        return json({ message: 'Una de las funciones seleccionadas ya no está disponible' }, 409)
      }
    }

    // 3. Stock (total_quantity NULL = ilimitado)
    const limited = ticketIds.filter(id => byId.get(id).total_quantity != null)
    const stockError = async () => {
      if (!limited.length) return null
      const sold = await getSoldCounts(supabase, eventId, limited)
      for (const id of limited) {
        const ticket = byId.get(id)
        const available = Number(ticket.total_quantity) - (sold.get(id) || 0)
        if (available < 0) return `"${ticket.ticket_name}" está agotada`
      }
      return null
    }
    if (limited.length) {
      const sold = await getSoldCounts(supabase, eventId, limited)
      for (const id of limited) {
        const ticket = byId.get(id)
        const available = Number(ticket.total_quantity) - (sold.get(id) || 0)
        if (quantities.get(id) > available) {
          return json({
            message: available > 0
              ? `Solo quedan ${available} entrada(s) de "${ticket.ticket_name}"`
              : `"${ticket.ticket_name}" está agotada`,
          }, 409)
        }
      }
    }

    // 4. Precio calculado en el servidor
    const ticketDetails = ticketIds.map(id => {
      const ticket = byId.get(id)
      const price = Math.round(Number(ticket.price) || 0)
      const quantity = quantities.get(id)
      return { id, name: ticket.ticket_name, price, quantity, total: price * quantity, event_date_id: ticket.event_date_id ?? null }
    })
    const subtotal = ticketDetails.reduce((sum, t) => sum + t.total, 0)
    const fee = computeServiceFee(subtotal)
    const total = subtotal + fee
    const ticketQty = ticketDetails.reduce((sum, t) => sum + t.quantity, 0)

    const attendeeId = await findOrCreateAttendee(supabase, buyer)

    // 4b. Máximo de órdenes pendientes simultáneas por comprador + evento (evita acaparar stock)
    const holdSince = new Date(Date.now() - PENDING_HOLD_MINUTES * 60 * 1000).toISOString()
    const { count: pendingCount, error: pendingError } = await supabase
      .from('event_orders')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('attendee_id', attendeeId)
      .eq('status', 'pending')
      .gte('created_at', holdSince)
    if (pendingError) throw new Error(`Error revisando órdenes pendientes: ${pendingError.message}`)
    if ((pendingCount || 0) >= MAX_PENDING_PER_BUYER) {
      return json({
        message: `Ya tienes ${pendingCount} pagos pendientes para este evento. Complétalos o espera ${PENDING_HOLD_MINUTES} minutos para intentarlo de nuevo.`,
      }, 429)
    }

    const baseOrder = {
      event_id: eventId,
      attendee_id: attendeeId,
      amount: subtotal,
      ticket_fee: fee,
      ticket_qty: ticketQty,
      ticket_details: ticketDetails,
      // R2: datos del comprador de esta orden (attendees se comparte por email)
      buyer_first_name: buyer.firstName,
      buyer_last_name: buyer.lastName,
      buyer_email: buyer.email,
      buyer_phone: buyer.phone,
      ...attribution,
    }

    // 5. Se inserta la orden como 'pending' (reserva stock) y se vuelve a contar: si dos compras
    //    concurrentes se llevaron las últimas entradas, esta se marca 'failed' (chequeo optimista).
    //    TODO: reemplazar por una función SECURITY DEFINER con bloqueo por event_ticket (ver reporte).
    const { data: order, error: orderError } = await supabase
      .from('event_orders')
      .insert([{ ...baseOrder, status: 'pending', total_payment: total === 0 ? 0 : null }])
      .select('id, event_id, attendee_id, ticket_details')
      .single()
    if (orderError) throw new Error(`Error creando orden: ${orderError.message}`)

    const oversold = await stockError()
    if (oversold) {
      await supabase.from('event_orders').update({ status: 'failed' }).eq('id', order.id).eq('status', 'pending')
      console.warn(`Orden ${order.id}: sobreventa detectada al re-contar (${oversold}); marcada failed`)
      return json({ message: 'Se agotaron las entradas mientras completabas tu compra. Revisa la disponibilidad e intenta nuevamente.' }, 409)
    }

    // 5a. Orden gratis: pagada por $0 + una entrada por unidad + correo
    if (total === 0) {
      try {
        await ensureOrderAttendees(supabase, order)
      } catch (err) {
        await supabase.from('event_orders').delete().eq('id', order.id)
        throw err
      }
      const { error: paidError } = await supabase.from('event_orders').update({ status: 'paid' }).eq('id', order.id)
      if (paidError) throw new Error(`Error confirmando orden gratis: ${paidError.message}`)

      const emailResult = await sendOrderTicketsEmail(order.id)
      if (!emailResult.ok) console.error(`Orden gratis ${order.id}: no se pudo enviar el correo (${emailResult.status})`)

      console.log(`🎟️ Orden gratis ${order.id} evento ${eventId}: ${ticketQty} entrada(s)`)
      return json({ orderId: order.id, redirectUrl: `/order/${order.id}`, message: 'Registro completado' }, 200)
    }

    // 5b. Orden pagada: pendiente hasta que Flow confirme en /api/payment-confirmation
    const siteUrl = (process.env.SITE_URL || new URL(req.url).origin).replace(/\/$/, '')
    let payment
    try {
      payment = await createFlowPayment({
        commerceOrder: order.id,
        subject: `${ticketQty === 1 ? '1 entrada' : `${ticketQty} entradas`} - ${event.name}`,
        amount: total,
        email: buyer.email,
        urlConfirmation: `${siteUrl}/api/payment-confirmation`,
        urlReturn: `${siteUrl}/payment-confirmation`,
        // El pago expira cuando se libera la reserva de stock de la orden pendiente
        timeoutSeconds: PENDING_HOLD_MINUTES * 60,
      })
    } catch (err) {
      await supabase.from('event_orders').update({ status: 'failed' }).eq('id', order.id)
      console.error(`Flow payment/create falló para la orden ${order.id}:`, err.message)
      return json({ message: 'No pudimos iniciar el pago. Intenta nuevamente en unos minutos.' }, 502)
    }

    const { error: updateError } = await supabase
      .from('event_orders')
      .update({ payment_external_id: payment.flowOrder != null ? String(payment.flowOrder) : null })
      .eq('id', order.id)
    if (updateError) console.error(`No se pudo guardar flowOrder en la orden ${order.id}:`, updateError.message)

    console.log(`💳 Orden ${order.id} evento ${eventId}: ${ticketQty} entrada(s), total ${total}`)
    return json({ paymentLink: `${payment.url}?token=${payment.token}`, message: 'Redirigiendo a pago' }, 200)
  } catch (error) {
    console.error('Error en purchase-ticket:', error?.message)
    return json({ message: 'Ha ocurrido un error. Por favor intenta más tarde.' }, 500)
  }
}

export const config = {
  path: ['/api/purchase-ticket'],
}
