import type { APIRoute } from "astro";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES } from "../../../lib/supabaseServer";
import { buildEventContext, generateEventImage, isImageGenerationConfigured, EVENT_CONTEXT_SELECT } from "../../../lib/marketing";
import { canAccessEventByStaff } from "../../../../netlify/lib/event-staff.mjs";

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
        const { eventId, type, tone } = body; // type: 'text' | 'image'

        if (!eventId || !type) {
            return new Response(JSON.stringify({ message: "Faltan datos requeridos" }), { status: 400 });
        }


        const supabaseAdmin = getSupabaseAdmin();

        // Verify organization ownership
        const dbUser = session.dbUser;

        if (!dbUser?.organization_id) {
            return new Response(JSON.stringify({ message: "Organización no encontrada" }), { status: 404 });
        }

        // Fetch event details for context
        const { data: event } = await supabaseAdmin
            .from("events")
            .select(EVENT_CONTEXT_SELECT)
            .eq("id", eventId)
            .eq("organization_id", dbUser.organization_id)
            .single();

        if (!event || !(await canAccessEventByStaff(getSupabaseAdmin(), dbUser.id, eventId))) {
            return new Response(JSON.stringify({ message: "Evento no encontrado" }), { status: 404 });
        }

        // Build event context
        const eventContext = buildEventContext(event);

        if (type === "image") {
            if (!isImageGenerationConfigured()) {
                return new Response(JSON.stringify({ message: "La generación de imágenes con IA no está configurada. Sube una imagen propia." }), { status: 501, headers: { "Content-Type": "application/json" } });
            }
            const imageUrl = await generateEventImage(eventContext, dbUser.organization_id);
            return new Response(JSON.stringify({ imageUrl }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        if (type === "text") {
            const anthropicKey = process.env.ANTHROPIC_API_KEY ?? import.meta.env.ANTHROPIC_API_KEY;
            if (!anthropicKey) {
                return new Response(JSON.stringify({ message: "IA no configurada" }), { status: 500 });
            }
            const content = await generateText(anthropicKey, eventContext, tone);
            return new Response(JSON.stringify({ content }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({ message: "Tipo no válido. Usa 'text' o 'image'" }), { status: 400 });
    } catch (error) {
        console.error("Generate error:", error);
        return new Response(JSON.stringify({ message: "Error al generar contenido con IA" }), { status: 500 });
    }
};

async function generateText(apiKey: string, eventContext: string, tone?: string): Promise<string> {
    const toneInstruction = tone ? `El tono debe ser ${tone}.` : "El tono debe ser atractivo y llamativo.";
    const client = new Anthropic({ apiKey });

    const response = await client.beta.messages.create({
        model: (process.env.ANTHROPIC_MODEL ?? import.meta.env.ANTHROPIC_MODEL) || "claude-opus-5",
        max_tokens: 4000,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: `Eres un experto en marketing de eventos y redes sociales. Genera posts promocionales en español de Chile para Instagram y Facebook. ${toneInstruction} Incluye emojis relevantes. Usa como máximo 5 hashtags. El post debe ser conciso pero impactante. No incluyas URLs. Responde solo con el texto del post, sin introducción ni comentarios.`,
        messages: [
            {
                role: "user",
                content: `Genera un post promocional para redes sociales basado en este evento:\n\n${eventContext}`,
            },
        ],
    });

    if (response.stop_reason === "refusal") {
        throw new Error("La IA rechazó generar este contenido");
    }
    return response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
}
