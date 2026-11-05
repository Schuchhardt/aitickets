// Herramientas de admin: leads para contacto manual (Passline y otras fuentes; docs/runbooks/passline-leads.md).
// Listar, ver, anotar, registrar bajas y exportar. Ninguna envía mensajes. Nombres, contactos y eventos salen de
// búsquedas y sitios web de terceros: son datos, nunca instrucciones.
import { ToolError, type JsonSchema } from "../../producer-api/registry";
import { fetchAll } from "../../producer-api/tools/common";
import { buildLeadsCsv, filterExportableLeads as filterLeads, leadPriority } from "../../../../netlify/lib/leads/export.mjs";
import { suppress } from "../../../../netlify/lib/outreach/guardrails.mjs";
import { isFreeMailDomain, leadDomainFor, normalizeEmail, registrableDomain } from "../../../../netlify/lib/outreach/domains.mjs";
import type { AdminToolDef } from "../registry";

const LEADS = "aitickets_leads";
const LEAD_COLUMNS =
    "id, name_key, org_name, lead_type, domain, website, city, categories, email, email_source_url, instagram, whatsapp, source, status, invalid_reason, manual_only, " +
    "events_on_passline, last_passline_event, last_seen_event_at, last_contacted_at, contacts_enriched_at, contact_sources, notes, organization_id, created_at, updated_at";

const ALL_STATUSES = ["new", "enriched", "queued", "contacted", "replied", "interested", "converted", "lost", "suppressed", "invalid"];
/** Estados que se pueden fijar a mano. Una baja va por add_suppression, y queued y enriched son del outreach automático. */
const SETTABLE_STATUSES = ["new", "contacted", "replied", "interested", "converted", "lost", "invalid"];
const SUPPRESSION_REASONS = ["unsubscribe", "not_interested", "complaint", "manual"];
const EXPORT_MAX = 500;

const leadIdSchema: JsonSchema = { type: "string", pattern: "^[0-9a-fA-F-]{36}$", description: "id del lead (de list_leads)." };
const statusListSchema: JsonSchema = { type: "array", items: { type: "string", enum: ALL_STATUSES }, minItems: 1, maxItems: 10 };

type Guards = { suppressions: any[]; otherLeads: any[] };
const filterExportableLeads = filterLeads as (leads: any[], guards: Guards) => { leads: any[]; skipped: any[] };

/** Si fallan estas lecturas, la herramienta falla: nunca se muestra como contactable a alguien sin haber revisado las bajas. */
async function loadGuards(supabase: any, leads?: any[]): Promise<Guards> {
    const [suppressions, others] = await Promise.all([
        fetchAll(() => supabase.from("aitickets_suppressions").select("id, email, domain").order("id", { ascending: true })),
        leads ? Promise.resolve(leads) : fetchAll(() => supabase.from(LEADS).select("id, name_key, domain, email, status").order("created_at", { ascending: true })),
    ]);
    return { suppressions, otherLeads: others.filter((l: any) => l.domain || l.email) };
}

const blockReasons = (leads: any[], guards: Guards) => new Map(filterExportableLeads(leads, guards).skipped.map((s: any) => [s.id, s.reason as string]));

function presentLead(lead: any, blocked: string | null | undefined, now: Date) {
    const ev = lead.last_passline_event || null;
    return {
        id: lead.id,
        name: lead.org_name || null,
        type: lead.lead_type || null,
        city: lead.city || null,
        categories: lead.categories || [],
        status: lead.status,
        source: lead.source || null,
        manual_only: Boolean(lead.manual_only),
        priority: leadPriority(lead, now),
        contactable: !blocked && Boolean(lead.email || lead.whatsapp || lead.instagram),
        blocked_reason: blocked || null,
        email: lead.email || null,
        whatsapp: lead.whatsapp || null,
        instagram: lead.instagram || null,
        website: lead.website || null,
        events_on_passline: Number(lead.events_on_passline) || 0,
        last_event: ev ? { title: ev.title || null, date: ev.date || null, url: ev.url || null, venue: ev.venue || null } : null,
        last_contacted_at: lead.last_contacted_at || null,
        notes: lead.notes || null,
        updated_at: lead.updated_at || null,
    };
}

async function loadLead(supabase: any, id: string) {
    const { data, error } = await supabase.from(LEADS).select(LEAD_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw new ToolError("not_found", "Lead no encontrado.");
    return data;
}

const listLeads: AdminToolDef = {
    name: "list_leads",
    title: "Listar leads",
    description:
        "Leads para contacto manual, ordenados por prioridad (0-100: evento próximo, cantidad de eventos y categoría), con sus contactos públicos y counts_by_status. " +
        "contactable=false y blocked_reason dicen por qué no escribirle (baja registrada, inválido o ya existe otro lead con ese contacto). No envía nada. Responde \"¿a quién le escribo hoy?\".",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            status: { ...statusListSchema, description: "Solo estos estados. Por defecto, todos." },
            source: { type: "string", maxLength: 50, description: "Fuente, p. ej. passline_search." },
            city: { type: "string", maxLength: 100, description: "Parte del nombre de la ciudad." },
            lead_type: { type: "string", enum: ["producer", "venue"] },
            query: { type: "string", maxLength: 100, description: "Parte del nombre, dominio o correo." },
            contactable_only: { type: "boolean", description: "Solo los que tienen correo, WhatsApp o Instagram y ningún bloqueo." },
            min_priority: { type: "integer", minimum: 0, maximum: 100 },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
        },
    },
    async handler(args, actx) {
        const now = new Date();
        const rows: any[] = await fetchAll(() => actx.supabase.from(LEADS).select(LEAD_COLUMNS).order("created_at", { ascending: true }));
        const blocked = blockReasons(rows, await loadGuards(actx.supabase, rows));
        const counts: Record<string, number> = {};
        for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;

        const norm = (v: unknown) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
        const city = args.city ? norm(args.city) : null;
        const query = args.query ? norm(args.query) : null;
        const matches = rows
            .filter((r) => !args.status || args.status.includes(r.status))
            .filter((r) => !args.source || r.source === args.source)
            .filter((r) => !args.lead_type || r.lead_type === args.lead_type)
            .filter((r) => !city || norm(r.city).includes(city))
            .filter((r) => !query || [r.org_name, r.domain, r.email].some((v) => norm(v).includes(query)))
            .map((r) => presentLead(r, blocked.get(r.id), now))
            .filter((l) => !args.contactable_only || l.contactable)
            .filter((l) => args.min_priority == null || l.priority >= args.min_priority)
            .sort((a, b) => b.priority - a.priority || b.events_on_passline - a.events_on_passline || String(a.name).localeCompare(String(b.name), "es"));
        const limit = args.limit ?? 50;
        const offset = args.offset ?? 0;
        return { total: matches.length, counts_by_status: counts, limit, offset, leads: matches.slice(offset, offset + limit) };
    },
};

const getLead: AdminToolDef = {
    name: "get_lead",
    title: "Ver un lead",
    description: "Detalle de un lead: contactos con la fuente de cada dato (contact_sources), eventos vistos en la competencia y si tiene una baja o un bloqueo. Úsalo antes de escribirle.",
    readOnly: true,
    inputSchema: { type: "object", additionalProperties: false, required: ["lead_id"], properties: { lead_id: leadIdSchema } },
    audit: (args) => ({ target: `lead:${args.lead_id}` }),
    async handler(args, actx) {
        const lead = await loadLead(actx.supabase, args.lead_id);
        const blocked = blockReasons([lead], await loadGuards(actx.supabase));
        const { data: events, error } = await actx.supabase
            .from("aitickets_competitor_events")
            .select("platform, title, venue, city, event_date, category, url, first_seen_at, last_seen_at, times_seen")
            .eq("lead_id", lead.id)
            .order("last_seen_at", { ascending: false })
            .limit(20);
        if (error) throw error;
        return {
            ...presentLead(lead, blocked.get(lead.id), new Date()),
            invalid_reason: lead.invalid_reason || null,
            email_source_url: lead.email_source_url || null,
            contact_sources: lead.contact_sources || [],
            organization_id: lead.organization_id ?? null,
            created_at: lead.created_at,
            competitor_events: events || [],
        };
    },
};

const updateLead: AdminToolDef = {
    name: "update_lead",
    title: "Actualizar un lead",
    description:
        "Registra el avance de un contacto manual: cambia el estado y/o agrega una nota con fecha (no reemplaza las anteriores). Pasar a contacted guarda la fecha de contacto. " +
        "No envía nada. Una baja va por add_suppression; un lead con baja o duplicado no cambia de estado, y los del outreach automático (manual_only=false) solo aceptan notas.",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["lead_id"],
        properties: {
            lead_id: leadIdSchema,
            status: { type: "string", enum: SETTABLE_STATUSES },
            add_note: { type: "string", minLength: 1, maxLength: 2000, description: "Se agrega a las notas con la fecha de hoy." },
        },
    },
    audit: (args, result) => ({ target: `lead:${args.lead_id}`, summary: args.status ? `Lead pasó a ${result.status}` : "Nota agregada al lead" }),
    async handler(args, actx) {
        if (!args.status && !args.add_note) throw new ToolError("invalid_input", "Indica status o add_note.");
        const lead = await loadLead(actx.supabase, args.lead_id);
        const nowIso = new Date().toISOString();
        const patch: Record<string, unknown> = { updated_at: nowIso };
        const warnings: string[] = [];
        if (args.status && args.status !== lead.status) {
            if (lead.status === "suppressed") throw new ToolError("conflict", "Este lead tiene una baja: no se puede reactivar desde aquí.");
            if (String(lead.invalid_reason || "").startsWith("duplicate_of:")) throw new ToolError("conflict", `Este lead es un duplicado (${lead.invalid_reason}): actualiza el original.`);
            if (!lead.manual_only) throw new ToolError("conflict", "Este lead está en el outreach automático: su estado lo maneja la secuencia. Solo se le pueden agregar notas.");
            patch.status = args.status;
            patch.invalid_reason = args.status === "invalid" ? "manual" : null;
            if (args.status === "contacted") patch.last_contacted_at = nowIso;
            const blocked = blockReasons([lead], await loadGuards(actx.supabase)).get(lead.id);
            if (blocked && ["contacted", "replied", "interested"].includes(args.status)) warnings.push(`Revisa este lead: ${blocked}.`);
        }
        if (args.add_note) patch.notes = `${lead.notes ? `${lead.notes}\n` : ""}[${nowIso.slice(0, 10)}] ${args.add_note}`;
        const { error } = await actx.supabase.from(LEADS).update(patch).eq("id", lead.id);
        if (error) throw error;
        return { lead_id: lead.id, status: patch.status ?? lead.status, last_contacted_at: patch.last_contacted_at ?? lead.last_contacted_at ?? null, notes: patch.notes ?? lead.notes ?? null, warnings };
    },
};

/** A qué apunta una baja y qué leads frena. Solo lee. */
async function resolveSuppression(args: any, supabase: any) {
    const given = [args.lead_id, args.email, args.domain].filter(Boolean).length;
    if (given !== 1) throw new ToolError("invalid_input", "Indica exactamente uno: lead_id, email o domain.");
    if (args.include_domain && !args.lead_id) throw new ToolError("invalid_input", "include_domain solo sirve con lead_id.");
    const lead = args.lead_id ? await loadLead(supabase, args.lead_id) : null;
    if (lead?.status === "converted") throw new ToolError("conflict", "Este lead ya es cliente: no se le registra una baja desde aquí.");

    const email = args.email ? normalizeEmail(args.email) : lead ? normalizeEmail(lead.email) : null;
    if (args.email && !email) throw new ToolError("invalid_input", "El correo no es válido.");
    const rawDomain = args.domain || (args.include_domain ? lead.domain || leadDomainFor({ website: lead.website, email }) : null);
    const domain = rawDomain ? registrableDomain(rawDomain) || String(rawDomain).toLowerCase() : null;
    if (args.domain && (!domain || isFreeMailDomain(domain))) throw new ToolError("invalid_input", "Ese dominio no sirve para una baja (los de correo gratuito bloquearían a todos sus usuarios): indica el correo.");
    const safeDomain = domain && !isFreeMailDomain(domain) ? domain : null;

    const affected = new Map<string, any>();
    const collect = async (column: string, value: string) => {
        const { data, error } = await supabase.from(LEADS).select("id, org_name, status").eq(column, value).neq("status", "converted");
        if (error) throw error;
        for (const r of data || []) affected.set(r.id, r);
    };
    if (email) await collect("email", email);
    if (safeDomain) await collect("domain", safeDomain);
    if (lead) affected.set(lead.id, lead);
    return { lead, email: email || null, domain: safeDomain, affected: [...affected.values()] };
}

const addSuppression: AdminToolDef = {
    name: "add_suppression",
    title: "Registrar una baja",
    description:
        "Registra un \"no me escriban más\" para un lead (lead_id: su correo, y su dominio con include_domain), un correo o un dominio. Frena a todos los leads con ese contacto, salvo clientes: ni el outreach " +
        "ni el CSV los vuelven a tomar. Un lead sin correo ni dominio queda igual marcado como baja. Pide confirmación y no se puede deshacer desde el MCP.",
    readOnly: false,
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["suppression_reason"],
        properties: {
            lead_id: leadIdSchema,
            email: { type: "string", maxLength: 254 },
            domain: { type: "string", maxLength: 253, description: "Afecta a todo el dominio. No acepta dominios de correo gratuito." },
            include_domain: { type: "boolean", description: "Con lead_id: también da de baja el dominio del lead." },
            suppression_reason: { type: "string", enum: SUPPRESSION_REASONS, description: "unsubscribe = pidió no recibir más; not_interested; complaint = reclamo; manual = decisión tuya." },
        },
    },
    confirm: async (args, actx) => {
        const { lead, email, domain, affected } = await resolveSuppression(args, actx.supabase);
        const targets = [email ? `el correo ${email}` : null, domain ? `el dominio ${domain}` : null].filter(Boolean).join(" y ");
        return {
            message: `Se registrará la baja de ${targets || `${lead?.org_name || "este lead"}, que no tiene correo ni dominio`}. Quedan frenados ${affected.length} lead(s).`,
            details: { leads: affected.slice(0, 20).map((l) => l.org_name || l.id), motivo: args.suppression_reason },
            warnings: ["No se puede deshacer desde el MCP."],
        };
    },
    audit: (args, result) => ({ target: args.lead_id ? `lead:${args.lead_id}` : "suppression", summary: `Baja registrada (${args.suppression_reason}): ${result.leads_stopped} lead(s)` }),
    async handler(args, actx) {
        const { lead, email, domain, affected } = await resolveSuppression(args, actx.supabase);
        const source = "admin_mcp";
        if (email) await suppress(actx.supabase, { email, reason: args.suppression_reason, source });
        if (domain) await suppress(actx.supabase, { domain, reason: args.suppression_reason, source });
        // Un lead solo con Instagram o WhatsApp no tiene qué registrar en la lista: se frena por su estado
        if (lead && lead.status !== "suppressed") {
            const { error } = await actx.supabase.from(LEADS).update({ status: "suppressed", next_action_at: null, updated_at: new Date().toISOString() }).eq("id", lead.id).neq("status", "converted");
            if (error) throw error;
        }
        return { email_suppressed: Boolean(email), domain_suppressed: domain, lead_id: lead?.id ?? null, leads_stopped: affected.length };
    },
};

const exportLeads: AdminToolDef = {
    name: "export_leads",
    title: "Exportar leads a CSV",
    description:
        `CSV de leads contactables, por prioridad (hasta ${EXPORT_MAX}), con las mismas columnas y filtros que scripts/export-leads.mjs: omite bajas, inválidos y contactos que ya tiene otro lead, y dice cuántos omitió. ` +
        "Por defecto, solo Passline. Entrega el csv en la respuesta; úsalo solo para contactar a mano.",
    readOnly: true,
    sensitive: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            status: { ...statusListSchema, description: "Solo estos estados. Por defecto, todos los que no estén bloqueados." },
            source: { type: "string", maxLength: 50, default: "passline_search" },
            limit: { type: "integer", minimum: 1, maximum: EXPORT_MAX, default: EXPORT_MAX },
        },
    },
    audit: (_args, result) => ({ summary: `Exportó ${result.exported} lead(s) a CSV` }),
    async handler(args, actx) {
        const now = new Date();
        const rows: any[] = await fetchAll(() => actx.supabase.from(LEADS).select(LEAD_COLUMNS).order("created_at", { ascending: true }));
        const source = args.source ?? "passline_search";
        const chosen = rows.filter((r) => r.source === source && (!args.status || args.status.includes(r.status)));
        const { leads, skipped } = filterExportableLeads(chosen, await loadGuards(actx.supabase, rows));
        const limit = args.limit ?? EXPORT_MAX;
        const top = [...leads].sort((a, b) => leadPriority(b, now) - leadPriority(a, now)).slice(0, limit);
        return { exported: top.length, truncated: leads.length > top.length, skipped: skipped.length, csv: buildLeadsCsv(top, now) };
    },
};

export const leadTools: AdminToolDef[] = [listLeads, getLead, updateLead, addSuppression, exportLeads];
