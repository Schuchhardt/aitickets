// Proveedor "dryrun" (por defecto): no envía nada. Publica el borrador en Slack y lo deja como 'draft'.
import { notifyOutreach, slackSection } from '../notify.mjs'

export const name = 'dryrun'

function preview({ lead, subject, text, note }) {
  const header = `📝 *Borrador outreach (dry-run)* ${note ? `· ${note}` : ''}\n*Para:* ${lead.org_name || '—'} <${lead.email}>\n*Asunto:* ${subject}`
  return [slackSection(header), slackSection('```' + String(text).slice(0, 2700) + '```')]
}

/** Primer contacto / seguimiento: solo Slack. */
export async function sendInitial({ lead, subject, text, step = 0 }) {
  await notifyOutreach(`Borrador outreach (dry-run) para ${lead.email}`, preview({ lead, subject, text, note: `paso ${step}` }))
  return { status: 'draft', providerMessageId: null, threadId: null, mailbox: null }
}

/** Respuesta en el hilo: solo Slack. */
export async function reply({ lead, subject, text }) {
  await notifyOutreach(`Respuesta outreach (dry-run) para ${lead.email}`, preview({ lead, subject, text, note: 'respuesta' }))
  return { status: 'draft', providerMessageId: null }
}

export async function getEmail() {
  return null
}

export async function blockEmail() {
  return false
}
