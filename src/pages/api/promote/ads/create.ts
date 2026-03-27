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
        const {
            eventId, adConnectionId, name, objective, dailyBudget, totalBudget,
            startDate, endDate, adCopy, headline, imageUrls,
            callToAction, destinationUrl, targetAudience
        } = body;

        if (!eventId || !name || !dailyBudget || !adCopy || !destinationUrl) {
            return new Response(JSON.stringify({ message: "Faltan datos requeridos" }), { status: 400 });
        }

        if (dailyBudget < 1000) { // Min $1000 CLP ~= $1 USD
            return new Response(JSON.stringify({ message: "El presupuesto diario mínimo es $1.000 CLP" }), { status: 400 });
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

        // Verify event ownership
        const { data: event } = await supabaseAdmin
            .from("events")
            .select("id, slug")
            .eq("id", eventId)
            .eq("organization_id", dbUser.organization_id)
            .single();

        if (!event) {
            return new Response(JSON.stringify({ message: "Evento no encontrado" }), { status: 404 });
        }

        // Get connected Meta ad account (specific or first active)
        let adConnectionQuery = supabaseAdmin
            .from("ad_account_connections")
            .select("*")
            .eq("organization_id", dbUser.organization_id)
            .eq("platform", "meta")
            .eq("status", "active");

        if (adConnectionId) {
            adConnectionQuery = adConnectionQuery.eq("id", adConnectionId);
        }

        const { data: adConnection } = await adConnectionQuery.limit(1).single();

        if (!adConnection) {
            return new Response(JSON.stringify({ message: "No hay cuenta de Meta Ads conectada" }), { status: 400 });
        }

        // Check token expiration
        if (adConnection.token_expires_at && new Date(adConnection.token_expires_at) < new Date()) {
            await supabaseAdmin
                .from("ad_account_connections")
                .update({ status: "expired" })
                .eq("id", adConnection.id);
            return new Response(JSON.stringify({ message: "Token de Meta expirado. Reconecta tu cuenta." }), { status: 401 });
        }

        const accessToken = decryptToken(adConnection.access_token);
        const adAccountId = adConnection.meta_ad_account_id;

        // 1. Create Campaign in Meta
        const campaignRes = await fetch(`https://graph.facebook.com/v21.0/${adAccountId}/campaigns`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: name,
                objective: objective || "OUTCOME_TRAFFIC",
                status: "PAUSED",
                special_ad_categories: [],
                access_token: accessToken,
            }),
        });

        if (!campaignRes.ok) {
            const err = await campaignRes.json().catch(() => ({}));
            console.error("Meta campaign create error:", err);
            // Save as draft anyway
            const { data: campaign } = await supabaseAdmin
                .from("ad_campaigns")
                .insert({
                    organization_id: dbUser.organization_id,
                    event_id: eventId,
                    ad_account_connection_id: adConnection.id,
                    name, objective: objective || "OUTCOME_TRAFFIC",
                    status: "rejected",
                    daily_budget: dailyBudget, total_budget: totalBudget,
                    currency: "CLP", start_date: startDate, end_date: endDate,
                    ad_copy: adCopy, headline, image_urls: imageUrls || [],
                    call_to_action: callToAction || "LEARN_MORE",
                    destination_url: destinationUrl,
                    target_audience: targetAudience || {},
                    error_message: err.error?.message || "Error al crear campaña en Meta",
                })
                .select()
                .single();

            return new Response(JSON.stringify({ 
                message: "Error al crear campaña en Meta. Guardada como borrador.",
                id: campaign?.id,
                error: err.error?.message
            }), { status: 502 });
        }

        const campaignData = await campaignRes.json();
        const metaCampaignId = campaignData.id;

        // 2. Create Ad Set
        const budgetCents = Math.round(dailyBudget * 100); // Meta uses cents
        const adSetPayload: Record<string, any> = {
            name: `${name} - AdSet`,
            campaign_id: metaCampaignId,
            daily_budget: budgetCents,
            billing_event: "IMPRESSIONS",
            optimization_goal: "LINK_CLICKS",
            bid_strategy: "LOWEST_COST_WITHOUT_CAP",
            status: "PAUSED",
            access_token: accessToken,
            targeting: buildMetaTargeting(targetAudience),
        };

        if (startDate) adSetPayload.start_time = new Date(startDate).toISOString();
        if (endDate) adSetPayload.end_time = new Date(endDate).toISOString();
        if (totalBudget) adSetPayload.lifetime_budget = Math.round(totalBudget * 100);

        const adSetRes = await fetch(`https://graph.facebook.com/v21.0/${adAccountId}/adsets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(adSetPayload),
        });

        let metaAdsetId = null;
        if (adSetRes.ok) {
            const adSetData = await adSetRes.json();
            metaAdsetId = adSetData.id;
        } else {
            console.error("Meta adset error:", await adSetRes.json().catch(() => ({})));
        }

        // 3. Create Ad Creative + Ad (if adset was created)
        let metaAdId = null;
        if (metaAdsetId) {
            // Create creative
            const creativePayload: Record<string, any> = {
                name: `${name} - Creative`,
                object_story_spec: {
                    link_data: {
                        message: adCopy,
                        link: destinationUrl,
                        name: headline || name,
                        call_to_action: { type: callToAction || "LEARN_MORE" },
                    },
                    // page_id will need to be set if available
                },
                access_token: accessToken,
            };

            if (imageUrls?.length > 0) {
                creativePayload.object_story_spec.link_data.picture = imageUrls[0];
            }

            const creativeRes = await fetch(`https://graph.facebook.com/v21.0/${adAccountId}/adcreatives`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(creativePayload),
            });

            if (creativeRes.ok) {
                const creativeData = await creativeRes.json();

                // Create ad
                const adRes = await fetch(`https://graph.facebook.com/v21.0/${adAccountId}/ads`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: `${name} - Ad`,
                        adset_id: metaAdsetId,
                        creative: { creative_id: creativeData.id },
                        status: "PAUSED",
                        access_token: accessToken,
                    }),
                });

                if (adRes.ok) {
                    const adData = await adRes.json();
                    metaAdId = adData.id;
                }
            }
        }

        // Save campaign to DB
        const { data: campaign, error: dbError } = await supabaseAdmin
            .from("ad_campaigns")
            .insert({
                organization_id: dbUser.organization_id,
                event_id: eventId,
                ad_account_connection_id: adConnection.id,
                meta_campaign_id: metaCampaignId,
                meta_adset_id: metaAdsetId,
                meta_ad_id: metaAdId,
                name, objective: objective || "OUTCOME_TRAFFIC",
                status: "paused", // Created as paused, user activates
                daily_budget: dailyBudget, total_budget: totalBudget,
                currency: "CLP", start_date: startDate, end_date: endDate,
                ad_copy: adCopy, headline, image_urls: imageUrls || [],
                call_to_action: callToAction || "LEARN_MORE",
                destination_url: destinationUrl,
                target_audience: targetAudience || {},
            })
            .select()
            .single();

        if (dbError) {
            console.error("DB campaign save error:", dbError);
            return new Response(JSON.stringify({ message: "Campaña creada en Meta pero error al guardar localmente" }), { status: 500 });
        }

        return new Response(JSON.stringify({ 
            message: "Campaña creada exitosamente (pausada)", 
            id: campaign.id,
            meta_campaign_id: metaCampaignId
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Create campaign error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};

function buildMetaTargeting(audience: any): Record<string, any> {
    const targeting: Record<string, any> = {};

    if (audience?.age_min) targeting.age_min = audience.age_min;
    if (audience?.age_max) targeting.age_max = audience.age_max;
    if (audience?.genders?.length) targeting.genders = audience.genders; // [1] = male, [2] = female

    if (audience?.locations?.length) {
        targeting.geo_locations = {
            cities: audience.locations.map((loc: any) => ({
                key: loc.key || loc.id,
                name: loc.name,
            })),
        };
    } else {
        // Default: Chile
        targeting.geo_locations = {
            countries: ["CL"],
        };
    }

    if (audience?.interests?.length) {
        targeting.flexible_spec = [{
            interests: audience.interests.map((i: any) => ({
                id: i.id,
                name: i.name,
            })),
        }];
    }

    return targeting;
}
