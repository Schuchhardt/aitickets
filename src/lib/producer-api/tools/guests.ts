// Herramientas: lista de invitados y cortesías.
// Invitados (aitickets_guests): una lista por evento con nombre, contacto y acompañantes. send_invitations les
// manda el link del evento por correo o arma los links de WhatsApp (no hay proveedor de WhatsApp: el productor
// los envía). issue_complimentary_tickets emite entradas gratis nominadas (src/lib/courtesy.ts).
import { ToolError, type ToolDef, type ToolContext } from "../registry";
import { eventIdSchema, loadOwnedEvent, eventPublicUrl } from "./common";
import { issueCourtesyTickets, MAX_COURTESY_PER_REQUEST } from "../../courtesy";
import { sendTicketsEmail } from "../../../pages/api/_lib/server-utils";
import { sendEmail, formatRecipient, isValidEmail, legalFooterHtml, legalFooterText } from "../../../../netlify/lib/mailer.mjs";

const GUEST_COLUMNS = "id, event_id, name, email, phone, plus_ones, notes, status, invited_at, invite_channel, invite_count, created_at";
const UUID_PATTERN = "^[0-9a-fA-F-]{36}$";
const MAX_GUESTS_PER_CALL = 200;

const isMissingTable = (error: any) => ["42P01", "PGRST205"].includes(String(error?.code || ""));
const unavailable = () => new ToolError("unavailable", "La lista de invitados aún no está disponible. Intenta en unos minutos.");

export const normalizeEmail = (v: unknown) => {
    const s = String(v || "").trim().toLowerCase();
    return s || null;
};

/** Deja solo dígitos (y el + inicial). Celular chileno de 9 dígitos que parte en 9 => +569XXXXXXXX. */
export function normalizePhone(v: unknown): string | null {
    const raw = String(v || "").trim();
    if (!raw) return null;
    let digits = raw.replace(/\D/g, "");
    if (!digits) return null;
    if (digits.length === 9 && digits.startsWith("9")) digits = `56${digits}`;
    return `+${digits}`;
}

/** Link de WhatsApp (click-to-chat) con el mensaje prellenado. */
export const whatsappLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

const esc = (v: unknown) =>
    String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const presentGuest = (g: any) => ({
    id: g.id,
    name: g.name,
    email: g.email || null,
    phone: g.phone || null,
    plus_ones: Number(g.plus_ones) || 0,
    notes: g.notes || null,
    status: g.status,
    invited_at: g.invited_at || null,
    invite_channel: g.invite_channel || null,
    invite_count: Number(g.invite_count) || 0,
});

async function loadGuests(ctx: ToolContext, eventId: number) {
    const { data, error } = await ctx.supabase.from("aitickets_guests").select(GUEST_COLUMNS).eq("event_id", eventId).order("created_at", { ascending: true }).limit(5000);
    if (error) {
        if (isMissingTable(error)) throw unavailable();
        throw error;
    }
    return (data || []) as any[];
}

const addGuests: ToolDef = {
    name: "add_guests",
    title: "Agregar invitados",
    description:
        "Agrega personas a la lista de invitados de un evento (hasta 200 por llamada): nombre y, opcionalmente, email, teléfono, " +
        "acompañantes (plus_ones) y notas. Omite duplicados (mismo email o teléfono ya en la lista). Para enviarles el link usa send_invitations; " +
        "para darles una entrada gratis nominada usa issue_complimentary_tickets.",
    scope: "write",
    permission: "guests.manage",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
        type: "object",
        required: ["event_id", "guests"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            guests: {
                type: "array",
                minItems: 1,
                maxItems: MAX_GUESTS_PER_CALL,
                items: {
                    type: "object",
                    required: ["name"],
                    additionalProperties: false,
                    properties: {
                        name: { type: "string", minLength: 1, maxLength: 150 },
                        email: { type: "string", maxLength: 200 },
                        phone: { type: "string", maxLength: 30, description: "Con código de país (ej. +56912345678)." },
                        plus_ones: { type: "integer", minimum: 0, maximum: 20, default: 0, description: "Acompañantes." },
                        notes: { type: "string", maxLength: 300 },
                    },
                },
            },
        },
    },
    audit: (args, result) => ({ summary: `${(result as any).added_count} invitado(s) agregados`, target: `event:${args.event_id}` }),
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
        const existing = (await loadGuests(ctx, Number(event.id))).filter((g) => g.status !== "removed");
        const seenEmails = new Set(existing.map((g) => normalizeEmail(g.email)).filter(Boolean));
        const seenPhones = new Set(existing.map((g) => normalizePhone(g.phone)).filter(Boolean));
        const rows: any[] = [];
        const skipped: { name: string; reason: string }[] = [];
        for (const g of args.guests) {
            const email = normalizeEmail(g.email);
            if (email && !isValidEmail(email)) {
                skipped.push({ name: g.name, reason: "email inválido" });
                continue;
            }
            const phone = normalizePhone(g.phone);
            if (phone && (phone.length < 9 || phone.length > 16)) {
                skipped.push({ name: g.name, reason: "teléfono inválido" });
                continue;
            }
            if ((email && seenEmails.has(email)) || (phone && seenPhones.has(phone))) {
                skipped.push({ name: g.name, reason: "ya está en la lista" });
                continue;
            }
            if (email) seenEmails.add(email);
            if (phone) seenPhones.add(phone);
            rows.push({
                organization_id: ctx.actor.orgId,
                event_id: Number(event.id),
                name: g.name,
                email,
                phone,
                plus_ones: g.plus_ones ?? 0,
                notes: g.notes || null,
                status: "pending",
                created_by: ctx.actor.userId,
            });
        }
        let added: any[] = [];
        if (rows.length) {
            const { data, error } = await ctx.supabase.from("aitickets_guests").insert(rows).select(GUEST_COLUMNS);
            if (error) {
                if (isMissingTable(error)) throw unavailable();
                throw error;
            }
            added = data || [];
        }
        const total = existing.length + added.length;
        return {
            event_id: Number(event.id),
            added_count: added.length,
            added: added.map(presentGuest),
            skipped,
            guests_in_list: total,
            people_including_plus_ones: [...existing, ...added].reduce((n, g) => n + 1 + (Number(g.plus_ones) || 0), 0),
        };
    },
};

const listGuests: ToolDef = {
    name: "list_guests",
    title: "Listar invitados",
    description: "Lista de invitados de un evento con su contacto, acompañantes y si ya se les envió la invitación. Contiene datos personales.",
    scope: "attendees",
    permission: "attendees.read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            status: { type: "string", enum: ["active", "pending", "invited", "removed", "all"], default: "active", description: "active = pendientes + invitados." },
            search: { type: "string", maxLength: 120, description: "Filtra por nombre, email o teléfono (contiene)." },
            limit: { type: "integer", minimum: 1, maximum: 500, default: 200 },
            offset: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
        let guests = await loadGuests(ctx, Number(event.id));
        if (args.status === "active") guests = guests.filter((g) => g.status !== "removed");
        else if (args.status !== "all") guests = guests.filter((g) => g.status === args.status);
        if (args.search) {
            const q = args.search.toLowerCase();
            guests = guests.filter((g) => [g.name, g.email, g.phone].some((v) => String(v || "").toLowerCase().includes(q)));
        }
        const active = guests.filter((g) => g.status !== "removed");
        return {
            event_id: Number(event.id),
            total: guests.length,
            offset: args.offset,
            summary: {
                pending: active.filter((g) => g.status === "pending").length,
                invited: active.filter((g) => g.status === "invited").length,
                people_including_plus_ones: active.reduce((n, g) => n + 1 + (Number(g.plus_ones) || 0), 0),
            },
            guests: guests.slice(args.offset, args.offset + args.limit).map(presentGuest),
        };
    },
};

const removeGuest: ToolDef = {
    name: "remove_guest",
    title: "Quitar invitado",
    description: "Quita a una persona de la lista de invitados (guest_id de list_guests). No anula entradas ya emitidas: para eso usa refund_order o get_order.",
    scope: "write",
    permission: "guests.manage",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id", "guest_id"],
        additionalProperties: false,
        properties: { event_id: eventIdSchema, guest_id: { type: "string", pattern: UUID_PATTERN } },
    },
    audit: (args) => ({ summary: "Invitado quitado de la lista", target: `guest:${args.guest_id}` }),
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
        const { data: guest, error } = await ctx.supabase
            .from("aitickets_guests")
            .select("id, status")
            .eq("id", args.guest_id)
            .eq("event_id", event.id)
            .eq("organization_id", ctx.actor.orgId)
            .maybeSingle();
        if (error) {
            if (isMissingTable(error)) throw unavailable();
            throw error;
        }
        if (!guest) throw new ToolError("not_found", "Invitado no encontrado en este evento (ver list_guests).");
        if (guest.status !== "removed") {
            const { error: upError } = await ctx.supabase
                .from("aitickets_guests")
                .update({ status: "removed", removed_at: new Date().toISOString() })
                .eq("id", guest.id)
                .eq("event_id", event.id);
            if (upError) throw upError;
        }
        return { event_id: Number(event.id), guest_id: guest.id, status: "removed" };
    },
};

// ---------------------------------------------------------------------------
// send_invitations
// ---------------------------------------------------------------------------

type InvitePlan = { event: any; url: string; orgName: string; targets: any[]; skipped: { id: string; name: string; reason: string }[] };

async function planInvitations(args: any, ctx: ToolContext): Promise<InvitePlan> {
    const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, slug, status, accessibility, start_date, cancelled_at");
    if (event.cancelled_at) throw new ToolError("conflict", "El evento está cancelado: no se pueden enviar invitaciones.");
    if (event.status !== "published") {
        throw new ToolError(
            "conflict",
            "El evento está en BORRADOR: su link no funciona para los invitados. Publícalo primero (set_event_status; si es solo para invitados, márcalo privado con update_event is_private=true y luego publícalo).",
        );
    }
    const url = eventPublicUrl(ctx, event.slug);
    if (!url) throw new ToolError("conflict", "El evento no tiene link público.");
    let guests = (await loadGuests(ctx, Number(event.id))).filter((g) => g.status !== "removed");
    if (args.guest_ids?.length) {
        const wanted = new Set(args.guest_ids.map((id: string) => id.toLowerCase()));
        guests = guests.filter((g) => wanted.has(String(g.id).toLowerCase()));
    } else if (!args.include_already_invited) {
        guests = guests.filter((g) => g.status === "pending");
    }
    const targets: any[] = [];
    const skipped: InvitePlan["skipped"] = [];
    for (const g of guests) {
        if (args.channel === "email" && !(g.email && isValidEmail(g.email))) skipped.push({ id: g.id, name: g.name, reason: "sin email" });
        else if (args.channel === "whatsapp" && !normalizePhone(g.phone)) skipped.push({ id: g.id, name: g.name, reason: "sin teléfono" });
        else targets.push(g);
    }
    const { data: org } = await ctx.supabase.from("organizations").select("public_name").eq("id", ctx.actor.orgId).maybeSingle();
    return { event, url, orgName: org?.public_name || "La productora", targets, skipped };
}

function invitationText(plan: InvitePlan, name: string, message?: string) {
    const parts = [`Hola ${name}! ${plan.orgName} te invita a ${plan.event.name}.`];
    if (message) parts.push(message);
    parts.push(`Toda la info aquí: ${plan.url}`);
    return parts.join("\n\n");
}

const sendInvitations: ToolDef = {
    name: "send_invitations",
    title: "Enviar invitaciones",
    description:
        "Envía el link del evento a la lista de invitados por email (desde AI Tickets, un correo individual por persona) o prepara los links de WhatsApp " +
        "(wa.me con el mensaje listo: AI Tickets no envía WhatsApp; el productor los abre y envía). Por defecto va a los invitados pendientes; " +
        "guest_ids limita a algunos. El evento debe estar publicado (puede ser privado). Es un envío masivo: requiere confirmación.",
    scope: "write",
    permission: "guests.manage",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id", "channel"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            channel: { type: "string", enum: ["email", "whatsapp"] },
            guest_ids: { type: "array", maxItems: 500, items: { type: "string", pattern: UUID_PATTERN }, description: "Solo estos invitados (vacío = todos los pendientes)." },
            message: { type: "string", maxLength: 1000, description: "Texto personal que va antes del link." },
            include_already_invited: { type: "boolean", default: false, description: "true = también a quienes ya se les envió." },
        },
    },
    async confirm(args, ctx) {
        const plan = await planInvitations(args, ctx);
        if (!plan.targets.length) throw new ToolError("conflict", "No hay invitados a quienes enviar con ese canal (revisa list_guests).");
        return {
            message:
                args.channel === "email"
                    ? `Se enviará un correo con el link de "${plan.event.name}" a ${plan.targets.length} invitado(s).`
                    : `Se prepararán ${plan.targets.length} link(s) de WhatsApp con la invitación a "${plan.event.name}" (los envías tú).`,
            details: { channel: args.channel, recipients: plan.targets.length, skipped: plan.skipped.length, event_url: plan.url, preview: invitationText(plan, "<nombre>", args.message) },
            warnings: plan.skipped.length ? [`${plan.skipped.length} invitado(s) quedan fuera por no tener ${args.channel === "email" ? "email" : "teléfono"}.`] : undefined,
        };
    },
    audit: (args, result) => ({ summary: `Invitaciones por ${args.channel}: ${(result as any).sent_count}`, target: `event:${args.event_id}` }),
    async handler(args, ctx) {
        const plan = await planInvitations(args, ctx);
        const now = new Date().toISOString();
        const markInvited = async (ids: string[]) => {
            for (const g of plan.targets.filter((t) => ids.includes(t.id))) {
                await ctx.supabase
                    .from("aitickets_guests")
                    .update({ status: "invited", invited_at: now, invite_channel: args.channel, invite_count: (Number(g.invite_count) || 0) + 1 })
                    .eq("id", g.id)
                    .eq("event_id", plan.event.id);
            }
        };

        if (args.channel === "whatsapp") {
            const links = plan.targets.map((g) => {
                const phone = normalizePhone(g.phone)!;
                return { guest_id: g.id, name: g.name, phone, whatsapp_url: whatsappLink(phone, invitationText(plan, g.name, args.message)) };
            });
            await markInvited(plan.targets.map((g) => g.id));
            return {
                event_id: Number(plan.event.id),
                channel: "whatsapp",
                sent_count: links.length,
                links,
                skipped: plan.skipped,
                note: "AI Tickets no envía WhatsApp: entrega estos links al productor; cada uno abre WhatsApp con el mensaje listo para enviar.",
            };
        }

        const recipientVariables: Record<string, Record<string, { html: string; text: string }>> = {};
        const to: string[] = [];
        const seen = new Set<string>();
        for (const g of plan.targets) {
            const email = String(g.email).toLowerCase();
            if (seen.has(email)) continue;
            seen.add(email);
            to.push(formatRecipient(g.name, email));
            recipientVariables[email] = { name: { html: esc(g.name), text: g.name } };
        }
        const subject = `${plan.orgName} te invita a ${plan.event.name}`;
        const messageHtml = args.message ? `<p style="white-space:pre-line">${esc(args.message)}</p>` : "";
        const html =
            `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#111827;max-width:560px;margin:0 auto">` +
            `<p>Hola %recipient.name%:</p><p><strong>${esc(plan.orgName)}</strong> te invita a <strong>${esc(plan.event.name)}</strong>.</p>${messageHtml}` +
            `<p style="margin:24px 0"><a href="${esc(plan.url)}" style="background:#111827;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Ver el evento</a></p>` +
            `<p style="font-size:13px;color:#6b7280">${esc(plan.url)}</p>${legalFooterHtml()}</div>`;
        const text = `Hola %recipient.name%:\n\n${plan.orgName} te invita a ${plan.event.name}.\n\n${args.message ? `${args.message}\n\n` : ""}Ver el evento: ${plan.url}\n\n${legalFooterText()}`;
        try {
            await sendEmail({ to, subject, html, text, recipientVariables, tags: ["guest-invitation"] });
        } catch (err: any) {
            console.error("send_invitations:", err?.message);
            throw new ToolError("upstream", "No se pudieron enviar los correos. Intenta nuevamente en unos minutos.");
        }
        await markInvited(plan.targets.map((g) => g.id));
        return { event_id: Number(plan.event.id), channel: "email", sent_count: to.length, skipped: plan.skipped, event_url: plan.url };
    },
};

// ---------------------------------------------------------------------------
// Cortesías
// ---------------------------------------------------------------------------

const issueComplimentary: ToolDef = {
    name: "issue_complimentary_tickets",
    title: "Emitir cortesías",
    description:
        "Emite entradas GRATIS nominadas (DJ, staff, prensa) de un tipo de entrada y las envía por correo a cada destinatario. Pueden superar el cupo " +
        `del tipo de entrada (las decide el productor). Hasta 50 destinatarios y ${MAX_COURTESY_PER_REQUEST} entradas por destinatario. ` +
        "Usa idempotency_key para que un reintento no duplique entradas.",
    scope: "write",
    permission: "guests.manage",
    idempotent: true,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id", "ticket_type_id", "recipients"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            ticket_type_id: { type: "integer", minimum: 1, description: "Tipo de entrada (get_event → ticket_types)." },
            recipients: {
                type: "array",
                minItems: 1,
                maxItems: 50,
                items: {
                    type: "object",
                    required: ["name", "email"],
                    additionalProperties: false,
                    properties: {
                        name: { type: "string", minLength: 1, maxLength: 200, description: "Nombre y apellido." },
                        email: { type: "string", maxLength: 200 },
                        quantity: { type: "integer", minimum: 1, maximum: MAX_COURTESY_PER_REQUEST, default: 1 },
                    },
                },
            },
        },
    },
    audit: (args, result) => ({ summary: `${(result as any).tickets_issued} cortesía(s) emitidas`, target: `event:${args.event_id}` }),
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, cancelled_at");
        if (event.cancelled_at) throw new ToolError("conflict", "El evento está cancelado.");
        const { data: ticket } = await ctx.supabase
            .from("event_tickets")
            .select("id, ticket_name")
            .eq("id", args.ticket_type_id)
            .eq("event_id", event.id)
            .maybeSingle();
        if (!ticket) throw new ToolError("not_found", `El tipo de entrada ${args.ticket_type_id} no existe en el evento ${event.id}.`);
        for (const r of args.recipients) {
            if (!isValidEmail(String(r.email).toLowerCase())) throw new ToolError("invalid_input", `Email inválido para ${r.name}.`);
        }
        const results: any[] = [];
        for (const r of args.recipients) {
            const email = String(r.email).trim().toLowerCase();
            const [firstName, ...rest] = String(r.name).trim().split(/\s+/);
            try {
                const { orderId } = await issueCourtesyTickets(ctx.supabase, {
                    event: { id: Number(event.id) },
                    ticket: { id: Number(ticket.id), ticket_name: ticket.ticket_name },
                    quantity: r.quantity ?? 1,
                    firstName: firstName.slice(0, 100),
                    lastName: rest.join(" ").slice(0, 100) || null,
                    email,
                    issuedBy: ctx.actor.userId,
                });
                const mail = await sendTicketsEmail(ctx.requestUrl, orderId);
                results.push({ name: r.name, email, quantity: r.quantity ?? 1, order_id: orderId, email_sent: mail.ok });
            } catch (err: any) {
                console.error("issue_complimentary_tickets:", err?.message || err);
                results.push({ name: r.name, email, quantity: r.quantity ?? 1, order_id: null, error: "No se pudo emitir" });
            }
        }
        const issued = results.filter((r) => r.order_id);
        if (!issued.length) throw new ToolError("internal", "No se pudo emitir ninguna cortesía. Intenta nuevamente.");
        return {
            event_id: Number(event.id),
            ticket_type: { id: Number(ticket.id), name: ticket.ticket_name },
            tickets_issued: issued.reduce((n, r) => n + r.quantity, 0),
            results,
            ...(results.some((r) => r.order_id && !r.email_sent)
                ? { note: "Algunos correos no se enviaron: reintenta con resend_tickets usando el order_id." }
                : {}),
        };
    },
};

export const guestTools: ToolDef[] = [addGuests, listGuests, removeGuest, sendInvitations, issueComplimentary];
