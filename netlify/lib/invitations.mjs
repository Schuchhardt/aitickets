// Invitación masiva al próximo evento (aitickets_scheduled_messages kind 'invitation', migración 202610220100).
// La productora elige un evento suyo ya realizado (event_id = de dónde salen los asistentes) y uno próximo
// (target_event_id = al que se invita). planInvitation calcula los destinatarios (para la vista previa y la
// confirmación) y deliverInvitation los envía desde la background function send-scheduled-messages-background.
//
// Destinatarios (filterInviteRecipients en reviews.mjs): titulares de entradas vigentes del evento realizado,
// según la audiencia, SIN quienes se dieron de baja de esa productora (aitickets_org_email_optouts), sin quienes
// ya tienen entradas para el evento al que se invita y sin quienes ya recibieron esta misma invitación
// (notification_log type 'next_event_invite' con event_id = evento al que se invita).
// Cada correo lleva su enlace de baja (List-Unsubscribe one-click incluido) y UTM para medir la venta.
import { escapeHtml, fetchAllRows } from './supabase.mjs'
import { sendEmail, SITE_URL, formatRecipient, isValidEmail } from './mailer.mjs'
import { renderNextEventInvitationEmail } from './emails/index.mjs'
import { LEGAL } from './legal.mjs'
import { greetingName, holderName } from './buyer-name.mjs'
import { EVENT_DATE_COLUMNS, formatDateOnlyLong, formatTimeShort, formatEventLocation } from './dates.mjs'
import {
  REVIEWS_TABLE,
  OPTOUTS_TABLE,
  NEXT_EVENT_INVITE_TYPE,
  INVITE_AUDIENCES,
  isLiveTicketStatus,
  filterInviteRecipients,
  functionEndsAt,
} from './reviews.mjs'
import { signInviteOptoutToken } from './review-token.mjs'
import { hasSecretLocation, publicPlace } from './secret-location.mjs'

export const INVITATION_BATCH_SIZE = 50

const isMissingTable = (error) => ['42P01', 'PGRST205'].includes(String(error?.code || ''))

export class InvitationError extends Error {
  /** @param {'not_found' | 'conflict' | 'invalid_input' | 'rate_limited' | 'unavailable'} code */
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/**
 * Titulares de entradas vigentes de un evento: uno por email, con si alguno de sus tickets ingresó.
 * @returns {Promise<Array<{ id: number, email: string, first_name: string | null, last_name: string | null, checkedIn: boolean }>>}
 */
export async function collectEventHolders(supabase, eventId) {
  const rows = await fetchAllRows(() => supabase
    .from('event_attendees')
    .select('id, status, validated_at, attendees ( id, first_name, last_name, email ), event_orders ( buyer_first_name, buyer_last_name )')
    .eq('event_id', eventId)
    .order('id', { ascending: true }))
  const byEmail = new Map()
  for (const ea of rows || []) {
    if (!isLiveTicketStatus(ea.status)) continue
    const a = Array.isArray(ea.attendees) ? ea.attendees[0] : ea.attendees
    const email = String(a?.email || '').trim().toLowerCase()
    if (!email || !isValidEmail(email)) continue
    const checkedIn = ea.status === 'validated' || Boolean(ea.validated_at)
    const prev = byEmail.get(email)
    if (prev) {
      prev.checkedIn = prev.checkedIn || checkedIn
      continue
    }
    byEmail.set(email, { id: a.id, email, ...holderName(a, ea.event_orders), checkedIn })
  }
  return [...byEmail.values()]
}

/** El evento tiene alguna función que aún no termina (o, sin funciones, end_date/start_date en el futuro). */
export function isUpcomingEvent(event, dates, now = new Date()) {
  if (dates?.length) return dates.some((fn) => (functionEndsAt(fn)?.getTime() ?? 0) > now.getTime())
  const end = event?.end_date || event?.start_date
  return Boolean(end) && new Date(end).getTime() > now.getTime()
}

/** "sábado, 8 de noviembre de 2026 · 21:00 hrs" y el lugar de la próxima función. */
function nextFunctionSummary(event, dates, now = new Date()) {
  const next = (dates || []).find((fn) => (functionEndsAt(fn)?.getTime() ?? 0) > now.getTime())
  if (!next) return { dateLabel: '', venue: event?.location || '' }
  const time = formatTimeShort(next.start_time)
  const more = (dates || []).filter((fn) => (functionEndsAt(fn)?.getTime() ?? 0) > now.getTime()).length - 1
  return {
    dateLabel: `${formatDateOnlyLong(next.date)}${time ? ` · ${time} hrs` : ''}${more > 0 ? ` (+${more} ${more === 1 ? 'función' : 'funciones'})` : ''}`,
    // Con dirección privada, sin la calle: la invitación llega a quien todavía no compra
    venue: (event?.has_secret_location ? publicPlace(next.event_locations) : formatEventLocation(next.event_locations)) || event?.location || '',
  }
}

async function loadEventWithDates(supabase, eventId, organizationId) {
  const { data: event, error } = await supabase
    .from('events')
    .select('id, name, slug, status, image_url, location, start_date, end_date, organization_id, cancelled_at')
    .eq('id', eventId)
    .maybeSingle()
  if (error) throw error
  if (!event || String(event.organization_id) !== String(organizationId)) return null
  const { data: dates, error: dError } = await supabase
    .from('event_dates')
    .select(EVENT_DATE_COLUMNS)
    .eq('event_id', event.id)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })
  if (dError) throw dError
  event.has_secret_location = await hasSecretLocation(supabase, event.id)
  return { event, dates: dates || [] }
}

/** URL pública del evento con UTM (las compras quedan atribuidas a la invitación). */
export function invitationEventUrl(slug, sourceEventId) {
  const params = new URLSearchParams({ utm_source: 'aitickets', utm_medium: 'email', utm_campaign: `invitacion-${sourceEventId}` })
  return `${SITE_URL}/eventos/${encodeURIComponent(slug || '')}?${params}`
}

/**
 * Calcula una invitación sin enviar nada: valida los eventos y devuelve los destinatarios.
 * @param {{ organizationId: number, sourceEventId: number, targetEventId: number, audience?: string, now?: Date }} p
 */
export async function planInvitation(supabase, { organizationId, sourceEventId, targetEventId, audience = 'all', now = new Date() }) {
  if (!INVITE_AUDIENCES[audience]) throw new InvitationError('invalid_input', 'Audiencia no válida.')
  if (String(sourceEventId) === String(targetEventId)) throw new InvitationError('invalid_input', 'Elige un evento distinto al que ya se realizó.')
  const source = await loadEventWithDates(supabase, sourceEventId, organizationId)
  if (!source) throw new InvitationError('not_found', 'Evento no encontrado.')
  const target = await loadEventWithDates(supabase, targetEventId, organizationId)
  if (!target) throw new InvitationError('not_found', 'El evento al que quieres invitar no existe o no es de tu organización.')
  if (target.event.cancelled_at) throw new InvitationError('conflict', 'El evento al que quieres invitar está cancelado.')
  if (target.event.status !== 'published') throw new InvitationError('conflict', 'Publica el evento al que quieres invitar: su link aún no funciona.')
  if (!isUpcomingEvent(target.event, target.dates, now)) throw new InvitationError('conflict', 'El evento al que quieres invitar ya terminó.')

  const [holders, targetHolders] = await Promise.all([collectEventHolders(supabase, source.event.id), collectEventHolders(supabase, target.event.id)])

  const ratings = new Map()
  const { data: reviews, error: rError } = await supabase.from(REVIEWS_TABLE).select('email, rating').eq('event_id', source.event.id).limit(20000)
  if (rError && !isMissingTable(rError)) throw rError
  for (const r of reviews || []) ratings.set(String(r.email).toLowerCase(), Number(r.rating) || 0)

  const { data: optouts, error: oError } = await supabase.from(OPTOUTS_TABLE).select('email').eq('organization_id', organizationId).limit(50000)
  if (oError && !isMissingTable(oError)) throw oError
  const optedOut = new Set((optouts || []).map((o) => String(o.email).toLowerCase()))

  const { data: logged, error: lError } = await supabase
    .from('notification_log')
    .select('attendee_id')
    .eq('event_id', target.event.id)
    .eq('type', NEXT_EVENT_INVITE_TYPE)
    .limit(50000)
  if (lError) throw lError
  const alreadyInvited = new Set((logged || []).map((l) => String(l.attendee_id)))

  const recipients = filterInviteRecipients(holders, {
    audience,
    ratings,
    optedOut,
    alreadyInvited,
    targetHolders: new Set(targetHolders.map((t) => t.email)),
  })
  return {
    sourceEvent: source.event,
    targetEvent: target.event,
    targetDates: target.dates,
    recipients,
    counts: {
      attendees: holders.length,
      recipients: recipients.length,
      opted_out: holders.filter((h) => optedOut.has(h.email)).length,
      already_have_tickets: holders.filter((h) => targetHolders.some((t) => t.email === h.email)).length,
      already_invited: holders.filter((h) => alreadyInvited.has(String(h.id))).length,
    },
  }
}

/**
 * Envía una invitación ya reclamada. Nunca lanza.
 * @param {any} message fila de aitickets_scheduled_messages (kind 'invitation'); target_event_id puede venir aparte
 * @returns {Promise<{ sent: number, failed: number, total: number, error?: string }>}
 */
export async function deliverInvitation(supabase, message, { notify = async () => {}, now = new Date() } = {}) {
  let targetEventId = message.target_event_id
  if (targetEventId == null) {
    const { data } = await supabase.from('aitickets_scheduled_messages').select('target_event_id').eq('id', message.id).maybeSingle()
    targetEventId = data?.target_event_id
  }
  let plan
  try {
    plan = await planInvitation(supabase, {
      organizationId: message.organization_id,
      sourceEventId: message.event_id,
      targetEventId,
      audience: message.audience,
      now,
    })
  } catch (err) {
    return { sent: 0, failed: 0, total: 0, error: String(err?.message || err).slice(0, 200) }
  }
  const { sourceEvent, targetEvent, targetDates, recipients } = plan
  if (!recipients.length) return { sent: 0, failed: 0, total: 0 }

  const { data: org } = await supabase.from('organizations').select('public_name, email').eq('id', message.organization_id).maybeSingle()
  const { dateLabel, venue } = nextFunctionSummary(targetEvent, targetDates, now)
  const { subject, html, text } = await renderNextEventInvitationEmail({
    organizerName: org?.public_name || '',
    sourceEventName: sourceEvent.name,
    eventName: targetEvent.name,
    dateLabel,
    venue,
    imageUrl: targetEvent.image_url || '',
    eventUrl: invitationEventUrl(targetEvent.slug, sourceEvent.id),
    message: message.body,
    subject: message.subject,
  })
  const replyTo = org?.email && isValidEmail(org.email) ? org.email : LEGAL.supportEmail

  const sentRecipients = []
  let firstError = ''
  for (let i = 0; i < recipients.length; i += INVITATION_BATCH_SIZE) {
    const batch = recipients.slice(i, i + INVITATION_BATCH_SIZE)
    const recipientVariables = {}
    const to = []
    for (const r of batch) {
      const token = signInviteOptoutToken({ organizationId: message.organization_id, email: r.email })
      if (!token) {
        // Sin secreto de firma no hay enlace de baja: no se envía publicidad sin forma de darse de baja
        firstError ||= 'falta el secreto de firma (REVIEW_TOKEN_SECRET)'
        continue
      }
      const name = greetingName(r.first_name, r.last_name)
      const pageUrl = `${SITE_URL}/invitaciones/baja?t=${encodeURIComponent(token)}`
      const oneClickUrl = `${SITE_URL}/api/invitaciones/baja?t=${encodeURIComponent(token)}`
      recipientVariables[r.email] = {
        name: { html: escapeHtml(name), text: name },
        unsubscribe_url: { html: escapeHtml(pageUrl), text: pageUrl },
        unsubscribe_one_click: { html: oneClickUrl, text: oneClickUrl },
      }
      to.push(formatRecipient(`${r.first_name || ''} ${r.last_name || ''}`, r.email))
    }
    if (!to.length) continue
    try {
      await sendEmail({
        to,
        subject,
        html,
        text,
        replyTo,
        recipientVariables,
        headers: { 'List-Unsubscribe': '<%recipient.unsubscribe_one_click%>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        tags: ['next-event-invite'],
        idempotencyKey: `invite-${message.id}-${i}`,
      })
      sentRecipients.push(...batch.filter((r) => recipientVariables[r.email]))
    } catch (err) {
      firstError ||= String(err?.message || err).slice(0, 200)
      console.error(`invitación ${message.id}: lote ${i} falló:`, err?.message)
    }
  }

  if (sentRecipients.length) {
    const { error: logError } = await supabase.from('notification_log').insert(
      sentRecipients.map((r) => ({ event_id: targetEvent.id, attendee_id: r.id, type: NEXT_EVENT_INVITE_TYPE, channel: 'email', status: 'sent' }))
    )
    if (logError) console.warn('notification_log (invitación):', logError.message)
  }
  const failed = recipients.length - sentRecipients.length
  if (failed > 0) {
    await notify(`⚠️ Invitación ${message.id} (evento #${sourceEvent.id} → #${targetEvent.id}): ${failed} de ${recipients.length} correos fallaron. ${firstError}`)
  }
  return { sent: sentRecipients.length, failed, total: recipients.length, ...(firstError ? { error: firstError } : {}) }
}
