// Selección del proveedor de envío. Cualquier condición que impida el envío real => dryrun.
import { legalReady } from '../../legal.mjs'
import { getOutreachConfig, realSendingBlockers } from '../config.mjs'
import * as dryrun from './dryrun.mjs'
import * as instantly from './instantly.mjs'

/** Devuelve {provider, dryRun, blockers[]}. */
export function selectProvider(cfg = getOutreachConfig()) {
  const blockers = realSendingBlockers(cfg, legalReady())
  if (cfg.provider === 'instantly' && !(process.env.INSTANTLY_API_KEY && process.env.INSTANTLY_CAMPAIGN_ID)) {
    blockers.push('instantly_not_configured')
  }
  // Sin webhook no llegan rebotes, quejas, bajas ni respuestas: la auto-pausa y la supresión quedarían ciegas.
  if (cfg.provider === 'instantly' && !process.env.OUTREACH_WEBHOOK_SECRET) {
    blockers.push('webhook_not_configured')
  }
  if (blockers.length) return { provider: dryrun, dryRun: true, blockers }
  return { provider: instantly, dryRun: false, blockers: [] }
}

/** Proveedor con el que se envió un mensaje (para re-leer correos del webhook). */
export function providerByName(name) {
  return name === 'instantly' ? instantly : dryrun
}
