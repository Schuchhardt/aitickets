// Marketing de eventos compartido por el dashboard (/api/promote/*) y la API de productores (/api/v1, /api/mcp).
import { getSupabaseAdmin } from "./auth-helpers";
import { serverEnv } from "../pages/api/_lib/server-utils";

/** Texto con los datos del evento para dar contexto a un modelo (copy o imagen). */
export function buildEventContext(event: any): string {
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

/** Columnas para buildEventContext. */
export const EVENT_CONTEXT_SELECT = `
    *,
    event_tickets(ticket_name, price),
    event_dates(date, start_time, end_time),
    event_locations(*, venues(name, city, address_line1))
`;

export const isImageGenerationConfigured = () => Boolean(serverEnv("OPENAI_API_KEY"));

export type ReferenceImage = { buffer: Buffer; contentType: string };

/** Tipos que acepta /v1/images/edits como imagen de referencia (GIF no). */
export const REFERENCE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_REFERENCE_IMAGES = 4;

/**
 * Genera una imagen con OpenAI (gpt-image-1) y la guarda en Supabase Storage (las URLs de OpenAI expiran).
 * `extraPrompt` permite al productor dirigir el estilo (se agrega a las instrucciones base).
 * Con `referenceImages` usa /v1/images/edits (multipart, campo `image[]`): las referencias guían estilo,
 * paleta y elementos (o son la base a editar). Sin referencias usa /v1/images/generations.
 */
export async function generateEventImage(
    eventContext: string,
    organizationId: number,
    {
        extraPrompt,
        size = "1024x1024",
        referenceImages = [],
    }: { extraPrompt?: string; size?: "1024x1024" | "1024x1536" | "1536x1024"; referenceImages?: ReferenceImage[] } = {},
): Promise<string> {
    const apiKey = serverEnv("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY no configurada");
    const model = serverEnv("OPENAI_IMAGE_MODEL") || "gpt-image-1";
    const direction = extraPrompt ? `\n\nCreative direction from the organizer: ${extraPrompt}` : "";
    const textRule = "NO TEXT, no letters, no logos in the image (unless the organizer's creative direction explicitly asks for text).";
    const refs = referenceImages.slice(0, MAX_REFERENCE_IMAGES);

    let response: Response;
    if (refs.length) {
        const prompt =
            `Create a visually striking social media promotional image for this event. Use the attached reference image${refs.length > 1 ? "s" : ""} ` +
            "as a guide for style, color palette, mood and key visual elements (or as the base to edit if the organizer asks for that). " +
            `Vibrant, modern and eye-catching. ${textRule}\n\nEvent details: ${eventContext}${direction}`;
        const form = new FormData();
        form.append("model", model);
        form.append("prompt", prompt);
        form.append("n", "1");
        form.append("size", size);
        form.append("quality", "medium");
        refs.forEach((ref, i) => {
            const ext = ALLOWED_IMAGE_TYPES[ref.contentType] || "png";
            form.append("image[]", new Blob([new Uint8Array(ref.buffer)], { type: ref.contentType }), `reference-${i + 1}.${ext}`);
        });
        response = await fetch("https://api.openai.com/v1/images/edits", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}` },
            body: form,
        });
    } else {
        response = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model,
                prompt: `Create a visually striking, photographic social media promotional image for this event. Vibrant, modern and eye-catching. ${textRule}\n\nEvent details: ${eventContext}${direction}`,
                n: 1,
                size,
                quality: "medium",
            }),
        });
    }

    if (!response.ok) {
        console.error("OpenAI image error:", response.status, (await response.text()).slice(0, 300));
        throw new Error("Error al generar imagen con OpenAI");
    }

    const data = await response.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI no devolvió la imagen");

    return storeImage(organizationId, Buffer.from(b64, "base64"), "image/png", "ai");
}

export const ALLOWED_IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Sube una imagen al bucket público "Events" (carpeta promote/) y devuelve su URL pública. */
export async function storeImage(organizationId: number, buffer: Buffer, contentType: string, tag = "upload"): Promise<string> {
    const ext = ALLOWED_IMAGE_TYPES[contentType];
    if (!ext) throw new Error("Tipo de imagen no permitido");
    const fileName = `promote/${organizationId}-${Date.now()}-${tag}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.storage
        .from("Events")
        .upload(fileName, buffer, { contentType, cacheControl: "31536000", upsert: false });
    if (error) throw new Error(`Error guardando imagen: ${error.message}`);
    return supabase.storage.from("Events").getPublicUrl(fileName).data.publicUrl;
}

/** Detecta el tipo real de la imagen por sus bytes iniciales (no se confía en lo que declara el cliente). */
export function sniffImageType(buf: Uint8Array): string | null {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
    if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
    if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
        && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
    return null;
}

export type PublishResult =
    | { ok: true; status: "published" | "scheduled"; zernioPostId: string | null }
    | { ok: false; httpStatus: number; message: string };

/**
 * Publica (o programa, si tiene scheduled_for) un post de la organización en sus cuentas conectadas vía Zernio.
 */
export async function publishSocialPost(organizationId: number, postId: number | string): Promise<PublishResult> {
    const apiKey = serverEnv("ZERNIO_API_KEY");
    if (!apiKey) return { ok: false, httpStatus: 500, message: "Zernio API no configurada" };

    const supabaseAdmin = getSupabaseAdmin();
    const { data: post, error: postError } = await supabaseAdmin
        .from("social_posts")
        .select("*")
        .eq("id", postId)
        .eq("organization_id", organizationId)
        .single();
    if (postError || !post) return { ok: false, httpStatus: 404, message: "Post no encontrado" };

    const { data: accounts } = await supabaseAdmin
        .from("social_accounts")
        .select("*")
        .eq("organization_id", organizationId)
        .in("platform", post.platforms)
        .eq("status", "active");
    if (!accounts?.length) {
        return { ok: false, httpStatus: 400, message: "No hay cuentas conectadas para las plataformas seleccionadas" };
    }

    const zernioPayload: Record<string, any> = {
        content: post.content,
        platforms: accounts.map((a: any) => ({ platform: a.platform, accountId: a.zernio_account_id })),
    };
    if (post.image_urls?.length > 0) {
        zernioPayload.mediaItems = post.image_urls.map((url: string) => ({ type: "image", url }));
    }
    if (post.scheduled_for) {
        zernioPayload.scheduledFor = post.scheduled_for;
        zernioPayload.timezone = "America/Santiago";
    } else {
        zernioPayload.publishNow = true;
    }

    const response = await fetch("https://zernio.com/api/v1/posts", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(zernioPayload),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Zernio publish error:", errorData);
        await supabaseAdmin
            .from("social_posts")
            .update({ status: "failed", error_message: errorData.message || "Error al publicar en Zernio" })
            .eq("id", post.id)
            .eq("organization_id", organizationId);
        return { ok: false, httpStatus: 502, message: "Error al publicar en redes sociales" };
    }

    const data = await response.json();
    const newStatus = post.scheduled_for ? "scheduled" : "published";
    const zernioPostId = data.post?._id || data.post_id || data.id || null;

    await supabaseAdmin
        .from("social_posts")
        .update({
            status: newStatus,
            zernio_post_id: zernioPostId,
            published_at: post.scheduled_for ? null : new Date().toISOString(),
            error_message: null,
        })
        .eq("id", post.id)
        .eq("organization_id", organizationId);

    return { ok: true, status: newStatus, zernioPostId };
}
