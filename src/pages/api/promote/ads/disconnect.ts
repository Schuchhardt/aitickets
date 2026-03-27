import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionUser } from "../../../../lib/supabaseServer";

export const POST: APIRoute = async (context) => {
    const user = await getSessionUser(context);
    if (!user) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 });
    }

    try {
        const body = await context.request.json();
        const { connectionId } = body;

        if (!connectionId) {
            return new Response(JSON.stringify({ message: "ID de conexión requerido" }), { status: 400 });
        }

        const supabaseAdmin = getSupabaseAdmin();

        const { data: dbUser } = await supabaseAdmin
            .from("users")
            .select("organization_id")
            .eq("auth_user_id", user.id)
            .single();

        if (!dbUser?.organization_id) {
            return new Response(JSON.stringify({ message: "Organización no encontrada" }), { status: 404 });
        }

        // Verify ownership and get connection
        const { data: connection } = await supabaseAdmin
            .from("ad_account_connections")
            .select("*")
            .eq("id", connectionId)
            .eq("organization_id", dbUser.organization_id)
            .single();

        if (!connection) {
            return new Response(JSON.stringify({ message: "Conexión no encontrada" }), { status: 404 });
        }

        // Check if there are active campaigns using this connection
        const { count: activeCampaigns } = await supabaseAdmin
            .from("ad_campaigns")
            .select("id", { count: "exact", head: true })
            .eq("ad_account_connection_id", connectionId)
            .in("status", ["active", "pending_review"]);

        if (activeCampaigns && activeCampaigns > 0) {
            return new Response(JSON.stringify({ 
                message: "No puedes desconectar mientras tienes campañas activas. Pausa tus campañas primero." 
            }), { status: 400 });
        }

        // Delete connection
        const { error } = await supabaseAdmin
            .from("ad_account_connections")
            .delete()
            .eq("id", connectionId)
            .eq("organization_id", dbUser.organization_id);

        if (error) {
            console.error("Disconnect ad account error:", error);
            return new Response(JSON.stringify({ message: "Error al desconectar cuenta" }), { status: 500 });
        }

        return new Response(JSON.stringify({ message: "Cuenta de Meta Ads desconectada" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Disconnect ad account error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};
