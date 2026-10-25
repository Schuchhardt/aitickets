#!/usr/bin/env node
// Devolución directa sin autorización del productor (wrapper del endpoint /api/admin/events/direct-refund).
// Uso:
//   ADMIN_API_SECRET=... node scripts/admin-direct-refund.mjs --event 123 --reason fraud --admin "Seba" [--detail "..."] [--execute] [--no-notify]
//   SITE_URL (por defecto https://aitickets.cl) elige el sitio. Sin --execute solo muestra el resumen (dry run).
// Runbook: docs/runbooks/devolucion-directa.md
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const secret = process.env.ADMIN_API_SECRET
const site = (process.env.SITE_URL || 'https://aitickets.cl').replace(/\/$/, '')
const body = {
  event_id: Number(opt('event')),
  reason_code: opt('reason'),
  admin: opt('admin') || process.env.USER || '',
  detail: opt('detail'),
  buyer_message: opt('message'),
  notify_buyers: !flag('no-notify'),
  dry_run: !flag('execute'),
}
if (!secret || !body.event_id || !body.reason_code) {
  console.error('Uso: ADMIN_API_SECRET=... node scripts/admin-direct-refund.mjs --event <id> --reason <not_held|producer_unresponsive|permit_revoked|fraud> --admin <nombre> [--detail txt] [--message txt] [--no-notify] [--execute]')
  process.exit(1)
}
const res = await fetch(`${site}/api/admin/events/direct-refund`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-admin-secret': secret },
  body: JSON.stringify(body),
})
const out = await res.json().catch(() => ({}))
console.log(JSON.stringify(out, null, 2))
if (!res.ok) process.exit(1)
if (body.dry_run) console.log('\n(dry run: agrega --execute para cancelar el evento y registrar las devoluciones)')
