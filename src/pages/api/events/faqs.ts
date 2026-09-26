import type { APIRoute } from "astro";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, type SessionContext } from "../../../lib/supabaseServer";

/** Devuelve la sesión si el usuario (con rol de gestión) es dueño del evento vía su organización. */
async function authorize(context: Parameters<typeof getSessionContext>[0], eventId: number): Promise<{ session: SessionContext } | Response> {
    const session = await getSessionContext(context);
    if (!session) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES)) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403 });
    }
    if (!eventId) return new Response(JSON.stringify({ error: "eventId is required" }), { status: 400 });
    const event = await getOwnedEvent(eventId, session.dbUser.organization_id, "id");
    if (!event) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403 });
    return { session };
}

export const GET: APIRoute = async (context) => {
    const url = new URL(context.request.url);
    const eventId = Number(url.searchParams.get("eventId"));

    const auth = await authorize(context, eventId);
    if (auth instanceof Response) return auth;
    const supabaseAdmin = getSupabaseAdmin();

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
    try {
        const body = await context.request.json();
        const { eventId, action, id } = body;
        const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
        const answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 3000) : "";

        const auth = await authorize(context, Number(eventId));
        if (auth instanceof Response) return auth;
        const supabaseAdmin = getSupabaseAdmin();

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
