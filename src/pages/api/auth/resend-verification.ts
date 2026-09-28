// POST /api/auth/resend-verification { email } — reenvía el enlace de verificación del productor.
// Siempre responde lo mismo (no revela si el correo existe ni su estado). Límites: por IP y por correo
// en memoria de la instancia, y un enfriamiento de 2 minutos por cuenta guardado en app_metadata
// (solo en cuentas creadas por AI Tickets, contrato R5).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { getOrgVerification, sendVerificationEmail } from "../../../lib/email-verification";

export const prerender = false;

const GENERIC = {
    ok: true,
    message: "Si el correo corresponde a una cuenta pendiente de confirmación, te enviamos un nuevo enlace. Revisa tu bandeja de entrada y spam.",
};
const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]{2,}$/;

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = 10;
const MAX_PER_EMAIL = 3;
const COOLDOWN_MS = 2 * 60 * 1000;
const hits = new Map<string, number[]>();

function limited(key: string, max: number, now: number): boolean {
    const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= max) {
        hits.set(key, recent);
        return true;
    }
    recent.push(now);
    if (hits.size > 5000) hits.clear();
    hits.set(key, recent);
    return false;
}

function clientIp(request: Request): string {
    return (
        request.headers.get("x-nf-client-connection-ip") ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("cf-connecting-ip") ||
        "unknown"
    );
}

export const POST: APIRoute = async ({ request }) => {
    let email = "";
    try {
        const body = await request.json();
        email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    } catch {
        return jsonResponse({ message: "Solicitud inválida" }, 400);
    }
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
        return jsonResponse({ message: "Ingresa un correo válido." }, 400);
    }

    const now = Date.now();
    if (limited(`ip:${clientIp(request)}`, MAX_PER_IP, now) || limited(`email:${email}`, MAX_PER_EMAIL, now)) {
        return jsonResponse({ message: "Demasiados intentos. Espera unos minutos antes de volver a intentarlo." }, 429);
    }

    try {
        const supabase = getSupabaseAdmin();
        const { data: profile } = await supabase
            .from("users")
            .select("auth_user_id, organization_id, name")
            .eq("email", email)
            .maybeSingle();
        if (!profile?.auth_user_id || !profile.organization_id) return jsonResponse(GENERIC, 200);

        const { verified } = await getOrgVerification(Number(profile.organization_id));
        if (verified !== false) return jsonResponse(GENERIC, 200);

        const { data: authData } = await supabase.auth.admin.getUserById(profile.auth_user_id);
        const authUser = authData?.user;
        if (!authUser?.email || authUser.email.toLowerCase() !== email) return jsonResponse(GENERIC, 200);

        const appMeta = (authUser.app_metadata || {}) as Record<string, any>;
        const isAitickets = appMeta.app === "aitickets";
        const lastSent = Date.parse(appMeta.email_verify_sent_at || "");
        if (isAitickets && Number.isFinite(lastSent) && now - lastSent < COOLDOWN_MS) return jsonResponse(GENERIC, 200);

        const { data: org } = await supabase
            .from("organizations")
            .select("public_name")
            .eq("id", profile.organization_id)
            .maybeSingle();
        await sendVerificationEmail({ uid: authUser.id, email: authUser.email, name: profile.name, orgName: org?.public_name || null });
        if (isAitickets) {
            await supabase.auth.admin
                .updateUserById(authUser.id, { app_metadata: { ...appMeta, email_verify_sent_at: new Date(now).toISOString() } })
                .catch(() => {});
        }
    } catch (err: any) {
        console.error("resend-verification:", err?.message || err);
    }
    return jsonResponse(GENERIC, 200);
};
