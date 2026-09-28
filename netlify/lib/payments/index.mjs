// Proveedor de pago: Flow (Webpay) es el único medio de pago.
import { createFlowCheckout } from './flow.mjs'

export const PROVIDERS = Object.freeze(['flow'])
export const FLOW_HOLD_MINUTES = 15

/** Proveedores disponibles para el comprador, en orden de preferencia. */
export function enabledProviders() {
  return [...PROVIDERS]
}

export function defaultProvider() {
  return 'flow'
}

/** Minutos de reserva de stock de una orden pendiente. */
export function holdMinutesFor() {
  return FLOW_HOLD_MINUTES
}

/**
 * Crea el checkout del proveedor para una orden pendiente ya reservada.
 * @param {'flow'} provider
 * @param {{order:{id:string}, eventName:string, lines:Array<{id:number,name:string,price:number,quantity:number}>,
 *          ticketQty:number, subtotal:number, fee:number, total:number, buyerEmail:string, siteUrl:string, holdMinutes:number}} args
 * @returns {Promise<{redirectUrl:string, externalId:string|null}>}
 */
export async function createCheckout(provider, args) {
  if (provider === 'flow') return createFlowCheckout(args)
  throw new Error(`Proveedor de pago desconocido: ${provider}`)
}
