// Registro en dos pasos (migración 202610080200): primero el correo (o Google), después de verificarlo el
// nombre de la productora en /organizadores/bienvenida. Mientras organizations.onboarding_pending = true, el
// panel y la pantalla de autorización OAuth mandan ahí (conservando ?next=).
import { getSupabaseAdmin } from "./auth-helpers";

/** Nombre provisorio de la organización hasta completar el onboarding (public_name es NOT NULL). */
export const ONBOARDING_PLACEHOLDER_NAME = "Mi productora";
export const ONBOARDING_PATH = "/organizadores/bienvenida";

/**
 * Destino interno seguro tras registrarse / iniciar sesión: solo rutas del panel o de autorización OAuth.
 * Nunca otro sitio (evita redirecciones abiertas). null si no es válido.
 */
export function safeNextPath(raw: unknown): string | null {
    if (typeof raw !== "string" || !raw || raw.length > 2000) return null;
    if (!/^\/(dashboard(\/|\?|$)|oauth\/)/.test(raw)) return null;
    if (raw.startsWith("//") || raw.includes("\\") || /[\r\n]/.test(raw)) return null;
    return raw;
}

export const onboardingUrl = (next?: string | null) => {
    const safe = safeNextPath(next);
    return safe ? `${ONBOARDING_PATH}?next=${encodeURIComponent(safe)}` : ONBOARDING_PATH;
};

/** Destino final después del onboarding / la verificación. */
export const afterSignupPath = (next?: string | null) => {
    const safe = safeNextPath(next);
    if (!safe) return "/dashboard?bienvenida=1";
    if (safe.startsWith("/dashboard")) return safe.includes("?") ? `${safe}&bienvenida=1` : `${safe}?bienvenida=1`;
    return safe;
};

const isMissingColumn = (error: any) => !!error && (error.code === "42703" || /onboarding_pending/.test(error.message || ""));

// Organizaciones que ya completaron el onboarding en este proceso (no se revierte): evita repetir la consulta.
const doneCache = new Set<number>();

/** ¿La organización aún no tiene su nombre real? false si la columna no existe (preview sin migrar). */
export async function isOnboardingPending(orgId: number): Promise<boolean> {
    if (doneCache.has(orgId)) return false;
    const { data, error } = await getSupabaseAdmin().from("organizations").select("onboarding_pending").eq("id", orgId).maybeSingle();
    if (error) {
        if (!isMissingColumn(error)) console.error("onboarding: error leyendo organización", error.message);
        return false;
    }
    if (!data?.onboarding_pending) {
        doneCache.add(orgId);
        return false;
    }
    return true;
}

export function markOnboardingDone(orgId: number) {
    doneCache.add(orgId);
}
