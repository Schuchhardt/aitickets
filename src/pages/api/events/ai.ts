// IA en el panel del evento: descripción, preguntas frecuentes y portada.
// POST { action: "description" | "faqs" | "cover", eventId?, guide?, ... }
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { buildEventContext, generateEventImage, isImageGenerationConfigured, EVENT_CONTEXT_SELECT } from "../../../lib/marketing";
import { AiRefusalError, generateEventDescription, generateEventFaqs, isTextGenerationConfigured } from "../../../lib/aiText";
import { loadReferenceImages } from "../../../lib/producer-api/tools/marketing";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";

const TEXT_GENERATIONS_PER_DAY = 100;
// Mismo cupo diario que generate_image de la API de productores
const IMAGE_GENERATIONS_PER_DAY = 20;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Contexto del evento: lo guardado + lo que el productor tiene sin guardar en el formulario. */
function contextFrom(event: any | null, body: any): string {
    const draft = body?.draft || {};
    const merged = {
        ...(event || {}),
        name: str(draft.name, 200) || event?.name || "Evento sin nombre",
        description: draft.description !== undefined ? str(draft.description, 20000) : event?.description,
    };
    let context = buildEventContext(merged);
    const category = str(draft.category, 80);
    if (category) context += `\nCategoría: ${category}`;
    // Formulario de creación (sin evento guardado): fechas y lugar en texto
    const extra = str(draft.details, 2000);
    if (extra) context += `\n${extra}`;
    return context;
}

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ message: "No autorizado" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) return jsonResponse({ message: "No tienes permisos para esta acción" }, 403);

    const body = await context.request.json().catch(() => null);
    const action = body?.action;
    const guide = str(body?.guide, 1000);
    const eventId = body?.eventId ? Number(body.eventId) : null;

    const supabase = getSupabaseAdmin();
    let event: any = null;
    if (eventId) {
        event = await getOwnedEvent(eventId, dbUser.organization_id, EVENT_CONTEXT_SELECT, dbUser.id);
        if (!event) return jsonResponse({ message: "Evento no encontrado" }, 404);
    }

    try {
        if (action === "description" || action === "faqs") {
            if (!isTextGenerationConfigured()) return jsonResponse({ message: "La IA no está configurada." }, 501);
            const limit = await rateLimit("dash:aitext", `org:${dbUser.organization_id}`, { windowSeconds: 86400, max: TEXT_GENERATIONS_PER_DAY, supabase });
            if (!limit.allowed) return jsonResponse({ message: "Alcanzaste el máximo de textos generados con IA por hoy." }, 429);

            if (action === "description") {
                const html = await generateEventDescription(contextFrom(event, body), guide);
                return jsonResponse({ html });
            }

            if (!event) return jsonResponse({ message: "Falta el evento" }, 400);
            const { data: existing } = await supabase.from("event_faqs").select("question").eq("event_id", event.id);
            const faqs = await generateEventFaqs(contextFrom(event, body), (existing || []).map((f: any) => f.question), guide);
            return jsonResponse({ faqs });
        }

        if (action === "cover") {
            if (!event) return jsonResponse({ message: "Falta el evento" }, 400);
            if (!isImageGenerationConfigured()) {
                return jsonResponse({ message: "La generación de imágenes con IA no está configurada. Sube una imagen propia." }, 501);
            }
            const useCurrent = body?.useCurrentAsReference === true && Boolean(event.image_url);
            // Se descarga antes de gastar el cupo: una portada inaccesible no consume una generación
            const referenceImages = useCurrent ? await loadReferenceImages([event.image_url]) : [];
            const limit = await rateLimit("api:genimg", `org:${dbUser.organization_id}`, { windowSeconds: 86400, max: IMAGE_GENERATIONS_PER_DAY, supabase });
            if (!limit.allowed) return jsonResponse({ message: `Alcanzaste el máximo de ${IMAGE_GENERATIONS_PER_DAY} imágenes generadas por día.` }, 429);
            const direction = [
                "Horizontal cover/banner for the event web page: the main subject should sit near the center, with some breathing room at the edges because it is cropped differently on desktop and mobile.",
                useCurrent ? "Edit or reinterpret the attached current cover according to the organizer's direction." : "",
                guide,
            ].filter(Boolean).join(" ");
            const url = await generateEventImage(buildEventContext(event), dbUser.organization_id, {
                extraPrompt: direction,
                size: "1536x1024",
                referenceImages,
            });
            return jsonResponse({ url });
        }

        return jsonResponse({ message: "Acción no válida" }, 400);
    } catch (err: any) {
        if (err instanceof AiRefusalError) return jsonResponse({ message: "La IA no pudo generar este contenido. Prueba con otras indicaciones." }, 422);
        console.error(`events/ai ${action}:`, err?.message || err);
        return jsonResponse({ message: action === "cover" ? "No se pudo generar la imagen. Intenta con otras indicaciones o sube una propia." : "No se pudo generar el texto. Intenta nuevamente." }, 502);
    }
};
