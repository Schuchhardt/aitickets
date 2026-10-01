// Herramientas: piezas de marketing (imágenes, posts, links con seguimiento).
// El copy lo escribe el LLM del productor (para eso get_marketing_kit le da el contexto); el servidor guarda
// imágenes, genera imágenes con IA (opcional) y publica en las redes conectadas.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ToolError, type ToolDef, type ToolContext } from "../registry";
import { eventIdSchema, loadOwnedEvent, eventPublicUrl, eventDashboardUrl } from "./common";
import {
    buildEventContext, EVENT_CONTEXT_SELECT, generateEventImage, isImageGenerationConfigured, publishSocialPost,
    storeImage, sniffImageType, MAX_IMAGE_BYTES,
} from "../../marketing";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { serverEnv } from "../../../pages/api/_lib/server-utils";

const PLATFORMS = ["instagram", "facebook"] as const;
const IMAGE_GENERATIONS_PER_DAY = 20;

// ---------------------------------------------------------------------------
// Descarga segura de imágenes por URL (anti-SSRF)
// ---------------------------------------------------------------------------

/** true si la IP es pública (no loopback, privada, link-local, CGNAT, multicast ni reservada). */
export function isPublicIp(ip: string): boolean {
    const v = isIP(ip);
    if (v === 4) {
        const [a, b] = ip.split(".").map(Number);
        if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
        if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
        if (a === 169 && b === 254) return false; // link-local / metadata
        if (a === 172 && b >= 16 && b <= 31) return false;
        if (a === 192 && b === 168) return false;
        if (a === 192 && b === 0) return false;
        if (a === 198 && (b === 18 || b === 19)) return false;
        return true;
    }
    if (v === 6) {
        const s = ip.toLowerCase();
        const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
        if (mapped) return isPublicIp(mapped[1]);
        if (s === "::" || s === "::1") return false;
        if (/^f[cd]/.test(s)) return false; // ULA
        if (/^fe[89ab]/.test(s)) return false; // link-local
        if (/^ff/.test(s)) return false; // multicast
        if (s.startsWith("64:ff9b:") || s.startsWith("2001:db8")) return false;
        return true;
    }
    return false;
}

async function assertPublicHost(url: URL) {
    if (url.protocol !== "https:") throw new ToolError("invalid_input", "Solo se aceptan URLs https.");
    if (url.username || url.password) throw new ToolError("invalid_input", "URL inválida.");
    if (url.port && url.port !== "443") throw new ToolError("invalid_input", "Puerto no permitido.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (!addresses.length) throw new ToolError("invalid_input", "No se pudo resolver el dominio de la imagen.");
    if (addresses.some((a: any) => !isPublicIp(a.address))) throw new ToolError("invalid_input", "La URL apunta a una dirección no permitida.");
}

/** Descarga una imagen pública (https, máx. 5 MB, máx. 3 redirecciones verificadas). */
export async function fetchPublicImage(rawUrl: string, fetchImpl: typeof fetch = fetch): Promise<{ buffer: Buffer; contentType: string }> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new ToolError("invalid_input", "URL de imagen inválida.");
    }
    for (let hop = 0; hop <= 3; hop++) {
        await assertPublicHost(url);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
            const res = await fetchImpl(url, { redirect: "manual", signal: controller.signal, headers: { Accept: "image/*" } });
            if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
                url = new URL(res.headers.get("location")!, url);
                continue;
            }
            if (!res.ok || !res.body) throw new ToolError("upstream", `No se pudo descargar la imagen (HTTP ${res.status}).`);
            const declared = Number(res.headers.get("content-length") || 0);
            if (declared > MAX_IMAGE_BYTES) throw new ToolError("invalid_input", "La imagen supera 5 MB.");
            const chunks: Uint8Array[] = [];
            let size = 0;
            const reader = res.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > MAX_IMAGE_BYTES) {
                    await reader.cancel().catch(() => {});
                    throw new ToolError("invalid_input", "La imagen supera 5 MB.");
                }
                chunks.push(value);
            }
            const buffer = Buffer.concat(chunks);
            const contentType = sniffImageType(buffer);
            if (!contentType) throw new ToolError("invalid_input", "El archivo no es una imagen JPG, PNG, WEBP o GIF.");
            return { buffer, contentType };
        } catch (err: any) {
            if (err instanceof ToolError) throw err;
            throw new ToolError("upstream", err?.name === "AbortError" ? "La descarga de la imagen tardó demasiado." : "No se pudo descargar la imagen.");
        } finally {
            clearTimeout(timer);
        }
    }
    throw new ToolError("upstream", "Demasiadas redirecciones al descargar la imagen.");
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
        "redes de la organización, redes conectadas para publicar y guía de estilo. Úsala antes de redactar posts, emails o anuncios.",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, EVENT_CONTEXT_SELECT);
        const [{ data: org }, { data: accounts }] = await Promise.all([
            ctx.supabase.from("organizations").select("public_name, instagram, facebook, tiktok, website").eq("id", ctx.actor.orgId).maybeSingle(),
            ctx.supabase.from("social_accounts").select("platform, account_name").eq("organization_id", ctx.actor.orgId).eq("status", "active"),
        ]);
        const url = eventPublicUrl(ctx, event.slug);
        return {
            event_id: Number(event.id),
            status: event.status,
            brief: buildEventContext(event),
            public_url: url,
            image_url: event.image_url || null,
            organization: org ? { name: org.public_name, instagram: org.instagram, facebook: org.facebook, tiktok: org.tiktok, website: org.website } : null,
            can_publish_to: (accounts || []).map((a: any) => ({ platform: a.platform, account: a.account_name })),
            image_generation_available: isImageGenerationConfigured(),
            tracking_link_examples: url ? {
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
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, slug");
        const url = new URL(eventPublicUrl(ctx, event.slug)!);
        for (const k of ["ref", "utm_source", "utm_medium", "utm_campaign"]) if (args[k]) url.searchParams.set(k, args[k]);
        return { event_id: Number(event.id), url: url.toString() };
    },
};

const uploadImage: ToolDef = {
    name: "upload_image",
    title: "Subir imagen",
    description:
        "Sube una imagen (JPG, PNG, WEBP o GIF, máx. 5 MB) desde una URL https pública o en base64 y devuelve su URL alojada en AI Tickets. " +
        "Con event_id + set_as_cover=true queda como portada del evento. La URL sirve también para create_social_post.",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            image_url: { type: "string", maxLength: 2000, pattern: "^https://", description: "URL https pública de la imagen." },
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

const generateImage: ToolDef = {
    name: "generate_image",
    title: "Generar imagen con IA",
    description:
        `Genera una imagen promocional del evento con IA (sin texto en la imagen) y la aloja en AI Tickets. ` +
        `Puedes dar dirección creativa en prompt. Máximo ${IMAGE_GENERATIONS_PER_DAY} por día por organización. ` +
        "Formatos: square (feed), portrait (stories/reels), landscape (portada/web).",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            prompt: { type: "string", maxLength: 1000, description: "Dirección creativa: estilo, colores, ambiente, elementos." },
            format: { type: "string", enum: ["square", "portrait", "landscape"], default: "square" },
            set_as_cover: { type: "boolean", default: false },
        },
    },
    async handler(args, ctx) {
        if (!isImageGenerationConfigured()) {
            throw new ToolError("unavailable", "La generación de imágenes no está habilitada. Sube una imagen con upload_image.");
        }
        const event = await loadOwnedEvent<any>(ctx, args.event_id, EVENT_CONTEXT_SELECT);
        const limit = await rateLimit("api:genimg", `org:${ctx.actor.orgId}`, { windowSeconds: 86400, max: IMAGE_GENERATIONS_PER_DAY, supabase: ctx.supabase });
        if (!limit.allowed) throw new ToolError("rate_limited", `Alcanzaste el máximo de ${IMAGE_GENERATIONS_PER_DAY} imágenes generadas por día.`);
        const size = ({ square: "1024x1024", portrait: "1024x1536", landscape: "1536x1024" } as const)[args.format as "square"];
        let url: string;
        try {
            url = await generateEventImage(buildEventContext(event), ctx.actor.orgId, { extraPrompt: args.prompt, size });
        } catch (err: any) {
            console.error("generate_image:", err?.message);
            throw new ToolError("upstream", "No se pudo generar la imagen. Intenta con otra dirección creativa o sube una propia.");
        }
        if (args.set_as_cover) await setCover(ctx, Number(event.id), url);
        return { event_id: Number(event.id), url, format: args.format, set_as_cover: Boolean(args.set_as_cover) };
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
    title: "Crear post para redes",
    description:
        "Guarda un post para Instagram/Facebook como borrador (o programado si envías scheduled_for). NO lo publica: " +
        "para eso usa publish_social_post tras la aprobación del productor. Instagram exige al menos una imagen.",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
        type: "object",
        required: ["event_id", "content", "platforms"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            content: { type: "string", minLength: 1, maxLength: 2200, description: "Texto del post (Instagram admite hasta 2.200 caracteres)." },
            image_urls: { type: "array", maxItems: 10, items: { type: "string", maxLength: 2000, pattern: "^https://" }, description: "URLs de upload_image/generate_image." },
            platforms: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", enum: PLATFORMS } },
            scheduled_for: { type: "string", format: "date-time", description: "ISO 8601 futuro. Se programa al publicar con publish_social_post." },
        },
    },
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id");
        const platforms = [...new Set<string>(args.platforms)];
        const images: string[] = args.image_urls || [];
        if (platforms.includes("instagram") && !images.length) throw new ToolError("invalid_input", "Instagram requiere al menos una imagen (image_urls).");
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
            next_steps: "Muestra el post al productor y, si lo aprueba, llama publish_social_post.",
        };
    },
};

const listSocialPosts: ToolDef = {
    name: "list_social_posts",
    title: "Listar posts",
    description: "Posts de redes sociales de la organización (borradores, programados, publicados y fallidos).",
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

const publishPost: ToolDef = {
    name: "publish_social_post",
    title: "Publicar post en redes",
    description:
        "Publica AHORA (o programa, si el post tiene scheduled_for) un post en las cuentas conectadas de la organización. " +
        "Acción pública e irreversible: confirma el texto y la imagen con el productor antes.",
    scope: "publish",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["post_id"],
        additionalProperties: false,
        properties: { post_id: { type: "integer", minimum: 1 } },
    },
    async handler(args, ctx) {
        const { data: post } = await ctx.supabase.from("social_posts").select("id, event_id, status").eq("id", args.post_id).eq("organization_id", ctx.actor.orgId).maybeSingle();
        if (!post) throw new ToolError("not_found", "Post no encontrado en tu organización.");
        if (post.status === "published") throw new ToolError("conflict", "Este post ya fue publicado.");
        const result = await publishSocialPost(ctx.actor.orgId, post.id);
        if (!result.ok) {
            const code = result.httpStatus === 404 ? "not_found" : result.httpStatus === 400 ? "invalid_input" : result.httpStatus === 502 ? "upstream" : "unavailable";
            throw new ToolError(code, result.message);
        }
        return { post_id: Number(post.id), event_id: Number(post.event_id), status: result.status, dashboard_url: eventDashboardUrl(ctx, Number(post.event_id)) };
    },
};

export const marketingTools: ToolDef[] = [getMarketingKit, createTrackingLink, uploadImage, generateImage, createSocialPost, listSocialPosts, publishPost];
