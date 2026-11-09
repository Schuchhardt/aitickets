// Herramientas de admin: verificación de identidad y cuenta bancaria.
// Cola de verificaciones pendientes, consulta/override de identidad (Didit), envío de enlace de verificación
// y solicitud de corrección de datos bancarios al productor.
import { ToolError, type JsonSchema } from "../../producer-api/registry";
import {
    loadOrgIdentity,
    identityApproved,
    orgExceedsFreeSoldTickets,
    IDENTITY_STATUS_LABELS,
    syncIdentityFromDidit,
    recomputeHolderMatch,
} from "../../producerIdentity";
import { notifySlack } from "../../../pages/api/_lib/server-utils";
import { sendEmail, formatRecipient, isValidEmail } from "../../../../netlify/lib/mailer.mjs";
import { loadOrganization, type AdminContext } from "../context";
import { type AdminToolDef } from "../registry";
import { loadPayoutAccountRow, orgNames, ledgerTotals } from "./finance";

const isMissing = (error: any) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String(error?.code || ""));

const organizationIdSchema: JsonSchema = { type: "integer", minimum: 1, description: "ID de la organización (ver search_organizations)." };

// ────────────────────── get_verification_queue ──────────────────────

const getVerificationQueue: AdminToolDef = {
    name: "get_verification_queue",
    title: "Cola de verificaciones pendientes",
    description:
        "Organizaciones con verificaciones pendientes (identidad o cuenta bancaria), ordenadas por saldo retenido " +
        "(las que más plata retienen primero). Muestra qué falta (identidad, cuenta) y cuánto tiene retenido.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
    },
    async handler(args, actx) {
        const limit = args.limit || 20;

        // Orgs con identidad != approved (que tengan algún estado, no null puro sin interacción)
        const { data: identityPending, error: ipErr } = await actx.supabase
            .from("organizations")
            .select("id, identity_status")
            .neq("identity_status", "approved")
            .not("identity_status", "is", null)
            .order("id", { ascending: true })
            .limit(200);
        if (ipErr && !isMissing(ipErr)) throw ipErr;

        // Orgs con cuenta bancaria sin verificar (que tengan datos ingresados)
        const { data: bankPending, error: bpErr } = await actx.supabase
            .from("organization_payout_accounts")
            .select("organization_id")
            .is("verified_at", null)
            .not("bank_account_number", "is", null)
            .is("removed_at", null)
            .limit(200);
        if (bpErr && !isMissing(bpErr)) throw bpErr;

        const allOrgIds = [...new Set([
            ...(identityPending || []).map((o: any) => Number(o.id)),
            ...(bankPending || []).map((o: any) => Number(o.organization_id)),
        ])];

        if (!allOrgIds.length) return { queue: [], count: 0 };

        const names = await orgNames(actx.supabase, allOrgIds);

        const identityMap = new Map((identityPending || []).map((o: any) => [Number(o.id), o.identity_status as string]));
        const bankSet = new Set((bankPending || []).map((o: any) => Number(o.organization_id)));

        const queue = allOrgIds.map(id => {
            const issues: string[] = [];
            if (identityMap.has(id)) issues.push("identity_pending");
            if (bankSet.has(id)) issues.push("bank_unverified");
            return {
                organization_id: id,
                name: names.get(id) || `Org ${id}`,
                issues,
                identity_status: identityMap.get(id) || null,
            };
        }).filter(p => p.issues.length > 0);

        const totals = await ledgerTotals(actx.supabase, queue.map(q => q.organization_id));

        const enriched = queue.map(p => {
            const t = totals.get(p.organization_id);
            return {
                ...p,
                held_clp: t?.held || 0,
                pending_clp: t?.pending || 0,
                available_clp: t?.available || 0,
            };
        }).filter(p => p.held_clp > 0 || p.pending_clp > 0)
          .sort((a, b) => b.held_clp - a.held_clp)
          .slice(0, limit);

        return { queue: enriched, count: enriched.length };
    },
};

// ────────────────────── get_identity_verification ──────────────────────

const getIdentityVerification: AdminToolDef = {
    name: "get_identity_verification",
    title: "Estado de verificación de identidad",
    description:
        "Estado de la verificación de identidad (Didit) de una organización: nombre verificado, RUT (últimos 4), " +
        "fecha, estado, si excede el umbral de entradas vendidas, y si el titular de la cuenta coincide.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["organization_id"],
        properties: { organization_id: organizationIdSchema },
    },
    async handler(args, actx) {
        const org = await loadOrgIdentity(actx.supabase, args.organization_id);
        if (!org) throw new ToolError("not_found", `No existe la organización ${args.organization_id}.`);

        const [exceedsThreshold, acc] = await Promise.all([
            orgExceedsFreeSoldTickets(actx.supabase, args.organization_id).catch(() => false),
            loadPayoutAccountRow(actx.supabase, args.organization_id),
        ]);

        return {
            organization_id: args.organization_id,
            identity_status: org.identity_status,
            identity_status_label: org.identity_status
                ? (IDENTITY_STATUS_LABELS[org.identity_status] || org.identity_status)
                : "Sin verificar",
            identity_name: org.identity_name || null,
            identity_rut: org.identity_rut
                ? `••••${org.identity_rut.replace(/[^0-9kK]/g, "").slice(-4)}`
                : null,
            identity_kind: org.identity_kind || null,
            identity_verified_at: org.identity_verified_at || null,
            identity_required: exceedsThreshold,
            holder_match_status: acc?.holder_match_status || null,
            bank_verified: Boolean(acc?.verified_at),
            legal_name: org.legal_name || null,
            legal_id: org.legal_id
                ? `••••${org.legal_id.replace(/[^0-9kK]/g, "").slice(-4)}`
                : null,
        };
    },
};

// ────────────────────── set_identity_verification ──────────────────────

const setIdentityVerification: AdminToolDef = {
    name: "set_identity_verification",
    title: "Aprobar o rechazar identidad manualmente",
    description:
        "Override manual de la verificación de identidad (Didit). decision: approve = aprueba directamente, " +
        "reject = rechaza y deja pendiente, sync = consulta a Didit y aplica la decisión actual. " +
        "Tras aprobar, recalcula el holder_match_status de la cuenta bancaria. Pide confirmación.",
    readOnly: false,
    idempotent: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["organization_id", "decision"],
        properties: {
            organization_id: organizationIdSchema,
            decision: { type: "string", enum: ["approve", "reject", "sync"] },
            notes: { type: "string", maxLength: 500, description: "Notas internas sobre la decisión." },
        },
    },
    async confirm(args, actx) {
        const org = await loadOrgIdentity(actx.supabase, args.organization_id);
        if (!org) throw new ToolError("not_found", `No existe la organización ${args.organization_id}.`);
        const orgInfo = await loadOrganization<any>(actx, args.organization_id, "id, public_name");

        const actionLabel = args.decision === "approve"
            ? "APROBAR"
            : args.decision === "reject"
                ? "RECHAZAR"
                : "SINCRONIZAR con Didit";
        return {
            message:
                `${actionLabel} la identidad de ${orgInfo.public_name} (#${args.organization_id}). ` +
                `Estado actual: ${org.identity_status || "sin verificar"}.` +
                (args.notes ? ` Notas: "${args.notes}".` : ""),
            details: {
                organization_id: args.organization_id,
                current_status: org.identity_status,
                decision: args.decision,
            },
        };
    },
    audit: (args) => ({
        organization_id: args.organization_id,
        target: `org:${args.organization_id}`,
        summary: `Identidad ${args.decision === "approve" ? "aprobada" : args.decision === "reject" ? "rechazada" : "sincronizada"} manualmente`,
    }),
    async handler(args, actx) {
        if (args.decision === "sync") {
            const newStatus = await syncIdentityFromDidit(actx.supabase, args.organization_id);
            return {
                organization_id: args.organization_id,
                decision: "sync",
                new_status: newStatus,
                note: newStatus
                    ? `Sincronizado: ${IDENTITY_STATUS_LABELS[newStatus] || newStatus}`
                    : "Sin cambios (no hay sesión Didit o ya estaba aprobada).",
            };
        }

        const now = new Date().toISOString();
        const patch: Record<string, unknown> = {
            identity_status: args.decision === "approve" ? "approved" : "declined",
            identity_checked_at: now,
        };
        if (args.decision === "approve") {
            const org = await loadOrgIdentity(actx.supabase, args.organization_id);
            patch.identity_verified_at = org?.identity_verified_at || now;
        } else {
            patch.identity_verified_at = null;
        }

        const { error } = await actx.supabase.from("organizations").update(patch).eq("id", args.organization_id);
        if (error) throw error;

        if (args.decision === "approve") {
            await recomputeHolderMatch(actx.supabase, args.organization_id).catch(() => null);
        }

        await notifySlack(
            `🪪 *Identidad ${args.decision === "approve" ? "aprobada" : "rechazada"} manualmente (Admin)* · ` +
            `org ${args.organization_id}${args.notes ? ` · ${args.notes}` : ""}`,
        );

        return {
            organization_id: args.organization_id,
            decision: args.decision,
            new_status: patch.identity_status,
            notes: args.notes || null,
        };
    },
};

// ────────────────────── send_identity_verification_link ──────────────────────

const sendIdentityVerificationLink: AdminToolDef = {
    name: "send_identity_verification_link",
    title: "Enviar enlace de verificación de identidad",
    description:
        "Envía al productor (dueños de la organización) un correo con el enlace para iniciar la verificación de " +
        "identidad (Didit). Usa el correo de los dueños activos de la organización.",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["organization_id"],
        properties: { organization_id: organizationIdSchema },
    },
    audit: (args) => ({
        organization_id: args.organization_id,
        target: `org:${args.organization_id}`,
        summary: "Enlace de verificación de identidad enviado",
    }),
    async handler(args, actx) {
        const org = await loadOrganization<any>(actx, args.organization_id, "id, public_name, identity_status");
        if (org.identity_status === "approved") {
            throw new ToolError("conflict", `La identidad de ${org.public_name} ya está aprobada.`);
        }

        const { data: users, error: uErr } = await actx.supabase
            .from("users")
            .select("id, name, email, role, active")
            .eq("organization_id", args.organization_id)
            .eq("role", "producer")
            .order("id", { ascending: true });
        if (uErr) throw uErr;

        const owners = (users || []).filter((u: any) => u.active !== false && isValidEmail(u.email));
        if (!owners.length) {
            throw new ToolError("conflict", `No hay dueños activos con correo válido en ${org.public_name}.`);
        }

        const verificationUrl = `${actx.origin}/dashboard/settings#identidad`;
        const to = owners.map((u: any) => formatRecipient(u.name || "", u.email));

        await sendEmail({
            to,
            subject: "Verifica tu identidad en AI Tickets",
            html:
                `<p>Hola,</p>` +
                `<p>Para que puedas retirar los fondos de <strong>${org.public_name}</strong>, necesitamos verificar tu identidad.</p>` +
                `<p><a href="${verificationUrl}">Verificar identidad</a></p>` +
                `<p>El proceso toma menos de 5 minutos.</p>` +
                `<p>— AI Tickets</p>`,
            text:
                `Hola,\n\n` +
                `Para que puedas retirar los fondos de ${org.public_name}, necesitamos verificar tu identidad.\n\n` +
                `Verificar identidad: ${verificationUrl}\n\n` +
                `El proceso toma menos de 5 minutos.\n\n` +
                `— AI Tickets`,
            tags: ["identity", "verification-link"],
        });

        return { organization_id: args.organization_id, sent_to: to.length, recipients: to };
    },
};

// ────────────────────── request_payout_account_update ──────────────────────

const requestPayoutAccountUpdate: AdminToolDef = {
    name: "request_payout_account_update",
    title: "Pedir al productor que corrija sus datos bancarios",
    description:
        "Envía un correo al productor pidiéndole que revise y corrija sus datos bancarios (cuenta cerrada, datos " +
        "erróneos, RUT no coincide). Incluye un enlace directo a la sección de datos bancarios del panel.",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["organization_id", "notes"],
        properties: {
            organization_id: organizationIdSchema,
            notes: { type: "string", minLength: 5, maxLength: 500, description: "Qué debe corregir el productor (se incluye en el correo)." },
        },
    },
    audit: (args) => ({
        organization_id: args.organization_id,
        target: `org:${args.organization_id}`,
        summary: "Solicitud de corrección de datos bancarios enviada",
    }),
    async handler(args, actx) {
        const org = await loadOrganization<any>(actx, args.organization_id, "id, public_name");

        const { data: users, error: uErr } = await actx.supabase
            .from("users")
            .select("id, name, email, role, active")
            .eq("organization_id", args.organization_id)
            .eq("role", "producer")
            .order("id", { ascending: true });
        if (uErr) throw uErr;

        const owners = (users || []).filter((u: any) => u.active !== false && isValidEmail(u.email));
        if (!owners.length) {
            throw new ToolError("conflict", `No hay dueños activos con correo válido en ${org.public_name}.`);
        }

        const settingsUrl = `${actx.origin}/dashboard/settings#datos-bancarios`;
        const to = owners.map((u: any) => formatRecipient(u.name || "", u.email));

        await sendEmail({
            to,
            subject: "Revisa tus datos bancarios en AI Tickets",
            html:
                `<p>Hola,</p>` +
                `<p>Necesitamos que revises los datos bancarios de <strong>${org.public_name}</strong> para poder transferirte tus fondos.</p>` +
                `<p><strong>Motivo:</strong> ${args.notes}</p>` +
                `<p><a href="${settingsUrl}">Revisar datos bancarios</a></p>` +
                `<p>— AI Tickets</p>`,
            text:
                `Hola,\n\n` +
                `Necesitamos que revises los datos bancarios de ${org.public_name} para poder transferirte tus fondos.\n\n` +
                `Motivo: ${args.notes}\n\n` +
                `Revisar datos bancarios: ${settingsUrl}\n\n` +
                `— AI Tickets`,
            tags: ["payout-account", "update-request"],
        });

        return { organization_id: args.organization_id, sent_to: to.length, recipients: to, notes: args.notes };
    },
};

// ────────────────────── export ──────────────────────

export const verificationTools: AdminToolDef[] = [
    getVerificationQueue,
    getIdentityVerification,
    setIdentityVerification,
    sendIdentityVerificationLink,
    requestPayoutAccountUpdate,
];
