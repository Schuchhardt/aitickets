// Herramientas: reseñas de asistentes e invitación al próximo evento (migración 202610220100).
// - list_event_reviews: calificaciones, comentarios públicos y privados, fotos y estadísticas de un evento.
// - update_review_settings: correo de 24 h, premio por calificar y moderación de fotos.
// - invite_past_attendees: invitación masiva a los asistentes de un evento para uno próximo (con confirmación;
//   la envía la cola de mensajes, src/lib/invitations.ts).
import { ToolError, type ToolDef } from "../registry";
import { eventIdSchema, loadOwnedEvent, eventPublicUrl } from "./common";
import { createInvitation, planInvitation, InvitationError } from "../../invitations";
import {
  REVIEWS_TABLE,
  REVIEW_PHOTOS_TABLE,
  REVIEW_REQUEST_TYPE,
  INVITE_AUDIENCES,
  REWARD_LIMITS,
  normalizeReviewSettings,
  summarizeRatings,
} from "../../../../netlify/lib/reviews.mjs";

const isMissingSchema = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));
const unavailable = () => new ToolError("unavailable", "Las reseñas aún no están disponibles. Intenta en unos minutos.");

const toToolError = (err: unknown) => (err instanceof InvitationError ? new ToolError(err.code as any, err.message) : err);

const AUDIENCE_SCHEMA = {
  type: "string" as const,
  enum: Object.keys(INVITE_AUDIENCES),
  default: "all",
  description: "all = todos los asistentes; checked_in = solo quienes ingresaron; reviewers = quienes calificaron; promoters = quienes calificaron con 4 o 5.",
};

const listEventReviews: ToolDef = {
  name: "list_event_reviews",
  title: "Ver reseñas del evento",
  description:
    "Calificaciones (1 a 5) de quienes asistieron a un evento: promedio, distribución, comentarios públicos (los que se ven en la página " +
    "del evento terminado) y mensajes PRIVADOS para la productora, fotos subidas a la galería y premios entregados. Contiene datos " +
    "personales (emails). Úsala para resumir el feedback y proponer mejoras concretas para el próximo evento.",
  scope: "attendees",
  permission: "attendees.read",
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: "object",
    required: ["event_id"],
    additionalProperties: false,
    properties: {
      event_id: eventIdSchema,
      max_rating: { type: "integer", minimum: 1, maximum: 5, description: "Solo reseñas con esta nota o menos (p. ej. 2 = las malas)." },
      only_with_comments: { type: "boolean", default: false, description: "Solo reseñas con comentario público o privado." },
      limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
    },
  },
  async handler(args, ctx) {
    const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, slug");
    const { data: settingsRow, error: sError }: { data: any; error: any } = await ctx.supabase.from("events").select("review_settings").eq("id", event.id).maybeSingle();
    if (sError && !isMissingSchema(sError)) throw sError;
    const [reviewsRes, photosRes, requestsRes] = await Promise.all([
      ctx.supabase
        .from(REVIEWS_TABLE)
        .select("id, email, display_name, rating, public_comment, private_comment, public_status, reward_code, created_at")
        .eq("event_id", event.id)
        .order("created_at", { ascending: false })
        .limit(5000),
      ctx.supabase.from(REVIEW_PHOTOS_TABLE).select("id, status").eq("event_id", event.id).limit(5000),
      ctx.supabase.from("notification_log").select("id", { count: "exact", head: true }).eq("event_id", event.id).eq("type", REVIEW_REQUEST_TYPE),
    ]);
    for (const r of [reviewsRes, photosRes]) {
      if (r.error) {
        if (isMissingSchema(r.error)) throw unavailable();
        throw r.error;
      }
    }
    const all = (reviewsRes.data || []) as any[];
    let rows = all;
    if (args.max_rating) rows = rows.filter((r) => r.rating <= args.max_rating);
    if (args.only_with_comments) rows = rows.filter((r) => r.public_comment || r.private_comment);
    const photos = (photosRes.data || []) as any[];
    return {
      event_id: Number(event.id),
      event_name: event.name,
      public_url: eventPublicUrl(ctx, event.slug),
      settings: normalizeReviewSettings(settingsRow?.review_settings),
      summary: summarizeRatings(all),
      review_requests_sent: requestsRes.count || 0,
      photos: {
        total: photos.length,
        visible: photos.filter((p) => p.status === "visible").length,
        pending_review: photos.filter((p) => p.status === "pending").length,
      },
      rewards_granted: all.filter((r) => r.reward_code).length,
      total: rows.length,
      reviews: rows.slice(0, args.limit).map((r) => ({
        id: r.id,
        name: r.display_name || "Asistente",
        email: r.email,
        rating: r.rating,
        public_comment: r.public_comment || null,
        public_comment_visible: r.public_status === "visible",
        private_comment: r.private_comment || null,
        created_at: r.created_at,
      })),
    };
  },
};

const updateReviewSettings: ToolDef = {
  name: "update_review_settings",
  title: "Configurar reseñas",
  description:
    "Configura las reseñas de un evento: si se envía el correo \"¿Cómo estuvo?\" 24 h después de cada función, el premio por calificar " +
    `(un código de descuento de un solo uso, ${REWARD_LIMITS.minValue}-${REWARD_LIMITS.maxValue}%, para cualquier evento de la organización; reward_percent=0 lo quita) ` +
    "y si las fotos de los asistentes esperan revisión antes de publicarse.",
  scope: "write",
  permission: "events.write",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  inputSchema: {
    type: "object",
    required: ["event_id"],
    additionalProperties: false,
    properties: {
      event_id: eventIdSchema,
      send_request_email: { type: "boolean", description: "Enviar el correo de reseña 24 h después de cada función." },
      reward_percent: { type: "integer", minimum: 0, maximum: REWARD_LIMITS.maxValue, description: `Descuento del premio (${REWARD_LIMITS.minValue}-${REWARD_LIMITS.maxValue}). 0 = sin premio.` },
      reward_valid_days: { type: "integer", minimum: REWARD_LIMITS.minDays, maximum: REWARD_LIMITS.maxDays, description: `Días de vigencia del código (por defecto ${REWARD_LIMITS.defaultDays}).` },
      moderate_photos: { type: "boolean", description: "true = las fotos esperan tu aprobación antes de verse en la página." },
    },
  },
  audit: (args) => ({ summary: "Configuración de reseñas actualizada", target: `event:${args.event_id}` }),
  async handler(args, ctx) {
    const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
    const { data, error } = await ctx.supabase.from("events").select("review_settings").eq("id", event.id).maybeSingle();
    if (error) {
      if (isMissingSchema(error)) throw unavailable();
      throw error;
    }
    const prev = normalizeReviewSettings(data?.review_settings);
    if (args.reward_percent != null && args.reward_percent > 0 && args.reward_percent < REWARD_LIMITS.minValue) {
      throw new ToolError("invalid_input", `El premio debe ser de al menos ${REWARD_LIMITS.minValue}%.`);
    }
    const reward =
      args.reward_percent === 0
        ? null
        : args.reward_percent != null
          ? { value: args.reward_percent, valid_days: args.reward_valid_days ?? prev.reward?.valid_days ?? REWARD_LIMITS.defaultDays }
          : prev.reward && args.reward_valid_days != null
            ? { ...prev.reward, valid_days: args.reward_valid_days }
            : prev.reward;
    const next = normalizeReviewSettings({
      enabled: args.send_request_email ?? prev.enabled,
      reward,
      moderate_photos: args.moderate_photos ?? prev.moderate_photos,
    });
    const { error: upError } = await ctx.supabase.from("events").update({ review_settings: next }).eq("id", event.id).eq("organization_id", ctx.actor.orgId);
    if (upError) throw upError;
    return { event_id: Number(event.id), settings: next };
  },
};

const invitePastAttendees: ToolDef = {
  name: "invite_past_attendees",
  title: "Invitar asistentes al próximo evento",
  description:
    "Envía una invitación por correo a quienes asistieron a un evento (event_id) para otro evento PUBLICADO y próximo de la misma " +
    "organización (target_event_id). Un correo individual por persona con la info del evento, link con UTM y enlace de baja. Omite a " +
    "quienes ya tienen entradas para el evento destino, a quienes ya fueron invitados a él y a quienes se dieron de baja de tus " +
    "invitaciones. audience permite invitar solo a quienes ingresaron o a quienes calificaron bien. Es un envío masivo: requiere confirmación.",
  scope: "publish",
  permission: "messages.send",
  idempotent: true,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    type: "object",
    required: ["event_id", "target_event_id"],
    additionalProperties: false,
    properties: {
      event_id: { ...eventIdSchema, description: "Evento ya realizado: de aquí salen los asistentes." },
      target_event_id: { type: "integer", minimum: 1, description: "Evento próximo al que se invita (publicado)." },
      audience: AUDIENCE_SCHEMA,
      subject: { type: "string", maxLength: 150, description: "Asunto (por defecto \"<organización> te invita a <evento>\")." },
      message: { type: "string", maxLength: 2000, description: "Texto personal de la productora (texto plano)." },
    },
  },
  async confirm(args, ctx) {
    await loadOwnedEvent(ctx, args.event_id, "id");
    await loadOwnedEvent(ctx, args.target_event_id, "id");
    let plan;
    try {
      plan = await planInvitation(ctx.supabase, { organizationId: ctx.actor.orgId, sourceEventId: args.event_id, targetEventId: args.target_event_id, audience: args.audience || "all" });
    } catch (err) {
      throw toToolError(err);
    }
    if (!plan.counts.recipients) throw new ToolError("conflict", "No hay a quién invitar con esa audiencia: ya tienen entradas, ya fueron invitados o se dieron de baja.");
    return {
      message: `Se enviará la invitación a "${plan.targetEvent.name}" a ${plan.counts.recipients} asistente(s) de "${plan.sourceEvent.name}".`,
      details: { ...plan.counts, audience: args.audience || "all", target_event_url: eventPublicUrl(ctx, plan.targetEvent.slug) },
      warnings: [
        ...(plan.counts.already_have_tickets ? [`${plan.counts.already_have_tickets} asistente(s) ya tienen entradas y no la recibirán.`] : []),
        ...(plan.counts.opted_out ? [`${plan.counts.opted_out} se dieron de baja de tus invitaciones.`] : []),
      ],
    };
  },
  audit: (args, result: any) => ({ summary: `Invitación al evento #${args.target_event_id} para ~${result.recipients} asistentes`, target: `event:${args.event_id}` }),
  async handler(args, ctx) {
    await loadOwnedEvent(ctx, args.event_id, "id");
    await loadOwnedEvent(ctx, args.target_event_id, "id");
    try {
      const { message, plan, dispatched } = await createInvitation(ctx.supabase, {
        organizationId: ctx.actor.orgId,
        userId: ctx.actor.userId,
        sourceEventId: args.event_id,
        targetEventId: args.target_event_id,
        audience: args.audience || "all",
        subject: args.subject,
        message: args.message,
        channel: ctx.channel,
        requestUrl: ctx.requestUrl,
      });
      return {
        invitation_id: message.id,
        status: message.status,
        recipients: plan.counts.recipients,
        skipped: { already_have_tickets: plan.counts.already_have_tickets, already_invited: plan.counts.already_invited, opted_out: plan.counts.opted_out },
        note: dispatched ? "Envío en curso: llegará en los próximos minutos." : "Quedó en cola: se enviará en los próximos 10 minutos.",
      };
    } catch (err) {
      throw toToolError(err);
    }
  },
};

export const reviewTools: ToolDef[] = [listEventReviews, updateReviewSettings, invitePastAttendees];
