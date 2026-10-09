// GET /auth/google/callback?code= — vuelta de Google (vía Supabase Auth). Ver src/lib/google-auth.ts.
// Cuenta nueva o sin nombre de productora => /organizadores/bienvenida; si no, al destino (next) o al panel.
import type { APIRoute } from "astro";
import { GOOGLE_STATE_COOKIE, decodeGoogleState, ensureGoogleProducer, finishGoogleAuth } from "../../../lib/google-auth";
import { onboardingUrl, safeNextPath } from "../../../lib/onboarding";
import { setSessionCookies } from "../../../lib/supabaseServer";
import { notifySlack } from "../../api/_lib/server-utils";

export const prerender = false;

const ERRORS: Record<string, string> = {
    email_in_use: "google_email_in_use",
    inactive: "google_inactive",
    no_email: "google",
    server: "google",
};

export const GET: APIRoute = async (context) => {
    const { url, cookies, redirect } = context;
    const state = decodeGoogleState(cookies.get(GOOGLE_STATE_COOKIE)?.value);
    cookies.delete(GOOGLE_STATE_COOKIE, { path: "/auth/google" });
    const next = safeNextPath(state?.next);
    const fail = (code: string) =>
        redirect(`/organizadores/${code === "google_email_in_use" ? "login" : "registro"}?error=${code}${next ? `&next=${encodeURIComponent(next)}` : ""}`, 303);

    const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (providerError) console.error("google auth callback (Supabase):", providerError.slice(0, 300));
    const code = url.searchParams.get("code");
    if (!state || !code || code.length > 512) return fail("google");

    let session, user;
    try {
        ({ session, user } = await finishGoogleAuth(code, state.v));
    } catch (err: any) {
        console.error("google auth callback:", err?.message || err);
        return fail("google");
    }

    const account = await ensureGoogleProducer(user, { attribution: state.attribution, leadId: state.lead });
    if (!account.ok) return fail(ERRORS[account.error] || "google");

    setSessionCookies(context, session.access_token, session.refresh_token);

    if (account.created) {
        const a = state.attribution || {};
        const source = [a.utm_source, a.utm_medium, a.utm_campaign].filter(Boolean).join(" / ");
        await notifySlack(
            `🎉 *Nuevo productor registrado (Google)*\n• *Email:* ${user.email}\n• *Nombre:* ${(user.user_metadata as any)?.full_name || "—"}` +
                (source ? `\n• *UTM:* ${source}` : "") +
                (next ? `\n• *Sigue a:* ${next.split("?")[0]}` : ""),
        ).catch(() => {});
    }
    return redirect(account.onboardingPending ? onboardingUrl(next) : next || "/dashboard", 303);
};
