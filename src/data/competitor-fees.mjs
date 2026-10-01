// Cargo al comprador de la competencia, para comparar en /precios y /comparar.
// Dato confirmado por el dueño (sep 2026) con las tarifas vigentes de Passline informadas a productores:
//   15% sobre el precio de la entrada; 13% para entradas de menos de $15.000.
// Passline NO publica estas tarifas en su sitio: no hay URL pública que citar, así que la fuente se
// rotula como "informada a productores" y nunca se enlaza a passline.com como si allí se pudiera revisar.
// No se suma IVA aparte: se compara el porcentaje informado tal cual (si fuera más IVA, la diferencia a
// favor de AI Tickets sería mayor). ivaNote lo dice en pantalla.
// Plain JS sin dependencias de Node: lo usan el navegador (FeeCalculator) y el servidor.

export const PASSLINE_BUYER_FEE = Object.freeze({
  name: 'Passline',
  rate: 0.15,
  reducedRate: 0.13,
  /** Entradas con precio MENOR a este monto pagan reducedRate. */
  reducedBelow: 15000,
  sourceLabel: 'tarifa informada por Passline a productores (no publicada en su sitio), verificada por AI Tickets el 30-09-2026',
  /** Sin URL pública: Passline no publica esta tarifa. */
  sourceUrl: null,
  ivaNote: 'Al porcentaje de Passline no le sumamos IVA: se compara tal como fue informado. Si su tarifa fuera más IVA, la diferencia sería mayor. El total de AI Tickets ya incluye el IVA del cargo.',
  checkedAt: '2026-09-30',
})

/** Tasa de Passline para un precio de entrada (CLP). */
export function passlineBuyerFeeRate(price) {
  const p = Math.round(Number(price) || 0)
  return p < PASSLINE_BUYER_FEE.reducedBelow ? PASSLINE_BUYER_FEE.reducedRate : PASSLINE_BUYER_FEE.rate
}

/**
 * Lo que paga el comprador por UNA entrada con Passline.
 * @param {number} price precio de la entrada (CLP)
 * @returns {{price:number, rate:number, fee:number, total:number}}
 */
export function passlineBuyerTotal(price) {
  const p = Math.max(0, Math.round(Number(price) || 0))
  const rate = passlineBuyerFeeRate(p)
  const fee = p > 0 ? Math.round(p * rate) : 0
  return { price: p, rate, fee, total: p + fee }
}
