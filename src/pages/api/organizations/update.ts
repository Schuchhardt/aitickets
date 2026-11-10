import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, ORG_ADMIN_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { notifySlack } from "../_lib/server-utils";
import { syncOrganizerLegalData } from "../../../lib/producerIdentity";
import { roleAllows } from "../../../lib/producer-api/permissions";

// Campos editables de la organización (public.organizations) y su largo máximo
const ORG_FIELDS: Record<string, number> = {
    public_name: 150,
    email: 200,
    phone: 50,
};

// Datos para pagos (public.organization_payout_accounts, migración 20260926_C_dashboard).
// Tabla aparte con RLS sin políticas: solo se accede desde aquí con la service role.
const PAYOUT_FIELDS: Record<string, number> = {
    legal_name: 200,
    legal_rut: 20,
    bank_name: 100,
    bank_account_type: 50,
    bank_account_number: 50,
    bank_account_holder: 150,
    bank_account_rut: 20,
};

const RUT_REGEX = /^[0-9]{1,2}\.?[0-9]{3}\.?[0-9]{3}-?[0-9kK]$/;

/** Aviso informativo a AI Tickets de una cuenta registrada o cambiada (solo los últimos 4 dígitos). No hay nada que verificar. */
function bankAccountSlackMessage(
    org: { id: number; name?: string | null },
    user: { id: number; name?: string | null; email?: string | null },
    bankName: string | null | undefined,
    accountNumber: string,
) {
    const last4 = String(accountNumber || "").replace(/\D/g, "").slice(-4);
    const who = [user.name, user.email].filter(Boolean).join(" · ") || "sin nombre";
    return (
        `🏦 *Cuenta bancaria actualizada*\n` +
        `• *Organización:* ${org.name || "sin nombre"} (#${org.id})\n` +
        `• *Usuario:* ${who} (#${user.id})\n` +
        `• *Cuenta:* ${bankName || "banco"} ****${last4}`
    );
}

function pickFields(body: any, fields: Record<string, number>) {
    const out: Record<string, string | null> = {};
    for (const [field, max] of Object.entries(fields)) {
        if (body?.[field] === undefined) continue;
        const value = body[field] === null ? "" : String(body[field]).trim().slice(0, max);
        out[field] = value || null;
    }
    return out;
}

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    // Finanzas puede editar solo los datos de pago; el perfil de la organización, dueño y administradores
    const isOrgAdmin = hasRole(dbUser, ORG_ADMIN_ROLES);
    if (!isOrgAdmin && !hasRole(dbUser, ["finance"])) {
        return jsonResponse({ message: "Solo los administradores pueden editar la organización" }, 403);
    }

    try {
        const body = await context.request.json();
        // Compatibilidad: el formulario antiguo enviaba legal_id como RUT de la empresa
        if (body && body.legal_rut === undefined && body.legal_id !== undefined) body.legal_rut = body.legal_id;

        const orgData = pickFields(body, ORG_FIELDS);
        const payoutData = pickFields(body, PAYOUT_FIELDS);

        if (!isOrgAdmin && Object.keys(orgData).length) {
            return jsonResponse({ message: "Tu rol solo permite editar los datos para pagos" }, 403);
        }
        // Datos para pagos (cuenta bancaria donde se transfieren los retiros): solo el dueño y finanzas (finance.manage),
        // como dice la regla de roles. Antes un administrador también podía cambiar la cuenta.
        if (Object.keys(payoutData).length && !roleAllows(dbUser.role, "finance.manage")) {
            return jsonResponse({ message: "Solo el dueño de la cuenta o finanzas pueden cambiar los datos para pagos" }, 403);
        }
        if ("public_name" in orgData && !orgData.public_name) {
            return jsonResponse({ message: "El nombre de la organización es obligatorio" }, 400);
        }
        if (payoutData.bank_account_rut && !RUT_REGEX.test(payoutData.bank_account_rut)) {
            return jsonResponse({ message: "RUT del titular inválido (ej: 12.345.678-9)" }, 400);
        }
        if (payoutData.legal_rut && !RUT_REGEX.test(payoutData.legal_rut)) {
            return jsonResponse({ message: "RUT de la empresa inválido (ej: 76.123.456-7)" }, 400);
        }
        if (!Object.keys(orgData).length && !Object.keys(payoutData).length) {
            return jsonResponse({ message: "Nada que actualizar" }, 400);
        }

        const supabaseAdmin = getSupabaseAdmin();

        if (Object.keys(orgData).length) {
            const { error } = await supabaseAdmin
                .from("organizations")
                .update(orgData)
                .eq("id", dbUser.organization_id);
            if (error) throw error;
        }

        if (Object.keys(payoutData).length) {
            const BANK_FIELDS = ["bank_name", "bank_account_type", "bank_account_number", "bank_account_holder", "bank_account_rut"];
            const { data: before } = await supabaseAdmin
                .from("organization_payout_accounts")
                .select(BANK_FIELDS.join(", "))
                .eq("organization_id", dbUser.organization_id)
                .maybeSingle();
            const { error } = await supabaseAdmin
                .from("organization_payout_accounts")
                .upsert(
                    {
                        ...payoutData,
                        organization_id: dbUser.organization_id,
                        updated_at: new Date().toISOString(),
                        updated_by: dbUser.id,
                    },
                    { onConflict: "organization_id" }
                );
            if (error) throw error;
            const bankChanged = BANK_FIELDS.some((f) => f in payoutData && (payoutData[f] ?? null) !== ((before as any)?.[f] ?? null));
            // Razón social y RUT visibles en la página del evento; titular de la cuenta = identidad verificada (§2 bis)
            await syncOrganizerLegalData(supabaseAdmin, Number(dbUser.organization_id), payoutData);
            // La cuenta no se verifica: solo se avisa a AI Tickets que cambió (informativo, no hay nada que aprobar).
            if (bankChanged) {
                const { data: saved } = await supabaseAdmin
                    .from("organization_payout_accounts")
                    .select("bank_name, bank_account_number")
                    .eq("organization_id", dbUser.organization_id)
                    .maybeSingle();
                if (saved?.bank_account_number) {
                    const { data: org } = await supabaseAdmin.from("organizations").select("public_name").eq("id", dbUser.organization_id).maybeSingle();
                    await notifySlack(
                        bankAccountSlackMessage(
                            { id: Number(dbUser.organization_id), name: org?.public_name },
                            { id: Number(dbUser.id), name: dbUser.name, email: dbUser.email },
                            saved.bank_name,
                            saved.bank_account_number,
                        ),
                    );
                }
            }
        }

        return jsonResponse({ message: "Organización actualizada" }, 200);
    } catch (error: any) {
        console.error("Organization update error:", error);
        return jsonResponse({ message: "Error al actualizar la organización" }, 500);
    }
};
