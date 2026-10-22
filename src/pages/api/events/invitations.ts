// Invitación masiva a los asistentes de un evento para un próximo evento de la misma organización (panel,
// EventReviewsManager.vue). La envía la background function de mensajes (src/lib/invitations.ts).
// POST { eventId, action: "preview", targetEventId, audience } → { counts }
// POST { eventId, action: "send", targetEventId, audience, subject?, message? } → 201 { invitation, counts, dispatched }
// audience: all | checked_in | reviewers | promoters (netlify/lib/reviews.mjs INVITE_AUDIENCES).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { createInvitation, planInvitation, InvitationError } from "../../../lib/invitations";

export const prerender = false;

const STATUS: Record<string, number> = { not_found: 404, conflict: 409, invalid_input: 400, rate_limited: 429, unavailable: 503 };

export const POST: APIRoute = async (context) => {
  const body = await context.request.json().catch(() => null);
  const session = await getSessionContext(context);
  if (!session) return jsonResponse({ message: "No autorizado" }, 401);
  if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) return jsonResponse({ message: "No tienes permisos para enviar invitaciones" }, 403);
  const { dbUser } = session;
  const orgId = Number(dbUser.organization_id);
  const eventId = Number(body?.eventId);
  const targetEventId = Number(body?.targetEventId);
  const audience = typeof body?.audience === "string" ? body.audience : "all";
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return jsonResponse({ message: "eventId es obligatorio" }, 400);
  if (!Number.isSafeInteger(targetEventId) || targetEventId <= 0) return jsonResponse({ message: "Elige el evento al que quieres invitar." }, 400);
  // Ambos eventos deben ser accesibles para este usuario (equipo asignado a ciertos eventos)
  const [source, target] = await Promise.all([
    getOwnedEvent(eventId, orgId, "id", dbUser.id),
    getOwnedEvent(targetEventId, orgId, "id", dbUser.id),
  ]);
  if (!source || !target) return jsonResponse({ message: "Evento no encontrado" }, 404);

  const supabase = getSupabaseAdmin();
  try {
    if (body?.action === "preview") {
      const plan = await planInvitation(supabase, { organizationId: orgId, sourceEventId: eventId, targetEventId, audience });
      return jsonResponse({ counts: plan.counts });
    }
    if (body?.action !== "send") return jsonResponse({ message: "Acción no válida" }, 400);
    const { message, plan, dispatched } = await createInvitation(supabase, {
      organizationId: orgId,
      userId: dbUser.id ?? null,
      sourceEventId: eventId,
      targetEventId,
      audience,
      subject: body.subject,
      message: body.message,
      channel: "dashboard",
      requestUrl: new URL(context.request.url),
    });
    return jsonResponse({ invitation: message, counts: plan.counts, dispatched }, 201);
  } catch (err: any) {
    if (err instanceof InvitationError) return jsonResponse({ message: err.message }, STATUS[err.code] || 400);
    console.error("events/invitations:", err?.message || err);
    return jsonResponse({ message: "No se pudo preparar la invitación" }, 500);
  }
};
