// Anuncios pagados en Meta (Facebook e Instagram) vía Zernio: https://docs.zernio.com/platforms/meta-ads
// (contrato de la API: https://zernio.com/openapi.json). Lo usan las rutas /api/promote/ads/* del panel y el reporte
// semanal a productores. Solo servidor.
//
// Por qué Zernio: es Meta Marketing Partner, así que AI Tickets no necesita app propia ni App Review de
// ads_management. La productora autoriza su cuenta publicitaria una vez (conexión de anuncios de su perfil de Zernio,
// el mismo que ya usa para publicar posts) y Meta le cobra el gasto directo a esa cuenta: AI Tickets no toca ese dinero.
//
// Reglas (pedido del dueño, oct 2026):
//   * Objetivo "tráfico" a la página del evento, con botón "Comprar entradas". El link lleva
//     utm_source=meta&utm_medium=paid&utm_campaign=ad-<id>: cada venta queda atribuida a su anuncio.
//   * Presupuesto DIARIO en unidades enteras de la moneda de la cuenta publicitaria (CLP 5000 = $5.000; Zernio convierte
//     a lo que pide Meta), entre el mínimo de la cuenta y un tope de cordura; de 1 a 30 días y nunca más allá del
//     evento. Gasto máximo = diario × días, y la productora lo confirma explícitamente antes de crear.
//   * Público: Chile entero o una ciudad con radio (Meta exige ~17 km mínimo), edad 18 a 65 por defecto y, si la
//     productora quiere, hasta 3 intereses y hasta 3 cargos (ids de Meta del buscador de Zernio, dimensiones
//     interest y workPosition: https://docs.zernio.com/ad-targeting/search-ad-targeting).
//   * Se publica al tiro o queda pausado (solo el anuncio: reanudarlo lo deja corriendo).
//   * Cada creación lleva Idempotency-Key: un doble clic o un reintento nunca crea dos anuncios.
import { SITE_URL } from './mailer.mjs'
import { isCourtesyOrder, isTransferOrder, orderSoldQty } from './order-kinds.mjs'

export const ZERNIO_API = 'https://zernio.com/api/v1'
const REQUEST_TIMEOUT_MS = 25_000

const env = (name) => {
  const value = globalThis.process?.env?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

/** Anuncios disponibles: hay ZERNIO_API_KEY y no se apagaron con ADS_ENABLED=false. */
export const adsEnabled = () => Boolean(env('ZERNIO_API_KEY')) && env('ADS_ENABLED').toLowerCase() !== 'false'

export const AD_LIMITS = Object.freeze({
  minDays: 1,
  maxDays: 30,
  minAge: 13,
  maxAge: 65,
  defaultAgeMin: 18,
  headlineMax: 40,
  bodyMax: 1000,
  /** Radios de ciudad que ofrece el panel (Meta no entrega con menos de ~17 km). */
  cityRadiiKm: [17, 25, 40, 80],
  /** Cuánto antes puede programarse el inicio. */
  maxStartDaysAhead: 60,
  /** Intereses y cargos por anuncio (cada lista). Meta los combina con O dentro de la lista. */
  maxInterests: 3,
  maxWorkPositions: 3,
})

/** Botones que el panel ofrece (subconjunto de los callToAction de Meta que Zernio acepta en create y boost). */
export const AD_CALLS_TO_ACTION = Object.freeze({ BUY_TICKETS: 'Comprar entradas', LEARN_MORE: 'Más información', BOOK_NOW: 'Reservar', SIGN_UP: 'Registrarse' })

/** Tope de cordura del presupuesto diario por moneda (contra un cero de más). Otras monedas: sin tope, solo la confirmación. */
export const DAILY_BUDGET_SANITY_CAP = Object.freeze({ CLP: 1_000_000, USD: 1_000, EUR: 1_000 })

/** utm_campaign de un anuncio creado desde AI Tickets (y al revés, el id de ad_campaigns desde el utm_campaign). */
export const adTrackingCampaign = (adCampaignId) => `ad-${adCampaignId}`
export const adCampaignIdFromUtm = (utmCampaign) => {
  const m = /^ad-(\d{1,12})$/.exec(String(utmCampaign || '').trim().toLowerCase())
  return m ? Number(m[1]) : null
}

/** Link del evento para un anuncio: Meta como fuente pagada y el anuncio como campaña. */
export function adTrackingUrl(slug, adCampaignId) {
  const url = new URL(`${SITE_URL}/eventos/${encodeURIComponent(slug || '')}`)
  url.searchParams.set('utm_source', 'meta')
  url.searchParams.set('utm_medium', 'paid')
  url.searchParams.set('utm_campaign', adTrackingCampaign(adCampaignId))
  return url.toString()
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** Error de Zernio con lo necesario para decidir y para mostrarle algo útil a la productora (friendlyAdsError). */
export class ZernioError extends Error {
  constructor(status, body = {}) {
    super(String(body?.error || body?.message || `Zernio respondió ${status}`).slice(0, 500))
    this.name = 'ZernioError'
    this.status = Number(status) || 0
    this.code = body?.code || null
    this.type = body?.type || null
    this.userMessage = body?.platformError?.error_user_msg || null
  }
}

/**
 * Llamada a la API de Zernio. query: valores null/undefined se omiten. Lanza ZernioError si no es 2xx.
 * @param {string} path p. ej. '/ads/create'
 * @param {{ method?: string, query?: Record<string, any>, body?: any, idempotencyKey?: string, timeoutMs?: number }} [opts]
 */
export async function zernioRequest(path, { method = 'GET', query, body, idempotencyKey, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const apiKey = env('ZERNIO_API_KEY')
  if (!apiKey) throw new ZernioError(0, { error: 'Zernio no está configurado (ZERNIO_API_KEY)', code: 'not_configured' })
  const url = new URL(`${ZERNIO_API}${path}`)
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)))
    else url.searchParams.set(k, String(v))
  }
  const headers = { Authorization: `Bearer ${apiKey}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 255)
  const res = await globalThis.fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ZernioError(res.status, data)
  return data
}

/** Mensaje en español para el panel a partir de un error de Zernio/Meta. */
export function friendlyAdsError(err) {
  const code = err?.code
  const status = err?.status
  if (code === 'not_configured') return 'Los anuncios no están configurados en AI Tickets. Escríbenos y lo activamos.'
  if (code === 'ads_allowance_exceeded' || code === 'ads_addon_required' || code === 'payment_required') return 'Los anuncios no están disponibles en este momento. Escríbenos y lo revisamos.'
  if (code === 'ad_account_not_selected') return 'Esa cuenta publicitaria no está autorizada. Vuelve a conectar tu cuenta de Meta y márcala.'
  if (code === 'ads_connection_required' || code === 'reconnect_required' || status === 409) return 'Tu conexión con Meta venció. Vuelve a conectar tu cuenta publicitaria.'
  if (code === 'linked_account_required' || status === 422) return 'Tu Instagram no está vinculado a una página de Facebook con cuenta publicitaria. Conecta Facebook y vuelve a intentarlo.'
  if (code === 'rate_limited' || status === 429) return 'Meta está limitando las solicitudes. Intenta de nuevo en un minuto.'
  if (err?.userMessage) return `Meta rechazó el anuncio: ${String(err.userMessage).slice(0, 300)}`
  if (status >= 400 && status < 500 && err?.message) return `No se pudo crear el anuncio: ${String(err.message).slice(0, 300)}`
  return 'Meta no respondió. Intenta de nuevo en unos minutos.'
}

// ---------------------------------------------------------------------------
// Perfil, conexión y cuentas publicitarias
// ---------------------------------------------------------------------------

/** Perfil de Zernio de la organización (se crea la primera vez). El mismo que usa la publicación de posts. */
export async function ensureZernioProfile(supabase, organizationId) {
  const { data: org, error } = await supabase.from('organizations').select('zernio_profile_id, public_name').eq('id', organizationId).maybeSingle()
  if (error) throw error
  if (org?.zernio_profile_id) return org.zernio_profile_id
  const created = await zernioRequest('/profiles', { method: 'POST', body: { name: org?.public_name || `Org ${organizationId}` } })
  const profileId = created?.profile?._id
  if (!profileId) throw new ZernioError(502, { error: 'Zernio no devolvió el perfil' })
  const { error: upError } = await supabase.from('organizations').update({ zernio_profile_id: profileId }).eq('id', organizationId)
  if (upError) throw upError
  return profileId
}

/**
 * Inicia la conexión de anuncios de Meta. Con la cuenta de Facebook ya autorizada para anuncios responde
 * { alreadyConnected: true, accountId }; si no, { authUrl } para abrir el diálogo de Meta.
 */
export function startAdsConnection({ profileId, redirectUrl, postingAccountId }) {
  return zernioRequest('/connect/facebook/ads', { query: { profileId, redirect_url: redirectUrl, accountId: postingAccountId } })
}

/** ¿La conexión de anuncios pertenece al perfil de la organización? Falla cerrado. */
export async function adsAccountBelongsToProfile(adsAccountId, profileId) {
  try {
    const data = await zernioRequest('/accounts', { query: { profileId } })
    const list = Array.isArray(data) ? data : Array.isArray(data?.accounts) ? data.accounts : []
    const idOf = (v) => (typeof v === 'string' ? v : v?._id ? String(v._id) : v?.id ? String(v.id) : null)
    const acct = list.find((a) => idOf(a) === adsAccountId)
    if (!acct) return false
    const owner = idOf(acct.profileId ?? acct.profile)
    return !owner || owner === profileId
  } catch (err) {
    console.error('[ads] no se pudo verificar la conexión de anuncios:', err?.status || '', err?.message)
    return false
  }
}

/** Fila de ad_account_connections para una cuenta publicitaria de Meta. */
export function adAccountRow(organizationId, adsAccountId, acct, now = new Date()) {
  const usable = acct?.selectable !== false && acct?.selected !== false
  return {
    organization_id: organizationId,
    provider: 'zernio',
    platform: 'meta',
    zernio_account_id: adsAccountId,
    meta_ad_account_id: String(acct.id),
    account_name: String(acct.name || acct.id).slice(0, 200),
    currency: acct.currency ? String(acct.currency).toUpperCase().slice(0, 3) : null,
    timezone_name: acct.timezoneName || null,
    minimum_daily_budget: Number.isFinite(Number(acct.minimumDailyBudget)) ? Number(acct.minimumDailyBudget) : null,
    status: usable ? 'active' : 'unusable',
    unusable_reason: usable ? null : String(acct.unusableReason || 'No está habilitada para anunciar').slice(0, 300),
    updated_at: now.toISOString(),
  }
}

/**
 * Trae las cuentas publicitarias de la conexión y las guarda en ad_account_connections (provider zernio).
 * Las que la conexión ya no ve quedan 'unusable'. Devuelve las filas vigentes.
 */
export async function syncAdAccounts(supabase, organizationId, adsAccountId, { now = new Date() } = {}) {
  const data = await zernioRequest('/ads/accounts', { query: { accountId: adsAccountId } })
  const accounts = (Array.isArray(data?.accounts) ? data.accounts : []).filter((a) => /^act_\d+$/.test(String(a?.id || '')))
  const { data: existing, error } = await supabase
    .from('ad_account_connections')
    .select('id, meta_ad_account_id, zernio_account_id, status')
    .eq('organization_id', organizationId)
    .eq('provider', 'zernio')
  if (error) throw error
  const byAct = new Map((existing || []).map((r) => [r.meta_ad_account_id, r]))
  const seen = new Set()
  for (const acct of accounts) {
    const row = adAccountRow(organizationId, adsAccountId, acct, now)
    seen.add(row.meta_ad_account_id)
    const prev = byAct.get(row.meta_ad_account_id)
    const { error: wError } = prev
      ? await supabase.from('ad_account_connections').update(row).eq('id', prev.id).eq('organization_id', organizationId)
      : await supabase.from('ad_account_connections').insert(row)
    if (wError) throw wError
  }
  for (const prev of existing || []) {
    if (prev.zernio_account_id === adsAccountId && !seen.has(prev.meta_ad_account_id) && prev.status === 'active') {
      await supabase
        .from('ad_account_connections')
        .update({ status: 'unusable', unusable_reason: 'Meta ya no autoriza esta cuenta para AI Tickets', updated_at: now.toISOString() })
        .eq('id', prev.id)
        .eq('organization_id', organizationId)
    }
  }
  return accounts.length
}

/** Ciudades de Chile para segmentar (ids de Meta). */
export async function searchAdCities(adsAccountId, q) {
  const data = await zernioRequest('/ads/targeting/search', {
    query: { accountId: adsAccountId, q: String(q).slice(0, 80), dimension: 'geo', geoType: 'city', countryCode: 'CL', locale: 'es_LA', limit: 8 },
  })
  return (Array.isArray(data?.results) ? data.results : [])
    .filter((r) => r?.id && r?.name)
    .map((r) => ({ key: String(r.id), name: String(r.name), path: Array.isArray(r.path) ? r.path.map(String).slice(0, 4) : [] }))
}

/** Qué busca el buscador de público: intereses (gustos) o cargos (profesión). Dimensiones de Zernio, solo Meta. */
export const AUDIENCE_DIMENSIONS = Object.freeze({ interest: 'interests', workPosition: 'workPositions' })

/** Intereses o cargos de Meta para segmentar (ids opacos de Meta, con su tamaño de público si Meta lo informa). */
export async function searchAdAudience(adsAccountId, q, dimension = 'interest') {
  if (!Object.hasOwn(AUDIENCE_DIMENSIONS, dimension)) throw new ZernioError(400, { error: 'Dimensión no soportada', code: 'invalid_dimension' })
  const data = await zernioRequest('/ads/targeting/search', {
    query: { accountId: adsAccountId, q: String(q).slice(0, 80), dimension, locale: 'es_LA', limit: 8 },
  })
  return (Array.isArray(data?.results) ? data.results : [])
    .filter((r) => r?.id && r?.name)
    .map((r) => ({
      id: String(r.id),
      name: String(r.name).slice(0, 120),
      path: Array.isArray(r.path) ? r.path.map(String).slice(0, 4) : [],
      audienceSize: Number.isFinite(Number(r.audienceSize)) && r.audienceSize !== null ? Number(r.audienceSize) : null,
    }))
}

// ---------------------------------------------------------------------------
// Validación y armado del anuncio
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000
const isHttpsUrl = (v) => typeof v === 'string' && v.length <= 1000 && /^https:\/\/[^\s]+$/.test(v)
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max)

/** "$5.000" (CLP) o "USD 12" para mensajes. */
export function formatBudget(amount, currency = 'CLP') {
  const n = Number(amount) || 0
  if (!currency || currency === 'CLP') return `$${Math.round(n).toLocaleString('es-CL')}`
  return `${currency} ${n.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`
}

/** Monto en unidades enteras de la moneda (CLP sin decimales; el resto con hasta 2). */
const roundBudget = (amount, currency) => (currency === 'CLP' || !currency ? Math.round(amount) : Math.round(amount * 100) / 100)

/**
 * Valida lo que pide el panel y devuelve los valores normalizados. Nunca confía en el cliente para el gasto: el total
 * se recalcula (diario × días) y debe coincidir con el que la productora confirmó.
 * @param {any} raw cuerpo de POST /api/promote/ads/create
 * @param {{ connection: any, event: any, post?: any, now?: Date }} ctx
 * @returns {{ ok: true, value: any } | { ok: false, errors: string[] }}
 */
export function validateAdInput(raw, { connection, event, post = null, now = new Date() }) {
  const errors = []
  const currency = String(connection?.currency || 'CLP').toUpperCase()
  const type = raw?.type === 'boost' ? 'boost' : 'standalone'

  const daily = roundBudget(Number(raw?.dailyBudget), currency)
  const min = Number(connection?.minimum_daily_budget) > 0 ? Number(connection.minimum_daily_budget) : currency === 'CLP' ? 1000 : 1
  const cap = DAILY_BUDGET_SANITY_CAP[currency]
  if (!Number.isFinite(daily) || daily <= 0) errors.push('Indica un presupuesto diario.')
  else if (daily < min) errors.push(`El presupuesto diario mínimo de tu cuenta publicitaria es ${formatBudget(min, currency)}.`)
  else if (cap && daily > cap) errors.push(`El presupuesto diario máximo desde AI Tickets es ${formatBudget(cap, currency)}.`)

  const days = Number(raw?.days)
  if (!Number.isInteger(days) || days < AD_LIMITS.minDays || days > AD_LIMITS.maxDays) errors.push(`La duración debe ser de ${AD_LIMITS.minDays} a ${AD_LIMITS.maxDays} días.`)

  let start = now
  if (raw?.startDate) {
    const t = Date.parse(raw.startDate)
    if (!Number.isFinite(t)) errors.push('La fecha de inicio no es válida.')
    else if (t > now.getTime() + AD_LIMITS.maxStartDaysAhead * DAY_MS) errors.push(`El inicio no puede ser más de ${AD_LIMITS.maxStartDaysAhead} días en el futuro.`)
    else if (t > now.getTime()) start = new Date(t)
  }
  const end = Number.isInteger(days) ? new Date(start.getTime() + days * DAY_MS) : null
  const eventEnds = Date.parse(event?.end_date || event?.start_date)
  if (end && Number.isFinite(eventEnds) && end.getTime() > eventEnds) errors.push('El anuncio terminaría después del evento: elige menos días.')

  const totalBudget = Number.isFinite(daily) && Number.isInteger(days) ? roundBudget(daily * days, currency) : null
  if (raw?.confirmSpend !== true || roundBudget(Number(raw?.confirmTotal), currency) !== totalBudget) {
    errors.push('Confirma el gasto máximo del anuncio antes de crearlo.')
  }

  const ageMin = raw?.ageMin == null ? AD_LIMITS.defaultAgeMin : Number(raw.ageMin)
  const ageMax = raw?.ageMax == null ? AD_LIMITS.maxAge : Number(raw.ageMax)
  if (![ageMin, ageMax].every((a) => Number.isInteger(a) && a >= AD_LIMITS.minAge && a <= AD_LIMITS.maxAge) || ageMin > ageMax) {
    errors.push(`La edad debe estar entre ${AD_LIMITS.minAge} y ${AD_LIMITS.maxAge} años.`)
  }

  let geo = { type: 'country', countries: ['CL'], label: 'Todo Chile' }
  if (raw?.geo?.type === 'city') {
    const key = String(raw.geo.key || '')
    const radius = Number(raw.geo.radiusKm)
    if (!/^\d{1,20}$/.test(key)) errors.push('Elige la ciudad desde el buscador.')
    else if (!AD_LIMITS.cityRadiiKm.includes(radius)) errors.push('Elige un radio válido para la ciudad.')
    else geo = { type: 'city', key, radiusKm: radius, label: `${cleanText(raw.geo.name, 80) || 'Ciudad'} + ${radius} km` }
  }

  const interests = audienceList(raw?.interests, AD_LIMITS.maxInterests, 'intereses', errors)
  const workPositions = audienceList(raw?.workPositions, AD_LIMITS.maxWorkPositions, 'cargos', errors)

  const callToAction = Object.hasOwn(AD_CALLS_TO_ACTION, raw?.callToAction) ? raw.callToAction : 'BUY_TICKETS'
  const value = { type, currency, dailyBudget: daily, days, totalBudget, startDate: start, endDate: end, ageMin, ageMax, geo, interests, workPositions, callToAction, launch: raw?.launch === 'paused' ? 'paused' : 'now' }

  if (type === 'standalone') {
    value.headline = cleanText(raw?.headline, AD_LIMITS.headlineMax)
    value.body = cleanText(raw?.body, AD_LIMITS.bodyMax)
    value.imageUrl = String(raw?.imageUrl || '').trim()
    if (!value.headline) errors.push('Escribe el título del anuncio.')
    if (!value.body) errors.push('Escribe el texto del anuncio.')
    if (!isHttpsUrl(value.imageUrl)) errors.push('El anuncio necesita una imagen.')
  } else if (!post?.zernio_post_id || post.status !== 'published') {
    errors.push('Solo se pueden promocionar publicaciones hechas desde AI Tickets.')
  }

  return errors.length ? { ok: false, errors } : { ok: true, value }
}

/** Intereses o cargos elegidos en el buscador: [{ id, name }] sin repetidos, como mucho `max`. */
function audienceList(raw, max, label, errors) {
  if (raw == null) return []
  if (!Array.isArray(raw)) {
    errors.push(`Los ${label} no son válidos.`)
    return []
  }
  const out = []
  for (const item of raw) {
    const id = String(item?.id ?? '').trim()
    if (!/^\d{1,25}$/.test(id)) {
      errors.push(`Elige los ${label} desde el buscador.`)
      return []
    }
    if (!out.some((x) => x.id === id)) out.push({ id, name: cleanText(item?.name, 120) || id })
  }
  if (out.length > max) errors.push(`Elige como mucho ${max} ${label}.`)
  return out.slice(0, max)
}

/** Segmentación (TargetingSpec de Zernio, igual en create y boost). Intereses y cargos solo si se eligieron. */
export function adTargeting(value) {
  const geo = value.geo?.type === 'city'
    ? { cities: [{ key: value.geo.key, radius: value.geo.radiusKm, distance_unit: 'kilometer' }] }
    : { countries: ['CL'] }
  return {
    ...geo,
    ageMin: value.ageMin,
    ageMax: value.ageMax,
    ...(value.interests?.length ? { interests: value.interests.map(({ id, name }) => ({ id, name })) } : {}),
    ...(value.workPositions?.length ? { workPositions: value.workPositions.map(({ id, name }) => ({ id, name })) } : {}),
  }
}

/** Nombre del anuncio en Meta (máx. 255): se reconoce en el Ads Manager de la productora. */
export const adName = (eventName, adCampaignId) => `${String(eventName || 'Evento').slice(0, 200)} · AI Tickets #${adCampaignId}`

/**
 * Cuerpo de POST /v1/ads/create (anuncio nuevo) o POST /v1/ads/boost (post publicado).
 * @param {{ adCampaignId: number, value: any, connection: any, event: any, post?: any, boostAccountId?: string | null }} p
 */
export function buildAdRequest({ adCampaignId, value, connection, event, post = null, boostAccountId = null }) {
  const common = {
    adAccountId: connection.meta_ad_account_id,
    name: adName(event.name || event.title, adCampaignId),
    goal: 'traffic',
    budgetAmount: value.dailyBudget,
    budgetType: 'daily',
    currency: value.currency,
    startDate: value.startDate.toISOString(),
    endDate: value.endDate.toISOString(),
    targeting: adTargeting(value),
    callToAction: value.callToAction,
    linkUrl: adTrackingUrl(event.slug, adCampaignId),
    ...(value.launch === 'paused' ? { adStatus: 'PAUSED' } : {}),
  }
  if (value.type === 'boost') {
    return { path: '/ads/boost', body: { ...common, accountId: boostAccountId || connection.zernio_account_id, postId: post.zernio_post_id } }
  }
  return {
    path: '/ads/create',
    body: {
      ...common,
      accountId: connection.zernio_account_id,
      headline: value.headline,
      body: value.body,
      imageUrl: value.imageUrl,
      // Las imágenes generadas con IA en AI Tickets se guardan como promote/<org>-ai-…: Meta pide declararlo
      ...(/\/promote\/\d+-ai-/.test(value.imageUrl) ? { aiDisclosure: 'OPT_IN' } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// Estado y métricas
// ---------------------------------------------------------------------------

export const AD_STATUSES = Object.freeze(['active', 'paused', 'pending_review', 'rejected', 'completed', 'cancelled', 'error'])

/** Cambios para ad_campaigns a partir del anuncio de Zernio (estado, revisión, ids). */
export function adRowPatch(ad) {
  if (!ad || typeof ad !== 'object') return {}
  const patch = {}
  if (ad._id) patch.zernio_ad_id = String(ad._id)
  if (AD_STATUSES.includes(ad.status)) patch.status = ad.status
  if (ad.reviewStatus) patch.review_status = String(ad.reviewStatus).slice(0, 40)
  if (ad.reviewStatus === 'rejected') patch.status = 'rejected'
  if (ad.rejectionReason) patch.error_message = String(ad.rejectionReason).slice(0, 500)
  if (ad.platformCampaignId) patch.meta_campaign_id = String(ad.platformCampaignId)
  if (ad.platformAdSetId) patch.meta_adset_id = String(ad.platformAdSetId)
  if (ad.platformAdId) patch.meta_ad_id = String(ad.platformAdId)
  return patch
}

/** Métricas de ad_campaigns desde el summary de /v1/ads/{adId}/analytics (gasto en la moneda de la cuenta). */
export function metricsPatch(summary) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  return {
    spend: num(summary?.spend),
    impressions: Math.round(num(summary?.impressions)),
    reach: Math.round(num(summary?.reach)),
    clicks: Math.round(num(summary?.clicks)),
    ctr: num(summary?.ctr),
    cpc: num(summary?.cpc),
    cpm: num(summary?.cpm),
    conversions: Math.round(num(summary?.conversions)),
  }
}

const ymd = (d) => new Date(d).toISOString().slice(0, 10)

/** Resumen de un anuncio entre dos fechas (YYYY-MM-DD, máx. 730 días). */
export async function adAnalyticsSummary(zernioAdId, fromDate, toDate, { timeoutMs } = {}) {
  const data = await zernioRequest(`/ads/${encodeURIComponent(zernioAdId)}/analytics`, { query: { fromDate, toDate }, timeoutMs })
  return { summary: data?.analytics?.summary || {}, currency: data?.ad?.currency || null, status: data?.ad?.status || null }
}

/**
 * Trae estado y métricas de un anuncio y actualiza su fila. Devuelve la fila actualizada (o la misma si falló).
 * Los anuncios terminados no se vuelven a pedir.
 */
export async function syncAdCampaign(supabase, row, { now = new Date() } = {}) {
  if (!row?.zernio_ad_id || ['cancelled', 'error', 'creating'].includes(row.status)) return row
  try {
    const { ad } = await zernioRequest(`/ads/${encodeURIComponent(row.zernio_ad_id)}`)
    const from = ymd(row.created_at || now)
    const { summary } = await adAnalyticsSummary(row.zernio_ad_id, from, ymd(now))
    const patch = { ...adRowPatch(ad), ...metricsPatch(summary), last_synced_at: now.toISOString(), updated_at: now.toISOString() }
    delete patch.zernio_ad_id
    const { error } = await supabase.from('ad_campaigns').update(patch).eq('id', row.id).eq('organization_id', row.organization_id)
    if (error) throw error
    return { ...row, ...patch }
  } catch (err) {
    console.warn(`[ads] no se pudo sincronizar el anuncio ${row.id}:`, err?.status || '', err?.message)
    return row
  }
}

export const adIdempotencyKey = (adCampaignId) => `aitickets-ad-${adCampaignId}`
/** Una fila 'creating' se reintenta con la misma clave hasta este plazo; después queda 'error' (revisar en Meta). */
export const CREATING_RECOVERY_HOURS = 24

/**
 * Envía a Zernio el anuncio de una fila 'creating' (su zernio_request, siempre el mismo cuerpo y la misma
 * Idempotency-Key) y deja la fila con el resultado:
 * - 2xx: ids de Zernio/Meta y estado (en revisión, normalmente).
 * - Sin respuesta (timeout, red), 409 (la clave sigue en proceso), 429 o 5xx: sigue 'creating' para reintentar. Con
 *   la misma clave Zernio devuelve el anuncio ya creado en vez de crear otro.
 * - Otro rechazo (datos inválidos, cuenta sin permisos): 'error' con el motivo en español.
 * @returns {Promise<{ ok: true, row: any } | { ok: false, pending: boolean, message: string }>}
 */
export async function submitAdRequest(supabase, row, { now = new Date() } = {}) {
  const req = row?.zernio_request
  const update = (patch) =>
    supabase.from('ad_campaigns').update({ ...patch, updated_at: now.toISOString() }).eq('id', row.id).eq('organization_id', row.organization_id)
  if (!req?.path || !req?.body) {
    await update({ status: 'error', error_message: 'Faltan los datos del anuncio' })
    return { ok: false, pending: false, message: 'Faltan los datos del anuncio' }
  }
  try {
    const data = await zernioRequest(req.path, { method: 'POST', body: req.body, idempotencyKey: adIdempotencyKey(row.id), timeoutMs: 45_000 })
    const ad = data?.ad || (Array.isArray(data?.ads) ? data.ads[0] : null)
    const patch = adRowPatch(ad)
    if (!patch.zernio_ad_id) throw new ZernioError(502, { error: 'Zernio no devolvió el anuncio' })
    patch.status ||= 'pending_review'
    patch.error_message = patch.status === 'rejected' ? patch.error_message || null : null
    const { error } = await update(patch)
    if (error) console.error(`[ads] anuncio ${row.id} creado (${patch.zernio_ad_id}) pero no se pudo guardar:`, error.message)
    return { ok: true, row: { ...row, ...patch } }
  } catch (err) {
    const message = friendlyAdsError(err)
    const status = err instanceof ZernioError ? err.status : 0
    const pending = !status || status === 409 || status === 429 || status >= 500
    console.error(`[ads] creación del anuncio ${row.id} ${pending ? 'sin confirmar' : 'rechazada'}:`, status || '', err?.message)
    await update(pending ? { error_message: message } : { status: 'error', error_message: message })
    return { ok: false, pending, message }
  }
}

/** Reintenta las filas 'creating' que quedaron sin confirmar (o las da por fallidas pasado el plazo). */
export async function recoverCreatingAd(supabase, row, { now = new Date() } = {}) {
  if (row?.status !== 'creating') return row
  const age = now.getTime() - Date.parse(row.created_at)
  if (age < 60_000) return row // la creación original puede seguir en curso
  if (age > CREATING_RECOVERY_HOURS * 3600_000) {
    const patch = { status: 'error', error_message: 'No pudimos confirmar si Meta creó este anuncio. Revisa tu Administrador de anuncios.' }
    await supabase.from('ad_campaigns').update(patch).eq('id', row.id).eq('organization_id', row.organization_id)
    return { ...row, ...patch }
  }
  const out = await submitAdRequest(supabase, row, { now })
  return out.ok ? out.row : { ...row, ...(out.pending ? { error_message: out.message } : { status: 'error', error_message: out.message }) }
}

/** Pausa o reanuda solo el anuncio (no su campaña ni su conjunto). */
export const setZernioAdStatus = (zernioAdId, status) =>
  zernioRequest(`/ads/${encodeURIComponent(zernioAdId)}/status`, { method: 'PUT', body: { status } })

/** Cancela el anuncio en Meta (Zernio conserva su historial). */
export const cancelZernioAd = (zernioAdId) => zernioRequest(`/ads/${encodeURIComponent(zernioAdId)}`, { method: 'DELETE' })

// ---------------------------------------------------------------------------
// Ventas atribuidas
// ---------------------------------------------------------------------------

/**
 * Entradas y dinero que vendió cada anuncio (órdenes pagadas con utm_campaign=ad-<id>; sin cortesías ni
 * transferencias). from/to opcionales (instantes) para una ventana.
 * @returns {Map<number, { tickets: number, revenue_clp: number, orders: number }>}
 */
export function salesByAd(orders, { from = null, to = null } = {}) {
  const out = new Map()
  for (const o of orders || []) {
    const id = adCampaignIdFromUtm(o?.utm_campaign)
    if (!id || isCourtesyOrder(o) || isTransferOrder(o)) continue
    const t = Date.parse(o.created_at)
    if ((from && !(t >= from.getTime())) || (to && !(t < to.getTime()))) continue
    const row = out.get(id) || { tickets: 0, revenue_clp: 0, orders: 0 }
    row.tickets += orderSoldQty(o)
    row.revenue_clp += Number(o.amount) || 0
    row.orders += 1
    out.set(id, row)
  }
  return out
}

/**
 * Costo por entrada (en la moneda de la cuenta publicitaria) y retorno = ventas / gasto. El retorno solo se calcula si
 * la cuenta está en CLP (las ventas siempre lo están); null si no hay base.
 */
export function adEfficiency(spend, tickets, revenue, currency = 'CLP') {
  const s = Number(spend) || 0
  const clp = !currency || currency === 'CLP'
  return {
    cost_per_ticket: tickets > 0 && s > 0 ? roundBudget(s / tickets, currency) : null,
    roas: clp && s > 0 ? Math.round((Number(revenue) / s) * 10) / 10 : null,
  }
}
