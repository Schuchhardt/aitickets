// Resumen diario del outreach en Slack (23:00 UTC ≈ 19-20 h en Chile). No llama al LLM ni envía correos.
import { getSupabaseAdmin } from '../../lib/supabase.mjs'
import { getOutreachConfig } from '../../lib/outreach/config.mjs'
import { buildDigest } from '../../lib/outreach/digest.mjs'
import { notifyOutreach } from '../../lib/outreach/notify.mjs'

export default async () => {
  if (!getOutreachConfig().enabled) {
    console.log('outreach disabled')
    return new Response('outreach disabled', { status: 200 })
  }
  try {
    const text = await buildDigest(getSupabaseAdmin())
    await notifyOutreach(text)
    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error('[outreach-digest] error:', err?.message)
    return new Response('error', { status: 200 })
  }
}

export const config = {
  schedule: '0 23 * * *',
}
