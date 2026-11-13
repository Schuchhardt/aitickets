// Bandeja de errores de producción (aitickets_error_issues) a partir de los issues de Sentry.
//
// Entradas:
//   - Webhook de una Internal Integration de Sentry (src/pages/api/webhooks/sentry.ts): recursos `issue`
//     (created, resolved, unresolved, ignored…) y `event_alert` (acción de una regla de alerta).
//   - Función programada sentry-sync (cada 30 min): trae de la API los issues vistos en las últimas 24 h. Cubre los
//     webhooks perdidos y mantiene al día conteos y estados.
//
// Sin duplicados: Sentry agrupa los eventos del mismo error en un issue con id estable; la tabla tiene
// sentry_issue_id UNIQUE, el INSERT que pierde la carrera cae a UPDATE, y los avisos a Slack se reclaman con un UPDATE
// condicional (uno solo por issue nuevo y uno por regresión).
//
// El repo es PÚBLICO: nada de esto se publica en GitHub. Títulos, mensajes y breadcrumbs pasan por redactText()
// (correos, RUT, teléfonos, tokens y query strings) antes de guardarse o mostrarse.
//
// Configuración (Netlify, scope Functions): SENTRY_ORG (slug de la organización), SENTRY_API_TOKEN (token de la
// Internal Integration, Issue & Event: Read), SENTRY_CLIENT_SECRET (firma del webhook). SENTRY_PROJECT_ID es opcional
// (por defecto el proyecto del DSN) y SENTRY_API_BASE también (https://sentry.io/api/0).
import { createHmac, timingSafeEqual } from 'node:crypto'
import { notifySlack } from './slack.mjs'

export const ERROR_ISSUES_TABLE = 'aitickets_error_issues'
/** Proyecto del DSN de sentry.server.config.js / sentry.client.config.js. */
export const DEFAULT_SENTRY_PROJECT_ID = '4510110385897472'
export const SYNC_WINDOW_HOURS = 24
/** Un issue nuevo avisa a Slack solo si su primer evento es reciente (la primera sincronización no inunda Slack). */
export const NOTIFY_MAX_AGE_HOURS = 24
const NOTIFY_LEVELS = new Set(['error', 'fatal'])
const SENTRY_STATUSES = new Set(['unresolved', 'resolved', 'ignored'])
const HOUR = 3600 * 1000

// ---------------------------------------------------------------------------
// Datos personales y secretos fuera
// ---------------------------------------------------------------------------

const REDACTIONS = [
  [/(https?:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/g, '$1?[query]'],
  [/eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]+/g, '[token]'],
  [/\b(Bearer|Basic|Token)\s+[\w.~+/=-]{8,}/gi, '$1 [token]'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  [/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, '[rut]'],
  [/(?:\+?56[\s-]?)?\b9[\s-]?\d{4}[\s-]?\d{4}\b/g, '[teléfono]'],
  // Llaves, hashes y tokens largos (letras y dígitos mezclados), también uuids
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g, '[id]'],
]

/** Quita correos, RUT, teléfonos, tokens y query strings de un texto libre (mensajes de error, breadcrumbs). */
export function redactText(value, max = 500) {
  if (value === null || value === undefined) return null
  let out = String(value)
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep)
  return out.length > max ? `${out.slice(0, max - 1)}…` : out
}

// ---------------------------------------------------------------------------
// Firma del webhook
// ---------------------------------------------------------------------------

/**
 * Verifica `sentry-hook-signature`: hex(HMAC-SHA256(client secret, cuerpo crudo)).
 * https://docs.sentry.io/organization/integrations/integration-platform/webhooks/#sentry-hook-signature
 */
export function verifySentrySignature(secret, body, signature) {
  if (!secret || !signature || typeof body !== 'string') return false
  const expected = Buffer.from(createHmac('sha256', String(secret)).update(body, 'utf8').digest('hex'))
  const given = Buffer.from(String(signature).trim())
  return given.length === expected.length && timingSafeEqual(given, expected)
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

const iso = (v) => {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}
const int = (v) => {
  const n = Number.parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 2_000_000_000) : 0
}
const sentryUrl = (v) => {
  try {
    const u = new URL(String(v))
    return u.protocol === 'https:' && (u.hostname === 'sentry.io' || u.hostname.endsWith('.sentry.io')) ? u.toString() : null
  } catch {
    return null
  }
}

/** Issue de Sentry (API o webhook) → columnas de aitickets_error_issues. null si no trae un id válido. */
export function normalizeIssue(issue) {
  const id = String(issue?.id ?? '')
  if (!/^\d{1,30}$/.test(id)) return null
  const status = String(issue.status || 'unresolved')
  return {
    sentry_issue_id: id,
    short_id: issue.shortId ? String(issue.shortId).slice(0, 80) : null,
    title: redactText(issue.title || issue.metadata?.title || issue.metadata?.type || '(sin título)', 500),
    culprit: redactText(issue.culprit, 300),
    level: issue.level ? String(issue.level).slice(0, 20) : null,
    platform: issue.platform ? String(issue.platform).slice(0, 40) : null,
    sentry_status: SENTRY_STATUSES.has(status) ? status : 'unresolved',
    permalink: sentryUrl(issue.permalink || issue.web_url),
    first_seen: iso(issue.firstSeen),
    last_seen: iso(issue.lastSeen),
    event_count: int(issue.count),
    user_count: int(issue.userCount),
  }
}

const later = (a, b) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b)
const earlier = (a, b) => (!a ? b : !b ? a : Date.parse(a) <= Date.parse(b) ? a : b)

export function shouldNotifyNew(row, now = new Date()) {
  if (!row || row.sentry_status !== 'unresolved') return false
  if (row.level && !NOTIFY_LEVELS.has(row.level)) return false
  const first = Date.parse(row.first_seen || row.created_at || '')
  return Number.isFinite(first) && now.getTime() - first <= NOTIFY_MAX_AGE_HOURS * HOUR
}

const slackEscape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function slackMessage(row, kind) {
  const head = kind === 'regressed' ? '♻️ *Volvió un error que estaba resuelto*' : '🐞 *Error nuevo en producción*'
  const ref = row.short_id || `#${row.id}`
  return (
    `${head} (${slackEscape(ref)})\n` +
    `• *Error:* ${slackEscape(row.title)}\n` +
    (row.culprit ? `• *Dónde:* ${slackEscape(row.culprit)}\n` : '') +
    `• *Eventos:* ${row.event_count ?? 0} · *Usuarios:* ${row.user_count ?? 0}\n` +
    (row.permalink ? `<${row.permalink}|Ver en Sentry> · ` : '') +
    `MCP Admin: get_error_issue con short_id ${slackEscape(ref)}`
  )
}

// ---------------------------------------------------------------------------
// Guardar un issue
// ---------------------------------------------------------------------------

/**
 * Inserta o actualiza un issue y avisa a Slack si es nuevo o volvió (una sola vez cada cosa).
 * @returns {Promise<{ ok: true, created: boolean, regressed: boolean, notified: boolean, row: any } | { ok: false, reason: string }>}
 */
export async function ingestIssue(supabase, issue, { now = new Date(), notify = notifySlack } = {}) {
  const n = normalizeIssue(issue)
  if (!n) return { ok: false, reason: 'invalid_issue' }
  const nowIso = now.toISOString()

  const ins = await supabase.from(ERROR_ISSUES_TABLE).insert({ ...n, created_at: nowIso, updated_at: nowIso }).select('*').maybeSingle()
  let row = ins.data
  const created = !ins.error && Boolean(row)
  let regressed = false

  if (ins.error) {
    if (String(ins.error.code) !== '23505') return { ok: false, reason: ins.error.message || 'insert_failed' }
    const { data: current, error } = await supabase.from(ERROR_ISSUES_TABLE).select('*').eq('sentry_issue_id', n.sentry_issue_id).maybeSingle()
    if (error || !current) return { ok: false, reason: error?.message || 'not_found_after_conflict' }

    // Regresión = estaba resuelto, Sentry lo reabre Y llegó un evento nuevo (un "unresolve" manual no avisa).
    // El UPDATE condicional hace que solo una de dos entregas simultáneas la registre.
    const newEvent = n.last_seen && (!current.last_seen || Date.parse(n.last_seen) > Date.parse(current.last_seen))
    if (n.sentry_status === 'unresolved' && current.sentry_status === 'resolved' && newEvent) {
      const r = await supabase
        .from(ERROR_ISSUES_TABLE)
        .update({ sentry_status: 'unresolved', regressed_at: nowIso, triage_status: 'new', updated_at: nowIso })
        .eq('id', current.id)
        .eq('sentry_status', 'resolved')
        .select('id')
      regressed = !r.error && (r.data || []).length > 0
    }

    const patch = {
      short_id: n.short_id || current.short_id,
      title: n.title,
      culprit: n.culprit ?? current.culprit,
      level: n.level || current.level,
      platform: n.platform || current.platform,
      sentry_status: n.sentry_status,
      permalink: n.permalink || current.permalink,
      first_seen: earlier(current.first_seen, n.first_seen),
      last_seen: later(current.last_seen, n.last_seen),
      // La lista de la API cuenta solo el período consultado; el webhook, el total: se guarda el mayor visto.
      event_count: Math.max(current.event_count || 0, n.event_count),
      user_count: Math.max(current.user_count || 0, n.user_count),
      updated_at: nowIso,
    }
    const upd = await supabase.from(ERROR_ISSUES_TABLE).update(patch).eq('id', current.id).select('*').maybeSingle()
    if (upd.error) return { ok: false, reason: upd.error.message || 'update_failed' }
    row = upd.data || { ...current, ...patch }
  }

  let notified = false
  if (regressed && (!row.level || NOTIFY_LEVELS.has(row.level))) {
    await notify(slackMessage(row, 'regressed'))
    notified = true
  } else if (!row.notified_at && shouldNotifyNew(row, now)) {
    const claim = await supabase
      .from(ERROR_ISSUES_TABLE)
      .update({ notified_at: nowIso })
      .eq('id', row.id)
      .is('notified_at', null)
      .select('id')
    if (!claim.error && (claim.data || []).length > 0) {
      await notify(slackMessage(row, 'new'))
      notified = true
    }
  }
  return { ok: true, created, regressed, notified, row }
}

// ---------------------------------------------------------------------------
// API de Sentry
// ---------------------------------------------------------------------------

/** Configuración desde el entorno; null si falta el token o la organización. */
export function sentryConfig(env = process.env) {
  const token = env.SENTRY_API_TOKEN
  const org = env.SENTRY_ORG
  if (!token || !org || !/^[A-Za-z0-9_-]{1,100}$/.test(org)) return null
  const projectId = /^\d{1,30}$/.test(String(env.SENTRY_PROJECT_ID || '')) ? String(env.SENTRY_PROJECT_ID) : DEFAULT_SENTRY_PROJECT_ID
  const apiBase = String(env.SENTRY_API_BASE || 'https://sentry.io/api/0').replace(/\/+$/, '')
  return { token, org, projectId, apiBase }
}

export class SentryApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

function nextCursorUrl(link) {
  // Link: <https://…&cursor=…>; rel="previous"; results="false"; cursor="…", <…>; rel="next"; results="true"; cursor="…"
  for (const part of String(link || '').split(/,\s*(?=<)/)) {
    if (/rel="next"/.test(part) && /results="true"/.test(part)) {
      const m = part.match(/<([^>]+)>/)
      if (m) return m[1]
    }
  }
  return null
}

async function sentryGet(config, url, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const full = url.startsWith('https://') ? url : `${config.apiBase}${url}`
  // El cursor de paginación vuelve como URL absoluta: solo se sigue si es del mismo host de la API.
  if (new URL(full).host !== new URL(config.apiBase).host) throw new SentryApiError('URL de Sentry inesperada', 0)
  const res = await fetchImpl(full, {
    headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new SentryApiError(`Sentry respondió ${res.status}`, res.status)
  return { data: await res.json(), next: nextCursorUrl(res.headers.get('link')) }
}

/** Issues del proyecto vistos en las últimas `hours` horas (cualquier estado), hasta `maxPages` páginas de 100. */
export async function fetchRecentIssues(config, { hours = SYNC_WINDOW_HOURS, maxPages = 3, fetchImpl } = {}) {
  const query = encodeURIComponent(`lastSeen:-${Math.max(1, Math.round(hours))}h`)
  let url = `/organizations/${config.org}/issues/?project=${config.projectId}&query=${query}&statsPeriod=14d&sort=date&limit=100`
  const out = []
  for (let page = 0; url && page < maxPages; page++) {
    const { data, next } = await sentryGet(config, url, { fetchImpl })
    if (!Array.isArray(data)) break
    out.push(...data)
    url = next
  }
  return { issues: out, truncated: Boolean(url) }
}

export async function fetchIssue(config, issueId, { fetchImpl } = {}) {
  if (!/^\d{1,30}$/.test(String(issueId))) throw new SentryApiError('id de issue inválido', 0)
  return (await sentryGet(config, `/organizations/${config.org}/issues/${issueId}/`, { fetchImpl })).data
}

export async function fetchLatestEvent(config, issueId, { fetchImpl } = {}) {
  if (!/^\d{1,30}$/.test(String(issueId))) throw new SentryApiError('id de issue inválido', 0)
  return (await sentryGet(config, `/organizations/${config.org}/issues/${issueId}/events/latest/`, { fetchImpl })).data
}

// ---------------------------------------------------------------------------
// Resumen de un evento (para get_error_issue): lo necesario para arreglar el bug, sin datos personales
// ---------------------------------------------------------------------------

const MAX_FRAMES = 20
const MAX_BREADCRUMBS = 15
const TAG_KEYS = ['environment', 'release', 'transaction', 'url', 'browser', 'os', 'runtime', 'handled', 'mechanism', 'level']

function frameSummary(f) {
  const line = Number(f.lineNo) || null
  const context = Array.isArray(f.context) ? f.context.filter((c) => Array.isArray(c) && c.length >= 2) : []
  return {
    file: f.filename || f.absPath || f.module || null,
    function: f.function || null,
    line,
    column: Number(f.colNo) || null,
    in_app: Boolean(f.inApp),
    // Código fuente alrededor de la línea (el código ya es público; no es dato de usuarios)
    code: context.length ? context.map(([n, src]) => `${n === line ? '>' : ' '} ${n} | ${String(src ?? '').slice(0, 300)}`).join('\n') : null,
  }
}

/** Evento de la API de Sentry → { exceptions, request, tags, breadcrumbs }. */
export function summarizeEvent(event) {
  if (!event || typeof event !== 'object') return null
  const entries = Array.isArray(event.entries) ? event.entries : []
  const entry = (type) => entries.find((e) => e?.type === type)?.data

  const exceptions = (entry('exception')?.values || []).map((ex) => {
    const frames = Array.isArray(ex?.stacktrace?.frames) ? ex.stacktrace.frames : []
    const inApp = frames.filter((f) => f?.inApp)
    // Sentry ordena del más antiguo al más reciente: se muestran primero los últimos (donde se lanzó)
    const chosen = (inApp.length ? inApp : frames).slice(-MAX_FRAMES).reverse().map(frameSummary)
    return {
      type: ex?.type || null,
      value: redactText(ex?.value, 1000),
      handled: ex?.mechanism?.handled ?? null,
      mechanism: ex?.mechanism?.type || null,
      frames: chosen,
      frames_total: frames.length,
      only_in_app: inApp.length > 0,
    }
  })

  const message = entry('message')?.formatted || event.message || null
  const req = entry('request')
  const tags = {}
  for (const t of Array.isArray(event.tags) ? event.tags : []) {
    if (TAG_KEYS.includes(t?.key)) tags[t.key] = redactText(t.value, 200)
  }
  const breadcrumbs = (entry('breadcrumbs')?.values || []).slice(-MAX_BREADCRUMBS).map((b) => ({
    at: b?.timestamp || null,
    category: b?.category || b?.type || null,
    level: b?.level || null,
    message: redactText(b?.message, 300),
    url: b?.data?.url ? redactText(b.data.url, 300) : null,
    status: b?.data?.status_code ?? null,
  }))

  return {
    event_id: event.eventID || event.id || null,
    at: event.dateCreated || null,
    message: redactText(message, 1000),
    exceptions,
    request: req ? { method: req.method || null, url: redactText(req.url, 300) } : null,
    tags,
    breadcrumbs,
  }
}

// ---------------------------------------------------------------------------
// Webhook y sincronización
// ---------------------------------------------------------------------------

/**
 * Aplica un webhook ya verificado.
 * @param {{ resource: string | null, payload: any, config: ReturnType<typeof sentryConfig>, notify?: Function, fetchImpl?: Function }} input
 */
export async function handleSentryWebhook(supabase, { resource, payload, config, notify = notifySlack, fetchImpl = undefined }) {
  if (resource === 'issue') {
    const issue = payload?.data?.issue
    if (!issue) return { ok: true, ignored: 'sin issue' }
    return ingestIssue(supabase, issue, { notify })
  }
  if (resource === 'event_alert' || resource === 'error') {
    const issueId = payload?.data?.event?.issue_id ?? payload?.data?.error?.issue_id
    if (!issueId) return { ok: true, ignored: 'sin issue_id' }
    if (!config) return { ok: true, ignored: 'falta SENTRY_API_TOKEN/SENTRY_ORG para leer el issue' }
    try {
      return ingestIssue(supabase, await fetchIssue(config, issueId, { fetchImpl }), { notify })
    } catch (err) {
      return { ok: false, reason: err?.message || 'sentry_api' }
    }
  }
  return { ok: true, ignored: `recurso ${resource || '(ninguno)'}` }
}

/** Trae los issues recientes y los guarda. Para la función programada sentry-sync. */
export async function runSentrySync(supabase, config, { hours = SYNC_WINDOW_HOURS, notify, fetchImpl, now = () => new Date(), budgetMs = 20_000 } = {}) {
  const started = Date.now()
  const { issues, truncated } = await fetchRecentIssues(config, { hours, fetchImpl })
  const result = { checked: 0, created: 0, regressed: 0, notified: 0, failed: 0, truncated, out_of_time: false }
  for (const issue of issues) {
    if (Date.now() - started > budgetMs) {
      result.out_of_time = true
      break
    }
    const r = await ingestIssue(supabase, issue, { notify, now: now() })
    result.checked++
    if (!r.ok) {
      result.failed++
      continue
    }
    if (r.created) result.created++
    if (r.regressed) result.regressed++
    if (r.notified) result.notified++
  }
  return result
}
