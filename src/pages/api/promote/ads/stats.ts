import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES } from "../../../../lib/supabaseServer";
import { decryptToken } from "../../../../lib/crypto";

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 });
    }
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) {
        return new Response(JSON.stringify({ message: "No tienes permisos para esta acción" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    const user = session.authUser;

    try {
        const body = await context.request.json();
        const { campaignId } = body;

        const supabaseAdmin = getSupabaseAdmin();

        const dbUser = session.dbUser;

        if (!dbUser?.organization_id) {
            return new Response(JSON.stringify({ message: "Organización no encontrada" }), { status: 404 });
        }

        // Build query
        let query = supabaseAdmin
            .from("ad_campaigns")
            .select("*, ad_account_connections(access_token, meta_ad_account_id)")
            .eq("organization_id", dbUser.organization_id);

        if (campaignId) {
            query = query.eq("id", campaignId);
        }

        const { data: campaigns, error } = campaignId 
            ? await query.single().then(r => ({ data: r.data ? [r.data] : [], error: r.error }))
            : await query;

        if (error || !campaigns?.length) {
            return new Response(JSON.stringify({ campaigns: [], message: "Sin campañas" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Sync stats from Meta for active campaigns
        const updatedCampaigns = [];
        for (const campaign of campaigns) {
            if (campaign.meta_campaign_id && campaign.ad_account_connections?.access_token &&
                ["active", "paused", "completed"].includes(campaign.status)) {
                
                const accessToken = decryptToken(campaign.ad_account_connections.access_token);
                try {
                    const insightsRes = await fetch(
                        `https://graph.facebook.com/v21.0/${campaign.meta_campaign_id}/insights?fields=impressions,clicks,spend,reach,actions,cpc,cpm&access_token=${accessToken}`
                    );

                    if (insightsRes.ok) {
                        const insightsData = await insightsRes.json();
                        const insight = insightsData.data?.[0];

                        if (insight) {
                            const conversions = insight.actions?.find((a: any) => a.action_type === "offsite_conversion")?.value || 0;

                            const statsUpdate = {
                                impressions: parseInt(insight.impressions) || 0,
                                clicks: parseInt(insight.clicks) || 0,
                                spend: parseFloat(insight.spend) || 0,
                                reach: parseInt(insight.reach) || 0,
                                conversions: parseInt(conversions),
                                cpc: parseFloat(insight.cpc) || 0,
                                cpm: parseFloat(insight.cpm) || 0,
                                last_synced_at: new Date().toISOString(),
                            };

                            await supabaseAdmin
                                .from("ad_campaigns")
                                .update(statsUpdate)
                                .eq("id", campaign.id);

                            Object.assign(campaign, statsUpdate);
                        }
                    }
                } catch (e) {
                    console.error(`Sync stats failed for campaign ${campaign.id}:`, e);
                }
            }

            // Remove sensitive data before returning
            const { ad_account_connections, ...safeData } = campaign;
            updatedCampaigns.push(safeData);
        }

        return new Response(JSON.stringify({ campaigns: updatedCampaigns }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Campaign stats error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};
