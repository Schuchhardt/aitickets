// Mensajes de asistentes y muro de asistentes de un evento, desde el panel (EventCommunityManager.vue).
// GET  ?eventId=  → { messages, unread, posts, reactions, total }
//      (incluye emails: solo la productora los ve)
// POST { eventId, action: "message_read", id, read: boolean } → { ok }
// POST { eventId, action: "post_status", id, status: "visible" | "hidden" } → { ok }
// El muro solo se ve en las páginas de orden/entrada (sin caché del CDN), así que no hace falta vaciar caché.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { FEED_TABLE, MESSAGES_TABLE, normalizeFeedEmoji, summarizeReactions, isMissingCommunitySchema } from "../../../../netlify/lib/attendee-community.mjs";

export const prerender = false;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNAVAILABLE = "Los mensajes y el muro de asistentes todavía no están disponibles (falta aplicar la migración).";

async function authorize(context: Parameters<typeof getSessionContext>[0], eventId: number): Promise<Response | null> {
  const session = await getSessionContext(context);
  if (!session) return jsonResponse({ message: "No autorizado" }, 401);
  if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) return jsonResponse({ message: "No tienes permisos para ver los mensajes" }, 403);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return jsonResponse({ message: "eventId es obligatorio" }, 400);
  const event = await getOwnedEvent(eventId, session.dbUser.organization_id, "id", session.dbUser.id);
  if (!event) return jsonResponse({ message: "Evento no encontrado" }, 404);
  return null;
}

const failure = (error: any, label: string) => {
  if (isMissingCommunitySchema(error)) return jsonResponse({ message: UNAVAILABLE }, 503);
  console.error(`events/community (${label}):`, error?.message || error);
  return jsonResponse({ message: "No se pudo completar la acción" }, 500);
};

export const GET: APIRoute = async (context) => {
  const eventId = Number(new URL(context.request.url).searchParams.get("eventId"));
  const denied = await authorize(context, eventId);
  if (denied) return denied;
  const supabase = getSupabaseAdmin();
  const [messages, posts] = await Promise.all([
    supabase
      .from(MESSAGES_TABLE)
      .select("id, name, email, message, delivered_at, mail_error, read_at, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from(FEED_TABLE)
      .select("id, display_name, email, emoji, message, status, created_at, updated_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (messages.error) return failure(messages.error, "messages");
  if (posts.error) return failure(posts.error, "posts");
  const visible = (posts.data || []).filter((p: any) => p.status === "visible");
  const reactions = summarizeReactions(visible);
  return jsonResponse({
    messages: (messages.data || []).map((m: any) => ({ ...m, delivered: Boolean(m.delivered_at) })),
    unread: (messages.data || []).filter((m: any) => !m.read_at).length,
    posts: (posts.data || []).map((p: any) => ({ ...p, emoji: normalizeFeedEmoji(p.emoji) || p.emoji })),
    reactions,
    total: visible.length,
  });
};

export const POST: APIRoute = async (context) => {
  const body = await context.request.json().catch(() => null);
  const eventId = Number(body?.eventId);
  const denied = await authorize(context, eventId);
  if (denied) return denied;
  const id = typeof body?.id === "string" && UUID_RE.test(body.id) ? body.id : null;
  if (!id) return jsonResponse({ message: "id inválido" }, 400);
  const supabase = getSupabaseAdmin();

  if (body?.action === "message_read") {
    const { error } = await supabase
      .from(MESSAGES_TABLE)
      .update({ read_at: body?.read === false ? null : new Date().toISOString() })
      .eq("id", id)
      .eq("event_id", eventId);
    return error ? failure(error, "message_read") : jsonResponse({ ok: true });
  }
  if (body?.action === "post_status") {
    const status = body?.status === "hidden" ? "hidden" : body?.status === "visible" ? "visible" : null;
    if (!status) return jsonResponse({ message: "status inválido" }, 400);
    const { error } = await supabase.from(FEED_TABLE).update({ status }).eq("id", id).eq("event_id", eventId);
    return error ? failure(error, "post_status") : jsonResponse({ ok: true });
  }
  return jsonResponse({ message: "Acción no válida" }, 400);
};
