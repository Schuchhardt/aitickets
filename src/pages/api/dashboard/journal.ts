// POST /api/dashboard/journal — recibe los lotes del rastreador del panel (src/lib/producerActivityClient.js) y los
// guarda en la bitácora de uso (aitickets_producer_activity). Exige la sesión del productor: la organización y el
// usuario salen de la sesión, nunca del cuerpo. Responde 204 aunque no se haya podido guardar (perder un lote no es
// un error del productor); 401 sin sesión para que el navegador deje de enviar en esa página.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, jsonResponse } from "../../../lib/supabaseServer";
import { MAX_ACTIVITY_BODY, insertActivityRows, producerActivityEnabled, sanitizeActivityBatch } from "../../../lib/producerActivity";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";

export const prerender = false;

/** Lotes por minuto y usuario (el navegador manda uno cada 15 s o cada 25 hechos). */
export const JOURNAL_BATCHES_PER_MINUTE = 40;

const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export const POST: APIRoute = async (context) => {
    if (!producerActivityEnabled()) return new Response(null, { status: 410, headers: { "Cache-Control": "no-store" } });
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);

    const raw = await context.request.text().catch(() => "");
    if (raw.length > MAX_ACTIVITY_BODY) return jsonResponse({ error: "Lote demasiado grande" }, 413);
    let body: unknown;
    try {
        body = JSON.parse(raw);
    } catch {
        return jsonResponse({ error: "JSON inválido" }, 400);
    }
    const batch = sanitizeActivityBatch(body);
    if (!batch.ok) return jsonResponse({ error: batch.error }, 400);
    if (!batch.rows.length) return noContent();

    const supabase = getSupabaseAdmin();
    const limit = await rateLimit("dashboard:journal", String(session.dbUser.id), { windowSeconds: 60, max: JOURNAL_BATCHES_PER_MINUTE, supabase });
    if (!limit.allowed) return jsonResponse({ error: "Demasiados lotes" }, 429);

    const organizationId = Number(session.dbUser.organization_id);
    const userId = Number(session.dbUser.id);
    await insertActivityRows(
        supabase,
        batch.rows.map((row) => ({ ...row, organization_id: organizationId, user_id: userId })),
    );
    return noContent();
};
