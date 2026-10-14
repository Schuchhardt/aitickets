// POST /api/events/visit — registra una visita a la página pública de un evento (event_visits).
//
// La página se sirve desde el CDN (src/lib/cdnCache.ts), así que la visita la avisa el navegador al cargar
// (script en src/pages/eventos/[slug].astro y en los sitios de productor). Público y sin sesión, igual que
// antes abrir la página; solo cuenta eventos publicados y descarta bots por User-Agent (recordEventVisit).
// Responde 204 siempre que el cuerpo sea válido: una visita que no se pudo guardar no es un error del visitante.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { recordEventVisit } from "../../../lib/eventPage";

export const prerender = false;

const str = (v: unknown) => (typeof v === "string" ? v : null);

export const POST: APIRoute = async ({ request, locals }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const eventId = Number(body?.event_id);
  if (!Number.isInteger(eventId) || eventId <= 0) return new Response(null, { status: 400 });

  const { data: event } = await getSupabaseAdmin().from("events").select("id").eq("id", eventId).eq("status", "published").maybeSingle();
  if (event) {
    await recordEventVisit(
      eventId,
      request,
      {
        referrer: str(body.referrer),
        utmSource: str(body.utm_source),
        utmMedium: str(body.utm_medium),
        utmCampaign: str(body.utm_campaign),
      },
      locals
    );
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
};
