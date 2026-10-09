import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, ORG_ADMIN_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { notifySlack } from "../_lib/server-utils";

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
            const bankChanged = ["bank_name", "bank_account_type", "bank_account_number", "bank_account_holder", "bank_account_rut"].some((f) => f in payoutData);
            // El trigger de la BD anula la verificación solo si los datos cambiaron; se avisa a AI Tickets para revisarlos
            if (bankChanged) await notifySlack(`🏦 *Datos bancarios guardados* (org ${dbUser.organization_id}, usuario ${dbUser.id}, banco ${payoutData.bank_name || "—"}). Si cambiaron, verificar la cuenta (organization_payout_accounts.verified_at).`);
        }

        return jsonResponse({ message: "Organización actualizada" }, 200);
    } catch (error: any) {
        console.error("Organization update error:", error);
        return jsonResponse({ message: "Error al actualizar la organización" }, 500);
    }
};
