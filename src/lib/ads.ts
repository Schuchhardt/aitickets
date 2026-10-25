// Anuncios en Meta vía Zernio para el panel (/api/promote/ads/* y /dashboard/promote): conexiones, lista de anuncios con
// sus ventas atribuidas y la sincronización con Zernio. Las reglas y llamadas a Zernio están en netlify/lib/zernio-ads.mjs.
import { getStaffEventIds } from "../../netlify/lib/event-staff.mjs";
import { adEfficiency, recoverCreatingAd, salesByAd, syncAdCampaign } from "../../netlify/lib/zernio-ads.mjs";
import { jsonResponse } from "./supabaseServer";

/** Propósito del state firmado de la conexión de anuncios (distinto del de publicar posts). */
export const ADS_STATE_PURPOSE = "zernio-ads";
/** Cuánto dura un state de conexión (Zernio corta su propio flujo a los 30 min). */
export const ADS_STATE_MAX_AGE_MS = 30 * 60 * 1000;
/** Cada cuánto se vuelven a pedir métricas a Zernio al abrir el panel. */
const SYNC_EVERY_MS = 10 * 60 * 1000;
const MAX_SYNC_PER_CALL = 15;
const TERMINAL = new Set(["cancelled", "error", "completed", "rejected"]);

export const AD_CONNECTION_COLUMNS =
    "id, meta_ad_account_id, account_name, currency, timezone_name, minimum_daily_budget, status, unusable_reason, zernio_account_id, updated_at";
const AD_COLUMNS =
    "id, organization_id, event_id, ad_account_connection_id, provider, ad_type, social_post_id, name, status, review_status, " +
    "daily_budget, total_budget, currency, start_date, end_date, duration_days, ad_copy, headline, image_urls, call_to_action, " +
    "destination_url, target_audience, impressions, clicks, spend, reach, ctr, cpc, cpm, last_synced_at, error_message, " +
    "zernio_ad_id, zernio_request, created_at, events ( id, name, title, slug )";

export const adsJsonError = (message: string, status: number) => jsonResponse({ message }, status);

/** Cuentas publicitarias de Meta conectadas vía Zernio (sin las desconectadas). */
export async function loadAdConnections(supabase: any, organizationId: number) {
    const { data, error } = await supabase
        .from("ad_account_connections")
        .select(AD_CONNECTION_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("provider", "zernio")
        .in("status", ["active", "unusable"])
        .order("id", { ascending: true });
    if (error) throw error;
    return (data || []).map(({ zernio_account_id, ...rest }: any) => rest);
}

/** Lo que ve el panel de un anuncio: sin el request interno, con ventas atribuidas y eficiencia. */
export function presentAd(row: any, sales?: { tickets: number; revenue_clp: number; orders: number }) {
    const { zernio_request, zernio_ad_id, organization_id, ...rest } = row;
    const tickets = sales?.tickets || 0;
    const revenue = sales?.revenue_clp || 0;
    const event = Array.isArray(rest.events) ? rest.events[0] : rest.events;
    return {
        ...rest,
        events: undefined,
        event: event ? { id: event.id, name: event.title || event.name, slug: event.slug } : null,
        has_platform_ad: Boolean(zernio_ad_id),
        sales: { tickets, revenue_clp: revenue, orders: sales?.orders || 0 },
        ...adEfficiency(rest.spend, tickets, revenue, rest.currency),
    };
}

/**
 * Anuncios de la organización (los de Zernio), los más nuevos primero, con sus ventas atribuidas
 * (utm_campaign=ad-<id>). Quien está asignado solo a algunos eventos ve solo esos. Con sync, reintenta las creaciones
 * sin confirmar y actualiza estado y métricas de los que llevan más de 10 min sin sincronizar.
 */
export async function loadAdsView(supabase: any, { organizationId, userId, eventId = null, sync = false, now = new Date() }: { organizationId: number; userId: number | null; eventId?: number | null; sync?: boolean; now?: Date }) {
    let query = supabase.from("ad_campaigns").select(AD_COLUMNS).eq("organization_id", organizationId).eq("provider", "zernio");
    if (eventId) query = query.eq("event_id", eventId);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    const allowed = userId == null ? null : await getStaffEventIds(supabase, userId);
    let rows: any[] = (data || []).filter((r: any) => !allowed || allowed.includes(Number(r.event_id)));

    if (sync) {
        let budget = MAX_SYNC_PER_CALL;
        const out = [];
        for (const row of rows) {
            let next = row;
            if (budget > 0 && row.status === "creating") {
                budget -= 1;
                next = await recoverCreatingAd(supabase, row, { now });
            } else if (budget > 0 && row.zernio_ad_id && !TERMINAL.has(row.status) && (!row.last_synced_at || now.getTime() - Date.parse(row.last_synced_at) > SYNC_EVERY_MS)) {
                budget -= 1;
                next = await syncAdCampaign(supabase, row, { now });
            }
            out.push(next);
        }
        rows = out;
    }

    const eventIds = [...new Set(rows.map((r) => Number(r.event_id)))];
    let sales = new Map();
    if (eventIds.length) {
        const { data: orders, error: oError } = await supabase
            .from("event_orders")
            .select("created_at, amount, ticket_qty, ticket_details, payment_provider, utm_campaign")
            .in("event_id", eventIds)
            .eq("status", "paid")
            .ilike("utm_campaign", "ad-%")
            .limit(20000);
        if (oError) throw oError;
        sales = salesByAd(orders || []);
    }
    return rows.map((r) => presentAd(r, sales.get(Number(r.id))));
}
