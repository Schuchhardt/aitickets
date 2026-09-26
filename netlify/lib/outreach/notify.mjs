// Notificaciones del outreach a Slack (SLACK_OUTREACH_WEBHOOK_URL, o SLACK_WEBHOOK_URL como respaldo).
// Nunca lanza: una falla de Slack no debe cortar una corrida.

export async function notifyOutreach(text, blocks) {
  const webhookUrl = process.env.SLACK_OUTREACH_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL
  const safeText = String(text ?? '').slice(0, 3000)
  if (!webhookUrl) {
    console.warn('[outreach] Slack no configurado, omitiendo:', safeText.slice(0, 200))
    return false
  }
  try {
    const body = { text: safeText }
    if (Array.isArray(blocks) && blocks.length) body.blocks = blocks.slice(0, 45)
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) console.error(`[outreach] Slack respondió ${res.status}`)
    return res.ok
  } catch (err) {
    console.error('[outreach] error notificando a Slack:', err?.message)
    return false
  }
}

/** Bloque de sección de Slack (mrkdwn), truncado al límite de 3000 caracteres. */
export function slackSection(text) {
  return { type: 'section', text: { type: 'mrkdwn', text: String(text ?? '').slice(0, 2900) || ' ' } }
}
