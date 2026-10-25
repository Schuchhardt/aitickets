// Fuente única de los datos legales del operador de AI Tickets en Chile:
// Servicios Informáticos Sebastián Schuchhardt EIRL, mandataria de los productores.
// Se usa desde funciones de Netlify, páginas Astro y componentes Vue (vía src/lib/legal.ts),
// así que NO debe importar nada de Node: el entorno se lee con globalThis.process?.env
// y en el navegador cae a los valores públicos por defecto.
//
// La razón social y el RUT se muestran SOLO en los términos y en el aviso de privacidad (y, por exigencia
// del SII, en la boleta del cargo por servicio). En footer, correos, checkout y panel se usa la marca
// (LEGAL.brand = "AI Tickets").
//
// Los datos de la empresa son públicos y están fijados aquí como valores por defecto. Cada uno se puede
// sobrescribir por entorno:
// - LEGAL_ADDRESS          domicilio publicado (outreach)
// - LEGAL_CONTACT_EMAIL    correo legal publicado
// - LEGAL_PRIVACY_EMAIL    correo para derechos de datos personales (por defecto, el legal)
// - LEGAL_PHONE            teléfono de la empresa
// - LEGAL_EFFECTIVE_DATE   fecha de vigencia de los términos (YYYY-MM-DD)
// - SERVICE_FEE_TAX_MODE   'added' (por defecto: 8% + IVA) | 'included' | 'exempt' | 'unknown'

import { SERVICE_FEE_RATE, IVA_RATE } from './fees.mjs'

function env(name) {
  try {
    const value = globalThis.process?.env?.[name]
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  } catch {
    return ''
  }
}

/** Razón social exacta (Registro de Empresas y Sociedades / SII). */
const LEGAL_NAME = 'Servicios Informáticos Sebastián Schuchhardt EIRL'
const RUT = '77.893.286-5'
const REPRESENTATIVE = 'Sebastián Schuchhardt'
const DEFAULT_ADDRESS = 'Lican Ray 6742, Vitacura, Región Metropolitana, Chile'
const DEFAULT_PHONE = '+56 9 8234 7140'
const DEFAULT_LEGAL_EMAIL = 'legal@aitickets.cl'

const legalAddress = () => env('LEGAL_ADDRESS') || DEFAULT_ADDRESS
const legalEmail = () => env('LEGAL_CONTACT_EMAIL') || DEFAULT_LEGAL_EMAIL

const ADDRESS = legalAddress()
const LEGAL_EMAIL = legalEmail()
const PRIVACY_EMAIL = env('LEGAL_PRIVACY_EMAIL') || LEGAL_EMAIL
const SUPPORT_EMAIL = env('LEGAL_SUPPORT_EMAIL') || 'soporte@aitickets.cl'
const PHONE = env('LEGAL_PHONE') || DEFAULT_PHONE

/**
 * Plazo de pago al productor (fuente única del texto). Debe calzar con src/lib/producer-api/ledger.ts
 * (RELEASE_HOURS) y tools/finance.ts (PAYOUT_BUSINESS_DAYS): cada función se libera 48 h después de terminar,
 * el productor solicita el retiro y AI Tickets lo transfiere en hasta 2 días hábiles.
 */
export const PAYOUT_RELEASE_HOURS = 48
export const PAYOUT_BUSINESS_DAYS = 2
export const PAYOUT_SCHEDULE_TEXT =
  `Lo que vendes para cada función queda disponible para retirar ${PAYOUT_RELEASE_HOURS} h después de que termina esa función. ` +
  `Solicitas el retiro desde el panel y te lo transferimos en hasta ${PAYOUT_BUSINESS_DAYS} días hábiles.`
/** Versión corta para tarjetas y bullets. */
export const PAYOUT_SHORT_TEXT = `Cobras por función: disponible ${PAYOUT_RELEASE_HOURS} h después de cada show`

/** Versión de los términos que se guarda al aceptar (órdenes y registro de productores). */
export const TERMS_VERSION = '2026-10-25'

const EFFECTIVE_DATE = /^\d{4}-\d{2}-\d{2}$/.test(env('LEGAL_EFFECTIVE_DATE')) ? env('LEGAL_EFFECTIVE_DATE') : TERMS_VERSION

/** Cargo por servicio: 8% del valor de las entradas, más IVA (19%) calculado sobre el cargo (fuente: fees.mjs). */
export { SERVICE_FEE_RATE }
export const SERVICE_FEE_VAT_RATE = IVA_RATE
const TAX_MODES = ['added', 'included', 'exempt', 'unknown']
const TAX_MODE = TAX_MODES.includes(env('SERVICE_FEE_TAX_MODE')) ? env('SERVICE_FEE_TAX_MODE') : 'added'
const FEE_LABELS = {
  added: `Cargo por servicio (${Math.round(SERVICE_FEE_RATE * 100)}% + IVA)`,
  included: 'Cargo por servicio (IVA incluido)',
  exempt: 'Cargo por servicio',
  unknown: 'Cargo por servicio',
}

export const LEGAL = Object.freeze({
  /** Razón social exacta, para términos, aviso de privacidad y boleta: no usar en footer, correos ni checkout. */
  legalName: LEGAL_NAME,
  /** RUT de la empresa (mismo uso restringido que legalName). */
  rut: RUT,
  /** Tipo de entidad: empresa individual de responsabilidad limitada. */
  entityKind: 'EIRL',
  country: 'Chile',
  /** Representante legal. */
  representative: REPRESENTATIVE,
  phone: PHONE,
  /** Domicilio publicado (Chile). */
  address: ADDRESS,
  /** Texto para mostrar la dirección (se mantiene por compatibilidad: igual a address). */
  addressLine: ADDRESS,
  /** Marca: lo único que se muestra en footer, correos, checkout, panel y estado de cuenta. */
  brand: 'AI Tickets',
  siteUrl: 'https://aitickets.cl',
  supportEmail: SUPPORT_EMAIL,
  privacyEmail: PRIVACY_EMAIL,
  legalEmail: LEGAL_EMAIL,
  termsVersion: TERMS_VERSION,
  effectiveDate: EFFECTIVE_DATE,
  /** Nombre de fantasía configurado en Flow (Webpay); es lo que ve el comprador en su estado de cuenta. */
  flowMerchantName: env('FLOW_MERCHANT_LEGAL_NAME') || 'AI Tickets',
  /** 'added' (por defecto: el IVA se suma al cargo) | 'included' | 'exempt' | 'unknown'. */
  serviceFeeTaxMode: TAX_MODE,
  serviceFeeRate: SERVICE_FEE_RATE,
  serviceFeeVatRate: SERVICE_FEE_VAT_RATE,
  serviceFeeLabel: FEE_LABELS[TAX_MODE],
  /** Aviso de exclusión del derecho de retracto (Ley 19.496 art. 3 bis letra b), para mostrar en el checkout. */
  retractoNotice:
    'Las entradas para eventos en fecha determinada no tienen derecho de retracto (Ley 19.496, art. 3 bis letra b). ' +
    'Una vez completada la compra no hay cambios ni devoluciones, tampoco por errores al comprar. ' +
    'Si el evento se cancela o reprograma, se devuelven el valor de la entrada y el cargo por servicio con su IVA en hasta 20 días hábiles, según los Términos y condiciones. ' +
    'Sin perjuicio de los derechos irrenunciables que te otorga la ley.',
  /** Documento que acompaña cada compra. Nunca "boleta": la boleta electrónica del cargo por servicio es un documento aparte. */
  receiptLabel: 'Comprobante de compra',
})

/**
 * true cuando hay domicilio postal y correo legal publicados (por defecto, los de la EIRL).
 * El envío de outreach (correo comercial) exige legalReady().
 * Lee el entorno en cada llamada para no depender del orden de carga.
 */
export function legalReady() {
  return Boolean(legalAddress() && legalEmail())
}

/** Línea legal corta, solo para términos y aviso de privacidad: "AI Tickets es operado en Chile por <razón social>, RUT ... · <dirección>". */
export function legalLine() {
  const base = `${LEGAL.brand} es operado en Chile por ${LEGAL.legalName}, RUT ${LEGAL.rut}`
  return LEGAL.address ? `${base} · ${LEGAL.address}` : base
}

/**
 * Pie de página en texto plano para correos comerciales B2B (outreach).
 * Cumple Ley 19.496 art. 28 B (materia, remitente y forma de pedir la suspensión): identifica al remitente
 * por su marca, con domicilio y correo de contacto. La razón social está en el aviso de privacidad.
 */
export function outreachFooterText({ sourceLabel, unsubscribeUrl } = {}) {
  const source = String(sourceLabel || '').replace(/[\r\n]+/g, ' ').trim()
  const lines = [
    '--',
    `Este es un correo comercial de ${LEGAL.brand} sobre nuestra plataforma de venta de entradas para productores de eventos.`,
  ]
  if (source) lines.push(`Te escribimos porque encontramos este contacto en ${source}.`)
  lines.push(
    unsubscribeUrl
      ? `Si no quieres recibir más correos, responde "NO" o entra a ${unsubscribeUrl} y dejaremos de escribirte.`
      : 'Si no quieres recibir más correos, responde "NO" y dejaremos de escribirte.'
  )
  lines.push(`${LEGAL.brand} · ${LEGAL.address} · ${LEGAL.legalEmail}`)
  return lines.join('\n')
}
