#!/usr/bin/env node
// Correo único a productores con eventos pagados publicados y sin identidad verificada (Didit):
// sus eventos siguen a la venta, pero sin verificar no pueden retirar (Términos para productores §2 bis).
//
// Uso:
//   node --env-file=.env scripts/notify-identity-verification.mjs            dry-run: lista destinatarios, no envía
//   node --env-file=.env scripts/notify-identity-verification.mjs --send     envía (idempotente por organización)
//   --org <id>[,<id>]   solo esas organizaciones
//
// Destinatarios: usuarios activos con rol admin o producer de cada organización; si no hay, el correo de la organización.
// Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY (solo con --send), SITE_URL.
import { createClient } from '@supabase/supabase-js'
import { sendEmail, isValidEmail, SITE_URL } from '../netlify/lib/mailer.mjs'
import { renderIdentityVerificationRequestEmail } from '../netlify/lib/emails/index.mjs'

const send = process.argv.includes('--send')
const orgArg = process.argv[process.argv.indexOf('--org') + 1]
const onlyOrgs = process.argv.includes('--org') ? new Set(String(orgArg || '').split(',').map(Number).filter(Boolean)) : null
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: events, error } = await supabase
  .from('events')
  .select('id, name, organization_id, event_tickets!inner(id)')
  .eq('status', 'published')
  .gt('event_tickets.price', 0)
if (error) throw error

const orgIds = [...new Set((events || []).map((e) => e.organization_id).filter(Boolean))]
if (!orgIds.length) {
  console.log('No hay eventos pagados publicados.')
  process.exit(0)
}

const { data: orgs, error: orgError } = await supabase
  .from('organizations')
  .select('id, public_name, email, identity_status')
  .in('id', orgIds)
if (orgError) throw orgError

const { data: users, error: userError } = await supabase
  .from('users')
  .select('email, role, active, organization_id')
  .in('organization_id', orgIds)
  .in('role', ['admin', 'producer'])
if (userError) throw userError

const pending = (orgs || []).filter((o) => o.identity_status !== 'approved' && (!onlyOrgs || onlyOrgs.has(o.id)))
const settingsUrl = `${SITE_URL}/dashboard/settings#identidad`
let sent = 0

for (const org of pending) {
  const emails = [
    ...new Set(
      (users || [])
        .filter((u) => u.organization_id === org.id && u.active !== false && isValidEmail(u.email))
        .map((u) => u.email.trim().toLowerCase())
    ),
  ]
  if (!emails.length && isValidEmail(org.email)) emails.push(org.email.trim().toLowerCase())
  const eventNames = events.filter((e) => e.organization_id === org.id).map((e) => e.name)
  console.log(`${send ? 'Enviando' : '[dry-run]'} org ${org.id} (${org.public_name || 'sin nombre'}) → ${emails.join(', ') || 'SIN CORREO'} · eventos: ${eventNames.join(' | ')}`)
  if (!send || !emails.length) continue
  const email = await renderIdentityVerificationRequestEmail({ orgName: org.public_name, settingsUrl })
  await sendEmail({ to: emails, ...email, tags: [{ name: 'type', value: 'identity_verification_request' }], idempotencyKey: `identity-verification-request-${org.id}` })
  sent++
}

console.log(`${pending.length} organización(es) sin verificar${send ? `, ${sent} correo(s) enviado(s)` : ' (dry-run: no se envió nada)'}.`)
