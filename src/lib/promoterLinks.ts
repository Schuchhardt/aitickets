// Links privados de promotor / RRPP (/promotor/<token>, tabla aitickets_promoter_links): el promotor ve SOLO sus
// ventas, las órdenes pagadas con su ?ref=, por evento y función, sin datos de compradores. Se crean desde el panel
// del evento (/api/events/promoter-links) y el asistente de IA (create_promoter_link). Solo se guarda el sha256 del
// token, igual que los links de escáner de puerta (checkinAccess.ts).
// Venta = la misma regla que el panel (eventAnalytics.summarizeSales): sin cortesías ni transferencias.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { orderLines, lineSoldQty } from "./orderKinds";
import { summarizeSales } from "./eventAnalytics";
import { fetchAll } from "./producer-api/tools/common";
import { formatFunctionLabel } from "../../netlify/lib/dates.mjs";

export const PROMOTER_PATH = "/promotor";
export const PROMOTER_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
export const PROMOTER_REF_RE = /^[a-z0-9_.-]{1,64}$/;
/** Eventos que ya terminaron hace más de esto y sin ventas del promotor no se muestran. */
const RECENT_MS = 2 * 86_400_000;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
export const promoterUrl = (origin: string, token: string) => `${origin.replace(/\/+$/, "")}${PROMOTER_PATH}/${token}`;

/** "Juan Pérez" → "juan-perez" (el ?ref= del link; mismo criterio que TrackingLinkBuilder.vue). */
export function promoterRef(value: string): string {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9_.-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
}

export type PromoterLinkRow = {
    id: string;
    organization_id: number;
    event_id: number | null;
    ref: string;
    name: string;
    revoked_at: string | null;
    last_opened_at: string | null;
    open_count: number | null;
    created_at: string;
};

const LINK_COLUMNS = "id, organization_id, event_id, ref, name, revoked_at, last_opened_at, open_count, created_at";

/** Representación para el productor (nunca incluye el token: no se guarda). */
export function presentPromoterLink(link: PromoterLinkRow) {
    return {
        id: link.id,
        name: link.name,
        ref: link.ref,
        event_id: link.event_id == null ? null : Number(link.event_id),
        scope: link.event_id == null ? "all_events" : "event",
        status: link.revoked_at ? "revoked" : "active",
        opens: Number(link.open_count) || 0,
        last_opened_at: link.last_opened_at,
        created_at: link.created_at,
    };
}

export async function createPromoterLink(
    supabase: any,
    input: { orgId: number; eventId: number | null; name: string; ref?: string | null; userId: number | null; origin: string },
) {
    const name = String(input.name || "").trim().slice(0, 80);
    const ref = promoterRef(input.ref || name);
    if (!name || !PROMOTER_REF_RE.test(ref)) throw new Error("invalid_promoter");
    const token = randomBytes(24).toString("base64url");
    const { data, error } = await supabase
        .from("aitickets_promoter_links")
        .insert({ id: randomUUID(), organization_id: input.orgId, event_id: input.eventId, ref, name, token_hash: sha256(token), created_by: input.userId })
        .select(LINK_COLUMNS)
        .single();
    if (error) throw error;
    return { url: promoterUrl(input.origin, token), link: presentPromoterLink(data) };
}

/**
 * Links de la organización. Con `eventId`: los de ese evento y los de todos los eventos (los que también lo cubren).
 * `eventIds` (miembro con acceso solo a algunos eventos): solo los links de esos eventos.
 */
export async function listPromoterLinks(supabase: any, orgId: number, { eventId = null, eventIds = null }: { eventId?: number | null; eventIds?: number[] | null } = {}) {
    const { data, error } = await supabase
        .from("aitickets_promoter_links")
        .select(LINK_COLUMNS)
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(500);
    if (error) throw error;
    return ((data || []) as PromoterLinkRow[])
        .filter((l) => (eventIds ? l.event_id != null && eventIds.includes(Number(l.event_id)) : true))
        .filter((l) => (eventId != null ? l.event_id == null || Number(l.event_id) === Number(eventId) : true))
        .map(presentPromoterLink);
}

export async function revokePromoterLink(supabase: any, linkId: string, orgId: number, eventIds?: number[] | null): Promise<PromoterLinkRow | null> {
    const { data: link } = await supabase.from("aitickets_promoter_links").select(LINK_COLUMNS).eq("id", linkId).eq("organization_id", orgId).maybeSingle();
    if (!link || (eventIds && (link.event_id == null || !eventIds.includes(Number(link.event_id))))) return null;
    if (!link.revoked_at) {
        const revokedAt = new Date().toISOString();
        const { error } = await supabase.from("aitickets_promoter_links").update({ revoked_at: revokedAt }).eq("id", link.id).eq("organization_id", orgId);
        if (error) throw error;
        link.revoked_at = revokedAt;
    }
    return link;
}

/** Link vigente para el token, con el nombre público de la productora; null si no existe o fue revocado. */
export async function resolvePromoterToken(supabase: any, token: string): Promise<{ link: PromoterLinkRow; organizationName: string } | null> {
    if (!PROMOTER_TOKEN_RE.test(token || "")) return null;
    const { data: link, error } = await supabase.from("aitickets_promoter_links").select(LINK_COLUMNS).eq("token_hash", sha256(token)).maybeSingle();
    if (error || !link || link.revoked_at) return null;
    const { data: org } = await supabase.from("organizations").select("id, public_name, name").eq("id", link.organization_id).maybeSingle();
    if (!org) return null;
    return { link, organizationName: org.public_name || org.name || "" };
}

/** Registra la apertura (best effort; nunca falla la página). */
export async function touchPromoterLink(supabase: any, link: PromoterLinkRow) {
    try {
        await supabase
            .from("aitickets_promoter_links")
            .update({ last_opened_at: new Date().toISOString(), open_count: (Number(link.open_count) || 0) + 1 })
            .eq("id", link.id);
    } catch {
        /* ignorar */
    }
}

export type PromoterEventStats = {
    id: number;
    name: string;
    start_date: string | null;
    share_url: string | null;
    on_sale: boolean;
    orders: number;
    tickets: number;
    revenue_clp: number;
    last_sale_at: string | null;
    by_function: Array<{ label: string; tickets: number; revenue_clp: number }>;
};

/** `ref` exacto sin importar mayúsculas (los links viejos pueden traer ?ref=Juan). `_` es comodín en ILIKE. */
const refPattern = (ref: string) => ref.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Lo que ve el promotor: sus ventas por evento (y por función), más los eventos publicados que aún puede promocionar
 * con su link. Sin datos de compradores: solo cantidades, montos y fechas.
 */
export async function promoterStats(supabase: any, link: PromoterLinkRow, origin: string, now = Date.now()) {
    const eventsQuery = () => {
        const q = supabase.from("events").select("id, name, slug, status, start_date, end_date").eq("organization_id", link.organization_id);
        return (link.event_id != null ? q.eq("id", link.event_id) : q).order("id", { ascending: true });
    };
    const events: any[] = await fetchAll<any>(eventsQuery, { max: 5000 });
    const eventIds = events.map((e) => Number(e.id));

    const orders: any[] = [];
    for (let i = 0; i < eventIds.length; i += 200) {
        const chunk = eventIds.slice(i, i + 200);
        orders.push(
            ...(await fetchAll<any>(() =>
                supabase
                    .from("event_orders")
                    .select("id, event_id, created_at, amount, ticket_qty, ticket_details, payment_provider")
                    .in("event_id", chunk)
                    .eq("status", "paid")
                    .ilike("ref", refPattern(link.ref))
                    .order("created_at", { ascending: true })
                    .order("id", { ascending: true }),
            )),
        );
    }
    const byEvent = new Map<number, any[]>();
    for (const o of orders) byEvent.set(Number(o.event_id), [...(byEvent.get(Number(o.event_id)) || []), o]);

    // Etiquetas de función de los eventos con ventas
    const soldEventIds = [...byEvent.keys()];
    const fnLabels = new Map<string, string>();
    if (soldEventIds.length) {
        const { data: dates } = await supabase.from("event_dates").select("id, event_id, date, start_time").in("event_id", soldEventIds);
        for (const d of dates || []) fnLabels.set(String(d.id), formatFunctionLabel(d, { withPlace: false }));
    }

    const rows: PromoterEventStats[] = [];
    for (const e of events) {
        const sales = summarizeSales(byEvent.get(Number(e.id)) || []);
        const published = e.status === "published";
        const ended = e.end_date ? new Date(e.end_date).getTime() < now : false;
        const recent = !e.end_date || new Date(e.end_date).getTime() >= now - RECENT_MS;
        if (!sales.paidOrders && !(published && recent)) continue;

        const fns = new Map<string, { label: string; tickets: number; revenue_clp: number }>();
        for (const o of sales.sales) {
            const lines = orderLines(o);
            const total = lines.reduce((n: number, l: any) => n + (Number(l?.total) || (Number(l?.price) || 0) * lineSoldQty(l)), 0);
            for (const l of lines) {
                const key = l?.event_date_id == null ? "all" : String(l.event_date_id);
                const label = key === "all" ? "Todas las funciones" : fnLabels.get(key) || "Función";
                const row = fns.get(key) || { label, tickets: 0, revenue_clp: 0 };
                row.tickets += lineSoldQty(l);
                // El monto de la orden (ya con descuentos) se reparte entre sus líneas según su precio
                const lineTotal = Number(l?.total) || (Number(l?.price) || 0) * lineSoldQty(l);
                row.revenue_clp += total > 0 ? Math.round(((Number(o.amount) || 0) * lineTotal) / total) : 0;
                fns.set(key, row);
            }
        }
        rows.push({
            id: Number(e.id),
            name: e.name,
            start_date: e.start_date,
            share_url: published && e.slug ? `${origin.replace(/\/+$/, "")}/eventos/${e.slug}?ref=${encodeURIComponent(link.ref)}` : null,
            on_sale: published && !ended,
            orders: sales.paidOrders,
            tickets: sales.ticketsSold,
            revenue_clp: sales.revenue,
            last_sale_at: sales.lastSaleAt,
            by_function: fns.size > 1 ? [...fns.values()] : [],
        });
    }
    // Primero los que están a la venta (el más próximo arriba), después los pasados (el más reciente arriba)
    const time = (r: PromoterEventStats) => (r.start_date ? new Date(r.start_date).getTime() : 0);
    rows.sort((a, b) => Number(b.on_sale) - Number(a.on_sale) || (a.on_sale ? time(a) - time(b) : time(b) - time(a)));

    return {
        events: rows,
        totals: {
            orders: rows.reduce((n, r) => n + r.orders, 0),
            tickets: rows.reduce((n, r) => n + r.tickets, 0),
            revenue_clp: rows.reduce((n, r) => n + r.revenue_clp, 0),
        },
        as_of: new Date(now).toISOString(),
    };
}
