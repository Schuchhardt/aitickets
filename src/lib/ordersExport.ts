// Exportación contable de órdenes (export_orders de la API de productores).
//
// El CSV no se guarda en ningún lado: la herramienta entrega un link /api/exports/orders?token=… con un token
// HMAC de vida corta (EXPORT_TTL_SECONDS) que lleva la organización, el usuario, los eventos y el rango de
// fechas. Al descargar se re-verifica que el usuario siga activo en la organización con permiso para ver
// compradores, y el CSV se genera en ese momento.
import { createHmac, timingSafeEqual } from "node:crypto";
import { csvCell } from "../pages/api/_lib/server-utils";

export const EXPORT_TTL_SECONDS = 30 * 60;
export const EXPORT_STATUSES = ["paid", "refunded"] as const;
const MAX_ROWS = 50_000;

function readEnv(name: string): string {
    const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
    const value = fromProcess ?? (import.meta.env as Record<string, string | undefined>)?.[name];
    return value ? String(value).trim() : "";
}

function exportKey(): Buffer {
    const base = readEnv("INTERNAL_API_SECRET") || readEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!base) throw new Error("INTERNAL_API_SECRET no configurado");
    return createHmac("sha256", "aitickets-orders-export").update(base).digest();
}

export type ExportClaims = {
    org: number;
    uid: number;
    /** null = todos los eventos de la organización */
    events: number[] | null;
    from: string | null;
    to: string | null;
    exp: number;
};

export function signExportToken(claims: Omit<ExportClaims, "exp">, now = Date.now()): { token: string; expiresAt: string } {
    const exp = Math.floor(now / 1000) + EXPORT_TTL_SECONDS;
    const payload = Buffer.from(JSON.stringify({ ...claims, exp })).toString("base64url");
    const sig = createHmac("sha256", exportKey()).update(payload).digest("base64url");
    return { token: `${payload}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyExportToken(token: unknown, now = Date.now()): ExportClaims | null {
    if (typeof token !== "string" || token.length > 4096) return null;
    const [payload, sig, extra] = token.split(".");
    if (!payload || !sig || extra !== undefined) return null;
    const expected = createHmac("sha256", exportKey()).update(payload).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (!claims || typeof claims !== "object" || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now) return null;
        if (!Number.isInteger(claims.org) || !Number.isInteger(claims.uid)) return null;
        return claims as ExportClaims;
    } catch {
        return null;
    }
}

const PROVIDER_LABELS: Record<string, string> = { flow: "Webpay (Flow)", free: "Gratis", courtesy: "Cortesía", demo: "Demo" };
const isMissingColumn = (error: any) => ["42703", "PGRST204"].includes(String(error?.code || "")) || /column/i.test(String(error?.message || ""));

export const EXPORT_HEADER = [
    "Fecha (Chile)", "Orden", "Evento", "Estado", "Comprador", "Email", "Entradas", "Cantidad",
    "Subtotal (precio de lista)", "Código de descuento", "Descuento", "Cargo por servicio neto", "IVA cargo por servicio",
    "Total pagado", "Neto productor", "Cargo absorbido por el productor", "Medio de pago", "Canal", "Reembolsado",
];

async function fetchPaged(build: () => any): Promise<any[]> {
    const out: any[] = [];
    for (let from = 0; from < MAX_ROWS; from += 1000) {
        const { data, error } = await build().range(from, from + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
    }
    return out;
}

/** Filas de la exportación contable (objetos ya calculados) para la organización. */
export async function buildOrderExportRows(supabase: any, opts: { orgId: number; eventIds: number[] | null; from: string | null; to: string | null }) {
    let evQuery = supabase.from("events").select("id, name").eq("organization_id", opts.orgId);
    if (opts.eventIds) evQuery = evQuery.in("id", opts.eventIds);
    const { data: events, error: evError } = await evQuery.limit(5000);
    if (evError) throw evError;
    const names = new Map<number, string>((events || []).map((e: any) => [Number(e.id), e.name]));
    const ids = [...names.keys()];
    if (!ids.length) return [];

    const base = "id, event_id, created_at, status, amount, ticket_fee, total_payment, ticket_qty, ticket_details, buyer_first_name, buyer_last_name, buyer_email, ref, utm_source, utm_medium, utm_campaign, payment_provider";
    const variants = [`${base}, service_fee_tax, discount_code, discount_amount, fee_absorbed`, `${base}, service_fee_tax, discount_code, discount_amount`, base];
    let orders: any[] = [];
    for (let i = 0; i < variants.length; i++) {
        try {
            orders = await fetchPaged(() => {
                let q = supabase
                    .from("event_orders")
                    .select(variants[i])
                    .in("event_id", ids)
                    .in("status", [...EXPORT_STATUSES])
                    .order("created_at", { ascending: true })
                    .order("id", { ascending: true });
                if (opts.from) q = q.gte("created_at", opts.from);
                if (opts.to) q = q.lt("created_at", opts.to);
                return q;
            });
            break;
        } catch (err) {
            if (i === variants.length - 1 || !isMissingColumn(err)) throw err;
        }
    }

    const refunded = new Map<string, number>();
    if (orders.length) {
        try {
            const refunds = await fetchPaged(() =>
                supabase.from("aitickets_refunds").select("order_id, total_amount, status").eq("organization_id", opts.orgId).in("event_id", ids),
            );
            for (const r of refunds) {
                if (r.status === "cancelled" || r.status === "failed") continue;
                refunded.set(String(r.order_id), (refunded.get(String(r.order_id)) || 0) + (Number(r.total_amount) || 0));
            }
        } catch {
            /* tabla aún inexistente: sin reembolsos */
        }
    }

    return orders.map((o: any) => {
        const details = Array.isArray(o.ticket_details) ? o.ticket_details : [];
        const amount = Number(o.amount) || 0;
        const feeNet = Number(o.ticket_fee) || 0;
        const feeIva = Number(o.service_fee_tax) || 0;
        const discount = Number(o.discount_amount) || 0;
        const absorbed = o.fee_absorbed === true;
        // amount es el neto del productor en ambos casos: lo pagado = amount + cargo + IVA
        const paidByBuyer = o.total_payment != null ? Number(o.total_payment) : amount + feeNet + feeIva;
        return {
            date: new Date(o.created_at).toLocaleString("es-CL", { timeZone: "America/Santiago" }),
            order_id: o.id,
            event: names.get(Number(o.event_id)) || String(o.event_id),
            status: o.status === "refunded" ? "Reembolsada" : "Pagada",
            buyer: [o.buyer_first_name, o.buyer_last_name].filter(Boolean).join(" "),
            email: o.buyer_email || "",
            tickets: details.map((d: any) => `${d.quantity || 0} x ${d.name || d.ticket_name || "Entrada"}`).join(" | "),
            quantity: o.ticket_qty ?? details.reduce((s: number, d: any) => s + (Number(d.quantity) || 0), 0),
            gross_subtotal: amount + (absorbed ? feeNet + feeIva : 0) + discount,
            discount_code: discount > 0 ? o.discount_code || "" : "",
            discount,
            fee_net: feeNet,
            fee_iva: feeIva,
            total_paid: paidByBuyer,
            producer_net: amount,
            fee_absorbed: absorbed,
            provider: o.payment_provider ? PROVIDER_LABELS[o.payment_provider] || o.payment_provider : "",
            channel: o.ref ? `ref:${o.ref}` : [o.utm_source, o.utm_medium, o.utm_campaign].filter(Boolean).join(" / ") || "directo",
            refunded: refunded.get(String(o.id)) || 0,
        };
    });
}

export type OrderExportRow = Awaited<ReturnType<typeof buildOrderExportRows>>[number];

export function rowsToCsv(rows: OrderExportRow[]): string {
    const lines = rows.map((r) =>
        [
            r.date, r.order_id, r.event, r.status, r.buyer, r.email, r.tickets, r.quantity,
            r.gross_subtotal, r.discount_code, r.discount, r.fee_net, r.fee_iva,
            r.total_paid, r.producer_net, r.fee_absorbed ? "Sí" : "No", r.provider, r.channel, r.refunded,
        ].map(csvCell).join(";"),
    );
    // BOM para que Excel abra bien los acentos
    return "﻿" + [EXPORT_HEADER.map(csvCell).join(";"), ...lines].join("\r\n");
}
