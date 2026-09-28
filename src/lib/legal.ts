// Re-exporta la fuente única de datos legales (netlify/lib/legal.mjs) con tipos para Astro/Vue.
// Es seguro importarlo desde componentes del cliente: legal.mjs no depende de Node.
import {
  LEGAL as LEGAL_JS,
  TERMS_VERSION as TERMS_VERSION_JS,
  SERVICE_FEE_RATE as SERVICE_FEE_RATE_JS,
  SERVICE_FEE_VAT_RATE as SERVICE_FEE_VAT_RATE_JS,
  legalReady as legalReadyJs,
  legalLine as legalLineJs,
  outreachFooterText as outreachFooterTextJs,
} from '../../netlify/lib/legal.mjs'

export type ServiceFeeTaxMode = 'added' | 'included' | 'exempt' | 'unknown'

export interface LegalInfo {
  /** Nombre corto para la línea de marca: "Chanium LLC". */
  readonly entity: string
  /** Razón social exacta: "Chanium, LLC". */
  readonly legalName: string
  readonly entityType: string
  /** "Delaware LLC". */
  readonly entityKind: string
  readonly state: string
  readonly stateLabel: string
  readonly country: string
  readonly delawareFileNumber: string
  readonly formationDate: string
  readonly representative: string
  readonly phone: string
  /** Domicilio comercial publicado. */
  readonly address: string
  readonly addressLine: string
  readonly brand: string
  readonly siteUrl: string
  readonly supportEmail: string
  readonly privacyEmail: string
  readonly legalEmail: string
  readonly termsVersion: string
  readonly effectiveDate: string
  readonly flowMerchantName: string
  readonly stripeStatementDescriptorSuffix: string
  readonly serviceFeeTaxMode: ServiceFeeTaxMode
  /** 0.1 = 10% del valor de las entradas. */
  readonly serviceFeeRate: number
  /** 0.19 = IVA sobre el cargo por servicio (cuando serviceFeeTaxMode es 'added'). */
  readonly serviceFeeVatRate: number
  readonly serviceFeeLabel: string
  readonly retractoNotice: string
  readonly receiptLabel: string
}

export interface OutreachFooterOptions {
  sourceLabel: string
  unsubscribeUrl: string
}

export const LEGAL: LegalInfo = LEGAL_JS as LegalInfo
export const TERMS_VERSION: string = TERMS_VERSION_JS
export const SERVICE_FEE_RATE: number = SERVICE_FEE_RATE_JS
export const SERVICE_FEE_VAT_RATE: number = SERVICE_FEE_VAT_RATE_JS
export const legalReady: () => boolean = legalReadyJs
export const legalLine: () => string = legalLineJs
export const outreachFooterText: (opts: OutreachFooterOptions) => string = outreachFooterTextJs

/** Fecha de vigencia formateada en español de Chile, p. ej. "1 de octubre de 2026". */
export function formatLegalDate(isoDate: string = LEGAL.effectiveDate): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  return new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d))
  )
}
