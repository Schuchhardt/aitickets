// Herramientas de admin: feed de actividad de toda la plataforma (registros, eventos, primeras ventas, acciones por
// API/MCP, retiros, reembolsos, reseñas y acciones de soporte), del más reciente al más antiguo.
import { localDateTime, eventPublicUrl } from "../../producer-api/tools/common";
import { isDemoEventSlug } from "../../demoEvent.mjs";
import type { AdminToolDef } from "../registry";
import { loadPaidOrders } from "../metrics";
import { organizationIdSchema } from "./organizations";
import { isSaleOrder, orgNames, tolerantAll } from "./analytics";

export const ACTIVITY_TYPES = ["signup", "event_created", "event_published", "first_sale", "api_action", "payout", "refund", "review", "admin_action"] as const;
type ActivityType = (typeof ACTIVITY_TYPES)[number];

type Entry = {
    at: string;
    type: ActivityType;
    organization_id: number | null;
    summary: string;
    target?: string | null;
    event?: { id: number; name: string | null; slug?: string | null; status?: string | null } | null;
};

const DEFAULT_DAYS = 7;
const clp = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")} CLP`;

const listPlatformActivity: AdminToolDef = {
    name: "list_platform_activity",
    title: "Actividad de la plataforma",
    description:
        "Qué pasó en toda la plataforma, del más reciente al más antiguo: productores que se registraron, eventos creados, publicaciones hechas por " +
        "MCP/API, primeras ventas de un productor, acciones por API/MCP (todas las organizaciones, con su canal), retiros (pedidos, pagados, anulados), " +
        "reembolsos (pedidos y procesados), reseñas nuevas (solo la nota) y acciones de soporte (escrituras del MCP de admin). Filtra por tipos, " +
        "organización y desde cuándo (por defecto 7 días). Sin eventos demo.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            types: { type: "array", items: { type: "string", enum: ACTIVITY_TYPES }, minItems: 1, maxItems: ACTIVITY_TYPES.length, description: "Solo estos tipos (por defecto todos)." },
            organization_id: organizationIdSchema,
            since: { type: "string", format: "date-time", description: `Desde (ISO 8601). Por defecto hace ${DEFAULT_DAYS} días.` },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        const since = args.since ? new Date(args.since).toISOString() : new Date(Date.now() - DEFAULT_DAYS * 86400000).toISOString();
        const limit: number = args.limit;
        const want = (t: ActivityType) => !args.types?.length || args.types.includes(t);
        const org = args.organization_id as number | undefined;
        const byOrg = <Q,>(q: Q, column = "organization_id"): Q => (org ? (q as any).eq(column, org) : q);
        const recent = (table: string, cols: string, column = "created_at", extra?: (q: any) => any) =>
            tolerantAll<any>(() => {
                let q = supabase.from(table).select(cols).gte(column, since);
                if (extra) q = extra(q);
                return q.order(column, { ascending: false }).limit(limit);
            }, { max: limit });

        const entries: Entry[] = [];
        const eventIdsToResolve = new Set<number>();

        const [orgs, events, audits, payoutsCreated, payoutsPaid, payoutsCancelled, refundsCreated, refundsProcessed, reviews, adminAudits, recentSales] = await Promise.all([
            want("signup") ? recent("organizations", "id, public_name, created_at, signup_utm_source, signup_ref", "created_at", (q) => byOrg(q, "id")) : [],
            want("event_created") ? recent("events", "id, name, slug, status, organization_id, created_at", "created_at", (q) => byOrg(q)) : [],
            want("api_action") || want("event_published")
                ? recent("aitickets_api_audit", "id, created_at, organization_id, tool, channel, ok, error_code, event_id, summary, target", "created_at", (q) => byOrg(q))
                : [],
            want("payout") ? recent("aitickets_payouts", "id, organization_id, amount, status, created_at, requested_via", "created_at", (q) => byOrg(q)) : [],
            want("payout") ? recent("aitickets_payouts", "id, organization_id, amount, status, paid_at, reference", "paid_at", (q) => byOrg(q)) : [],
            want("payout") ? recent("aitickets_payouts", "id, organization_id, amount, cancelled_at", "cancelled_at", (q) => byOrg(q)) : [],
            want("refund") ? recent("aitickets_refunds", "id, organization_id, event_id, order_id, kind, total_amount, status, source, created_at", "created_at", (q) => byOrg(q)) : [],
            want("refund") ? recent("aitickets_refunds", "id, organization_id, event_id, order_id, total_amount, status, processed_at", "processed_at", (q) => byOrg(q)) : [],
            want("review") ? recent("aitickets_event_reviews", "id, organization_id, event_id, rating, created_at", "created_at", (q) => byOrg(q)) : [],
            want("admin_action") ? recent("aitickets_admin_audit", "id, created_at, tool, ok, error_code, organization_id, summary, target, reason", "created_at", (q) => byOrg(q.eq("read_only", false))) : [],
            want("first_sale") ? recent("event_orders", "id, event_id, created_at, ticket_details, payment_provider, ticket_qty", "created_at", (q) => q.eq("status", "paid")) : [],
        ]);

        for (const o of orgs) {
            entries.push({
                at: o.created_at,
                type: "signup",
                organization_id: Number(o.id),
                summary: `Nuevo productor: ${o.public_name}${o.signup_utm_source || o.signup_ref ? ` (origen: ${[o.signup_utm_source, o.signup_ref].filter(Boolean).join(", ")})` : ""}`,
                target: `organization:${o.id}`,
            });
        }
        for (const e of events) {
            if (isDemoEventSlug(e.slug)) continue;
            entries.push({
                at: e.created_at,
                type: "event_created",
                organization_id: Number(e.organization_id),
                summary: `Evento creado: ${e.name} (${e.status === "published" ? "hoy publicado" : "borrador"})`,
                target: `event:${e.id}`,
                event: { id: Number(e.id), name: e.name, slug: e.slug, status: e.status },
            });
        }
        for (const a of audits) {
            // Un cambio de estado exitoso es event_published (no se repite como api_action)
            if (a.tool === "set_event_status" && a.ok !== false && want("event_published")) {
                entries.push({ at: a.created_at, type: "event_published", organization_id: Number(a.organization_id), summary: `${a.summary || "Cambio de estado del evento"} (vía ${a.channel})`, target: a.event_id ? `event:${a.event_id}` : a.target || null });
                if (a.event_id) eventIdsToResolve.add(Number(a.event_id));
            } else if (want("api_action")) {
                entries.push({
                    at: a.created_at,
                    type: "api_action",
                    organization_id: Number(a.organization_id),
                    summary: `${a.tool} vía ${a.channel}: ${a.ok === false ? `rechazado (${a.error_code || "error"})` : a.summary || "ok"}`,
                    target: a.target || null,
                });
            }
        }
        for (const p of payoutsCreated) entries.push({ at: p.created_at, type: "payout", organization_id: Number(p.organization_id), summary: `Retiro solicitado por ${clp(p.amount)} (estado: ${p.status})`, target: `payout:${p.id}` });
        for (const p of payoutsPaid) entries.push({ at: p.paid_at, type: "payout", organization_id: Number(p.organization_id), summary: `Retiro de ${clp(p.amount)} transferido${p.reference ? ` (comprobante ${p.reference})` : ""}`, target: `payout:${p.id}` });
        for (const p of payoutsCancelled) entries.push({ at: p.cancelled_at, type: "payout", organization_id: Number(p.organization_id), summary: `Retiro de ${clp(p.amount)} anulado`, target: `payout:${p.id}` });
        for (const r of refundsCreated) {
            entries.push({
                at: r.created_at,
                type: "refund",
                organization_id: Number(r.organization_id),
                summary: `Reembolso ${r.source === "cancel_event" ? "por cancelación del evento" : r.kind === "partial" ? "parcial" : "total"} pedido: ${clp(r.total_amount)} (estado: ${r.status})`,
                target: `order:${r.order_id}`,
            });
            eventIdsToResolve.add(Number(r.event_id));
        }
        for (const r of refundsProcessed) entries.push({ at: r.processed_at, type: "refund", organization_id: Number(r.organization_id), summary: `Reembolso de ${clp(r.total_amount)}: ${r.status}`, target: `order:${r.order_id}` });
        for (const r of reviews) {
            entries.push({ at: r.created_at, type: "review", organization_id: Number(r.organization_id), summary: `Nueva reseña: ${r.rating}/5`, target: `event:${r.event_id}` });
            eventIdsToResolve.add(Number(r.event_id));
        }
        for (const a of adminAudits) {
            entries.push({
                at: a.created_at,
                type: "admin_action",
                organization_id: a.organization_id != null ? Number(a.organization_id) : null,
                summary: `${a.tool}: ${a.ok === false ? `rechazado (${a.error_code || "error"})` : a.summary || "ok"}${a.reason ? ` — motivo: ${a.reason}` : ""}`,
                target: a.target || null,
            });
        }

        // Primeras ventas: órdenes vendidas recientes de organizaciones que no tenían ventas antes de `since`
        if (recentSales.length) {
            const sales = recentSales.filter(isSaleOrder);
            const saleEventIds = [...new Set(sales.map((o: any) => Number(o.event_id)))];
            const saleEvents = saleEventIds.length
                ? await tolerantAll<any>(() => supabase.from("events").select("id, name, slug, organization_id").in("id", saleEventIds).order("id", { ascending: true }))
                : [];
            const eventOrg = new Map(saleEvents.filter((e: any) => !isDemoEventSlug(e.slug)).map((e: any) => [Number(e.id), e]));
            const firstInWindow = new Map<number, any>();
            for (const o of [...sales].sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))) {
                const e = eventOrg.get(Number(o.event_id));
                if (!e || (org && Number(e.organization_id) !== org)) continue;
                if (!firstInWindow.has(Number(e.organization_id))) firstInWindow.set(Number(e.organization_id), { order: o, event: e });
            }
            for (const [orgId, { order, event }] of firstInWindow) {
                const orgEvents = await tolerantAll<any>(() => supabase.from("events").select("id").eq("organization_id", orgId).order("id", { ascending: true }));
                const ids = orgEvents.map((e: any) => Number(e.id));
                const earlier = ids.length ? (await loadPaidOrders(supabase, ids, { fromIso: "1970-01-01T00:00:00.000Z", toIso: since })).filter(isSaleOrder) : [];
                if (earlier.length) continue;
                entries.push({
                    at: order.created_at,
                    type: "first_sale",
                    organization_id: orgId,
                    summary: `Primera venta del productor: "${event.name}"`,
                    target: `order:${order.id}`,
                    event: { id: Number(event.id), name: event.name, slug: event.slug, status: "published" },
                });
            }
        }

        const top = entries.filter((e) => e.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
        const extraEvents = [...eventIdsToResolve].filter((id) => !top.some((e) => e.event?.id === id));
        const resolved = extraEvents.length
            ? await tolerantAll<any>(() => supabase.from("events").select("id, name, slug, status").in("id", extraEvents).order("id", { ascending: true }))
            : [];
        const eventById = new Map(resolved.map((e: any) => [Number(e.id), e]));
        const names = await orgNames(supabase, top.map((e) => Number(e.organization_id)));

        return {
            since,
            returned: top.length,
            entries: top.map((e) => {
                const eventId = e.event?.id ?? (e.target?.startsWith("event:") ? Number(e.target.slice(6)) : null);
                const ev = e.event || (eventId ? eventById.get(eventId) : null);
                return {
                    at: e.at,
                    at_local: localDateTime(e.at),
                    type: e.type,
                    organization: e.organization_id ? { id: e.organization_id, name: names.get(e.organization_id) || null } : null,
                    summary: e.summary,
                    target: e.target || null,
                    links: ev
                        ? { event_id: Number(ev.id), event_name: ev.name ?? null, ...(ev.status === "published" ? { public_url: eventPublicUrl({ origin: actx.origin } as any, ev.slug) } : {}) }
                        : null,
                };
            }),
            note:
                "event_published solo incluye publicaciones hechas por MCP/API (set_event_status): las del panel no guardan fecha. " +
                "Cada fuente aporta como máximo `limit` filas recientes antes de mezclar.",
        };
    },
};

export const activityTools: AdminToolDef[] = [listPlatformActivity];
