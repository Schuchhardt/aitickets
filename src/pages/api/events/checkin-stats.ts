// Aforo en vivo del panel (LiveCapacityPanel.vue): GET /api/events/checkin-stats?event_id=N
// Es la misma herramienta get_checkin_stats del asistente de IA (src/lib/producer-api/tools/access.ts) con la sesión
// del usuario: emitidas, ingresadas, % de aforo, por tipo de entrada y función, y llegadas cada 15 minutos.
// Permiso "checkin" (dueño, administrador, marketing y puerta); un miembro con eventos asignados solo ve los suyos.
// El panel la consulta cada pocos segundos: sin caché.
import type { APIRoute } from "astro";
import { dashboardToolContext } from "../../../lib/producer-api/session";
import { runTool } from "../../../lib/producer-api/registry";
import { accessTools } from "../../../lib/producer-api/tools/access";

export const prerender = false;

const STATUS: Record<string, number> = { forbidden: 403, not_found: 404, invalid_input: 400, rate_limited: 429 };
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const tool = accessTools.find((t) => t.name === "get_checkin_stats")!;

export const GET: APIRoute = async (context) => {
    const auth = await dashboardToolContext(context);
    if (!auth.ok) return json({ message: auth.error }, auth.status);
    const eventId = Number(context.url.searchParams.get("event_id"));
    if (!Number.isSafeInteger(eventId) || eventId <= 0) return json({ message: "event_id inválido" }, 400);
    const res: any = await runTool(tool, { event_id: eventId }, auth.ctx);
    if (!res.ok) return json({ message: res.message || "No se pudo cargar el aforo" }, STATUS[res.code] || 500);
    return json(res.result);
};
