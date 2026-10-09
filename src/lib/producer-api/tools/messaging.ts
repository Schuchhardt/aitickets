// Herramientas: comunicación con asistentes (mensajes inmediatos o programados y recordatorios).
// Los mensajes se guardan en aitickets_scheduled_messages y los envía la background function
// send-scheduled-messages-background (netlify/lib/scheduled-messages.mjs). Son correos masivos: confirmación
// en el servidor (dos llamadas) y tope de mensajes por evento.
import { ToolError, type ToolContext, type ToolDef } from "../registry";
import { eventIdSchema, loadOwnedEvent, TZ } from "./common";
import { callInternalFunction } from "../../../pages/api/_lib/server-utils";
import {
    BACKGROUND_PATH,
    claimScheduledMessage,
    collectMessageRecipients,
    releaseScheduledMessage,
} from "../../../../netlify/lib/scheduled-messages.mjs";
import {
    EVENT_DATE_COLUMNS,
    formatDateOnlyLong,
    formatEventLocation,
    formatTimeShort,
    todayInTimeZone,
    zonedDateTimeToUtc,
} from "../../../../netlify/lib/dates.mjs";

/** Máximo de mensajes (no recordatorios) por evento en 24 horas: evita spam a los asistentes. */
export const MAX_MESSAGES_PER_EVENT_PER_DAY = 5;
const MAX_SCHEDULE_DAYS = 365;

const AUDIENCE_SCHEMA = {
    type: "string" as const,
    enum: ["all", "not_checked_in"],
    default: "all",
    description: "all = todos los que tienen entradas vigentes; not_checked_in = solo quienes aún no ingresan.",
};

const fmtInstant = (iso: string) =>
    new Date(iso).toLocaleString("es-CL", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false });

function presentMessage(m: any) {
    return {
        id: m.id,
        kind: m.kind,
        subject: m.subject,
        audience: m.audience,
        send_at: m.send_at,
        send_at_local: m.send_at ? fmtInstant(m.send_at) : null,
        status: m.status,
        recipients_count: m.recipients_count ?? null,
        failed_count: m.failed_count ?? null,
        sent_at: m.sent_at ?? null,
        created_at: m.created_at,
    };
}

async function countRecentMessages(ctx: ToolContext, eventId: number) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data, error } = await ctx.supabase
        .from("aitickets_scheduled_messages")
        .select("id, status")
        .eq("event_id", eventId)
        .eq("kind", "message")
        .gte("created_at", since);
    if (error) {
        if (["42P01", "PGRST205"].includes(String(error.code))) throw new ToolError("unavailable", "Los mensajes a asistentes aún no están disponibles. Intenta en unos minutos.");
        throw error;
    }
    return (data || []).filter((m: any) => m.status !== "cancelled").length;
}

function resolveSendAt(raw: string | undefined): { sendAt: string; immediate: boolean } {
    if (!raw) return { sendAt: new Date().toISOString(), immediate: true };
    const t = new Date(raw).getTime();
    if (t > Date.now() + MAX_SCHEDULE_DAYS * 86400_000) throw new ToolError("invalid_input", "send_at no puede ser más de un año en el futuro.");
    if (t <= Date.now() + 60_000) return { sendAt: new Date().toISOString(), immediate: true };
    return { sendAt: new Date(t).toISOString(), immediate: false };
}

/** Inserta el mensaje y, si es inmediato, lo reclama y lo entrega a la background function. */
async function createMessage(ctx: ToolContext, row: Record<string, unknown>, immediate: boolean) {
    const { data, error } = await ctx.supabase
        .from("aitickets_scheduled_messages")
        .insert({ ...row, organization_id: ctx.actor.orgId, created_by: ctx.actor.userId, created_via: ctx.channel, status: "scheduled" })
        .select("id, kind, subject, audience, send_at, status, recipients_count, failed_count, created_at")
        .single();
    if (error) throw error;
    let dispatched = false;
    if (immediate && (await claimScheduledMessage(ctx.supabase, data.id))) {
        const res = await callInternalFunction(ctx.requestUrl, BACKGROUND_PATH, { messageId: data.id });
        dispatched = res.ok || res.status === 202;
        if (!dispatched) await releaseScheduledMessage(ctx.supabase, data.id); // la función programada lo toma en ≤ 10 min
        else data.status = "sending";
    }
    return { message: data, dispatched };
}

// ---------------------------------------------------------------------------
// send_attendee_message
// ---------------------------------------------------------------------------

async function prepareMessage(args: any, ctx: ToolContext) {
    const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, slug, status, organization_id");
    const { sendAt, immediate } = resolveSendAt(args.send_at);
    const recent = await countRecentMessages(ctx, Number(event.id));
    if (recent >= MAX_MESSAGES_PER_EVENT_PER_DAY) {
        throw new ToolError("rate_limited", `Ya hay ${recent} mensajes de este evento en las últimas 24 horas (máximo ${MAX_MESSAGES_PER_EVENT_PER_DAY}). Espera o agrupa la información en un solo mensaje.`);
    }
    const recipients = await collectMessageRecipients(ctx.supabase, event, args.audience);
    if (immediate && !recipients.length) {
        throw new ToolError("conflict", args.audience === "not_checked_in" ? "No hay asistentes pendientes de ingreso a quienes escribir." : "Este evento todavía no tiene asistentes con entradas vigentes.");
    }
    return { event, sendAt, immediate, recipients };
}

const sendAttendeeMessage: ToolDef = {
    name: "send_attendee_message",
    title: "Enviar mensaje a asistentes",
    description:
        "Envía un correo a quienes tienen entradas de un evento (p. ej. cambio de hora o lugar, indicaciones de acceso). " +
        "Inmediato o programado con send_at (ISO 8601). El mensaje es texto plano del productor; el correo incluye el link a sus entradas. " +
        `Máximo ${MAX_MESSAGES_PER_EVENT_PER_DAY} mensajes por evento cada 24 h. Para cambios de fecha/lugar edita también el evento en el panel.`,
    scope: "publish",
    permission: "messages.send",
    idempotent: true,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id", "subject", "message"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            subject: { type: "string", minLength: 3, maxLength: 150, description: "Asunto del correo." },
            message: { type: "string", minLength: 5, maxLength: 4000, description: "Texto del mensaje (texto plano; los saltos de línea se respetan)." },
            audience: AUDIENCE_SCHEMA,
            send_at: { type: "string", format: "date-time", description: "Programar el envío (ISO 8601). Omitir = enviar ahora." },
        },
    },
    async confirm(args, ctx) {
        const { event, sendAt, immediate, recipients } = await prepareMessage(args, ctx);
        const when = immediate ? "AHORA" : `el ${fmtInstant(sendAt)} (hora de Chile)`;
        return {
            message: `Se enviará el correo "${args.subject}" ${when} a ${recipients.length} asistente(s) de "${event.name}".`,
            details: {
                event_id: Number(event.id),
                event_name: event.name,
                subject: args.subject,
                message_preview: String(args.message).slice(0, 400),
                audience: args.audience,
                recipients_now: recipients.length,
                send_at: sendAt,
            },
            warnings: [
                ...(event.status !== "published" ? ["El evento no está publicado."] : []),
                ...(!immediate ? ["Los destinatarios se calculan al momento del envío (incluye compras nuevas)."] : []),
            ],
        };
    },
    async handler(args, ctx) {
        const { event, sendAt, immediate, recipients } = await prepareMessage(args, ctx);
        const { message, dispatched } = await createMessage(
            ctx,
            { event_id: Number(event.id), kind: "message", subject: args.subject, body: args.message, audience: args.audience, send_at: sendAt },
            immediate,
        );
        return {
            event_id: Number(event.id),
            message: presentMessage(message),
            recipients_estimated: recipients.length,
            note: immediate
                ? dispatched
                    ? "Envío en curso: los asistentes lo recibirán en los próximos minutos."
                    : "Quedó en cola: se enviará en los próximos 10 minutos."
                : `Programado para el ${fmtInstant(sendAt)} (hora de Chile). Puedes cancelarlo con cancel_scheduled_message.`,
        };
    },
    audit: (args, result: any) => ({ summary: `Mensaje "${String(args.subject).slice(0, 80)}" a ~${result.recipients_estimated} asistentes`, target: result.message?.id }),
};

// ---------------------------------------------------------------------------
// schedule_reminder
// ---------------------------------------------------------------------------

async function prepareReminder(args: any, ctx: ToolContext) {
    const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, slug, status, location");
    let query = ctx.supabase.from("event_dates").select(EVENT_DATE_COLUMNS).eq("event_id", event.id);
    if (args.function_id) query = query.eq("id", args.function_id);
    else query = query.gte("date", todayInTimeZone()).order("date", { ascending: true }).order("start_time", { ascending: true }).limit(1);
    const { data: dates, error } = await query;
    if (error) throw error;
    const fn = (dates || [])[0];
    if (!fn) {
        throw new ToolError(args.function_id ? "not_found" : "conflict", args.function_id ? `La función ${args.function_id} no pertenece al evento.` : "El evento no tiene funciones próximas.");
    }
    const startsAt = zonedDateTimeToUtc(String(fn.date).slice(0, 10), fn.start_time || "00:00");
    if (!startsAt) throw new ToolError("conflict", "La función no tiene una fecha válida.");

    let sendAt: Date;
    if (args.send_at) sendAt = new Date(args.send_at);
    else if (args.hours_before) sendAt = new Date(startsAt.getTime() - args.hours_before * 3600_000);
    else sendAt = zonedDateTimeToUtc(String(fn.date).slice(0, 10), "10:00") as Date;
    if (sendAt.getTime() >= startsAt.getTime()) throw new ToolError("invalid_input", "El recordatorio debe enviarse antes de que empiece la función.");
    if (sendAt.getTime() <= Date.now() + 60_000) {
        throw new ToolError("invalid_input", `Esa hora ya pasó (${fmtInstant(sendAt.toISOString())}). Elige otra (send_at u hours_before) o usa send_attendee_message para avisar ahora.`);
    }

    const dateLong = formatDateOnlyLong(fn.date);
    const time = formatTimeShort(fn.start_time);
    const place = formatEventLocation(fn.event_locations) || event.location || "";
    const body =
        args.message ||
        `¡Te esperamos! ${event.name} es el ${dateLong}${time ? ` a las ${time} hrs` : ""}${place ? ` en ${place}` : ""}.\n\n` +
            "Llega con tiempo y ten a mano el código QR de tus entradas (lo encuentras en el botón de abajo).";
    const subject = args.subject || `🎪 Recordatorio: ${event.name}`;
    return { event, fn, sendAt: sendAt.toISOString(), body, subject, dateLong, time, place };
}

const scheduleReminder: ToolDef = {
    name: "schedule_reminder",
    title: "Programar recordatorio",
    description:
        "Programa un recordatorio por correo para quienes tienen entradas. Por defecto se envía el día de la próxima función a las 10:00 (hora de Chile); " +
        "o usa hours_before (horas antes del inicio) o send_at exacto. Si no envías message, se arma con fecha, hora y lugar. " +
        "Ojo: AI Tickets ya manda automáticamente un recordatorio el día anterior; este es adicional.",
    scope: "publish",
    permission: "messages.send",
    idempotent: true,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            function_id: { type: "integer", minimum: 1, description: "Función (get_event → functions). Omitir = la próxima." },
            hours_before: { type: "integer", minimum: 1, maximum: 168, description: "Enviar N horas antes del inicio de la función." },
            send_at: { type: "string", format: "date-time", description: "Hora exacta de envío (ISO 8601). Tiene prioridad sobre hours_before." },
            subject: { type: "string", minLength: 3, maxLength: 150 },
            message: { type: "string", minLength: 5, maxLength: 4000, description: "Texto propio. Omitir = texto estándar con fecha, hora y lugar." },
            audience: AUDIENCE_SCHEMA,
        },
    },
    async confirm(args, ctx) {
        const r = await prepareReminder(args, ctx);
        const recipients = await collectMessageRecipients(ctx.supabase, r.event, args.audience);
        return {
            message: `Se programará el recordatorio "${r.subject}" para el ${fmtInstant(r.sendAt)} (hora de Chile), función del ${r.dateLong}${r.time ? ` ${r.time}` : ""}. Hoy lo recibirían ${recipients.length} asistente(s).`,
            details: { event_id: Number(r.event.id), function_id: Number(r.fn.id), send_at: r.sendAt, subject: r.subject, message_preview: r.body.slice(0, 400), audience: args.audience, recipients_now: recipients.length },
            warnings: [
                ...(r.event.status !== "published" ? ["El evento no está publicado."] : []),
                "AI Tickets ya envía automáticamente un recordatorio el día anterior a cada función.",
            ],
        };
    },
    async handler(args, ctx) {
        const r = await prepareReminder(args, ctx);
        const { message } = await createMessage(
            ctx,
            { event_id: Number(r.event.id), kind: "reminder", subject: r.subject, body: r.body, audience: args.audience, send_at: r.sendAt },
            false,
        );
        return {
            event_id: Number(r.event.id),
            function_id: Number(r.fn.id),
            reminder: presentMessage(message),
            note: `Programado para el ${fmtInstant(r.sendAt)} (hora de Chile). Puedes cancelarlo con cancel_scheduled_message.`,
        };
    },
    audit: (_args, result: any) => ({ summary: `Recordatorio programado para ${result.reminder?.send_at_local || ""}`, target: result.reminder?.id }),
};

// ---------------------------------------------------------------------------
// list / cancel
// ---------------------------------------------------------------------------

const listScheduledMessages: ToolDef = {
    name: "list_scheduled_messages",
    title: "Listar mensajes a asistentes",
    description: "Mensajes y recordatorios de un evento (programados, enviados, fallidos o cancelados) con destinatarios y fecha de envío.",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            status: { type: "string", enum: ["scheduled", "sent", "failed", "cancelled", "all"], default: "all" },
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
        let query = ctx.supabase
            .from("aitickets_scheduled_messages")
            .select("id, kind, subject, audience, send_at, status, recipients_count, failed_count, sent_at, created_at")
            .eq("event_id", event.id)
            .eq("organization_id", ctx.actor.orgId)
            .order("send_at", { ascending: false })
            .limit(100);
        if (args.status !== "all") query = query.eq("status", args.status);
        const { data, error } = await query;
        if (error) throw error;
        return { event_id: Number(event.id), messages: (data || []).map(presentMessage) };
    },
};

const cancelScheduledMessage: ToolDef = {
    name: "cancel_scheduled_message",
    title: "Cancelar mensaje programado",
    description: "Cancela un mensaje o recordatorio que aún no se envía (status scheduled). Los ya enviados no se pueden deshacer.",
    scope: "publish",
    permission: "messages.send",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["message_id"],
        additionalProperties: false,
        properties: { message_id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$", description: "ID del mensaje (list_scheduled_messages)." } },
    },
    async handler(args, ctx) {
        const { data: msg } = await ctx.supabase
            .from("aitickets_scheduled_messages")
            .select("id, event_id, status")
            .eq("id", args.message_id)
            .eq("organization_id", ctx.actor.orgId)
            .maybeSingle();
        if (!msg) throw new ToolError("not_found", "Mensaje no encontrado en tu organización.");
        await loadOwnedEvent(ctx, Number(msg.event_id), "id"); // respeta el acceso por evento
        if (msg.status === "cancelled") return { message_id: msg.id, event_id: Number(msg.event_id), status: "cancelled" };
        if (msg.status !== "scheduled") throw new ToolError("conflict", `El mensaje ya está ${msg.status === "sending" ? "enviándose" : msg.status === "sent" ? "enviado" : msg.status}: no se puede cancelar.`);
        const { count, error } = await ctx.supabase
            .from("aitickets_scheduled_messages")
            .update({ status: "cancelled" }, { count: "exact" })
            .eq("id", msg.id)
            .eq("status", "scheduled");
        if (error) throw error;
        if (!count) throw new ToolError("conflict", "El mensaje empezó a enviarse justo ahora: ya no se puede cancelar.");
        return { message_id: msg.id, event_id: Number(msg.event_id), status: "cancelled" };
    },
};

export const messagingTools: ToolDef[] = [sendAttendeeMessage, scheduleReminder, listScheduledMessages, cancelScheduledMessage];
