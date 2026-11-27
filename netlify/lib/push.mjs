import { setVapidDetails, sendNotification } from 'web-push'
import { getSupabaseAdmin } from './supabase.mjs'

const env = (name) => globalThis.process?.env?.[name]

function getVapid() {
  const publicKey = env('VAPID_PUBLIC_KEY')
  const privateKey = env('VAPID_PRIVATE_KEY')
  const subject = env('VAPID_SUBJECT') || 'mailto:soporte@aitickets.cl'
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject }
}

function buildPayload({ title, body, url, tag, icon }) {
  return JSON.stringify({
    title: title || 'AI Tickets',
    body: body || '',
    url: url || '/dashboard',
    tag: tag || undefined,
    icon: icon || '/android-chrome-192x192.png',
  })
}

async function sendToSubscriptions(subscriptions, notification) {
  const vapid = getVapid()
  if (!vapid) {
    console.warn('VAPID keys not configured, skipping push notifications')
    return { sent: 0, failed: 0, cleaned: 0 }
  }

  setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
  const payload = buildPayload(notification)
  const supabase = getSupabaseAdmin()

  let sent = 0
  let failed = 0
  const toDelete = []

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      ).then(() => ({ id: sub.id, ok: true }))
       .catch((err) => ({ id: sub.id, ok: false, statusCode: err.statusCode }))
    ),
  )

  for (const result of results) {
    const value = result.status === 'fulfilled' ? result.value : { ok: false, statusCode: 0 }
    if (value.ok) {
      sent++
    } else {
      failed++
      if (value.statusCode === 410 || value.statusCode === 404) {
        toDelete.push(value.id)
      }
    }
  }

  if (toDelete.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', toDelete)
  }

  return { sent, failed, cleaned: toDelete.length }
}

export async function sendPushToOrg(orgId, notification) {
  const vapid = getVapid()
  if (!vapid) {
    console.warn('VAPID keys not configured, skipping push notifications')
    return { sent: 0, failed: 0, cleaned: 0 }
  }

  const supabase = getSupabaseAdmin()
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('organization_id', orgId)

  if (error) {
    console.error('Error fetching push subscriptions:', error.message)
    return { sent: 0, failed: 0, cleaned: 0 }
  }
  if (!subs?.length) return { sent: 0, failed: 0, cleaned: 0 }

  return sendToSubscriptions(subs, notification)
}

export async function sendPushToUser(userId, notification) {
  const vapid = getVapid()
  if (!vapid) {
    console.warn('VAPID keys not configured, skipping push notifications')
    return { sent: 0, failed: 0, cleaned: 0 }
  }

  const supabase = getSupabaseAdmin()
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (error) {
    console.error('Error fetching push subscriptions:', error.message)
    return { sent: 0, failed: 0, cleaned: 0 }
  }
  if (!subs?.length) return { sent: 0, failed: 0, cleaned: 0 }

  return sendToSubscriptions(subs, notification)
}
