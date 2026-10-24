// POST /api/orders/feed — PÚBLICO con el id de una orden pagada con entradas vigentes: el muro de asistentes
// (netlify/lib/attendee-community.mjs). Quien tiene el link de la orden ya ve sus entradas, así que también puede
// reaccionar como su comprador (mismo criterio que /api/reviews/verify).
// Request: { orderId, action: "react", emoji, message? } → publica o actualiza la reacción (una por persona y evento)
//          { orderId, action: "delete" }                 → borra la propia
// Respuesta: 200 { feed: { posts, reactions, total, mine } } | 400 | 404 | 429 | 503
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { clientIpFrom } from "../../../lib/sites";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import {
  FEED_TABLE,
  isOrderId,
  loadOrderHolder,
  loadFeed,
  normalizeFeedEmoji,
  normalizeFeedMessage,
  isMissingCommunitySchema,
} from "../../../../netlify/lib/attendee-community.mjs";

export const prerender = false;

const LIMIT_IP = { windowSeconds: 10 * 60, max: 30 };
const LIMIT_ORDER = { windowSeconds: 60 * 60, max: 20 };
const UNAVAILABLE = "El muro de asistentes todavía no está disponible. Inténtalo más tarde.";

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  const action = body?.action === "delete" ? "delete" : "react";
  if (!isOrderId(orderId)) return jsonResponse({ message: "Orden no encontrada" }, 400);
  const emoji = normalizeFeedEmoji(body?.emoji);
  if (action === "react" && !emoji) return jsonResponse({ message: "Elige una reacción." }, 400);

  const byIp = await rateLimit("feed:ip", clientIpFrom(request), LIMIT_IP);
  const byOrder = byIp.allowed ? await rateLimit("feed:order", orderId, LIMIT_ORDER) : byIp;
  if (!byIp.allowed || !byOrder.allowed) return jsonResponse({ message: "Vas muy rápido. Espera un poco e inténtalo de nuevo." }, 429);

  try {
    const supabase = getSupabaseAdmin();
    const holder = await loadOrderHolder(supabase, orderId);
    if (!holder) return jsonResponse({ message: "Solo quienes tienen entradas vigentes pueden publicar en el muro." }, 404);
    const { event, email } = holder;

    if (action === "delete") {
      const { error } = await supabase.from(FEED_TABLE).delete().eq("event_id", event.id).eq("email", email);
      if (error) throw error;
    } else {
      const { error } = await supabase.from(FEED_TABLE).upsert(
        {
          event_id: event.id,
          organization_id: event.organization_id,
          order_id: orderId,
          email,
          display_name: holder.displayName,
          emoji,
          message: normalizeFeedMessage(body?.message),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id,email" },
      );
      if (error) throw error;
    }
    return jsonResponse({ feed: await loadFeed(supabase, event.id, email) });
  } catch (err: any) {
    if (isMissingCommunitySchema(err)) return jsonResponse({ message: UNAVAILABLE }, 503);
    console.error("orders/feed:", err?.message || err);
    return jsonResponse({ message: "Algo falló de nuestro lado. Inténtalo en unos segundos." }, 500);
  }
};
