import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionUser } from "../../../lib/supabaseServer";

export const POST: APIRoute = async (context) => {
    const user = await getSessionUser(context);
    if (!user) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 });
    }

    try {
        const body = await context.request.json();
        const { accountId } = body;

        if (!accountId) {
            return new Response(JSON.stringify({ message: "ID de cuenta requerido" }), { status: 400 });
        }

        const supabaseAdmin = getSupabaseAdmin();

        // Verify ownership
        const { data: dbUser } = await supabaseAdmin
            .from("users")
            .select("organization_id")
            .eq("auth_user_id", user.id)
            .single();

        if (!dbUser?.organization_id) {
            return new Response(JSON.stringify({ message: "Organización no encontrada" }), { status: 404 });
        }

        // Get the Zernio account ID before deleting locally
        const { data: account } = await supabaseAdmin
            .from("social_accounts")
            .select("zernio_account_id")
            .eq("id", accountId)
            .eq("organization_id", dbUser.organization_id)
            .single();

        if (!account) {
            return new Response(JSON.stringify({ message: "Cuenta no encontrada" }), { status: 404 });
        }

        // Disconnect from Zernio
        if (account.zernio_account_id) {
            const apiKey = import.meta.env.ZERNIO_API_KEY;
            if (apiKey) {
                await fetch(`https://zernio.com/api/v1/accounts/${account.zernio_account_id}`, {
                    method: "DELETE",
                    headers: { "Authorization": `Bearer ${apiKey}` },
                }).catch((err) => console.error("Zernio disconnect error:", err));
            }
        }

        // Delete locally
        const { error } = await supabaseAdmin
            .from("social_accounts")
            .delete()
            .eq("id", accountId)
            .eq("organization_id", dbUser.organization_id);

        if (error) {
            console.error("Disconnect error:", error);
            return new Response(JSON.stringify({ message: "Error al desconectar cuenta" }), { status: 500 });
        }

        return new Response(JSON.stringify({ message: "Cuenta desconectada exitosamente" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Disconnect error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};
