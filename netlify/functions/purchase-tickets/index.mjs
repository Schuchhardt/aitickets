// POST /api/purchase-ticket (contrato C5 + WP2)
// Request: { eventId, buyer:{firstName,lastName,email,phone?}, tickets:[{id, quantity}], ref?, utm?:{source,medium,campaign},
//            paymentProvider?: (ignorado, siempre Flow), termsAccepted: true, termsVersion?: string, cfToken?, discountCode?: string }
// Código de descuento (netlify/lib/discounts.mjs): se valida en el servidor (organización y evento, vigencia, usos y
// límite por comprador) y se aplica al subtotal de entradas; el cargo por servicio se calcula sobre el subtotal
// descontado. event_orders.amount guarda el subtotal descontado (lo que recibe el productor) y discount_amount el
// descuento. El límite de usos definitivo lo aplica aitickets_reserve_order_v2 con la fila del código bloqueada.
// Errores de código: { message, discountError: true, reason }.
// El precio se calcula SIEMPRE en el servidor desde event_tickets; se ignora cualquier total/precio/evento del cliente.
// Respuesta: pagado -> { paymentLink, provider, orderId }; gratis -> { orderId, redirectUrl: '/order/<orderId>', provider: 'free' }
// Stock: la reserva es ATÓMICA en SQL (aitickets_reserve_order bloquea los tipos de entrada y recuenta);
// la orden 'pending' reserva stock hasta hold_expires_at (15 min).
// Antiabuso: Cloudflare Turnstile (body.cfToken, si está configurado), rate limit por IP (memoria de la
// instancia + durable en la BD vía netlify/lib/rate-limit.mjs), rate limit durable por email del comprador y
// máximo MAX_PENDING_PER_BUYER órdenes pendientes simultáneas por comprador + evento.
// GET /api/purchase-ticket -> { turnstileSiteKey, enabledProviders } (datos públicos para el checkout).
import { getSupabaseAdmin, json } from '../../lib/supabase.mjs'
import { enabledProviders, defaultProvider, createCheckout, holdMinutesFor } from '../../lib/payments/index.mjs'
import { isMissingSchemaError } from '../../lib/orders.mjs'
import { TERMS_VERSION } from '../../lib/legal.mjs'
import { verifyTurnstile, isTurnstileEnabled, turnstileSiteKey } from '../../lib/turnstile.mjs'
import { isValidEmail } from '../../lib/mailer.mjs'
import { todayInTimeZone, zonedDateTimeToUtc } from '../../lib/dates.mjs'
import {
  TICKET_COLUMNS,
  isTicketOnSale,
  maxPerPurchase,
  getSoldCounts,
  ensureOrderAttendees,
  PENDING_HOLD_MINUTES,
} from '../../lib/tickets.mjs'
import { sendOrderTicketsEmail } from '../../lib/tickets-email.mjs'
import { rateLimit } from '../../lib/rate-limit.mjs'
import {
  normalizeDiscountCode,
  resolveDiscount,
  computeDiscountedTotals,
  discountReasonFromRpcError,
  isMissingDiscountSchema,
  DISCOUNT_MESSAGES,
  DISCOUNT_STATUS,
} from '../../lib/discounts.mjs'
import { isDemoEventSlug } from '../../../src/lib/demoEvent.mjs'

const MAX_TICKET_LINES = 20
const MAX_PENDING_PER_BUYER = 2

// Rate limit best-effort por IP (memoria de la instancia: se reinicia en cold starts y no se comparte
// entre instancias; Turnstile es la barrera principal).
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX_REQUESTS = 20
const rateBuckets = new Map()

// Límites durables (compartidos entre instancias; fallan abierto si la BD no responde)
const DURABLE_LIMITS = {
  ip: { bucket: 'purchase:ip', windowSeconds: 10 * 60, max: 30 },
  email: { bucket: 'purchase:email', windowSeconds: 60 * 60, max: 15 },
}
const TOO_MANY = 'Demasiados intentos. Espera unos minutos e intenta nuevamente.'

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

  if (body?.termsAccepted !== true) return { error: 'Debes aceptar los Términos y Condiciones para continuar' }
  const termsVersion = cleanText(body?.termsVersion, 20).replace(/[^\w.\-]/g, '') || TERMS_VERSION

  // Flow (Webpay) es el único medio de pago: se ignora body.paymentProvider (clientes antiguos pueden enviarlo).
  const paymentProvider = defaultProvider()

  // Código de descuento opcional: vacío = sin código
  const rawDiscount = typeof body?.discountCode === 'string' ? body.discountCode.trim() : ''
  let discountCode = null
  if (rawDiscount) {
    discountCode = normalizeDiscountCode(rawDiscount)
    if (!discountCode) return { error: DISCOUNT_MESSAGES.invalid_format, discountError: 'invalid_format' }
  }

  const utm = body?.utm && typeof body.utm === 'object' ? body.utm : {}
  return {
    eventId,
    discountCode,
    paymentProvider,
    termsVersion,
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

/** Órdenes pendientes con reserva vigente de un comprador en un evento. */
async function countLivePendingOrders(supabase, eventId, attendeeId) {
  const nowIso = new Date().toISOString()
  const legacySince = new Date(Date.now() - PENDING_HOLD_MINUTES * 60 * 1000).toISOString()
  let { count, error } = await supabase
    .from('event_orders')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('attendee_id', attendeeId)
    .eq('status', 'pending')
    .or(`hold_expires_at.gt.${nowIso},and(hold_expires_at.is.null,created_at.gte.${legacySince})`)
  // HEAD sin cuerpo: PostgREST no siempre entrega el código de error; ante cualquier error se reintenta sin hold_expires_at
  if (error) {
    ;({ count, error } = await supabase
      .from('event_orders')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('attendee_id', attendeeId)
      .eq('status', 'pending')
      .gte('created_at', legacySince))
  }
  if (error) throw new Error(`Error revisando órdenes pendientes: ${error.message}`)
  return count || 0
}

/** Traduce los errores del RPC ('SOLD_OUT:<id>' / 'TICKET_UNAVAILABLE:<id>') a un error con .stock. */
function stockErrorFrom(error) {
  const m = /\b(SOLD_OUT|TICKET_UNAVAILABLE):(\d+)/.exec(String(error?.message || ''))
  if (!m) return null
  const err = new Error(m[1])
  err.stock = m[1]
  err.ticketId = Number(m[2])
  return err
}

/**
 * Reserva la orden con aitickets_reserve_order (atómico). Si el RPC no existe (deploy preview contra una
 * base sin migrar) usa el camino antiguo: insertar 'pending' y re-contar (chequeo optimista).
 * @returns {Promise<{id:string, event_id:number, attendee_id:number, ticket_details:any}>}
 */
async function reserveOrder(supabase, { eventId, lines, order, holdMinutes, baseOrder, limited, discount = null }) {
  // Con código: aitickets_reserve_order_v2 bloquea el código, revalida usos y reserva en la misma transacción.
  const { data: orderId, error } = discount
    ? await supabase.rpc('aitickets_reserve_order_v2', {
        p_event_id: eventId,
        p_lines: lines,
        p_order: order,
        p_hold_minutes: holdMinutes,
        p_discount_code_id: discount.id,
        p_discount_amount: discount.amount,
      })
    : await supabase.rpc('aitickets_reserve_order', {
        p_event_id: eventId,
        p_lines: lines,
        p_order: order,
        p_hold_minutes: holdMinutes,
      })
  if (!error && orderId) {
    return { id: orderId, event_id: eventId, attendee_id: order.attendee_id, ticket_details: order.ticket_details }
  }
  const stockErr = stockErrorFrom(error)
  if (stockErr) throw stockErr
  if (discount) {
    const reason = discountReasonFromRpcError(error) || (isMissingDiscountSchema(error) ? 'unavailable' : null)
    if (reason) throw Object.assign(new Error(reason), { discountReason: reason })
    throw new Error(`Error reservando la orden con descuento: ${error?.message || 'sin id'}`)
  }
  if (!isMissingSchemaError(error)) throw new Error(`Error reservando la orden: ${error?.message || 'sin id'}`)

  console.warn('aitickets_reserve_order no disponible; usando reserva optimista antigua')
  const insertOrder = row => supabase
    .from('event_orders')
    .insert([row])
    .select('id, event_id, attendee_id, ticket_details')
    .single()
  let { data: inserted, error: insertError } = await insertOrder({ ...baseOrder, status: 'pending' })
  if (insertError && isMissingSchemaError(insertError) && 'service_fee_tax' in baseOrder) {
    // Base sin la columna service_fee_tax (202609290100): la orden se guarda sin el IVA separado.
    const { service_fee_tax: _tax, ...rest } = baseOrder
    ;({ data: inserted, error: insertError } = await insertOrder({ ...rest, status: 'pending' }))
  }
  if (insertError) throw new Error(`Error creando orden: ${insertError.message}`)
  if (limited.length) {
    const sold = await getSoldCounts(supabase, eventId, limited)
    const { data: tickets } = await supabase.from('event_tickets').select('id, total_quantity').eq('event_id', eventId).in('id', limited)
    const over = (tickets || []).find(t => Number(t.total_quantity) - (sold.get(Number(t.id)) || 0) < 0)
    if (over) {
      await supabase.from('event_orders').update({ status: 'failed' }).eq('id', inserted.id).eq('status', 'pending')
      const err = new Error('SOLD_OUT')
      err.stock = 'SOLD_OUT'
      err.ticketId = Number(over.id)
      throw err
    }
  }
  return inserted
}

export default async function handler(req) {
  if (req.method === 'GET') {
    return json({
      turnstileSiteKey: isTurnstileEnabled() ? turnstileSiteKey() : null,
      enabledProviders: enabledProviders(),
    }, 200)
  }
  if (req.method !== 'POST') return json({ message: 'Método no permitido' }, 405)

  const ip = clientIp(req)
  if (isRateLimited(ip)) {
    return json({ message: TOO_MANY }, 429)
  }
  const byIp = await rateLimit(DURABLE_LIMITS.ip.bucket, ip, DURABLE_LIMITS.ip)
  if (!byIp.allowed) return json({ message: TOO_MANY }, 429)

  let body
  try {
    body = await req.json()
  } catch {
    return json({ message: 'Solicitud inválida' }, 400)
  }

  const input = validateRequest(body)
  if (input.error) {
    return json(input.discountError ? { message: input.error, discountError: true, reason: input.discountError } : { message: input.error }, 400)
  }
  const { eventId, buyer, quantities, attribution, cfToken, paymentProvider, termsVersion, discountCode } = input

  const captcha = await verifyTurnstile(cfToken, ip)
  if (!captcha.success) return json({ message: captcha.message, captcha: true }, 403)

  // Solo después del captcha: si no, cualquiera que conozca el correo de un comprador podría agotar
  // su cupo con solicitudes sin token y bloquearlo durante una venta.
  const byEmail = await rateLimit(DURABLE_LIMITS.email.bucket, buyer.email, DURABLE_LIMITS.email)
  if (!byEmail.allowed) return json({ message: TOO_MANY }, 429)

  try {
    const supabase = getSupabaseAdmin()

    // 1. Evento publicado y vigente
    const loadEvent = cols => supabase
      .from('events')
      .select(cols)
      .eq('id', eventId)
      .eq('status', 'published')
      .maybeSingle()
    let { data: event, error: eventError } = await loadEvent('id, name, slug, status, end_date, organization_id, fee_absorbed')
    if (eventError && isMissingSchemaError(eventError)) {
      // Base sin events.fee_absorbed (202610090200): el comprador paga el cargo, como siempre
      ;({ data: event, error: eventError } = await loadEvent('id, name, slug, status, end_date, organization_id'))
    }
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

    // 3. Pre-chequeo de stock (solo para dar un mensaje claro; la reserva atómica del paso 5 es la que manda)
    const limited = ticketIds.filter(id => byId.get(id).total_quantity != null)
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
    const grossSubtotal = ticketDetails.reduce((sum, t) => sum + t.total, 0)

    // 4a. Código de descuento (validado aquí; el límite de usos definitivo lo aplica la reserva atómica)
    let discount = null
    if (discountCode) {
      const result = await resolveDiscount(supabase, { event, code: discountCode, grossSubtotal, buyerEmail: buyer.email, now })
      if (!result.ok) return json({ message: result.message, discountError: true, reason: result.reason }, result.status)
      discount = result.discount
    }

    // Cargo por servicio (fees.mjs) + IVA de ese cargo, sobre el subtotal YA descontado; se cobra el total con IVA.
    // subtotal = lo que recibe el productor (event_orders.amount).
    // Cargo absorbido por el productor (events.fee_absorbed): se cobra solo el subtotal y amount = subtotal - cargo - IVA.
    const feeAbsorbed = event.fee_absorbed === true
    const { discountAmount, subtotal, feeNet, feeIva, fee, total, producerNet } = computeDiscountedTotals(grossSubtotal, discount, { feeAbsorbed })
    if (discount) discount.amount = discountAmount
    const ticketQty = ticketDetails.reduce((sum, t) => sum + t.quantity, 0)
    const provider = total === 0 ? 'free' : paymentProvider
    const holdMinutes = total === 0 ? PENDING_HOLD_MINUTES : holdMinutesFor(provider)

    // Asistente antes de reservar (event_orders.attendee_id es NOT NULL)
    const attendeeId = await findOrCreateAttendee(supabase, buyer)

    // 4b. Máximo de órdenes pendientes simultáneas por comprador + evento (evita acaparar stock)
    const pendingCount = await countLivePendingOrders(supabase, eventId, attendeeId)
    if (pendingCount >= MAX_PENDING_PER_BUYER) {
      return json({
        message: `Ya tienes ${pendingCount} pagos pendientes para este evento. Complétalos o espera ${holdMinutes} minutos para intentarlo de nuevo.`,
      }, 429)
    }

    const baseOrder = {
      event_id: eventId,
      attendee_id: attendeeId,
      amount: feeAbsorbed ? producerNet : subtotal,
      ticket_fee: feeNet,
      service_fee_tax: feeIva,
      ticket_qty: ticketQty,
      ticket_details: ticketDetails,
      total_payment: total === 0 ? 0 : null,
      // R2: datos del comprador de esta orden (attendees se comparte por email)
      buyer_first_name: buyer.firstName,
      buyer_last_name: buyer.lastName,
      buyer_email: buyer.email,
      buyer_phone: buyer.phone,
      ...attribution,
    }

    // 5. Reserva atómica (orden 'pending' con hold_expires_at). Gratis también pasa por aquí.
    let order
    try {
      order = await reserveOrder(supabase, {
        eventId,
        lines: ticketDetails.map(t => ({ id: t.id, quantity: t.quantity })),
        order: { ...baseOrder, payment_provider: provider, currency: 'CLP', terms_version: termsVersion },
        holdMinutes,
        baseOrder,
        limited,
        discount,
      })
    } catch (err) {
      if (err?.discountReason) {
        const reason = err.discountReason
        return json({ message: DISCOUNT_MESSAGES[reason] || DISCOUNT_MESSAGES.not_found, discountError: true, reason }, DISCOUNT_STATUS[reason] || 409)
      }
      if (err?.stock) {
        const ticket = err.ticketId != null ? byId.get(Number(err.ticketId)) : null
        if (err.stock === 'SOLD_OUT') {
          return json({
            message: ticket
              ? `"${ticket.ticket_name}" se agotó mientras completabas tu compra. Revisa la disponibilidad e intenta nuevamente.`
              : 'Se agotaron las entradas mientras completabas tu compra. Revisa la disponibilidad e intenta nuevamente.',
          }, 409)
        }
        return json({ message: 'Una de las entradas seleccionadas ya no está a la venta' }, 409)
      }
      throw err
    }

    // Cargo absorbido: la reserva atómica no conoce la columna; se marca la orden aparte (antes del pago).
    if (feeAbsorbed && total > 0) {
      const { error: absorbedError } = await supabase.from('event_orders').update({ fee_absorbed: true }).eq('id', order.id)
      if (absorbedError) console.error(`No se pudo marcar fee_absorbed en la orden ${order.id}:`, absorbedError.message)
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
      return json({ orderId: order.id, redirectUrl: `/order/${order.id}`, provider: 'free', message: 'Registro completado' }, 200)
    }

    // 5b. Orden pagada: pendiente hasta que el proveedor confirme por webhook
    //     (/api/payment-confirmation)
    const siteUrl = (process.env.SITE_URL || new URL(req.url).origin).replace(/\/$/, '')
    let checkout
    try {
      checkout = await createCheckout(provider, {
        order: { id: order.id, ticket_fee: feeNet, service_fee_tax: feeIva },
        eventName: event.name,
        lines: ticketDetails,
        ticketQty,
        subtotal,
        fee,
        feeNet,
        feeIva,
        total,
        buyerEmail: buyer.email,
        siteUrl,
        holdMinutes,
      })
    } catch (err) {
      await supabase.from('event_orders').update({ status: 'failed' }).eq('id', order.id).eq('status', 'pending')
      console.error(`${provider} checkout falló para la orden ${order.id}:`, err?.message)
      return json({ message: 'No pudimos iniciar el pago. Intenta nuevamente en unos minutos.' }, 502)
    }

    const { error: updateError } = await supabase.from('event_orders').update({ payment_external_id: checkout.externalId ?? null }).eq('id', order.id)
    if (updateError) console.error(`No se pudo guardar la referencia de pago en la orden ${order.id}:`, updateError.message)

    console.log(`💳 Orden ${order.id} evento ${eventId}: ${ticketQty} entrada(s), total ${total}, ${provider}`)
    return json({ paymentLink: checkout.redirectUrl, provider, orderId: order.id, message: 'Redirigiendo a pago' }, 200)
  } catch (error) {
    console.error('Error en purchase-ticket:', error?.message)
    return json({ message: 'Ha ocurrido un error. Por favor intenta más tarde.' }, 500)
  }
}

export const config = {
  path: ['/api/purchase-ticket'],
}
