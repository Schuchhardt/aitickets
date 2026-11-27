// POST /api/internal/market-import — entrada de los importadores automáticos de eventos externos (/panoramas y mapa de
// mercado). Solo server-to-server con x-internal-secret: la llama netlify/functions/market-watch-background.
//
// Cuerpo: { events?: [ítems de register_external_events], sync_competitor_events?: { offset?, limit? }, dry_run? }
//   events: hasta 40; se registran con el MISMO núcleo que el MCP (validación, normalización y deduplicación) en lotes
//           chicos hasta agotar el plazo. remaining > 0 = reenviar los últimos `remaining`.
//   sync_competitor_events: pasa los eventos del vigía de Passline (aitickets_competitor_events) a eventos externos;
//           next_offset != null = volver a llamar con ese offset.
// Las funciones síncronas de Netlify cortan a los 10 s: el plazo por defecto es 7 s (MARKET_IMPORT_BUDGET_MS).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { hasValidInternalSecret } from "../../../../netlify/lib/supabase.mjs";
import { importEventItems, syncCompetitorEvents } from "../../../lib/market/importer";
import { serverEnv } from "../_lib/server-utils";

export const prerender = false;

const MAX_EVENTS = 40;

export const POST: APIRoute = async ({ request }) => {
  if (!hasValidInternalSecret(request)) return jsonResponse({ error: "No autorizado" }, 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonResponse({ error: "JSON inválido" }, 400);
  const events = Array.isArray(body.events) ? body.events : null;
  if (events && events.length > MAX_EVENTS) return jsonResponse({ error: `Máximo ${MAX_EVENTS} eventos por llamada` }, 400);
  const sync = body.sync_competitor_events && typeof body.sync_competitor_events === "object" ? body.sync_competitor_events : null;
  if (!events && !sync) return jsonResponse({ error: "Nada que hacer: manda events o sync_competitor_events" }, 400);

  const dryRun = body.dry_run === true;
  const budgetMs = Math.min(8500, Math.max(1000, Number(serverEnv("MARKET_IMPORT_BUDGET_MS")) || 7000));
  const deadline = Date.now() + budgetMs;
  const supabase = getSupabaseAdmin();
  try {
    const out: Record<string, unknown> = { ok: true, dry_run: dryRun };
    if (events?.length) out.import = await importEventItems(supabase, events, { deadline, dryRun });
    if (sync && Date.now() < deadline) {
      const offset = Math.max(0, Math.floor(Number(sync.offset) || 0));
      const limit = Math.min(40, Math.max(1, Math.floor(Number(sync.limit) || 24)));
      out.sync = await syncCompetitorEvents(supabase, { offset, limit, dryRun, deadline });
    }
    return jsonResponse(out);
  } catch (err: any) {
    console.error("internal/market-import:", err?.message || err);
    const unavailable = err?.code === "unavailable";
    return jsonResponse({ ok: false, error: unavailable ? err.message : "Error interno" }, unavailable ? 503 : 500);
  }
};
