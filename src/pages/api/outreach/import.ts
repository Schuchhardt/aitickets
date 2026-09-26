// POST /api/outreach/import — importación CSV de leads (uso interno; header x-internal-secret).
// Columnas: org_name, website, source_url (obligatoria: dónde se encontró el dato), email?, city?,
// country?, event_name?, event_date?, event_venue?. Separador coma o punto y coma. Máx. 500 filas.
// Los leads entran como 'new' (pasan por enriquecimiento y todos los guardarraíles antes de cualquier envío).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { hasValidInternalSecret } from "../../../../netlify/lib/supabase.mjs";
import { csvRowToCandidate, parseCsv } from "../../../../netlify/lib/outreach/sources/inbound.mjs";
import { upsertCandidate } from "../../../../netlify/lib/outreach/sources/index.mjs";

export const prerender = false;
const MAX_ROWS = 500;

export const POST: APIRoute = async ({ request }) => {
    if (!hasValidInternalSecret(request)) return jsonResponse({ error: "No autorizado" }, 401);
    const text = await request.text();
    if (text.length > 2_000_000) return jsonResponse({ error: "CSV demasiado grande" }, 413);
    const rows = parseCsv(text);
    if (!rows.length) return jsonResponse({ error: "CSV vacío o sin encabezado" }, 400);
    if (rows.length > MAX_ROWS) return jsonResponse({ error: `Máximo ${MAX_ROWS} filas por importación` }, 413);

    const supabase = getSupabaseAdmin();
    const { data: source } = await supabase.from("aitickets_lead_sources").select("enabled").eq("key", "csv_import").maybeSingle();
    if (source && source.enabled === false) return jsonResponse({ error: "Fuente csv_import deshabilitada" }, 409);

    const summary = { inserted: 0, updated: 0, skipped: 0, errors: [] as { row: number; error: string }[] };
    for (const [i, r] of rows.entries()) {
        const { candidate, error } = csvRowToCandidate(r);
        if (!candidate) {
            summary.errors.push({ row: i + 2, error: error || "fila inválida" });
            continue;
        }
        try {
            const res = await upsertCandidate(supabase, "csv_import", candidate) as "inserted" | "updated" | "skipped";
            summary[res]++;
        } catch (err: any) {
            summary.errors.push({ row: i + 2, error: String(err?.message || err).slice(0, 200) });
        }
    }
    await supabase
        .from("aitickets_lead_sources")
        .update({ last_run_at: new Date().toISOString(), last_result: { ...summary, errors: summary.errors.length } })
        .eq("key", "csv_import");
    return jsonResponse({ ok: true, ...summary });
};
