// Herramientas de admin: productores (organizaciones). Lectura entre organizaciones.
import type { JsonSchema } from "../../producer-api/registry";
import { fetchAll, eventDateFields, eventPublicUrl } from "../../producer-api/tools/common";
import { presentAccount } from "../../producer-api/tools/finance";
import { computeOrgLedger } from "../../producer-api/ledger";
import { eventCapacity } from "../../eventAnalytics";
import { siteUrl as publicSiteUrl } from "../../sites";
import { ROLE_LABELS } from "../../producer-api/permissions";
import { loadOrganization } from "../context";
import type { AdminToolDef } from "../registry";
import {
    SEGMENTS,
    SEGMENT_LABELS,
    emptyTotals,
    loadPaidOrders,
    loadPlatformEvents,
    mergeTotals,
    pctChange,
    periodSchema,
    resolvePeriod,
    segmentFor,
    totalsByEvent,
    totalsFromOrders,
    type SalesTotals,
    type Segment,
} from "../metrics";

const isMissing = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));

/** Lee filas tolerando tabla/columna inexistente (deploy sin migrar): [] en ese caso. */
async function tolerantRows(build: () => any): Promise<any[]> {
    const { data, error } = await build();
    if (error) {
        if (isMissing(error)) return [];
        throw error;
    }
    return data || [];
}

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export const organizationIdSchema: JsonSchema = { type: "integer", minimum: 1, description: "ID de la organización (ver search_organizations)." };

/** Ids de organizaciones que calzan con un texto: nombre, razón social, correo, RUT, miembros o eventos. */
async function matchOrganizationIds(supabase: any, query: string): Promise<Set<number>> {
    const q = `%${escapeLike(query)}%`;
    const ids = new Set<number>();
    const add = (rows: any[], key = "id") => rows.forEach((r) => r?.[key] != null && ids.add(Number(r[key])));
    const digits = query.replace(/[^0-9kK]/g, "");
    const [byName, byLegal, byEmail, byRut, users, events] = await Promise.all([
        tolerantRows(() => supabase.from("organizations").select("id").ilike("public_name", q).limit(200)),
        tolerantRows(() => supabase.from("organizations").select("id").ilike("legal_name", q).limit(200)),
        tolerantRows(() => supabase.from("organizations").select("id").ilike("email", q).limit(200)),
        digits.length >= 6 ? tolerantRows(() => supabase.from("organizations").select("id").ilike("legal_id", `%${digits.slice(0, -1)}%`).limit(50)) : Promise.resolve([]),
        tolerantRows(() => supabase.from("users").select("organization_id").ilike("email", q).limit(200)),
        tolerantRows(() => supabase.from("events").select("organization_id").ilike("name", q).limit(200)),
    ]);
    add(byName);
    add(byLegal);
    add(byEmail);
    add(byRut);
    add(users, "organization_id");
    add(events, "organization_id");
    if (/^\d+$/.test(query.trim())) ids.add(Number(query.trim()));
    return ids;
}

type OrgOverview = {
    org: any;
    owner: { id: number; name: string | null; email: string | null } | null;
    members: number;
    events: any[];
    totals: SalesTotals;
    segment: Segment;
    payoutStatus: string;
    /** Órdenes 'paid' de sus eventos (también cortesías y transferencias): para cortes por período sin recargar. */
    orders: any[];
};

/** Visión resumida de varias organizaciones (eventos, ventas históricas, segmento, cuenta bancaria). */
async function overviewOrganizations(supabase: any, orgs: any[], now = new Date()): Promise<OrgOverview[]> {
    if (!orgs.length) return [];
    const orgIds = orgs.map((o) => Number(o.id));
    const [events, users, accounts] = await Promise.all([
        loadPlatformEvents(supabase, { orgIds }),
        fetchAll<any>(() => supabase.from("users").select("id, name, email, role, organization_id, active").in("organization_id", orgIds).order("id", { ascending: true })),
        tolerantRows(() =>
            supabase
                .from("organization_payout_accounts")
                .select("organization_id, bank_name, bank_account_number, bank_account_holder, bank_account_rut, verified_at, removed_at, bank_changed_at, verification_rejected_at")
                .in("organization_id", orgIds),
        ).then(async (rows) =>
            rows.length
                ? rows
                : tolerantRows(() =>
                      supabase.from("organization_payout_accounts").select("organization_id, bank_name, bank_account_number, bank_account_holder, bank_account_rut, verified_at").in("organization_id", orgIds),
                  ),
        ),
    ]);
    const orders = await loadPaidOrders(supabase, events.map((e) => Number(e.id)));
    const byEvent = totalsByEvent(orders);
    const push = <T,>(map: Map<number, T[]>, key: number, value: T) => {
        const list = map.get(key);
        if (list) list.push(value);
        else map.set(key, [value]);
    };
    const eventsByOrg = new Map<number, any[]>();
    for (const e of events) push(eventsByOrg, Number(e.organization_id), e);
    const salesByOrg = new Map<number, Array<{ event_id: number; created_at: string }>>();
    const ordersByOrg = new Map<number, any[]>();
    const orgOfEvent = new Map(events.map((e) => [Number(e.id), Number(e.organization_id)]));
    for (const o of orders) {
        const org = orgOfEvent.get(Number(o.event_id));
        if (org == null) continue;
        push(ordersByOrg, org, o);
        if (totalsFromOrders([o]).paid_orders) push(salesByOrg, org, { event_id: Number(o.event_id), created_at: o.created_at });
    }
    const accountByOrg = new Map(accounts.map((a: any) => [Number(a.organization_id), a]));

    return orgs.map((org) => {
        const id = Number(org.id);
        const orgEvents = eventsByOrg.get(id) || [];
        const totals = orgEvents.reduce((t, e) => mergeTotals(t, byEvent.get(Number(e.id)) || emptyTotals()), emptyTotals());
        const orgUsers = users.filter((u: any) => Number(u.organization_id) === id);
        const ownerRow = orgUsers.find((u: any) => u.role === "producer") || orgUsers.find((u: any) => u.role === "admin") || null;
        return {
            org,
            owner: ownerRow ? { id: Number(ownerRow.id), name: ownerRow.name ?? null, email: ownerRow.email ?? null } : null,
            members: orgUsers.filter((u: any) => u.active !== false).length,
            events: orgEvents,
            totals,
            segment: segmentFor(org, orgEvents, salesByOrg.get(id) || [], now),
            payoutStatus: presentAccount(accountByOrg.get(id) || null).status,
            orders: ordersByOrg.get(id) || [],
        };
    });
}

export const eventCounts = (events: any[], now = Date.now()) => {
    const live = events.filter((e) => !e.archived_at);
    return {
        total: live.length,
        published_upcoming: live.filter((e) => e.status === "published" && !e.cancelled_at && (!e.end_date || Date.parse(e.end_date) >= now)).length,
        drafts: live.filter((e) => e.status !== "published" && !e.cancelled_at).length,
        past: live.filter((e) => e.end_date && Date.parse(e.end_date) < now).length,
        archived: events.length - live.length,
    };
};

const SORTS = ["sales", "created", "last_sale", "name"] as const;

const searchOrganizations: AdminToolDef = {
    name: "search_organizations",
    title: "Buscar productores",
    description:
        "Busca organizaciones (productores) de toda la plataforma por nombre, razón social, correo, RUT, correo de un miembro o nombre de un evento; " +
        "sin query lista todas. Filtra por segmento (sin_verificar, sin_evento, activo, publicado_sin_ventas, borrador_estancado, en_riesgo, inactivo), " +
        "con ventas o fecha de registro. Por organización: dueño, eventos, ventas históricas (sin cortesías ni transferencias), última venta, " +
        "estado de la cuenta bancaria y segmento. Usa get_organization para el detalle.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            query: { type: "string", minLength: 2, maxLength: 120, description: "Texto o ID de la organización." },
            segment: { type: "string", enum: SEGMENTS, description: "Solo este segmento." },
            has_sales: { type: "boolean", description: "true = solo con ventas; false = solo sin ventas." },
            created_from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Registradas desde (YYYY-MM-DD)." },
            created_to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Registradas hasta (YYYY-MM-DD, inclusive)." },
            sort: { type: "string", enum: SORTS, default: "sales", description: "sales = ventas brutas históricas; created = más nuevas; last_sale = venta más reciente; name." },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
        },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        let orgs: any[];
        if (args.query) {
            const ids = [...(await matchOrganizationIds(supabase, args.query))];
            orgs = ids.length ? await fetchAll<any>(() => supabase.from("organizations").select("*").in("id", ids).order("id", { ascending: true })) : [];
        } else {
            orgs = await fetchAll<any>(() => supabase.from("organizations").select("*").order("id", { ascending: true }), { max: 50000 });
        }
        if (args.created_from) orgs = orgs.filter((o) => String(o.created_at || "").slice(0, 10) >= args.created_from);
        if (args.created_to) orgs = orgs.filter((o) => String(o.created_at || "").slice(0, 10) <= args.created_to);

        let rows = await overviewOrganizations(supabase, orgs);
        if (args.segment) rows = rows.filter((r) => r.segment === args.segment);
        if (args.has_sales !== undefined) rows = rows.filter((r) => (r.totals.paid_orders > 0) === args.has_sales);
        const by: Record<string, (a: OrgOverview, b: OrgOverview) => number> = {
            sales: (a, b) => b.totals.gross_sales_clp - a.totals.gross_sales_clp || Number(b.org.id) - Number(a.org.id),
            created: (a, b) => String(b.org.created_at || "").localeCompare(String(a.org.created_at || "")),
            last_sale: (a, b) => String(b.totals.last_sale_at || "").localeCompare(String(a.totals.last_sale_at || "")),
            name: (a, b) => String(a.org.public_name || "").localeCompare(String(b.org.public_name || ""), "es"),
        };
        rows.sort(by[args.sort] || by.sales);
        const page = rows.slice(args.offset, args.offset + args.limit);
        return {
            total: rows.length,
            returned: page.length,
            offset: args.offset,
            segments: SEGMENT_LABELS,
            organizations: page.map((r) => ({
                id: Number(r.org.id),
                name: r.org.public_name,
                legal_name: r.org.legal_name ?? null,
                email: r.org.email ?? null,
                created_at: r.org.created_at ?? null,
                email_verified: Boolean(r.org.email_verified_at),
                owner: r.owner,
                active_members: r.members,
                events: eventCounts(r.events),
                lifetime: {
                    paid_orders: r.totals.paid_orders,
                    tickets_sold: r.totals.tickets_sold,
                    gross_sales_clp: r.totals.gross_sales_clp,
                    aitickets_fee_net_clp: r.totals.aitickets_fee_net_clp,
                    last_sale_at: r.totals.last_sale_at,
                },
                segment: r.segment,
                payout_account: r.payoutStatus,
            })),
        };
    },
};

// ---------------------------------------------------------------------------
// get_organization
// ---------------------------------------------------------------------------

const ALERT_UPCOMING_DAYS = 7;
const ALERT_LOW_SELL_THROUGH = 20;

const getOrganization: AdminToolDef = {
    name: "get_organization",
    title: "Ficha del productor",
    description:
        "Vista 360° de una organización: perfil y atribución del registro, verificación, equipo (roles, último acceso), cuenta bancaria " +
        "(banco y últimos 4), saldo (disponible, pendiente, retenido), eventos con sus ventas, métricas del período vs el anterior, retiros, " +
        "apps conectadas y llaves, sitio y dominio, redes, últimas acciones vía API/MCP, notas internas, segmento y alertas. " +
        "Montos en CLP; ventas sin cortesías ni transferencias.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["organization_id"],
        properties: { organization_id: organizationIdSchema, ...periodSchema },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        const orgId = args.organization_id;
        const org = await loadOrganization<any>(actx, orgId, "*");
        const { current, previous } = resolvePeriod(args);
        const now = new Date();

        const [members, events, accountRows, payouts, apiKeys, grants, sites, social, notes, audit] = await Promise.all([
            fetchAll<any>(() => supabase.from("users").select("id, name, email, role, active, last_access_at, login_count, created_at").eq("organization_id", orgId).order("id", { ascending: true })),
            loadPlatformEvents(supabase, { orgIds: [orgId] }),
            tolerantRows(() => supabase.from("organization_payout_accounts").select("*").eq("organization_id", orgId)),
            tolerantRows(() => supabase.from("aitickets_payouts").select("id, created_at, amount, status, bank_name, bank_account_last4, paid_at, reference, failure_reason").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(10)),
            tolerantRows(() => supabase.from("aitickets_api_keys").select("id, name, scopes, last_used_at, expires_at, revoked_at, oauth_grant_id").eq("organization_id", orgId)),
            tolerantRows(() => supabase.from("aitickets_oauth_grants").select("id, client_name, last_used_at, revoked_at").eq("organization_id", orgId)),
            tolerantRows(() => supabase.from("aitickets_sites").select("slug, published, template, custom_domain, domain_status, domain_error").eq("organization_id", orgId)),
            tolerantRows(() => supabase.from("social_accounts").select("platform, account_name, status").eq("organization_id", orgId)),
            tolerantRows(() => supabase.from("aitickets_admin_notes").select("id, body, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(10)),
            tolerantRows(() => supabase.from("aitickets_api_audit").select("created_at, tool, channel, ok, error_code, summary, event_id").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(10)),
        ]);
        const eventIds = events.map((e) => Number(e.id));
        const orders = await loadPaidOrders(supabase, eventIds);
        const byEvent = totalsByEvent(orders);
        const lifetime = totalsFromOrders(orders);
        const inPeriod = (o: any, p: { fromIso: string; toIso: string }) => o.created_at >= p.fromIso && o.created_at < p.toIso;
        const periodTotals = totalsFromOrders(orders.filter((o) => inPeriod(o, current)));
        const previousTotals = previous ? totalsFromOrders(orders.filter((o) => inPeriod(o, previous))) : null;
        const sales = orders.filter((o) => totalsFromOrders([o]).paid_orders).map((o) => ({ event_id: Number(o.event_id), created_at: o.created_at }));
        const segment = segmentFor(org, events, sales, now);

        const account = accountRows[0] || null;
        let balance: any = null;
        try {
            balance = (await computeOrgLedger(supabase, orgId)).totals;
        } catch (err: any) {
            console.warn("get_organization ledger:", err?.message || err);
        }

        const [reviewOrders, failedMessages, refundsRequested, ratings] = await Promise.all([
            eventIds.length
                ? tolerantRows(() => supabase.from("event_orders").select("id, event_id, created_at").in("event_id", eventIds).eq("status", "review").limit(50))
                : Promise.resolve([]),
            tolerantRows(() => supabase.from("aitickets_scheduled_messages").select("id, event_id, kind, status, send_at").eq("organization_id", orgId).eq("status", "failed").limit(20)),
            tolerantRows(() => supabase.from("aitickets_refunds").select("id, order_id, total_amount, created_at").eq("organization_id", orgId).eq("status", "requested").limit(50)),
            eventIds.length ? tolerantRows(() => supabase.from("aitickets_event_reviews").select("rating").in("event_id", eventIds).limit(5000)) : Promise.resolve([]),
        ]);

        // Alertas
        const alerts: string[] = [];
        const nowMs = now.getTime();
        const soon = events.filter(
            (e) => e.status === "published" && !e.cancelled_at && !e.archived_at && e.start_date && Date.parse(e.start_date) >= nowMs && Date.parse(e.start_date) <= nowMs + ALERT_UPCOMING_DAYS * 86400000,
        );
        for (const e of soon.slice(0, 10)) {
            const cap = await eventCapacity(supabase, e);
            if (cap.sellThroughPct != null && cap.sellThroughPct < ALERT_LOW_SELL_THROUGH) {
                alerts.push(`"${e.name}" (#${e.id}) es en menos de ${ALERT_UPCOMING_DAYS} días y lleva ${cap.sellThroughPct}% de ocupación.`);
            }
        }
        const payout = presentAccount(account);
        if (balance && balance.available > 0 && payout.status !== "verified") {
            alerts.push(`Tiene $${balance.available.toLocaleString("es-CL")} CLP disponibles y su cuenta bancaria está "${payout.status}": no puede retirar.`);
        }
        if (reviewOrders.length) alerts.push(`${reviewOrders.length} orden(es) en revisión manual ('review').`);
        if (failedMessages.length) alerts.push(`${failedMessages.length} mensaje(s) programado(s) fallido(s).`);
        if (refundsRequested.length) alerts.push(`${refundsRequested.length} reembolso(s) por devolver en Flow.`);
        if (previousTotals && previousTotals.paid_orders >= 5) {
            const change = pctChange(periodTotals.gross_sales_clp, previousTotals.gross_sales_clp);
            if (change != null && change <= -50) alerts.push(`Las ventas cayeron ${Math.abs(change)}% vs el período anterior.`);
        }
        const ratingValues = ratings.map((r: any) => Number(r.rating)).filter((n: number) => n >= 1 && n <= 5);
        const avgRating = ratingValues.length ? Math.round((ratingValues.reduce((a: number, b: number) => a + b, 0) / ratingValues.length) * 10) / 10 : null;
        if (avgRating != null && ratingValues.length >= 5 && avgRating < 3.5) alerts.push(`Nota promedio de reseñas baja: ${avgRating} (${ratingValues.length} reseñas).`);

        const site = sites[0] || null;
        const activeKeys = apiKeys.filter((k: any) => !k.revoked_at && !k.oauth_grant_id && (!k.expires_at || Date.parse(k.expires_at) > nowMs));
        const activeGrants = grants.filter((g: any) => !g.revoked_at);
        const lastApiUse = [...activeKeys, ...activeGrants].map((k: any) => k.last_used_at).filter(Boolean).sort().pop() || null;

        return {
            organization: {
                id: Number(org.id),
                name: org.public_name,
                legal_name: org.legal_name ?? null,
                legal_id: org.legal_id ?? null,
                email: org.email ?? null,
                phone: org.phone ?? null,
                website: org.website ?? null,
                instagram: org.instagram ?? null,
                created_at: org.created_at ?? null,
                email_verified_at: org.email_verified_at ?? null,
                terms_accepted_at: org.terms_accepted_at ?? null,
                onboarding_pending: org.onboarding_pending ?? null,
                signup: { utm_source: org.signup_utm_source ?? null, utm_medium: org.signup_utm_medium ?? null, utm_campaign: org.signup_utm_campaign ?? null, ref: org.signup_ref ?? null, referrer: org.signup_referrer ?? null },
            },
            segment,
            segment_label: SEGMENT_LABELS[segment],
            alerts,
            team: members.map((u: any) => ({
                id: Number(u.id),
                name: u.name ?? null,
                email: u.email ?? null,
                role: u.role,
                role_label: ROLE_LABELS[u.role] || u.role,
                active: u.active !== false,
                last_access_at: u.last_access_at ?? null,
                logins: u.login_count ?? 0,
            })),
            period: { from: current.from, to: current.to, ...(previous ? { compare_from: previous.from, compare_to: previous.to } : {}) },
            sales: {
                lifetime,
                period: periodTotals,
                ...(previousTotals ? { previous_period: previousTotals, gross_sales_change_pct: pctChange(periodTotals.gross_sales_clp, previousTotals.gross_sales_clp) } : {}),
                note: "Ventas sin cortesías ni transferencias. gross = lo que pagaron los compradores; producer_net = lo del productor; aitickets_fee_net = cargo por servicio sin IVA.",
            },
            events: events
                .map((e) => {
                    const t = byEvent.get(Number(e.id)) || emptyTotals();
                    return {
                        id: Number(e.id),
                        name: e.name,
                        status: e.status,
                        ...(e.archived_at ? { archived: true } : {}),
                        ...(e.cancelled_at ? { cancelled_at: e.cancelled_at } : {}),
                        ...eventDateFields(e),
                        public_url: e.status === "published" ? eventPublicUrl({ origin: actx.origin } as any, e.slug) : null,
                        paid_orders: t.paid_orders,
                        tickets_sold: t.tickets_sold,
                        gross_sales_clp: t.gross_sales_clp,
                        producer_net_clp: t.producer_net_clp,
                        last_sale_at: t.last_sale_at,
                    };
                })
                .sort((a, b) => String(b.start_date || "").localeCompare(String(a.start_date || ""))),
            event_counts: eventCounts(events),
            payout_account: payout,
            balance,
            recent_payouts: payouts,
            pending: { orders_in_review: reviewOrders.length, refunds_to_process: refundsRequested.length, failed_scheduled_messages: failedMessages.length },
            reviews: { count: ratingValues.length, average: avgRating },
            integrations: {
                personal_api_keys: activeKeys.length,
                connected_apps: activeGrants.map((g: any) => ({ app: g.client_name, last_used_at: g.last_used_at ?? null })),
                last_api_use_at: lastApiUse,
                social_accounts: social.map((s: any) => ({ platform: s.platform, account: s.account_name, status: s.status })),
            },
            site: site
                ? { url: publicSiteUrl(site), slug: site.slug, published: site.published, template: site.template, custom_domain: site.custom_domain ?? null, domain_status: site.domain_status, domain_error: site.domain_error ?? null }
                : null,
            recent_api_activity: audit,
            internal_notes: notes,
        };
    },
};

export const organizationTools: AdminToolDef[] = [searchOrganizations, getOrganization];

/** Para otras herramientas de admin (p. ej. rank_producers). */
export { overviewOrganizations, matchOrganizationIds, tolerantRows };
export type { OrgOverview };
