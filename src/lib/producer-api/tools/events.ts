// Herramientas: cuenta, eventos y lugares.
import { ToolError, type ToolDef, type ToolContext, channelLabel } from "../registry";
import { SCOPE_LABELS } from "../keys";
import { PERMISSION_LABELS, ROLE_LABELS, ROLE_PERMISSIONS } from "../permissions";
import {
    eventIdSchema, loadOwnedEvent, eventPublicUrl, eventDashboardUrl, eventUrls, ticketAvailability, presentTicket, TICKET_SELECT,
    DATE_PATTERN, TIME_PATTERN, fetchAll, DRAFT_URL_NOTE, scopeToEvents, eventDateFields, DATES_NOTE, descriptionDateWarning,
    rejectCourtesyName, clp, localDateTime, ticketChainInfo,
} from "./common";
import { isCourtesyOrder, isTransferOrder, orderSoldQty } from "../../orderKinds";
import { createPreviewLink, listPreviewLinks, revokePreviewLink, PreviewLinkError, PREVIEW_DEFAULT_HOURS } from "../../eventPreview";
import { createEventGraph, setEventStatus, syncEventCategory, refreshEventDenorm, EventInputError, type EventGraphInput } from "../../../pages/api/_lib/events";
import { loadSecretLocation, saveSecretLocation, MAX_REVEAL_HOURS, SECRET_LOCATION_MAX, DEFAULT_REVEAL_HOURS } from "../../../../netlify/lib/secret-location.mjs";
import { listOrgVenues } from "../../orgVenues";
import { sanitizeRichText } from "../../sanitize";
import { changeEventSlug, EventSlugError, SLUG_MAX, SLUG_MIN } from "../../eventSlug";
import { EVENT_PAGE_BACKGROUNDS, EVENT_PAGE_LAYOUTS, isDefaultPageSettings, normalizePageSettings, type EventPageSettings } from "../../eventPageSettings";
import { normalizeEventVideo } from "../../eventVideo";
import { notifySlack, dedupeLocation } from "../../../pages/api/_lib/server-utils";
import { normalizeCheckoutFields, isDefaultCheckoutFields, ATTENDEE_NAME_MODES, HOLDER_MODES, QUESTION_SCOPES, QUESTION_TYPES, MAX_QUESTIONS, MAX_OPTIONS, MAX_LABEL } from "../../checkoutFields.mjs";
import { loadPeoplePerTicket } from "../../../../netlify/lib/tickets.mjs";

const EVENT_LIST_COLUMNS = "id, name, slug, status, accessibility, start_date, end_date, location, image_url, created_at";

const rethrowEventInput = (err: unknown): never => {
    if (err instanceof EventInputError) throw new ToolError(err.status === 403 ? "forbidden" : "invalid_input", err.message);
    throw err;
};

const getAccount: ToolDef = {
    name: "get_account",
    title: "Mi cuenta",
    description:
        "Devuelve la organización, el usuario dueño de la llave con su rol, los permisos (scopes) de la conexión, lo que su rol le permite, " +
        "los eventos a los que tiene acceso y las redes sociales conectadas. " +
        "Úsala al inicio para saber qué puedes hacer.",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
        const [{ data: org }, { data: accounts }] = await Promise.all([
            ctx.supabase.from("organizations").select("id, public_name, email, website, instagram, facebook, tiktok").eq("id", ctx.actor.orgId).maybeSingle(),
            ctx.supabase.from("social_accounts").select("platform, account_name, status").eq("organization_id", ctx.actor.orgId).eq("status", "active"),
        ]);
        return {
            organization: org ? { id: Number(org.id), name: org.public_name, email: org.email, website: org.website, instagram: org.instagram, facebook: org.facebook, tiktok: org.tiktok } : { id: ctx.actor.orgId },
            user: { id: ctx.actor.userId, name: ctx.actor.name, email: ctx.actor.email, role: ctx.actor.role, role_label: ROLE_LABELS[ctx.actor.role] || ctx.actor.role },
            scopes: ctx.actor.scopes.map((s) => ({ scope: s, allows: SCOPE_LABELS[s] })),
            role_permissions: (ROLE_PERMISSIONS[ctx.actor.role] || []).map((p) => ({ permission: p, allows: PERMISSION_LABELS[p] })),
            event_access: ctx.actor.eventIds ? { restricted_to_event_ids: ctx.actor.eventIds } : "all",
            connected_social_accounts: (accounts || []).map((a: any) => ({ platform: a.platform, account: a.account_name })),
            conventions: {
                currency: "CLP (pesos chilenos, enteros sin decimales)",
                timezone:
                    "America/Santiago. Las funciones (functions[].date/start_time/end_time) y los campos *_local están en hora de Chile; " +
                    "start_date, end_date y demás timestamps ISO están en UTC. Sin hora de término, una función se estima de 3 horas.",
                dashboard: `${ctx.origin}/dashboard`,
            },
        };
    },
};

const listEvents: ToolDef = {
    name: "list_events",
    title: "Listar eventos",
    description:
        "Lista los eventos de la organización con estado, fecha, lugar, link público, entradas vendidas e ingresos (órdenes pagadas; " +
        "sin cortesías ni transferencias). " +
        "Ordenados del más próximo/reciente al más antiguo. Los borradores NO tienen link público activo (public_url = null): " +
        "para mostrarlos usa create_preview_link. Los eventos archivados (archive_event) se omiten salvo include_archived=true.",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            status: { type: "string", enum: ["published", "draft", "all"], default: "all", description: "Filtrar por estado." },
            when: { type: "string", enum: ["upcoming", "past", "all"], default: "all", description: "upcoming = terminan en el futuro (o sin fecha)." },
            include_archived: { type: "boolean", default: false, description: "true = incluir eventos archivados." },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
        },
    },
    async handler(args, ctx) {
        const nowIso = new Date().toISOString();
        const build = (withArchive: boolean) => {
            let query = ctx.supabase
                .from("events")
                .select(withArchive ? `${EVENT_LIST_COLUMNS}, archived_at` : EVENT_LIST_COLUMNS)
                .eq("organization_id", ctx.actor.orgId)
                .order("start_date", { ascending: false, nullsFirst: true })
                .limit(args.limit);
            if (args.status !== "all") query = query.eq("status", args.status);
            if (withArchive && !args.include_archived) query = query.is("archived_at", null);
            query = scopeToEvents(ctx, query, "id");
            if (args.when === "past") query = query.lt("end_date", nowIso);
            return query;
        };
        let { data, error } = await build(true);
        // Sin la columna archived_at (deploy preview sin migrar): sin filtro de archivados
        if (error && /archived_at/.test(String(error.message || ""))) ({ data, error } = await build(false));
        if (error) throw error;
        let events: any[] = data || [];
        if (args.when === "upcoming") events = events.filter((e) => !e.end_date || e.end_date >= nowIso);

        const ids = events.map((e) => Number(e.id));
        const orders = ids.length
            ? await fetchAll<any>(() => ctx.supabase.from("event_orders").select("event_id, amount, ticket_qty, ticket_details, payment_provider").in("event_id", ids).eq("status", "paid"))
            : [];
        const totals = new Map<number, { tickets: number; revenue: number; orders: number }>();
        for (const o of orders) {
            // Ventas: sin cortesías ni transferencias (src/lib/orderKinds.ts)
            if (isCourtesyOrder(o) || isTransferOrder(o)) continue;
            const t = totals.get(Number(o.event_id)) || { tickets: 0, revenue: 0, orders: 0 };
            t.tickets += orderSoldQty(o);
            t.revenue += Number(o.amount) || 0;
            t.orders += 1;
            totals.set(Number(o.event_id), t);
        }

        return {
            count: events.length,
            dates_note: DATES_NOTE,
            ...(events.some((e) => e.status !== "published") ? { drafts_note: DRAFT_URL_NOTE } : {}),
            events: events.map((e) => ({
                id: Number(e.id),
                name: e.name,
                status: e.status,
                visibility: e.accessibility === "private" ? "private" : "public",
                ...eventDateFields(e),
                location: dedupeLocation(e.location),
                is_published: e.status === "published",
                ...(e.archived_at ? { archived: true } : {}),
                public_url: e.status === "published" ? eventPublicUrl(ctx, e.slug) : null,
                ...(e.status === "published" ? {} : { public_url_after_publish: eventPublicUrl(ctx, e.slug) }),
                tickets_sold: totals.get(Number(e.id))?.tickets || 0,
                paid_orders: totals.get(Number(e.id))?.orders || 0,
                revenue_clp: totals.get(Number(e.id))?.revenue || 0,
            })),
        };
    },
};

const getEvent: ToolDef = {
    name: "get_event",
    title: "Detalle de evento",
    description:
        "Detalle completo de un evento: estado (publicado o borrador), descripción, funciones (fechas/horas), lugares, tipos de entrada " +
        "con precio, capacidad, vendidas, disponibles y personas por entrada (people_per_ticket > 1 = mesa para N, un QR por persona), " +
        "checkout_fields (qué pide el checkout además del nombre y correo: asistentes por entrada, quién completa los datos de cada persona, " +
        "datos de empresa y preguntas al inscribirse, cada una por compra o por persona) " +
        "y links privados de vista previa. Si is_published es false, el link público " +
        "NO funciona todavía: comparte un link de vista previa (create_preview_link).",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    handler: (args, ctx) => eventDetail(ctx, args.event_id),
};

/** Diseño de la página pública (events.page_settings). Tolera que la migración aún no esté aplicada (deploy previews). */
async function loadPageSettings(ctx: ToolContext, eventId: number): Promise<EventPageSettings> {
    const { data, error } = await ctx.supabase.from("events").select("page_settings").eq("id", eventId).eq("organization_id", ctx.actor.orgId).maybeSingle();
    if (error && error.code !== "42703") throw error;
    return normalizePageSettings((data as any)?.page_settings);
}
/** Datos extra del checkout (events.checkout_fields, migración 202610300100). Sin la migración: los de siempre. */
async function loadCheckoutFields(ctx: ToolContext, eventId: number) {
    const { data, error } = await ctx.supabase.from("events").select("checkout_fields").eq("id", eventId).eq("organization_id", ctx.actor.orgId).maybeSingle();
    if (error && !["42703", "PGRST204"].includes(String(error.code || ""))) throw error;
    return normalizeCheckoutFields((data as any)?.checkout_fields);
}
const PAGE_LAYOUT_HELP = EVENT_PAGE_LAYOUTS.map((l) => `${l.value} (${l.label}: ${l.hint})`).join("; ");

/** Videos de la página (events.cover_video / gallery_video, set_event_video). Tolera la migración pendiente. */
async function loadEventVideos(ctx: ToolContext, eventId: number) {
    const { data, error } = await ctx.supabase.from("events").select("cover_video, gallery_video").eq("id", eventId).eq("organization_id", ctx.actor.orgId).maybeSingle();
    if (error && error.code !== "42703") throw error;
    return { cover_video: normalizeEventVideo((data as any)?.cover_video), gallery_video: normalizeEventVideo((data as any)?.gallery_video) };
}

/** Detalle de un evento (get_event; también la respuesta de create_event). */
async function eventDetail(ctx: ToolContext, eventId: number) {
    const event = await loadOwnedEvent<any>(ctx, eventId, `${EVENT_LIST_COLUMNS}, description`);
    const [{ data: tickets }, { data: dates }, { data: locations }, { data: tags }] = await Promise.all([
        ctx.supabase.from("event_tickets").select(TICKET_SELECT).eq("event_id", event.id).order("price", { ascending: true }),
        ctx.supabase.from("event_dates").select("id, date, start_time, end_time, event_location_id").eq("event_id", event.id).order("date", { ascending: true }),
        ctx.supabase.from("event_locations").select("id, venue_id, venues ( id, name, address_line1, city )").eq("event_id", event.id),
        ctx.supabase.from("event_tags").select("category_tags ( name )").eq("event_id", event.id),
    ]);
    const availability = await ticketAvailability(ctx, event.id, (tickets || []).map((t: any) => Number(t.id)));
    const chainOf = await ticketChainInfo(ctx, Number(event.id), tickets || [], availability);
    const previewLinks = await listPreviewLinks(Number(event.id), ctx.actor.orgId, ctx.supabase).catch(() => []);
    const pageSettings = await loadPageSettings(ctx, Number(event.id));
    const videos = await loadEventVideos(ctx, Number(event.id));
    const [checkoutFields, people] = await Promise.all([loadCheckoutFields(ctx, Number(event.id)), loadPeoplePerTicket(ctx.supabase, Number(event.id))]);
    const secret = await loadSecretLocation(ctx.supabase, Number(event.id)).catch(() => ({ address: null, revealHours: null }));
    const venueOf = new Map<string, any>();
    for (const l of locations || []) {
        const v = Array.isArray((l as any).venues) ? (l as any).venues[0] : (l as any).venues;
        venueOf.set(String(l.id), v ? { id: v.id, name: v.name, address: v.address_line1, city: v.city } : null);
    }
    const tag: any = (tags || [])[0]?.category_tags;
    const functions = (dates || []).map((d: any) => ({
        id: Number(d.id),
        date: String(d.date).slice(0, 10),
        start_time: String(d.start_time || "").slice(0, 5),
        end_time: d.end_time ? String(d.end_time).slice(0, 5) : null,
        ...(d.end_time ? {} : { end_time_note: "Sin hora de término: se estima de 3 horas (end_date)." }),
        venue: d.event_location_id ? venueOf.get(String(d.event_location_id)) || null : null,
    }));
    const warnings = [descriptionDateWarning(event.description, functions.map((f: any) => f.date))].filter(Boolean) as string[];
    return {
        event_id: Number(event.id),
        name: event.name,
        status: event.status,
        visibility: event.accessibility === "private" ? "private" : "public",
        category: (Array.isArray(tag) ? tag[0]?.name : tag?.name) || null,
        description_html: event.description,
        image_url: event.image_url,
        // Con cover_video, la página muestra el video arriba en vez de image_url (set_event_video)
        cover_video: videos.cover_video,
        gallery_video: videos.gallery_video,
        page_layout: pageSettings.layout,
        show_organizer: pageSettings.show_organizer,
        page_background: pageSettings.background,
        // Dirección que solo ven quienes compran (la página muestra el lugar y la comuna, sin la calle)
        private_address: secret.address,
        private_address_reveal_hours: secret.revealHours,
        ...eventDateFields(event),
        dates_note: DATES_NOTE,
        ...eventUrls(ctx, event),
        dashboard_url: eventDashboardUrl(ctx, Number(event.id)),
        preview_links: previewLinks.filter((l) => l.status === "active").map(({ event_id, ...l }) => l),
        functions,
        ticket_types: (tickets || []).map((t: any) => ({
            ...presentTicket(t, availability.get(Number(t.id)), event, chainOf(t.id)),
            people_per_ticket: people.get(Number(t.id)) || 1,
        })),
        checkout_fields: checkoutFields,
        courtesy_note:
            "El tipo con is_system = true (Cortesía) lo crea AI Tickets con cada evento: no se vende y sirve para emitir cortesías (issue_complimentary_tickets).",
        ...(warnings.length ? { warnings } : {}),
    };
}

const listVenues: ToolDef = {
    name: "list_venues",
    title: "Listar lugares",
    description: "Lugares (recintos) que la organización ya usó. Sirve para reutilizar un venue_id al crear eventos.",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
        const { venues } = await listOrgVenues(ctx.supabase, ctx.actor.orgId);
        return { venues: venues.map((v) => ({ venue_id: v.id, name: v.name, city: v.city })) };
    },
};

const ticketInputSchema = {
    type: "object" as const,
    required: ["name", "price"],
    additionalProperties: false,
    properties: {
        name: { type: "string" as const, minLength: 1, maxLength: 120, description: "Ej: General, VIP, Preventa 1." },
        price: { type: "integer" as const, minimum: 0, maximum: 100_000_000, description: "Precio en CLP (0 = gratis). El cargo por servicio se suma al comprador." },
        quantity: { type: "integer" as const, minimum: 0, maximum: 1_000_000, nullable: true, description: "Capacidad de este tipo. Omitir o null = sin límite." },
        sales_start: { type: "string" as const, format: "date-time", nullable: true, description: "Inicio de venta (ISO 8601). Omitir = desde que se publica." },
        sales_end: { type: "string" as const, format: "date-time", nullable: true, description: "Fin de venta (ISO 8601). Omitir = hasta el evento." },
        function_index: { type: "integer" as const, minimum: 0, nullable: true, description: "Índice (desde 0) en `functions` si la entrada es solo para esa función. Omitir = todas." },
        max_per_order: { type: "integer" as const, minimum: 1, maximum: 50, default: 10, description: "Máximo de entradas de este tipo por compra." },
    },
};

const createEvent: ToolDef = {
    name: "create_event",
    title: "Crear evento",
    description:
        "Crea un evento en BORRADOR (no visible al público) con su lugar, funciones y tipos de entrada. " +
        "La respuesta incluye preview_url: un link PRIVADO de vista previa (7 días, varios usos) para que el productor vea la página " +
        "tal como quedará; el link público no funciona hasta publicar. " +
        "Después revisa con get_event y publica con set_event_status solo cuando el productor lo confirme. " +
        "Para el lugar usa venue_id (de list_venues) o new_venue. Fechas en hora de Chile. AI Tickets agrega solo un tipo \"Cortesía\" " +
        "(is_system) para emitir cortesías: no lo incluyas en ticket_types. Usa idempotency_key para que un reintento no cree el evento dos veces. " +
        "La respuesta trae el evento completo (igual que get_event).",
    scope: "write",
    idempotent: true,
    audit: (args, result) => ({ summary: `Creó "${args.name}" (${args.ticket_types.length} tipo(s) de entrada, ${args.functions.length} función(es))`, target: `event:${(result as any).event_id}` }),
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
        type: "object",
        required: ["name", "functions", "ticket_types"],
        additionalProperties: false,
        properties: {
            name: { type: "string", minLength: 3, maxLength: 200 },
            description: { type: "string", maxLength: 20000, description: "Descripción (texto o HTML simple: p, strong, em, ul, li, a)." },
            category: { type: "string", maxLength: 80, description: "Ej: Música, Fiesta, Teatro, Conferencia, Deportes." },
            image_url: { type: "string", maxLength: 1000, pattern: "^https://", description: "Imagen de portada (https). Puedes subir una con upload_image o generate_image." },
            is_private: { type: "boolean", default: false, description: "true = solo accesible con el link." },
            venue_id: { type: "string", maxLength: 64, description: "ID de un lugar existente (list_venues)." },
            new_venue: {
                type: "object",
                required: ["name"],
                additionalProperties: false,
                properties: {
                    name: { type: "string", minLength: 1, maxLength: 200 },
                    address: { type: "string", maxLength: 300 },
                    city: { type: "string", maxLength: 120 },
                },
            },
            functions: {
                type: "array",
                minItems: 1,
                maxItems: 60,
                description: "Funciones (fecha + hora). Un evento de un día tiene una sola.",
                items: {
                    type: "object",
                    required: ["date", "start_time"],
                    additionalProperties: false,
                    properties: {
                        date: { type: "string", pattern: DATE_PATTERN, description: "YYYY-MM-DD" },
                        start_time: { type: "string", pattern: TIME_PATTERN, description: "HH:MM (24h)" },
                        end_time: { type: "string", pattern: TIME_PATTERN, description: "HH:MM (24h). Puede ser después de medianoche." },
                    },
                },
            },
            ticket_types: { type: "array", minItems: 1, maxItems: 30, items: ticketInputSchema },
        },
    },
    async handler(args, ctx) {
        if (!args.venue_id && !args.new_venue) throw new ToolError("invalid_input", "Indica venue_id (list_venues) o new_venue.");
        const fnCount = args.functions.length;
        for (const t of args.ticket_types) {
            rejectCourtesyName(t.name);
            if (t.function_index != null && t.function_index >= fnCount) {
                throw new ToolError("invalid_input", `function_index ${t.function_index} no existe (hay ${fnCount} funciones).`);
            }
        }
        const input: EventGraphInput = {
            general: { name: args.name, description: args.description, imageUrl: args.image_url || null, isPrivate: args.is_private, category: args.category },
            locations: [{
                venueId: args.venue_id || null,
                isNewVenue: !args.venue_id,
                newVenueName: args.new_venue?.name,
                newVenueAddress: args.new_venue?.address || null,
                newVenueCity: args.new_venue?.city || null,
                dates: args.functions.map((f: any, i: number) => ({ id: `f${i}`, date: f.date, startTime: f.start_time, endTime: f.end_time || null })),
            }],
            tickets: args.ticket_types.map((t: any) => ({
                name: t.name,
                price: t.price,
                quantity: t.quantity ?? null,
                initDate: t.sales_start || null,
                endDate: t.sales_end || null,
                eventDateId: t.function_index != null ? `f${t.function_index}` : null,
                maxPerOrder: t.max_per_order,
            })),
        };
        const created = await createEventGraph({ userId: ctx.actor.userId, orgId: ctx.actor.orgId }, input).catch(rethrowEventInput);
        await notifySlack(`🤖 *Nuevo evento creado vía ${channelLabel(ctx.channel)}*\n• *Nombre:* ${created.name}\n• *Link:* /eventos/${created.slug}`);
        let preview: { url: string; expires_at: string | null } | null = null;
        try {
            const p = await createPreviewLink(
                { eventId: created.id, orgId: ctx.actor.orgId, userId: ctx.actor.userId, expiresInHours: PREVIEW_DEFAULT_HOURS, via: ctx.channel, origin: ctx.origin, label: "Creado con el evento" },
                ctx.supabase,
            );
            preview = { url: p.url, expires_at: p.link.expires_at };
        } catch (err: any) {
            console.warn("create_event preview link:", err?.message);
        }
        return {
            ...(await eventDetail(ctx, Number(created.id))),
            preview_url: preview?.url ?? null,
            preview_expires_at: preview?.expires_at ?? null,
            next_steps:
                "El evento quedó en BORRADOR (no visible al público). Muestra al productor el preview_url (vista previa privada; la página " +
                "dice 'Vista previa · Evento NO publicado'). Revisa con get_event y publícalo con set_event_status cuando lo apruebe.",
        };
    },
};

const updateEvent: ToolDef = {
    name: "update_event",
    title: "Editar evento",
    description:
        "Edita datos generales de un evento (nombre, descripción, categoría, imagen, privacidad, slug de la URL, diseño de la página, fondo " +
        "animado y si se muestra el organizador). Solo cambia los campos enviados. " +
        "slug cambia el link público (/eventos/<slug>); cambiar el nombre NO cambia el slug. Si el evento está publicado o ya tiene registrados " +
        "(órdenes pagadas, entradas o invitados), el link anterior queda redirigiendo (301) al nuevo, así no se rompen los links ya " +
        "compartidos ni los QR; en un borrador sin registrados, el link anterior se libera. " +
        "private_address: dirección que solo ven quienes compran (la página pública, el mapa y los listados dicen \"Lugar secreto\" y la comuna, " +
        "sin el nombre del lugar ni la calle); va en la orden, la entrada, el correo y el recordatorio desde que se revela. " +
        "private_address_reveal_hours: 0 = el día de la función (a las 9:00; es lo que se usa si no lo indicas al poner una dirección nueva), " +
        "N = N horas antes, null = apenas compran; se manda por correo a esa hora. private_address null o \"\" la quita. " +
        "Fechas y horarios de las funciones se cambian con update_event_functions (avisa a los asistentes); el lugar, desde el panel o " +
        "update_venue. Para entradas usa las herramientas de ticket_type. Para un video de portada (en vez de la imagen) usa set_event_video. " +
        "checkout_fields cambia lo que pide el checkout además del nombre y correo de quien compra: attendee_names (nombre y correo de cada " +
        "asistente en compras de varias entradas; cada QR llega a su correo), holders (quién completa los datos de cada persona en compras de " +
        "varias entradas: buyer = quien compra en el checkout; invite = quien compra solo escribe el correo de cada invitado y cada uno " +
        "completa su nombre y sus respuestas desde el correo de su entrada; el QR sirve igual mientras tanto y list_attendees muestra " +
        "data_pending), company (RUT y razón social opcionales; el comprobante NO es boleta ni factura) y questions (preguntas al " +
        "inscribirse, cada una per order = una vez por compra o per attendee = una vez por persona; reemplaza la lista completa). " +
        "Solo cambia las claves enviadas.",
    scope: "write",
    audit: (args, result) => ({ summary: `Editó ${((result as any).updated || []).join(", ") || "el evento"}`, target: `event:${args.event_id}` }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            name: { type: "string", minLength: 3, maxLength: 200 },
            description: { type: "string", maxLength: 20000 },
            category: { type: "string", maxLength: 80 },
            image_url: { type: "string", maxLength: 1000, pattern: "^https://" },
            is_private: { type: "boolean" },
            slug: {
                type: "string",
                minLength: SLUG_MIN,
                maxLength: SLUG_MAX,
                description: "Nuevo slug de la URL pública (/eventos/<slug>): minúsculas, números y guiones. Se normaliza (tildes y espacios → guiones).",
            },
            page_layout: {
                type: "string",
                enum: EVENT_PAGE_LAYOUTS.map((l) => l.value),
                description: `Diseño de la página pública: ${PAGE_LAYOUT_HELP} Sin imagen, la página usa siempre el compacto.`,
            },
            show_organizer: { type: "boolean", description: "Mostrar \"Organiza <productora>\" bajo el título de la página pública." },
            private_address: {
                type: "string",
                maxLength: SECRET_LOCATION_MAX,
                nullable: true,
                description: "Dirección exacta que solo ven quienes compran (fiesta en casa, tocata). null o \"\" = sin dirección privada.",
            },
            private_address_reveal_hours: {
                type: "integer",
                minimum: 0,
                maximum: MAX_REVEAL_HOURS,
                nullable: true,
                description: "Cuándo se revela private_address (se manda por correo a esa hora): 0 = el día de la función, N = N horas antes, null = apenas compran.",
            },
            page_background: {
                type: "string",
                enum: EVENT_PAGE_BACKGROUNDS.map((b) => b.value),
                description: `Fondo animado muy suave de la página pública (iridiscente, tonos claros): ${EVENT_PAGE_BACKGROUNDS.map((b) => `${b.value} (${b.label})`).join(", ")}. none = sin fondo.`,
            },
            checkout_fields: {
                type: "object",
                additionalProperties: false,
                description: "Qué pide el checkout además del nombre y correo de quien compra (get_event → checkout_fields).",
                properties: {
                    attendee_names: {
                        type: "string",
                        enum: ATTENDEE_NAME_MODES,
                        description: "off = no se piden; optional = se piden y se pueden dejar en blanco; required = nombre obligatorio de cada asistente.",
                    },
                    holders: {
                        type: "string",
                        enum: HOLDER_MODES,
                        description:
                            "Quién completa los datos de cada persona (nombre y preguntas per attendee) cuando se compra más de una entrada: " +
                            "buyer = quien compra, en el checkout; invite = cada invitado desde su correo (quien compra solo escribe su correo). " +
                            "Quien compra siempre completa los suyos al comprar.",
                    },
                    company: { type: "boolean", description: "Ofrecer RUT y razón social de la empresa (opcionales, solo compras pagadas)." },
                    questions: {
                        type: "array",
                        maxItems: MAX_QUESTIONS,
                        description: "Preguntas al inscribirse (también en eventos gratis). Reemplaza la lista completa; [] = sin preguntas.",
                        items: {
                            type: "object",
                            required: ["label", "type"],
                            additionalProperties: false,
                            properties: {
                                id: { type: "string", maxLength: 40, description: "Mantén el id de una pregunta existente para no separar sus respuestas en el CSV." },
                                label: { type: "string", minLength: 1, maxLength: MAX_LABEL },
                                type: { type: "string", enum: QUESTION_TYPES, description: "text = texto corto; choice = elegir una opción; yes_no = sí o no." },
                                options: { type: "array", maxItems: MAX_OPTIONS, items: { type: "string", maxLength: 60 }, description: "Solo choice: 2 o más opciones." },
                                required: { type: "boolean", default: false },
                                per: {
                                    type: "string",
                                    enum: QUESTION_SCOPES,
                                    default: "order",
                                    description: "order = una respuesta por compra; attendee = una por persona (cada QR), p. ej. talla o restricción alimentaria.",
                                },
                            },
                        },
                    },
                },
            },
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, slug, status, organization_id");
        const patch: Record<string, unknown> = {};
        if (args.name !== undefined) {
            patch.name = args.name;
            patch.title = args.name;
        }
        if (args.description !== undefined) patch.description = sanitizeRichText(args.description);
        if (args.image_url !== undefined) patch.image_url = args.image_url;
        if (args.is_private !== undefined) patch.accessibility = args.is_private ? "private" : "public";
        const pageChange = args.page_layout !== undefined || args.show_organizer !== undefined || args.page_background !== undefined;
        const secretChange = args.private_address !== undefined || args.private_address_reveal_hours !== undefined;
        const checkoutChange = args.checkout_fields !== undefined && Object.keys(args.checkout_fields || {}).length > 0;
        if (!Object.keys(patch).length && args.category === undefined && args.slug === undefined && !pageChange && !checkoutChange && !secretChange) throw new ToolError("invalid_input", "No enviaste cambios.");
        // Datos extra del checkout: se valida antes de guardar nada (una pregunta de opciones necesita 2 o más)
        let checkoutFields: ReturnType<typeof normalizeCheckoutFields> | null = null;
        if (checkoutChange) {
            const current = await loadCheckoutFields(ctx, Number(event.id));
            const next = { ...current, ...args.checkout_fields };
            checkoutFields = normalizeCheckoutFields(next);
            if (Array.isArray(args.checkout_fields.questions) && checkoutFields.questions.length < args.checkout_fields.questions.length) {
                throw new ToolError("invalid_input", "Revisa las preguntas: cada una necesita texto y las de tipo choice, al menos 2 opciones.");
            }
        }
        // El slug primero: si choca con otro evento, no se aplica nada
        let slugChange: Awaited<ReturnType<typeof changeEventSlug>> | null = null;
        if (args.slug !== undefined) {
            try {
                slugChange = await changeEventSlug(ctx.supabase, { id: Number(event.id), slug: event.slug, organization_id: ctx.actor.orgId, status: event.status }, args.slug, { userId: ctx.actor.userId });
            } catch (err) {
                if (err instanceof EventSlugError) throw new ToolError(err.code, err.message);
                throw err;
            }
            event.slug = slugChange.new_slug;
        }
        if (Object.keys(patch).length) {
            const { error } = await ctx.supabase.from("events").update(patch).eq("id", event.id).eq("organization_id", ctx.actor.orgId);
            if (error) throw error;
        }
        if (args.category !== undefined) await syncEventCategory(Number(event.id), args.category);
        // Diseño de la página: se combina con lo guardado (se puede cambiar uno sin tocar el otro)
        let pageSettings: EventPageSettings | null = null;
        if (pageChange) {
            const current = await loadPageSettings(ctx, Number(event.id));
            pageSettings = normalizePageSettings({
                layout: args.page_layout ?? current.layout,
                show_organizer: args.show_organizer ?? current.show_organizer,
                background: args.page_background ?? current.background,
            });
            const { error } = await ctx.supabase
                .from("events")
                .update({ page_settings: isDefaultPageSettings(pageSettings) ? null : pageSettings })
                .eq("id", event.id)
                .eq("organization_id", ctx.actor.orgId);
            if (error?.code === "42703" || error?.code === "PGRST204") throw new ToolError("unavailable", "El diseño de la página aún no está disponible en este entorno.");
            if (error) throw error;
        }
        if (checkoutFields) {
            const { error } = await ctx.supabase
                .from("events")
                .update({ checkout_fields: isDefaultCheckoutFields(checkoutFields) ? null : checkoutFields })
                .eq("id", event.id)
                .eq("organization_id", ctx.actor.orgId);
            if (error?.code === "42703" || error?.code === "PGRST204") throw new ToolError("unavailable", "Los datos extra del checkout estarán disponibles después del próximo deploy.");
            if (error) throw error;
        }
        let warnings: string[] = [];
        // Dirección privada: después se recalcula events.location (los listados quedan sin la calle)
        let secret: { address: string | null; revealHours: number | null } | null = null;
        if (secretChange) {
            const current = await loadSecretLocation(ctx.supabase, Number(event.id));
            const address = args.private_address !== undefined ? args.private_address : current.address;
            if (!address && args.private_address === undefined) throw new ToolError("invalid_input", "El evento no tiene dirección privada: envía private_address.");
            // Una dirección nueva sin indicar cuándo se revela: el día del evento
            const revealHours = args.private_address_reveal_hours !== undefined ? args.private_address_reveal_hours : current.address ? undefined : DEFAULT_REVEAL_HOURS;
            const { revealSaved } = await saveSecretLocation(ctx.supabase, Number(event.id), {
                address: args.private_address,
                revealHours: address ? revealHours : null,
            });
            if (!revealSaved) warnings.push("Elegir cuándo se revela la dirección estará disponible después del próximo deploy: por ahora la ven apenas compran.");
            await refreshEventDenorm(Number(event.id));
            secret = await loadSecretLocation(ctx.supabase, Number(event.id));
        }
        if (args.description !== undefined) {
            const { data: dates } = await ctx.supabase.from("event_dates").select("date").eq("event_id", event.id);
            warnings.push(...([descriptionDateWarning(patch.description as string, (dates || []).map((d: any) => String(d.date).slice(0, 10)))].filter(Boolean) as string[]));
        }
        return {
            event_id: Number(event.id),
            updated: [
                ...Object.keys(patch).filter((k) => k !== "title"),
                ...(args.category !== undefined ? ["category"] : []),
                ...(slugChange?.changed ? ["slug"] : []),
                ...(args.page_layout !== undefined ? ["page_layout"] : []),
                ...(args.show_organizer !== undefined ? ["show_organizer"] : []),
                ...(args.page_background !== undefined ? ["page_background"] : []),
                ...(checkoutFields ? ["checkout_fields"] : []),
                ...(args.private_address !== undefined ? ["private_address"] : []),
                ...(args.private_address_reveal_hours !== undefined ? ["private_address_reveal_hours"] : []),
            ],
            ...(checkoutFields ? { checkout_fields: checkoutFields } : {}),
            ...(secret ? { private_address: secret.address, private_address_reveal_hours: secret.revealHours } : {}),
            ...(pageSettings ? { page_layout: pageSettings.layout, show_organizer: pageSettings.show_organizer, page_background: pageSettings.background } : {}),
            ...eventUrls(ctx, event),
            ...(slugChange ? { slug_change: slugChangeSummary(ctx, slugChange) } : {}),
            ...(warnings.length ? { warnings } : {}),
        };
    },
};

function slugChangeSummary(ctx: ToolContext, change: Awaited<ReturnType<typeof changeEventSlug>>) {
    const oldUrl = eventPublicUrl(ctx, change.old_slug);
    const newUrl = eventPublicUrl(ctx, change.new_slug);
    if (!change.changed) return { changed: false, slug: change.new_slug, note: "El evento ya tenía ese slug: sin cambios." };
    return {
        changed: true,
        old_slug: change.old_slug,
        new_slug: change.new_slug,
        old_url: oldUrl,
        new_url: newUrl,
        redirect_created: change.redirect_created,
        note: change.redirect_created
            ? `${change.was_published ? "El evento está publicado" : "El evento ya tiene registrados"}: ${oldUrl} redirige (301) a ${newUrl}. Los links y QR ya compartidos siguen funcionando.`
            : `El evento es un borrador sin registrados: ${oldUrl} se libera (no redirige). Si lo compartiste, actualiza esos links.`,
    };
}

const setStatus: ToolDef = {
    name: "set_event_status",
    title: "Publicar o pausar evento",
    description:
        "Publica un evento (queda a la venta; si es privado solo con el link) o lo vuelve a borrador (deja de venderse). " +
        "Acción visible al público: el servidor devuelve primero un resumen y solo la ejecuta al repetir la llamada con confirmation_token.",
    scope: "publish",
    async confirm(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, slug, status, accessibility, start_date, end_date");
        if (event.status === args.status) {
            return { message: `"${event.name}" ya está ${args.status === "published" ? "publicado" : "en borrador"}: no habrá cambios.` };
        }
        if (args.status !== "published") {
            return { message: `Volver "${event.name}" a borrador: la página deja de verse y se detiene la venta (las entradas vendidas siguen válidas).`, details: { event_id: Number(event.id) } };
        }
        const { data: tickets } = await ctx.supabase.from("event_tickets").select(TICKET_SELECT).eq("event_id", event.id).order("price", { ascending: true });
        const types = (tickets || []).map((t: any) => presentTicket(t, undefined, { status: "published" })).filter((t: any) => !t.is_system);
        const onSale = types.filter((t: any) => t.on_sale_now);
        const paused = types.filter((t: any) => t.status === "unavailable");
        const scheduled = types.filter((t: any) => !t.on_sale_now && t.status !== "unavailable");
        const isPrivate = event.accessibility === "private";
        const url = eventPublicUrl(ctx, event.slug);
        const label = (t: any) => `${t.name} ${clp(t.price)}${t.quantity != null ? ` (${t.quantity} cupos)` : ""}`;
        const warnings: string[] = [];
        if (!onSale.length) warnings.push("Ningún tipo de entrada queda a la venta al publicar: revisa pausas y ventanas de venta.");
        if (isPrivate) warnings.push("Evento PRIVADO: no aparece en el listado de AI Tickets ni en buscadores; solo entra quien tenga el link.");
        return {
            message:
                `Publicar "${event.name}" (${localDateTime(event.start_date)?.replace("T", " ") || "sin fecha"}, hora de Chile). ` +
                (isPrivate ? `Quedará PRIVADO: solo accesible con el link ${url}. ` : `Quedará PÚBLICO en ${url} y en el listado de eventos. `) +
                (onSale.length ? `A la venta: ${onSale.map(label).join(", ")}.` : "Sin entradas a la venta.") +
                (paused.length ? ` Pausados (no se venden): ${paused.map((t: any) => t.name).join(", ")}.` : "") +
                (scheduled.length ? ` Fuera de su ventana de venta: ${scheduled.map((t: any) => t.name).join(", ")}.` : ""),
            details: {
                event_id: Number(event.id),
                visibility: isPrivate ? "private" : "public",
                public_url: url,
                ...eventDateFields(event),
                on_sale: onSale.map((t: any) => ({ id: t.id, name: t.name, price: t.price, quantity: t.quantity })),
                paused: paused.map((t: any) => ({ id: t.id, name: t.name, price: t.price })),
                not_in_sales_window: scheduled.map((t: any) => ({ id: t.id, name: t.name, sales_start: t.sales_start, sales_end: t.sales_end })),
            },
            warnings,
        };
    },
    audit: (args) => ({ summary: args.status === "published" ? "Publicó el evento" : "Volvió el evento a borrador", target: `event:${args.event_id}` }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id", "status"],
        additionalProperties: false,
        properties: { event_id: eventIdSchema, status: { type: "string", enum: ["published", "draft"] } },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, slug, status, accessibility, start_date");
        const { becamePublished } = await setEventStatus(event, ctx.actor.orgId, args.status).catch(rethrowEventInput);
        if (becamePublished) {
            await notifySlack(`🚀 *Evento publicado vía ${channelLabel(ctx.channel)}*\n• *Evento:* ${event.name}\n• *Por:* ${ctx.actor.name || ctx.actor.email}\n• *Link:* ${eventPublicUrl(ctx, event.slug)}`);
        }
        return { event_id: Number(event.id), status: args.status, ...eventUrls(ctx, { slug: event.slug, status: args.status }) };
    },
};

// ---------------------------------------------------------------------------
// Vista previa privada (también de borradores)
// ---------------------------------------------------------------------------

const rethrowPreview = (err: unknown): never => {
    if (err instanceof PreviewLinkError) throw new ToolError(err.code, err.message);
    throw err;
};

const createPreviewLinkTool: ToolDef = {
    name: "create_preview_link",
    title: "Crear link de vista previa",
    description:
        "Crea un link PRIVADO para ver la página del evento aunque esté en borrador (no publicado). Quien lo abre ve la página real con un " +
        "aviso 'Vista previa · Evento NO publicado' y la compra deshabilitada; no se indexa en buscadores. " +
        "Configurable: expires_in_hours (por defecto 168 = 7 días), no_expiration=true (sin vencimiento, hasta revocarlo) y " +
        "single_use=true (solo funciona en el primer navegador que lo abre). La URL se entrega solo esta vez: muéstrala al productor.",
    scope: "write",
    audit: (args, result) => ({
        summary: `Link de vista previa${args.label ? ` para ${args.label}` : ""} (${args.no_expiration ? "sin vencimiento" : `${args.expires_in_hours} h`}${args.single_use ? ", un uso" : ""})`,
        target: `preview_link:${(result as any).link?.id ?? ""}`,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            expires_in_hours: { type: "integer", minimum: 1, maximum: 8760, default: PREVIEW_DEFAULT_HOURS, description: "Horas de validez (1 a 8760). Se ignora si no_expiration=true." },
            no_expiration: { type: "boolean", default: false, description: "true = el link no vence (hasta revocarlo con revoke_preview_link)." },
            single_use: { type: "boolean", default: false, description: "true = de un solo uso: queda atado al primer navegador que lo abre." },
            label: { type: "string", maxLength: 80, description: "Para quién es (ej: 'Artista', 'Socio'). Se ve en el panel." },
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, slug, status");
        const created = await createPreviewLink(
            {
                eventId: Number(event.id),
                orgId: ctx.actor.orgId,
                userId: ctx.actor.userId,
                expiresInHours: args.no_expiration ? null : args.expires_in_hours,
                singleUse: args.single_use,
                label: args.label || null,
                via: ctx.channel,
                origin: ctx.origin,
            },
            ctx.supabase,
        ).catch(rethrowPreview);
        return {
            event_id: Number(event.id),
            preview_url: created.url,
            link: created.link,
            event_status: event.status,
            ...eventUrls(ctx, event),
            note:
                event.status === "published"
                    ? "El evento ya está publicado: el link público también funciona."
                    : "Evento en BORRADOR: este link privado es la única forma de verlo. La página muestra el aviso de vista previa y no permite comprar.",
        };
    },
};

const listPreviewLinksTool: ToolDef = {
    name: "list_preview_links",
    title: "Listar links de vista previa",
    description: "Links privados de vista previa de un evento con su estado (active, expired, revoked, used), visitas y vencimiento. No incluye la URL (solo se entrega al crearla).",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
        const links = await listPreviewLinks(Number(event.id), ctx.actor.orgId, ctx.supabase);
        return { event_id: Number(event.id), links };
    },
};

const revokePreviewLinkTool: ToolDef = {
    name: "revoke_preview_link",
    title: "Revocar link de vista previa",
    description: "Desactiva un link de vista previa (link_id de list_preview_links o create_preview_link). Quien lo tenga ya no podrá abrirlo.",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["link_id"],
        additionalProperties: false,
        properties: { link_id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$", description: "ID del link (uuid)." } },
    },
    audit: (args) => ({ summary: "Revocó un link de vista previa", target: `preview_link:${args.link_id}` }),
    async handler(args, ctx) {
        const ok = await revokePreviewLink(args.link_id, ctx.actor.orgId, ctx.supabase);
        if (!ok) throw new ToolError("not_found", "Link de vista previa no encontrado en tu organización.");
        // event_id para la bitácora (filtro por evento en list_audit_log)
        const { data: link } = await ctx.supabase.from("aitickets_event_preview_links").select("event_id").eq("id", args.link_id).eq("organization_id", ctx.actor.orgId).maybeSingle();
        return { link_id: args.link_id, status: "revoked", ...(link?.event_id ? { event_id: Number(link.event_id) } : {}) };
    },
};

export const eventTools: ToolDef[] = [
    getAccount, listEvents, getEvent, listVenues, createEvent, updateEvent, setStatus,
    createPreviewLinkTool, listPreviewLinksTool, revokePreviewLinkTool,
];
