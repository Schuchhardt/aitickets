// POST /api/team/accept-invitation { token, name?, password } — acepta una invitación al equipo
// (/invitacion/<token>), crea o reactiva la cuenta y deja la sesión iniciada. Público (lo protege el token,
// de un solo uso y con vencimiento) con límite de intentos por IP. CSRF: el middleware exige mismo origen.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse, setSessionCookies } from "../../../lib/supabaseServer";
import { createEphemeralAuthClient } from "../_lib/server-utils";
import { loadInvitationByToken } from "../../../lib/team-invitations";
import { acceptTeamInvitation } from "../../../lib/team-accept";
import { clientIp } from "../../../lib/producer-api/http";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";

export const prerender = false;

export const POST: APIRoute = async (context) => {
    const supabase = getSupabaseAdmin();
    const limit = await rateLimit("team:accept", clientIp(context.request), { windowSeconds: 600, max: 15, supabase });
    if (!limit.allowed) return jsonResponse({ message: "Demasiados intentos. Espera unos minutos." }, 429);

    let body: any;
    try {
        body = await context.request.json();
    } catch {
        return jsonResponse({ message: "Solicitud inválida" }, 400);
    }

    try {
        const invitation = await loadInvitationByToken(supabase, body?.token);
        const result = await acceptTeamInvitation(supabase, createEphemeralAuthClient(), invitation, { name: body?.name, password: body?.password });
        if (!result.ok) return jsonResponse({ code: result.code, message: result.message }, result.status);
        setSessionCookies(context, result.session.access_token, result.session.refresh_token);
        return jsonResponse({ ok: true, redirectTo: result.redirectTo }, 200);
    } catch (error: any) {
        console.error("accept-invitation:", error?.message || error);
        return jsonResponse({ message: "No pudimos completar la invitación. Intenta de nuevo." }, 500);
    }
};
