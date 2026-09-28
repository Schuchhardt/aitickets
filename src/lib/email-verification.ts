// Verificación del correo del productor (WP7). Solo servidor: usa node:crypto y la service role.
//
// Token: base64url(JSON {p:'email_verify', uid, eh, exp}).base64url(HMAC-SHA256)
//   - uid: id del usuario de Supabase Auth
//   - eh:  hash corto del correo al que se envió (si el correo cambia, el enlace deja de servir)
//   - exp: vencimiento en segundos (48 h)
// Clave: EMAIL_VERIFY_SECRET. Si falta, se deriva de INTERNAL_API_SECRET (y como último recurso de la
// service role) con una etiqueta propia, para no dejar a nadie sin poder verificar su cuenta.
//
// La verificación se exige en /api/auth/login leyendo organizations.email_verified_at (no depende de la
// configuración "Confirm email" del proyecto Supabase, que es compartido con otras apps).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "./auth-helpers";
import { ensureOrgSite, invalidateSiteCache } from "./sites";
import { sendEmail } from "../../netlify/lib/mailer.mjs";
import { renderVerifyEmail } from "../../netlify/lib/emails/index.mjs";

export const EMAIL_VERIFY_TTL_SECONDS = 48 * 3600;
const PURPOSE = "email_verify";

function readEnv(name: string): string {
    const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
    const value = fromProcess ?? (import.meta.env as Record<string, string | undefined>)[name];
    return value ? String(value).trim() : "";
}

function signingKey(): Buffer {
    const explicit = readEnv("EMAIL_VERIFY_SECRET");
    if (explicit) return Buffer.from(explicit, "utf8");
    const base = readEnv("INTERNAL_API_SECRET") || readEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!base) throw new Error("EMAIL_VERIFY_SECRET no configurado");
    return createHmac("sha256", "aitickets-email-verify").update(base).digest();
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export function emailHash(email: string): string {
    return createHash("sha256").update(String(email || "").trim().toLowerCase()).digest("base64url").slice(0, 22);
}

export function siteOrigin(): string {
    return (readEnv("SITE_URL") || "https://aitickets.cl").replace(/\/+$/, "");
}

/** Firma un token de verificación para el usuario de Auth `uid` y su correo actual. */
export function signEmailVerifyToken(uid: string, email: string, now = Date.now()): string {
    const payload = b64url(JSON.stringify({
        p: PURPOSE,
        uid,
        eh: emailHash(email),
        exp: Math.floor(now / 1000) + EMAIL_VERIFY_TTL_SECONDS,
    }));
    const sig = b64url(createHmac("sha256", signingKey()).update(payload).digest());
    return `${payload}.${sig}`;
}

export type VerifyTokenResult =
    | { ok: true; uid: string; eh: string }
    | { ok: false; error: "invalid" | "expired" };

/** Valida firma (comparación en tiempo constante), propósito y vencimiento. */
export function verifyEmailVerifyToken(token: string, now = Date.now()): VerifyTokenResult {
    try {
        if (typeof token !== "string" || token.length > 2048) return { ok: false, error: "invalid" };
        const [payload, sig] = token.split(".");
        if (!payload || !sig) return { ok: false, error: "invalid" };
        const expected = createHmac("sha256", signingKey()).update(payload).digest();
        const given = Buffer.from(sig, "base64url");
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, error: "invalid" };
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (data?.p !== PURPOSE || typeof data.uid !== "string" || typeof data.eh !== "string") return { ok: false, error: "invalid" };
        if (!Number.isFinite(data.exp) || data.exp * 1000 < now) return { ok: false, error: "expired" };
        return { ok: true, uid: data.uid, eh: data.eh };
    } catch {
        return { ok: false, error: "invalid" };
    }
}

/**
 * Envía el correo con el enlace de verificación (plantilla React Email de netlify/lib/emails).
 * El botón "Confirmar mi correo" lleva a /organizadores/verificar, que al confirmar deja la sesión
 * iniciada. Lanza si Resend falla.
 */
export async function sendVerificationEmail({ uid, email, name, orgName }: { uid: string; email: string; name?: string | null; orgName?: string | null }) {
    const url = `${siteOrigin()}/organizadores/verificar?t=${encodeURIComponent(signEmailVerifyToken(uid, email))}`;
    const { subject, html, text } = await renderVerifyEmail({ name: name || "", orgName: orgName || "", url });
    return sendEmail({
        to: email,
        subject,
        html,
        text,
        tags: ["email-verification"],
    });
}

const isMissingColumn = (error: any, column: string) =>
    !!error && (error.code === "42703" || new RegExp(column).test(error.message || ""));

/**
 * ¿La organización verificó su correo? null = no se sabe (columna inexistente en una preview sin
 * migrar o error de lectura): quien llama decide (login lo trata como verificada).
 */
export async function getOrgVerification(orgId: number): Promise<{ verified: boolean | null; termsAcceptedAt: string | null }> {
    const { data, error } = await getSupabaseAdmin()
        .from("organizations")
        .select("id, email_verified_at, terms_accepted_at")
        .eq("id", orgId)
        .maybeSingle();
    if (error) {
        if (!isMissingColumn(error, "email_verified_at|terms_accepted_at")) console.error("email-verification: error leyendo organización", error.message);
        return { verified: null, termsAcceptedAt: null };
    }
    if (!data) return { verified: null, termsAcceptedAt: null };
    return { verified: !!data.email_verified_at, termsAcceptedAt: data.terms_accepted_at || null };
}

/**
 * Marca la organización como verificada (si no lo estaba). Devuelve false si la columna no existe.
 * Con `verifiedEmail` también guarda la dirección probada (setOrgVerifiedEmail).
 */
export async function markOrgVerified(orgId: number, verifiedEmail?: string | null): Promise<boolean> {
    const { error } = await getSupabaseAdmin()
        .from("organizations")
        .update({ email_verified_at: new Date().toISOString() })
        .eq("id", orgId)
        .is("email_verified_at", null);
    if (verifiedEmail) await setOrgVerifiedEmail(orgId, verifiedEmail);
    if (error) {
        if (!isMissingColumn(error, "email_verified_at")) console.error("email-verification: no se pudo marcar verificada", error.message);
        return false;
    }
    return true;
}

/**
 * Guarda organizations.email_verified_for: la dirección que la organización PROBÓ controlar (migración
 * 202609270500). organizations.email es editable sin verificación, así que los correos a la productora
 * que puede disparar un tercero (formulario de contacto del sitio, avisos de dominio) van SOLO a esta
 * dirección o al contact_email confirmado. Best effort: si la columna no existe, no hace nada.
 */
export async function setOrgVerifiedEmail(orgId: number, email: string): Promise<void> {
    const value = String(email || "").trim().toLowerCase();
    if (!value) return;
    const { error } = await getSupabaseAdmin().from("organizations").update({ email_verified_for: value }).eq("id", orgId);
    if (error && !isMissingColumn(error, "email_verified_for")) {
        console.error("email-verification: no se pudo guardar el correo verificado", error.message);
    }
}

/** Correo verificado de la organización (email_verified_for) o null si no hay / columna inexistente. */
export async function getOrgVerifiedEmail(orgId: number): Promise<string | null> {
    const { data, error } = await getSupabaseAdmin()
        .from("organizations")
        .select("email_verified_for")
        .eq("id", orgId)
        .maybeSingle();
    if (error) {
        if (!isMissingColumn(error, "email_verified_for")) console.error("email-verification: error leyendo el correo verificado", error.message);
        return null;
    }
    const value = String((data as any)?.email_verified_for || "").trim().toLowerCase();
    return value || null;
}

export type ConfirmResult =
    | { ok: true; alreadyVerified: boolean; slug: string | null; uid: string; email: string }
    | { ok: false; error: "invalid" | "expired" | "not_found" | "server" };

/**
 * Procesa un enlace de verificación: confirma el correo en Supabase Auth, marca
 * organizations.email_verified_at y se asegura de que exista el sitio de la organización.
 */
export async function confirmProducerEmail(token: string): Promise<ConfirmResult> {
    let parsed: VerifyTokenResult;
    try {
        parsed = verifyEmailVerifyToken(token);
    } catch (err: any) {
        console.error("email-verification:", err?.message);
        return { ok: false, error: "server" };
    }
    if (!parsed.ok) return parsed;

    const supabase = getSupabaseAdmin();
    try {
        const { data: authData, error: authError } = await supabase.auth.admin.getUserById(parsed.uid);
        const authUser = authData?.user;
        if (authError || !authUser?.email) return { ok: false, error: "not_found" };
        // El enlace solo vale para el correo al que se envió
        if (emailHash(authUser.email) !== parsed.eh) return { ok: false, error: "invalid" };

        const { data: profile } = await supabase
            .from("users")
            .select("id, organization_id")
            .eq("auth_user_id", parsed.uid)
            .maybeSingle();
        if (!profile?.organization_id) return { ok: false, error: "not_found" };
        const orgId = Number(profile.organization_id);

        // El usuario probó que controla el correo: confirmarlo también en Auth (necesario si el proyecto
        // exige correos confirmados para iniciar sesión).
        if (!authUser.email_confirmed_at) {
            const { error: confirmError } = await supabase.auth.admin.updateUserById(parsed.uid, { email_confirm: true });
            if (confirmError) {
                console.error("email-verification: no se pudo confirmar en Auth", confirmError.message);
                return { ok: false, error: "server" };
            }
        }

        const before = await getOrgVerification(orgId);
        if (before.verified !== true) await markOrgVerified(orgId);
        // El enlace llegó a authUser.email (eh coincide): esa es la dirección probada de la organización
        await setOrgVerifiedEmail(orgId, authUser.email);

        let slug: string | null = null;
        try {
            const { data: org } = await supabase.from("organizations").select("public_name").eq("id", orgId).maybeSingle();
            slug = (await ensureOrgSite(orgId, org?.public_name || "")).slug;
            invalidateSiteCache(slug);
        } catch (err: any) {
            console.warn("email-verification: no se pudo asegurar el sitio", err?.message || err);
        }

        return { ok: true, alreadyVerified: before.verified === true, slug, uid: parsed.uid, email: authUser.email };
    } catch (err: any) {
        console.error("email-verification: error", err?.message || err);
        return { ok: false, error: "server" };
    }
}
