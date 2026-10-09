// Links privados de vista previa de un evento (también borradores): /eventos/vista-previa/<token>.
// Solo servidor. Tabla aitickets_event_preview_links (migración 202610080100): se guarda el sha256 del token.
//
// Opciones al crear:
//   - expiresInHours: vencimiento (1 h a 1 año); null = sin vencimiento (hasta revocarlo).
//   - singleUse: el primer navegador que lo abre lo consume y queda atado a él con una cookie (nonce), así
//     puede recargar la página; cualquier otro navegador recibe "link ya usado".
// Los bots que generan vistas previas de links (WhatsApp, Slack, iMessage…) NUNCA consumen un link de un
// solo uso ni ven datos del evento: reciben una página genérica (ver isLinkPreviewBot).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./auth-helpers";

export const PREVIEW_PATH = "/eventos/vista-previa";
export const PREVIEW_TOKEN_PREFIX = "pv_";
export const PREVIEW_DEFAULT_HOURS = 7 * 24;
export const PREVIEW_MAX_HOURS = 365 * 24;
export const PREVIEW_MAX_ACTIVE_PER_EVENT = 50;
/** Cookie que ata un link de un solo uso al navegador que lo consumió. */
export const PREVIEW_COOKIE_PREFIX = "aitk_pv_";

const TOKEN_RE = /^pv_[A-Za-z0-9_-]{32,64}$/;
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|slack|discord|skype|linkedin|embedly|preview|vkshare|pinterest|bingpreview|headless|lighthouse|curl|wget|python-requests|go-http-client/i;

export const sha256Hex = (v: string) => createHash("sha256").update(v).digest("hex");
export const isPreviewToken = (v: unknown): v is string => typeof v === "string" && TOKEN_RE.test(v);
export const isLinkPreviewBot = (userAgent: string | null | undefined) => !userAgent || BOT_RE.test(userAgent);

export type PreviewLinkRow = {
    id: string;
    event_id: number;
    organization_id: number;
    single_use: boolean;
    expires_at: string | null;
    consumed_at: string | null;
    consumed_nonce_hash: string | null;
    revoked_at: string | null;
    view_count: number;
    last_viewed_at: string | null;
    label: string | null;
    created_via: string;
    created_at: string;
};

const LINK_COLUMNS = "id, event_id, organization_id, single_use, expires_at, consumed_at, consumed_nonce_hash, revoked_at, view_count, last_viewed_at, label, created_via, created_at";

export class PreviewLinkError extends Error {
    code: "invalid_input" | "conflict" | "unavailable";
    constructor(code: PreviewLinkError["code"], message: string) {
        super(message);
        this.code = code;
    }
}

const isMissingTable = (error: any) =>
    !!error && (error.code === "42P01" || error.code === "PGRST205" || /aitickets_event_preview_links/.test(error.message || ""));

export function previewUrl(origin: string, token: string) {
    return `${origin.replace(/\/+$/, "")}${PREVIEW_PATH}/${token}`;
}

export type PreviewLinkStatus = "active" | "expired" | "revoked" | "used";

export function linkStatus(row: Pick<PreviewLinkRow, "revoked_at" | "expires_at" | "single_use" | "consumed_at">, now = Date.now()): PreviewLinkStatus {
    if (row.revoked_at) return "revoked";
    if (row.expires_at && new Date(row.expires_at).getTime() <= now) return "expired";
    if (row.single_use && row.consumed_at) return "used";
    return "active";
}

/** Representación pública (panel / API). Nunca incluye el token (no se guarda). */
export function presentPreviewLink(row: PreviewLinkRow, now = Date.now()) {
    return {
        id: row.id,
        event_id: Number(row.event_id),
        label: row.label,
        single_use: row.single_use,
        expires_at: row.expires_at,
        status: linkStatus(row, now),
        consumed_at: row.consumed_at,
        view_count: Number(row.view_count) || 0,
        last_viewed_at: row.last_viewed_at,
        created_via: row.created_via,
        created_at: row.created_at,
    };
}

export type CreatePreviewLinkInput = {
    eventId: number;
    orgId: number;
    userId?: number | null;
    /** null = sin vencimiento. undefined = PREVIEW_DEFAULT_HOURS. */
    expiresInHours?: number | null;
    singleUse?: boolean;
    label?: string | null;
    via?: "dashboard" | "mcp" | "rest";
    origin: string;
};

/**
 * Crea un link de vista previa. El evento ya debe estar verificado como de la organización (quien llama).
 * Devuelve la URL con el token en claro: es la única vez que existe.
 */
export async function createPreviewLink(input: CreatePreviewLinkInput, supabase = getSupabaseAdmin()) {
    let expiresAt: string | null;
    if (input.expiresInHours === null) {
        expiresAt = null;
    } else {
        const hours = input.expiresInHours === undefined ? PREVIEW_DEFAULT_HOURS : Number(input.expiresInHours);
        if (!Number.isFinite(hours) || hours < 1 || hours > PREVIEW_MAX_HOURS) {
            throw new PreviewLinkError("invalid_input", `El vencimiento debe estar entre 1 hora y ${PREVIEW_MAX_HOURS / 24} días (o sin vencimiento).`);
        }
        expiresAt = new Date(Date.now() + Math.round(hours) * 3600 * 1000).toISOString();
    }

    const { data: current, error: countError } = await supabase
        .from("aitickets_event_preview_links")
        .select("expires_at, single_use, consumed_at, revoked_at")
        .eq("event_id", input.eventId)
        .is("revoked_at", null)
        .limit(500);
    if (countError) {
        if (isMissingTable(countError)) throw new PreviewLinkError("unavailable", "Los links de vista previa estarán disponibles en unos minutos.");
        throw countError;
    }
    const active = (current || []).filter((r: any) => linkStatus(r) === "active").length;
    if (active >= PREVIEW_MAX_ACTIVE_PER_EVENT) {
        throw new PreviewLinkError("conflict", `Este evento ya tiene ${PREVIEW_MAX_ACTIVE_PER_EVENT} links de vista previa activos. Revoca alguno antes de crear otro.`);
    }

    const token = `${PREVIEW_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const label = typeof input.label === "string" && input.label.trim() ? input.label.trim().slice(0, 80) : null;
    const { data, error } = await supabase
        .from("aitickets_event_preview_links")
        .insert({
            id: randomUUID(),
            event_id: input.eventId,
            organization_id: input.orgId,
            token_hash: sha256Hex(token),
            single_use: Boolean(input.singleUse),
            expires_at: expiresAt,
            label,
            created_by_user_id: input.userId ?? null,
            created_via: input.via || "dashboard",
        })
        .select(LINK_COLUMNS)
        .single();
    if (error) {
        if (isMissingTable(error)) throw new PreviewLinkError("unavailable", "Los links de vista previa estarán disponibles en unos minutos.");
        throw error;
    }
    return { url: previewUrl(input.origin, token), link: presentPreviewLink(data as PreviewLinkRow) };
}

/** Links de un evento (más recientes primero). [] si la tabla aún no existe. */
export async function listPreviewLinks(eventId: number, orgId: number, supabase = getSupabaseAdmin()) {
    const { data, error } = await supabase
        .from("aitickets_event_preview_links")
        .select(LINK_COLUMNS)
        .eq("event_id", eventId)
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100);
    if (error) {
        if (isMissingTable(error)) return [];
        throw error;
    }
    return (data || []).map((r: any) => presentPreviewLink(r));
}

/** Revoca un link de la organización. false si no existe. */
export async function revokePreviewLink(linkId: string, orgId: number, supabase = getSupabaseAdmin()): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/i.test(linkId)) return false;
    const { data, error } = await supabase
        .from("aitickets_event_preview_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", linkId)
        .eq("organization_id", orgId)
        .is("revoked_at", null)
        .select("id");
    if (error) {
        if (isMissingTable(error)) return false;
        throw error;
    }
    if (data?.length) return true;
    // Ya revocado: idempotente
    const { data: existing } = await supabase.from("aitickets_event_preview_links").select("id").eq("id", linkId).eq("organization_id", orgId).maybeSingle();
    return Boolean(existing);
}

export type ResolvePreviewResult =
    | { ok: true; link: PreviewLinkRow; eventId: number; orgId: number; setCookie?: { name: string; value: string; maxAge: number | undefined } }
    | { ok: false; reason: "not_found" | "expired" | "revoked" | "used" | "bot" };

/**
 * Valida un token de la URL y registra la visita. `cookieNonce` es el valor de la cookie del navegador
 * para este link (si existe). Para un link de un solo uso aún no consumido, lo consume y devuelve la cookie
 * que hay que fijar. Los bots nunca consumen ni registran visitas.
 */
export async function resolvePreviewToken(
    token: unknown,
    { userAgent, cookieNonce }: { userAgent?: string | null; cookieNonce?: string | null },
    supabase = getSupabaseAdmin(),
): Promise<ResolvePreviewResult> {
    if (!isPreviewToken(token)) return { ok: false, reason: "not_found" };
    const { data, error } = await supabase
        .from("aitickets_event_preview_links")
        .select(LINK_COLUMNS)
        .eq("token_hash", sha256Hex(token))
        .maybeSingle();
    if (error && !isMissingTable(error)) console.error("preview link:", error.message);
    const link = data as PreviewLinkRow | null;
    if (!link) return { ok: false, reason: "not_found" };

    const status = linkStatus(link);
    if (status === "revoked" || status === "expired") return { ok: false, reason: status };

    const bot = isLinkPreviewBot(userAgent);
    if (link.single_use) {
        if (link.consumed_at) {
            // Ya consumido: solo el navegador que lo consumió (cookie con el nonce)
            if (!cookieNonce || !link.consumed_nonce_hash || sha256Hex(cookieNonce) !== link.consumed_nonce_hash) return { ok: false, reason: "used" };
        } else {
            if (bot) return { ok: false, reason: "bot" };
            const nonce = randomBytes(24).toString("base64url");
            const nowIso = new Date().toISOString();
            // Condicional (consumed_at IS NULL): si dos navegadores lo abren a la vez, solo uno gana
            const { data: claimed, error: claimError } = await supabase
                .from("aitickets_event_preview_links")
                .update({ consumed_at: nowIso, consumed_nonce_hash: sha256Hex(nonce), view_count: (link.view_count || 0) + 1, last_viewed_at: nowIso })
                .eq("id", link.id)
                .is("consumed_at", null)
                .select("id");
            if (claimError) {
                console.error("preview link consume:", claimError.message);
                return { ok: false, reason: "not_found" };
            }
            if (!claimed?.length) return { ok: false, reason: "used" };
            const maxAge = link.expires_at ? Math.max(60, Math.floor((new Date(link.expires_at).getTime() - Date.now()) / 1000)) : undefined;
            return {
                ok: true,
                link,
                eventId: Number(link.event_id),
                orgId: Number(link.organization_id),
                setCookie: { name: previewCookieName(token), value: nonce, maxAge },
            };
        }
    } else if (bot) {
        return { ok: false, reason: "bot" };
    }

    // Visita (best effort, no bloquea)
    supabase
        .from("aitickets_event_preview_links")
        .update({ view_count: (link.view_count || 0) + 1, last_viewed_at: new Date().toISOString() })
        .eq("id", link.id)
        .then(({ error: e }: any) => e && console.warn("preview link view:", e.message));

    return { ok: true, link, eventId: Number(link.event_id), orgId: Number(link.organization_id) };
}

/** Cookie que guarda el nonce de un link de un solo uso en el navegador que lo consumió. */
export const previewCookieName = (token: string) => `${PREVIEW_COOKIE_PREFIX}${sha256Hex(token).slice(0, 16)}`;
