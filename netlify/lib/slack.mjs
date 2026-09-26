// Notificaciones internas a Slack (env SLACK_WEBHOOK_URL). Nunca lanza.
export async function notifySlack(text) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) {
    console.warn('SLACK_WEBHOOK_URL no configurado, omitiendo notificación:', String(text).slice(0, 200))
    return
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, 3000) }),
    })
    if (!res.ok) console.error(`Slack respondió con status ${res.status}`)
  } catch (err) {
    console.error('Error al notificar a Slack:', err?.message)
  }
}
