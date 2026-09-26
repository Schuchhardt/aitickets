import type { APIRoute } from "astro";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, EVENT_MANAGER_ROLES } from "../../../lib/supabaseServer";

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
            .select(`
                *,
                event_tickets(ticket_name, price),
                event_dates(date, start_time, end_time),
                event_locations(*, venues(name, city, address_line1))
            `)
            .eq("id", eventId)
            .eq("organization_id", dbUser.organization_id)
            .single();

        if (!event) {
            return new Response(JSON.stringify({ message: "Evento no encontrado" }), { status: 404 });
        }

        // Build event context
        const eventContext = buildEventContext(event);

        if (type === "image") {
            const openaiKey = process.env.OPENAI_API_KEY ?? import.meta.env.OPENAI_API_KEY;
            if (!openaiKey) {
                return new Response(JSON.stringify({ message: "La generación de imágenes con IA no está configurada. Sube una imagen propia." }), { status: 501, headers: { "Content-Type": "application/json" } });
            }
            const imageUrl = await generateImage(openaiKey, eventContext, dbUser.organization_id);
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

function buildEventContext(event: any): string {
    const venues = event.event_locations?.map((loc: any) => 
        loc.venues ? `${loc.venues.name}, ${loc.venues.city}` : "Ubicación por definir"
    ).join("; ") || "Sin ubicación";

    const dates = event.event_dates?.map((d: any) => 
        `${d.date} ${d.start_time}${d.end_time ? ' - ' + d.end_time : ''}`
    ).join("; ") || "Sin fecha";

    const tickets = event.event_tickets?.map((t: any) => 
        `${t.ticket_name}: $${t.price}`
    ).join(", ") || "Sin entradas";

    return `
Evento: ${event.title || event.name}
Descripción: ${event.description || "Sin descripción"}
Fecha(s): ${dates}
Lugar: ${venues}
Entradas: ${tickets}
    `.trim();
}

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

/** Genera una imagen con OpenAI (gpt-image-1) y la guarda en Supabase Storage (las URLs de OpenAI expiran). */
async function generateImage(apiKey: string, eventContext: string, organizationId: number): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: (process.env.OPENAI_IMAGE_MODEL ?? import.meta.env.OPENAI_IMAGE_MODEL) || "gpt-image-1",
            prompt: `Create a visually striking, photographic social media promotional image for this event. Vibrant, modern and eye-catching. NO TEXT, no letters, no logos in the image.\n\nEvent details: ${eventContext}`,
            n: 1,
            size: "1024x1024",
            quality: "medium",
        }),
    });

    if (!response.ok) {
        console.error("OpenAI image error:", response.status, (await response.text()).slice(0, 300));
        throw new Error("Error al generar imagen con OpenAI");
    }

    const data = await response.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI no devolvió la imagen");

    const fileName = `promote/${organizationId}-${Date.now()}-ai.png`;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.storage
        .from("Events")
        .upload(fileName, Buffer.from(b64, "base64"), { contentType: "image/png", cacheControl: "31536000" });
    if (error) throw new Error(`Error guardando imagen: ${error.message}`);

    return supabase.storage.from("Events").getPublicUrl(fileName).data.publicUrl;
}
