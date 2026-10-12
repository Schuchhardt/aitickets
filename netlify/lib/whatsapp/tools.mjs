// Herramientas del bot de WhatsApp. Cada una recibe los argumentos del modelo y un contexto del SERVIDOR
// ({supabase, conversation}): la identidad (teléfono de WhatsApp) nunca viene del modelo.
//
// Privacidad de compras:
// - mis_compras solo lista órdenes cuyo teléfono coincide con el número de WhatsApp que escribe
//   (WhatsApp ya verificó que la persona controla ese número). Nunca devuelve links de órdenes ni QR.
// - reenviar_entradas SIEMPRE envía al correo registrado en la orden (sendOrderTicketsEmail), nunca a otro.
//   Por correo responde lo mismo exista o no la compra (no revela si un correo compró).
import { loadEventContext, eventInfoText, feeRuleText, stripHtml } from '../event-context.mjs'
import { TICKET_COLUMNS, isTicketOnSale } from '../tickets.mjs'
import { isDemoEventSlug } from '../../../src/lib/demoEvent.mjs'
import { EVENT_TIMEZONE, EVENT_DATE_COLUMNS, todayInTimeZone, formatFunctionLabel, formatEventLocation, formatInstantLong } from '../dates.mjs'
import { SITE_URL, isValidEmail } from '../mailer.mjs'
import { sendOrderTicketsEmail } from '../tickets-email.mjs'
import { rateLimit } from '../rate-limit.mjs'
import { notifySlack } from '../slack.mjs'
import { createInboundLead } from '../outreach/sources/inbound.mjs'
import { pauseBot, setConversationLead, HUMAN_PAUSE_HOURS } from './store.mjs'

const MAX_SEARCH_RESULTS = 8
const SEARCH_POOL = 300

export const eventUrl = (slug) => `${SITE_URL}/eventos/${encodeURIComponent(slug)}`
const clp = (n) => `$${Math.round(n).toLocaleString('es-CL')}`
const clip = (v, n) => String(v ?? '').trim().slice(0, n)
const MISSING_COLUMN = ['42703', 'PGRST204']

/** minúsculas y sin tildes, para comparar búsquedas. */
export const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const TOOL_DEFINITIONS = [
  {
    name: 'buscar_eventos',
    description: 'Busca eventos públicos próximos que se venden en AI Tickets. Úsala cuando la persona quiere encontrar eventos (por nombre, artista, tipo, ciudad o fechas). Sin filtros devuelve los próximos eventos.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Palabras clave: nombre del evento, artista, tipo (ej. "stand up", "jazz", "feria").' },
        ciudad: { type: 'string', description: 'Ciudad o comuna (ej. "Santiago", "Valparaíso").' },
        desde: { type: 'string', description: 'Fecha mínima YYYY-MM-DD (hora de Chile).' },
        hasta: { type: 'string', description: 'Fecha máxima YYYY-MM-DD (hora de Chile).' },
      },
    },
  },
  {
    name: 'ver_evento',
    description: 'Devuelve la ficha completa de un evento publicado: descripción, funciones, lugar, entradas a la venta con precio total y preguntas frecuentes. Acepta el slug, el link aitickets.cl/eventos/... o el ID.',
    input_schema: {
      type: 'object',
      properties: { evento: { type: 'string', description: 'Slug, URL del evento o ID numérico.' } },
      required: ['evento'],
    },
  },
  {
    name: 'mis_compras',
    description: 'Lista las compras pagadas asociadas al número de WhatsApp de esta conversación (evento, fecha, cantidad de entradas y correo enmascarado). Úsala cuando la persona pregunta por sus entradas o su compra.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'reenviar_entradas',
    description: 'Reenvía el correo con las entradas (QR) al correo registrado en la compra. Usa "referencia" para una compra de mis_compras, o "correo" si la persona compró con otro teléfono: en ese caso se reenvían las compras pagadas de ese correo, siempre a ese mismo correo.',
    input_schema: {
      type: 'object',
      properties: {
        referencia: { type: 'string', description: 'Referencia de la compra (de mis_compras).' },
        correo: { type: 'string', description: 'Correo con el que la persona hizo la compra.' },
      },
    },
  },
  {
    name: 'preguntar_a_productora',
    description: 'Envía a la productora de un evento una pregunta cuya respuesta no está en la ficha. La productora responde por correo. Requiere nombre y correo de la persona.',
    input_schema: {
      type: 'object',
      properties: {
        evento_id: { type: 'integer', description: 'ID del evento (de ver_evento o buscar_eventos).' },
        pregunta: { type: 'string' },
        nombre: { type: 'string' },
        correo: { type: 'string' },
      },
      required: ['evento_id', 'pregunta', 'nombre', 'correo'],
    },
  },
  {
    name: 'derivar_a_persona',
    description: 'Pasa la conversación a una persona del equipo de AI Tickets y deja de responder automáticamente. Úsala para reembolsos, cambios de nombre o de fecha, cobros duplicados o erróneos, problemas de pago, reclamos, cuando la persona lo pide explícitamente, o cuando no puedes resolver el problema.',
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', enum: ['reembolso', 'pago', 'entradas', 'evento', 'productor', 'reclamo', 'otro'] },
        resumen: { type: 'string', description: 'Resumen del caso para el equipo: qué necesita, evento, correo, referencia de compra si la hay.' },
      },
      required: ['motivo', 'resumen'],
    },
  },
  {
    name: 'registrar_productor',
    description: 'Registra a un productor u organizador de eventos que quiere que el equipo comercial de AI Tickets lo contacte. Úsala solo cuando la persona entregó al menos su nombre y correo y aceptó ser contactada.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        correo: { type: 'string' },
        productora: { type: 'string', description: 'Nombre de la productora, sala o marca.' },
        ciudad: { type: 'string' },
        evento: { type: 'string', description: 'Evento que quiere vender (nombre, fecha aproximada, aforo).' },
        notas: { type: 'string', description: 'Ticketera actual, volumen, dudas u otros detalles útiles para ventas.' },
      },
      required: ['nombre', 'correo'],
    },
  },
]

// ---------- buscar_eventos ----------

async function loadPublicEvents(supabase) {
  const base = 'id, slug, name, title, description, location, start_date, end_date, accessibility'
  const run = (cols) => supabase.from('events').select(cols).eq('status', 'published').not('slug', 'is', null).order('start_date', { ascending: true }).limit(SEARCH_POOL)
  let { data, error } = await run(`${base}, archived_at, cancelled_at`)
  // Base sin archived_at/cancelled_at (202610090200)
  if (error && MISSING_COLUMN.includes(String(error.code || ''))) ({ data, error } = await run(base))
  if (error) throw new Error(`events: ${error.message}`)
  return (data || []).filter((e) =>
    (e.accessibility == null || e.accessibility === 'public') &&
    !e.archived_at && !e.cancelled_at &&
    !isDemoEventSlug(e.slug))
}

const validDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)

export async function buscarEventos({ supabase }, args = {}) {
  const today = todayInTimeZone()
  const from = validDate(args.desde) && args.desde > today ? args.desde : today
  const to = validDate(args.hasta)
  const events = await loadPublicEvents(supabase)
  if (!events.length) return { resultados: [], nota: 'No hay eventos publicados en este momento.' }

  const ids = events.map((e) => e.id)
  const [{ data: dates, error: datesError }, { data: tags }] = await Promise.all([
    supabase.from('event_dates').select(`event_id, ${EVENT_DATE_COLUMNS}`).in('event_id', ids).gte('date', today).order('date', { ascending: true }).order('start_time', { ascending: true }),
    supabase.from('event_tags').select('event_id, category_tags(name)').in('event_id', ids),
  ])
  if (datesError) throw new Error(`event_dates: ${datesError.message}`)
  const datesBy = new Map()
  for (const d of dates || []) {
    if (!datesBy.has(d.event_id)) datesBy.set(d.event_id, [])
    datesBy.get(d.event_id).push(d)
  }
  const tagsBy = new Map()
  for (const t of tags || []) {
    const name = t.category_tags?.name
    if (name) tagsBy.set(t.event_id, [...(tagsBy.get(t.event_id) || []), name])
  }

  const words = normalize(args.texto).split(/\s+/).filter((w) => w.length > 1)
  const city = normalize(args.ciudad).trim()

  const matches = []
  for (const e of events) {
    let eventDates = (datesBy.get(e.id) || []).filter((d) => d.date >= from && (!to || d.date <= to))
    const hasAnyDates = (datesBy.get(e.id) || []).length > 0
    // Eventos sin funciones en event_dates: se usa start_date/end_date
    if (!hasAnyDates) {
      if (!e.start_date) continue
      const dayOf = (iso) => todayInTimeZone(EVENT_TIMEZONE, new Date(iso))
      const startDay = dayOf(e.start_date)
      const endDay = dayOf(e.end_date || e.start_date)
      if (endDay < from || (to && startDay > to)) continue
    } else if (!eventDates.length) continue

    const places = eventDates.map((d) => formatEventLocation(d.event_locations)).filter(Boolean)
    const tagNames = tagsBy.get(e.id) || []
    if (city && !normalize([e.location, ...places].join(' ')).includes(city)) continue
    if (words.length) {
      const haystack = normalize([e.name, e.title, stripHtml(e.description).slice(0, 2000), e.location, ...places, ...tagNames].join(' '))
      const hits = words.filter((w) => haystack.includes(w)).length
      if (!hits) continue
      e._score = hits
    }
    matches.push({ e, eventDates, places, tagNames })
  }
  if (words.length) matches.sort((a, b) => (b.e._score || 0) - (a.e._score || 0))
  const top = matches.slice(0, MAX_SEARCH_RESULTS)

  const minPrice = new Map()
  if (top.length) {
    const { data: tickets } = await supabase.from('event_tickets').select(TICKET_COLUMNS).in('event_id', top.map((m) => m.e.id))
    const now = new Date()
    for (const t of tickets || []) {
      if (!isTicketOnSale(t, now)) continue
      const price = Math.round(Number(t.price) || 0)
      const prev = minPrice.get(Number(t.event_id))
      if (prev === undefined || price < prev) minPrice.set(Number(t.event_id), price)
    }
  }

  return {
    total_encontrados: matches.length,
    resultados: top.map(({ e, eventDates, places, tagNames }) => {
      const price = minPrice.get(Number(e.id))
      return {
        id: e.id,
        nombre: e.name,
        funciones: eventDates.length
          ? eventDates.slice(0, 3).map((d) => formatFunctionLabel(d)).concat(eventDates.length > 3 ? [`y ${eventDates.length - 3} más`] : [])
          : [formatInstantLong(e.start_date)],
        lugar: places[0] || e.location || 'por confirmar',
        categorias: tagNames,
        precio: price === undefined ? 'sin entradas a la venta ahora' : price === 0 ? 'gratis' : `desde ${clp(price)} + cargo por servicio`,
        link: eventUrl(e.slug),
      }
    }),
  }
}

// ---------- ver_evento ----------

export function parseEventRef(value) {
  const s = String(value || '').trim()
  if (/^\d{1,12}$/.test(s)) return { id: Number(s) }
  const fromUrl = s.match(/\/eventos\/([^/?#\s]+)/i)
  const slug = fromUrl ? decodeURIComponent(fromUrl[1]) : s
  if (/^[a-z0-9][a-z0-9-]{0,200}$/i.test(slug)) return { slug: slug.toLowerCase() }
  return null
}

export async function verEvento({ supabase }, args = {}) {
  const ref = parseEventRef(args.evento)
  if (!ref) return { error: 'Referencia de evento inválida. Usa el link, el slug o el ID.' }
  const ctx = await loadEventContext(supabase, ref)
  if (!ctx) return { error: 'No encontré un evento publicado con esa referencia.' }
  return {
    ficha: eventInfoText(ctx),
    cargo_por_servicio: feeRuleText(ctx.feeAbsorbed),
    link: eventUrl(ctx.event.slug),
    ...(ctx.isDemo ? { aviso: 'Es un EVENTO DE DEMOSTRACIÓN: no es real y no vende entradas.' } : {}),
  }
}

// ---------- mis_compras / reenviar_entradas ----------

export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@')
  if (!user || !domain) return ''
  return `${user.slice(0, Math.min(2, user.length))}***@${domain}`
}

export const orderRef = (id) => String(id).slice(0, 8).toUpperCase()

async function ordersForPhone(supabase, phone) {
  if (!phone) return []
  const { data, error } = await supabase.rpc('aitickets_wa_orders_by_phone', { p_phone: phone, p_limit: 10 })
  if (error) throw new Error(`orders by phone: ${error.message}`)
  return data || []
}

export async function misCompras({ supabase, conversation }) {
  if (!conversation?.wa_phone) return { compras: [], nota: 'No tengo el número de teléfono de esta conversación. Ofrece reenviar las entradas usando el correo de la compra.' }
  const orders = await ordersForPhone(supabase, conversation.wa_phone)
  if (!orders.length) return { compras: [], nota: 'No hay compras pagadas con este número de teléfono. Puede que haya comprado con otro número: ofrece reenviar las entradas usando el correo de la compra.' }
  const eventIds = [...new Set(orders.map((o) => o.event_id))]
  const { data: events } = await supabase.from('events').select('id, name, slug, start_date').in('id', eventIds)
  const byId = new Map((events || []).map((e) => [Number(e.id), e]))
  return {
    compras: orders.map((o) => {
      const ev = byId.get(Number(o.event_id))
      return {
        referencia: orderRef(o.id),
        evento: ev?.name || `Evento ${o.event_id}`,
        fecha_evento: ev?.start_date ? formatInstantLong(ev.start_date) : null,
        link_evento: ev?.slug ? eventUrl(ev.slug) : null,
        entradas: o.ticket_qty,
        comprada_el: formatInstantLong(o.created_at, false),
        correo: maskEmail(o.buyer_email),
      }
    }),
  }
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export async function reenviarEntradas({ supabase, conversation }, args = {}) {
  const convKey = conversation.id
  if (!(await rateLimit('wa-resend:conv', convKey, { windowSeconds: 3600, max: 5, supabase })).allowed) {
    return { error: 'Se alcanzó el límite de reenvíos por ahora. Pide que lo intente en una hora o deriva a una persona.' }
  }

  const ref = clip(args.referencia, 40).replace(/[^0-9a-f]/gi, '').toLowerCase()
  if (ref) {
    const orders = await ordersForPhone(supabase, conversation.wa_phone)
    const order = ref.length >= 6 ? orders.find((o) => String(o.id).replace(/-/g, '').startsWith(ref)) : null
    if (!order) return { error: 'Esa referencia no corresponde a una compra de este número. Usa mis_compras para ver las referencias, o reenvía por correo.' }
    const r = await sendOrderTicketsEmail(order.id, { force: true })
    if (!r.ok) return { error: 'No se pudo reenviar el correo. Deriva el caso a una persona.' }
    return { ok: true, enviado_a: maskEmail(order.buyer_email) }
  }

  const email = clip(args.correo, 254).toLowerCase()
  if (!isValidEmail(email)) return { error: 'Falta una referencia de compra o un correo válido.' }
  if (!(await rateLimit('wa-resend:email', email, { windowSeconds: 86400, max: 3, supabase })).allowed) {
    return { error: 'Ya se reenviaron las entradas de ese correo varias veces hoy. Pide revisar spam/promociones o deriva a una persona.' }
  }
  const since = new Date(Date.now() - 400 * 86400_000).toISOString()
  const { data: orders, error } = await supabase
    .from('event_orders')
    .select('id')
    .ilike('buyer_email', escapeLike(email))
    .eq('status', 'paid')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(3)
  if (error) throw new Error(`orders by email: ${error.message}`)
  for (const o of orders || []) {
    const r = await sendOrderTicketsEmail(o.id, { force: true })
    if (!r.ok) console.error('[wa] reenvío', o.id, r.status, r.message)
  }
  // Misma respuesta exista o no la compra: no se revela si un correo compró entradas.
  return { ok: true, mensaje_para_cliente: `Si hay compras pagadas con ${email}, las entradas llegarán a ese correo en unos minutos (revisar spam/promociones).` }
}

// ---------- preguntar_a_productora ----------

export async function preguntarAProductora({ supabase, conversation }, args = {}) {
  const eventId = Number(args.evento_id)
  const question = clip(args.pregunta, 2000)
  const userName = clip(args.nombre, 100)
  const userEmail = clip(args.correo, 254).toLowerCase()
  if (!Number.isInteger(eventId) || eventId <= 0 || !question || !userName || !isValidEmail(userEmail)) {
    return { error: 'Faltan datos: evento, pregunta, nombre y un correo válido.' }
  }
  if (!(await rateLimit('wa-question:conv', conversation.id, { windowSeconds: 86400, max: 5, supabase })).allowed) {
    return { error: 'Se alcanzó el límite de preguntas por hoy.' }
  }
  const { data: event } = await supabase.from('events').select('id').eq('id', eventId).eq('status', 'published').maybeSingle()
  if (!event) return { error: 'Evento no encontrado.' }
  const { error } = await supabase.from('questions').insert([{ event_id: eventId, question: `${question}\n\n(enviada por WhatsApp)`, user_name: userName, user_email: userEmail }])
  if (error) {
    console.error('[wa] pregunta:', error.message)
    return { error: 'No se pudo enviar la pregunta.' }
  }
  return { ok: true, mensaje: 'La pregunta fue enviada a la productora; responderá al correo indicado.' }
}

// ---------- derivar_a_persona ----------

function contactLine(conversation) {
  const who = conversation.contact_name || 'Sin nombre'
  const phone = conversation.wa_phone ? `+${conversation.wa_phone}` : conversation.bsuid || 'sin teléfono'
  return `${who} (${phone})`
}

export async function derivarAPersona({ supabase, conversation }, args = {}) {
  const motivo = clip(args.motivo, 40) || 'otro'
  const resumen = clip(args.resumen, 1500)
  await pauseBot(supabase, conversation.id, { hours: HUMAN_PAUSE_HOURS, reason: `${motivo}: ${resumen}`.slice(0, 300) })
  await notifySlack(`:telephone_receiver: *WhatsApp → persona* (${motivo})\n${contactLine(conversation)}\n${resumen}\nResponde desde el Inbox de Kapso. El bot queda en pausa ${HUMAN_PAUSE_HOURS} h en esta conversación.`)
  return { ok: true, mensaje: 'Caso derivado. Una persona del equipo responderá por este mismo chat (horario hábil de Chile). No prometas plazos exactos.' }
}

// ---------- registrar_productor ----------

export async function registrarProductor({ supabase, conversation }, args = {}) {
  const email = clip(args.correo, 254).toLowerCase()
  const name = clip(args.nombre, 120)
  if (!name || !isValidEmail(email)) return { error: 'Faltan el nombre y un correo válido.' }
  if (!(await rateLimit('wa-lead:conv', conversation.id, { windowSeconds: 86400, max: 3, supabase })).allowed) {
    return { error: 'Ya registramos tus datos hoy.' }
  }
  const message = [clip(args.notas, 800), 'Contacto por WhatsApp.'].filter(Boolean).join(' ')
  const { leadId, created } = await createInboundLead(supabase, {
    orgName: clip(args.productora, 200) || null,
    contactName: name,
    email,
    phone: conversation.wa_phone ? `+${conversation.wa_phone}` : null,
    website: null,
    city: clip(args.ciudad, 120) || null,
    eventName: clip(args.evento, 200) || null,
    message,
    ip: null,
    source: 'whatsapp',
  })
  await setConversationLead(supabase, conversation.id, leadId)
  await notifySlack(`:tada: *Productor interesado por WhatsApp*${created ? '' : ' (lead existente)'}\n${name} <${email}> · ${contactLine(conversation)}\nProductora: ${clip(args.productora, 200) || '—'} · Ciudad: ${clip(args.ciudad, 120) || '—'}\nEvento: ${clip(args.evento, 200) || '—'}\n${clip(args.notas, 800)}`)
  return { ok: true, mensaje: 'Datos registrados; el equipo comercial lo contactará.', registro: `${SITE_URL}/organizadores/registro?utm_source=whatsapp` }
}

const HANDLERS = {
  buscar_eventos: buscarEventos,
  ver_evento: verEvento,
  mis_compras: misCompras,
  reenviar_entradas: reenviarEntradas,
  preguntar_a_productora: preguntarAProductora,
  derivar_a_persona: derivarAPersona,
  registrar_productor: registrarProductor,
}

/** Ejecuta una herramienta. Devuelve {content: string, isError: boolean} listo para tool_result. */
export async function runTool(name, args, ctx) {
  const handler = HANDLERS[name]
  if (!handler) return { content: 'Herramienta no disponible.', isError: true }
  try {
    const result = await handler(ctx, args && typeof args === 'object' ? args : {})
    return { content: JSON.stringify(result), isError: Boolean(result?.error) }
  } catch (err) {
    console.error(`[wa] tool ${name}:`, err?.message)
    return { content: 'Error interno al ejecutar la herramienta. Discúlpate y ofrece derivar a una persona.', isError: true }
  }
}
