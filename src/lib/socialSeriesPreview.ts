// Links firmados a la vista previa de una pieza de la difusión automática, para quien no tiene la sesión del panel (MCP
// de productores y de admin). No guarda nada: GET /api/events/social-series-preview la genera al abrirla con los datos
// de ese momento; la imagen que se publica se sigue generando ~2 h antes (dispatchSlot en socialSeries.ts).
//
// Token: base64url(JSON {p, e, k, d, v, n, exp}).base64url(HMAC-SHA256). Sirve para una sola pieza de un solo evento y
// vence a las 24 h. Se firma solo al responder a alguien con acceso al evento (seriesView).
import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "../pages/api/_lib/server-utils";

export const PREVIEW_TOKEN_TTL_SECONDS = 24 * 3600;
const PURPOSE = "series_preview";

export type PreviewPiece = {
    eventId: number;
    kind: "story" | "feed_post";
    variant: "countdown" | "sold_out";
    days: number;
    platform: "instagram" | "facebook" | "tiktok";
};

/** Limpia una pieza venida de la query o de un slot. TikTok siempre es vertical: su "feed_post" se dibuja como historia. */
export function normalizePiece(raw: { eventId: unknown; kind?: unknown; variant?: unknown; days?: unknown; platform?: unknown }): PreviewPiece | null {
    const eventId = Math.round(Number(raw.eventId));
    if (!Number.isInteger(eventId) || eventId <= 0) return null;
    const platform = raw.platform === "facebook" || raw.platform === "tiktok" ? raw.platform : "instagram";
    return {
        eventId,
        platform,
        kind: raw.kind === "feed_post" && platform !== "tiktok" ? "feed_post" : "story",
        variant: raw.variant === "sold_out" ? "sold_out" : "countdown",
        days: Math.max(0, Math.min(400, Math.round(Number(raw.days)) || 0)),
    };
}

function previewKey(): Buffer | null {
    const base = serverEnv("INTERNAL_API_SECRET") || serverEnv("SUPABASE_SERVICE_ROLE_KEY");
    return base ? createHmac("sha256", "aitickets-series-preview").update(String(base)).digest() : null;
}

export function signPreviewToken(piece: PreviewPiece, now = Date.now()): string | null {
    const key = previewKey();
    if (!key) return null;
    const payload = Buffer.from(
        JSON.stringify({ p: PURPOSE, e: piece.eventId, k: piece.kind, d: piece.days, v: piece.variant, n: piece.platform, exp: Math.floor(now / 1000) + PREVIEW_TOKEN_TTL_SECONDS }),
    ).toString("base64url");
    return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

/** La pieza del token, o null si la firma no calza o venció. Sin efectos. */
export function verifyPreviewToken(token: unknown, now = Date.now()): PreviewPiece | null {
    const key = previewKey();
    if (!key || typeof token !== "string" || token.length > 1024) return null;
    const [payload, sig, extra] = token.split(".");
    if (!payload || !sig || extra !== undefined) return null;
    const expected = createHmac("sha256", key).update(payload).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (data?.p !== PURPOSE || typeof data.exp !== "number" || data.exp <= Math.floor(now / 1000)) return null;
        return normalizePiece({ eventId: data.e, kind: data.k, variant: data.v, days: data.d, platform: data.n });
    } catch {
        return null;
    }
}

/** Link de la pieza. null en un reel (su vista previa es el video) o si falta la clave. */
export function previewLink(origin: string, eventId: number, slot: { kind: string; variant?: string | null; days_to_event: number; platform?: string | null }, now = Date.now()): string | null {
    if (slot.kind === "reel") return null;
    const piece = normalizePiece({ eventId, kind: slot.kind, variant: slot.variant, days: slot.days_to_event, platform: slot.platform });
    const token = piece && signPreviewToken(piece, now);
    return token ? `${origin.replace(/\/+$/, "")}/api/events/social-series-preview?token=${token}` : null;
}
