import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionUser } from "../../../lib/supabaseServer";

const ZERNIO_BASE = "https://zernio.com/api/v1";

export const POST: APIRoute = async (context) => {
    const user = await getSessionUser(context);
    if (!user) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 });
    }

    try {
        const body = await context.request.json();
        const { platform } = body;

        if (!platform || !["instagram", "facebook"].includes(platform)) {
            return new Response(JSON.stringify({ message: "Plataforma no válida" }), { status: 400 });
        }

        const apiKey = import.meta.env.ZERNIO_API_KEY;
        if (!apiKey) {
            return new Response(JSON.stringify({ message: "Zernio API no configurada" }), { status: 500 });
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

        // Get or create Zernio profile for this organization
        const { data: org } = await supabaseAdmin
            .from("organizations")
            .select("zernio_profile_id, public_name")
            .eq("id", dbUser.organization_id)
            .single();

        let profileId = org?.zernio_profile_id;

        if (!profileId) {
            const profileRes = await fetch(`${ZERNIO_BASE}/profiles`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name: org?.public_name || `Org ${dbUser.organization_id}`,
                }),
            });

            if (!profileRes.ok) {
                const err = await profileRes.json().catch(() => ({}));
                console.error("Zernio create profile error:", err);
                return new Response(JSON.stringify({ message: "Error al crear perfil en Zernio" }), { status: 502 });
            }

            const profileData = await profileRes.json();
            profileId = profileData.profile._id;

            await supabaseAdmin
                .from("organizations")
                .update({ zernio_profile_id: profileId })
                .eq("id", dbUser.organization_id);
        }

        // Get OAuth connect URL from Zernio
        const siteUrl = import.meta.env.SITE_URL || "https://aitickets.cl";
        const redirectUrl = `${siteUrl}/api/promote/callback?org=${dbUser.organization_id}`;

        const connectUrl = new URL(`${ZERNIO_BASE}/connect/${platform}`);
        connectUrl.searchParams.set("profileId", profileId);
        connectUrl.searchParams.set("redirect_url", redirectUrl);

        const response = await fetch(connectUrl.toString(), {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
            },
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error("Zernio connect error:", errorData);
            return new Response(JSON.stringify({ message: "Error al conectar con Zernio" }), { status: 502 });
        }

        const data = await response.json();

        return new Response(JSON.stringify({ 
            redirect_url: data.authUrl 
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Connect error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};
