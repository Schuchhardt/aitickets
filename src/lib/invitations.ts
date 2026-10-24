// Crear una invitación masiva al próximo evento (aitickets_scheduled_messages kind 'invitation') desde el panel
// (/api/events/reviews) o la API de productores (invite_past_attendees). Valida con planInvitation
// (netlify/lib/invitations.mjs), aplica los topes y la entrega a la background function que la envía.
// Solo servidor.
import { callInternalFunction } from "../pages/api/_lib/server-utils";
import { BACKGROUND_PATH, claimScheduledMessage, releaseScheduledMessage } from "../../netlify/lib/scheduled-messages.mjs";
import { planInvitation, InvitationError } from "../../netlify/lib/invitations.mjs";
import { MAX_INVITATIONS_PER_ORG_PER_DAY, INVITE_AUDIENCES } from "../../netlify/lib/reviews.mjs";

export { planInvitation, InvitationError };

export const INVITATION_SUBJECT_MAX = 150;
export const INVITATION_MESSAGE_MAX = 2000;

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");

/** Asunto y texto por defecto (el texto va en un recuadro del correo, antes de los datos del evento). */
export function invitationCopy(orgName: string, sourceName: string, targetName: string, input: { subject?: unknown; message?: unknown }) {
  const subject = clean(input.subject, INVITATION_SUBJECT_MAX) || `${orgName || "Te invitamos"}${orgName ? " te invita a " : " a "}${targetName}`.slice(0, INVITATION_SUBJECT_MAX);
  const body = clean(input.message, INVITATION_MESSAGE_MAX) || `¡Gracias por acompañarnos en ${sourceName}! Nos encantaría verte en ${targetName}.`;
  return { subject, body };
}

export interface CreateInvitationInput {
  organizationId: number;
  userId: number | null;
  sourceEventId: number;
  targetEventId: number;
  audience: string;
  subject?: unknown;
  message?: unknown;
  channel: "dashboard" | "mcp" | "rest" | "admin";
  requestUrl: URL;
}

const isMissingSchema = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204", "23514"].includes(String(error?.code || ""));

/**
 * Crea la invitación y la despacha. Errores esperables: InvitationError ('not_found' | 'conflict' |
 * 'invalid_input' | 'rate_limited' | 'unavailable').
 */
export async function createInvitation(supabase: any, input: CreateInvitationInput) {
  if (!(input.audience in INVITE_AUDIENCES)) throw new InvitationError("invalid_input", "Audiencia no válida.");
  const plan = await planInvitation(supabase, {
    organizationId: input.organizationId,
    sourceEventId: input.sourceEventId,
    targetEventId: input.targetEventId,
    audience: input.audience,
  });
  if (!plan.recipients.length) {
    throw new InvitationError("conflict", "No hay a quién invitar con esa audiencia: ya tienen entradas, ya fueron invitados o se dieron de baja.");
  }

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: recent, error: recentError } = await supabase
    .from("aitickets_scheduled_messages")
    .select("id, status, event_id, target_event_id")
    .eq("organization_id", input.organizationId)
    .eq("kind", "invitation")
    .gte("created_at", since);
  if (recentError) {
    if (isMissingSchema(recentError)) throw new InvitationError("unavailable", "Las invitaciones aún no están disponibles. Intenta en unos minutos.");
    throw recentError;
  }
  const live = (recent || []).filter((m: any) => m.status !== "cancelled");
  if (live.some((m: any) => ["scheduled", "sending"].includes(m.status) && String(m.event_id) === String(input.sourceEventId) && String(m.target_event_id) === String(input.targetEventId))) {
    throw new InvitationError("conflict", "Ya hay un envío de esta invitación en curso. Espera a que termine.");
  }
  if (live.length >= MAX_INVITATIONS_PER_ORG_PER_DAY) {
    throw new InvitationError("rate_limited", `Ya enviaste ${live.length} invitaciones en las últimas 24 horas (máximo ${MAX_INVITATIONS_PER_ORG_PER_DAY}).`);
  }

  const { data: org } = await supabase.from("organizations").select("public_name").eq("id", input.organizationId).maybeSingle();
  const { subject, body } = invitationCopy(org?.public_name || "", plan.sourceEvent.name, plan.targetEvent.name, input);
  const { data: message, error } = await supabase
    .from("aitickets_scheduled_messages")
    .insert({
      organization_id: input.organizationId,
      event_id: Number(plan.sourceEvent.id),
      target_event_id: Number(plan.targetEvent.id),
      kind: "invitation",
      subject,
      body,
      audience: input.audience,
      send_at: new Date().toISOString(),
      status: "scheduled",
      created_by: input.userId,
      created_via: input.channel,
    })
    .select("id, kind, subject, audience, send_at, status, created_at")
    .single();
  if (error) {
    if (isMissingSchema(error)) throw new InvitationError("unavailable", "Las invitaciones aún no están disponibles. Intenta en unos minutos.");
    throw error;
  }

  let dispatched = false;
  if (await claimScheduledMessage(supabase, message.id)) {
    const res = await callInternalFunction(input.requestUrl, BACKGROUND_PATH, { messageId: message.id });
    dispatched = res.ok || res.status === 202;
    // Si no se pudo invocar, la función programada send-scheduled-messages la toma en ≤ 10 min
    if (!dispatched) await releaseScheduledMessage(supabase, message.id);
    else message.status = "sending";
  }
  return { message, plan, dispatched };
}

/** Invitaciones recientes de un evento (para el panel). */
export async function recentInvitations(supabase: any, organizationId: number, sourceEventId: number) {
  const { data, error } = await supabase
    .from("aitickets_scheduled_messages")
    .select("id, subject, audience, status, recipients_count, failed_count, sent_at, created_at, target_event_id")
    .eq("organization_id", organizationId)
    .eq("event_id", sourceEventId)
    .eq("kind", "invitation")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  const ids = [...new Set((data || []).map((m: any) => m.target_event_id).filter(Boolean))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: events } = await supabase.from("events").select("id, name").eq("organization_id", organizationId).in("id", ids);
    for (const e of events || []) names.set(String(e.id), e.name);
  }
  return (data || []).map((m: any) => ({ ...m, target_event_name: names.get(String(m.target_event_id)) || null }));
}
