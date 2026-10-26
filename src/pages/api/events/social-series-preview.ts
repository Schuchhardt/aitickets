// GET /api/events/social-series-preview?event_id=&kind=story|feed_post&days=N[&variant=sold_out] → JPG de una pieza de
// la difusión automática con los datos de ESTE momento (la que se publique se renderiza ~2 h antes, con los vigentes).
// Para la vista previa del calendario en la tarjeta del panel: sesión del productor con acceso al evento.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getOwnedEvent, getSessionContext, hasRole, EVENT_MANAGER_ROLES } from "../../../lib/supabaseServer";
import { anchorFor, baseImageOptionsFor, baseImageUrlFor, loadBaseImage, loadCadenceConfig, loadLatestSeries, loadSeriesEvent, pieceDataFor } from "../../../lib/socialSeries";
import { renderPiece } from "../../../lib/socialSeriesRender";
import { loadSharp } from "../../../lib/imageOptimize";

export const prerender = false;

const PREVIEW_WIDTH = 540;

export const GET: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return new Response(null, { status: 401 });
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) return new Response(null, { status: 403 });
    const params = context.url.searchParams;
    const eventId = Math.round(Number(params.get("event_id")));
    const kind = params.get("kind") === "feed_post" ? "feed_post" : "story";
    const variant = params.get("variant") === "sold_out" ? "sold_out" : "countdown";
    const days = Math.max(0, Math.min(400, Math.round(Number(params.get("days")) || 0)));
    if (!Number.isInteger(eventId) || eventId <= 0) return new Response(null, { status: 400 });
    if (!(await getOwnedEvent(eventId, Number(session.dbUser.organization_id), "id", Number(session.dbUser.id)))) return new Response(null, { status: 404 });

    const supabase = getSupabaseAdmin();
    const event = await loadSeriesEvent(supabase, eventId);
    if (!event) return new Response(null, { status: 404 });
    const series = await loadLatestSeries(supabase, eventId);
    const config = await loadCadenceConfig(supabase);
    const anchor = series?.anchor_starts_at ? new Date(series.anchor_starts_at) : anchorFor(event);
    try {
        const data = await pieceDataFor(supabase, series, event, { kind, variant, days_to_event: days }, config, anchor);
        const full = await renderPiece(data, await loadBaseImage(baseImageUrlFor(series, event)), baseImageOptionsFor(series, event));
        const sharp = await loadSharp();
        const small = sharp ? await sharp(full).resize({ width: PREVIEW_WIDTH }).jpeg({ quality: 78 }).toBuffer() : full;
        return new Response(new Uint8Array(small), { status: 200, headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300" } });
    } catch (err: any) {
        console.error("social-series-preview:", err?.message || err);
        return new Response(null, { status: 500 });
    }
};
