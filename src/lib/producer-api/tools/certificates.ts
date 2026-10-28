// Herramientas: certificados de asistencia (src/lib/certificates.ts). Solo para quienes ingresaron (check-in); en un
// pase de varias funciones se puede exigir un mínimo de funciones con ingreso. El envío por correo es masivo:
// confirmación en el servidor (dos llamadas), solo con el evento terminado, y un segundo envío llega solo a quienes
// faltan (aitickets_certificate_sends). El panel usa estas mismas herramientas (/api/events/certificates).
import { createHash } from "node:crypto";
import { ToolError, type ToolContext, type ToolDef } from "../registry";
import { eventIdSchema, loadOwnedEvent } from "./common";
import { eventPhase } from "../../eventModules";
import { CERTIFICATE_SENDS_TABLE, certificateUrl, hoursLabel, loadCertificates, type CertificateRow } from "../../certificates";
import { MAX_TICKETS_PER_TOKEN } from "../../../../netlify/lib/certificate-token.mjs";
import { formatRecipient, isValidEmail, sendEmail } from "../../../../netlify/lib/mailer.mjs";
import { renderCertificateEmail } from "../../../../netlify/lib/emails/index.mjs";
import { greetingName, splitFullName } from "../../../../netlify/lib/buyer-name.mjs";
import { LEGAL } from "../../../../netlify/lib/legal.mjs";

/** Correos por envío (cada llamada a Resend lleva hasta 100): un envío más grande se completa repitiéndolo. */
export const MAX_CERTIFICATE_RECIPIENTS = 1000;
const BATCH = 100;

const OPTION_PROPS = {
    min_sessions: {
        type: "integer" as const,
        minimum: 1,
        maximum: 60,
        default: 1,
        description: "En un pase para todas las funciones (congreso de varios días), mínimo de funciones con ingreso para recibir certificado. Las entradas de una sola función no se ven afectadas.",
    },
    hours: {
        type: "number" as const,
        minimum: 0.5,
        maximum: 500,
        description: "Horas que dice el certificado (p. ej. horas académicas). Si se omite, la duración de las funciones a las que asistió (si tienen hora de término).",
    },
};

const isMissingTable = (error: any) => ["42P01", "PGRST205"].includes(String(error?.code || ""));
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const opts = (args: any) => ({ minSessions: args.min_sessions ?? 1, hours: args.hours ?? null });

async function loadSends(ctx: ToolContext, eventId: number) {
    const { data, error } = await ctx.supabase
        .from(CERTIFICATE_SENDS_TABLE)
        .select("id, created_at, ticket_ids, recipients_count, min_sessions, hours")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });
    if (error) {
        if (isMissingTable(error)) return null;
        throw error;
    }
    return (data || []) as any[];
}

async function prepare(args: any, ctx: ToolContext) {
    const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, status, organization_id, start_date, end_date");
    const certs = await loadCertificates(ctx.supabase, event, opts(args));
    const sends = await loadSends(ctx, Number(event.id));
    const sentIds = new Set((sends || []).flatMap((s) => (Array.isArray(s.ticket_ids) ? s.ticket_ids.map(String) : [])));
    return { event, certs, sends, sentIds };
}

function summarize(rows: CertificateRow[], sentIds: Set<string>) {
    const eligible = rows.filter((r) => r.eligible);
    return {
        checked_in: rows.length,
        eligible: eligible.length,
        below_min_sessions: rows.filter((r) => r.reason === "below_min_sessions").length,
        missing_name: rows.filter((r) => r.reason === "missing_name").length,
        without_email: eligible.filter((r) => !isValidEmail(r.email)).length,
        already_sent: eligible.filter((r) => sentIds.has(r.ticket_id)).length,
    };
}

/** Un correo por persona: las entradas de un mismo correo van juntas (un link con un certificado por página). */
function groupByEmail(rows: CertificateRow[]) {
    const byEmail = new Map<string, CertificateRow[]>();
    for (const r of rows) {
        if (!isValidEmail(r.email)) continue;
        const list = byEmail.get(r.email) || [];
        if (list.length < MAX_TICKETS_PER_TOKEN) list.push(r);
        byEmail.set(r.email, list);
    }
    return [...byEmail.entries()].map(([email, list]) => ({ email, rows: list }));
}

const getAttendanceCertificates: ToolDef = {
    name: "get_attendance_certificates",
    title: "Ver certificados de asistencia",
    description:
        "Quiénes reciben certificado de asistencia de un evento (solo quienes ingresaron; con min_sessions, los pases de varias funciones " +
        "deben haber ingresado a ese mínimo), con el link de descarga de cada uno (PDF, no vence) y el link del panel para descargarlos todos. " +
        "Nombre: el del titular de la entrada o el de quien compró. Contiene datos personales.",
    scope: "attendees",
    permission: "attendees.read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: { event_id: eventIdSchema, ...OPTION_PROPS, limit: { type: "integer", minimum: 1, maximum: 1000, default: 200 } },
    },
    async handler(args, ctx) {
        const { event, certs, sends, sentIds } = await prepare(args, ctx);
        const eligible = certs.rows.filter((r) => r.eligible);
        const query = new URLSearchParams({ event_id: String(event.id), format: "pdf" });
        if ((args.min_sessions ?? 1) > 1) query.set("min_sessions", String(args.min_sessions));
        if (args.hours) query.set("hours", String(args.hours));
        return {
            event_id: Number(event.id),
            event_name: event.name,
            event_ended: eventPhase(event.start_date, event.end_date) === "after",
            functions_total: certs.dates.length,
            summary: summarize(certs.rows, sentIds),
            // Descarga de todos en un PDF (requiere sesión en el panel)
            pdf_download_url: `${ctx.origin}/api/events/certificates?${query}`,
            certificates: eligible.slice(0, args.limit ?? 200).map((r) => ({
                ticket_id: r.ticket_id,
                name: r.name,
                email: r.email || null,
                ticket_type: r.ticket_type,
                sessions_attended: r.multi ? r.sessions_attended : null,
                sessions_total: r.multi ? r.sessions_total : null,
                hours: r.hours,
                emailed: sentIds.has(r.ticket_id),
                certificate_url: certificateUrl(ctx.origin, [r.ticket_id], opts(args)) || null,
            })),
            truncated: eligible.length > (args.limit ?? 200),
            sends: sends === null ? null : sends.slice(0, 10).map((s) => ({ sent_at: s.created_at, recipients: s.recipients_count, certificates: (s.ticket_ids || []).length })),
        };
    },
};

const sendAttendanceCertificates: ToolDef = {
    name: "send_attendance_certificates",
    title: "Enviar certificados de asistencia",
    description:
        "Envía por correo a cada asistente que ingresó el link para descargar su certificado (PDF). Solo con el evento terminado. " +
        "Un segundo envío llega solo a quienes todavía no lo recibieron (resend_all = true lo manda a todos de nuevo). " +
        `Hasta ${MAX_CERTIFICATE_RECIPIENTS} correos por envío: si hay más, repite el envío. Revisa antes con get_attendance_certificates.`,
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
            ...OPTION_PROPS,
            note: { type: "string", maxLength: 500, description: "Texto breve opcional que va en el correo (p. ej. un agradecimiento)." },
            resend_all: { type: "boolean", default: false, description: "true = también a quienes ya lo recibieron." },
        },
    },
    async confirm(args, ctx) {
        const plan = await planSend(args, ctx);
        const rules = [
            (args.min_sessions ?? 1) > 1 ? `pases con al menos ${args.min_sessions} funciones con ingreso` : null,
            args.hours ? `${hoursLabel(args.hours)} en cada certificado` : null,
        ].filter(Boolean);
        return {
            message: `Se enviará el certificado de asistencia de "${plan.event.name}" a ${plan.recipients.length} persona(s) (${plan.certificates} certificado(s))${rules.length ? `, con ${rules.join(" y ")}` : ""}.`,
            details: { event_id: Number(plan.event.id), recipients: plan.recipients.length, certificates: plan.certificates, ...plan.summary },
            warnings: [
                ...(plan.summary.already_sent && !args.resend_all ? [`${plan.summary.already_sent} ya lo recibieron en un envío anterior: no se les vuelve a enviar.`] : []),
                ...(plan.summary.without_email ? [`${plan.summary.without_email} sin correo válido: descárgalos desde el panel.`] : []),
                ...(plan.pendingTotal > plan.recipients.length ? [`Hay ${plan.pendingTotal} personas por enviar: este envío llega a las primeras ${plan.recipients.length}. Repite el envío para el resto.`] : []),
            ],
        };
    },
    async handler(args, ctx) {
        const plan = await planSend(args, ctx);
        const { data: org } = await ctx.supabase.from("organizations").select("public_name, email").eq("id", plan.event.organization_id).maybeSingle();
        const replyTo = org?.email && isValidEmail(org.email) ? org.email : LEGAL.supportEmail;
        const { subject, html, text } = await renderCertificateEmail({ eventName: plan.event.name, organizerName: org?.public_name || "", note: args.note });
        const sentTickets: string[] = [];
        let sent = 0;
        let failed = 0;
        for (let i = 0; i < plan.recipients.length; i += BATCH) {
            const batch = plan.recipients.slice(i, i + BATCH);
            const recipientVariables: Record<string, Record<string, { html: string; text: string }>> = {};
            for (const r of batch) {
                const first = r.rows[0];
                const { firstName, lastName } = splitFullName(first.name);
                const greeting = greetingName(firstName, lastName, "Hola");
                recipientVariables[r.email] = { name: { html: esc(greeting), text: greeting }, certificate_url: { html: esc(r.url), text: r.url } };
            }
            const key = createHash("sha256").update(batch.map((r) => `${r.email}:${r.rows.map((x) => x.ticket_id).join(",")}`).join("|")).digest("hex").slice(0, 24);
            try {
                await sendEmail({
                    to: batch.map((r) => formatRecipient(r.rows[0].name, r.email)),
                    subject,
                    html,
                    text,
                    replyTo,
                    recipientVariables,
                    tags: ["certificate"],
                    idempotencyKey: `certificate-${plan.event.id}-${key}`,
                });
                sent += batch.length;
                for (const r of batch) sentTickets.push(...r.rows.map((x) => x.ticket_id));
            } catch (err: any) {
                failed += batch.length;
                console.error(`send_attendance_certificates: lote del evento ${plan.event.id} falló:`, err?.message);
            }
        }
        if (sentTickets.length) {
            const { error } = await ctx.supabase.from(CERTIFICATE_SENDS_TABLE).insert({
                event_id: Number(plan.event.id),
                organization_id: ctx.actor.orgId,
                ticket_ids: sentTickets,
                recipients_count: sent,
                min_sessions: args.min_sessions ?? 1,
                hours: args.hours ?? null,
                created_by: ctx.actor.userId,
            });
            if (error) console.error("aitickets_certificate_sends:", error.message);
        }
        if (!sent && failed) throw new ToolError("upstream", "No se pudo enviar ningún correo. Intenta de nuevo en unos minutos.");
        return {
            event_id: Number(plan.event.id),
            sent,
            failed,
            certificates: sentTickets.length,
            remaining: Math.max(0, plan.pendingTotal - sent),
        };
    },
    audit: (_args, result: any) => ({ summary: `Certificados de asistencia a ${result.sent} persona(s)` }),
};

async function planSend(args: any, ctx: ToolContext) {
    const { event, certs, sends, sentIds } = await prepare(args, ctx);
    if (sends === null) throw new ToolError("unavailable", "El envío de certificados aún no está disponible. Intenta en unos minutos.");
    if (eventPhase(event.start_date, event.end_date) !== "after") {
        throw new ToolError("conflict", "El evento todavía no termina: los certificados se envían después de la última función. Mientras, puedes descargarlos desde el panel.");
    }
    const pending = certs.rows.filter((r) => r.eligible && (args.resend_all || !sentIds.has(r.ticket_id)));
    const groups = groupByEmail(pending);
    if (!groups.length) {
        throw new ToolError("conflict", certs.rows.some((r) => r.eligible) ? "Todos los certificados ya se enviaron (usa resend_all para mandarlos de nuevo)." : "Nadie cumple las condiciones para recibir certificado (¿hubo check-in en la puerta?).");
    }
    const recipients = groups.slice(0, MAX_CERTIFICATE_RECIPIENTS).map((g) => {
        const url = certificateUrl(ctx.origin, g.rows.map((r) => r.ticket_id), opts(args));
        if (!url) throw new ToolError("unavailable", "Falta configurar la firma de los links de certificados.");
        return { ...g, url };
    });
    return {
        event,
        recipients,
        pendingTotal: groups.length,
        certificates: recipients.reduce((n, r) => n + r.rows.length, 0),
        summary: summarize(certs.rows, sentIds),
    };
}

export const certificateTools: ToolDef[] = [getAttendanceCertificates, sendAttendanceCertificates];
