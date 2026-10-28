// Herramientas: piezas de marketing (imágenes, posts, links con seguimiento).
// El copy lo escribe el LLM del productor (para eso get_marketing_kit le da el contexto); el servidor guarda
// imágenes, genera imágenes con IA (opcional) y publica en las redes conectadas.
import { ToolError, type ToolDef, type ToolContext } from "../registry";
import { eventIdSchema, loadOwnedEvent, eventPublicUrl, eventDashboardUrl, eventUrls, DRAFT_URL_NOTE, localDateTime } from "./common";
import {
    buildEventContext, EVENT_CONTEXT_SELECT, generateEventImage, isImageGenerationConfigured, publishSocialPost,
    storeImage, sniffImageType, MAX_IMAGE_BYTES, MAX_REFERENCE_IMAGES, REFERENCE_IMAGE_TYPES, type ReferenceImage,
} from "../../marketing";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { serverEnv } from "../../../pages/api/_lib/server-utils";
import { fetchPublic, isPublicIp, SafeFetchError } from "../../safe-fetch";
import { EVENT_VIDEO_MAX_BYTES } from "../../eventVideo";
import { clearEventVideo, EventVideoUnavailableError, loadEventVideoState, saveEventVideo } from "../../eventVideoStore";
import { readMp4Meta, sniffVideoType } from "../../videoProbe";
import { createPromoterLink, listPromoterLinks, revokePromoterLink, promoterRef, PROMOTER_REF_RE } from "../../promoterLinks";
import { storeVideoBuffer, VideoStorageError } from "../../videoStorage";
import { SOCIAL_PLATFORMS, platformName, postMediaProblem } from "../../socialPlatforms";

const IMAGE_GENERATIONS_PER_DAY = 20;
const VIDEO_UPLOADS_PER_HOUR = 20;
// La función responde de forma síncrona: la descarga tiene que caber holgada en su tiempo máximo
const VIDEO_DOWNLOAD_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Imágenes por URL (anti-SSRF en src/lib/safe-fetch.ts) o base64
// ---------------------------------------------------------------------------

export { isPublicIp };

/** Descarga una imagen pública (https, máx. 5 MB, redirecciones verificadas); el tipo se detecta por bytes. */
export async function fetchPublicImage(rawUrl: string, fetchImpl: typeof fetch = fetch): Promise<{ buffer: Buffer; contentType: string }> {
    if (!/^https:\/\//i.test(String(rawUrl || "").trim())) {
        throw new ToolError("invalid_input", "Imagen: solo se aceptan URLs https públicas (ej: https://…/flyer.jpg).");
    }
    let buffer: Buffer;
    try {
        ({ buffer } = await fetchPublic(rawUrl, { maxBytes: MAX_IMAGE_BYTES, accept: "image/*", fetchImpl }));
    } catch (err: any) {
        if (err instanceof SafeFetchError) throw new ToolError(err.kind === "invalid" ? "invalid_input" : "upstream", `Imagen: ${err.message}`);
        throw err;
    }
    const contentType = sniffImageType(buffer);
    if (!contentType) throw new ToolError("invalid_input", "El archivo no es una imagen JPG, PNG, WEBP o GIF.");
    return { buffer, contentType };
}

/**
 * Descarga las imágenes de referencia para generate_image. Los errores dicen cuál falló (número y URL).
 * GIF no sirve como referencia (OpenAI acepta PNG, JPG o WEBP).
 */
export async function loadReferenceImages(urls: string[], fetchImpl: typeof fetch = fetch): Promise<ReferenceImage[]> {
    const out: ReferenceImage[] = [];
    for (const [i, url] of urls.entries()) {
        let img: { buffer: Buffer; contentType: string };
        try {
            img = await fetchPublicImage(url, fetchImpl);
        } catch (err: any) {
            if (err instanceof ToolError) throw new ToolError(err.code, `Referencia ${i + 1} (${url.slice(0, 120)}): ${err.message.replace(/^Imagen: /, "")}`);
            throw err;
        }
        if (!REFERENCE_IMAGE_TYPES.includes(img.contentType)) {
            throw new ToolError("invalid_input", `Referencia ${i + 1}: usa una imagen JPG, PNG o WEBP (los GIF no sirven como referencia).`);
        }
        out.push(img);
    }
    return out;
}

export function decodeBase64Image(data: string): { buffer: Buffer; contentType: string } {
    const clean = data.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/=_-]+$/.test(clean)) throw new ToolError("invalid_input", "image_base64 no es base64 válido.");
    if (clean.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) throw new ToolError("invalid_input", "La imagen supera 5 MB.");
    const buffer = Buffer.from(clean, "base64");
    const contentType = sniffImageType(buffer);
    if (!contentType) throw new ToolError("invalid_input", "El archivo no es una imagen JPG, PNG, WEBP o GIF.");
    return { buffer, contentType };
}

async function setCover(ctx: ToolContext, eventId: number, url: string) {
    const { error } = await ctx.supabase.from("events").update({ image_url: url }).eq("id", eventId).eq("organization_id", ctx.actor.orgId);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------

const getMarketingKit: ToolDef = {
    name: "get_marketing_kit",
    title: "Kit de marketing del evento",
    description:
        "Todo lo necesario para que TÚ (el asistente) escribas piezas de marketing del evento: ficha del evento, link público, imagen, " +
        "redes de la organización, redes conectadas para publicar y guía de estilo. Úsala antes de redactar publicaciones, emails o anuncios.",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, EVENT_CONTEXT_SELECT);
        const [{ data: org }, { data: accounts }] = await Promise.all([
            ctx.supabase.from("organizations").select("public_name, instagram, facebook, tiktok, website").eq("id", ctx.actor.orgId).maybeSingle(),
            ctx.supabase.from("social_accounts").select("platform, account_name").eq("organization_id", ctx.actor.orgId).eq("status", "active"),
        ]);
        const published = event.status === "published";
        // Borrador: public_url = null (igual que las demás herramientas); los links de ejemplo usan la URL futura
        const url = eventPublicUrl(ctx, event.slug);
        return {
            event_id: Number(event.id),
            status: event.status,
            ...(published ? {} : { draft_warning: `${DRAFT_URL_NOTE} No hagas publicaciones ni compartas el link hasta publicar el evento.` }),
            brief: buildEventContext(event),
            brief_note: "Texto plano. Solo incluye las entradas que el público puede comprar (sin la de cortesía ni las pausadas o ya cerradas).",
            ...eventUrls(ctx, event),
            image_url: event.image_url || null,
            organization: org ? { name: org.public_name, instagram: org.instagram, facebook: org.facebook, tiktok: org.tiktok, website: org.website } : null,
            can_publish_to: (accounts || []).map((a: any) => ({ platform: a.platform, account: a.account_name })),
            image_generation_available: isImageGenerationConfigured(),
            [published ? "tracking_link_examples" : "tracking_link_examples_after_publish"]: url ? {
                instagram_bio: `${url}?utm_source=instagram&utm_medium=social&utm_campaign=bio`,
                whatsapp: `${url}?utm_source=whatsapp&utm_medium=social`,
                promoter: `${url}?ref=NOMBRE_PROMOTOR`,
            } : null,
            style_guide: [
                "Español de Chile, cercano y directo.",
                "Instagram: gancho en la primera línea, emojis con moderación, máx. 5 hashtags, link en bio.",
                "Siempre fecha, lugar y llamado a la acción. No inventes artistas, precios ni beneficios que no estén en la ficha.",
                "Usa links con utm/ref (create_tracking_link) para medir qué canal vende (get_event_performance → sales_channels).",
            ],
        };
    },
};

const createTrackingLink: ToolDef = {
    name: "create_tracking_link",
    title: "Crear link con seguimiento",
    description:
        "Arma el link del evento con ref (promotor/influencer) o parámetros UTM, para medir qué canal vende. " +
        "Las ventas aparecen por canal en get_event_performance.",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            ref: { type: "string", maxLength: 60, pattern: "^[A-Za-z0-9_.-]+$", description: "Identificador de promotor/aliado." },
            utm_source: { type: "string", maxLength: 60, pattern: "^[A-Za-z0-9_.-]+$", description: "Ej: instagram, tiktok, newsletter." },
            utm_medium: { type: "string", maxLength: 60, pattern: "^[A-Za-z0-9_.-]+$", description: "Ej: social, paid, email." },
            utm_campaign: { type: "string", maxLength: 80, pattern: "^[A-Za-z0-9_.-]+$", description: "Ej: preventa2." },
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, slug, status");
        const url = new URL(eventPublicUrl(ctx, event.slug)!);
        for (const k of ["ref", "utm_source", "utm_medium", "utm_campaign"]) if (args[k]) url.searchParams.set(k, args[k]);
        return {
            event_id: Number(event.id),
            url: url.toString(),
            ...(event.status === "published" ? {} : { draft_warning: `${DRAFT_URL_NOTE} Este link funcionará recién cuando se publique el evento.` }),
        };
    },
};

const uploadImage: ToolDef = {
    name: "upload_image",
    title: "Subir imagen",
    description:
        "Sube una imagen (JPG, PNG, WEBP o GIF, máx. 5 MB) desde una URL https pública (p. ej. un flyer, logo o foto que el productor compartió " +
        "por link) o en base64, y devuelve su URL alojada en AI Tickets. Esa URL sirve como portada (event_id + set_as_cover=true), " +
        "para create_social_post o como referencia en generate_image (reference_image_urls). Si el productor adjuntó la imagen en el chat " +
        "y no tienes una URL pública, envíala en image_base64.",
    scope: "write",
    audit: (args) => ({ summary: `Subió una imagen${args.set_as_cover ? " (portada)" : ""}`, ...(args.event_id ? { target: `event:${args.event_id}` } : {}) }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            image_url: { type: "string", maxLength: 2000, description: "URL https pública de la imagen (debe ser accesible sin iniciar sesión)." },
            image_base64: { type: "string", maxLength: 7_100_000, description: "Imagen en base64 (o data URL)." },
            event_id: eventIdSchema,
            set_as_cover: { type: "boolean", default: false },
        },
    },
    async handler(args, ctx) {
        if (!args.image_url === !args.image_base64) throw new ToolError("invalid_input", "Envía image_url o image_base64 (uno de los dos).");
        if (args.set_as_cover && !args.event_id) throw new ToolError("invalid_input", "set_as_cover requiere event_id.");
        if (args.event_id) await loadOwnedEvent(ctx, args.event_id, "id");
        const { buffer, contentType } = args.image_base64 ? decodeBase64Image(args.image_base64) : await fetchPublicImage(args.image_url);
        const url = await storeImage(ctx.actor.orgId, buffer, contentType, "api");
        if (args.set_as_cover) await setCover(ctx, args.event_id, url);
        return { url, content_type: contentType, bytes: buffer.length, event_id: args.event_id ?? null, set_as_cover: Boolean(args.set_as_cover) };
    },
};

/** Descarga un video público (https, máx. 50 MB, redirecciones verificadas); el tipo se detecta por bytes. */
async function fetchPublicVideo(rawUrl: string) {
    if (!/^https:\/\//i.test(String(rawUrl || "").trim())) {
        throw new ToolError("invalid_input", "Video: solo se aceptan URLs https públicas que descarguen el archivo (ej: https://…/video.mp4).");
    }
    let buffer: Buffer;
    try {
        ({ buffer } = await fetchPublic(rawUrl, { maxBytes: EVENT_VIDEO_MAX_BYTES, accept: "video/*", timeoutMs: VIDEO_DOWNLOAD_TIMEOUT_MS }));
    } catch (err: any) {
        if (err instanceof SafeFetchError) {
            const message = /supera/.test(err.message) ? "el archivo supera los 50 MB: comprímelo o recórtalo." : err.message;
            throw new ToolError(err.kind === "invalid" ? "invalid_input" : "upstream", `Video: ${message}`);
        }
        throw err;
    }
    const contentType = sniffVideoType(buffer);
    if (!contentType) {
        throw new ToolError(
            "invalid_input",
            "Video: el link no descarga un video MP4, WEBM o MOV (si es de YouTube, Instagram, Drive o Dropbox, usa el link de descarga directa del archivo).",
        );
    }
    return { buffer, contentType };
}

const setEventVideo: ToolDef = {
    name: "set_event_video",
    title: "Video de portada o de la galería",
    description:
        "Pone un video en la página pública del evento desde una URL https pública que descargue el archivo (MP4 recomendado, WEBM o MOV; " +
        "máx. 50 MB, ideal menos de 20 MB y menos de 1 minuto). slot=cover (por defecto): reemplaza la imagen de portada arriba de la página " +
        "(la imagen se sigue usando en la cartelera, al compartir y en los correos). slot=gallery: video opcional arriba de las fotos de la galería. " +
        "En la página se reproduce solo y sin sonido mientras está en pantalla, con un botón para activar el sonido. " +
        "poster_image_url (opcional, recomendado): imagen que se ve mientras carga el video; con slot=cover y sin imagen de portada, pasa a ser la imagen del evento. " +
        "remove=true quita el video del slot. Reemplazar un video borra el anterior. Los links de YouTube, Instagram, TikTok o páginas de " +
        "Drive/Dropbox no sirven: se necesita el archivo.",
    scope: "write",
    audit: (args) => ({
        summary: args.remove ? `Quitó el video (${args.slot || "cover"})` : `Puso un video (${args.slot || "cover"})`,
        target: `event:${args.event_id}`,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            video_url: { type: "string", maxLength: 2000, description: "URL https pública que descarga el archivo de video (MP4, WEBM o MOV)." },
            slot: { type: "string", enum: ["cover", "gallery"], default: "cover", description: "cover = portada (reemplaza la imagen arriba de la página); gallery = arriba de las fotos." },
            poster_image_url: { type: "string", maxLength: 2000, description: "Imagen (URL https, JPG/PNG/WEBP, máx. 5 MB) que se muestra mientras carga el video." },
            remove: { type: "boolean", default: false, description: "true = quitar el video de ese slot (sin video_url)." },
        },
    },
    async handler(args, ctx) {
        const slot = args.slot === "gallery" ? "gallery" : "cover";
        const eventId = Number(args.event_id);
        await loadOwnedEvent(ctx, eventId, "id");
        const orgId = ctx.actor.orgId;
        try {
            if (args.remove) {
                if (args.video_url) throw new ToolError("invalid_input", "Envía video_url o remove=true, no ambos.");
                const { removed } = await clearEventVideo(ctx.supabase, { eventId, organizationId: orgId, slot });
                return { event_id: eventId, slot, removed, video: null };
            }
            if (!args.video_url) throw new ToolError("invalid_input", "Envía video_url (o remove=true para quitar el video).");
            if (!(await loadEventVideoState(ctx.supabase, eventId, slot)).available) throw new EventVideoUnavailableError();

            // Se descargan antes de gastar el cupo: una URL mala no lo consume
            const { buffer, contentType } = await fetchPublicVideo(args.video_url);
            const poster = args.poster_image_url ? await fetchPublicImage(args.poster_image_url) : null;
            const limit = await rateLimit("api:video", `org:${orgId}`, { windowSeconds: 3600, max: VIDEO_UPLOADS_PER_HOUR, supabase: ctx.supabase });
            if (!limit.allowed) throw new ToolError("rate_limited", `Alcanzaste el máximo de ${VIDEO_UPLOADS_PER_HOUR} videos por hora.`);

            const meta = contentType === "video/webm" ? { width: null, height: null, duration: null } : readMp4Meta(buffer);
            const posterUrl = poster ? await storeImage(orgId, poster.buffer, poster.contentType, "video-poster") : null;
            const { url } = await storeVideoBuffer(orgId, eventId, buffer, contentType);
            const saved = await saveEventVideo(ctx.supabase, {
                eventId,
                organizationId: orgId,
                slot,
                video: { url, poster_url: posterUrl, ...meta, mime: contentType, bytes: buffer.length },
            });
            const warnings = [
                posterUrl ? null : "Sin póster: mientras carga el video se ve un fondo negro. Pasa poster_image_url (p. ej. la imagen de portada actual) para mejorarlo.",
                meta.width ? null : "No se pudieron leer las dimensiones del video: la página lo muestra en 16:9.",
                buffer.length > 20 * 1024 * 1024 ? "El video pesa más de 20 MB: en celulares con mala conexión puede tardar en partir. Considera comprimirlo." : null,
            ].filter(Boolean);
            return {
                event_id: eventId,
                slot,
                video: saved.video,
                image_url: saved.image_url,
                ...(saved.image_from_poster ? { image_note: "El evento no tenía imagen: el póster del video quedó como su imagen (cartelera, al compartir y correos)." } : {}),
                bytes: buffer.length,
                ...(warnings.length ? { warnings } : {}),
            };
        } catch (err) {
            if (err instanceof EventVideoUnavailableError) throw new ToolError("unavailable", err.message);
            if (err instanceof VideoStorageError) throw new ToolError("invalid_input", err.message);
            throw err;
        }
    },
};

const generateImage: ToolDef = {
    name: "generate_image",
    title: "Generar imagen con IA",
    description:
        `Genera una imagen promocional del evento con IA (sin texto en la imagen, salvo que lo pidas en prompt) y la aloja en AI Tickets. ` +
        `Puedes dar dirección creativa en prompt y pasar hasta ${MAX_REFERENCE_IMAGES} imágenes de referencia por URL https ` +
        "(reference_image_urls: flyer anterior, logo, foto del artista o del lugar; también URLs devueltas por upload_image) " +
        "o usar la portada actual del evento (use_event_cover_as_reference). Las referencias guían estilo, colores y elementos; " +
        "si quieres editar la referencia (p. ej. adaptar el flyer a formato story), dilo en prompt. " +
        `Máximo ${IMAGE_GENERATIONS_PER_DAY} por día por organización. Formatos: square (feed), portrait (stories/reels), landscape (portada/web).`,
    scope: "write",
    audit: (args, result) => ({
        summary: `Generó una imagen ${args.format}${(result as any).reference_images_used ? ` con ${(result as any).reference_images_used} referencia(s)` : ""}${args.set_as_cover ? " (portada)" : ""}`,
        target: `event:${args.event_id}`,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            prompt: { type: "string", maxLength: 1000, description: "Dirección creativa: estilo, colores, ambiente, elementos, qué tomar de las referencias." },
            format: { type: "string", enum: ["square", "portrait", "landscape"], default: "square" },
            reference_image_urls: {
                type: "array",
                minItems: 1,
                maxItems: MAX_REFERENCE_IMAGES,
                items: { type: "string", maxLength: 2000 },
                description: "Imágenes de referencia (URLs https públicas, JPG/PNG/WEBP, máx. 5 MB c/u).",
            },
            use_event_cover_as_reference: { type: "boolean", default: false, description: "Usa la imagen de portada actual del evento como referencia." },
            set_as_cover: { type: "boolean", default: false },
        },
    },
    async handler(args, ctx) {
        if (!isImageGenerationConfigured()) {
            throw new ToolError("unavailable", "La generación de imágenes no está habilitada. Sube una imagen con upload_image.");
        }
        const event = await loadOwnedEvent<any>(ctx, args.event_id, EVENT_CONTEXT_SELECT);
        const referenceUrls: string[] = [...(args.reference_image_urls || [])];
        if (args.use_event_cover_as_reference) {
            if (!event.image_url) throw new ToolError("invalid_input", "El evento no tiene portada: sube una con upload_image o pasa reference_image_urls.");
            referenceUrls.unshift(event.image_url);
        }
        if (referenceUrls.length > MAX_REFERENCE_IMAGES) throw new ToolError("invalid_input", `Máximo ${MAX_REFERENCE_IMAGES} imágenes de referencia (incluida la portada).`);
        // Se descargan antes de gastar el cupo diario: una URL mala no consume una generación
        const referenceImages = await loadReferenceImages(referenceUrls);
        const limit = await rateLimit("api:genimg", `org:${ctx.actor.orgId}`, { windowSeconds: 86400, max: IMAGE_GENERATIONS_PER_DAY, supabase: ctx.supabase });
        if (!limit.allowed) throw new ToolError("rate_limited", `Alcanzaste el máximo de ${IMAGE_GENERATIONS_PER_DAY} imágenes generadas por día.`);
        const size = ({ square: "1024x1024", portrait: "1024x1536", landscape: "1536x1024" } as const)[args.format as "square"];
        let url: string;
        try {
            url = await generateEventImage(buildEventContext(event), ctx.actor.orgId, { extraPrompt: args.prompt, size, referenceImages });
        } catch (err: any) {
            console.error("generate_image:", err?.message);
            throw new ToolError("upstream", "No se pudo generar la imagen. Intenta con otra dirección creativa o sube una propia.");
        }
        if (args.set_as_cover) await setCover(ctx, Number(event.id), url);
        return { event_id: Number(event.id), url, format: args.format, reference_images_used: referenceImages.length, set_as_cover: Boolean(args.set_as_cover) };
    },
};

const presentPost = (p: any) => ({
    id: Number(p.id),
    event_id: Number(p.event_id),
    content: p.content,
    image_urls: p.image_urls || [],
    platforms: p.platforms || [],
    status: p.status,
    scheduled_for: p.scheduled_for ?? null,
    published_at: p.published_at ?? null,
    error: p.error_message ?? null,
    created_at: p.created_at,
});

const createSocialPost: ToolDef = {
    name: "create_social_post",
    title: "Crear publicación para redes",
    description:
        "Guarda una publicación para Instagram, Facebook, TikTok o LinkedIn como borrador (o programado si envías scheduled_for). NO lo publica: " +
        "para eso usa publish_social_post tras la aprobación del productor. Instagram y TikTok (foto) exigen al menos una imagen; " +
        "LinkedIn admite hasta 3.000 caracteres (publica en la página de empresa o el perfil que se eligió al conectar).",
    scope: "write",
    audit: (args, result) => ({
        summary: `Publicación ${(result as any).post?.status === "scheduled" ? "programada" : "en borrador"} para ${[...new Set(args.platforms)].join(", ")}`,
        target: `social_post:${(result as any).post?.id ?? ""}`,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
        type: "object",
        required: ["event_id", "content", "platforms"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            content: { type: "string", minLength: 1, maxLength: 2200, description: "Texto de la publicación (Instagram admite hasta 2.200 caracteres)." },
            image_urls: { type: "array", maxItems: 10, items: { type: "string", maxLength: 2000, pattern: "^https://" }, description: "URLs de upload_image/generate_image." },
            platforms: { type: "array", minItems: 1, maxItems: SOCIAL_PLATFORMS.length, items: { type: "string", enum: SOCIAL_PLATFORMS } },
            scheduled_for: { type: "string", format: "date-time", description: "ISO 8601 futuro. Se programa al publicar con publish_social_post." },
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
        const platforms = [...new Set<string>(args.platforms)];
        const images: string[] = args.image_urls || [];
        const problem = postMediaProblem(platforms, images.length, String(args.content).length);
        if (problem) throw new ToolError("invalid_input", `${problem}${/imagen/.test(problem) ? " (image_urls)" : ""}`);
        const storageBase = serverEnv("SUPABASE_URL")?.replace(/\/+$/, "");
        if (storageBase && images.some((u) => !u.startsWith(`${storageBase}/storage/v1/object/public/`))) {
            throw new ToolError("invalid_input", "Las imágenes deben estar alojadas en AI Tickets: súbelas antes con upload_image.");
        }
        let scheduledFor: string | null = null;
        if (args.scheduled_for) {
            const when = new Date(args.scheduled_for);
            if (when.getTime() < Date.now() + 5 * 60 * 1000) throw new ToolError("invalid_input", "scheduled_for debe ser al menos 5 minutos en el futuro.");
            scheduledFor = when.toISOString();
        }
        const { data, error } = await ctx.supabase
            .from("social_posts")
            .insert({
                organization_id: ctx.actor.orgId,
                event_id: event.id,
                content: args.content,
                image_urls: images,
                platforms,
                status: scheduledFor ? "scheduled" : "draft",
                scheduled_for: scheduledFor,
            })
            .select()
            .single();
        if (error) throw error;
        return {
            post: presentPost(data),
            review_url: `${ctx.origin}/dashboard/promote`,
            next_steps: "Muestra la publicación al productor y, si la aprueba, llama publish_social_post.",
        };
    },
};

const listSocialPosts: ToolDef = {
    name: "list_social_posts",
    title: "Listar publicaciones",
    description: "Publicaciones en redes sociales de la organización (borradores, programadas, publicadas y fallidas).",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            status: { type: "string", enum: ["draft", "scheduled", "published", "failed", "all"], default: "all" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
    },
    async handler(args, ctx) {
        let query = ctx.supabase.from("social_posts").select("*").eq("organization_id", ctx.actor.orgId).order("created_at", { ascending: false }).limit(args.limit);
        if (args.event_id) query = query.eq("event_id", args.event_id);
        if (args.status !== "all") query = query.eq("status", args.status);
        const { data, error } = await query;
        if (error) throw error;
        return { posts: (data || []).map(presentPost) };
    },
};

/** Lo que impide hacer una publicación: sin cuentas conectadas, evento en borrador/cancelado, o texto o imágenes que alguna red no acepta. */
async function checkPublishable(ctx: ToolContext, post: any) {
    const platforms: string[] = Array.isArray(post.platforms) ? post.platforms : [];
    const event = await loadOwnedEvent<any>(ctx, Number(post.event_id), "id, name, slug, status, cancelled_at");
    if (event.cancelled_at) throw new ToolError("conflict", "El evento está cancelado: no hagas publicaciones de él.");
    if (event.status !== "published") {
        throw new ToolError("conflict", `"${event.name}" está en BORRADOR: su link da 404. Publica el evento (set_event_status) antes de hacer publicaciones.`);
    }
    const { data: accounts } = await ctx.supabase
        .from("social_accounts")
        .select("platform, account_name")
        .eq("organization_id", ctx.actor.orgId)
        .eq("status", "active")
        .in("platform", platforms.length ? platforms : ["-"]);
    if (!accounts?.length) {
        throw new ToolError(
            "conflict",
            `No hay cuentas conectadas de ${platforms.join(" ni ") || "redes"} (get_account → connected_social_accounts). ` +
                `Conéctalas en ${ctx.origin}/dashboard/promote o publica el texto a mano.`,
        );
    }
    const problem = postMediaProblem(accounts.map((a: any) => a.platform), (post.image_urls || []).length, String(post.content || "").length);
    if (problem) throw new ToolError("invalid_input", `${problem} Corrige la publicación antes de publicarla.`);
    return { accounts, platforms, event };
}

const deleteSocialPost: ToolDef = {
    name: "delete_social_post",
    title: "Eliminar publicación",
    description: "Elimina una publicación en borrador (o fallida) que no salió. Las publicadas o programadas no se eliminan desde aquí.",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: { type: "object", required: ["post_id"], additionalProperties: false, properties: { post_id: { type: "integer", minimum: 1 } } },
    audit: (args) => ({ summary: "Eliminó una publicación en borrador", target: `social_post:${args.post_id}` }),
    async handler(args, ctx) {
        const { data: post } = await ctx.supabase.from("social_posts").select("id, event_id, status").eq("id", args.post_id).eq("organization_id", ctx.actor.orgId).maybeSingle();
        if (!post) throw new ToolError("not_found", "Publicación no encontrada en tu organización (ver list_social_posts).");
        await loadOwnedEvent(ctx, Number(post.event_id), "id");
        if (!["draft", "failed"].includes(post.status)) {
            throw new ToolError("conflict", `La publicación está ${post.status === "published" ? "publicada" : "programada"}: solo se eliminan borradores o fallidas.`);
        }
        const { error } = await ctx.supabase.from("social_posts").delete().eq("id", post.id).eq("organization_id", ctx.actor.orgId).in("status", ["draft", "failed"]);
        if (error) throw error;
        return { post_id: Number(post.id), event_id: Number(post.event_id), result: "deleted" };
    },
};

const publishPost: ToolDef = {
    name: "publish_social_post",
    title: "Publicar en redes",
    description:
        "Publica AHORA (o programa, si la publicación tiene scheduled_for) una publicación en las cuentas conectadas de la organización. " +
        "Acción pública e irreversible: el servidor devuelve primero un resumen y solo publica al repetir la llamada con confirmation_token.",
    scope: "publish",
    async confirm(args, ctx) {
        const { data: post } = await ctx.supabase
            .from("social_posts")
            .select("id, event_id, status, content, platforms, image_urls, scheduled_for")
            .eq("id", args.post_id)
            .eq("organization_id", ctx.actor.orgId)
            .maybeSingle();
        if (!post) throw new ToolError("not_found", "Publicación no encontrada en tu organización.");
        if (post.status === "published") throw new ToolError("conflict", "Esta publicación ya salió.");
        // Se valida aquí (antes de pedir confirmación) todo lo que haría fallar la publicación
        const { accounts, platforms, event } = await checkPublishable(ctx, post);
        const text = String(post.content || "");
        const where = accounts.map((a: any) => `${platformName(a.platform)} (${a.account_name || "cuenta conectada"})`).join(", ");
        const missing = platforms.filter((p: string) => !accounts.some((a: any) => a.platform === p));
        return {
            message:
                `${post.scheduled_for ? `Programar para ${localDateTime(post.scheduled_for)?.replace("T", " ")} (hora de Chile)` : "Publicar AHORA"} la publicación ${post.id} ` +
                `de "${event.name}" en ${where}. Es público y no se puede deshacer desde AI Tickets.`,
            details: {
                post_id: Number(post.id),
                event_id: Number(event.id),
                accounts: accounts.map((a: any) => ({ platform: a.platform, account: a.account_name })),
                text: text.length > 400 ? `${text.slice(0, 400)}…` : text,
                image_urls: post.image_urls || [],
                event_url: eventPublicUrl(ctx, event.slug),
            },
            warnings: missing.length ? [`No hay cuenta conectada de ${missing.join(", ")}: la publicación solo saldrá en ${accounts.map((a: any) => a.platform).join(", ")}.`] : undefined,
        };
    },
    audit: (args, result) => ({ summary: (result as any).status === "scheduled" ? "Programó una publicación en redes" : "Publicó en redes", target: `social_post:${args.post_id}` }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["post_id"],
        additionalProperties: false,
        properties: { post_id: { type: "integer", minimum: 1 } },
    },
    async handler(args, ctx) {
        const { data: post } = await ctx.supabase.from("social_posts").select("id, event_id, status, content, platforms, image_urls").eq("id", args.post_id).eq("organization_id", ctx.actor.orgId).maybeSingle();
        if (!post) throw new ToolError("not_found", "Publicación no encontrada en tu organización.");
        if (post.status === "published") throw new ToolError("conflict", "Esta publicación ya salió.");
        await checkPublishable(ctx, post);
        const result = await publishSocialPost(ctx.actor.orgId, post.id);
        if (!result.ok) {
            const code = result.httpStatus === 404 ? "not_found" : result.httpStatus === 400 ? "invalid_input" : result.httpStatus === 502 ? "upstream" : "unavailable";
            throw new ToolError(code, result.message);
        }
        return { post_id: Number(post.id), event_id: Number(post.event_id), status: result.status, dashboard_url: eventDashboardUrl(ctx, Number(post.event_id)) };
    },
};

// ---------------------------------------------------------------------------
// Links de promotor / RRPP: ven sus propias ventas en el celular, sin cuenta (src/lib/promoterLinks.ts)
// ---------------------------------------------------------------------------

const createPromoterLinkTool: ToolDef = {
    name: "create_promoter_link",
    title: "Crear link de promotor",
    description:
        "Crea un link privado para un promotor o RRPP: lo abre en el celular, sin cuenta, y ve SOLO sus ventas (las compras pagadas que " +
        "llegaron con su ?ref=): entradas y monto por evento y función, y su link para compartir cada evento a la venta. No ve datos de " +
        "compradores. Sin event_id cubre todos los eventos de la productora (un RRPP de todas las noches). La URL privada se entrega solo " +
        "esta vez; revócala con revoke_promoter_link. ref = su código de seguimiento (por defecto, el nombre en minúsculas y con guiones).",
    scope: "write",
    permission: "events.write",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: {
            name: { type: "string", minLength: 1, maxLength: 80, description: "Nombre del promotor (lo ve en su página)." },
            ref: { type: "string", maxLength: 64, pattern: "^[A-Za-z0-9_.-]+$", description: "Código de seguimiento (?ref=). Omitir = a partir del nombre." },
            event_id: { ...eventIdSchema, description: "Solo este evento. Omitir = todos los eventos de la productora." },
        },
    },
    audit: (args, result) => ({ summary: `Link de promotor creado (${args.name})`, target: String((result.link as any)?.id || "") }),
    async handler(args, ctx) {
        if (args.event_id != null) await loadOwnedEvent(ctx, args.event_id, "id");
        else if (ctx.actor.eventIds) {
            throw new ToolError("forbidden", "Tu acceso está limitado a ciertos eventos: indica event_id para crear el link de uno de ellos.");
        }
        const ref = promoterRef(args.ref || args.name);
        if (!PROMOTER_REF_RE.test(ref)) throw new ToolError("invalid_input", "El nombre o ref no sirve como código: usa letras o números.");
        const created = await createPromoterLink(ctx.supabase, {
            orgId: ctx.actor.orgId,
            eventId: args.event_id ?? null,
            name: args.name,
            ref,
            userId: ctx.actor.userId,
            origin: ctx.origin,
        });
        return {
            promoter_url: created.url,
            link: created.link,
            share_example: `${ctx.origin}/eventos/<slug>?ref=${ref}`,
            note:
                "Envíale promoter_url al promotor: ahí ve sus ventas y copia su link de cada evento (con ?ref=). Las ventas que ya entraron con " +
                "ese ref también aparecen. Quien tenga promoter_url ve esos números: compártelo solo con el promotor.",
        };
    },
};

const listPromoterLinksTool: ToolDef = {
    name: "list_promoter_links",
    title: "Listar links de promotor",
    description:
        "Links de promotor de la productora (o los que cubren un evento) con su nombre, ref, alcance, estado y cuántas veces los abrieron. " +
        "No incluye la URL privada (solo se entrega al crearla). Las ventas de cada ref están en get_event_performance → sales_channels.",
    scope: "read",
    permission: "events.read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        if (args.event_id != null) await loadOwnedEvent(ctx, args.event_id, "id");
        return { links: await listPromoterLinks(ctx.supabase, ctx.actor.orgId, { eventId: args.event_id ?? null, eventIds: ctx.actor.eventIds }) };
    },
};

const revokePromoterLinkTool: ToolDef = {
    name: "revoke_promoter_link",
    title: "Revocar link de promotor",
    description: "Desactiva un link de promotor (link_id de list_promoter_links o create_promoter_link). Deja de funcionar de inmediato; las ventas con su ref se siguen contando.",
    scope: "write",
    permission: "events.write",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["link_id"],
        additionalProperties: false,
        properties: { link_id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$", description: "ID del link (uuid)." } },
    },
    audit: (args) => ({ summary: "Link de promotor revocado", target: args.link_id }),
    async handler(args, ctx) {
        const link = await revokePromoterLink(ctx.supabase, args.link_id, ctx.actor.orgId, ctx.actor.eventIds);
        if (!link) throw new ToolError("not_found", "Link de promotor no encontrado en tu organización.");
        return { link_id: link.id, name: link.name, status: "revoked" };
    },
};

export const marketingTools: ToolDef[] = [getMarketingKit, createTrackingLink, uploadImage, setEventVideo, generateImage, createSocialPost, listSocialPosts, deleteSocialPost, publishPost,
    createPromoterLinkTool, listPromoterLinksTool, revokePromoterLinkTool];
