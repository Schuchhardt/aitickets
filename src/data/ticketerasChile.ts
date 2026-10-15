// Tabla de /ticketeras-en-chile. Mismas reglas que src/data/comparisons.ts: solo datos con fuente y fecha de
// revisión; lo que la ticketera no publica se muestra como "No publicado" (nunca una cifra de terceros como
// si fuera oficial). Tono neutral, sin logos. Revisar las fuentes al menos cada 3 meses y actualizar checkedAt.
import { PASSLINE_BUYER_FEE } from "./competitor-fees.mjs";
import { SERVICE_FEE_PERCENT_LABEL } from "../../netlify/lib/fees.mjs";
import { PAYOUT_RELEASE_HOURS, PAYOUT_BUSINESS_DAYS } from "../../netlify/lib/legal.mjs";

export type MarketRow = {
    name: string;
    website: string;
    buyerFee: string;
    producerFee: string;
    freeEvents: string;
    payout: string;
    /** Fuente principal. Sin url = dato informado por la ticketera a productores (no publicado). */
    source: { label: string; url?: string };
    checkedAt: string;
    note?: string;
};

export const NOT_PUBLISHED = "No publicado";

export const MARKET_ROWS: MarketRow[] = [
    {
        name: "AI Tickets",
        website: "https://aitickets.cl",
        buyerFee: `${SERVICE_FEE_PERCENT_LABEL} + IVA sobre el cargo (≈ 9,5% del precio)`,
        producerFee: "0%",
        freeEvents: "Sin costo",
        payout: `Cada función, ${PAYOUT_RELEASE_HOURS} h después de terminar; retiro en hasta ${PAYOUT_BUSINESS_DAYS} días hábiles`,
        source: { label: "Precios de AI Tickets", url: "https://aitickets.cl/precios" },
        checkedAt: "2026-10-14",
    },
    {
        name: "Welcu",
        website: "https://welcu.com",
        buyerFee: "10% + impuestos del valor de la entrada; el organizador puede traspasarlo al asistente",
        producerFee: "Incluida en el 10% si no se traspasa",
        freeEvents: "Sin costo",
        payout: NOT_PUBLISHED,
        source: { label: "welcu.com/es/pricing", url: "https://welcu.com/es/pricing" },
        checkedAt: "2026-10-14",
    },
    {
        name: "Eventbrite",
        website: "https://www.eventbrite.cl",
        buyerFee: "3,7% + 1,79 por entrada y 2,9% de procesamiento por pedido; por defecto lo paga el comprador",
        producerFee: "0% si el comprador asume las tarifas",
        freeEvents: "Sin costo",
        payout: NOT_PUBLISHED,
        source: { label: "eventbrite.cl/organizer/pricing", url: "https://www.eventbrite.cl/organizer/pricing/" },
        checkedAt: "2026-10-14",
        note: "La página indica \"$1,79\" sin especificar la moneda.",
    },
    {
        name: "Tickean",
        website: "https://www.tickean.cl",
        buyerFee: "15% de servicio",
        producerFee: "0%",
        freeEvents: NOT_PUBLISHED,
        payout: "Al instante vía el proveedor de pagos, sujeto a sus plazos y reservas",
        source: { label: "tickean.cl/alternativa-a-passline", url: "https://www.tickean.cl/alternativa-a-passline" },
        checkedAt: "2026-10-14",
    },
    {
        name: "Ticketplus",
        website: "https://ticketplus.com",
        buyerFee: NOT_PUBLISHED,
        producerFee: NOT_PUBLISHED,
        freeEvents: NOT_PUBLISHED,
        payout: "48–72 h después del evento",
        source: { label: "ticketplus.com/servicios", url: "https://ticketplus.com/servicios/" },
        checkedAt: "2026-10-14",
    },
    {
        name: "Passline",
        website: "https://www.passline.com",
        buyerFee: `${Math.round(PASSLINE_BUYER_FEE.rate * 100)}% (${Math.round(PASSLINE_BUYER_FEE.reducedRate * 100)}% en entradas de menos de $15.000)`,
        producerFee: NOT_PUBLISHED,
        freeEvents: NOT_PUBLISHED,
        payout: NOT_PUBLISHED,
        source: { label: `Tarifa informada por Passline a productores; no publicada en su sitio` },
        checkedAt: PASSLINE_BUYER_FEE.checkedAt,
    },
    {
        name: "Puntoticket",
        website: "https://www.puntoticket.com",
        buyerFee: NOT_PUBLISHED,
        producerFee: NOT_PUBLISHED,
        freeEvents: NOT_PUBLISHED,
        payout: NOT_PUBLISHED,
        source: { label: "Sin tarifa pública para productores (se acuerda por evento)" },
        checkedAt: "2026-10-14",
    },
];

export const MARKET_CONTEXT = {
    text: "En Chile el cargo por servicio de las ticketeras habitualmente fluctúa entre el 10% y el 20% del valor de la entrada, y no existe una ley que fije un máximo.",
    source: {
        label: "BioBioChile, 23 de junio de 2026",
        url: "https://www.biobiochile.cl/noticias/artes-y-cultura/actualidad-cultural/2026/06/23/cargo-por-servicio-el-factor-que-encarece-las-entradas-y-que-te-cobra-de-mas-por-ofrecer-lo-mismo.shtml",
    },
};
