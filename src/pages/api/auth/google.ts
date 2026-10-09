// GET /api/auth/google?next=&utm_*=&ref=&lead= — inicia "Continuar con Google" (registro o inicio de sesión).
// Ver src/lib/google-auth.ts. Al continuar con Google se aceptan los Términos (lo dice junto al botón).
import type { APIRoute } from "astro";
import { GOOGLE_STATE_COOKIE, encodeGoogleState, isGoogleAuthEnabled, startGoogleAuth } from "../../../lib/google-auth";
import { safeNextPath } from "../../../lib/onboarding";
import { verifyLeadToken } from "../../../lib/lead-token";
import { siteUrl } from "../_lib/server-utils";

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
    const next = safeNextPath(url.searchParams.get("next"));
    const back = `/organizadores/registro?error=google${next ? `&next=${encodeURIComponent(next)}` : ""}`;
    if (!isGoogleAuthEnabled()) return redirect(back, 303);

    const attribution: Record<string, string> = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "ref", "referrer"]) {
        const v = url.searchParams.get(key);
        if (v) attribution[key] = v.slice(0, key === "referrer" ? 500 : 200);
    }
    const leadToken = url.searchParams.get("lead");
    const lead = leadToken && leadToken.length <= 2048 ? verifyLeadToken(leadToken) : null;

    try {
        const { url: authUrl, state } = await startGoogleAuth(siteUrl() || url.origin, { next, attribution, lead: lead ? String(lead.leadId) : null });
        cookies.set(GOOGLE_STATE_COOKIE, encodeGoogleState(state), {
            path: "/auth/google",
            httpOnly: true,
            secure: import.meta.env.PROD,
            sameSite: "lax",
            maxAge: 600,
        });
        return redirect(authUrl, 303);
    } catch (err: any) {
        console.error("google auth start:", err?.message || err);
        return redirect(back, 303);
    }
};
