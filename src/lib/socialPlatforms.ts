// Redes donde AI Tickets publica vía Zernio (https://docs.zernio.com/platforms): cuáles se conectan desde Promocionar
// y qué exige cada una. Puro (sin servidor): lo usan el panel (ConnectedAccounts.vue, CreateSocialPost.vue), las rutas
// /api/promote/* y las herramientas de posts de la API de productores.
//
// - Instagram: feed con 1 a 10 imágenes (JPEG; Zernio convierte), caption de 2.200.
// - Facebook (página): texto solo o hasta 10 imágenes; links clickeables en el texto.
// - TikTok: foto (1 a 35 imágenes, "photo post") o un video vertical; el texto va como descripción (4.000) y TikTok
//   exige declarar privacidad y consentimiento en cada post (tiktokSettings). Los links no son clickeables.
// - LinkedIn (perfil o página de empresa, se elige al conectar): texto de hasta 3.000, solo o con hasta 20 imágenes.

export const SOCIAL_PLATFORMS = ["instagram", "facebook", "tiktok", "linkedin"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const isSocialPlatform = (v: unknown): v is SocialPlatform => typeof v === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(v);

export const PLATFORM_RULES: Record<SocialPlatform, { name: string; maxChars: number; maxImages: number; needsImage: boolean }> = {
    instagram: { name: "Instagram", maxChars: 2200, maxImages: 10, needsImage: true },
    facebook: { name: "Facebook", maxChars: 63206, maxImages: 10, needsImage: false },
    tiktok: { name: "TikTok", maxChars: 2200, maxImages: 35, needsImage: true },
    linkedin: { name: "LinkedIn", maxChars: 3000, maxImages: 20, needsImage: false },
};

export const platformName = (p: string) => (isSocialPlatform(p) ? PLATFORM_RULES[p].name : p);

/** Plantillas de reel (9:16) en Canva: AI Tickets no genera video, el productor lo arma ahí y lo sube como video del evento. */
export const CANVA_REEL_URL = "https://www.canva.com/create/instagram-reels/";

/** Lo que impide publicar un post en esas redes (texto e imágenes), o null si está bien. */
export function postMediaProblem(platforms: string[], imageCount: number, contentLength: number): string | null {
    for (const p of platforms) {
        if (!isSocialPlatform(p)) return `Red no soportada: ${p}.`;
        const r = PLATFORM_RULES[p];
        if (r.needsImage && imageCount < 1) return `${r.name} requiere al menos una imagen.`;
        if (imageCount > r.maxImages) return `${r.name} acepta hasta ${r.maxImages} imágenes.`;
        if (contentLength > r.maxChars) return `El texto supera el máximo de ${r.name} (${r.maxChars.toLocaleString("es-CL")} caracteres).`;
    }
    return null;
}

/**
 * Ajustes que TikTok exige en cada post (https://docs.zernio.com/platforms/tiktok/fields): público, comentarios
 * activos, consentimiento del creador (el productor lo da al aprobar en el panel) y contenido de marca propia. En
 * fotos el texto completo va en `description` (el `content` queda como título de 90 caracteres).
 */
export function tiktokSettings({ photo, description }: { photo: boolean; description: string }) {
    return {
        privacy_level: "PUBLIC_TO_EVERYONE",
        allow_comment: true,
        ...(photo ? { media_type: "photo", photo_cover_index: 0, description: description.slice(0, 4000) } : { allow_duet: false, allow_stitch: false }),
        commercialContentType: "brand_organic",
        content_preview_confirmed: true,
        express_consent_given: true,
    };
}

/** Título de un photo post de TikTok: la primera línea, sin hashtags ni links, hasta 90 caracteres. */
export function tiktokTitle(text: string): string {
    const first = String(text || "").split("\n").find((l) => l.trim()) || "";
    return first.replace(/https?:\/\/\S+/g, "").replace(/#\S+/g, "").replace(/\s{2,}/g, " ").trim().slice(0, 90);
}
