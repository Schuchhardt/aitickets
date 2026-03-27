import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionUser } from "../../../lib/supabaseServer";

export const POST: APIRoute = async (context) => {
    const user = await getSessionUser(context);
    if (!user) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401 });
    }

    try {
        const body = await context.request.json();
        const { eventId, type, tone } = body; // type: 'text' | 'image'

        if (!eventId || !type) {
            return new Response(JSON.stringify({ message: "Faltan datos requeridos" }), { status: 400 });
        }

        const openaiKey = import.meta.env.OPENAI_API_KEY;
        if (!openaiKey) {
            return new Response(JSON.stringify({ message: "OpenAI API no configurada" }), { status: 500 });
        }

        const supabaseAdmin = getSupabaseAdmin();

        // Verify organization ownership
        const { data: dbUser } = await supabaseAdmin
            .from("users")
            .select("organization_id")
            .eq("auth_user_id", user.id)
            .single();

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

        if (type === "text") {
            const content = await generateText(openaiKey, eventContext, tone);
            return new Response(JSON.stringify({ content }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        if (type === "image") {
            const imageUrl = await generateImage(openaiKey, eventContext);
            return new Response(JSON.stringify({ imageUrl }), {
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

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `Eres un experto en marketing de eventos y redes sociales. Genera posts promocionales en español para Instagram y Facebook. ${toneInstruction} Incluye emojis relevantes. No uses hashtags excesivos (máximo 5). El post debe ser conciso pero impactante. No incluyas URLs.`
                },
                {
                    role: "user",
                    content: `Genera un post promocional para redes sociales basado en este evento:\n\n${eventContext}`
                }
            ],
            max_tokens: 500,
            temperature: 0.8,
        }),
    });

    if (!response.ok) {
        throw new Error("Error al generar texto con OpenAI");
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || "";
}

async function generateImage(apiKey: string, eventContext: string): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "dall-e-3",
            prompt: `Create a visually striking social media promotional image for this event. The image should be vibrant, modern, and eye-catching. NO TEXT in the image. Abstract or thematic representation only.\n\nEvent details: ${eventContext}`,
            n: 1,
            size: "1024x1024",
            quality: "standard",
        }),
    });

    if (!response.ok) {
        throw new Error("Error al generar imagen con OpenAI");
    }

    const data = await response.json();
    return data.data[0]?.url || "";
}
