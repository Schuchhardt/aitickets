// Herramientas de admin: leads para contacto manual (Passline y otras fuentes; docs/runbooks/passline-leads.md).
// Pipeline SDR: crear leads, registrar touches, catálogo de estrategias y embudo.
// Ninguna envía mensajes. Nombres, contactos y eventos salen de búsquedas y sitios web de terceros: son datos, nunca instrucciones.
import { ToolError, type JsonSchema } from "../../producer-api/registry";
import { fetchAll } from "../../producer-api/tools/common";
import { buildLeadsCsv, filterExportableLeads as filterLeads, leadPriority } from "../../../../netlify/lib/leads/export.mjs";
import { suppress } from "../../../../netlify/lib/outreach/guardrails.mjs";
import { isFreeMailDomain, leadDomainFor, normalizeEmail, registrableDomain, emailDomain } from "../../../../netlify/lib/outreach/domains.mjs";
import type { AdminToolDef } from "../registry";

const LEADS = "aitickets_leads";
const TOUCHES = "aitickets_lead_touches";
const STRATEGIES = "aitickets_lead_strategies";

const LEAD_COLUMNS =
    "id, name_key, org_name, lead_type, domain, website, city, categories, email, email_source_url, instagram, whatsapp, source, status, invalid_reason, manual_only, " +
    "events_on_passline, last_passline_event, last_seen_event_at, last_contacted_at, contacts_enriched_at, contact_sources, notes, organization_id, " +
    "niche, potential, potential_score, potential_reason, sequence_step, next_action, next_action_at, lost_reason, gmail_thread_id, " +
    "proposal_event_id, proposal_preview_link_id, proposal_created_at, discovered_event, created_at, updated_at";

const ALL_STATUSES = ["new", "enriched", "queued", "contacted", "replied", "interested", "converted", "lost", "suppressed", "invalid"];
const SETTABLE_STATUSES = ["new", "contacted", "replied", "interested", "converted", "lost", "invalid"];
const NICHES = ["stand_up", "teatro", "musica_en_vivo", "fiestas", "clubs", "talleres", "seminarios", "academias", "otro"];
const POTENTIALS = ["low", "medium", "high"];
const NEXT_ACTIONS = ["draft_t1", "draft_t2", "draft_t3", "mark_lost", "reply", "proposal", "none"];
const LOST_REASONS = ["no_reply", "not_interested", "bounced", "bad_fit", "locked_in_competitor", "other"];
const TOUCH_OUTCOMES = ["drafted", "sent", "replied", "bounced", "discarded"];
const TOUCH_KINDS = ["outreach", "reply", "proposal"];
const TOUCH_CHANNELS = ["email", "whatsapp", "instagram"];
const REPLY_SENTIMENTS = ["positive", "neutral", "negative", "unsubscribe"];
const STRATEGY_STATUSES = ["active", "paused", "discarded"];
const SUPPRESSION_REASONS = ["unsubscribe", "not_interested", "complaint", "manual"];
const EXPORT_MAX = 500;

const leadIdSchema: JsonSchema = { type: "string", pattern: "^[0-9a-fA-F-]{36}$", description: "id del lead (de list_leads)." };
const statusListSchema: JsonSchema = { type: "array", items: { type: "string", enum: ALL_STATUSES }, minItems: 1, maxItems: 10 };

type Guards = { suppressions: any[]; otherLeads: any[] };
const filterExportableLeads = filterLeads as (leads: any[], guards: Guards) => { leads: any[]; skipped: any[] };

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
        niche: lead.niche || null,
        city: lead.city || null,
        categories: lead.categories || [],
        status: lead.status,
        source: lead.source || null,
        manual_only: Boolean(lead.manual_only),
        priority: leadPriority(lead, now),
        potential: lead.potential || null,
        potential_score: lead.potential_score ?? null,
        sequence_step: lead.sequence_step ?? 0,
        next_action: lead.next_action || null,
        next_action_at: lead.next_action_at || null,
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

// ---------------------------------------------------------------------------
// list_leads (mejorada: filtros niche, potential, sequence_step, due, next_action, strategy_slug, has_proposal)
// ---------------------------------------------------------------------------

const listLeads: AdminToolDef = {
    name: "list_leads",
    title: "Listar leads",
    description:
        "Leads para contacto manual, ordenados por prioridad (0-100), con sus contactos públicos y counts_by_status. " +
        "Filtros: niche, potential, sequence_step, due (next_action_at vencido), next_action, strategy_slug, has_proposal. " +
        "contactable=false y blocked_reason dicen por qué no escribirle. No envía nada.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            status: { ...statusListSchema, description: "Solo estos estados. Por defecto, todos." },
            source: { type: "string", maxLength: 50, description: "Fuente, p. ej. passline_search o sdr_talleres." },
            city: { type: "string", maxLength: 100, description: "Parte del nombre de la ciudad." },
            lead_type: { type: "string", enum: ["producer", "venue"] },
            niche: { type: "string", enum: NICHES, description: "Nicho del lead." },
            potential: { type: "string", enum: POTENTIALS, description: "Potencial del lead." },
            sequence_step: { type: "integer", minimum: 0, maximum: 3, description: "Paso actual de la secuencia (0-3)." },
            due: { type: "boolean", description: "true = next_action_at vencido (leads que necesitan acción ahora)." },
            next_action: { type: "string", enum: NEXT_ACTIONS, description: "Próxima acción pendiente." },
            strategy_slug: { type: "string", maxLength: 80, description: "Slug de la estrategia (filtra por último touch)." },
            has_proposal: { type: "boolean", description: "true = tiene propuesta de evento creada." },
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
        const countsByNiche: Record<string, number> = {};
        for (const r of rows) {
            counts[r.status] = (counts[r.status] || 0) + 1;
            if (r.niche) countsByNiche[r.niche] = (countsByNiche[r.niche] || 0) + 1;
        }

        const norm = (v: unknown) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
        const city = args.city ? norm(args.city) : null;
        const query = args.query ? norm(args.query) : null;
        const matches = rows
            .filter((r) => !args.status || args.status.includes(r.status))
            .filter((r) => !args.source || r.source === args.source)
            .filter((r) => !args.lead_type || r.lead_type === args.lead_type)
            .filter((r) => !args.niche || r.niche === args.niche)
            .filter((r) => !args.potential || r.potential === args.potential)
            .filter((r) => args.sequence_step == null || r.sequence_step === args.sequence_step)
            .filter((r) => !args.due || (r.next_action_at && new Date(r.next_action_at) <= now))
            .filter((r) => !args.next_action || r.next_action === args.next_action)
            .filter((r) => !args.has_proposal || (args.has_proposal ? r.proposal_event_id != null : r.proposal_event_id == null))
            .filter((r) => !city || norm(r.city).includes(city))
            .filter((r) => !query || [r.org_name, r.domain, r.email].some((v) => norm(v).includes(query)))
            .map((r) => presentLead(r, blocked.get(r.id), now))
            .filter((l) => !args.contactable_only || l.contactable)
            .filter((l) => args.min_priority == null || l.priority >= args.min_priority)
            .sort((a, b) => b.priority - a.priority || b.events_on_passline - a.events_on_passline || String(a.name).localeCompare(String(b.name), "es"));

        // strategy_slug: post-filter by touches (requires a join we do in-memory for simplicity)
        let filtered = matches;
        if (args.strategy_slug) {
            const { data: touchLeads } = await actx.supabase
                .from(TOUCHES)
                .select("lead_id")
                .eq("strategy_slug", args.strategy_slug);
            const withStrategy = new Set((touchLeads || []).map((t: any) => t.lead_id));
            filtered = filtered.filter((l) => withStrategy.has(l.id));
        }

        const limit = args.limit ?? 50;
        const offset = args.offset ?? 0;
        return { total: filtered.length, counts_by_status: counts, counts_by_niche: countsByNiche, limit, offset, leads: filtered.slice(offset, offset + limit) };
    },
};

// ---------------------------------------------------------------------------
// get_lead (mejorada: touches timeline, proposal info)
// ---------------------------------------------------------------------------

const getLead: AdminToolDef = {
    name: "get_lead",
    title: "Ver un lead",
    description:
        "Detalle de un lead: contactos con la fuente de cada dato (contact_sources), eventos de la competencia, touches (secuencia de contacto), " +
        "propuesta de evento (con visitas al link), gmail_thread_id, potencial y motivo de pérdida. Úsalo antes de escribirle.",
    readOnly: true,
    inputSchema: { type: "object", additionalProperties: false, required: ["lead_id"], properties: { lead_id: leadIdSchema } },
    audit: (args) => ({ target: `lead:${args.lead_id}` }),
    async handler(args, actx) {
        const lead = await loadLead(actx.supabase, args.lead_id);
        const blocked = blockReasons([lead], await loadGuards(actx.supabase));

        const [eventsResult, touchesResult] = await Promise.all([
            actx.supabase
                .from("aitickets_competitor_events")
                .select("platform, title, venue, city, event_date, category, url, first_seen_at, last_seen_at, times_seen")
                .eq("lead_id", lead.id)
                .order("last_seen_at", { ascending: false })
                .limit(20),
            actx.supabase
                .from(TOUCHES)
                .select("id, step, kind, channel, strategy_slug, cta, subject, gmail_draft_id, gmail_message_id, gmail_thread_id, outcome, reply_sentiment, drafted_at, sent_at, reply_at")
                .eq("lead_id", lead.id)
                .order("created_at", { ascending: true })
                .limit(50),
        ]);
        if (eventsResult.error) throw eventsResult.error;
        // touches table may not exist yet (migration pending)
        const touches = touchesResult.error ? [] : touchesResult.data || [];
        const lastTouch = touches.length > 0 ? touches[touches.length - 1] : null;

        return {
            ...presentLead(lead, blocked.get(lead.id), new Date()),
            potential_reason: lead.potential_reason || null,
            lost_reason: lead.lost_reason || null,
            invalid_reason: lead.invalid_reason || null,
            gmail_thread_id: lead.gmail_thread_id || null,
            email_source_url: lead.email_source_url || null,
            contact_sources: lead.contact_sources || [],
            discovered_event: lead.discovered_event || null,
            organization_id: lead.organization_id ?? null,
            proposal: lead.proposal_event_id
                ? { event_id: lead.proposal_event_id, preview_link_id: lead.proposal_preview_link_id || null, created_at: lead.proposal_created_at || null }
                : null,
            created_at: lead.created_at,
            touches,
            last_touch: lastTouch,
            competitor_events: eventsResult.data || [],
        };
    },
};

// ---------------------------------------------------------------------------
// update_lead (mejorada: niche, potential, potential_score, potential_reason, next_action_at, lost_reason)
// ---------------------------------------------------------------------------

const updateLead: AdminToolDef = {
    name: "update_lead",
    title: "Actualizar un lead",
    description:
        "Registra el avance de un contacto manual: cambia estado, nicho, potencial, y/o agrega nota. " +
        "Pasar a contacted guarda la fecha de contacto. status=lost exige lost_reason. " +
        "No envía nada. Una baja va por add_suppression.",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["lead_id"],
        properties: {
            lead_id: leadIdSchema,
            status: { type: "string", enum: SETTABLE_STATUSES },
            niche: { type: "string", enum: NICHES, description: "Nicho del lead." },
            potential: { type: "string", enum: POTENTIALS, description: "Nivel de potencial." },
            potential_score: { type: "integer", minimum: 0, maximum: 100, description: "Puntaje de potencial (0-100)." },
            potential_reason: { type: "string", maxLength: 500, description: "Razón del potencial asignado." },
            next_action_at: { type: "string", format: "date-time", description: "Cuándo ejecutar la próxima acción (ISO 8601)." },
            lost_reason: { type: "string", enum: LOST_REASONS, description: "Motivo de pérdida (obligatorio si status=lost)." },
            add_note: { type: "string", minLength: 1, maxLength: 2000, description: "Se agrega a las notas con la fecha de hoy." },
        },
    },
    audit: (args, result) => ({ target: `lead:${args.lead_id}`, summary: args.status ? `Lead pasó a ${result.status}` : "Lead actualizado" }),
    async handler(args, actx) {
        if (!args.status && !args.add_note && !args.niche && args.potential === undefined && args.potential_score === undefined && !args.potential_reason && !args.next_action_at && !args.lost_reason)
            throw new ToolError("invalid_input", "Indica al menos un campo a cambiar: status, niche, potential, potential_score, potential_reason, next_action_at, lost_reason o add_note.");

        const lead = await loadLead(actx.supabase, args.lead_id);
        const nowIso = new Date().toISOString();
        const patch: Record<string, unknown> = { updated_at: nowIso };
        const warnings: string[] = [];

        if (args.status && args.status !== lead.status) {
            if (lead.status === "suppressed") throw new ToolError("conflict", "Este lead tiene una baja: no se puede reactivar desde aquí.");
            if (String(lead.invalid_reason || "").startsWith("duplicate_of:")) throw new ToolError("conflict", `Este lead es un duplicado (${lead.invalid_reason}): actualiza el original.`);
            if (!lead.manual_only) throw new ToolError("conflict", "Este lead está en el outreach automático: su estado lo maneja la secuencia. Solo se le pueden agregar notas.");
            if (args.status === "lost" && !args.lost_reason) throw new ToolError("invalid_input", "status=lost exige lost_reason.");
            if (args.lost_reason && args.status !== "lost") throw new ToolError("invalid_input", "lost_reason solo aplica cuando status=lost.");
            patch.status = args.status;
            patch.invalid_reason = args.status === "invalid" ? "manual" : null;
            if (args.status === "contacted") patch.last_contacted_at = nowIso;
            if (args.status === "lost") {
                patch.lost_reason = args.lost_reason;
                patch.next_action = "none";
                patch.next_action_at = null;
            }
            const blocked = blockReasons([lead], await loadGuards(actx.supabase)).get(lead.id);
            if (blocked && ["contacted", "replied", "interested"].includes(args.status)) warnings.push(`Revisa este lead: ${blocked}.`);
        }

        if (args.niche) patch.niche = args.niche;
        if (args.potential !== undefined) patch.potential = args.potential;
        if (args.potential_score !== undefined) patch.potential_score = args.potential_score;
        if (args.potential_reason) patch.potential_reason = args.potential_reason;
        if (args.next_action_at) patch.next_action_at = args.next_action_at;
        if (args.add_note) patch.notes = `${lead.notes ? `${lead.notes}\n` : ""}[${nowIso.slice(0, 10)}] ${args.add_note}`;

        const { error } = await actx.supabase.from(LEADS).update(patch).eq("id", lead.id);
        if (error) throw error;
        return {
            lead_id: lead.id,
            status: (patch.status as string) ?? lead.status,
            niche: (patch.niche as string) ?? lead.niche ?? null,
            potential: (patch.potential as string) ?? lead.potential ?? null,
            potential_score: patch.potential_score ?? lead.potential_score ?? null,
            lost_reason: (patch.lost_reason as string) ?? lead.lost_reason ?? null,
            last_contacted_at: (patch.last_contacted_at as string) ?? lead.last_contacted_at ?? null,
            notes: (patch.notes as string) ?? lead.notes ?? null,
            warnings,
        };
    },
};

// ---------------------------------------------------------------------------
// create_lead (nueva)
// ---------------------------------------------------------------------------

const createLead: AdminToolDef = {
    name: "create_lead",
    title: "Crear un lead",
    description:
        "Alta de un lead investigado a mano o por una tarea SDR. Deduplica por correo, dominio (no gratuito), Instagram y WhatsApp. " +
        "Si existe, devuelve status='duplicate' con el lead existente. Respeta bajas. Rechaza correo sin contact_source_url. " +
        "Crea con manual_only=true, status=new, next_action=draft_t1.",
    readOnly: false,
    idempotent: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["name", "niche", "potential_score", "potential_reason", "source"],
        properties: {
            name: { type: "string", minLength: 1, maxLength: 200, description: "Nombre del productor o recinto." },
            type: { type: "string", enum: ["producer", "venue"], description: "Tipo de lead." },
            niche: { type: "string", enum: NICHES, description: "Nicho del lead." },
            city: { type: "string", maxLength: 100 },
            email: { type: "string", maxLength: 254 },
            whatsapp: { type: "string", maxLength: 20 },
            instagram: { type: "string", maxLength: 60 },
            website: { type: "string", maxLength: 500 },
            contact_source_url: { type: "string", maxLength: 1000, description: "URL pública de donde se obtuvo el contacto (obligatorio si hay email/whatsapp/instagram)." },
            discovered_event: {
                type: "object",
                additionalProperties: false,
                description: "Evento descubierto en la competencia.",
                properties: {
                    title: { type: "string", maxLength: 300 },
                    date: { type: "string", maxLength: 10 },
                    url: { type: "string", maxLength: 1000 },
                    platform: { type: "string", maxLength: 50 },
                    prices: { type: "string", maxLength: 500 },
                    how_they_charge: { type: "string", maxLength: 500 },
                },
            },
            potential_score: { type: "integer", minimum: 0, maximum: 100, description: "Puntaje de potencial (0-100)." },
            potential_reason: { type: "string", minLength: 5, maxLength: 500, description: "Razón del potencial asignado." },
            source: { type: "string", minLength: 3, maxLength: 50, description: "Fuente (ej. sdr_talleres, sdr_stand_up)." },
            add_note: { type: "string", maxLength: 2000 },
        },
    },
    audit: (args, result) => ({ target: result.lead_id ? `lead:${result.lead_id}` : undefined, summary: result.status === "duplicate" ? "Lead duplicado" : `Lead creado: ${args.name}` }),
    async handler(args, actx) {
        const hasContact = args.email || args.whatsapp || args.instagram;
        if (hasContact && !args.contact_source_url) throw new ToolError("invalid_input", "contact_source_url es obligatorio cuando hay datos de contacto (email, whatsapp, instagram).");

        const email = args.email ? normalizeEmail(args.email) : null;
        if (args.email && !email) throw new ToolError("invalid_input", "El correo no es válido.");

        const rawDomain = args.website ? leadDomainFor({ website: args.website, email }) : email ? leadDomainFor({ email }) : null;
        const domain = rawDomain ? registrableDomain(rawDomain) || String(rawDomain).toLowerCase() : null;
        const safeDomain = domain && !isFreeMailDomain(domain) ? domain : null;

        const igNorm = args.instagram ? String(args.instagram).replace(/^@/, "").toLowerCase().trim() : null;
        const waNorm = args.whatsapp ? String(args.whatsapp).replace(/\D/g, "") : null;

        // Check suppressions
        if (email || safeDomain) {
            const guards = await loadGuards(actx.supabase);
            for (const sup of guards.suppressions) {
                const supEmail = normalizeEmail(sup.email);
                if (supEmail && email && supEmail === email) return { status: "suppressed", reason: "El correo está en la lista de supresión." };
                if (sup.domain && safeDomain && String(sup.domain).toLowerCase() === safeDomain) return { status: "suppressed", reason: "El dominio está en la lista de supresión." };
            }
        }

        // Dedupe: check by email, domain, instagram, whatsapp
        const dupeChecks: Promise<any>[] = [];
        if (email) dupeChecks.push(actx.supabase.from(LEADS).select("id, org_name, status, email").ilike("email", email).limit(1).maybeSingle());
        if (safeDomain) dupeChecks.push(actx.supabase.from(LEADS).select("id, org_name, status, domain").eq("domain", safeDomain).limit(1).maybeSingle());
        if (igNorm) dupeChecks.push(actx.supabase.from(LEADS).select("id, org_name, status, instagram").ilike("instagram", igNorm).limit(1).maybeSingle());
        if (waNorm) dupeChecks.push(actx.supabase.from(LEADS).select("id, org_name, status, whatsapp").eq("whatsapp", waNorm).limit(1).maybeSingle());

        const dupeResults = await Promise.all(dupeChecks);
        for (const { data, error } of dupeResults) {
            if (error) throw error;
            if (data) {
                return {
                    status: "duplicate",
                    duplicate_of: data.id,
                    existing_name: data.org_name || null,
                    existing_status: data.status,
                };
            }
        }

        // Potential level from score
        const potential = args.potential_score >= 70 ? "high" : args.potential_score >= 40 ? "medium" : "low";

        const nowIso = new Date().toISOString();
        const contactSources: any[] = [];
        if (args.contact_source_url) {
            if (email) contactSources.push({ field: "email", value: email, url: args.contact_source_url, found_at: nowIso });
            if (igNorm) contactSources.push({ field: "instagram", value: igNorm, url: args.contact_source_url, found_at: nowIso });
            if (waNorm) contactSources.push({ field: "whatsapp", value: waNorm, url: args.contact_source_url, found_at: nowIso });
        }

        const row: Record<string, unknown> = {
            org_name: args.name.trim(),
            lead_type: args.type || null,
            niche: args.niche,
            domain: safeDomain,
            website: args.website || null,
            city: args.city || null,
            email: email,
            email_source_url: args.contact_source_url || null,
            instagram: igNorm,
            whatsapp: waNorm,
            contact_sources: contactSources,
            source: args.source,
            potential,
            potential_score: args.potential_score,
            potential_reason: args.potential_reason,
            status: "new",
            manual_only: true,
            next_action: "draft_t1",
            sequence_step: 0,
            discovered_event: args.discovered_event || null,
            notes: args.add_note ? `[${nowIso.slice(0, 10)}] ${args.add_note}` : null,
            created_at: nowIso,
            updated_at: nowIso,
        };

        const { data, error } = await actx.supabase.from(LEADS).insert(row).select("id").single();
        if (error) {
            if (String(error.code) === "23505") return { status: "duplicate", reason: "Ya existe un lead con esos datos de contacto (constraint único)." };
            throw error;
        }

        return { status: "created", lead_id: data.id, name: args.name, niche: args.niche, potential, potential_score: args.potential_score, next_action: "draft_t1" };
    },
};

// ---------------------------------------------------------------------------
// log_lead_touch (nueva)
// ---------------------------------------------------------------------------

/** Días de espera entre pasos de la secuencia. */
const STEP_WAIT_DAYS: Record<number, number> = { 1: 4, 2: 5, 3: 7 };

const logLeadTouch: AdminToolDef = {
    name: "log_lead_touch",
    title: "Registrar touch de un lead",
    description:
        "Registra cada paso de la secuencia de contacto y mueve el estado del lead. " +
        "drafted → status=queued. sent → status=contacted, calcula next_action_at. " +
        "replied → status=replied, corta la secuencia. bounced → status=invalid. " +
        "El reloj corre desde sent_at real, no desde el borrador.",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["lead_id", "action"],
        properties: {
            lead_id: leadIdSchema,
            action: { type: "string", enum: TOUCH_OUTCOMES, description: "drafted, sent, replied, bounced o discarded." },
            step: { type: "integer", minimum: 1, maximum: 3, description: "Paso de la secuencia (1-3)." },
            strategy_slug: { type: "string", maxLength: 80, description: "Slug de la estrategia usada." },
            cta: { type: "string", maxLength: 200, description: "Call to action usado." },
            subject: { type: "string", maxLength: 200, description: "Asunto del correo." },
            gmail_draft_id: { type: "string", maxLength: 100 },
            gmail_message_id: { type: "string", maxLength: 100 },
            gmail_thread_id: { type: "string", maxLength: 100 },
            occurred_at: { type: "string", format: "date-time", description: "Cuándo ocurrió (por defecto ahora)." },
            reply_sentiment: { type: "string", enum: REPLY_SENTIMENTS, description: "Sentimiento de la respuesta (solo con action=replied)." },
        },
    },
    audit: (args, result) => ({ target: `lead:${args.lead_id}`, summary: `Touch ${args.action} step ${args.step || "?"}` }),
    async handler(args, actx) {
        const lead = await loadLead(actx.supabase, args.lead_id);
        const now = new Date();
        const occurredAt = args.occurred_at ? new Date(args.occurred_at) : now;
        const nowIso = now.toISOString();

        if (args.action === "replied" && !args.reply_sentiment) throw new ToolError("invalid_input", "action=replied necesita reply_sentiment.");
        if (args.reply_sentiment && args.action !== "replied") throw new ToolError("invalid_input", "reply_sentiment solo aplica con action=replied.");

        // Insert touch
        const touchRow: Record<string, unknown> = {
            lead_id: lead.id,
            step: args.step || null,
            kind: args.action === "replied" ? "reply" : "outreach",
            channel: "email",
            strategy_slug: args.strategy_slug || null,
            cta: args.cta || null,
            subject: args.subject || null,
            gmail_draft_id: args.gmail_draft_id || null,
            gmail_message_id: args.gmail_message_id || null,
            gmail_thread_id: args.gmail_thread_id || null,
            outcome: args.action,
            reply_sentiment: args.reply_sentiment || null,
            drafted_at: args.action === "drafted" ? occurredAt.toISOString() : null,
            sent_at: args.action === "sent" ? occurredAt.toISOString() : null,
            reply_at: args.action === "replied" ? occurredAt.toISOString() : null,
            created_at: nowIso,
        };

        const { data: touchData, error: touchError } = await actx.supabase.from(TOUCHES).insert(touchRow).select("id").single();
        if (touchError) {
            if (String(touchError.code) === "42P01" || String(touchError.code) === "PGRST205") {
                throw new ToolError("unavailable", "La tabla de touches aún no existe (falta la migración del pipeline SDR).");
            }
            throw touchError;
        }

        // Update lead state based on action
        const leadPatch: Record<string, unknown> = { updated_at: nowIso };

        if (args.gmail_thread_id && !lead.gmail_thread_id) leadPatch.gmail_thread_id = args.gmail_thread_id;

        switch (args.action) {
            case "drafted":
                if (lead.status === "new") leadPatch.status = "queued";
                break;

            case "sent": {
                leadPatch.status = "contacted";
                leadPatch.last_contacted_at = occurredAt.toISOString();
                const step = args.step || 1;
                leadPatch.sequence_step = step;
                const waitDays = STEP_WAIT_DAYS[step] || 7;
                const nextAt = new Date(occurredAt.getTime() + waitDays * 86_400_000);
                if (step < 3) {
                    leadPatch.next_action = `draft_t${step + 1}`;
                } else {
                    leadPatch.next_action = "mark_lost";
                }
                leadPatch.next_action_at = nextAt.toISOString();
                break;
            }

            case "replied":
                leadPatch.status = "replied";
                leadPatch.next_action = args.reply_sentiment === "positive" || args.reply_sentiment === "neutral" ? "reply" : "none";
                leadPatch.next_action_at = null;
                break;

            case "bounced":
                leadPatch.status = "invalid";
                leadPatch.invalid_reason = "bounced";
                leadPatch.next_action = "none";
                leadPatch.next_action_at = null;
                break;

            case "discarded":
                leadPatch.next_action = "none";
                leadPatch.next_action_at = null;
                break;
        }

        const { error: updateError } = await actx.supabase.from(LEADS).update(leadPatch).eq("id", lead.id);
        if (updateError) throw updateError;

        return {
            touch_id: touchData.id,
            lead_id: lead.id,
            action: args.action,
            step: args.step || null,
            new_status: (leadPatch.status as string) || lead.status,
            next_action: (leadPatch.next_action as string) || lead.next_action || null,
            next_action_at: (leadPatch.next_action_at as string) || lead.next_action_at || null,
        };
    },
};

// ---------------------------------------------------------------------------
// list_lead_strategies / upsert_lead_strategy (nuevas)
// ---------------------------------------------------------------------------

const listLeadStrategies: AdminToolDef = {
    name: "list_lead_strategies",
    title: "Listar estrategias de contacto",
    description: "Catálogo de ángulos/estrategias por nicho para la secuencia de contacto. Las tareas leen de aquí las ventajas.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            niche: { type: "string", enum: NICHES },
            status: { type: "string", enum: STRATEGY_STATUSES },
        },
    },
    async handler(args, actx) {
        let query = actx.supabase.from(STRATEGIES).select("*").order("niche").order("slug");
        if (args.niche) query = query.eq("niche", args.niche);
        if (args.status) query = query.eq("status", args.status);
        const { data, error } = await query;
        if (error) {
            if (["42P01", "PGRST205"].includes(String(error.code || ""))) return { strategies: [], note: "Tabla de estrategias aún no disponible (falta migración)." };
            throw error;
        }
        return { strategies: data || [] };
    },
};

const upsertLeadStrategy: AdminToolDef = {
    name: "upsert_lead_strategy",
    title: "Crear o actualizar estrategia",
    description:
        "Crea o actualiza una estrategia de contacto por nicho. El slug es la clave primaria. " +
        "Cambiar status a 'discarded' la desactiva sin borrarla (queda en el embudo).",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["slug", "niche", "name"],
        properties: {
            slug: { type: "string", minLength: 3, maxLength: 80, pattern: "^[a-z0-9_-]+$", description: "Identificador único (ej. talleres_ahorro_comision)." },
            niche: { type: "string", enum: NICHES },
            name: { type: "string", minLength: 3, maxLength: 200, description: "Nombre legible de la estrategia." },
            pitch: { type: "string", maxLength: 2000, description: "Las 2 viñetas de ventaja (lo que lee la tarea al redactar)." },
            landing_url: { type: "string", maxLength: 500, description: "URL de landing page para el CTA." },
            status: { type: "string", enum: STRATEGY_STATUSES, description: "active, paused o discarded." },
            notes: { type: "string", maxLength: 2000 },
        },
    },
    audit: (args) => ({ summary: `Estrategia ${args.slug} (${args.niche})` }),
    async handler(args, actx) {
        const nowIso = new Date().toISOString();
        const row = {
            slug: args.slug,
            niche: args.niche,
            name: args.name,
            pitch: args.pitch || null,
            landing_url: args.landing_url || null,
            status: args.status || "active",
            notes: args.notes || null,
            updated_at: nowIso,
        };

        const { data, error } = await actx.supabase
            .from(STRATEGIES)
            .upsert(row, { onConflict: "slug" })
            .select("slug, niche, name, status, updated_at")
            .single();
        if (error) {
            if (["42P01", "PGRST205"].includes(String(error.code || ""))) throw new ToolError("unavailable", "Tabla de estrategias aún no disponible (falta migración).");
            throw error;
        }
        return { strategy: data };
    },
};

// ---------------------------------------------------------------------------
// get_lead_funnel (nueva)
// ---------------------------------------------------------------------------

const getLeadFunnel: AdminToolDef = {
    name: "get_lead_funnel",
    title: "Embudo de leads",
    description:
        "Embudo por niche × strategy_slug × cta × step: contactados, respondieron, respuesta positiva, con propuesta, propuesta abierta, convertidos, perdidos por motivo, rebotes. " +
        "Tasa de respuesta y días a la primera respuesta. Marca low_signal cuando n < 15, y suggest_discard con n ≥ 20 y 0 respuestas.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            niche: { type: "string", enum: NICHES },
            since: { type: "string", format: "date-time", description: "Desde cuándo (ISO 8601, por defecto 90 días atrás)." },
        },
    },
    async handler(args, actx) {
        const sinceDate = args.since ? new Date(args.since) : new Date(Date.now() - 90 * 86_400_000);

        // Load all touches and leads
        let leadsQuery = actx.supabase.from(LEADS).select(
            "id, niche, status, potential, lost_reason, proposal_event_id, created_at"
        );
        if (args.niche) leadsQuery = leadsQuery.eq("niche", args.niche);
        const { data: leads, error: leadsError } = await leadsQuery;
        if (leadsError) throw leadsError;

        const leadMap = new Map<string, any>();
        for (const l of leads || []) leadMap.set(l.id, l);
        const leadIds = [...leadMap.keys()];

        if (leadIds.length === 0) return { funnel: [], summary: { total_leads: 0 } };

        // Load touches since date
        let touchQuery = actx.supabase
            .from(TOUCHES)
            .select("lead_id, step, strategy_slug, cta, outcome, reply_sentiment, sent_at, reply_at")
            .gte("created_at", sinceDate.toISOString())
            .order("created_at", { ascending: true });
        const { data: touches, error: touchError } = await touchQuery;
        if (touchError) {
            if (["42P01", "PGRST205"].includes(String(touchError.code || ""))) return { funnel: [], note: "Tabla de touches aún no disponible." };
            throw touchError;
        }

        // Group by niche × strategy_slug
        type BucketKey = string;
        type Bucket = {
            niche: string;
            strategy_slug: string | null;
            contacted: Set<string>;
            replied: Set<string>;
            positive: Set<string>;
            with_proposal: Set<string>;
            converted: Set<string>;
            lost_reasons: Record<string, number>;
            bounced: number;
            reply_days: number[];
        };
        const buckets = new Map<BucketKey, Bucket>();

        const getKey = (niche: string, slug: string | null) => `${niche}|${slug || "_none_"}`;
        const getBucket = (niche: string, slug: string | null): Bucket => {
            const key = getKey(niche, slug);
            if (!buckets.has(key)) {
                buckets.set(key, {
                    niche,
                    strategy_slug: slug,
                    contacted: new Set(),
                    replied: new Set(),
                    positive: new Set(),
                    with_proposal: new Set(),
                    converted: new Set(),
                    lost_reasons: {},
                    bounced: 0,
                    reply_days: [],
                });
            }
            return buckets.get(key)!;
        };

        for (const t of touches || []) {
            const lead = leadMap.get(t.lead_id);
            if (!lead) continue;
            const bucket = getBucket(lead.niche || "otro", t.strategy_slug);

            if (t.outcome === "sent") bucket.contacted.add(t.lead_id);
            if (t.outcome === "replied") {
                bucket.replied.add(t.lead_id);
                if (t.reply_sentiment === "positive") bucket.positive.add(t.lead_id);
                if (t.sent_at && t.reply_at) {
                    const days = Math.max(0, (Date.parse(t.reply_at) - Date.parse(t.sent_at)) / 86_400_000);
                    bucket.reply_days.push(days);
                }
            }
            if (t.outcome === "bounced") bucket.bounced++;
        }

        // Enrich with lead-level data
        for (const lead of leads || []) {
            // Find the strategies this lead was touched with
            const leadTouches = (touches || []).filter((t: any) => t.lead_id === lead.id);
            const strategies = new Set<string | null>(leadTouches.map((t: any) => t.strategy_slug));
            for (const slug of strategies) {
                const bucket = getBucket(lead.niche || "otro", slug as string | null);
                if (lead.proposal_event_id) bucket.with_proposal.add(lead.id);
                if (lead.status === "converted") bucket.converted.add(lead.id);
                if (lead.status === "lost" && lead.lost_reason) {
                    bucket.lost_reasons[lead.lost_reason] = (bucket.lost_reasons[lead.lost_reason] || 0) + 1;
                }
            }
        }

        const funnel = [...buckets.values()].map((b) => {
            const contacted = b.contacted.size;
            const replied = b.replied.size;
            const responseRate = contacted > 0 ? Math.round((replied / contacted) * 100) : 0;
            const avgReplyDays = b.reply_days.length > 0 ? Math.round((b.reply_days.reduce((a, c) => a + c, 0) / b.reply_days.length) * 10) / 10 : null;
            return {
                niche: b.niche,
                strategy_slug: b.strategy_slug,
                contacted,
                replied,
                positive: b.positive.size,
                with_proposal: b.with_proposal.size,
                converted: b.converted.size,
                bounced: b.bounced,
                lost_by_reason: b.lost_reasons,
                response_rate_pct: responseRate,
                avg_days_to_reply: avgReplyDays,
                low_signal: contacted < 15,
                suggest_discard: contacted >= 20 && replied === 0,
            };
        }).sort((a, b) => b.contacted - a.contacted);

        return {
            since: sinceDate.toISOString(),
            total_leads: leadMap.size,
            funnel,
        };
    },
};

// ---------------------------------------------------------------------------
// add_suppression (sin cambios en lógica, solo mantiene el import de emailDomain)
// ---------------------------------------------------------------------------

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
        if (lead && lead.status !== "suppressed") {
            const { error } = await actx.supabase.from(LEADS).update({ status: "suppressed", next_action: "none", next_action_at: null, updated_at: new Date().toISOString() }).eq("id", lead.id).neq("status", "converted");
            if (error) throw error;
        }
        return { email_suppressed: Boolean(email), domain_suppressed: domain, lead_id: lead?.id ?? null, leads_stopped: affected.length };
    },
};

// ---------------------------------------------------------------------------
// export_leads (sin cambios en lógica)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Exportar todas las herramientas
// ---------------------------------------------------------------------------

export const leadTools: AdminToolDef[] = [
    listLeads,
    getLead,
    updateLead,
    createLead,
    logLeadTouch,
    listLeadStrategies,
    upsertLeadStrategy,
    getLeadFunnel,
    addSuppression,
    exportLeads,
];
