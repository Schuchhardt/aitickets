// GET /api/events/social-series-preview?event_id=&kind=story|feed_post&days=N[&variant=sold_out][&platform=facebook|tiktok] → JPG de una pieza de
// la difusión automática con los datos de ESTE momento (la que se publique se renderiza ~2 h antes, con los vigentes).
// Para la vista previa del calendario en la tarjeta del panel: sesión del productor con acceso al evento. Facebook y
// TikTok muestran dónde comprar en vez de la palabra clave; TikTok usa el formato vertical.
// GET ?token= → la misma imagen sin sesión, con el link firmado que entrega get_social_series (preview_url): una pieza,
// 24 h (src/lib/socialSeriesPreview.ts). Solo lee: no guarda la imagen ni toca los slots.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getOwnedEvent, getSessionContext, hasRole, EVENT_MANAGER_ROLES } from "../../../lib/supabaseServer";
import { anchorFor, baseImageOptionsFor, baseImageUrlFor, loadBaseImage, loadCadenceConfig, loadLatestSeries, loadSeriesEvent, pieceDataFor, shortEventLink } from "../../../lib/socialSeries";
import { renderPiece } from "../../../lib/socialSeriesRender";
import { loadSharp } from "../../../lib/imageOptimize";
import { normalizePiece, verifyPreviewToken, type PreviewPiece } from "../../../lib/socialSeriesPreview";

export const prerender = false;

const PREVIEW_WIDTH = 540;

export const GET: APIRoute = async (context) => {
    const params = context.url.searchParams;
    let piece: PreviewPiece | null;
    if (params.has("token")) {
        piece = verifyPreviewToken(params.get("token"));
        if (!piece) return new Response(null, { status: 403 });
    } else {
        const session = await getSessionContext(context);
        if (!session) return new Response(null, { status: 401 });
        if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) return new Response(null, { status: 403 });
        piece = normalizePiece({ eventId: params.get("event_id"), kind: params.get("kind"), variant: params.get("variant"), days: params.get("days"), platform: params.get("platform") });
        if (!piece) return new Response(null, { status: 400 });
        if (!(await getOwnedEvent(piece.eventId, Number(session.dbUser.organization_id), "id", Number(session.dbUser.id)))) return new Response(null, { status: 404 });
    }
    const { eventId, kind, variant, days, platform } = piece;

    const supabase = getSupabaseAdmin();
    const event = await loadSeriesEvent(supabase, eventId);
    if (!event) return new Response(null, { status: 404 });
    const series = await loadLatestSeries(supabase, eventId);
    const config = await loadCadenceConfig(supabase);
    const anchor = series?.anchor_starts_at ? new Date(series.anchor_starts_at) : anchorFor(event);
    try {
        const data = await pieceDataFor(supabase, series, event, { kind, variant, days_to_event: days }, config, anchor);
        if (platform !== "instagram") data.linkLabel = shortEventLink(context.url.origin, event.slug);
        const full = await renderPiece(data, await loadBaseImage(baseImageUrlFor(series, event)), baseImageOptionsFor(series, event));
        const sharp = await loadSharp();
        const small = sharp ? await sharp(full).resize({ width: PREVIEW_WIDTH }).jpeg({ quality: 78 }).toBuffer() : full;
        return new Response(new Uint8Array(small), { status: 200, headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
    } catch (err: any) {
        console.error("social-series-preview:", err?.message || err);
        return new Response(null, { status: 500 });
    }
};
