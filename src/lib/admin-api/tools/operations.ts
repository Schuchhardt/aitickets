// Herramientas de admin: operación de plataforma (escrituras). Lo que antes era SQL a mano en Supabase:
// verificar cuentas bancarias, registrar retiros pagados o fallidos, cerrar reembolsos hechos en Flow, moderar
// reseñas, editar el perfil de una organización, notas internas y ayuda para entrar.
// Las de plata usan las funciones de db/migrations/202610270100_payout_ops.sql (validan las transiciones; un trigger
// sincroniza event_withdrawals): aquí no se reimplementa su lógica, solo se confirma, se registra y se avisa.
import { ToolError, type JsonSchema } from "../../producer-api/registry";
import { fetchAll } from "../../producer-api/tools/common";
import { presentAccount } from "../../producer-api/tools/finance";
import { purgeEventPages } from "../../cdnCache";
import { notifySlack } from "../../../pages/api/_lib/server-utils";
import { sendEmail, formatRecipient, isValidEmail } from "../../../../netlify/lib/mailer.mjs";
import { renderPayoutPaidEmail, renderPayoutFailedEmail } from "../../../../netlify/lib/emails/index.mjs";
import { sendVerificationEmail, getOrgVerification } from "../../email-verification";
import { sendMagicLinkEmail, reserveAuthLinkSend, isAiticketsIdentity } from "../../magic-link";
import { loadOrganization, type AdminContext } from "../context";
import { rpcResult, type AdminToolDef } from "../registry";
import { loadPayout, loadPayoutAccountRow, orgNames, payoutIdSchema, payoutWarnings, refundIdSchema } from "./finance";

const isMissing = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));
const clp = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")} CLP`;
const shortId = (id: unknown) => String(id || "").slice(0, 8);
const last4Of = (v: unknown) => String(v || "").replace(/\D/g, "").slice(-4) || null;
/** Quién registra la operación en las funciones SQL: la huella de la llave (no un nombre). */
const actorOf = (actx: AdminContext) => `admin:${actx.fingerprint}`;

const organizationIdSchema: JsonSchema = { type: "integer", minimum: 1, description: "ID de la organización (ver search_organizations)." };

/** Dueños activos de la organización con correo válido; si no hay, el correo de la organización. */
async function producerRecipients(supabase: any, orgId: number): Promise<{ to: string[]; orgName: string | null }> {
    const [users, org] = await Promise.all([
        fetchAll<any>(() => supabase.from("users").select("id, name, email, role, active").eq("organization_id", orgId).eq("role", "producer").order("id", { ascending: true })),
        loadOrganization<any>({ supabase }, orgId, "id, public_name, email"),
    ]);
    const owners = users.filter((u: any) => u.active !== false && isValidEmail(u.email)).map((u: any) => formatRecipient(u.name || "", u.email));
    const to = owners.length ? owners : isValidEmail(org.email) ? [org.email] : [];
    return { to, orgName: org.public_name ?? null };
}

/** Envía un correo al productor sin hacer fallar la operación. */
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

// ---------------------------------------------------------------------------
// Cuentas bancarias
// ---------------------------------------------------------------------------

const verifyPayoutAccount: AdminToolDef = {
    name: "verify_payout_account",
    title: "Verificar o rechazar cuenta bancaria",
    description:
        "Aprueba o rechaza la cuenta bancaria de una organización (solo AI Tickets verifica; sin esto el productor no puede retirar). " +
        "No toca los datos bancarios. Rechazar exige notes: el productor ve ese texto en su panel para corregir los datos. " +
        "expected_last4 (recomendado) evita aprobar una cuenta que cambió mientras la revisabas. Pide confirmación.",
    readOnly: false,
    idempotent: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["organization_id", "decision"],
        properties: {
            organization_id: organizationIdSchema,
            decision: { type: "string", enum: ["approve", "reject"] },
            notes: { type: "string", maxLength: 500, description: "Obligatorio al rechazar: qué debe corregir el productor (lo ve en el panel)." },
            expected_last4: { type: "string", pattern: "^\\d{4}$", description: "Últimos 4 dígitos que revisaste." },
        },
    },
    async confirm(args, actx) {
        const org = await loadOrganization<any>(actx, args.organization_id, "id, public_name");
        const acc = await loadPayoutAccountRow(actx.supabase, args.organization_id);
        if (!acc?.bank_account_number) throw new ToolError("conflict", `${org.public_name} no tiene datos bancarios registrados.`);
        if (args.decision === "reject" && !String(args.notes || "").trim()) throw new ToolError("invalid_input", "Para rechazar escribe en notes qué debe corregir el productor.");
        const shown = presentAccount(acc);
        const warnings: string[] = [];
        if (args.expected_last4 && shown.account_last4 !== args.expected_last4) warnings.push(`La cuenta registrada termina en ${shown.account_last4}, no en ${args.expected_last4}: la función lo va a rechazar.`);
        if (acc.verified_at && args.decision === "approve") warnings.push("La cuenta ya estaba verificada.");
        return {
            message:
                `${args.decision === "approve" ? "APROBAR" : "RECHAZAR"} la cuenta bancaria de ${org.public_name} (#${org.id}): ` +
                `${shown.bank || "banco"} ${shown.account_type || ""} terminada en ${shown.account_last4 || "—"}, titular ${shown.holder || "—"} (${shown.holder_rut || "RUT —"}).` +
                (args.decision === "reject" ? ` Motivo para el productor: "${args.notes}".` : ""),
            details: { organization_id: org.id, bank: shown.bank, account_last4: shown.account_last4, decision: args.decision },
            warnings,
        };
    },
    audit: (args) => ({ organization_id: args.organization_id, target: `org:${args.organization_id}`, summary: `Cuenta bancaria ${args.decision === "approve" ? "aprobada" : "rechazada"}` }),
    async handler(args, actx) {
        const result = rpcResult(
            await actx.supabase.rpc("aitickets_verify_payout_account", {
                p_organization_id: args.organization_id,
                p_decision: args.decision,
                p_verified_by: actorOf(actx),
                p_notes: args.notes ?? null,
                p_expected_last4: args.expected_last4 ?? null,
            }),
        );
        return {
            ...(result || {}),
            next_step:
                args.decision === "approve"
                    ? "Listo: el productor puede pedir retiros (respetando la espera de 72 h desde el último cambio de cuenta, ver payouts_enabled_from)."
                    : "El productor ve el motivo en Configuración; al guardar datos corregidos la cuenta vuelve a revisión.",
        };
    },
};

// ---------------------------------------------------------------------------
// Retiros
// ---------------------------------------------------------------------------

const markPayoutPaid: AdminToolDef = {
    name: "mark_payout_paid",
    title: "Registrar retiro pagado",
    description:
        "Registra que AI Tickets YA transfirió un retiro: guarda el n° de comprobante (reference, obligatorio: pídelo, nunca lo inventes), " +
        "deja el retiro y su reparto por evento en 'paid' y, por defecto, le avisa al productor por correo con el monto, la cuenta (últimos 4) y el comprobante. " +
        "Se niega si la cuenta no está verificada, cambió después de pedir el retiro o sus últimos 4 no calzan, salvo force=true (solo si ya " +
        "transferiste a la cuenta correcta). Pide confirmación.",
    readOnly: false,
    idempotent: true,
    annotations: { destructiveHint: false },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["payout_id", "reference"],
        properties: {
            payout_id: payoutIdSchema,
            reference: { type: "string", minLength: 3, maxLength: 120, description: "N° de comprobante o código de la transferencia." },
            force: { type: "boolean", default: false, description: "Ignorar las alertas de la cuenta (ya transferiste a la cuenta correcta)." },
            notify_producer: { type: "boolean", default: true, description: "Enviar el aviso por correo al productor." },
        },
    },
    async confirm(args, actx) {
        const payout = await loadPayout(actx.supabase, args.payout_id);
        if (payout.status === "paid") return null; // repetir no cambia nada: la función responde changed=false
        if (!["requested", "processing"].includes(payout.status)) {
            throw new ToolError("conflict", `El retiro ${shortId(payout.id)} está '${payout.status}': solo uno requested o processing se puede marcar pagado.`);
        }
        const orgId = Number(payout.organization_id);
        const [acc, names] = await Promise.all([loadPayoutAccountRow(actx.supabase, orgId), orgNames(actx.supabase, [orgId])]);
        const warnings = payoutWarnings(payout, acc);
        // aitickets_set_payout_status rechaza estos casos sin p_force: se avisa ya, sin pedir una confirmación inútil
        if (warnings.length && !args.force) {
            throw new ToolError(
                "conflict",
                `${warnings.join(" ")} Si NO has transferido, resuélvelo primero (verify_payout_account o confirma la cuenta con el productor). ` +
                    "Si ya transferiste a la cuenta correcta, repite con force=true.",
            );
        }
        return {
            message:
                `Registrar como PAGADO el retiro ${shortId(payout.id)} de ${names.get(orgId) || `org ${orgId}`}: ${clp(payout.amount)} a ` +
                `${payout.bank_name || "la cuenta"} terminada en ${payout.bank_account_last4 || last4Of(acc?.bank_account_number) || "—"}, comprobante "${args.reference}". ` +
                (args.notify_producer !== false ? "Se le enviará un correo al productor." : "No se avisará al productor."),
            details: { payout_id: payout.id, organization_id: orgId, amount_clp: Number(payout.amount), reference: args.reference, force: Boolean(args.force) },
            warnings,
        };
    },
    audit: (args, result: any) => ({
        organization_id: result?.organization_id ?? null,
        target: `payout:${args.payout_id}`,
        summary: `Retiro ${shortId(args.payout_id)} registrado como pagado${result?.amount ? ` (${clp(result.amount)})` : ""}${args.force ? " con force" : ""}`,
    }),
    async handler(args, actx) {
        const result: any = rpcResult(
            await actx.supabase.rpc("aitickets_set_payout_status", {
                p_payout_id: args.payout_id,
                p_status: "paid",
                p_reference: args.reference,
                p_failure_reason: null,
                p_actor: actorOf(actx),
                p_force: Boolean(args.force),
            }),
        );
        const orgId = Number(result?.organization_id);
        if (!result?.changed) {
            return { ...result, note: "El retiro ya estaba pagado: no se cambió nada ni se reenvió el aviso." };
        }
        const payout = await loadPayout(actx.supabase, args.payout_id).catch(() => null);
        const notice =
            args.notify_producer !== false
                ? await notifyProducer(
                      actx.supabase,
                      orgId,
                      (orgName) =>
                          renderPayoutPaidEmail({
                              orgName,
                              amount: Number(result.amount),
                              bank: payout?.bank_name ?? null,
                              last4: payout?.bank_account_last4 ?? null,
                              reference: String(result.reference || args.reference),
                              paidAt: result.paid_at,
                              dashboardUrl: `${actx.origin}/dashboard/finance`,
                          }),
                      "payout-paid",
                  )
                : { email_sent: false, email_note: "notify_producer = false" };
        await notifySlack(
            `✅ *Retiro pagado vía Admin*\n• *Org:* ${orgId}\n• *Monto:* ${clp(result.amount)}\n• *Payout:* ${result.payout_id}\n• *Comprobante:* ${String(result.reference || args.reference).slice(0, 120)}` +
                `${args.force ? "\n• *Con force* (se ignoraron las alertas de la cuenta)" : ""}\n• *Aviso al productor:* ${notice.email_sent ? "enviado" : "NO enviado"}`,
        );
        return { ...result, ...notice };
    },
};

const markPayoutFailed: AdminToolDef = {
    name: "mark_payout_failed",
    title: "Registrar retiro fallido",
    description:
        "Registra que un retiro NO se pudo transferir (cuenta cerrada, datos erróneos…): el retiro y su reparto quedan en 'failed' y el monto vuelve al " +
        "saldo disponible del productor. reason_for_producer es lo que verá el productor; por defecto se le avisa por correo. Pide confirmación.",
    readOnly: false,
    idempotent: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["payout_id", "reason_for_producer"],
        properties: {
            payout_id: payoutIdSchema,
            reason_for_producer: { type: "string", minLength: 5, maxLength: 300, description: "Por qué no se pudo transferir (lo ve el productor)." },
            notify_producer: { type: "boolean", default: true },
        },
    },
    async confirm(args, actx) {
        const payout = await loadPayout(actx.supabase, args.payout_id);
        if (payout.status === "failed") return null;
        if (!["requested", "processing"].includes(payout.status)) {
            throw new ToolError("conflict", `El retiro ${shortId(payout.id)} está '${payout.status}': solo uno requested o processing puede marcarse fallido.`);
        }
        const names = await orgNames(actx.supabase, [Number(payout.organization_id)]);
        return {
            message:
                `Registrar como FALLIDO el retiro ${shortId(payout.id)} de ${names.get(Number(payout.organization_id)) || `org ${payout.organization_id}`} por ${clp(payout.amount)}. ` +
                `El monto vuelve a su saldo disponible. Motivo para el productor: "${args.reason_for_producer}".`,
            details: { payout_id: payout.id, organization_id: Number(payout.organization_id), amount_clp: Number(payout.amount) },
        };
    },
    audit: (args, result: any) => ({ organization_id: result?.organization_id ?? null, target: `payout:${args.payout_id}`, summary: `Retiro ${shortId(args.payout_id)} registrado como fallido` }),
    async handler(args, actx) {
        const result: any = rpcResult(
            await actx.supabase.rpc("aitickets_set_payout_status", {
                p_payout_id: args.payout_id,
                p_status: "failed",
                p_reference: null,
                p_failure_reason: args.reason_for_producer,
                p_actor: actorOf(actx),
                p_force: false,
            }),
        );
        if (!result?.changed) return { ...result, note: "El retiro ya estaba fallido: no se cambió nada." };
        const orgId = Number(result.organization_id);
        const notice =
            args.notify_producer !== false
                ? await notifyProducer(
                      actx.supabase,
                      orgId,
                      (orgName) => renderPayoutFailedEmail({ orgName, amount: Number(result.amount), reason: args.reason_for_producer, dashboardUrl: `${actx.origin}/dashboard/settings#datos-bancarios` }),
                      "payout-failed",
                  )
                : { email_sent: false, email_note: "notify_producer = false" };
        await notifySlack(`↩️ *Retiro fallido vía Admin*\n• *Org:* ${orgId}\n• *Monto:* ${clp(result.amount)}\n• *Payout:* ${result.payout_id}\n• *Aviso al productor:* ${notice.email_sent ? "enviado" : "NO enviado"}`);
        return { ...result, ...notice };
    },
};

// ---------------------------------------------------------------------------
// Reembolsos
// ---------------------------------------------------------------------------

async function loadRefund(supabase: any, refundId: string) {
    const { data, error } = await supabase
        .from("aitickets_refunds")
        .select("id, organization_id, event_id, order_id, kind, total_amount, ticket_amount, fee_amount, status, provider_reference")
        .eq("id", refundId)
        .maybeSingle();
    if (error) {
        if (isMissing(error)) throw new ToolError("unavailable", "Los reembolsos aún no están disponibles en esta base.");
        throw error;
    }
    if (!data) throw new ToolError("not_found", `No existe el reembolso ${refundId}. Usa list_refund_requests.`);
    return data;
}

const markRefundCompleted: AdminToolDef = {
    name: "mark_refund_completed",
    title: "Registrar reembolso devuelto",
    description:
        "Registra que AI Tickets YA devolvió el dinero al comprador en Flow: guarda el id del reembolso de Flow (provider_reference, obligatorio si el monto es mayor a 0) " +
        "y deja el reembolso 'completed'. Pide confirmación.",
    readOnly: false,
    idempotent: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["refund_id"],
        properties: {
            refund_id: refundIdSchema,
            provider_reference: { type: "string", minLength: 3, maxLength: 120, description: "Id del reembolso en Flow (o comprobante de la devolución)." },
        },
    },
    async confirm(args, actx) {
        const r = await loadRefund(actx.supabase, args.refund_id);
        if (r.status === "completed") return null;
        if (!["requested", "processing"].includes(r.status)) throw new ToolError("conflict", `El reembolso está '${r.status}': solo uno requested o processing se puede completar.`);
        if (Number(r.total_amount) > 0 && !args.provider_reference && !r.provider_reference) {
            throw new ToolError("invalid_input", "Indica provider_reference: el id del reembolso en Flow. Pídeselo al dueño; no lo inventes.");
        }
        return {
            message: `Registrar como DEVUELTO el reembolso ${r.kind === "full" ? "total" : "parcial"} de ${clp(r.total_amount)} de la orden ${r.order_id} (evento #${r.event_id}), referencia Flow "${args.provider_reference || r.provider_reference}".`,
            details: { refund_id: r.id, order_id: r.order_id, total_amount_clp: Number(r.total_amount) },
        };
    },
    audit: (args, result: any) => ({ target: `refund:${args.refund_id}`, event_id: result?.event_id ?? null, summary: `Reembolso ${shortId(args.refund_id)} registrado como devuelto` }),
    async handler(args, actx) {
        const result: any = rpcResult(
            await actx.supabase.rpc("aitickets_set_refund_status", {
                p_refund_id: args.refund_id,
                p_status: "completed",
                p_provider_reference: args.provider_reference ?? null,
                p_reason: null,
                p_actor: actorOf(actx),
            }),
        );
        return result || {};
    },
};

const markRefundFailed: AdminToolDef = {
    name: "mark_refund_failed",
    title: "Registrar reembolso fallido",
    description:
        "Registra que un reembolso no se pudo devolver por Flow: queda 'failed' y deja de contar contra el saldo del productor. No revive las entradas " +
        "ni devuelve la orden a pagada: la devolución al comprador queda pendiente por otra vía. Pide confirmación.",
    readOnly: false,
    idempotent: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["refund_id", "failure_reason"],
        properties: { refund_id: refundIdSchema, failure_reason: { type: "string", minLength: 5, maxLength: 300 } },
    },
    async confirm(args, actx) {
        const r = await loadRefund(actx.supabase, args.refund_id);
        if (r.status === "failed") return null;
        if (!["requested", "processing"].includes(r.status)) throw new ToolError("conflict", `El reembolso está '${r.status}': solo uno requested o processing puede marcarse fallido.`);
        return {
            message: `Registrar como FALLIDO el reembolso de ${clp(r.total_amount)} de la orden ${r.order_id}. Motivo: "${args.failure_reason}".`,
            details: { refund_id: r.id, order_id: r.order_id },
            warnings: ["Las entradas ya anuladas NO se reactivan: el comprador sigue sin entradas y sin devolución. Resuélvelo con el productor."],
        };
    },
    audit: (args, result: any) => ({ target: `refund:${args.refund_id}`, event_id: result?.event_id ?? null, summary: `Reembolso ${shortId(args.refund_id)} registrado como fallido` }),
    async handler(args, actx) {
        return (
            rpcResult(
                await actx.supabase.rpc("aitickets_set_refund_status", {
                    p_refund_id: args.refund_id,
                    p_status: "failed",
                    p_provider_reference: null,
                    p_reason: args.failure_reason,
                    p_actor: actorOf(actx),
                }),
            ) || {}
        );
    },
};

// ---------------------------------------------------------------------------
// Reseñas
// ---------------------------------------------------------------------------

const UUID_PATTERN = "^[0-9a-fA-F-]{36}$";

const moderateReview: AdminToolDef = {
    name: "moderate_review",
    title: "Ocultar o mostrar reseña o foto",
    description:
        "Oculta (o vuelve a mostrar) una reseña o una foto de asistente en la página pública del evento. Reemplaza el SQL del runbook de reseñas. " +
        "Indica review_id o photo_id (ver org_list_event_reviews). Reversible.",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["action"],
        properties: {
            review_id: { type: "string", pattern: UUID_PATTERN },
            photo_id: { type: "string", pattern: UUID_PATTERN },
            action: { type: "string", enum: ["hide", "show"] },
        },
    },
    audit: (args, result: any) => ({
        organization_id: result?.organization_id ?? null,
        event_id: result?.event_id ?? null,
        target: args.review_id ? `review:${args.review_id}` : `photo:${args.photo_id}`,
        summary: `${args.review_id ? "Reseña" : "Foto"} ${args.action === "hide" ? "ocultada" : "visible"}`,
    }),
    async handler(args, actx) {
        if (Boolean(args.review_id) === Boolean(args.photo_id)) throw new ToolError("invalid_input", "Indica review_id o photo_id (uno de los dos).");
        const status = args.action === "hide" ? "hidden" : "visible";
        const table = args.review_id ? "aitickets_event_reviews" : "aitickets_event_review_photos";
        const column = args.review_id ? "public_status" : "status";
        const id = args.review_id || args.photo_id;
        const { data: row, error } = await actx.supabase.from(table).select(`id, event_id, organization_id, ${column}`).eq("id", id).maybeSingle();
        if (error) {
            if (isMissing(error)) throw new ToolError("unavailable", "Las reseñas aún no están disponibles en esta base.");
            throw error;
        }
        if (!row) throw new ToolError("not_found", `No existe ${args.review_id ? "la reseña" : "la foto"} ${id}.`);
        const previous = row[column];
        if (previous !== status) {
            const patch: Record<string, unknown> = { [column]: status };
            if (args.review_id) patch.updated_at = new Date().toISOString();
            const { error: updError } = await actx.supabase.from(table).update(patch).eq("id", id);
            if (updError) throw updError;
            // La página pública del evento muestra reseñas y fotos: vaciar su caché en el CDN
            await purgeEventPages();
        }
        return { id, kind: args.review_id ? "review" : "photo", event_id: Number(row.event_id), organization_id: Number(row.organization_id), previous_status: previous, status, changed: previous !== status };
    },
};

// ---------------------------------------------------------------------------
// Organización: perfil y notas internas
// ---------------------------------------------------------------------------

// Mismos largos que /api/organizations/update (y los campos de perfil que el panel no edita)
const ORG_FIELDS: Record<string, number> = {
    public_name: 150,
    legal_name: 200,
    legal_id: 20,
    email: 200,
    phone: 50,
    website: 300,
    instagram: 200,
    facebook: 300,
    tiktok: 200,
};
const RUT_REGEX = /^[0-9]{1,2}\.?[0-9]{3}\.?[0-9]{3}-?[0-9kK]$/;

const updateOrganization: AdminToolDef = {
    name: "update_organization",
    title: "Editar perfil de la organización",
    description:
        "Edita el perfil de una organización: nombre público, razón social, RUT (legal_id), correo, teléfono, web y redes. Al menos un campo; " +
        "null o \"\" borra un campo opcional. No cambia cómo entran los usuarios (eso es el correo de cada usuario). Devuelve antes y después.",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["organization_id"],
        properties: {
            organization_id: organizationIdSchema,
            ...Object.fromEntries(Object.entries(ORG_FIELDS).map(([field, max]) => [field, { type: "string", maxLength: max, nullable: true } as JsonSchema])),
        },
    },
    audit: (args, result: any) => ({ organization_id: args.organization_id, target: `org:${args.organization_id}`, summary: `Perfil editado: ${(result?.changed_fields || []).join(", ") || "sin cambios"}` }),
    async handler(args, actx) {
        const patch: Record<string, string | null> = {};
        for (const field of Object.keys(ORG_FIELDS)) {
            if (args[field] === undefined) continue;
            patch[field] = args[field] === null ? null : String(args[field]).trim() || null;
        }
        if (!Object.keys(patch).length) throw new ToolError("invalid_input", "Indica al menos un campo para cambiar.");
        if ("public_name" in patch && !patch.public_name) throw new ToolError("invalid_input", "El nombre público es obligatorio.");
        if (patch.legal_id && !RUT_REGEX.test(patch.legal_id)) throw new ToolError("invalid_input", "RUT de la empresa inválido (ej: 76.123.456-7).");
        if (patch.email && !isValidEmail(patch.email)) throw new ToolError("invalid_input", "Correo inválido.");
        if (patch.website && !/^https?:\/\//i.test(patch.website)) throw new ToolError("invalid_input", "La web debe empezar con https://.");

        const before = await loadOrganization<any>(actx, args.organization_id, `id, ${Object.keys(ORG_FIELDS).join(", ")}`);
        const changed = Object.keys(patch).filter((k) => (before[k] ?? null) !== patch[k]);
        if (changed.length) {
            const { error } = await actx.supabase.from("organizations").update(Object.fromEntries(changed.map((k) => [k, patch[k]]))).eq("id", args.organization_id);
            if (error) throw error;
            // El nombre de la productora aparece en la página pública de sus eventos
            if (changed.includes("public_name")) await purgeEventPages();
        }
        return {
            organization_id: args.organization_id,
            changed_fields: changed,
            before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
            after: Object.fromEntries(changed.map((k) => [k, patch[k]])),
            ...(changed.length ? {} : { note: "Los valores ya eran esos: no se cambió nada." }),
        };
    },
};

const addOrganizationNote: AdminToolDef = {
    name: "add_organization_note",
    title: "Agregar nota interna",
    description: "Agrega una nota interna de soporte a una organización (solo la ve el admin; get_organization muestra las últimas). Útil para dejar contexto de lo que pidió y lo que se hizo.",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["organization_id", "body"],
        properties: { organization_id: organizationIdSchema, body: { type: "string", minLength: 1, maxLength: 4000 } },
    },
    audit: (args) => ({ organization_id: args.organization_id, target: `org:${args.organization_id}`, summary: "Nota interna agregada" }),
    async handler(args, actx) {
        await loadOrganization(actx, args.organization_id, "id");
        const { data, error } = await actx.supabase.from("aitickets_admin_notes").insert({ organization_id: args.organization_id, body: args.body }).select("id, created_at").single();
        if (error) {
            if (isMissing(error)) throw new ToolError("unavailable", "Las notas aún no están disponibles (falta la migración del MCP de admin).");
            throw error;
        }
        return { note_id: Number(data.id), organization_id: args.organization_id, created_at: data.created_at };
    },
};

const listOrganizationNotes: AdminToolDef = {
    name: "list_organization_notes",
    title: "Notas internas de una organización",
    description: "Notas internas de soporte de una organización, más recientes primero.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["organization_id"],
        properties: { organization_id: organizationIdSchema, limit: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
    },
    async handler(args, actx) {
        await loadOrganization(actx, args.organization_id, "id");
        const { data, error } = await actx.supabase
            .from("aitickets_admin_notes")
            .select("id, body, created_at")
            .eq("organization_id", args.organization_id)
            .order("created_at", { ascending: false })
            .limit(args.limit);
        if (error) {
            if (isMissing(error)) return { organization_id: args.organization_id, notes: [] };
            throw error;
        }
        return { organization_id: args.organization_id, count: (data || []).length, notes: data || [] };
    },
};

// ---------------------------------------------------------------------------
// Ayuda para entrar
// ---------------------------------------------------------------------------

const sendLoginHelp: AdminToolDef = {
    name: "send_login_help",
    title: "Ayuda para entrar",
    description:
        "Reenvía a un usuario, SIEMPRE a su correo registrado (nunca a otro): verification_email (verificar el correo de su organización), " +
        "magic_link (link de acceso directo, 30 min) o password_reset (link para crear una contraseña nueva). Para \"no puedo entrar\" o \"no me llegó el correo\". " +
        "Busca por user_id o email (ver search_users / get_organization).",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: {
            user_id: { type: "integer", minimum: 1 },
            email: { type: "string", maxLength: 254 },
            kind: { type: "string", enum: ["verification_email", "magic_link", "password_reset"] },
        },
    },
    audit: (args, result: any) => ({ organization_id: result?.organization_id ?? null, target: result?.user_id ? `user:${result.user_id}` : undefined, summary: `Ayuda para entrar: ${args.kind}` }),
    async handler(args, actx) {
        if (Boolean(args.user_id) === Boolean(args.email)) throw new ToolError("invalid_input", "Indica user_id o email (uno de los dos).");
        let q = actx.supabase.from("users").select("id, name, email, organization_id, auth_user_id, active");
        q = args.user_id ? q.eq("id", args.user_id) : q.ilike("email", String(args.email).trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`));
        const { data: user, error } = await q.maybeSingle();
        if (error) throw error;
        if (!user) throw new ToolError("not_found", "No existe ese usuario. Revisa el correo o usa search_users.");
        if (user.active === false) throw new ToolError("conflict", "El usuario está desactivado en su organización: reactívalo antes (org_update_member_role / panel de equipo).");
        if (!user.auth_user_id) throw new ToolError("conflict", "El usuario no tiene cuenta de acceso (nunca se registró o es una cuenta de servicio).");
        const { data: authData } = await actx.supabase.auth.admin.getUserById(user.auth_user_id);
        const authUser = authData?.user;
        // El correo solo va a la dirección de la cuenta de Auth y debe coincidir con la de public.users
        if (!authUser?.email || authUser.email.toLowerCase() !== String(user.email || "").toLowerCase()) {
            throw new ToolError("conflict", "El correo de la cuenta de acceso no coincide con el del usuario: revísalo a mano en Supabase Auth.");
        }
        const base = { user_id: Number(user.id), organization_id: user.organization_id != null ? Number(user.organization_id) : null, sent_to: authUser.email };

        if (args.kind === "verification_email") {
            if (!user.organization_id) throw new ToolError("conflict", "El usuario no tiene organización.");
            const { verified } = await getOrgVerification(Number(user.organization_id));
            if (verified !== false) throw new ToolError("conflict", "El correo de esa organización ya está verificado: usa magic_link o password_reset.");
            const org = await loadOrganization<any>(actx, Number(user.organization_id), "id, public_name");
            await sendVerificationEmail({ uid: authUser.id, email: authUser.email, name: user.name, orgName: org.public_name });
            return { ...base, kind: args.kind, sent: true, note: "El enlace de verificación vence en 48 horas." };
        }

        if (!isAiticketsIdentity(authUser as any, true)) throw new ToolError("conflict", "Esa cuenta de acceso no es de AI Tickets.");
        const purpose = args.kind === "magic_link" ? "login" : "recovery";
        if (!(await reserveAuthLinkSend(authUser.id, purpose))) {
            throw new ToolError("rate_limited", "Ya se enviaron varios enlaces a ese usuario hace poco (máx. 3 por hora, 1 por minuto). Espera unos minutos.");
        }
        await sendMagicLinkEmail({ uid: authUser.id, email: authUser.email, name: user.name, purpose });
        return { ...base, kind: args.kind, sent: true, note: "El enlace vence en 30 minutos y sirve una vez." };
    },
};

export const operationTools: AdminToolDef[] = [
    verifyPayoutAccount,
    markPayoutPaid,
    markPayoutFailed,
    markRefundCompleted,
    markRefundFailed,
    moderateReview,
    updateOrganization,
    addOrganizationNote,
    listOrganizationNotes,
    sendLoginHelp,
];
