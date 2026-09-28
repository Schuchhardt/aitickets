// Datos de las páginas /comparar/<competidor>.
//
// Reglas (enmiendas WP7):
// - Solo datos verificables, con fuente pública y fecha de revisión. Tono neutral: nada de afirmaciones
//   sobre la calidad del competidor. Sin logos ni marcas como imagen (solo el nombre, como referencia).
// - Una página se indexa y entra al sitemap SOLO si `verified` es true, es decir, si TODAS las filas del
//   competidor tienen `source` + `checkedAt`. Mientras tanto la página existe pero va con noindex.
// - Un valor no verificado se muestra como "Por confirmar" (nunca "TODO" en público). Los pendientes
//   quedan marcados abajo con comentarios `TODO(verificar)` para el dueño.
//
// Revisión 2026-09-26: ninguna de las tres publica en su sitio una tarifa estándar para productores que
// se pudiera citar (los sitios de productores respondieron 403 a la revisión automática y los montos
// que circulan provienen de terceros o de acuerdos puntuales). Por eso las tres quedan sin verificar.

export interface ComparisonSource {
  label: string;
  url: string;
}

export interface ComparisonRow {
  /** Característica comparada */
  feature: string;
  /** Valor de AI Tickets (fuente: nuestros propios términos y /precios) */
  aitickets: string;
  /** Valor del competidor; null = por confirmar */
  competitor: string | null;
  /** Fuente pública del valor del competidor (obligatoria para que cuente como verificado) */
  source?: ComparisonSource;
  /** Fecha de revisión de la fuente (YYYY-MM-DD) */
  checkedAt?: string;
}

export interface Comparison {
  slug: string;
  /** Nombre del competidor como texto (referencia nominativa, sin logo) */
  name: string;
  website: string;
  summary: string;
  rows: ComparisonRow[];
  /** Fecha de la última revisión completa de la página */
  reviewedAt: string;
}

const AIT = {
  producerFee: "0% (el productor recibe el 100% del precio)",
  buyerFee: "Cargo por servicio de 10% + IVA sobre el precio, visible antes de pagar",
  freeEvents: "Sin costo",
  payouts: "Transferencia 48 a 72 horas después de cada función",
  website: "Web de eventos gratis para la productora",
  checkin: "Entradas con QR y check-in desde el celular",
  signup: "Registro en línea, sin contrato ni mensualidad",
};

export const COMPARISONS: Comparison[] = [
  {
    slug: "passline",
    name: "Passline",
    website: "https://www.passline.com",
    summary: "Passline es una ticketera que opera en Chile.",
    reviewedAt: "2026-09-26",
    rows: [
      // TODO(verificar): comisión estándar al productor publicada por Passline (fuente + fecha)
      { feature: "Comisión para el productor", aitickets: AIT.producerFee, competitor: null },
      // TODO(verificar): cargo por servicio al comprador publicado por Passline
      { feature: "Cargo para el comprador", aitickets: AIT.buyerFee, competitor: null },
      { feature: "Eventos gratuitos", aitickets: AIT.freeEvents, competitor: null },
      // TODO(verificar): plazo de liquidación al productor
      { feature: "Pago al productor", aitickets: AIT.payouts, competitor: null },
      { feature: "Web propia para la productora", aitickets: AIT.website, competitor: null },
      { feature: "QR y control de acceso", aitickets: AIT.checkin, competitor: null },
      { feature: "Alta", aitickets: AIT.signup, competitor: null },
    ],
  },
  {
    slug: "ticketplus",
    name: "Ticketplus",
    website: "https://ticketplus.cl",
    summary: "Ticketplus es una ticketera que opera en Chile.",
    reviewedAt: "2026-09-26",
    rows: [
      // TODO(verificar): comisión estándar al productor (Ticketplus no publica una tarifa general)
      { feature: "Comisión para el productor", aitickets: AIT.producerFee, competitor: null },
      // TODO(verificar): su centro de ayuda indica que el cargo por servicio se define con el organizador;
      // citar el artículo con fecha cuando se pueda revisar manualmente.
      { feature: "Cargo para el comprador", aitickets: AIT.buyerFee, competitor: null },
      { feature: "Eventos gratuitos", aitickets: AIT.freeEvents, competitor: null },
      { feature: "Pago al productor", aitickets: AIT.payouts, competitor: null },
      { feature: "Web propia para la productora", aitickets: AIT.website, competitor: null },
      { feature: "QR y control de acceso", aitickets: AIT.checkin, competitor: null },
      { feature: "Alta", aitickets: AIT.signup, competitor: null },
    ],
  },
  {
    slug: "puntoticket",
    name: "Puntoticket",
    website: "https://www.puntoticket.com",
    summary: "Puntoticket es una ticketera que opera en Chile.",
    reviewedAt: "2026-09-26",
    rows: [
      // TODO(verificar): comisión / cargo por servicio (se negocia por evento según prensa; sin tarifa pública)
      { feature: "Comisión para el productor", aitickets: AIT.producerFee, competitor: null },
      { feature: "Cargo para el comprador", aitickets: AIT.buyerFee, competitor: null },
      { feature: "Eventos gratuitos", aitickets: AIT.freeEvents, competitor: null },
      { feature: "Pago al productor", aitickets: AIT.payouts, competitor: null },
      { feature: "Web propia para la productora", aitickets: AIT.website, competitor: null },
      { feature: "QR y control de acceso", aitickets: AIT.checkin, competitor: null },
      { feature: "Alta", aitickets: AIT.signup, competitor: null },
    ],
  },
];

/** Una fila está verificada si tiene valor, fuente con URL https y fecha de revisión. */
export function isRowVerified(row: ComparisonRow): boolean {
  return (
    row.competitor != null &&
    !!row.source?.url &&
    /^https:\/\//.test(row.source.url) &&
    !!row.checkedAt &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.checkedAt)
  );
}

/** La página se indexa y entra al sitemap solo si todas sus filas están verificadas. */
export function isComparisonVerified(c: Comparison): boolean {
  return c.rows.length > 0 && c.rows.every(isRowVerified);
}

export function getComparison(slug: string): Comparison | undefined {
  return COMPARISONS.find((c) => c.slug === slug);
}

/** Slugs de las comparaciones que pueden indexarse (sitemap). */
export function indexableComparisonSlugs(): string[] {
  return COMPARISONS.filter(isComparisonVerified).map((c) => c.slug);
}
