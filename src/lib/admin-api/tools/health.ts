// Herramientas de admin: bandeja de operación (lo que espera a AI Tickets) y salud de los procesos de fondo.
// Todo se infiere de las tablas de cada proceso; tolera tablas o columnas que aún no existen (deploy sin migrar).
import type { AdminToolDef } from "../registry";
import { orgNames } from "./finance";

const ITEM_CAP = 20;
const MIN = 60_000;
const DAY = 86_400_000;

const isMissing = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));

/** Filas de una consulta; [] y missing=true si la tabla/columna no existe. Nunca lanza por esquema. */
async function rows(build: () => any): Promise<{ data: any[]; missing: boolean }> {
    try {
        const { data, error } = await build();
        if (error) {
            if (isMissing(error)) return { data: [], missing: true };
            throw error;
        }
        return { data: data || [], missing: false };
    } catch (err: any) {
        if (isMissing(err)) return { data: [], missing: true };
        throw err;
    }
}

async function headCount(build: () => any): Promise<number | null> {
    const { count, error } = await build();
    if (error) return null;
    return count ?? 0;
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const hoursSince = (iso: string | null | undefined) => (iso ? Math.round(((Date.now() - Date.parse(iso)) / 3_600_000) * 10) / 10 : null);
const daysSince = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : null);

type Section = { key: string; title: string; urgency: number; count: number; resolve_with: string; items: any[]; note?: string };

const listPendingOperations: AdminToolDef = {
    name: "list_pending_operations",
    title: "Bandeja de operación",
    description:
        "Todo lo que espera a AI Tickets, ordenado por urgencia: retiros por transferir, reembolsos por devolver en Flow, órdenes en revisión manual, " +
        "órdenes 'processing' atascadas, órdenes pagadas sin correo de entradas, correos de entradas rebotados, cuentas bancarias por verificar, " +
        "mensajes programados fallidos, dominios propios pendientes o fallidos y outreach (borradores por aprobar o pausado). " +
        "Cada sección dice con qué herramienta se resuelve. Máximo 20 ítems por sección (count trae el total encontrado).",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, actx) {
        const { supabase } = actx;
        const [payouts, refunds, review, processing, noEmail, bounces, accounts, scheduled, sites, drafts, paused] = await Promise.all([
            rows(() => supabase.from("aitickets_payouts").select("id, organization_id, amount, status, created_at, bank_name, bank_account_last4").in("status", ["requested", "processing"]).order("created_at", { ascending: true }).limit(200)),
            rows(() => supabase.from("aitickets_refunds").select("id, organization_id, event_id, order_id, kind, total_amount, created_at").in("status", ["requested", "processing"]).order("created_at", { ascending: true }).limit(200)),
            rows(() => supabase.from("event_orders").select("id, event_id, created_at, total_payment, payment_external_id").eq("status", "review").order("created_at", { ascending: true }).limit(200)),
            rows(() => supabase.from("event_orders").select("id, event_id, created_at, processing_started_at, payment_external_id").eq("status", "processing").lt("processing_started_at", ago(30 * MIN)).order("processing_started_at", { ascending: true }).limit(200)),
            // Solo la última semana: las órdenes anteriores a email_sent_at no lo tienen
            rows(() => supabase.from("event_orders").select("id, event_id, created_at, payment_provider").eq("status", "paid").is("email_sent_at", null).lt("created_at", ago(15 * MIN)).gte("created_at", ago(7 * DAY)).order("created_at", { ascending: true }).limit(200)),
            rows(() => supabase.from("aitickets_email_log").select("id, order_id, event_id, status, error, last_event_at, created_at").in("status", ["bounced", "complained"]).gte("created_at", ago(7 * DAY)).order("created_at", { ascending: false }).limit(200)),
            rows(() => supabase.from("organization_payout_accounts").select("organization_id, bank_name, bank_account_number, bank_account_holder, bank_account_rut, verified_at, verification_rejected_at, removed_at, bank_changed_at, updated_at").is("verified_at", null).limit(500)),
            rows(() => supabase.from("aitickets_scheduled_messages").select("id, organization_id, event_id, kind, subject, send_at, failed_count, recipients_count").eq("status", "failed").gte("send_at", ago(14 * DAY)).order("send_at", { ascending: false }).limit(200)),
            rows(() => supabase.from("aitickets_sites").select("organization_id, slug, custom_domain, domain_status, domain_error, domain_requested_at, domain_checked_at").in("domain_status", ["pending_provider", "failed"]).limit(200)),
            rows(() => supabase.from("aitickets_outreach_messages").select("id, lead_id, subject, ai_intent, ai_confidence, created_at").eq("direction", "out").eq("status", "draft").order("created_at", { ascending: true }).limit(200)),
            rows(() => supabase.from("aitickets_outreach_state").select("key, value, updated_at").eq("key", "paused")),
        ]);

        // Las compras de los eventos demo no envían correo de entradas
        const paidWithoutEmail = noEmail.data.filter((o: any) => o.payment_provider !== "demo");
        const pendingAccounts = accounts.data.filter(
            (a: any) => a.bank_name && a.bank_account_number && a.bank_account_holder && a.bank_account_rut && !a.verification_rejected_at && !a.removed_at,
        );
        const recentFailedDomains = sites.data.filter((s: any) => s.domain_status === "pending_provider" || (s.domain_checked_at && Date.parse(s.domain_checked_at) >= Date.now() - 14 * DAY));
        const orgIds = [
            ...payouts.data.map((p: any) => p.organization_id),
            ...refunds.data.map((r: any) => r.organization_id),
            ...pendingAccounts.map((a: any) => a.organization_id),
            ...scheduled.data.map((m: any) => m.organization_id),
            ...recentFailedDomains.map((s: any) => s.organization_id),
        ].map(Number);
        const names = await orgNames(supabase, orgIds);
        const org = (id: unknown) => ({ id: Number(id), name: names.get(Number(id)) || null });
        const cap = (list: any[]) => list.slice(0, ITEM_CAP);

        const pausedState = paused.data[0]?.value || null;
        const sections: Section[] = [
            {
                key: "payouts",
                title: "Retiros por transferir",
                urgency: 1,
                count: payouts.data.length,
                resolve_with: "get_payout_transfer_details → transferir → mark_payout_paid (o mark_payout_failed)",
                items: cap(payouts.data).map((p: any) => ({ payout_id: p.id, organization: org(p.organization_id), amount_clp: Number(p.amount) || 0, status: p.status, days_waiting: daysSince(p.created_at), bank: p.bank_name, account_last4: p.bank_account_last4 })),
            },
            {
                key: "refunds",
                title: "Reembolsos por devolver en Flow",
                urgency: 2,
                count: refunds.data.length,
                resolve_with: "list_refund_requests → devolver en Flow → mark_refund_completed (o mark_refund_failed)",
                items: cap(refunds.data).map((r: any) => ({ refund_id: r.id, organization: org(r.organization_id), event_id: Number(r.event_id), order_id: r.order_id, kind: r.kind, total_amount_clp: Number(r.total_amount) || 0, days_waiting: daysSince(r.created_at) })),
            },
            {
                key: "orders_in_review",
                title: "Órdenes en revisión manual (sobreventa, monto distinto o código sobre su límite)",
                urgency: 3,
                count: review.data.length,
                resolve_with: "org_get_order para ver el caso; emitir entradas a mano (org_issue_complimentary_tickets) o reembolsar (org_refund_order)",
                items: cap(review.data).map((o: any) => ({ order_id: o.id, event_id: Number(o.event_id), created_at: o.created_at, total_payment_clp: o.total_payment ?? null, flow_reference: o.payment_external_id ?? null })),
            },
            {
                key: "orders_stuck_processing",
                title: "Órdenes 'processing' atascadas (más de 30 min)",
                urgency: 4,
                count: processing.data.length,
                resolve_with: "expire-pending-orders las concilia cada 10 min; si persisten, revisar el pago en Flow y org_get_order",
                items: cap(processing.data).map((o: any) => ({ order_id: o.id, event_id: Number(o.event_id), processing_started_at: o.processing_started_at, flow_reference: o.payment_external_id ?? null })),
            },
            {
                key: "paid_without_email",
                title: "Órdenes pagadas sin correo de entradas (más de 15 min, últimos 7 días)",
                urgency: 5,
                count: paidWithoutEmail.length,
                resolve_with: "org_resend_tickets(order_id)",
                items: cap(paidWithoutEmail).map((o: any) => ({ order_id: o.id, event_id: Number(o.event_id), created_at: o.created_at, payment_provider: o.payment_provider ?? null })),
            },
            {
                key: "ticket_email_bounces",
                title: "Correos de entradas rebotados o marcados como spam (últimos 7 días)",
                urgency: 6,
                count: bounces.data.length,
                resolve_with: "org_get_order para ver la dirección; pedir otra al comprador y org_transfer_ticket",
                items: cap(bounces.data).map((b: any) => ({ order_id: b.order_id, event_id: b.event_id != null ? Number(b.event_id) : null, status: b.status, error: b.error ?? null, at: b.last_event_at || b.created_at })),
                ...(bounces.missing ? { note: "El registro de correos aún no existe en esta base." } : {}),
            },
            {
                key: "payout_accounts_to_verify",
                title: "Cuentas bancarias por verificar",
                urgency: 7,
                count: pendingAccounts.length,
                resolve_with: "get_organization para revisar; verify_payout_account(approve|reject, expected_last4)",
                items: cap(pendingAccounts).map((a: any) => ({ organization: org(a.organization_id), bank: a.bank_name, account_last4: String(a.bank_account_number).replace(/\D/g, "").slice(-4), waiting_since: a.bank_changed_at || a.updated_at || null })),
            },
            {
                key: "scheduled_messages_failed",
                title: "Mensajes programados fallidos (últimos 14 días)",
                urgency: 8,
                count: scheduled.data.length,
                resolve_with: "org_list_scheduled_messages; reprogramar con org_schedule_reminder / org_send_attendee_message",
                items: cap(scheduled.data).map((m: any) => ({ message_id: m.id, organization: org(m.organization_id), event_id: Number(m.event_id), kind: m.kind, send_at: m.send_at, failed: m.failed_count ?? null, recipients: m.recipients_count ?? null })),
            },
            {
                key: "custom_domains",
                title: "Dominios propios pendientes de proveedor o fallidos (últimos 14 días)",
                urgency: 9,
                count: recentFailedDomains.length,
                resolve_with: "pending_provider: configurar el proveedor (DOMAIN_PROVIDER / NETLIFY_AUTH_TOKEN); failed: revisar el DNS con el productor",
                items: cap(recentFailedDomains).map((s: any) => ({ organization: org(s.organization_id), domain: s.custom_domain, status: s.domain_status, error: s.domain_error ?? null, requested_at: s.domain_requested_at ?? null })),
            },
            {
                key: "outreach",
                title: "Outreach: borradores por aprobar y pausa",
                urgency: 10,
                count: drafts.data.length + (pausedState?.paused ? 1 : 0),
                resolve_with: "Aprobar con el link de Slack (/api/outreach/approve); despausar en aitickets_outreach_state",
                items: [
                    ...(pausedState?.paused ? [{ type: "paused", reason: pausedState.reason ?? null, since: pausedState.at ?? paused.data[0]?.updated_at ?? null }] : []),
                    ...cap(drafts.data).map((d: any) => ({ type: "draft", message_id: d.id, lead_id: d.lead_id, subject: d.subject ?? null, intent: d.ai_intent ?? null, created_at: d.created_at })),
                ],
            },
        ];
        const nonEmpty = sections.filter((s) => s.count > 0);
        return {
            generated_at: new Date().toISOString(),
            total_items: nonEmpty.reduce((n, s) => n + s.count, 0),
            summary: nonEmpty.length ? nonEmpty.map((s) => `${s.title}: ${s.count}`) : ["Nada pendiente."],
            sections: nonEmpty,
            empty_sections: sections.filter((s) => s.count === 0).map((s) => s.key),
        };
    },
};

const getSystemHealth: AdminToolDef = {
    name: "get_system_health",
    title: "Salud de los procesos",
    description:
        "Última actividad observada de cada proceso de fondo (recordatorios, solicitudes de reseña, mensajes programados, revisión de dominios, " +
        "passline-watch, outreach, expiración de órdenes, historias automáticas, bitácora del panel), errores de la API/MCP de productores en 24 h por código, órdenes atascadas y correos " +
        "fallidos. Se infiere de las tablas: un proceso sin filas recientes puede ser normal (p. ej. sin eventos mañana), revísalo con su note.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, actx) {
        const { supabase } = actx;
        const since24 = ago(DAY);
        const last = (table: string, column: string, apply?: (q: any) => any) =>
            rows(() => {
                let q = supabase.from(table).select(column);
                if (apply) q = apply(q);
                // nullsFirst: false: en Postgres DESC deja los NULL primero (p. ej. sitios nunca revisados)
                return q.order(column, { ascending: false, nullsFirst: false }).limit(1);
            }).then((r) => ({ at: r.data[0]?.[column] ?? null, missing: r.missing }));

        const [reminders, reviewRequests, schedSent, schedOverdue, schedStuck, domainCheck, passline, outreachEvent, outreachPaused, pendingOverdue, processingStuck, apiErrors, emails, panelViews, panelClient, seriesQueued, seriesOverdue] = await Promise.all([
            last("notification_log", "created_at", (q) => q.eq("type", "reminder_24h")),
            last("notification_log", "created_at", (q) => q.eq("type", "review_request")),
            last("aitickets_scheduled_messages", "sent_at", (q) => q.eq("status", "sent")),
            headCount(() => supabase.from("aitickets_scheduled_messages").select("id", { count: "exact", head: true }).eq("status", "scheduled").lt("send_at", ago(30 * MIN))),
            headCount(() => supabase.from("aitickets_scheduled_messages").select("id", { count: "exact", head: true }).eq("status", "sending").lt("claimed_at", ago(30 * MIN))),
            last("aitickets_sites", "domain_checked_at", (q) => q.neq("domain_status", "none")),
            rows(() => supabase.from("aitickets_lead_sources").select("key, enabled, last_run_at, last_result").eq("key", "passline_search")),
            last("aitickets_outreach_events", "created_at"),
            rows(() => supabase.from("aitickets_outreach_state").select("value, updated_at").eq("key", "paused")),
            // expire-pending-orders corre cada 10 min: pendientes con la reserva vencida hace más de 1 h = el cron no corre
            headCount(() => supabase.from("event_orders").select("id", { count: "exact", head: true }).eq("status", "pending").lt("hold_expires_at", ago(60 * MIN))),
            headCount(() => supabase.from("event_orders").select("id", { count: "exact", head: true }).eq("status", "processing").lt("processing_started_at", ago(30 * MIN))),
            rows(() => supabase.from("aitickets_api_audit").select("tool, error_code, channel").eq("ok", false).gte("created_at", since24).limit(5000)),
            rows(() => supabase.from("aitickets_email_log").select("status").gte("created_at", since24).limit(20000)),
            // Bitácora del panel: page_view lo escribe el servidor; el resto, el rastreador del navegador
            last("aitickets_producer_activity", "created_at", (q) => q.eq("type", "page_view")),
            last("aitickets_producer_activity", "created_at", (q) => q.neq("type", "page_view")),
            // Difusión automática: última pieza enviada a Zernio y piezas vencidas sin despachar (el job no corre)
            last("aitickets_social_series_slots", "queued_at"),
            headCount(() => supabase.from("aitickets_social_series_slots").select("id", { count: "exact", head: true }).eq("status", "planned").lt("publish_at", ago(20 * MIN)).gt("publish_at", ago(DAY))),
        ]);

        const errorsByCode: Record<string, number> = {};
        const errorsByTool: Record<string, number> = {};
        for (const r of apiErrors.data) {
            const code = String(r.error_code || "unknown");
            errorsByCode[code] = (errorsByCode[code] || 0) + 1;
            errorsByTool[r.tool] = (errorsByTool[r.tool] || 0) + 1;
        }
        const emailByStatus: Record<string, number> = {};
        for (const r of emails.data) emailByStatus[r.status] = (emailByStatus[r.status] || 0) + 1;
        const passlineRow = passline.data[0] || null;
        const pausedValue = outreachPaused.data[0]?.value || null;

        const proc = (name: string, at: string | null, expectedEveryHours: number, note: string, missing = false) => ({
            process: name,
            last_activity_at: at,
            hours_since: hoursSince(at),
            expected_every_hours: expectedEveryHours,
            looks_stale: at ? (hoursSince(at) || 0) > expectedEveryHours * 2 : null,
            note: missing ? `${note} (tabla o columna aún no existe en esta base)` : note,
        });

        const alerts: string[] = [];
        if ((pendingOverdue || 0) > 0) alerts.push(`${pendingOverdue} orden(es) pending con la reserva vencida hace más de 1 h: expire-pending-orders podría no estar corriendo.`);
        if ((processingStuck || 0) > 0) alerts.push(`${processingStuck} orden(es) en 'processing' hace más de 30 min.`);
        if ((schedOverdue || 0) > 0) alerts.push(`${schedOverdue} mensaje(s) programado(s) vencidos sin enviar: revisa send-scheduled-messages.`);
        if ((schedStuck || 0) > 0) alerts.push(`${schedStuck} mensaje(s) programado(s) en 'sending' hace más de 30 min.`);
        if (pausedValue?.paused) alerts.push(`Outreach en pausa${pausedValue.reason ? `: ${pausedValue.reason}` : ""}.`);
        if ((emailByStatus.failed || 0) + (emailByStatus.bounced || 0) > 0) alerts.push(`Correos de entradas en 24 h: ${emailByStatus.failed || 0} fallidos, ${emailByStatus.bounced || 0} rebotados.`);
        const totalApiErrors = apiErrors.data.length;
        const internalErrors = errorsByCode.internal || 0;
        if (internalErrors > 0) alerts.push(`${internalErrors} error(es) internos de la API/MCP de productores en 24 h.`);
        if ((seriesOverdue || 0) > 0) alerts.push(`${seriesOverdue} historia(s) automática(s) vencidas sin despachar: revisa la función social-series-dispatch y /api/social-series/run.`);
        if (panelViews.at && (hoursSince(panelViews.at) || 0) < 6 && (!panelClient.at || (hoursSince(panelClient.at) || 0) > 24)) {
            alerts.push("El panel registra visitas pero el rastreador del navegador no manda datos hace más de 24 h: revisa src/lib/producerActivityClient.js y /api/dashboard/journal.");
        }

        return {
            generated_at: new Date().toISOString(),
            alerts,
            processes: [
                proc("send-event-reminders (recordatorio 24 h)", reminders.at, 24, "Corre a diario (13:00 UTC); solo escribe si hay funciones al día siguiente.", reminders.missing),
                proc("send-review-requests (pedir reseñas)", reviewRequests.at, 24, "Corre cada hora; solo escribe cuando termina un evento.", reviewRequests.missing),
                { ...proc("send-scheduled-messages", schedSent.at, 24, "Corre cada 10 min; solo escribe si hay mensajes programados.", schedSent.missing), overdue_scheduled: schedOverdue, stuck_sending: schedStuck },
                proc("check-custom-domains", domainCheck.at, 1, "Corre cada 15 min sobre sitios con dominio propio.", domainCheck.missing),
                {
                    process: "passline-watch (leads)",
                    enabled: passlineRow?.enabled ?? null,
                    last_activity_at: passlineRow?.last_run_at ?? null,
                    hours_since: hoursSince(passlineRow?.last_run_at),
                    expected_every_hours: 24,
                    last_result: passlineRow?.last_result ?? null,
                    note: passline.missing ? "La tabla de fuentes de leads no existe." : "Corre a diario (11:00 UTC) si LEADS_PASSLINE_ENABLED=true.",
                },
                { ...proc("outreach", outreachEvent.at, 24, "Solo con OUTREACH_ENABLED=true.", outreachEvent.missing), paused: pausedValue?.paused ?? false },
                { process: "expire-pending-orders", pending_overdue: pendingOverdue, processing_stuck: processingStuck, note: "Corre cada 10 min: concilia con Flow y expira pendientes." },
                {
                    ...proc("social-series-dispatch (historias automáticas)", seriesQueued.at, 24, "Corre cada 15 min; solo escribe cuando hay historias o posts por publicar en las próximas 2 h.", seriesQueued.missing),
                    overdue_planned: seriesOverdue,
                },
                {
                    ...proc("bitácora del panel (rastreador del navegador)", panelClient.at, 24, "Datos de uso del panel que manda el navegador; solo escribe si algún productor usa el panel.", panelClient.missing),
                    last_page_view_at: panelViews.at,
                },
            ],
            producer_api_errors_24h: { total: totalApiErrors, by_code: errorsByCode, by_tool: errorsByTool },
            ticket_emails_24h: emails.missing ? null : emailByStatus,
        };
    },
};

export const healthTools: AdminToolDef[] = [listPendingOperations, getSystemHealth];
