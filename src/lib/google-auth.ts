// "Continuar con Google" para productores (registro e inicio de sesión). Solo servidor.
//
// Flujo OAuth de Supabase Auth con PKCE, sin cliente de Supabase en el navegador:
//   1. GET /api/auth/google  → arma la URL de autorización de Supabase (provider google) con un cliente efímero
//      cuyo storage es un Map; el code verifier se guarda en la cookie httpOnly `aitk_google` (10 min) junto con
//      el destino (next) y la atribución del registro.
//   2. Google → Supabase → GET /auth/google/callback?code=… → exchangeCodeForSession con el verifier de la cookie.
//      Un código ajeno no sirve sin el verifier de ESTE navegador (evita login CSRF).
//   3. Usuario existente: sesión. Nuevo: organización con nombre provisorio (onboarding_pending), perfil, correo
//      verificado (Google ya lo verificó) y a /organizadores/bienvenida.
//
// Requiere: proveedor Google activo en Supabase Auth, `<SITE_URL>/auth/google/callback` en "Redirect URLs" y
// GOOGLE_AUTH_ENABLED="true" (sin eso el botón no se muestra).
import { createClient, type Session, type User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./auth-helpers";
import { TERMS_VERSION } from "./legal";
import { ONBOARDING_PLACEHOLDER_NAME } from "./onboarding";

export const GOOGLE_STATE_COOKIE = "aitk_google";
export const GOOGLE_CALLBACK_PATH = "/auth/google/callback";
const STORAGE_KEY = "aitk-google";

function readEnv(name: string): string {
    const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
    const value = fromProcess ?? (import.meta.env as Record<string, string | undefined>)[name];
    return value ? String(value).trim() : "";
}

export const isGoogleAuthEnabled = () => readEnv("GOOGLE_AUTH_ENABLED") === "true";

function pkceClient(store: Map<string, string>) {
    const url = readEnv("SUPABASE_URL");
    const key = readEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Missing Supabase credentials (URL or Service Role Key)");
    return createClient(url, key, {
        auth: {
            flowType: "pkce",
            storageKey: STORAGE_KEY,
            storage: {
                getItem: (k: string) => store.get(k) ?? null,
                setItem: (k: string, v: string) => void store.set(k, v),
                removeItem: (k: string) => void store.delete(k),
            },
            persistSession: true,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        },
    });
}

export type GoogleState = {
    /** Valor guardado por supabase-js para el code verifier (formato interno, se devuelve tal cual). */
    v: string;
    next: string | null;
    attribution: Record<string, string>;
    lead: string | null;
};

/** URL de autorización de Google (vía Supabase) y el estado a guardar en la cookie. */
export async function startGoogleAuth(origin: string, state: Omit<GoogleState, "v">): Promise<{ url: string; state: GoogleState }> {
    const store = new Map<string, string>();
    const { data, error } = await pkceClient(store).auth.signInWithOAuth({
        provider: "google",
        options: {
            redirectTo: `${origin.replace(/\/+$/, "")}${GOOGLE_CALLBACK_PATH}`,
            skipBrowserRedirect: true,
            queryParams: { prompt: "select_account" },
        },
    });
    const verifier = store.get(`${STORAGE_KEY}-code-verifier`);
    if (error || !data?.url || !verifier) throw new Error(error?.message || "No se pudo iniciar el acceso con Google");
    return { url: data.url, state: { ...state, v: verifier } };
}

/** Canjea el código por una sesión de Supabase usando el verifier de la cookie. */
export async function finishGoogleAuth(code: string, verifierItem: string): Promise<{ session: Session; user: User }> {
    const store = new Map<string, string>([[`${STORAGE_KEY}-code-verifier`, verifierItem]]);
    const { data, error } = await pkceClient(store).auth.exchangeCodeForSession(code);
    if (error || !data?.session || !data.user) throw new Error(error?.message || "No se pudo completar el acceso con Google");
    return { session: data.session, user: data.user };
}

export const encodeGoogleState = (s: GoogleState) => Buffer.from(JSON.stringify(s), "utf8").toString("base64url");
export function decodeGoogleState(raw: string | undefined | null): GoogleState | null {
    if (!raw || raw.length > 6000) return null;
    try {
        const s = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
        if (!s || typeof s.v !== "string" || !s.v) return null;
        return {
            v: s.v,
            next: typeof s.next === "string" ? s.next : null,
            attribution: s.attribution && typeof s.attribution === "object" ? s.attribution : {},
            lead: typeof s.lead === "string" ? s.lead : null,
        };
    } catch {
        return null;
    }
}

const clip = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export type GoogleAccountResult =
    | { ok: true; created: boolean; orgId: number; onboardingPending: boolean }
    | { ok: false; error: "no_email" | "email_in_use" | "inactive" | "server" };

/**
 * Busca o crea la cuenta de productor de un usuario que entró con Google.
 * - Perfil existente (por auth_user_id): se usa; si su organización no estaba verificada, se verifica (Google
 *   probó el correo).
 * - Correo ya usado por OTRO perfil de AI Tickets: no se fusiona (email_in_use).
 * - Nuevo: organización (nombre provisorio, onboarding_pending, términos aceptados al continuar) + perfil.
 */
export async function ensureGoogleProducer(
    user: User,
    { attribution = {}, leadId = null }: { attribution?: Record<string, string>; leadId?: string | null } = {},
): Promise<GoogleAccountResult> {
    const supabase = getSupabaseAdmin();
    const email = String(user.email || "").trim().toLowerCase();
    if (!email || !user.email_confirmed_at) return { ok: false, error: "no_email" };

    const { data: profile } = await supabase
        .from("users")
        .select("id, organization_id, active")
        .eq("auth_user_id", user.id)
        .maybeSingle();

    if (profile?.organization_id) {
        if (profile.active === false) return { ok: false, error: "inactive" };
        const orgId = Number(profile.organization_id);
        const { data: org } = await supabase.from("organizations").select("email_verified_at, onboarding_pending").eq("id", orgId).maybeSingle();
        if (org && !org.email_verified_at) {
            await supabase.from("organizations").update({ email_verified_at: new Date().toISOString(), email_verified_for: email }).eq("id", orgId).is("email_verified_at", null);
        }
        return { ok: true, created: false, orgId, onboardingPending: Boolean((org as any)?.onboarding_pending) };
    }

    const { data: sameEmail } = await supabase.from("users").select("id, auth_user_id, organization_id, role, active").ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`)).maybeSingle();
    // Perfil antiguo sin auth_user_id (anterior a la columna / nunca ligado): Google probó que el correo es de
    // esta persona => se liga a esta identidad. role NULL (cuentas antiguas) => 'admin', el default de la columna.
    if (sameEmail && !sameEmail.auth_user_id) {
        const { data: linked, error: linkError } = await supabase
            .from("users")
            .update({ auth_user_id: user.id, ...(sameEmail.role ? {} : { role: "admin" }) })
            .eq("id", sameEmail.id)
            .is("auth_user_id", null)
            .select("id");
        if (linkError || !linked?.length) {
            console.error("google-auth: no se pudo ligar el perfil antiguo", linkError?.message);
            return { ok: false, error: "server" };
        }
        sameEmail.auth_user_id = user.id;
        if (sameEmail.organization_id) {
            if (sameEmail.active === false) return { ok: false, error: "inactive" };
            const orgId = Number(sameEmail.organization_id);
            const { data: org } = await supabase.from("organizations").select("email_verified_at, onboarding_pending").eq("id", orgId).maybeSingle();
            if (org && !org.email_verified_at) {
                await supabase.from("organizations").update({ email_verified_at: new Date().toISOString(), email_verified_for: email }).eq("id", orgId).is("email_verified_at", null);
            }
            return { ok: true, created: false, orgId, onboardingPending: Boolean((org as any)?.onboarding_pending) };
        }
    }
    if (sameEmail && sameEmail.auth_user_id !== user.id) return { ok: false, error: "email_in_use" };

    const meta = (user.user_metadata || {}) as Record<string, any>;
    const name = clip(meta.full_name || meta.name, 120);
    const now = new Date().toISOString();
    const base: Record<string, unknown> = {
        public_name: ONBOARDING_PLACEHOLDER_NAME,
        email,
        signup_utm_source: clip(attribution.utm_source),
        signup_utm_medium: clip(attribution.utm_medium),
        signup_utm_campaign: clip(attribution.utm_campaign),
        signup_ref: leadId ? `lead_${leadId}`.slice(0, 200) : clip(attribution.ref),
        signup_referrer: clip(attribution.referrer, 500),
        terms_version: TERMS_VERSION,
        terms_accepted_at: now,
        email_verified_at: now,
        email_verified_for: email,
        onboarding_pending: true,
    };
    // Previews sin migrar: quitar columnas desconocidas y reintentar
    let insert = { ...base };
    let orgId: number | null = null;
    for (let attempt = 0; attempt < 6 && orgId === null; attempt++) {
        const { data, error } = await supabase.from("organizations").insert(insert).select("id").single();
        if (!error && data) {
            orgId = Number(data.id);
            break;
        }
        const missing = /column "?([a-z_]+)"?|'([a-z_]+)' column/i.exec(error?.message || "");
        const col = missing?.[1] || missing?.[2];
        if (!col || !(col in insert) || col === "public_name" || col === "email") {
            console.error("google-auth: no se pudo crear la organización", error?.message);
            return { ok: false, error: "server" };
        }
        delete (insert as any)[col];
    }
    if (orgId === null) return { ok: false, error: "server" };

    const profileRow = { auth_user_id: user.id, organization_id: orgId, name, email, role: "producer", active: true };
    const { error: userError } = sameEmail
        ? await supabase.from("users").update({ organization_id: orgId, ...(name ? { name } : {}) }).eq("id", sameEmail.id)
        : await supabase.from("users").insert(profileRow);
    if (userError) {
        console.error("google-auth: no se pudo crear el perfil", userError.message);
        await supabase.from("organizations").delete().eq("id", orgId);
        return { ok: false, error: "server" };
    }

    // Marca de cuenta de AI Tickets solo si la identidad es nueva (no tomar cuentas de otras apps del proyecto)
    const appMeta = (user.app_metadata || {}) as Record<string, unknown>;
    const isNewIdentity = user.created_at && Date.now() - new Date(user.created_at).getTime() < 15 * 60 * 1000;
    if (!appMeta.app && isNewIdentity) {
        await supabase.auth.admin.updateUserById(user.id, { app_metadata: { ...appMeta, app: "aitickets" } }).catch(() => {});
    }

    if (leadId) {
        await supabase
            .from("aitickets_leads")
            .update({ status: "converted", organization_id: orgId, updated_at: now })
            .eq("id", leadId)
            .then(({ error }: any) => error && console.warn("google-auth: lead", error.message));
    }
    return { ok: true, created: true, orgId, onboardingPending: !("onboarding_pending" in insert) ? false : true };
}
