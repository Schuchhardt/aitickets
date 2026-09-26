// Proveedor Instantly (API v2, https://developer.instantly.ai). Solo se usa con OUTREACH_PROVIDER=instantly,
// OUTREACH_DRY_RUN=false y el resto de guardarraíles en verde. Nunca Mailgun para correo en frío.
//
// Cómo funciona:
// - sendInitial agrega el lead a la campaña INSTANTLY_CAMPAIGN_ID (POST /api/v2/leads) con variables
//   personalizadas {{ait_subject}}, {{ait_body}}, {{ait_followup1}}, {{ait_followup2}} (y los asuntos
//   {{ait_followup1_subject}}, {{ait_followup2_subject}}). La campaña en Instantly debe tener EXACTAMENTE
//   3 pasos (INSTANTLY_SEQUENCE_FOLLOWUPS = 2 seguimientos) y usar SOLO esas variables (asunto
//   {{ait_subject}}, cuerpo {{ait_body}}, etc.). Los pasos de seguimiento van en el mismo hilo (asunto vacío)
//   o con {{ait_followupN_subject}}; nunca un "Re:" escrito a mano. Instantly detiene la secuencia cuando el
//   lead responde. Instantly rota los buzones y aplica los límites diarios por buzón: configúralos igual a
//   OUTREACH_PER_MAILBOX_CAP.
// - sendInitial se niega (lanza) si no recibe exactamente 2 seguimientos completos con pie legal y enlace
//   de baja: un paso fijo de la campaña con variable vacía saldría sin identificación ni baja.
// - pauseCampaign/resumeCampaign (POST /api/v2/campaigns/{id}/pause | /activate) son el interruptor de
//   emergencia de lo que Instantly YA tiene programado: ver provider-campaign.mjs.
// - Instantly v2 no permite fijar List-Unsubscribe por lead: activa el enlace/cabecera de baja de
//   Instantly en la campaña. Además cada cuerpo lleva nuestro pie con el enlace de baja firmado, y el
//   webhook (lead_unsubscribed, email_bounced, reply_received) alimenta aitickets_suppressions.
// - reply responde en el mismo hilo (POST /api/v2/emails/reply) y getEmail re-lee un correo por id
//   (GET /api/v2/emails/{id}) para no confiar en el cuerpo del webhook.
// Gmail API (sin proveedor intermedio) queda como TODO documentado: requiere cuenta de servicio con
// delegación de dominio y sondeo de users.history.list.

import { LEGAL } from '../../legal.mjs'
import { INSTANTLY_SEQUENCE_FOLLOWUPS } from '../config.mjs'

export const name = 'instantly'
const BASE = 'https://api.instantly.ai/api/v2'
/** Pasos de seguimiento que tiene la campaña de Instantly (fijos: la campaña no se adapta por lead). */
export { INSTANTLY_SEQUENCE_FOLLOWUPS }
const UNSUB_LINK_RE = /\/api\/outreach\/unsubscribe\?t=/

function apiKey() {
  return process.env.INSTANTLY_API_KEY || ''
}

async function call(path, { method = 'GET', body, timeoutMs = 15_000 } = {}) {
  const key = apiKey()
  if (!key) throw new Error('INSTANTLY_API_KEY no configurado')
  const res = await fetch(`${BASE}${path}`, {
    method,
    // Sin cuerpo no se envía Content-Type JSON (la API rechaza un JSON vacío, p. ej. en DELETE).
    headers: body ? { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } : { Authorization: `Bearer ${key}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text.slice(0, 500) } }
  if (!res.ok) {
    const err = new Error(`Instantly ${method} ${path} → ${res.status}: ${JSON.stringify(data).slice(0, 300)}`)
    err.status = res.status
    throw err
  }
  return data
}

/** Normaliza un seguimiento ({subject, text} o texto) y verifica que lleve pie legal con enlace de baja. */
function checkFollowups(followups) {
  const list = (Array.isArray(followups) ? followups : []).map((f) => (typeof f === 'string' ? { subject: '', text: f } : { subject: String(f?.subject || ''), text: String(f?.text || '') }))
  if (list.length !== INSTANTLY_SEQUENCE_FOLLOWUPS) {
    throw new Error(`Instantly: la campaña tiene ${INSTANTLY_SEQUENCE_FOLLOWUPS} seguimientos fijos y se recibieron ${list.length}; no se inscribe el lead (un paso vacío saldría sin pie legal)`)
  }
  list.forEach((f, i) => {
    if (!f.text.trim() || !f.text.includes(LEGAL.entity) || !UNSUB_LINK_RE.test(f.text)) {
      throw new Error(`Instantly: el seguimiento ${i + 1} no tiene pie legal completo; no se inscribe el lead`)
    }
  })
  return list
}

/**
 * Agrega el lead a la campaña con el correo ya redactado y validado.
 * @param {{lead: object, subject: string, text: string, followups: Array<{subject: string, text: string}>}} p
 *   followups: exactamente INSTANTLY_SEQUENCE_FOLLOWUPS seguimientos validados (con pie legal).
 */
export async function sendInitial({ lead, subject, text, followups = [] }) {
  const campaign = process.env.INSTANTLY_CAMPAIGN_ID
  if (!campaign) throw new Error('INSTANTLY_CAMPAIGN_ID no configurado')
  if (!String(text || '').includes(LEGAL.entity) || !UNSUB_LINK_RE.test(String(text || ''))) {
    throw new Error('Instantly: el correo inicial no tiene pie legal completo')
  }
  const [f1, f2] = checkFollowups(followups)
  const data = await call('/leads', {
    method: 'POST',
    body: {
      campaign,
      email: lead.email,
      company_name: lead.org_name || undefined,
      website: lead.website || undefined,
      skip_if_in_workspace: true,
      custom_variables: {
        ait_lead_id: String(lead.id),
        ait_subject: subject,
        ait_body: text,
        ait_followup1: f1.text,
        ait_followup2: f2.text,
        ait_followup1_subject: f1.subject,
        ait_followup2_subject: f2.subject,
      },
    },
  })
  return { status: 'sent', providerMessageId: data?.id || null, threadId: null, mailbox: null, sequenceManagedByProvider: true }
}

/** Responde en el hilo. `replyTo` = id (uuid) del correo recibido; `mailbox` = cuenta que lo recibió. */
export async function reply({ subject, text, replyTo, mailbox }) {
  if (!replyTo || !mailbox) throw new Error('reply requiere replyTo y mailbox')
  const data = await call('/emails/reply', {
    method: 'POST',
    body: { eaccount: mailbox, reply_to_uuid: replyTo, subject, body: { text } },
  })
  return { status: 'sent', providerMessageId: data?.id || null, threadId: data?.thread_id || null }
}

/** Re-lee un correo por id. Devuelve {id, threadId, mailbox, from, lead, subject, text} o null. */
export async function getEmail(id) {
  if (!id || !apiKey()) return null
  try {
    const e = await call(`/emails/${encodeURIComponent(id)}`)
    if (!e) return null
    return {
      id: e.id,
      threadId: e.thread_id || null,
      mailbox: e.eaccount || null,
      from: e.from_address_email || null,
      lead: e.lead || null,
      subject: e.subject || '',
      text: e.body?.text || (e.body?.html ? String(e.body.html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ') : '') || e.content_preview || '',
    }
  } catch (err) {
    console.error('[outreach] Instantly getEmail:', err?.message)
    return null
  }
}

/**
 * Agrega el email a la blocklist del workspace (POST /api/v2/block-lists-entries {bl_value}) para que
 * ninguna campaña de Instantly vuelva a escribirle. Un 409 (ya estaba bloqueado) cuenta como éxito.
 * Devuelve true/false; nunca lanza (quien llama decide si reintenta: ver provider-block.mjs).
 */
export async function blockEmail(email, { timeoutMs } = {}) {
  if (!email || !apiKey()) return false
  try {
    await call('/block-lists-entries', { method: 'POST', body: { bl_value: email }, timeoutMs })
    return true
  } catch (err) {
    if (err?.status === 409) return true
    console.error('[outreach] Instantly blocklist:', err?.message)
    return false
  }
}

/**
 * Elimina el lead de Instantly (DELETE /api/v2/leads/{id}) para cortar los pasos de la secuencia que
 * Instantly ya tenía programados. `id` = providerMessageId que devolvió sendInitial. 404 = ya no existe (éxito).
 */
export async function deleteLead(id, { timeoutMs } = {}) {
  if (!id || !apiKey()) return false
  try {
    await call(`/leads/${encodeURIComponent(id)}`, { method: 'DELETE', timeoutMs })
    return true
  } catch (err) {
    if (err?.status === 404) return true
    console.error('[outreach] Instantly delete lead:', err?.message)
    return false
  }
}

/**
 * Pausa la campaña (POST /api/v2/campaigns/{id}/pause): Instantly deja de enviar TODOS los pasos
 * programados (incluidos los seguimientos de leads ya inscritos). Lanza en caso de error (quien llama
 * avisa por Slack y reintenta: ver provider-campaign.mjs).
 */
export async function pauseCampaign({ campaignId = process.env.INSTANTLY_CAMPAIGN_ID, timeoutMs = 8_000 } = {}) {
  if (!campaignId) throw new Error('INSTANTLY_CAMPAIGN_ID no configurado')
  await call(`/campaigns/${encodeURIComponent(campaignId)}/pause`, { method: 'POST', timeoutMs })
  return true
}

/** Reactiva la campaña (POST /api/v2/campaigns/{id}/activate). Lanza en caso de error. */
export async function resumeCampaign({ campaignId = process.env.INSTANTLY_CAMPAIGN_ID, timeoutMs = 8_000 } = {}) {
  if (!campaignId) throw new Error('INSTANTLY_CAMPAIGN_ID no configurado')
  await call(`/campaigns/${encodeURIComponent(campaignId)}/activate`, { method: 'POST', timeoutMs })
  return true
}
