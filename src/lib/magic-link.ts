// Enlaces de acceso directo de AI Tickets (recuperar / cambiar contraseña). Solo servidor.
//
// El enlace del correo NO es un enlace de Supabase: es un token propio firmado con HMAC-SHA256
//   base64url(JSON {p:'auth_link', pu, uid, eh, exp, jti}).base64url(HMAC)
//   - pu:  propósito ('recovery' | 'change-password' | 'login')
//   - uid: id del usuario de Supabase Auth
//   - eh:  hash corto del correo al que se envió (si el correo cambia, el enlace deja de servir)
//   - exp: vencimiento en segundos (60 min)
//   - jti: id aleatorio; al usarlo se guarda en aitickets_auth_link_tokens (uso único)
// Clave: derivada de EMAIL_VERIFY_SECRET (o INTERNAL_API_SECRET / service role, como email-verification.ts)
// con una etiqueta propia, así un token de verificación nunca sirve como enlace de acceso y viceversa.
//
// /auth/link (GET muestra "Continuar", POST consume el token) crea la sesión SIN contraseña
// (createPasswordlessSession: generateLink magiclink + verifyOtp en un cliente efímero) y deja la cookie
// firmada `aitickets_pw_reset` (30 min, atada al uid) que /api/auth/set-password exige para fijar una
// contraseña nueva sin pedir la actual.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { createEphemeralAuthClient, getSupabaseAdmin } from "./auth-helpers";
import { emailHash, siteOrigin } from "./email-verification";
import { sendEmail } from "../../netlify/lib/mailer.mjs";
import { renderMagicLinkEmail } from "../../netlify/lib/emails/index.mjs";

export const AUTH_LINK_TTL_SECONDS = 60 * 60;
export const PW_RESET_TTL_SECONDS = 30 * 60;
export const PW_RESET_COOKIE = "aitickets_pw_reset";
export const AUTH_LINK_PURPOSES = ["recovery", "change-password", "login"] as const;
export type AuthLinkPurpose = (typeof AUTH_LINK_PURPOSES)[number];

const LINK_TYPE = "auth_link";
const PW_RESET_TYPE = "pw_reset";

export const isAuthLinkPurpose = (v: unknown): v is AuthLinkPurpose =>
    typeof v === "string" && (AUTH_LINK_PURPOSES as readonly string[]).includes(v);

function readEnv(name: string): string {
    const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
    const value = fromProcess ?? (import.meta.env as Record<string, string | undefined>)[name];
    return value ? String(value).trim() : "";
}

/** Clave de firma de los enlaces de acceso (distinta de la de verificación de correo). */
export function authLinkKey(): Buffer {
    const base = readEnv("EMAIL_VERIFY_SECRET") || readEnv("INTERNAL_API_SECRET") || readEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!base) throw new Error("EMAIL_VERIFY_SECRET no configurado");
    return createHmac("sha256", "aitickets-auth-link").update(base).digest();
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

function sign(payloadObj: Record<string, unknown>, key: Buffer): string {
    const payload = b64url(JSON.stringify(payloadObj));
    const sig = b64url(createHmac("sha256", key).update(payload).digest());
    return `${payload}.${sig}`;
}

/** Valida la firma en tiempo constante y devuelve el JSON, o null. */
function unsign(token: unknown, key: Buffer): Record<string, any> | null {
    if (typeof token !== "string" || !token || token.length > 2048) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [payload, sig] = parts;
    const expected = createHmac("sha256", key).update(payload).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return data && typeof data === "object" ? data : null;
    } catch {
        return null;
    }
}

export const newJti = () => randomBytes(16).toString("base64url");

export type SignAuthLinkInput = {
    uid: string;
    email: string;
    purpose: AuthLinkPurpose;
    now?: number;
    ttlSeconds?: number;
    jti?: string;
    key?: Buffer;
};

/** Firma un enlace de acceso para `uid` / su correo actual. */
export function signAuthLinkToken({ uid, email, purpose, now = Date.now(), ttlSeconds = AUTH_LINK_TTL_SECONDS, jti = newJti(), key }: SignAuthLinkInput): string {
    if (!uid) throw new Error("uid requerido");
    if (!isAuthLinkPurpose(purpose)) throw new Error("propósito inválido");
    return sign(
        { p: LINK_TYPE, pu: purpose, uid, eh: emailHash(email), exp: Math.floor(now / 1000) + ttlSeconds, jti },
        key || authLinkKey(),
    );
}

export type AuthLinkClaims = { uid: string; eh: string; purpose: AuthLinkPurpose; exp: number; jti: string };
export type VerifyAuthLinkResult = ({ ok: true } & AuthLinkClaims) | { ok: false; error: "invalid" | "expired" };

/** Valida firma, tipo, propósito (si se indica) y vencimiento. Sin efectos. */
export function verifyAuthLinkToken(
    token: unknown,
    { now = Date.now(), purpose, key }: { now?: number; purpose?: AuthLinkPurpose; key?: Buffer } = {},
): VerifyAuthLinkResult {
    try {
        const data = unsign(token, key || authLinkKey());
        if (!data || data.p !== LINK_TYPE) return { ok: false, error: "invalid" };
        if (!isAuthLinkPurpose(data.pu) || (purpose && data.pu !== purpose)) return { ok: false, error: "invalid" };
        if (typeof data.uid !== "string" || !data.uid || typeof data.eh !== "string" || typeof data.jti !== "string" || !data.jti) {
            return { ok: false, error: "invalid" };
        }
        if (!Number.isFinite(data.exp) || data.exp * 1000 < now) return { ok: false, error: "expired" };
        return { ok: true, uid: data.uid, eh: data.eh, purpose: data.pu, exp: data.exp, jti: data.jti };
    } catch {
        return { ok: false, error: "invalid" };
    }
}

// ---------------------------------------------------------------------------
// Uso único
// ---------------------------------------------------------------------------

/** 'ok' = primera vez; 'used' = el jti ya estaba; 'unavailable' = no se pudo registrar (error). */
export type MarkUsedResult = "ok" | "used" | "unavailable";
export interface JtiStore {
    markUsed(entry: { jti: string; uid: string; purpose: AuthLinkPurpose; expiresAt: Date }): Promise<MarkUsedResult>;
}

export type ConsumeAuthLinkResult = ({ ok: true } & AuthLinkClaims) | { ok: false; error: "invalid" | "expired" | "used" | "server" };

/** Verifica el token y lo marca como usado. Un token solo se puede consumir una vez. */
export async function consumeAuthLinkToken(
    token: unknown,
    store: JtiStore,
    opts: { now?: number; purpose?: AuthLinkPurpose; key?: Buffer } = {},
): Promise<ConsumeAuthLinkResult> {
    const parsed = verifyAuthLinkToken(token, opts);
    if (!parsed.ok) return parsed;
    const marked = await store.markUsed({ jti: parsed.jti, uid: parsed.uid, purpose: parsed.purpose, expiresAt: new Date(parsed.exp * 1000) });
    if (marked === "used") return { ok: false, error: "used" };
    if (marked === "unavailable") return { ok: false, error: "server" };
    return parsed;
}

const isMissingTable = (error: any) =>
    !!error &&
    (error.code === "42P01" ||
        error.code === "PGRST205" ||
        (/aitickets_auth_link_tokens/.test(error.message || "") && /does not exist|schema cache/i.test(error.message || "")));

/** Store en public.aitickets_auth_link_tokens (PK jti: un segundo insert choca con 23505). */
export function dbJtiStore(): JtiStore {
    return {
        async markUsed({ jti, uid, purpose, expiresAt }) {
            const supabase = getSupabaseAdmin();
            const { error } = await supabase
                .from("aitickets_auth_link_tokens")
                .insert({ jti, auth_user_id: uid, purpose, expires_at: expiresAt.toISOString() });
            if (!error) {
                // Limpieza oportunista de filas vencidas hace más de un día (best effort)
                if (Math.random() < 0.05) {
                    void supabase
                        .from("aitickets_auth_link_tokens")
                        .delete()
                        .lt("expires_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
                        .then(() => {}, () => {});
                }
                return "ok";
            }
            if (error.code === "23505") return "used";
            if (isMissingTable(error)) {
                // Deploy preview sin la migración 202609280100 (previews no migran): el enlace sigue siendo
                // de 60 min y solo llega al dueño del correo; en producción la tabla siempre existe.
                console.warn("magic-link: falta aitickets_auth_link_tokens; no se puede asegurar el uso único");
                return "ok";
            }
            console.error("magic-link: no se pudo registrar el uso del enlace", error.message);
            return "unavailable";
        },
    };
}

// ---------------------------------------------------------------------------
// Cookie de "fijar contraseña" (30 min, atada al uid)
// ---------------------------------------------------------------------------

export function signPwResetCookie(uid: string, { now = Date.now(), key }: { now?: number; key?: Buffer } = {}): string {
    if (!uid) throw new Error("uid requerido");
    return sign({ p: PW_RESET_TYPE, uid, exp: Math.floor(now / 1000) + PW_RESET_TTL_SECONDS, n: newJti() }, key || authLinkKey());
}

/** ¿La cookie es válida, vigente y del usuario `uid`? */
export function verifyPwResetCookie(value: unknown, uid: string, { now = Date.now(), key }: { now?: number; key?: Buffer } = {}): boolean {
    try {
        const data = unsign(value, key || authLinkKey());
        if (!data || data.p !== PW_RESET_TYPE || typeof data.uid !== "string" || !uid || data.uid !== uid) return false;
        return Number.isFinite(data.exp) && data.exp * 1000 >= now;
    } catch {
        return false;
    }
}

export const PW_RESET_COOKIE_OPTIONS = {
    path: "/",
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: "strict" as const,
    maxAge: PW_RESET_TTL_SECONDS,
};

// ---------------------------------------------------------------------------
// Sesión sin contraseña, identidad de AI Tickets y correo
// ---------------------------------------------------------------------------

/**
 * Crea una sesión de Supabase para `email` sin contraseña: la service role genera un magic link
 * (no se envía ningún correo) y su hashed_token se canjea en un cliente EFÍMERO (verifyOtp guarda la
 * sesión en memoria del cliente: nunca con el singleton getSupabaseAdmin()).
 */
export async function createPasswordlessSession(email: string): Promise<{ accessToken: string; refreshToken: string } | null> {
    try {
        const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({ type: "magiclink", email });
        const tokenHash = data?.properties?.hashed_token;
        if (error || !tokenHash) {
            console.error("magic-link: generateLink falló", error?.message);
            return null;
        }
        const client = createEphemeralAuthClient();
        let { data: otp, error: otpError } = await client.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
        if (otpError || !otp?.session) {
            // Versiones nuevas de GoTrue prefieren type 'email' para token_hash
            ({ data: otp, error: otpError } = await client.auth.verifyOtp({ type: "email", token_hash: tokenHash }));
        }
        if (otpError || !otp?.session) {
            console.error("magic-link: verifyOtp falló", otpError?.message);
            return null;
        }
        return { accessToken: otp.session.access_token, refreshToken: otp.session.refresh_token };
    } catch (err: any) {
        console.error("magic-link: error creando la sesión", err?.message || err);
        return null;
    }
}

/**
 * Identidad gestionable por AI Tickets (contrato R5, proyecto compartido): creada por AI Tickets
 * (app_metadata.app === 'aitickets') o con fila en public.users.
 */
export function isAiticketsIdentity(authUser: Pick<User, "app_metadata"> | null | undefined, hasUsersRow: boolean): boolean {
    if (!authUser) return false;
    return (authUser.app_metadata as Record<string, unknown> | undefined)?.app === "aitickets" || hasUsersRow;
}

/** Perfil de public.users del usuario de Auth (o null). */
export async function getUsersRow(authUserId: string) {
    const { data } = await getSupabaseAdmin()
        .from("users")
        .select("id, name, email, organization_id, role, active")
        .eq("auth_user_id", authUserId)
        .maybeSingle();
    return data || null;
}

// ---------------------------------------------------------------------------
// Límite durable de envíos por cuenta (public.aitickets_auth_link_sends)
// ---------------------------------------------------------------------------

export const SEND_COOLDOWN_MS = 60 * 1000;
export const SEND_WINDOW_MS = 60 * 60 * 1000;
export const MAX_SENDS_PER_WINDOW = 3;

export type SendRow = { id: number; sent_at: string };

/**
 * Decide si el intento `ownId` puede enviarse, mirando las filas de la cuenta en la última hora.
 * Orden determinista por id: el intento más antiguo gana si hay varios simultáneos.
 * Se permite si no hay un envío anterior en los últimos 60 s y hay menos de 3 anteriores en la hora.
 */
export function sendAllowed(rows: SendRow[], ownId: number, { now = Date.now(), cooldownMs = SEND_COOLDOWN_MS, windowMs = SEND_WINDOW_MS, max = MAX_SENDS_PER_WINDOW } = {}): boolean {
    const own = rows.find((r) => r.id === ownId);
    const ownAt = own ? Date.parse(own.sent_at) : now;
    const earlier = rows.filter((r) => r.id < ownId && now - Date.parse(r.sent_at) < windowMs);
    if (earlier.length >= max) return false;
    return !earlier.some((r) => ownAt - Date.parse(r.sent_at) < cooldownMs);
}

/**
 * Reserva un envío para `uid` (inserta la fila y luego decide). Si no corresponde enviar, borra su fila
 * para que los intentos rechazados no cuenten. Sin la tabla (deploy preview sin migrar) permite el envío.
 */
export async function reserveAuthLinkSend(uid: string, purpose: AuthLinkPurpose): Promise<boolean> {
    const supabase = getSupabaseAdmin();
    const { data: inserted, error } = await supabase
        .from("aitickets_auth_link_sends")
        .insert({ auth_user_id: uid, purpose })
        .select("id")
        .single();
    if (error || !inserted) {
        if (error && (error.code === "42P01" || error.code === "PGRST205" || /aitickets_auth_link_sends/.test(error.message || ""))) {
            console.warn("magic-link: falta aitickets_auth_link_sends; se usa solo el límite en memoria");
            return true;
        }
        console.error("magic-link: no se pudo registrar el envío", error?.message);
        return false;
    }
    const ownId = Number(inserted.id);
    const since = new Date(Date.now() - SEND_WINDOW_MS).toISOString();
    const { data: rows, error: selError } = await supabase
        .from("aitickets_auth_link_sends")
        .select("id, sent_at")
        .eq("auth_user_id", uid)
        .gte("sent_at", since)
        .order("id", { ascending: true })
        .limit(50);
    const allowed = !selError && sendAllowed((rows || []) as SendRow[], ownId);
    if (!allowed) {
        await supabase.from("aitickets_auth_link_sends").delete().eq("id", ownId).then(() => {}, () => {});
    } else if (Math.random() < 0.05) {
        void supabase
            .from("aitickets_auth_link_sends")
            .delete()
            .lt("sent_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
            .then(() => {}, () => {});
    }
    return allowed;
}

export function buildAuthLinkUrl(token: string): string {
    return `${siteOrigin()}/auth/link?${new URLSearchParams({ t: token }).toString()}`;
}

/** Envía el correo con el enlace de acceso directo. Lanza si Resend falla. */
export async function sendMagicLinkEmail({ uid, email, name, purpose }: { uid: string; email: string; name?: string | null; purpose: AuthLinkPurpose }) {
    const url = buildAuthLinkUrl(signAuthLinkToken({ uid, email, purpose }));
    const { subject, html, text } = await renderMagicLinkEmail({ name: name || "", url, purpose });
    return sendEmail({ to: email, subject, html, text, tags: ["auth-link", purpose] });
}

/**
 * POST de formulario del mismo sitio (defensa contra login CSRF en /auth/link y /organizadores/verificar):
 * si viene Origin debe coincidir con el host de la página; si no, Sec-Fetch-Site no puede ser cross-site.
 */
export function isSameSitePost(request: Request, pageUrl: URL): boolean {
    const origin = request.headers.get("origin");
    if (origin) {
        if (origin === "null") return false;
        try {
            return new URL(origin).host.toLowerCase() === pageUrl.host.toLowerCase();
        } catch {
            return false;
        }
    }
    const fetchSite = request.headers.get("sec-fetch-site");
    return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}
