// GET /api/events/seats?event=<id>&function=<event_date_id> — asientos ocupados de una función con entradas numeradas
// (reservados por una compra en curso o vendidos). Público y sin sesión: lo usa el selector de asientos del checkout
// (src/components/event/SeatPicker.vue). Solo eventos publicados.
// Respuesta: { taken: ["platea:C:7", ...] }. Nunca dice quién compró.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { takenSeats } from "../../../../netlify/lib/seats.mjs";

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const GET: APIRoute = async ({ url }) => {
  const eventId = Number(url.searchParams.get("event"));
  const dateId = Number(url.searchParams.get("function"));
  if (!Number.isInteger(eventId) || eventId <= 0 || !Number.isInteger(dateId) || dateId <= 0) return json({ message: "Parámetros inválidos" }, 400);

  const supabase = getSupabaseAdmin();
  const { data: fn } = await supabase
    .from("event_dates")
    .select("id, events!inner(id, status)")
    .eq("id", dateId)
    .eq("event_id", eventId)
    .eq("events.status", "published")
    .maybeSingle();
  if (!fn) return json({ taken: [] });

  try {
    return json({ taken: await takenSeats(supabase, dateId) });
  } catch (err: any) {
    console.error("seats:", err?.message);
    return json({ message: "No pudimos cargar los asientos" }, 500);
  }
};
