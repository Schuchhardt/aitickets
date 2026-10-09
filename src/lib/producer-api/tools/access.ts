// Herramientas: asistentes y control de acceso (check-in, aforo en vivo y links de escáner para la puerta).
import { ToolError, type ToolDef } from "../registry";
import { eventIdSchema, loadOwnedEvent, fetchAll, TZ } from "./common";
import {
    checkInTicket, createCheckinLink, defaultCheckinExpiry, listCheckinLinks, revokeCheckinLink, UUID_RE,
} from "../../checkinAccess";
import { formatFunctionLabel } from "../../../../netlify/lib/dates.mjs";

const timeFmt = new Intl.DateTimeFormat("es-CL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
const formatLocal = (iso: string | null | undefined) => (iso ? timeFmt.format(new Date(iso)) : null);

async function loadEventStructure(ctx: any, eventId: number) {
    const [{ data: tickets }, { data: dates }] = await Promise.all([
        ctx.supabase.from("event_tickets").select("id, ticket_name, event_date_id, total_quantity").eq("event_id", eventId),
        ctx.supabase.from("event_dates").select("id, date, start_time").eq("event_id", eventId).order("date", { ascending: true }),
    ]);
    const ticketById = new Map<number, any>((tickets || []).map((t: any) => [Number(t.id), t]));
    const dateById = new Map<number, any>((dates || []).map((d: any) => [Number(d.id), d]));
    return { tickets: tickets || [], dates: dates || [], ticketById, dateById };
}

const functionInfo = (dateById: Map<number, any>, dateId: number | null | undefined) => {
    if (dateId == null) return null;
    const d = dateById.get(Number(dateId));
    return { id: Number(dateId), label: d ? formatFunctionLabel(d, { withPlace: false }) : null };
};

const isCheckedIn = (row: any) => row.status === "validated";
const isCancelled = (row: any) => row.status != null && row.status !== "active" && row.status !== "validated";

const listAttendees: ToolDef = {
    name: "list_attendees",
    title: "Listar asistentes",
    description:
        "Entradas emitidas de un evento con su titular (nombre, email), tipo de entrada, función, estado (active = sin ingresar, validated = ya entró, " +
        "cancelled = anulada), hora de ingreso y si es cortesía. Filtra por checked_in, tipo, función o búsqueda por nombre/email. " +
        "Contiene datos personales: úsalos solo para gestionar el evento.",
    scope: "attendees",
    permission: "attendees.read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            checked_in: { type: "boolean", description: "true = solo quienes ya entraron; false = quienes aún no entran (excluye anuladas)." },
            status: { type: "string", enum: ["active", "validated", "cancelled", "all"], default: "all" },
            ticket_type_id: { type: "integer", minimum: 1, description: "Solo este tipo de entrada (get_event → ticket_types)." },
            function_id: { type: "integer", minimum: 1, description: "Solo entradas de esta función (get_event → functions)." },
            search: { type: "string", maxLength: 120, description: "Busca por nombre o email del titular (contiene)." },
            limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
            offset: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name");
        const { ticketById, dateById } = await loadEventStructure(ctx, event.id);
        const rows = await fetchAll<any>(() =>
            ctx.supabase
                .from("event_attendees")
                .select("id, created_at, status, validated_at, is_complimentary, event_order_id, event_ticket_id, attendees ( first_name, last_name, email )")
                .eq("event_id", event.id)
                .order("created_at", { ascending: true }),
        );
        const query = (args.search || "").toLowerCase();
        const filtered = rows.filter((r) => {
            const status = r.status ?? "active";
            if (args.status !== "all" && (args.status === "cancelled" ? !isCancelled(r) : status !== args.status)) return false;
            if (args.checked_in === true && !isCheckedIn(r)) return false;
            if (args.checked_in === false && (isCheckedIn(r) || isCancelled(r))) return false;
            if (args.ticket_type_id && Number(r.event_ticket_id) !== args.ticket_type_id) return false;
            if (args.function_id && Number(ticketById.get(Number(r.event_ticket_id))?.event_date_id) !== args.function_id) return false;
            if (query) {
                const name = `${r.attendees?.first_name || ""} ${r.attendees?.last_name || ""}`.toLowerCase();
                if (!name.includes(query) && !String(r.attendees?.email || "").toLowerCase().includes(query)) return false;
            }
            return true;
        });
        const page = filtered.slice(args.offset, args.offset + args.limit);
        return {
            event_id: Number(event.id),
            total: filtered.length,
            checked_in: filtered.filter(isCheckedIn).length,
            offset: args.offset,
            attendees: page.map((r) => {
                const ticket = ticketById.get(Number(r.event_ticket_id));
                return {
                    ticket_id: r.id,
                    holder: { name: `${r.attendees?.first_name || ""} ${r.attendees?.last_name || ""}`.trim() || null, email: r.attendees?.email || null },
                    ticket_type: { id: Number(r.event_ticket_id) || null, name: ticket?.ticket_name || null },
                    function: functionInfo(dateById, ticket?.event_date_id),
                    status: isCancelled(r) ? "cancelled" : r.status ?? "active",
                    checked_in: isCheckedIn(r),
                    validated_at: r.validated_at ?? null,
                    complimentary: Boolean(r.is_complimentary),
                    order_id: r.event_order_id ?? null,
                    issued_at: r.created_at,
                };
            }),
        };
    },
};

const checkInAttendee: ToolDef = {
    name: "check_in_attendee",
    title: "Marcar ingreso",
    description:
        "Marca el ingreso de una entrada (check-in manual, p. ej. si falla el escáner) por ticket_id (de list_attendees) o por el código QR. " +
        "Una entrada solo puede ingresar una vez: si ya entró, responde conflicto con la hora de ingreso. Avisa si la entrada es de otra función.",
    scope: "attendees",
    permission: "checkin",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            ticket_id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$", description: "ID de la entrada (list_attendees → ticket_id)." },
            qr_code: { type: "string", minLength: 4, maxLength: 200, description: "Contenido del código QR de la entrada." },
        },
    },
    audit: (_args, result) => ({ summary: "Ingreso manual de una entrada", target: String(result.ticket_id || "") }),
    async handler(args, ctx) {
        if (!args.ticket_id === !args.qr_code) throw new ToolError("invalid_input", "Envía ticket_id o qr_code (uno de los dos).");
        if (args.ticket_id && !UUID_RE.test(args.ticket_id)) throw new ToolError("invalid_input", "ticket_id inválido.");
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
        const result = await checkInTicket(ctx.supabase, Number(event.id), { ticketId: args.ticket_id, qrCode: args.qr_code });
        if (!result.ok) {
            if (result.code === "not_found") throw new ToolError("not_found", result.message);
            if (result.code === "already_validated") {
                throw new ToolError("conflict", `Esta entrada ya ingresó${result.validated_at ? ` (${formatLocal(result.validated_at)})` : ""}. No se puede usar dos veces.`);
            }
            throw new ToolError("conflict", `${result.message} No puede ingresar.`);
        }
        const t = result.ticket;
        return {
            event_id: Number(event.id),
            ticket_id: result.ticket_id,
            status: "validated",
            validated_at: result.validated_at,
            holder: `${t.attendees?.first_name || ""} ${t.attendees?.last_name || ""}`.trim() || null,
            ticket_type: t.event_tickets?.ticket_name || null,
            complimentary: Boolean(t.is_complimentary),
            ...(result.function_mismatch
                ? { warning: `Ojo: la entrada es para otra función (${result.function_label}). Se marcó el ingreso igual; revisa si corresponde.` }
                : {}),
        };
    },
};

const BUCKET_MINUTES = 15;
const BUCKETS = 12; // últimas 3 horas

const getCheckinStats: ToolDef = {
    name: "get_checkin_stats",
    title: "Aforo en vivo",
    description:
        "Estado del acceso de un evento en vivo: entradas emitidas, ingresadas, pendientes, % de aforo (sobre la capacidad), desglose por tipo de " +
        "entrada y por función, e ingresos cada 15 minutos en las últimas 3 horas.",
    scope: "attendees",
    permission: "checkin",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, capacity");
        const { tickets, dates, ticketById, dateById } = await loadEventStructure(ctx, event.id);
        const rows = await fetchAll<any>(() =>
            ctx.supabase.from("event_attendees").select("id, status, validated_at, event_ticket_id, is_complimentary").eq("event_id", event.id),
        );
        const valid = rows.filter((r) => !isCancelled(r));
        const checkedIn = valid.filter(isCheckedIn);
        const ticketCapacity = tickets.reduce((s: number | null, t: any) => (s == null || t.total_quantity == null ? null : s + Number(t.total_quantity)), 0 as number | null);
        const capacity = Number(event.capacity) > 0 ? Number(event.capacity) : tickets.length && ticketCapacity ? ticketCapacity : null;
        const pct = (n: number, d: number | null) => (d ? Math.round((n / d) * 1000) / 10 : null);

        const byType = new Map<number, { issued: number; checked_in: number }>();
        const byFunction = new Map<string, { issued: number; checked_in: number }>();
        for (const r of valid) {
            const tid = Number(r.event_ticket_id);
            const bt = byType.get(tid) || { issued: 0, checked_in: 0 };
            bt.issued += 1;
            if (isCheckedIn(r)) bt.checked_in += 1;
            byType.set(tid, bt);
            const fnKey = String(ticketById.get(tid)?.event_date_id ?? "all");
            const bf = byFunction.get(fnKey) || { issued: 0, checked_in: 0 };
            bf.issued += 1;
            if (isCheckedIn(r)) bf.checked_in += 1;
            byFunction.set(fnKey, bf);
        }

        const now = Date.now();
        const bucketMs = BUCKET_MINUTES * 60_000;
        const end = Math.ceil(now / bucketMs) * bucketMs;
        const start = end - BUCKETS * bucketMs;
        const arrivals = Array.from({ length: BUCKETS }, (_, i) => ({ from: new Date(start + i * bucketMs).toISOString(), count: 0 }));
        for (const r of checkedIn) {
            const t = r.validated_at ? new Date(r.validated_at).getTime() : NaN;
            if (Number.isFinite(t) && t >= start && t < end) arrivals[Math.floor((t - start) / bucketMs)].count += 1;
        }
        const lastArrival = checkedIn.reduce((m: string | null, r: any) => (r.validated_at && (!m || r.validated_at > m) ? r.validated_at : m), null);

        return {
            event_id: Number(event.id),
            as_of: new Date(now).toISOString(),
            issued: valid.length,
            checked_in: checkedIn.length,
            pending: valid.length - checkedIn.length,
            cancelled: rows.length - valid.length,
            complimentary_checked_in: checkedIn.filter((r) => r.is_complimentary).length,
            capacity,
            occupancy_pct: pct(checkedIn.length, capacity),
            checked_in_pct_of_issued: pct(checkedIn.length, valid.length),
            last_check_in_at: lastArrival,
            by_ticket_type: [...byType.entries()].map(([id, v]) => ({ ticket_type_id: id, name: ticketById.get(id)?.ticket_name || null, ...v })),
            by_function: [...byFunction.entries()].map(([key, v]) => ({
                function: key === "all" ? { id: null, label: "Válidas para cualquier función" } : functionInfo(dateById, Number(key)),
                ...v,
            })),
            functions_count: dates.length,
            arrivals_last_3h: arrivals.map((a) => ({ ...a, from_local: formatLocal(a.from) })),
        };
    },
};

const createCheckinLinkTool: ToolDef = {
    name: "create_checkin_link",
    title: "Crear link de escáner",
    description:
        "Crea un link de escáner para quien controla la puerta: abre un lector de QR en el celular SIN necesidad de cuenta, solo para este evento " +
        "(valida entradas y ve nombre y tipo de entrada; no ve emails ni puede reenviar). Por defecto vence 24 h después de la última función " +
        "(o expires_in_hours, máximo 72). La URL se entrega solo esta vez: compártela solo con el equipo de puerta; revócala con revoke_checkin_link. " +
        "Si se quita del equipo a quien lo creó, el link se revoca.",
    scope: "write",
    permission: "events.write",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            label: { type: "string", maxLength: 80, description: "Para quién es (ej: 'Puerta norte', 'Juan')." },
            expires_in_hours: { type: "integer", minimum: 1, maximum: 72, description: "Horas de validez. Omitir = hasta 24 h después de la última función." },
        },
    },
    audit: (args, result) => ({ summary: `Link de escáner creado${args.label ? ` (${args.label})` : ""}`, target: String((result.link as any)?.id || "") }),
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, end_date");
        const expiresAt = args.expires_in_hours
            ? new Date(Date.now() + args.expires_in_hours * 3_600_000)
            : await defaultCheckinExpiry(ctx.supabase, event);
        const created = await createCheckinLink(ctx.supabase, {
            eventId: Number(event.id),
            orgId: ctx.actor.orgId,
            userId: ctx.actor.userId,
            label: args.label || null,
            expiresAt,
            origin: ctx.origin,
        });
        return {
            event_id: Number(event.id),
            scanner_url: created.url,
            link: created.link,
            expires_at_local: formatLocal(created.link.expires_at),
            note: "Cualquiera con este link puede validar entradas de este evento hasta que venza: compártelo solo con el equipo de puerta.",
        };
    },
};

const listCheckinLinksTool: ToolDef = {
    name: "list_checkin_links",
    title: "Listar links de escáner",
    description: "Links de escáner de puerta de un evento con su estado (active, expired, revoked), escaneos y último uso. No incluye la URL (solo se entrega al crearla).",
    scope: "read",
    permission: "checkin",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
        return { event_id: Number(event.id), links: await listCheckinLinks(ctx.supabase, Number(event.id), ctx.actor.orgId) };
    },
};

const revokeCheckinLinkTool: ToolDef = {
    name: "revoke_checkin_link",
    title: "Revocar link de escáner",
    description: "Desactiva un link de escáner de puerta (link_id de list_checkin_links o create_checkin_link). Deja de funcionar de inmediato.",
    scope: "write",
    permission: "checkin",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["link_id"],
        additionalProperties: false,
        properties: { link_id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$", description: "ID del link (uuid)." } },
    },
    audit: (args) => ({ summary: "Link de escáner revocado", target: args.link_id }),
    async handler(args, ctx) {
        const link = await revokeCheckinLink(ctx.supabase, args.link_id, ctx.actor.orgId, ctx.actor.eventIds);
        if (!link) throw new ToolError("not_found", "Link de escáner no encontrado en tu organización.");
        return { link_id: link.id, event_id: Number(link.event_id), status: "revoked" };
    },
};

export const accessTools: ToolDef[] = [listAttendees, checkInAttendee, getCheckinStats, createCheckinLinkTool, listCheckinLinksTool, revokeCheckinLinkTool];
