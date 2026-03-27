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
        const { postId } = body;

        if (!postId) {
            return new Response(JSON.stringify({ message: "ID de post requerido" }), { status: 400 });
        }

        const apiKey = import.meta.env.ZERNIO_API_KEY;
        if (!apiKey) {
            return new Response(JSON.stringify({ message: "Zernio API no configurada" }), { status: 500 });
        }

        const supabaseAdmin = getSupabaseAdmin();

        // Verify user's organization
        const { data: dbUser } = await supabaseAdmin
            .from("users")
            .select("organization_id")
            .eq("auth_user_id", user.id)
            .single();

        if (!dbUser?.organization_id) {
            return new Response(JSON.stringify({ message: "Organización no encontrada" }), { status: 404 });
        }

        // Fetch post
        const { data: post, error: postError } = await supabaseAdmin
            .from("social_posts")
            .select("*")
            .eq("id", postId)
            .eq("organization_id", dbUser.organization_id)
            .single();

        if (postError || !post) {
            return new Response(JSON.stringify({ message: "Post no encontrado" }), { status: 404 });
        }

        // Fetch connected accounts for the platforms
        const { data: accounts } = await supabaseAdmin
            .from("social_accounts")
            .select("*")
            .eq("organization_id", dbUser.organization_id)
            .in("platform", post.platforms)
            .eq("status", "active");

        if (!accounts?.length) {
            return new Response(JSON.stringify({ message: "No hay cuentas conectadas para las plataformas seleccionadas" }), { status: 400 });
        }

        // Call Zernio API to publish
        const zernioPayload: Record<string, any> = {
            content: post.content,
            platforms: accounts.map((a: any) => ({
                platform: a.platform,
                accountId: a.zernio_account_id,
            })),
        };

        if (post.image_urls?.length > 0) {
            zernioPayload.mediaItems = post.image_urls.map((url: string) => ({
                type: "image",
                url,
            }));
        }

        if (post.scheduled_for) {
            zernioPayload.scheduledFor = post.scheduled_for;
            zernioPayload.timezone = "America/Santiago";
        } else {
            zernioPayload.publishNow = true;
        }

        const response = await fetch("https://zernio.com/api/v1/posts", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(zernioPayload),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error("Zernio publish error:", errorData);

            await supabaseAdmin
                .from("social_posts")
                .update({ status: "failed", error_message: errorData.message || "Error al publicar en Zernio" })
                .eq("id", postId);

            return new Response(JSON.stringify({ message: "Error al publicar en redes sociales" }), { status: 502 });
        }

        const data = await response.json();
        const newStatus = post.scheduled_for ? "scheduled" : "published";

        await supabaseAdmin
            .from("social_posts")
            .update({
                status: newStatus,
                zernio_post_id: data.post?._id || data.post_id || data.id,
                published_at: post.scheduled_for ? null : new Date().toISOString(),
                error_message: null,
            })
            .eq("id", postId);

        return new Response(JSON.stringify({ 
            message: newStatus === "scheduled" ? "Post programado exitosamente" : "Post publicado exitosamente",
            zernio_post_id: data.post?._id || data.post_id || data.id 
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Publish error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};
