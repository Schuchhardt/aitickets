import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { csvCell, slugify } from "../_lib/server-utils";
import { ALL_FUNCTIONS, lineFunctionKey, loadEventFunctions } from "../../../lib/eventAnalytics";
import { normalizeCheckoutFields, answerFor, answersText, missingAttendeeData, formatRut } from "../../../lib/checkoutFields.mjs";
import { fetchAll } from "../../../lib/producer-api/tools/common";

const BASE_COLUMNS = "id, created_at, status, amount, ticket_fee, payment_fee, total_payment, ticket_qty, ticket_details, attendees ( first_name, last_name, email, phone )";

const PROVIDER_LABELS: Record<string, string> = { flow: "Webpay (Flow)", free: "Gratis", courtesy: "Cortesía", demo: "Demo" };
const providerLabel = (p: string | null | undefined) => (p ? PROVIDER_LABELS[p] || p : "");

/**
 * Exporta las órdenes pagadas de un evento de la organización como CSV (separador ;). Con varias funciones agrega la
 * columna "Función"; `event_date_id` deja solo las órdenes con entradas de esa función (o válidas para cualquiera) y
 * "Entradas de la función" cuenta solo esas. Los montos son los de la orden completa.
 * Datos extra del checkout (202610300100): "Asistentes" (nombre y correo de cada QR, si se escribieron, con sus
 * respuestas por persona y "datos pendientes" si un invitado aún no completa lo que pide el evento), empresa (razón
 * social y RUT; no es boleta ni factura) y una columna por pregunta del evento. Las preguntas por persona
 * (202610310100) juntan la respuesta de cada asistente de la orden, separadas por " | ".
 */
export const GET: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) {
        return jsonResponse({ message: "No tienes permisos para exportar órdenes" }, 403);
    }

    const eventId = context.url.searchParams.get("event_id");
    if (!eventId) return jsonResponse({ message: "event_id es obligatorio" }, 400);

    const event = await getOwnedEvent<{ id: number; name: string; slug: string }>(eventId, dbUser.organization_id, "id, name, slug", dbUser.id);
    if (!event) return jsonResponse({ message: "Evento no encontrado o no autorizado" }, 404);

    const supabase = getSupabaseAdmin();
    const { functions, ticketFunction } = await loadEventFunctions(supabase, event.id);
    const labelOf = new Map(functions.map((f) => [String(f.id), f.label]));
    const fnParam = context.url.searchParams.get("event_date_id");
    const onlyFunction = fnParam ? functions.find((f) => String(f.id) === fnParam) : null;
    if (fnParam && !onlyFunction) return jsonResponse({ message: "La función no es de este evento" }, 400);
    const withFunctions = functions.length > 1;
    const fnKey = (d: any) => lineFunctionKey(d, ticketFunction);
    const fnLabel = (key: string) => (key === ALL_FUNCTIONS ? "Todas las funciones" : labelOf.get(key) || "Función");
    // Columnas opcionales según las migraciones aplicadas: proveedor/moneda (202609270100), atribución (ref/utm)
    // e IVA del cargo por servicio (service_fee_tax, 202609290100; sin ella la columna del CSV va en 0).
    // Descuento (discount_code/discount_amount, 202609300200; sin ellas las columnas van vacías/0).
    // Se intenta de la más completa a la mínima (los deploy previews pueden correr contra una base sin migrar).
    const variants = [
        { cols: `${BASE_COLUMNS}, ref, utm_source, utm_medium, utm_campaign, payment_provider, currency, service_fee_tax, discount_code, discount_amount, registration_answers, company_rut, company_name`, attribution: true, provider: true, extras: true },
        { cols: `${BASE_COLUMNS}, ref, utm_source, utm_medium, utm_campaign, payment_provider, currency, service_fee_tax, discount_code, discount_amount`, attribution: true, provider: true },
        { cols: `${BASE_COLUMNS}, ref, utm_source, utm_medium, utm_campaign, payment_provider, currency, service_fee_tax`, attribution: true, provider: true },
        { cols: `${BASE_COLUMNS}, ref, utm_source, utm_medium, utm_campaign, payment_provider, currency`, attribution: true, provider: true },
        { cols: `${BASE_COLUMNS}, ref, utm_source, utm_medium, utm_campaign`, attribution: true, provider: false },
        { cols: BASE_COLUMNS, attribution: false, provider: false },
    ];
    let withAttribution = false;
    let withProvider = false;
    let withExtras = false;
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
            withExtras = (v as any).extras === true;
            break;
        }
    }
    if (error) {
        console.error("orders-csv error:", error);
        return jsonResponse({ message: "No se pudieron obtener las órdenes" }, 500);
    }

    // Asistentes de cada QR y preguntas del evento (solo con la migración 202610300100; las respuestas por persona,
    // con la 202610310100)
    const holdersByOrder = new Map<string, string[]>();
    const ticketsByOrder = new Map<string, any[]>();
    let questions: Array<{ id: string; label: string; per?: string }> = [];
    let withCompany = false;
    if (withExtras) {
        const loadHolders = (cols: string) => fetchAll<any>(() => supabase.from("event_attendees").select(cols).eq("event_id", event.id).order("id", { ascending: true }));
        const [holderRows, { data: cfg }] = await Promise.all([
            loadHolders("id, event_order_id, holder_name, holder_email, status, registration_answers")
                .catch(() => loadHolders("id, event_order_id, holder_name, holder_email, status"))
                .catch(() => []),
            supabase.from("events").select("checkout_fields").eq("id", event.id).maybeSingle(),
        ]);
        const fields = normalizeCheckoutFields((cfg as any)?.checkout_fields);
        const orderById = new Map((orders || []).map((o: any) => [o.id, o]));
        for (const a of holderRows) {
            if (a.status === "cancelled" || !a.event_order_id) continue;
            const order: any = orderById.get(a.event_order_id);
            const buyer = Array.isArray(order?.attendees) ? order.attendees[0] : order?.attendees;
            ticketsByOrder.set(a.event_order_id, [...(ticketsByOrder.get(a.event_order_id) || []), a]);
            const own = answersText(a.registration_answers, "; ");
            const pending = missingAttendeeData(fields, a, { buyerEmail: buyer?.email, orderAnswers: order?.registration_answers });
            if (!(a.holder_name || a.holder_email || own || pending.length)) continue;
            const list = holdersByOrder.get(a.event_order_id) || [];
            list.push([
                a.holder_name,
                a.holder_email ? `<${a.holder_email}>` : "",
                own ? `(${own})` : "",
                pending.length ? `[datos pendientes: ${pending.join(", ")}]` : "",
            ].filter(Boolean).join(" "));
            holdersByOrder.set(a.event_order_id, list);
        }
        questions = fields.questions;
        withCompany = fields.company || (orders || []).some((o: any) => o.company_rut);
    }
    // Pregunta por persona: la respuesta de cada asistente de la orden (o la de la orden, si antes era por compra)
    const answerOf = (o: any, q: any) => {
        if (q.per !== "attendee") return answerFor(o.registration_answers, q);
        const each = (ticketsByOrder.get(o.id) || []).map((t) => answerFor(t.registration_answers, q)).filter(Boolean);
        return each.length ? each.join(" | ") : answerFor(o.registration_answers, q);
    };

    const inFunction = (d: any) => !onlyFunction || [String(onlyFunction.id), ALL_FUNCTIONS].includes(fnKey(d));
    const selected = (orders || []).filter((o: any) => !onlyFunction || (Array.isArray(o.ticket_details) ? o.ticket_details : []).some(inFunction));

    const header = [
        "Orden", "Fecha (Chile)", "Nombre", "Apellido", "Email", "Teléfono", "Entradas", "Cantidad",
        ...(withFunctions ? ["Función"] : []),
        ...(onlyFunction ? ["Entradas de la función"] : []),
        "Código de descuento", "Descuento",
        "Monto entradas (a pagar al productor)", "Cargo por servicio neto (comprador)", "IVA cargo por servicio", "Total pagado", "Comisión pasarela", "Cortesía",
        ...(withProvider ? ["Medio de pago", "Moneda"] : []),
        ...(withAttribution ? ["Ref", "UTM source", "UTM medium", "UTM campaign"] : []),
        ...(holdersByOrder.size ? ["Asistentes"] : []),
        ...(withCompany ? ["Empresa (razón social)", "RUT empresa"] : []),
        ...questions.map((q) => q.label),
    ];

    const rows = selected.map((o: any) => {
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
            ...(withFunctions ? [[...new Set<string>(details.map(fnKey))].map(fnLabel).join(" | ")] : []),
            ...(onlyFunction ? [details.filter(inFunction).reduce((s: number, d: any) => s + (Number(d.quantity) || 0), 0)] : []),
            Number(o.discount_amount) > 0 ? o.discount_code || "" : "",
            Number(o.discount_amount) || 0,
            Number(o.amount) || 0,
            Number(o.ticket_fee) || 0,
            Number(o.service_fee_tax) || 0,
            Number(o.total_payment) || 0,
            Number(o.payment_fee) || 0,
            isCourtesy ? "Sí" : "No",
            ...(withProvider ? [providerLabel(o.payment_provider), o.currency || "CLP"] : []),
            ...(withAttribution ? [o.ref, o.utm_source, o.utm_medium, o.utm_campaign] : []),
            ...(holdersByOrder.size ? [(holdersByOrder.get(o.id) || []).join(" | ")] : []),
            ...(withCompany ? [o.company_name || "", o.company_rut ? formatRut(o.company_rut) : ""] : []),
            ...questions.map((q) => answerOf(o, q)),
        ].map(csvCell).join(";");
    });

    // BOM para que Excel abra bien los acentos
    const csv = "﻿" + [header.map(csvCell).join(";"), ...rows].join("\r\n");
    const filename = `ordenes-${slugify(event.slug || event.name || String(event.id))}${onlyFunction ? `-${slugify(onlyFunction.label)}` : ""}.csv`;

    return new Response(csv, {
        status: 200,
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
        },
    });
};
