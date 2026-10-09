// Guardia de páginas del dashboard (carpeta "_lib" => no es ruta).
// La service role se salta RLS: toda página debe obtener la sesión con esto y
// filtrar TODAS sus consultas por dbUser.organization_id.
import type { AstroGlobal } from "astro";
import { getSessionContext, hasRole, type SessionContext } from "../../../lib/supabaseServer";
import { isOnboardingPending, onboardingUrl } from "../../../lib/onboarding";

export const VALIDATOR_HOME = "/dashboard/events";

type GuardResult =
    | { ok: true; session: SessionContext }
    | { ok: false; response: Response };

/**
 * Exige sesión de productor. Si se pasan `roles`, además exige uno de ellos; un usuario sin el rol
 * es redirigido (validadores → lista de eventos para hacer check-in).
 */
export async function requireDashboardSession(Astro: AstroGlobal, roles?: string[]): Promise<GuardResult> {
    const session = await getSessionContext(Astro);
    if (!session) {
        const here = Astro.url.pathname + Astro.url.search;
        return { ok: false, response: Astro.redirect(`/organizadores/login?next=${encodeURIComponent(here)}`) };
    }
    // Registro en dos pasos: sin nombre de productora todavía => /organizadores/bienvenida (y luego de vuelta aquí)
    if (await isOnboardingPending(Number(session.dbUser.organization_id))) {
        return { ok: false, response: Astro.redirect(onboardingUrl(Astro.url.pathname + Astro.url.search)) };
    }
    (Astro.locals as any).sessionContext = session;
    if (roles && !hasRole(session.dbUser, roles)) {
        return { ok: false, response: Astro.redirect(session.dbUser.role === "validator" ? VALIDATOR_HOME : "/dashboard") };
    }
    return { ok: true, session };
}
