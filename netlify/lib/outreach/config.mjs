// Configuración del outreach autónomo. Todo sale del entorno con valores seguros por defecto:
// sin configurar nada, el outreach está APAGADO (no descubre, no enriquece, no llama al LLM, no envía).
//
// Interruptores (en orden de severidad):
// - OUTREACH_ENABLED=false  → nada corre: ni descubrimiento, ni enriquecimiento, ni LLM, ni envíos.
// - aitickets_outreach_state.paused (BD) → pausa operativa (auto-pausa por rebotes/quejas o manual).
// - OUTREACH_DRY_RUN=true   → los correos se generan y se publican en Slack, nunca se envían.
// - Enviar de verdad exige además: legalReady() (dirección postal + correo legal), OUTREACH_LIA_APPROVED=true
//   (evaluación de interés legítimo firmada, docs/legal/lia-outreach.md) y un proveedor distinto de dryrun.

function env(name) {
  const value = globalThis.process?.env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

function bool(name, fallback) {
  const v = env(name).toLowerCase()
  if (!v) return fallback
  return ['1', 'true', 'yes', 'on', 'si', 'sí'].includes(v)
}

function int(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(env(name), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function num(name, fallback, { min = 0, max = 1 } = {}) {
  const n = Number.parseFloat(env(name))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export const SEND_TIMEZONE = 'America/Santiago'
/** Seguimientos fijos de la campaña de Instantly (la campaña debe tener exactamente 1 + 2 pasos). */
export const INSTANTLY_SEQUENCE_FOLLOWUPS = 2

/** Lee la configuración en cada llamada (los tests y las funciones pueden cambiar el entorno). */
export function getOutreachConfig() {
  const provider = ['dryrun', 'instantly'].includes(env('OUTREACH_PROVIDER').toLowerCase())
    ? env('OUTREACH_PROVIDER').toLowerCase()
    : 'dryrun'
  return {
    enabled: bool('OUTREACH_ENABLED', false),
    dryRun: bool('OUTREACH_DRY_RUN', true),
    autoReply: bool('OUTREACH_AUTO_REPLY', false),
    liaApproved: bool('OUTREACH_LIA_APPROVED', false),
    provider,
    dailyCap: int('OUTREACH_DAILY_CAP', 20, { max: 200 }),
    perMailboxCap: int('OUTREACH_PER_MAILBOX_CAP', 15, { max: 100 }),
    // Con Instantly la campaña tiene 2 seguimientos fijos (INSTANTLY_SEQUENCE_FOLLOWUPS): OUTREACH_MAX_FOLLOWUPS
    // se ignora, porque la campaña no se adapta por lead y un paso sin contenido saldría sin pie legal.
    maxFollowups: provider === 'instantly' ? INSTANTLY_SEQUENCE_FOLLOWUPS : int('OUTREACH_MAX_FOLLOWUPS', 2, { max: 5 }),
    recontactDays: int('OUTREACH_RECONTACT_DAYS', 180, { min: 30 }),
    autoReplyMinConfidence: num('OUTREACH_AUTO_REPLY_MIN_CONFIDENCE', 0.85, { min: 0.5, max: 1 }),
    maxAutoRepliesPerThread: 3,
    countries: (env('OUTREACH_COUNTRIES') || 'CL')
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c)),
    // Ventana de envío: lunes a viernes 09:00–17:00 hora de Chile.
    sendWindow: { startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5], timeZone: SEND_TIMEZONE },
    // Días hábiles entre pasos de la secuencia (paso 1 a +4, paso 2 a +7 más).
    followupDelaysDays: [4, 7],
    // Espaciado aleatorio entre envíos de una misma corrida (segundos).
    spacingSeconds: { min: 120, max: 540 },
    domain: env('OUTREACH_DOMAIN'),
    fromName: env('OUTREACH_FROM_NAME'),
    unsubMailto: env('OUTREACH_UNSUB_MAILTO') || (env('OUTREACH_DOMAIN') ? `unsubscribe@${env('OUTREACH_DOMAIN')}` : ''),
    siteUrl: (env('SITE_URL') || 'https://aitickets.cl').replace(/\/+$/, ''),
    // Límites de descubrimiento y enriquecimiento por corrida.
    discoverMaxPerRun: int('OUTREACH_DISCOVER_MAX_PER_RUN', 60, { min: 1, max: 500 }),
    enrichBatch: int('OUTREACH_ENRICH_BATCH', 50, { min: 1, max: 100 }),
    // Topes de tokens de Claude (entrada + salida).
    llmTokensPerRun: int('OUTREACH_LLM_TOKENS_PER_RUN', 150_000, { min: 1_000 }),
    llmTokensPerDay: int('OUTREACH_LLM_TOKENS_PER_DAY', 600_000, { min: 1_000 }),
    anthropicModel: env('ANTHROPIC_MODEL_FAST') || env('ANTHROPIC_MODEL') || 'claude-opus-5',
    // Fuentes con costo: stubs deshabilitados (ver sources/places.mjs y sources/websearch.mjs).
    placesMaxQueries: int('LEADS_PLACES_MAX_QUERIES', 0),
    websearchMax: int('LEADS_WEBSEARCH_MAX', 0),
  }
}

/**
 * ¿Se puede enviar correo real? (no dry-run). Devuelve {ok, reason}.
 * No revisa la BD (pausa, topes): eso lo hace guardrails.canSend.
 */
export function realSendingBlockers(cfg, legalIsReady) {
  const reasons = []
  if (!cfg.enabled) reasons.push('outreach_disabled')
  if (!legalIsReady) reasons.push('legal_not_ready')
  if (!cfg.liaApproved) reasons.push('lia_not_approved')
  if (cfg.dryRun) reasons.push('dry_run')
  if (cfg.provider === 'dryrun') reasons.push('provider_dryrun')
  return reasons
}
