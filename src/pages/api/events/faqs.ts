import type { APIRoute } from "astro";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionUser } from "../../../lib/supabaseServer";

async function verifyEventOwnership(supabaseAdmin: any, authUserId: string, eventId: number) {
    const { data: dbUser } = await supabaseAdmin
        .from('users')
        .select('id, organization_id')
        .eq('auth_user_id', authUserId)
        .single();

    if (!dbUser) return null;

    const { data: event } = await supabaseAdmin
        .from('events')
        .select('id')
        .eq('id', eventId)
        .eq('organization_id', dbUser.organization_id)
        .single();

    return event ? dbUser : null;
}

export const GET: APIRoute = async (context) => {
    const user = await getSessionUser(context);
    if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const url = new URL(context.request.url);
    const eventId = Number(url.searchParams.get("eventId"));

    if (!eventId) {
        return new Response(JSON.stringify({ error: "eventId is required" }), { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const dbUser = await verifyEventOwnership(supabaseAdmin, user.id, eventId);
    if (!dbUser) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403 });
    }

    const { data: faqs, error } = await supabaseAdmin
        .from('event_faqs')
        .select('id, question, answer, created_at')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });

    if (error) {
        return new Response(JSON.stringify({ error: getFriendlyErrorMessage(error) }), { status: 500 });
    }

    return new Response(JSON.stringify({ faqs }), { status: 200 });
};

export const POST: APIRoute = async (context) => {
    const user = await getSessionUser(context);
    if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    try {
        const body = await context.request.json();
        const { eventId, question, answer, action, id } = body;

        if (!eventId) {
            return new Response(JSON.stringify({ error: "eventId is required" }), { status: 400 });
        }

        const supabaseAdmin = getSupabaseAdmin();
        const dbUser = await verifyEventOwnership(supabaseAdmin, user.id, eventId);
        if (!dbUser) {
            return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403 });
        }

        if (action === 'delete') {
            if (!id) {
                return new Response(JSON.stringify({ error: "id is required for delete" }), { status: 400 });
            }
            const { error } = await supabaseAdmin
                .from('event_faqs')
                .delete()
                .eq('id', id)
                .eq('event_id', eventId);

            if (error) throw error;
            return new Response(JSON.stringify({ message: "FAQ eliminada" }), { status: 200 });
        }

        if (action === 'update') {
            if (!id || !question || !answer) {
                return new Response(JSON.stringify({ error: "id, question and answer are required" }), { status: 400 });
            }
            const { error } = await supabaseAdmin
                .from('event_faqs')
                .update({ question, answer })
                .eq('id', id)
                .eq('event_id', eventId);

            if (error) throw error;
            return new Response(JSON.stringify({ message: "FAQ actualizada" }), { status: 200 });
        }

        // Default: create
        if (!question || !answer) {
            return new Response(JSON.stringify({ error: "question and answer are required" }), { status: 400 });
        }

        const { data, error } = await supabaseAdmin
            .from('event_faqs')
            .insert({ event_id: eventId, question, answer })
            .select('id, question, answer, created_at')
            .single();

        if (error) throw error;
        return new Response(JSON.stringify({ message: "FAQ creada", faq: data }), { status: 201 });

    } catch (error: any) {
        console.error("FAQ error:", error);
        return new Response(JSON.stringify({ error: getFriendlyErrorMessage(error) }), { status: 500 });
    }
};
