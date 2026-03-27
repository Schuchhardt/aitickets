import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionUser } from "../../../../lib/supabaseServer";
import { decryptToken } from "../../../../lib/crypto";

export const POST: APIRoute = async (context) => {
    const user = await getSessionUser(context);
    if (!user) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 });
    }

    try {
        const body = await context.request.json();
        const { campaignId, action } = body; // action: 'activate' | 'pause'

        if (!campaignId || !["activate", "pause"].includes(action)) {
            return new Response(JSON.stringify({ message: "Datos inválidos" }), { status: 400 });
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

        // Get campaign with ad account connection
        const { data: campaign } = await supabaseAdmin
            .from("ad_campaigns")
            .select("*, ad_account_connections(*)")
            .eq("id", campaignId)
            .eq("organization_id", dbUser.organization_id)
            .single();

        if (!campaign) {
            return new Response(JSON.stringify({ message: "Campaña no encontrada" }), { status: 404 });
        }

        if (!campaign.meta_campaign_id) {
            return new Response(JSON.stringify({ message: "Campaña no tiene ID en Meta" }), { status: 400 });
        }

        const rawToken = campaign.ad_account_connections?.access_token;
        if (!rawToken) {
            return new Response(JSON.stringify({ message: "Token de acceso no disponible" }), { status: 400 });
        }
        const accessToken = decryptToken(rawToken);

        const metaStatus = action === "activate" ? "ACTIVE" : "PAUSED";

        // Update campaign status in Meta
        const campaignRes = await fetch(`https://graph.facebook.com/v21.0/${campaign.meta_campaign_id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                status: metaStatus,
                access_token: accessToken,
            }),
        });

        if (!campaignRes.ok) {
            const err = await campaignRes.json().catch(() => ({}));
            console.error("Meta campaign status update error:", err);
            return new Response(JSON.stringify({ message: err.error?.message || "Error al actualizar campaña en Meta" }), { status: 502 });
        }

        // Also update adset if exists
        if (campaign.meta_adset_id) {
            await fetch(`https://graph.facebook.com/v21.0/${campaign.meta_adset_id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: metaStatus, access_token: accessToken }),
            });
        }

        // Also update ad if exists
        if (campaign.meta_ad_id) {
            await fetch(`https://graph.facebook.com/v21.0/${campaign.meta_ad_id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: metaStatus, access_token: accessToken }),
            });
        }

        // Update local DB
        const newStatus = action === "activate" ? "active" : "paused";
        await supabaseAdmin
            .from("ad_campaigns")
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq("id", campaignId);

        return new Response(JSON.stringify({ 
            message: action === "activate" ? "Campaña activada" : "Campaña pausada",
            status: newStatus
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Campaign status error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};
