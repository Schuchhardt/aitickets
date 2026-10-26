// POST /api/social-series/run — pasada del job de la difusión automática (src/lib/socialSeries.ts runSeriesJobs):
// cortes (agotado, cancelado, cambio de fecha, Instagram desconectado) y despacho de las piezas de las próximas ~2 h a
// Zernio. La llama la función programada social-series-dispatch cada 15 min con x-internal-secret.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { hasValidInternalSecret } from "../../../../netlify/lib/supabase.mjs";
import { runSeriesJobs } from "../../../lib/socialSeries";
import { publicOrigin } from "../../../lib/producer-api/http";
import { serverEnv, siteUrl } from "../_lib/server-utils";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
    if (!hasValidInternalSecret(request)) return jsonResponse({ error: "No autorizado" }, 401);
    const origin = siteUrl() || publicOrigin(new URL(request.url));
    try {
        // Las funciones síncronas de Netlify cortan a los 10 s: lo que no alcance sale en la próxima pasada (15 min)
        const budgetMs = Number(serverEnv("SOCIAL_SERIES_BUDGET_MS")) || 7000;
        const summary = await runSeriesJobs(getSupabaseAdmin(), { origin, budgetMs });
        return jsonResponse({ ok: true, ...summary });
    } catch (err: any) {
        console.error("social-series/run:", err?.message || err);
        return jsonResponse({ ok: false, error: "Error interno" }, 500);
    }
};
