// Fuente única de los datos legales del operador (Chanium, LLC).
// Se usa desde funciones de Netlify, páginas Astro y componentes Vue (vía src/lib/legal.ts),
// así que NO debe importar nada de Node: el entorno se lee con globalThis.process?.env
// y en el navegador cae a los valores públicos por defecto.
//
// Los datos de la sociedad son públicos y están fijados aquí como valores por defecto (no hace falta
// configurar nada). Cada uno se puede sobrescribir por entorno:
// - CHANIUM_LEGAL_ADDRESS  domicilio comercial publicado (CAN-SPAM / outreach)
// - CHANIUM_LEGAL_EMAIL    correo legal publicado (alias LEGAL_CONTACT_EMAIL)
// - CHANIUM_PRIVACY_EMAIL  correo para derechos de datos personales (alias LEGAL_PRIVACY_EMAIL)
// - CHANIUM_LEGAL_PHONE    teléfono de la empresa
// - LEGAL_EFFECTIVE_DATE   fecha de vigencia de los términos (YYYY-MM-DD)
// - SERVICE_FEE_TAX_MODE   'added' (por defecto: 10% + IVA) | 'included' | 'exempt' | 'unknown'
//
// IMPORTANTE: el EIN de la sociedad NO se publica en ninguna parte (ni aquí, ni en páginas, ni en correos).

import { SERVICE_FEE_RATE, IVA_RATE } from './fees.mjs'

function env(name) {
  try {
    const value = globalThis.process?.env?.[name]
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  } catch {
    return ''
  }
}

/** Nombre corto usado en la línea de marca ("AI Tickets · Chanium LLC") y en los pies de correo. */
const ENTITY = 'Chanium LLC'
/** Razón social exacta según el certificado de constitución de Delaware. */
const LEGAL_NAME = 'Chanium, LLC'
const STATE = env('CHANIUM_LEGAL_STATE') || 'Delaware'
const DELAWARE_FILE_NUMBER = '10669971'
const FORMATION_DATE = '2026-06-22'
const REPRESENTATIVE = 'Sebastian Schuchhardt'
const DEFAULT_ADDRESS = 'Lican Ray 6742, Vitacura, Región Metropolitana, 7660043, Chile'
const DEFAULT_PHONE = '+56 9 8234 7140'
const DEFAULT_LEGAL_EMAIL = 'hello@chanium.com'

const legalAddress = () => env('CHANIUM_LEGAL_ADDRESS') || DEFAULT_ADDRESS
const legalEmail = () => env('CHANIUM_LEGAL_EMAIL') || env('LEGAL_CONTACT_EMAIL') || DEFAULT_LEGAL_EMAIL

const ADDRESS = legalAddress()
const LEGAL_EMAIL = legalEmail()
const PRIVACY_EMAIL = env('CHANIUM_PRIVACY_EMAIL') || env('LEGAL_PRIVACY_EMAIL') || LEGAL_EMAIL
const SUPPORT_EMAIL = env('LEGAL_SUPPORT_EMAIL') || 'soporte@aitickets.cl'
const PHONE = env('CHANIUM_LEGAL_PHONE') || DEFAULT_PHONE

/** Versión de los términos que se guarda al aceptar (órdenes y registro de productores). */
export const TERMS_VERSION = '2026-09-28'

const EFFECTIVE_DATE = /^\d{4}-\d{2}-\d{2}$/.test(env('LEGAL_EFFECTIVE_DATE')) ? env('LEGAL_EFFECTIVE_DATE') : TERMS_VERSION

/** Cargo por servicio: 10% del valor de las entradas, más IVA (19%) calculado sobre el cargo (fuente: fees.mjs). */
export { SERVICE_FEE_RATE }
export const SERVICE_FEE_VAT_RATE = IVA_RATE
const TAX_MODES = ['added', 'included', 'exempt', 'unknown']
const TAX_MODE = TAX_MODES.includes(env('SERVICE_FEE_TAX_MODE')) ? env('SERVICE_FEE_TAX_MODE') : 'added'
const FEE_LABELS = {
  added: 'Cargo por servicio (10% + IVA)',
  included: 'Cargo por servicio (IVA incluido)',
  exempt: 'Cargo por servicio',
  unknown: 'Cargo por servicio',
}

const STATE_LABEL = `sociedad de responsabilidad limitada constituida en ${STATE}, EE.UU.`

export const LEGAL = Object.freeze({
  /** Nombre corto para la línea de marca y pies de correo: "Chanium LLC". */
  entity: ENTITY,
  /** Razón social exacta para textos legales: "Chanium, LLC". */
  legalName: LEGAL_NAME,
  entityType: 'limited liability company',
  /** Tipo de entidad tal como figura en el registro: "Delaware LLC". */
  entityKind: `${STATE} LLC`,
  /** Estado de constitución (Delaware). */
  state: STATE,
  /** Descripción en español: "sociedad de responsabilidad limitada constituida en Delaware, EE.UU." */
  stateLabel: STATE_LABEL,
  country: 'EE.UU.',
  /** Número de archivo (file number) de la División de Sociedades de Delaware. Público. */
  delawareFileNumber: DELAWARE_FILE_NUMBER,
  /** Fecha de constitución (YYYY-MM-DD). */
  formationDate: FORMATION_DATE,
  /** Representante legal (manager). */
  representative: REPRESENTATIVE,
  phone: PHONE,
  /** Domicilio comercial publicado (Chile). */
  address: ADDRESS,
  /** Texto para mostrar la dirección (se mantiene por compatibilidad: igual a address). */
  addressLine: ADDRESS,
  brand: 'AI Tickets',
  siteUrl: 'https://aitickets.cl',
  supportEmail: SUPPORT_EMAIL,
  privacyEmail: PRIVACY_EMAIL,
  legalEmail: LEGAL_EMAIL,
  termsVersion: TERMS_VERSION,
  effectiveDate: EFFECTIVE_DATE,
  /** Nombre con el que Flow (Webpay) cobra; aparece en el estado de cuenta del comprador. */
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
    'Si el evento se cancela o reprograma, el valor de la entrada se devuelve previa autorización del organizador, en hasta 20 días hábiles. ' +
    'El cargo por servicio no es reembolsable, sin perjuicio de los derechos irrenunciables que te otorga la ley.',
  /** Documento que acompaña cada compra. Nunca "boleta". */
  receiptLabel: 'Comprobante de compra',
})

/**
 * true cuando hay domicilio postal y correo legal publicados (por defecto, los de Chanium, LLC).
 * El envío de outreach (correo comercial) exige legalReady().
 * Lee el entorno en cada llamada para no depender del orden de carga.
 */
export function legalReady() {
  return Boolean(legalAddress() && legalEmail())
}

/** Línea legal corta: "AI Tickets es un servicio de Chanium, LLC, sociedad de ... · <dirección>". */
export function legalLine() {
  const base = `${LEGAL.brand} es un servicio de ${LEGAL.legalName}, ${LEGAL.stateLabel}`
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
  lines.push(`${LEGAL.legalName} · ${LEGAL.address || LEGAL.stateLabel} · ${LEGAL.legalEmail}`)
  return lines.join('\n')
}
