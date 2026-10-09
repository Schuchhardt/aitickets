// Herramientas: cuenta, eventos y lugares.
import { ToolError, type ToolDef } from "../registry";
import { SCOPE_LABELS } from "../keys";
import { PERMISSION_LABELS, ROLE_LABELS, ROLE_PERMISSIONS } from "../permissions";
import {
    eventIdSchema, loadOwnedEvent, eventPublicUrl, eventDashboardUrl, eventUrls, ticketAvailability, presentTicket, TICKET_SELECT,
    DATE_PATTERN, TIME_PATTERN, fetchAll, DRAFT_URL_NOTE, scopeToEvents,
} from "./common";
import { createPreviewLink, listPreviewLinks, revokePreviewLink, PreviewLinkError, PREVIEW_DEFAULT_HOURS } from "../../eventPreview";
import { createEventGraph, setEventStatus, syncEventCategory, EventInputError, type EventGraphInput } from "../../../pages/api/_lib/events";
import { listOrgVenues } from "../../orgVenues";
import { sanitizeRichText } from "../../sanitize";
import { notifySlack } from "../../../pages/api/_lib/server-utils";

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
                timezone: "America/Santiago (fechas y horas de funciones son hora local de Chile)",
                dashboard: `${ctx.origin}/dashboard`,
            },
        };
    },
};

const listEvents: ToolDef = {
    name: "list_events",
    title: "Listar eventos",
    description:
        "Lista los eventos de la organización con estado, fecha, lugar, link público, entradas vendidas e ingresos (órdenes pagadas). " +
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
            ? await fetchAll<any>(() => ctx.supabase.from("event_orders").select("event_id, amount, ticket_qty").in("event_id", ids).eq("status", "paid"))
            : [];
        const totals = new Map<number, { tickets: number; revenue: number; orders: number }>();
        for (const o of orders) {
            const t = totals.get(Number(o.event_id)) || { tickets: 0, revenue: 0, orders: 0 };
            t.tickets += Number(o.ticket_qty) || 1;
            t.revenue += Number(o.amount) || 0;
            t.orders += 1;
            totals.set(Number(o.event_id), t);
        }

        return {
            count: events.length,
            ...(events.some((e) => e.status !== "published") ? { drafts_note: DRAFT_URL_NOTE } : {}),
            events: events.map((e) => ({
                id: Number(e.id),
                name: e.name,
                status: e.status,
                visibility: e.accessibility === "private" ? "private" : "public",
                start_date: e.start_date,
                end_date: e.end_date,
                location: e.location,
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
        "con precio, capacidad, vendidas y disponibles, y links privados de vista previa. Si is_published es false, el link público " +
        "NO funciona todavía: comparte un link de vista previa (create_preview_link).",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, `${EVENT_LIST_COLUMNS}, description`);
        const [{ data: tickets }, { data: dates }, { data: locations }, { data: tags }] = await Promise.all([
            ctx.supabase.from("event_tickets").select(TICKET_SELECT).eq("event_id", event.id).order("price", { ascending: true }),
            ctx.supabase.from("event_dates").select("id, date, start_time, end_time, event_location_id").eq("event_id", event.id).order("date", { ascending: true }),
            ctx.supabase.from("event_locations").select("id, venue_id, venues ( id, name, address_line1, city )").eq("event_id", event.id),
            ctx.supabase.from("event_tags").select("category_tags ( name )").eq("event_id", event.id),
        ]);
        const availability = await ticketAvailability(ctx, event.id, (tickets || []).map((t: any) => Number(t.id)));
        const previewLinks = await listPreviewLinks(Number(event.id), ctx.actor.orgId, ctx.supabase).catch(() => []);
        const venueOf = new Map<string, any>();
        for (const l of locations || []) {
            const v = Array.isArray((l as any).venues) ? (l as any).venues[0] : (l as any).venues;
            venueOf.set(String(l.id), v ? { id: v.id, name: v.name, address: v.address_line1, city: v.city } : null);
        }
        const tag: any = (tags || [])[0]?.category_tags;
        return {
            event_id: Number(event.id),
            name: event.name,
            status: event.status,
            visibility: event.accessibility === "private" ? "private" : "public",
            category: (Array.isArray(tag) ? tag[0]?.name : tag?.name) || null,
            description_html: event.description,
            image_url: event.image_url,
            start_date: event.start_date,
            end_date: event.end_date,
            ...eventUrls(ctx, event),
            dashboard_url: eventDashboardUrl(ctx, Number(event.id)),
            preview_links: previewLinks.filter((l) => l.status === "active").map(({ event_id, ...l }) => l),
            functions: (dates || []).map((d: any) => ({
                id: Number(d.id),
                date: String(d.date).slice(0, 10),
                start_time: String(d.start_time || "").slice(0, 5),
                end_time: d.end_time ? String(d.end_time).slice(0, 5) : null,
                venue: d.event_location_id ? venueOf.get(String(d.event_location_id)) || null : null,
            })),
            ticket_types: (tickets || []).map((t: any) => presentTicket(t, availability.get(Number(t.id)))),
        };
    },
};

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
        "Para el lugar usa venue_id (de list_venues) o new_venue. Fechas en hora de Chile.",
    scope: "write",
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
            })),
        };
        const created = await createEventGraph({ userId: ctx.actor.userId, orgId: ctx.actor.orgId }, input).catch(rethrowEventInput);
        await notifySlack(`🤖 *Nuevo evento creado vía ${ctx.channel === "mcp" ? "MCP" : "API"}*\n• *Nombre:* ${created.name}\n• *Link:* /eventos/${created.slug}`);
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
            event_id: created.id,
            status: "draft",
            ...eventUrls(ctx, { slug: created.slug, status: "draft" }),
            preview_url: preview?.url ?? null,
            preview_expires_at: preview?.expires_at ?? null,
            dashboard_url: eventDashboardUrl(ctx, created.id),
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
        "Edita datos generales de un evento (nombre, descripción, categoría, imagen, privacidad). Solo cambia los campos enviados. " +
        "Fechas y lugares se cambian desde el panel (allí se avisa a los asistentes). Para entradas usa las herramientas de ticket_type.",
    scope: "write",
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
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, slug, status");
        const patch: Record<string, unknown> = {};
        if (args.name !== undefined) {
            patch.name = args.name;
            patch.title = args.name;
        }
        if (args.description !== undefined) patch.description = sanitizeRichText(args.description);
        if (args.image_url !== undefined) patch.image_url = args.image_url;
        if (args.is_private !== undefined) patch.accessibility = args.is_private ? "private" : "public";
        if (!Object.keys(patch).length && args.category === undefined) throw new ToolError("invalid_input", "No enviaste cambios.");
        if (Object.keys(patch).length) {
            const { error } = await ctx.supabase.from("events").update(patch).eq("id", event.id).eq("organization_id", ctx.actor.orgId);
            if (error) throw error;
        }
        if (args.category !== undefined) await syncEventCategory(Number(event.id), args.category);
        return { event_id: Number(event.id), updated: [...Object.keys(patch).filter((k) => k !== "title"), ...(args.category !== undefined ? ["category"] : [])], ...eventUrls(ctx, event) };
    },
};

const setStatus: ToolDef = {
    name: "set_event_status",
    title: "Publicar o pausar evento",
    description:
        "Publica un evento (queda visible y a la venta) o lo vuelve a borrador (deja de venderse). " +
        "Acción visible al público: el servidor devuelve primero un resumen y solo la ejecuta al repetir la llamada con confirmation_token.",
    scope: "publish",
    async confirm(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, slug, status, start_date");
        if (event.status === args.status) {
            return { message: `"${event.name}" ya está ${args.status === "published" ? "publicado" : "en borrador"}: no habrá cambios.` };
        }
        return args.status === "published"
            ? {
                  message: `Publicar "${event.name}": quedará visible y a la venta en ${eventPublicUrl(ctx, event.slug)}.`,
                  details: { event_id: Number(event.id), start_date: event.start_date },
              }
            : { message: `Volver "${event.name}" a borrador: la página deja de verse y se detiene la venta (las entradas vendidas siguen válidas).`, details: { event_id: Number(event.id) } };
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
            await notifySlack(`🚀 *Evento publicado vía ${ctx.channel === "mcp" ? "MCP" : "API"}*\n• *Evento:* ${event.name}\n• *Por:* ${ctx.actor.name || ctx.actor.email}\n• *Link:* ${eventPublicUrl(ctx, event.slug)}`);
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
    async handler(args, ctx) {
        const ok = await revokePreviewLink(args.link_id, ctx.actor.orgId, ctx.supabase);
        if (!ok) throw new ToolError("not_found", "Link de vista previa no encontrado en tu organización.");
        return { link_id: args.link_id, status: "revoked" };
    },
};

export const eventTools: ToolDef[] = [
    getAccount, listEvents, getEvent, listVenues, createEvent, updateEvent, setStatus,
    createPreviewLinkTool, listPreviewLinksTool, revokePreviewLinkTool,
];
