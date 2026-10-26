#!/usr/bin/env node
// Alta (o actualización) del webhook de Zernio para la difusión automática en Instagram
// (docs/runbooks/historias-automaticas.md). Una sola vez por entorno; es idempotente: si ya existe un webhook con
// el mismo nombre, lo actualiza.
//
// Uso:
//   ZERNIO_API_KEY=... ZERNIO_WEBHOOK_SECRET=... SITE_URL=https://aitickets.cl node scripts/zernio-webhook.mjs
// El mismo ZERNIO_WEBHOOK_SECRET debe estar en Netlify (Functions, Production): Zernio firma cada entrega con él.
const API = 'https://zernio.com/api/v1'
const NAME = 'AI Tickets · historias'
const EVENTS = ['post.platform.published', 'post.platform.failed', 'post.published', 'post.failed', 'post.cancelled', 'account.disconnected']

const apiKey = process.env.ZERNIO_API_KEY
const secret = process.env.ZERNIO_WEBHOOK_SECRET
const site = (process.env.SITE_URL || '').replace(/\/+$/, '')
if (!apiKey || !secret || !site) {
  console.error('Faltan ZERNIO_API_KEY, ZERNIO_WEBHOOK_SECRET o SITE_URL')
  process.exit(1)
}
if (secret.length < 32) {
  console.error('ZERNIO_WEBHOOK_SECRET debe tener al menos 32 caracteres (openssl rand -hex 32)')
  process.exit(1)
}

const call = async (method, body) => {
  const res = await fetch(`${API}/webhooks/settings`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} /webhooks/settings → ${res.status}: ${data.error || JSON.stringify(data).slice(0, 200)}`)
  return data
}

const url = `${site}/api/webhooks/zernio`
const list = await call('GET')
const hooks = Array.isArray(list) ? list : list.webhooks || list.data || []
const existing = hooks.find((h) => h.name === NAME)
if (existing) {
  await call('PUT', { webhookId: existing._id || existing.id || existing.webhookId, url, secret, events: EVENTS, isActive: true })
  console.log(`Webhook actualizado: ${url}`)
} else {
  await call('POST', { name: NAME, url, secret, events: EVENTS })
  console.log(`Webhook creado: ${url}`)
}
console.log(`Eventos: ${EVENTS.join(', ')}`)
