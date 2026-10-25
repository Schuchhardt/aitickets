// Verificación de identidad de productores (Didit: documento + prueba de vida) y titular de la cuenta bancaria.
// Lógica pura (RUT, comparación de titular, firma de webhooks, mapeo de estados) + cliente HTTP de Didit.
// La usan src/lib/producerIdentity.ts y las rutas /api/identity/*.
//
// Didit (https://docs.didit.me):
//   POST {DIDIT_BASE_URL}/v3/session/  header x-api-key, body { workflow_id, vendor_data, callback }
//        → { session_id, url, status, ... }
//   GET  {DIDIT_BASE_URL}/v3/session/{id}/decision/  → { session_id, status, id_verifications: [...] , ... }
//   Webhook: X-Signature-V2 = HMAC-SHA256(secret, JSON canónico del body) y X-Timestamp (±300 s).
//   También acepta X-Signature = HMAC-SHA256(secret, body crudo).
// Variables: DIDIT_API_KEY, DIDIT_WORKFLOW_ID, DIDIT_WEBHOOK_SECRET y opcional DIDIT_BASE_URL.
// Solo se guarda el resultado (estado, nombre y RUT): las imágenes quedan en Didit.
import { createHmac, timingSafeEqual } from 'node:crypto'

function env(name) {
  try {
    const value = globalThis.process?.env?.[name]
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  } catch {
    return ''
  }
}

export const DIDIT_DEFAULT_BASE_URL = 'https://verification.didit.me'
export const WEBHOOK_TOLERANCE_SECONDS = 300

/** Texto del consentimiento expreso para datos biométricos (se muestra junto a la casilla). */
export const BIOMETRIC_CONSENT_TEXT =
  'Autorizo el tratamiento de mis datos biométricos (selfie y prueba de vida) por Didit para verificar mi identidad, según el Aviso de privacidad.'

/** Explicación de una línea que se muestra cuando se pide la verificación. */
export const IDENTITY_WHY_TEXT = 'Verificamos tu identidad para proteger a tus compradores y poder transferirte lo recaudado.'

export class DiditError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'DiditError'
    this.code = code
    this.status = status
  }
}

export function diditConfig(getEnv = env) {
  const apiKey = getEnv('DIDIT_API_KEY')
  const workflowId = getEnv('DIDIT_WORKFLOW_ID')
  const webhookSecret = getEnv('DIDIT_WEBHOOK_SECRET')
  const baseUrl = (getEnv('DIDIT_BASE_URL') || DIDIT_DEFAULT_BASE_URL).replace(/\/+$/, '')
  return { apiKey, workflowId, webhookSecret, baseUrl, configured: Boolean(apiKey && workflowId) }
}

// ---------------------------------------------------------------------------
// RUT
// ---------------------------------------------------------------------------

/** Dígito verificador (módulo 11) de un cuerpo de RUT. */
export function rutCheckDigit(body) {
  let sum = 0
  let mul = 2
  for (let i = String(body).length - 1; i >= 0; i--) {
    sum += Number(String(body)[i]) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const dv = 11 - (sum % 11)
  return dv === 11 ? '0' : dv === 10 ? 'K' : String(dv)
}

/** "12.345.678-5" / "123456785" / "12345678-k" → "12345678-5" (DV en mayúscula). null si no es un RUT válido. */
export function normalizeRut(value) {
  const clean = String(value ?? '').replace(/[^0-9kK]/g, '').toUpperCase()
  if (clean.length < 2 || clean.length > 9) return null
  const body = clean.slice(0, -1).replace(/^0+/, '')
  const dv = clean.slice(-1)
  if (!/^\d{1,8}$/.test(body) || rutCheckDigit(body) !== dv) return null
  return `${body}-${dv}`
}

export function sameRut(a, b) {
  const na = normalizeRut(a)
  return Boolean(na && na === normalizeRut(b))
}

// ---------------------------------------------------------------------------
// Titular de la cuenta = identidad verificada
// ---------------------------------------------------------------------------

const NAME_STOPWORDS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'van', 'von'])

export function nameTokens(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NAME_STOPWORDS.has(w))
}

/** true si los nombres comparten al menos un nombre o apellido (comparación laxa: el banco y Didit los escriben distinto). */
export function namesOverlap(a, b) {
  const ta = new Set(nameTokens(a))
  if (!ta.size) return false
  return nameTokens(b).some((w) => ta.has(w))
}

/**
 * Compara el titular de la cuenta bancaria con la identidad verificada.
 *   org: { identity_status, identity_rut, identity_name, legal_id | legal_rut }
 *   acc: { bank_account_rut, bank_account_holder, legal_rut }
 * Devuelve { status: 'match'|'mismatch'|'pending', reason }.
 *   - pending: sin identidad aprobada o sin cuenta completa.
 *   - match: RUT del titular = RUT verificado (y el nombre coincide en al menos una palabra), o
 *            RUT del titular = RUT de la empresa (el verificado es su representante legal).
 *   - mismatch: cualquier otro caso (cuenta de un tercero).
 */
export function computeHolderMatch(org, acc) {
  if (!acc?.bank_account_rut) return { status: 'pending', reason: 'Sin cuenta bancaria registrada.' }
  if (org?.identity_status !== 'approved' || !normalizeRut(org?.identity_rut)) {
    return { status: 'pending', reason: 'La identidad del productor aún no está verificada.' }
  }
  const holderRut = normalizeRut(acc.bank_account_rut)
  if (!holderRut) return { status: 'mismatch', reason: 'El RUT del titular de la cuenta no es válido.' }
  if (holderRut === normalizeRut(org.identity_rut)) {
    if (acc.bank_account_holder && org.identity_name && !namesOverlap(acc.bank_account_holder, org.identity_name)) {
      return { status: 'mismatch', reason: 'El RUT coincide con la identidad verificada, pero el nombre del titular no.' }
    }
    return { status: 'match', reason: 'El titular es la persona verificada.' }
  }
  const companyRut = normalizeRut(org.legal_rut ?? org.legal_id ?? acc.legal_rut)
  if (companyRut && holderRut === companyRut) {
    return { status: 'match', reason: 'El titular es la organización; la persona verificada es su representante.' }
  }
  return { status: 'mismatch', reason: 'El RUT del titular de la cuenta no coincide con la identidad verificada ni con el RUT de la organización.' }
}

/** person | company: company cuando la organización tiene un RUT distinto al de la persona verificada. */
export function identityKind(identityRut, legalRut) {
  const company = normalizeRut(legalRut)
  return company && company !== normalizeRut(identityRut) ? 'company' : 'person'
}

// ---------------------------------------------------------------------------
// Didit: estados, decisión y firma de webhooks
// ---------------------------------------------------------------------------

/** Estado de Didit → identity_status. null = no cambia nada (p. ej. "Not Started"). */
export function mapDiditStatus(status) {
  switch (String(status || '').trim().toLowerCase()) {
    case 'approved':
      return 'approved'
    case 'declined':
      return 'declined'
    case 'in review':
      return 'in_review'
    case 'in progress':
    case 'resubmitted':
    case 'awaiting user':
    case 'not started':
      return 'pending'
    // Abandonada o vencida: el productor debe empezar de nuevo
    case 'abandoned':
    case 'expired':
    case 'kyc expired':
      return 'declined'
    default:
      return null
  }
}

const pick = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return null
}

/**
 * Nombre y RUT de la decisión de Didit. Usa id_verifications[] (v3) o id_verification (v2). En cédulas
 * chilenas el RUN viene como personal_number o document_number según el documento: se toma el primero
 * que sea un RUT válido.
 */
export function extractIdentity(decision) {
  const list = Array.isArray(decision?.id_verifications) ? decision.id_verifications : decision?.id_verification ? [decision.id_verification] : []
  const idv = list.find((v) => String(v?.status || '').toLowerCase() === 'approved') || list[0] || null
  if (!idv) return { name: null, rut: null }
  const first = pick(idv, ['first_name', 'given_names'])
  const last = pick(idv, ['last_name', 'surname', 'family_name'])
  const name = pick(idv, ['full_name']) || [first, last].filter(Boolean).join(' ') || null
  let rut = null
  for (const key of ['personal_number', 'document_number', 'national_id', 'tax_id']) {
    const r = normalizeRut(idv[key])
    if (r) {
      rut = r
      break
    }
  }
  return { name, rut }
}

/** JSON canónico de Didit (X-Signature-V2): claves ordenadas, separadores compactos, Unicode tal cual. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) return String(value)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
    .join(',')}}`
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || '').trim().toLowerCase(), 'utf8')
  const y = Buffer.from(String(b || '').trim().toLowerCase(), 'utf8')
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

const hmac = (secret, data) => createHmac('sha256', secret).update(data, 'utf8').digest('hex')

/**
 * Verifica un webhook de Didit. headers: objeto o Headers. Acepta X-Signature-V2 (JSON canónico) o
 * X-Signature (body crudo). Exige X-Timestamp dentro de ±300 s cuando viene.
 * Devuelve { ok, error?, payload? }.
 */
export function verifyDiditWebhook({ rawBody, headers, secret, now = Date.now() }) {
  if (!secret) return { ok: false, error: 'DIDIT_WEBHOOK_SECRET no configurado' }
  const get = (name) => (typeof headers?.get === 'function' ? headers.get(name) : headers?.[name] ?? headers?.[name.toLowerCase()]) || ''
  const timestamp = get('x-timestamp')
  if (timestamp) {
    const ts = Number(timestamp)
    if (!Number.isFinite(ts) || Math.abs(Math.floor(now / 1000) - ts) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, error: 'Timestamp fuera de rango' }
  }
  let payload
  try {
    payload = JSON.parse(String(rawBody || ''))
  } catch {
    return { ok: false, error: 'Body inválido' }
  }
  const v2 = get('x-signature-v2')
  if (v2 && safeEqualHex(v2, hmac(secret, canonicalJson(payload)))) return { ok: true, payload }
  const raw = get('x-signature')
  if (raw && safeEqualHex(raw, hmac(secret, String(rawBody)))) return { ok: true, payload }
  return { ok: false, error: 'Firma inválida' }
}

/** vendor_data con el que se identifica la organización en Didit. */
export const vendorDataFor = (orgId) => `org:${Number(orgId)}`
export function orgIdFromVendorData(vendorData) {
  const m = /^org:(\d+)$/.exec(String(vendorData || '').trim())
  return m ? Number(m[1]) : null
}

// ---------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------

async function diditFetch(path, { method = 'GET', body, config = diditConfig(), fetchImpl = fetch } = {}) {
  if (!config.configured) throw new DiditError('not_configured', 'La verificación de identidad no está disponible por ahora. Escríbenos a soporte.')
  let res
  try {
    res = await fetchImpl(`${config.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-api-key': config.apiKey },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    })
  } catch (err) {
    throw new DiditError('unavailable', `No pudimos conectar con el servicio de verificación (${err?.message || 'error de red'}).`)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = data?.detail || data?.message || data?.error || `HTTP ${res.status}`
    throw new DiditError('provider_error', `El servicio de verificación respondió con un error (${typeof detail === 'string' ? detail : res.status}).`, res.status)
  }
  return data
}

/** Crea (o reutiliza: Didit devuelve la sesión abierta con el mismo workflow y vendor_data) una sesión. */
export async function createDiditSession({ orgId, callback, config, fetchImpl } = {}) {
  const cfg = config || diditConfig()
  const data = await diditFetch('/v3/session/', {
    method: 'POST',
    body: { workflow_id: cfg.workflowId, vendor_data: vendorDataFor(orgId), callback, language: 'es' },
    config: cfg,
    fetchImpl,
  })
  if (!data?.session_id || !data?.url) throw new DiditError('provider_error', 'El servicio de verificación no devolvió un link válido.')
  return { sessionId: String(data.session_id), url: String(data.url), status: data.status || null }
}

export async function getDiditDecision(sessionId, { config, fetchImpl } = {}) {
  return diditFetch(`/v3/session/${encodeURIComponent(sessionId)}/decision/`, { config, fetchImpl })
}
