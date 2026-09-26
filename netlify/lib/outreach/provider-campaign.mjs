// Interruptor de emergencia en el proveedor (Instantly).
// Con Instantly, el primer envío entrega la secuencia completa: Instantly envía por su cuenta los
// seguimientos 4 y 7+ días hábiles después. Pausar en nuestra BD (auto-pausa, pausa manual,
// OUTREACH_ENABLED=false, dry-run) NO detiene esos envíos: hay que pausar la campaña en Instantly.
//
// Estado en aitickets_outreach_state key='provider_campaign':
//   {state:'active'|'paused'|null, paused_by_us:boolean, pending:boolean, desired, attempts, error, at}
// - syncProviderCampaign() calcula el estado deseado y llama a la API solo si difiere del último conocido
//   (o si quedó un pendiente). Se llama desde setPaused/checkAutoPause y en cada outreach-tick.
// - Si la llamada falla: aviso fuerte por Slack (al primer fallo y cada 6 intentos) y queda pending=true,
//   que el tick reintenta en cada corrida.
// - Solo se REACTIVA una campaña que pausamos nosotros (paused_by_us): nunca se activa una campaña que el
//   equipo dejó pausada a mano en Instantly.
import { legalReady } from '../legal.mjs'
import { getOutreachConfig, realSendingBlockers } from './config.mjs'
import { notifyOutreach } from './notify.mjs'
import * as instantly from './providers/instantly.mjs'

const KEY = 'provider_campaign'

function configured() {
  return Boolean(process.env.INSTANTLY_API_KEY && process.env.INSTANTLY_CAMPAIGN_ID)
}

async function readState(supabase) {
  const { data, error } = await supabase.from('aitickets_outreach_state').select('value').eq('key', KEY).maybeSingle()
  if (error) throw new Error(`outreach_state: ${error.message}`)
  return data?.value && typeof data.value === 'object' ? data.value : {}
}

async function writeState(supabase, value) {
  const { error } = await supabase
    .from('aitickets_outreach_state')
    .upsert({ key: KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) console.error('[outreach] provider_campaign state:', error.message)
}

/**
 * Estado deseado de la campaña: 'active' solo si el envío real está totalmente habilitado y no hay pausa.
 * Cualquier otra cosa (apagado, pausado, dry-run, sin legal/LIA, sin webhook) => 'paused'.
 */
export function desiredCampaignState({ paused, cfg = getOutreachConfig() }) {
  if (paused || !cfg.enabled || cfg.provider !== 'instantly') return 'paused'
  if (realSendingBlockers(cfg, legalReady()).length) return 'paused'
  if (!process.env.OUTREACH_WEBHOOK_SECRET) return 'paused'
  return 'active'
}

/**
 * Lleva la campaña de Instantly al estado deseado. Nunca lanza.
 * @param {any} supabase cliente service role
 * @param {{paused: boolean, cfg?: object, reason?: string, force?: boolean}} p
 *   force: llamar a la API aunque el último estado conocido ya coincida (p. ej. al pausar por emergencia).
 * @returns {Promise<{action: string, ok: boolean, state?: string, error?: string}>}
 */
export async function syncProviderCampaign(supabase, { paused, cfg = getOutreachConfig(), reason = '', force = false }) {
  if (!configured()) return { action: 'not_configured', ok: true }
  let prev = {}
  try {
    prev = await readState(supabase)
  } catch (err) {
    // Sin estado (preview sin migración): igual se intenta pausar si corresponde (dirección segura).
    console.error('[outreach] provider_campaign:', err?.message)
  }
  const desired = desiredCampaignState({ paused, cfg })

  if (desired === 'active') {
    // Solo reactivamos lo que pausamos nosotros.
    if (!prev.paused_by_us) {
      if (prev.pending && prev.desired === 'paused') await writeState(supabase, { ...prev, pending: false, desired: 'active', at: new Date().toISOString() })
      return { action: 'noop', ok: true, state: prev.state || null }
    }
    if (prev.state === 'active' && !prev.pending) return { action: 'noop', ok: true, state: 'active' }
  } else if (prev.state === 'paused' && !prev.pending && !force) {
    return { action: 'noop', ok: true, state: 'paused' }
  }

  const now = new Date().toISOString()
  try {
    if (desired === 'paused') await instantly.pauseCampaign()
    else await instantly.resumeCampaign()
    await writeState(supabase, { state: desired, paused_by_us: desired === 'paused', pending: false, desired, attempts: 0, error: null, reason: String(reason).slice(0, 300), at: now })
    if (desired === 'paused' && prev.state !== 'paused') {
      await notifyOutreach(`⏸️ Campaña de Instantly pausada${reason ? ` (${String(reason).slice(0, 200)})` : ''}: no saldrán seguimientos programados.`)
    } else if (desired === 'active') {
      await notifyOutreach('▶️ Campaña de Instantly reactivada (outreach habilitado y sin pausa).')
    }
    return { action: desired === 'paused' ? 'paused' : 'resumed', ok: true, state: desired }
  } catch (err) {
    const error = String(err?.message || err).slice(0, 300)
    const attempts = (prev.pending && prev.desired === desired ? Number(prev.attempts) || 0 : 0) + 1
    await writeState(supabase, { ...prev, pending: true, desired, attempts, error, reason: String(reason).slice(0, 300), at: now })
    if (desired === 'paused' && (attempts === 1 || attempts % 6 === 0)) {
      await notifyOutreach(`🚨🚨 NO se pudo pausar la campaña de Instantly (${attempts} intento${attempts > 1 ? 's' : ''}): ${error}. Instantly SIGUE enviando los seguimientos programados. Páusala A MANO en Instantly ahora. Se reintentará en cada corrida.`)
    } else if (desired === 'active' && (attempts === 1 || attempts % 6 === 0)) {
      await notifyOutreach(`⚠️ No se pudo reactivar la campaña de Instantly (${attempts} intentos): ${error}.`)
    }
    return { action: 'failed', ok: false, error }
  }
}
