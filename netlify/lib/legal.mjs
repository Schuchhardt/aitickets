// Fuente única de los datos legales del operador (Chanium LLC).
// Se usa desde funciones de Netlify, páginas Astro y componentes Vue (vía src/lib/legal.ts),
// así que NO debe importar nada de Node: el entorno se lee con globalThis.process?.env
// y en el navegador cae a los valores públicos por defecto.
//
// Datos que el dueño aún debe entregar (se leen de env; nunca se muestra "TODO" en público):
// - CHANIUM_LEGAL_ADDRESS  dirección postal pública (requerida por CAN-SPAM y para el outreach)
// - CHANIUM_LEGAL_EMAIL    correo legal publicado
// - CHANIUM_PRIVACY_EMAIL  correo para derechos de datos personales
// - LEGAL_EFFECTIVE_DATE   fecha de vigencia de los términos (YYYY-MM-DD)

function env(name) {
  try {
    const value = globalThis.process?.env?.[name]
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  } catch {
    return ''
  }
}

const ENTITY = 'Chanium LLC'
const STATE = env('CHANIUM_LEGAL_STATE') || 'Delaware'
const ADDRESS = env('CHANIUM_LEGAL_ADDRESS')
const DEFAULT_CONTACT = 'contacto@aitickets.cl'
const LEGAL_EMAIL = env('CHANIUM_LEGAL_EMAIL') || env('LEGAL_CONTACT_EMAIL') || DEFAULT_CONTACT
const PRIVACY_EMAIL = env('CHANIUM_PRIVACY_EMAIL') || env('LEGAL_PRIVACY_EMAIL') || LEGAL_EMAIL
const SUPPORT_EMAIL = env('LEGAL_SUPPORT_EMAIL') || 'soporte@aitickets.cl'
const EFFECTIVE_DATE = /^\d{4}-\d{2}-\d{2}$/.test(env('LEGAL_EFFECTIVE_DATE')) ? env('LEGAL_EFFECTIVE_DATE') : '2026-10-01'
const TAX_MODE = ['included', 'exempt', 'unknown'].includes(env('SERVICE_FEE_TAX_MODE')) ? env('SERVICE_FEE_TAX_MODE') : 'unknown'

/** Versión de los términos que se guarda al aceptar (órdenes y registro de productores). */
export const TERMS_VERSION = '2026-10-01'

const STATE_LABEL = `sociedad de responsabilidad limitada constituida en ${STATE}, EE.UU.`

export const LEGAL = Object.freeze({
  entity: ENTITY,
  entityType: 'limited liability company',
  /** Estado de constitución (Delaware). */
  state: STATE,
  /** Descripción en español: "sociedad de responsabilidad limitada constituida en Delaware, EE.UU." */
  stateLabel: STATE_LABEL,
  country: 'EE.UU.',
  /** Dirección postal pública. Vacía mientras el dueño no la configure: usar addressLine para mostrar. */
  address: ADDRESS,
  /** Texto seguro para mostrar: la dirección real o una referencia neutra a la sociedad. */
  addressLine: ADDRESS || `${ENTITY}, sociedad de ${STATE}, EE.UU.`,
  brand: 'AI Tickets',
  siteUrl: 'https://aitickets.cl',
  supportEmail: SUPPORT_EMAIL,
  privacyEmail: PRIVACY_EMAIL,
  legalEmail: LEGAL_EMAIL,
  termsVersion: TERMS_VERSION,
  effectiveDate: EFFECTIVE_DATE,
  /** Nombre con el que Flow (Webpay) cobra; aparece en el estado de cuenta del comprador. */
  flowMerchantName: env('FLOW_MERCHANT_LEGAL_NAME') || 'AI Tickets',
  /** 'unknown' (por defecto) | 'included' | 'exempt'. Mientras sea 'unknown' no se afirma nada sobre IVA. */
  serviceFeeTaxMode: TAX_MODE,
  serviceFeeLabel: TAX_MODE === 'included' ? 'Cargo por servicio (IVA incluido)' : 'Cargo por servicio',
  /** Aviso de exclusión del derecho de retracto (Ley 19.496 art. 3 bis letra b), para mostrar en el checkout. */
  retractoNotice:
    'Las entradas para eventos en fecha determinada no tienen derecho de retracto (Ley 19.496, art. 3 bis letra b). ' +
    'Si el evento se cancela, se reembolsa el total pagado, incluido el cargo por servicio.',
  /** Documento que acompaña cada compra. Nunca "boleta". */
  receiptLabel: 'Comprobante de compra',
})

/**
 * true solo cuando la dirección postal y el correo legal fueron configurados explícitamente.
 * El envío de outreach (correo comercial) exige legalReady().
 * Lee el entorno en cada llamada para no depender del orden de carga.
 */
export function legalReady() {
  return Boolean(env('CHANIUM_LEGAL_ADDRESS') && (env('CHANIUM_LEGAL_EMAIL') || env('LEGAL_CONTACT_EMAIL')))
}

/** Línea legal corta: "AI Tickets es un servicio de Chanium LLC, sociedad de ... · <dirección>". */
export function legalLine() {
  const base = `${LEGAL.brand} es un servicio de ${LEGAL.entity}, ${LEGAL.stateLabel}`
  return LEGAL.address ? `${base} · ${LEGAL.address}` : base
}

/**
 * Pie de página en texto plano para correos comerciales B2B (outreach).
 * Cumple Ley 19.496 art. 28 B (materia, remitente y forma de pedir la suspensión) y CAN-SPAM
 * (identificación como publicidad, dirección postal y opt-out).
 */
export function outreachFooterText({ sourceLabel, unsubscribeUrl } = {}) {
  const source = String(sourceLabel || '').replace(/[\r\n]+/g, ' ').trim()
  const lines = [
    '--',
    `Este es un correo comercial de ${LEGAL.brand} (servicio de ${LEGAL.entity}) sobre nuestra plataforma de venta de entradas para productores de eventos.`,
  ]
  if (source) lines.push(`Te escribimos porque encontramos este contacto en ${source}.`)
  lines.push(
    unsubscribeUrl
      ? `Si no quieres recibir más correos, responde "NO" o entra a ${unsubscribeUrl} y dejaremos de escribirte.`
      : 'Si no quieres recibir más correos, responde "NO" y dejaremos de escribirte.'
  )
  lines.push(`${LEGAL.address ? `${LEGAL.entity} · ${LEGAL.address}` : `${LEGAL.entity}, ${LEGAL.stateLabel}`} · ${LEGAL.legalEmail}`)
  return lines.join('\n')
}
