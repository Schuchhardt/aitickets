// Herramientas de admin: ciclo completo de pagos. Liberar fondos anticipadamente, solicitar retiros a nombre del
// productor, política de liberación por organización, y comprobantes de transferencia.
import { randomUUID, createHash } from "node:crypto";
import { ToolError, type JsonSchema } from "../../producer-api/registry";
import { fetchAll } from "../../producer-api/tools/common";
import { computeOrgLedger, loadOrgReleaseGate, addBusinessDays, RELEASE_HOURS } from "../../producer-api/ledger";
import { payoutAccountState, presentAccount, maskAccountNumber } from "../../producer-api/tools/finance";
import { identityApproved, loadOrgIdentity, orgExceedsFreeSoldTickets, recomputeHolderMatch, IDENTITY_REQUIRED_FOR_PAYOUT_MESSAGE } from "../../producerIdentity";
import { notifySlack } from "../../../pages/api/_lib/server-utils";
import { sendEmail, formatRecipient, isValidEmail } from "../../../../netlify/lib/mailer.mjs";
import { PAYOUT_BUSINESS_DAYS } from "../../../../netlify/lib/legal.mjs";
import { loadOrganization, type AdminContext, getSupportUserId } from "../context";
import { type AdminToolDef } from "../registry";
import { loadPayout, loadPayoutAccountRow, orgNames, payoutIdSchema } from "./finance";

// ---------------------------------------------------------------------------
// Helpers (locales, mismos que operations.ts)
// ---------------------------------------------------------------------------

const isMissing = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));
const clp = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")} CLP`;
const shortId = (id: unknown) => String(id || "").slice(0, 8);
const last4Of = (v: unknown) => String(v || "").replace(/\D/g, "").slice(-4) || null;
const actorOf = (actx: AdminContext) => `admin:${actx.fingerprint}`;

const maskName = (v: unknown) =>
    String(v || "").trim().split(/\s+/).filter(Boolean).map((w) => `${w[0]}${"*".repeat(Math.max(2, w.length - 1))}`).join(" ") || null;
const maskRut = (v: unknown) => {
    const s = String(v || "").replace(/[^0-9kK]/g, "");
    return s.length >= 2 ? `••••${s.slice(-4, -1)}-${s.slice(-1).toUpperCase()}` : null;
};

const organizationIdSchema: JsonSchema = { type: "integer", minimum: 1, description: "ID de la organización (ver search_organizations)." };

async function producerRecipients(supabase: any, orgId: number): Promise<{ to: string[]; orgName: string | null }> {
    const [users, org] = await Promise.all([
        fetchAll<any>(() => supabase.from("users").select("id, name, email, role, active").eq("organization_id", orgId).eq("role", "producer").order("id", { ascending: true })),
        loadOrganization<any>({ supabase }, orgId, "id, public_name, email"),
    ]);
    const owners = users.filter((u: any) => u.active !== false && isValidEmail(u.email)).map((u: any) => formatRecipient(u.name || "", u.email));
    const to = owners.length ? owners : isValidEmail(org.email) ? [org.email] : [];
    return { to, orgName: org.public_name ?? null };
}

async function notifyProducer(supabase: any, orgId: number, render: (orgName: string | null) => Promise<{ subject: string; html: string; text: string }>, tag: string) {
    try {
        const { to, orgName } = await producerRecipients(supabase, orgId);
        if (!to.length) return { email_sent: false, email_note: "La organización no tiene un correo válido de dueño ni de contacto." };
        const { subject, html, text } = await render(orgName);
        await sendEmail({ to, subject, html, text, tags: ["payout", tag] });
        return { email_sent: true, email_recipients: to.length };
    } catch (err: any) {
        console.error(`admin ${tag} email:`, err?.message || err);
        return { email_sent: false, email_note: "No se pudo enviar el correo al productor (la operación sí quedó registrada). Avísale por otro medio." };
    }
}

type Allocation = { event_id: number; name: string; amount: number };

function allocateFifo(ledgerEvents: any[], amount: number): Allocation[] {
    const sorted = ledgerEvents
        .filter((l: any) => l.available > 0)
        .sort((a: any, b: any) => String(a.releases_at || "").localeCompare(String(b.releases_at || "")) || a.event_id - b.event_id);
    const out: Allocation[] = [];
    let left = amount;
    for (const l of sorted) {
        if (left <= 0) break;
        const take = Math.min(left, l.available);
        out.push({ event_id: l.event_id, name: l.name, amount: take });
        left -= take;
    }
    return out;
}

async function holderMatchStatus(supabase: any, orgId: number, acc: any, identity: any): Promise<"match" | "mismatch" | "pending"> {
    if (!acc?.bank_account_rut) return "pending";
    const stored = acc.holder_match_status;
    if (stored === "match" || stored === "mismatch") return stored;
    if (!identityApproved(identity)) return "pending";
    return (await recomputeHolderMatch(supabase, orgId))?.status ?? "pending";
}

// ---------------------------------------------------------------------------
// 1. release_event_funds
// ---------------------------------------------------------------------------

const releaseEventFunds: AdminToolDef = {
    name: "release_event_funds",
    title: "Liberar fondos de un evento anticipadamente",
    description:
        "Libera anticipadamente los fondos de un evento (o una función específica), sin esperar las 48 h. " +
        "Evalúa condiciones (identidad verificada, cuenta bancaria, check-ins, disputas). Con override_conditions=true las omite (p. ej. Flow ya liquidó). " +
        "Le avisa al productor por correo y registra quién y por qué lo hizo. Pide confirmación.",
    readOnly: false,
    idempotent: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["event_id"],
        properties: {
            event_id: { type: "integer", minimum: 1, description: "ID del evento." },
            event_date_id: { type: "integer", minimum: 1, description: "Función específica (omitir = todas las del evento)." },
            override_conditions: { type: "boolean", default: false, description: "Ignorar condiciones de liberación (identidad, cuenta, check-ins, disputas). Usar solo cuando Flow ya liquidó o hay razón justificada." },
            notify_producer: { type: "boolean", default: true },
        },
    },
    async confirm(args, actx) {
        const { supabase } = actx;
        const { data: event, error } = await supabase.from("events").select("id, organization_id, name, status, cancelled_at").eq("id", args.event_id).maybeSingle();
        if (error) throw error;
        if (!event) throw new ToolError("not_found", `No existe el evento ${args.event_id}.`);
        if (event.cancelled_at) throw new ToolError("conflict", `El evento "${event.name}" está cancelado: no se pueden liberar fondos de un evento cancelado.`);

        const orgId = Number(event.organization_id);
        const orgName = (await orgNames(supabase, [orgId])).get(orgId) || `org ${orgId}`;

        const ledger = await computeOrgLedger(supabase, orgId, { eventIds: [args.event_id] });
        const eventLedger = ledger.events.find((l) => l.event_id === args.event_id);
        if (!eventLedger) throw new ToolError("conflict", `El evento "${event.name}" no tiene ventas registradas.`);

        let targetFunctions = eventLedger.functions;
        if (args.event_date_id) {
            targetFunctions = targetFunctions.filter((f) => f.event_date_id === args.event_date_id);
            if (!targetFunctions.length) throw new ToolError("not_found", `No se encontró la función ${args.event_date_id} en el evento ${args.event_id}.`);
        }

        const releasableAmount = targetFunctions.reduce((s, f) => s + f.sales_net, 0);
        const alreadyReleased = targetFunctions.filter((f) => f.release_status === "released");
        const pendingOrHeld = targetFunctions.filter((f) => f.release_status === "pending" || f.release_status === "held");

        if (!pendingOrHeld.length && alreadyReleased.length === targetFunctions.length) {
            throw new ToolError("conflict", `Todos los fondos ${args.event_date_id ? "de esa función" : "del evento"} ya están liberados.`);
        }
        if (releasableAmount <= 0) {
            throw new ToolError("conflict", `No hay fondos por liberar (neto de ventas: ${clp(releasableAmount)}).`);
        }

        const warnings: string[] = [];

        if (!args.override_conditions) {
            const orgReasons = await loadOrgReleaseGate(supabase, orgId);
            if (orgReasons.length) {
                throw new ToolError(
                    "conflict",
                    `No se puede liberar: ${orgReasons.map((r) => r.label).join("; ")}. Usa override_conditions=true si tienes justificación (p. ej. Flow ya liquidó).`,
                );
            }
            const functionHolds = pendingOrHeld.flatMap((f) => f.hold_reasons.filter((r) => r.code !== "risk_reserve"));
            if (functionHolds.length) {
                const unique = [...new Set(functionHolds.map((r) => r.label))];
                throw new ToolError(
                    "conflict",
                    `Condiciones sin cumplir: ${unique.join("; ")}. Usa override_conditions=true si hay justificación.`,
                );
            }
        } else {
            warnings.push("Se omiten las condiciones de liberación (override_conditions=true).");
        }

        const functionLabel = args.event_date_id
            ? ` (función #${args.event_date_id}: ${targetFunctions[0]?.date || "sin fecha"})`
            : "";

        return {
            message:
                `Liberar anticipadamente ${clp(releasableAmount)} de "${event.name}" (#${args.event_id})${functionLabel}` +
                ` de ${orgName} (#${orgId}). ` +
                (args.override_conditions ? "Condiciones de liberación omitidas." : "Condiciones de liberación OK.") +
                (args.notify_producer !== false ? " Se avisará al productor por correo." : ""),
            details: {
                event_id: args.event_id,
                event_date_id: args.event_date_id ?? null,
                organization_id: orgId,
                amount: releasableAmount,
                functions_count: pendingOrHeld.length,
                override_conditions: Boolean(args.override_conditions),
            },
            warnings,
        };
    },
    audit: (args, result: any) => ({
        organization_id: result?.organization_id ?? null,
        event_id: args.event_id,
        target: args.event_date_id ? `event_date:${args.event_date_id}` : `event:${args.event_id}`,
        summary: `Fondos liberados anticipadamente${result?.amount ? ` (${clp(result.amount)})` : ""}${args.override_conditions ? " con override" : ""}`,
    }),
    async handler(args, actx) {
        const { supabase } = actx;

        const { data: event, error } = await supabase.from("events").select("id, organization_id, name, cancelled_at").eq("id", args.event_id).maybeSingle();
        if (error) throw error;
        if (!event) throw new ToolError("not_found", `No existe el evento ${args.event_id}.`);
        if (event.cancelled_at) throw new ToolError("conflict", "El evento está cancelado.");
        const orgId = Number(event.organization_id);
        const now = new Date().toISOString();
        const actor = actorOf(actx);

        if (args.event_date_id) {
            const { error: updErr } = await supabase
                .from("event_dates")
                .update({ released_early_at: now, released_early_by: actor })
                .eq("id", args.event_date_id)
                .eq("event_id", args.event_id);
            if (updErr && !isMissing(updErr)) throw updErr;
        } else {
            const { error: evErr } = await supabase
                .from("events")
                .update({ released_early_at: now, released_early_by: actor })
                .eq("id", args.event_id);
            if (evErr && !isMissing(evErr)) throw evErr;

            const { error: datesErr } = await supabase
                .from("event_dates")
                .update({ released_early_at: now, released_early_by: actor })
                .eq("event_id", args.event_id);
            if (datesErr && !isMissing(datesErr)) throw datesErr;
        }

        const ledger = await computeOrgLedger(supabase, orgId, { eventIds: [args.event_id] });
        const eventLedger = ledger.events.find((l) => l.event_id === args.event_id);
        const newAvailable = eventLedger?.available ?? 0;

        const notice =
            args.notify_producer !== false
                ? await notifyProducer(
                      supabase,
                      orgId,
                      async (orgName) => ({
                          subject: `Tus fondos de "${event.name}" están disponibles`,
                          html: `<p>Hola${orgName ? ` ${orgName}` : ""},</p><p>Los fondos de tu evento <strong>"${event.name}"</strong> ya están disponibles para retirar en tu panel de AI Tickets.</p><p>Monto disponible: <strong>${clp(newAvailable)}</strong>.</p><p>Puedes solicitar el retiro desde <a href="${actx.origin}/dashboard/finance">tu panel de finanzas</a>.</p><p>— AI Tickets</p>`,
                          text: `Hola${orgName ? ` ${orgName}` : ""}, los fondos de "${event.name}" ya están disponibles: ${clp(newAvailable)}. Solicita el retiro en ${actx.origin}/dashboard/finance.`,
                      }),
                      "funds-released",
                  )
                : { email_sent: false, email_note: "notify_producer = false" };

        await notifySlack(
            `🔓 *Fondos liberados anticipadamente vía Admin*\n• *Org:* ${orgId}\n• *Evento:* ${event.name} (#${args.event_id})` +
                (args.event_date_id ? `\n• *Función:* ${args.event_date_id}` : "") +
                `\n• *Disponible ahora:* ${clp(newAvailable)}` +
                (args.override_conditions ? "\n• *Con override de condiciones*" : "") +
                `\n• *Aviso al productor:* ${notice.email_sent ? "enviado" : "NO enviado"}`,
        );

        return {
            event_id: args.event_id,
            event_date_id: args.event_date_id ?? null,
            organization_id: orgId,
            event_name: event.name,
            amount: newAvailable,
            override_conditions: Boolean(args.override_conditions),
            ...notice,
        };
    },
};

// ---------------------------------------------------------------------------
// 2. org_request_payout
// ---------------------------------------------------------------------------

const orgRequestPayout: AdminToolDef = {
    name: "org_request_payout",
    title: "Solicitar retiro a nombre de la productora",
    description:
        "Solicita un retiro a nombre de una organización (cuando el productor lo pide por email, WhatsApp o teléfono). " +
        "Mismas validaciones que request_payout del productor (cuenta verificada, cooling, saldo disponible). " +
        "Registra requested_by = soporte, requested_via = 'admin' y el canal por el que lo pidió el productor. " +
        "El payout_id resultante se puede usar en get_payout_transfer_details y mark_payout_paid. Pide confirmación.",
    readOnly: false,
    idempotent: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["organization_id", "requested_via"],
        properties: {
            organization_id: organizationIdSchema,
            amount: { type: "integer", minimum: 1, maximum: 10_000_000_000, description: "CLP. Omitir = todo el saldo disponible." },
            requested_via: { type: "string", enum: ["email", "whatsapp", "phone", "other"], description: "Canal por el que el productor pidió el retiro." },
        },
    },
    async confirm(args, actx) {
        const plan = await adminPlanPayout(actx, args.organization_id, args.amount);
        const shown = presentAccount(plan.acc);
        return {
            message:
                `Retiro de ${clp(plan.amount)} de ${plan.orgName} (#${args.organization_id}) a ${shown.bank || "cuenta"} terminada en ${shown.account_last4 || "—"}. ` +
                `Saldo disponible: ${clp(plan.available)}. Estimado de depósito: ${plan.estimated}. Pedido por el productor vía ${args.requested_via}.`,
            details: {
                organization_id: args.organization_id,
                amount: plan.amount,
                bank: shown.bank,
                account_last4: shown.account_last4,
                estimated_payment_date: plan.estimated,
                events: plan.allocations,
                requested_via: args.requested_via,
            },
        };
    },
    audit: (args, result: any) => ({
        organization_id: args.organization_id,
        target: result?.payout_id ? `payout:${result.payout_id}` : `org:${args.organization_id}`,
        summary: `Retiro solicitado por admin${result?.amount ? ` (${clp(result.amount)})` : ""} vía ${args.requested_via}`,
    }),
    async handler(args, actx) {
        const plan = await adminPlanPayout(actx, args.organization_id, args.amount);
        const { supabase } = actx;
        const supportUserId = await getSupportUserId(supabase);

        const confirmedAmount = Number((actx.confirmed?.details as any)?.amount);
        if (args.amount === undefined && Number.isFinite(confirmedAmount) && confirmedAmount !== plan.amount) {
            throw new ToolError("conflict", `El saldo disponible cambió desde la confirmación (${clp(confirmedAmount)} → ${clp(plan.amount)}). Confirma de nuevo.`);
        }

        const payoutId = randomUUID();
        const { error: insErr } = await supabase
            .from("aitickets_payouts")
            .insert({
                id: payoutId,
                organization_id: args.organization_id,
                amount: plan.amount,
                status: "requested",
                bank_name: plan.acc.bank_name,
                bank_account_type: plan.acc.bank_account_type || null,
                bank_account_last4: last4Of(plan.acc.bank_account_number),
                requested_by: supportUserId,
                requested_via: "admin",
                estimated_payment_date: plan.estimated,
            })
            .select("id")
            .single();
        if (insErr) {
            if (isMissing(insErr)) throw new ToolError("unavailable", "Los retiros aún no están disponibles. Intenta en unos minutos.");
            throw insErr;
        }

        const rows = plan.allocations.map((a) => ({
            event_id: a.event_id,
            user_id: supportUserId,
            amount: a.amount,
            status: "requested",
            estimated_payment_date: plan.estimated,
            account_number: maskAccountNumber(plan.acc.bank_account_number),
            bank_name: plan.acc.bank_name,
            account_holder_name: maskName(plan.acc.bank_account_holder) || "••••",
            account_holder_rut: maskRut(plan.acc.bank_account_rut) || "••••",
            payout_id: payoutId,
        }));

        const { error: wError } = await supabase.from("event_withdrawals").insert(rows);
        const rollback = async () => {
            await supabase.from("event_withdrawals").delete().eq("payout_id", payoutId);
            await supabase.from("aitickets_payouts").delete().eq("id", payoutId).eq("organization_id", args.organization_id);
        };
        if (wError) {
            await rollback();
            throw wError;
        }

        const after = await computeOrgLedger(supabase, args.organization_id);
        if (after.events.some((l) => (l.net_due < 0 || l.released_due < 0) && plan.allocations.some((a) => a.event_id === l.event_id))) {
            await rollback();
            throw new ToolError("conflict", "El saldo cambió mientras se procesaba el retiro (¿otra solicitud en curso?). Revisa org_get_balance y vuelve a intentarlo.");
        }

        const { payoutSlackSql } = await import("../../producer-api/tools/finance");
        await notifySlack(
            `💸 *Retiro solicitado por Admin*\n• *Org:* ${args.organization_id} (${plan.orgName})\n• *Monto:* ${clp(plan.amount)}\n` +
                `• *Cuenta:* ${plan.acc.bank_name} ****${last4Of(plan.acc.bank_account_number)}\n• *Payout:* ${payoutId}\n• *Pedido por el productor vía:* ${args.requested_via}\n` +
                `• *Eventos:* ${plan.allocations.map((a) => `#${a.event_id} ${clp(a.amount)}`).join(", ")}\n• *Estimado:* ${plan.estimated}\n` +
                payoutSlackSql(args.organization_id, payoutId),
        );

        return {
            payout_id: payoutId,
            status: "requested",
            organization_id: args.organization_id,
            amount: plan.amount,
            bank: plan.acc.bank_name,
            account_last4: last4Of(plan.acc.bank_account_number),
            estimated_payment_date: plan.estimated,
            events: plan.allocations,
            requested_via: args.requested_via,
            note: `Solicitud registrada. Usa get_payout_transfer_details para ver los datos bancarios y mark_payout_paid con el comprobante cuando transfieras.`,
        };
    },
};

async function adminPlanPayout(actx: AdminContext, orgId: number, requestedAmount?: number) {
    const { supabase } = actx;
    const org = await loadOrganization<any>(actx, orgId, "id, public_name");
    const orgName = org.public_name ?? `org ${orgId}`;

    const accRow = await loadPayoutAccountRow(supabase, orgId);
    const state = payoutAccountState(accRow);
    const identity = await loadOrgIdentity(supabase, orgId);

    if (!identityApproved(identity) && (await orgExceedsFreeSoldTickets(supabase, orgId))) {
        throw new ToolError("conflict", `La organización necesita verificar su identidad antes de retirar. ${IDENTITY_REQUIRED_FOR_PAYOUT_MESSAGE}`);
    }
    if (!state.complete) throw new ToolError("conflict", `${orgName} no tiene datos bancarios registrados.`);
    if (state.status === "rejected") throw new ToolError("conflict", `La cuenta bancaria de ${orgName} fue rechazada: ${accRow.verification_notes || "debe corregir los datos"}.`);
    if (state.status !== "verified") throw new ToolError("conflict", `La cuenta bancaria de ${orgName} aún no está verificada.`);

    if (identityApproved(identity)) {
        const holder = await holderMatchStatus(supabase, orgId, accRow, identity);
        if (holder !== "match") {
            throw new ToolError("conflict", "El titular de la cuenta no coincide con la identidad verificada: no se transfiere a terceros.");
        }
    }
    if (state.coolingActive) {
        throw new ToolError("conflict", `La cuenta bancaria cambió hace poco: retiros habilitados desde ${state.holdUntil!.toISOString()}.`);
    }

    const ledger = await computeOrgLedger(supabase, orgId);
    const available = ledger.totals.available;
    if (available <= 0) {
        const why = ledger.hold_reasons.length ? ` Retenido: ${ledger.hold_reasons.map((r) => r.label).join("; ")}.` : "";
        throw new ToolError("conflict", `${orgName} no tiene saldo disponible (pendiente ${clp(ledger.totals.pending)}, retenido ${clp(ledger.totals.retained)}).${why}`);
    }

    const amount = requestedAmount ?? available;
    if (amount > available) throw new ToolError("conflict", `El monto (${clp(amount)}) supera el saldo disponible (${clp(available)}).`);

    const allocations = allocateFifo(ledger.events, amount);
    const allocated = allocations.reduce((s, a) => s + a.amount, 0);
    if (allocated < amount) throw new ToolError("conflict", `Solo se pueden asignar ${clp(allocated)} a eventos con saldo disponible.`);

    const estimated = addBusinessDays(new Date(), PAYOUT_BUSINESS_DAYS);
    return { acc: accRow, orgName, amount, available, allocations, estimated };
}

// ---------------------------------------------------------------------------
// 3. set_release_policy
// ---------------------------------------------------------------------------

const setReleasePolicy: AdminToolDef = {
    name: "set_release_policy",
    title: "Configurar política de liberación de una organización",
    description:
        "Cambia el plazo de liberación de fondos de una organización (por defecto 48 h globales). " +
        "release_delay_hours: 0 (inmediato) a 168 (7 días). release_on_flow_settlement: liberar cuando Flow reporta la liquidación, sin esperar el plazo fijo. " +
        "Afecta solo las ventas futuras: lo ya pendiente sigue con las reglas anteriores. Pide confirmación.",
    readOnly: false,
    idempotent: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["organization_id"],
        properties: {
            organization_id: organizationIdSchema,
            release_delay_hours: { type: "integer", nullable: true, minimum: 0, maximum: 168, description: "Horas de espera (0 = inmediato, null = volver al default global de 48 h)." },
            release_on_flow_settlement: { type: "boolean", description: "Liberar cuando Flow liquida, sin esperar el plazo fijo." },
        },
    },
    async confirm(args, actx) {
        const org = await loadOrganization<any>(actx, args.organization_id, "id, public_name, release_delay_hours, release_on_flow_settlement");
        const currentDelay = org.release_delay_hours ?? RELEASE_HOURS;
        const currentFlow = Boolean(org.release_on_flow_settlement);
        const newDelay = args.release_delay_hours !== undefined ? (args.release_delay_hours ?? RELEASE_HOURS) : currentDelay;
        const newFlow = args.release_on_flow_settlement !== undefined ? args.release_on_flow_settlement : currentFlow;

        if (newDelay === currentDelay && newFlow === currentFlow) {
            throw new ToolError("conflict", "Los valores ya son esos: no hay nada que cambiar.");
        }

        const changes: string[] = [];
        if (newDelay !== currentDelay) changes.push(`plazo de liberación: ${currentDelay} h → ${newDelay} h`);
        if (newFlow !== currentFlow) changes.push(`liberar con liquidación de Flow: ${currentFlow ? "sí" : "no"} → ${newFlow ? "sí" : "no"}`);

        return {
            message: `Cambiar política de liberación de ${org.public_name} (#${args.organization_id}): ${changes.join(", ")}. Aplica a ventas futuras.`,
            details: {
                organization_id: args.organization_id,
                before: { release_delay_hours: currentDelay, release_on_flow_settlement: currentFlow },
                after: { release_delay_hours: newDelay, release_on_flow_settlement: newFlow },
            },
        };
    },
    audit: (args) => ({
        organization_id: args.organization_id,
        target: `org:${args.organization_id}`,
        summary: `Política de liberación actualizada${args.release_delay_hours !== undefined ? ` (${args.release_delay_hours ?? "default"} h)` : ""}`,
    }),
    async handler(args, actx) {
        const org = await loadOrganization<any>(actx, args.organization_id, "id, public_name, release_delay_hours, release_on_flow_settlement");
        const patch: Record<string, unknown> = {};
        if (args.release_delay_hours !== undefined) patch.release_delay_hours = args.release_delay_hours;
        if (args.release_on_flow_settlement !== undefined) patch.release_on_flow_settlement = args.release_on_flow_settlement;

        if (!Object.keys(patch).length) throw new ToolError("invalid_input", "Indica al menos un campo para cambiar.");

        const { error } = await actx.supabase.from("organizations").update(patch).eq("id", args.organization_id);
        if (error) {
            if (isMissing(error)) throw new ToolError("unavailable", "Las columnas de política de liberación aún no existen. Aplica la migración correspondiente.");
            throw error;
        }

        await notifySlack(
            `⏱️ *Política de liberación cambiada vía Admin*\n• *Org:* ${org.public_name} (#${args.organization_id})\n` +
                (args.release_delay_hours !== undefined ? `• *Plazo:* ${org.release_delay_hours ?? RELEASE_HOURS} h → ${args.release_delay_hours ?? RELEASE_HOURS} h\n` : "") +
                (args.release_on_flow_settlement !== undefined ? `• *Con liquidación Flow:* ${Boolean(org.release_on_flow_settlement)} → ${args.release_on_flow_settlement}\n` : ""),
        );

        return {
            organization_id: args.organization_id,
            release_delay_hours: args.release_delay_hours !== undefined ? (args.release_delay_hours ?? RELEASE_HOURS) : (org.release_delay_hours ?? RELEASE_HOURS),
            release_on_flow_settlement: args.release_on_flow_settlement !== undefined ? args.release_on_flow_settlement : Boolean(org.release_on_flow_settlement),
            note: "Aplica a ventas futuras: lo ya pendiente sigue con las reglas anteriores.",
        };
    },
};

// ---------------------------------------------------------------------------
// 4. Comprobantes de transferencia
// ---------------------------------------------------------------------------

const RECEIPT_BUCKET = "payout-receipts";
const MAX_RECEIPT_SIZE = 5 * 1024 * 1024; // 5 MB
const CONTENT_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

const uploadPayoutReceipt: AdminToolDef = {
    name: "upload_payout_receipt",
    title: "Subir comprobante de transferencia",
    description:
        "Sube el comprobante (PDF, JPG o PNG, máx. 5 MB) de una transferencia bancaria, asociado a un retiro. " +
        "Se puede subir antes o después de mark_payout_paid. El archivo se guarda en storage encriptado y solo se accede con get_payout_receipt (URL firmada de 15 min).",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["payout_id", "file_base64", "content_type"],
        properties: {
            payout_id: payoutIdSchema,
            file_base64: { type: "string", description: "Archivo en base64." },
            content_type: { type: "string", enum: ["application/pdf", "image/jpeg", "image/png"] },
        },
    },
    audit: (args) => ({ target: `payout:${args.payout_id}`, summary: "Comprobante de transferencia subido" }),
    async handler(args, actx) {
        const payout = await loadPayout(actx.supabase, args.payout_id);
        const orgId = Number(payout.organization_id);
        const ext = CONTENT_TYPES[args.content_type];
        if (!ext) throw new ToolError("invalid_input", `Tipo no soportado: usa application/pdf, image/jpeg o image/png.`);

        let buffer: Buffer;
        try {
            buffer = Buffer.from(args.file_base64, "base64");
        } catch {
            throw new ToolError("invalid_input", "El archivo no es base64 válido.");
        }
        if (buffer.length > MAX_RECEIPT_SIZE) throw new ToolError("invalid_input", `El archivo excede el máximo de 5 MB (${Math.round(buffer.length / 1024 / 1024 * 10) / 10} MB).`);
        if (buffer.length < 100) throw new ToolError("invalid_input", "El archivo está vacío o es demasiado pequeño.");

        const fileHash = createHash("sha256").update(buffer).digest("hex");
        const path = `${orgId}/${args.payout_id}.${ext}`;

        const { error: upErr } = await actx.supabase.storage.from(RECEIPT_BUCKET).upload(path, buffer, {
            contentType: args.content_type,
            upsert: true,
        });
        if (upErr) throw new ToolError("unavailable", `Error al subir el comprobante: ${upErr.message}. Verifica que el bucket "${RECEIPT_BUCKET}" exista.`);

        const { error: insErr } = await actx.supabase
            .from("aitickets_payout_receipts")
            .upsert({
                payout_id: args.payout_id,
                organization_id: orgId,
                storage_path: path,
                content_type: args.content_type,
                file_size: buffer.length,
                file_hash: fileHash,
                uploaded_by: actorOf(actx),
            }, { onConflict: "payout_id" })
            .select("id")
            .single();
        if (insErr && !isMissing(insErr)) throw insErr;

        return {
            payout_id: args.payout_id,
            organization_id: orgId,
            storage_path: path,
            file_hash: fileHash,
            size_bytes: buffer.length,
            content_type: args.content_type,
        };
    },
};

const getPayoutReceipt: AdminToolDef = {
    name: "get_payout_receipt",
    title: "Obtener comprobante de transferencia",
    description: "Devuelve una URL firmada (15 min) para descargar el comprobante de transferencia de un retiro.",
    readOnly: true,
    sensitive: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["payout_id"],
        properties: { payout_id: payoutIdSchema },
    },
    async handler(args, actx) {
        const { data: receipt, error: rErr } = await actx.supabase
            .from("aitickets_payout_receipts")
            .select("id, payout_id, organization_id, storage_path, content_type, file_hash")
            .eq("payout_id", args.payout_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (rErr && !isMissing(rErr)) throw rErr;
        if (!receipt) {
            throw new ToolError("not_found", `El retiro ${shortId(args.payout_id)} no tiene comprobante. Usa upload_payout_receipt para subirlo.`);
        }

        const { data, error } = await actx.supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(receipt.storage_path, 900);
        if (error) throw new ToolError("unavailable", `Error al generar la URL firmada: ${error.message}`);

        return {
            payout_id: args.payout_id,
            organization_id: Number(receipt.organization_id),
            signed_url: data.signedUrl,
            expires_in_seconds: 900,
            file_hash: receipt.file_hash || null,
            content_type: receipt.content_type,
        };
    },
};

// ---------------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------------

// TODO: Mejorar mark_payout_paid en operations.ts para aceptar receipt_file_base64 opcional
// (llama upload_payout_receipt internamente). Por ahora el flujo es: mark_payout_paid + upload_payout_receipt.

export const payoutCycleTools: AdminToolDef[] = [
    releaseEventFunds,
    orgRequestPayout,
    setReleasePolicy,
    uploadPayoutReceipt,
    getPayoutReceipt,
];
