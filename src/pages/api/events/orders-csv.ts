import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { csvCell, slugify } from "../_lib/server-utils";

const BASE_COLUMNS = "id, created_at, status, amount, ticket_fee, payment_fee, total_payment, ticket_qty, ticket_details, attendees ( first_name, last_name, email, phone )";

const PROVIDER_LABELS: Record<string, string> = { flow: "Webpay (Flow)", stripe: "Tarjeta internacional (Stripe)", free: "Gratis", courtesy: "Cortesía", demo: "Demo" };
const providerLabel = (p: string | null | undefined) => (p ? PROVIDER_LABELS[p] || p : "");

/** Exporta las órdenes pagadas de un evento de la organización como CSV (separador ;). */
export const GET: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) {
        return jsonResponse({ message: "No tienes permisos para exportar órdenes" }, 403);
    }

    const eventId = context.url.searchParams.get("event_id");
    if (!eventId) return jsonResponse({ message: "event_id es obligatorio" }, 400);

    const event = await getOwnedEvent<{ id: number; name: string; slug: string }>(eventId, dbUser.organization_id, "id, name, slug");
    if (!event) return jsonResponse({ message: "Evento no encontrado o no autorizado" }, 404);

    const supabase = getSupabaseAdmin();
    // Columnas opcionales según las migraciones aplicadas: proveedor/moneda (202609270100), atribución (ref/utm)
    // e IVA del cargo por servicio (service_fee_tax, 202609290100; sin ella la columna del CSV va en 0).
    // Se intenta de la más completa a la mínima (los deploy previews pueden correr contra una base sin migrar).
    const variants = [
        { cols: `${BASE_COLUMNS}, ref, utm_source, utm_medium, utm_campaign, payment_provider, currency, service_fee_tax`, attribution: true, provider: true },
        { cols: `${BASE_COLUMNS}, ref, utm_source, utm_medium, utm_campaign, payment_provider, currency`, attribution: true, provider: true },
        { cols: `${BASE_COLUMNS}, ref, utm_source, utm_medium, utm_campaign`, attribution: true, provider: false },
        { cols: BASE_COLUMNS, attribution: false, provider: false },
    ];
    let withAttribution = false;
    let withProvider = false;
    let orders: any[] | null = null;
    let error: any = null;
    for (const v of variants) {
        ({ data: orders, error } = await supabase
            .from("event_orders")
            .select(v.cols)
            .eq("event_id", event.id)
            .eq("status", "paid")
            .order("created_at", { ascending: true }));
        if (!error) {
            withAttribution = v.attribution;
            withProvider = v.provider;
            break;
        }
    }
    if (error) {
        console.error("orders-csv error:", error);
        return jsonResponse({ message: "No se pudieron obtener las órdenes" }, 500);
    }

    const header = [
        "Orden", "Fecha (Chile)", "Nombre", "Apellido", "Email", "Teléfono", "Entradas", "Cantidad",
        "Monto entradas (a pagar al productor)", "Cargo por servicio neto (comprador)", "IVA cargo por servicio", "Total pagado", "Comisión pasarela", "Cortesía",
        ...(withProvider ? ["Medio de pago", "Moneda"] : []),
        ...(withAttribution ? ["Ref", "UTM source", "UTM medium", "UTM campaign"] : []),
    ];

    const rows = (orders || []).map((o: any) => {
        const attendee = Array.isArray(o.attendees) ? o.attendees[0] : o.attendees;
        const details = Array.isArray(o.ticket_details) ? o.ticket_details : [];
        const detailText = details.map((d: any) => `${d.quantity || 0} x ${d.name || d.ticket_name || "Entrada"}`).join(" | ");
        const isCourtesy = details.some((d: any) => d.complimentary);
        return [
            o.id,
            new Date(o.created_at).toLocaleString("es-CL", { timeZone: "America/Santiago" }),
            attendee?.first_name,
            attendee?.last_name,
            attendee?.email,
            attendee?.phone,
            detailText,
            o.ticket_qty ?? details.reduce((s: number, d: any) => s + (Number(d.quantity) || 0), 0),
            Number(o.amount) || 0,
            Number(o.ticket_fee) || 0,
            Number(o.service_fee_tax) || 0,
            Number(o.total_payment) || 0,
            Number(o.payment_fee) || 0,
            isCourtesy ? "Sí" : "No",
            ...(withProvider ? [providerLabel(o.payment_provider), o.currency || "CLP"] : []),
            ...(withAttribution ? [o.ref, o.utm_source, o.utm_medium, o.utm_campaign] : []),
        ].map(csvCell).join(";");
    });

    // BOM para que Excel abra bien los acentos
    const csv = "﻿" + [header.map(csvCell).join(";"), ...rows].join("\r\n");
    const filename = `ordenes-${slugify(event.slug || event.name || String(event.id))}.csv`;

    return new Response(csv, {
        status: 200,
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
        },
    });
};
