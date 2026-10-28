// Buscador para segmentar un anuncio (ids de Meta vía Zernio). GET ?connectionId=&q=&dimension=
//   dimension geo (por defecto): ciudades de Chile · interest: intereses · workPosition: cargos (profesión)
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../../lib/supabaseServer";
import { adsJsonError } from "../../../../lib/ads";
import { AUDIENCE_DIMENSIONS, adsEnabled, friendlyAdsError, searchAdAudience, searchAdCities } from "../../../../../netlify/lib/zernio-ads.mjs";

export const GET: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return adsJsonError("No autorizado", 401);
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) return adsJsonError("No tienes permisos para esta acción", 403);
    if (!adsEnabled()) return adsJsonError("Los anuncios no están disponibles en este momento.", 503);

    const q = (context.url.searchParams.get("q") || "").trim();
    const connectionId = Number(context.url.searchParams.get("connectionId"));
    const dimension = context.url.searchParams.get("dimension") || "geo";
    if (dimension !== "geo" && !Object.hasOwn(AUDIENCE_DIMENSIONS, dimension)) return adsJsonError("Búsqueda no válida", 400);
    if (q.length < 2 || q.length > 80 || !Number.isSafeInteger(connectionId)) return jsonResponse({ results: [] });

    const { data: connection } = await getSupabaseAdmin()
        .from("ad_account_connections")
        .select("zernio_account_id, status")
        .eq("id", connectionId)
        .eq("organization_id", Number(session.dbUser.organization_id))
        .eq("provider", "zernio")
        .maybeSingle();
    if (!connection?.zernio_account_id || connection.status !== "active") return adsJsonError("Cuenta publicitaria no encontrada", 404);
    try {
        const results = dimension === "geo" ? await searchAdCities(connection.zernio_account_id, q) : await searchAdAudience(connection.zernio_account_id, q, dimension);
        return jsonResponse({ results });
    } catch (err: any) {
        console.error("[ads/targeting]", err?.status || "", err?.message);
        return adsJsonError(friendlyAdsError(err), 502);
    }
};
