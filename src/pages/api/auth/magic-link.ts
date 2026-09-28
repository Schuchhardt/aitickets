// POST /api/auth/magic-link — envía un enlace de acceso directo (60 min, uso único) a /auth/link.
//
// { email, purpose: 'recovery', cfToken? }  (sin sesión, "¿Olvidaste tu contraseña?")
//   - Turnstile obligatorio en producción (si falta TURNSTILE_SECRET_KEY en PROD, se rechaza); en
//     desarrollo solo si está configurado.
//   - Límite en memoria por IP y por correo + límite DURABLE por cuenta (aitickets_auth_link_sends:
//     60 s entre envíos y máx. 3 por hora). SIEMPRE responde el mismo mensaje genérico (no revela si la
//     cuenta existe), y la búsqueda de la cuenta y el envío corren FUERA del camino de la respuesta
//     (waitUntil de Netlify) con un tiempo mínimo de respuesta, para no revelarla por el tiempo. Solo se envía si hay una fila en public.users con ese correo, activa, y la identidad de
//     Auth es de AI Tickets (app_metadata.app === 'aitickets' o con fila en users: contrato R5).
// { purpose: 'change-password' }  (con sesión, botón "Cambiar contraseña" de Mi Perfil)
//   - El enlace va al correo de la sesión; al abrirlo se muestra el modal para fijar la nueva
//     contraseña sin pedir la actual.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, jsonResponse } from "../../../lib/supabaseServer";
import { verifyTurnstileToken } from "../../../lib/turnstile";
import { getUsersRow, isAiticketsIdentity, reserveAuthLinkSend, sendMagicLinkEmail } from "../../../lib/magic-link";

export const prerender = false;

const GENERIC = {
    ok: true,
    message: "Si el correo corresponde a una cuenta de AI Tickets, te enviamos un enlace para ingresar. Revisa tu bandeja de entrada (y spam). El enlace dura 60 minutos.",
};
const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]{2,}$/;

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = 10;
const MAX_PER_EMAIL = 3;
const MAX_PER_USER = 5;
const MAX_KEYS = 5000;
const MIN_RECOVERY_RESPONSE_MS = 700;
const hits = new Map<string, number[]>();

function limited(key: string, max: number, now: number): boolean {
    const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
    // delete + set: la clave pasa al final (orden de inserción = uso más reciente)
    hits.delete(key);
    if (recent.length >= max) {
        hits.set(key, recent);
        return true;
    }
    recent.push(now);
    hits.set(key, recent);
    // Expulsa solo las claves usadas hace más tiempo (nunca se reinician todos los contadores)
    while (hits.size > MAX_KEYS) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
    }
    return false;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Busca la cuenta y envía el enlace de recuperación. Nunca lanza. */
async function processRecovery(email: string): Promise<void> {
    try {
        const supabase = getSupabaseAdmin();
        const { data: profiles } = await supabase
            .from("users")
            .select("auth_user_id, name, active")
            .eq("email", email)
            .not("auth_user_id", "is", null)
            .limit(2);
        const profile = profiles?.length === 1 ? profiles[0] : null;
        if (!profile?.auth_user_id || profile.active === false) return;

        const { data: authData } = await supabase.auth.admin.getUserById(profile.auth_user_id);
        const authUser = authData?.user;
        // El enlace solo va al correo de la cuenta de Auth (el de public.users debe coincidir)
        if (!authUser?.email || authUser.email.toLowerCase() !== email) return;
        const usersRow = await getUsersRow(authUser.id);
        if (!isAiticketsIdentity(authUser, !!usersRow)) return;
        if (!(await reserveAuthLinkSend(authUser.id, "recovery"))) return;

        await sendMagicLinkEmail({ uid: authUser.id, email: authUser.email, name: profile.name, purpose: "recovery" });
    } catch (err: any) {
        console.error("magic-link (recovery):", err?.message || err);
    }
}

function clientIp(request: Request): string {
    return (
        request.headers.get("x-nf-client-connection-ip") ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("cf-connecting-ip") ||
        "unknown"
    );
}

const serverEnv = (name: string) => {
    const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
    return fromProcess ?? (import.meta.env as Record<string, string | undefined>)[name];
};

const TOO_MANY = () => jsonResponse({ message: "Demasiados intentos. Espera unos minutos antes de volver a intentarlo." }, 429);

export const POST: APIRoute = async (context) => {
    const { request } = context;
    let body: any;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ message: "Solicitud inválida" }, 400);
    }
    const purpose = body?.purpose;
    const now = Date.now();
    const ip = clientIp(request);

    // ----- Cambiar contraseña (con sesión) -----
    if (purpose === "change-password") {
        const session = await getSessionContext(context);
        const authUser = session?.authUser;
        if (!session || !authUser?.email) return jsonResponse({ message: "Tu sesión expiró. Vuelve a iniciar sesión." }, 401);
        if (!isAiticketsIdentity(authUser, true)) return jsonResponse({ message: "No se puede cambiar la contraseña de esta cuenta." }, 403);
        if (limited(`ip:${ip}`, MAX_PER_IP, now) || limited(`uid:${authUser.id}`, MAX_PER_USER, now)) return TOO_MANY();
        if (!(await reserveAuthLinkSend(authUser.id, "change-password"))) return TOO_MANY();
        try {
            await sendMagicLinkEmail({ uid: authUser.id, email: authUser.email, name: session.dbUser.name, purpose: "change-password" });
        } catch (err: any) {
            console.error("magic-link (change-password):", err?.message || err);
            return jsonResponse({ message: "No pudimos enviar el correo. Intenta de nuevo en unos minutos." }, 502);
        }
        return jsonResponse({
            ok: true,
            message: `Te enviamos un enlace a ${authUser.email}. Ábrelo en los próximos 60 minutos para crear tu nueva contraseña.`,
        }, 200);
    }

    // ----- Recuperar contraseña (sin sesión) -----
    if (purpose !== "recovery") return jsonResponse({ message: "Solicitud inválida" }, 400);

    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
        return jsonResponse({ message: "Ingresa un correo válido." }, 400);
    }

    const turnstileSecret = serverEnv("TURNSTILE_SECRET_KEY");
    if (!turnstileSecret && import.meta.env.PROD) {
        // Sin CAPTCHA en producción el endpoint quedaría abierto a envíos masivos: se falla cerrado.
        console.error("magic-link: TURNSTILE_SECRET_KEY no configurada en producción; recuperación deshabilitada");
        return jsonResponse({ message: "No pudimos procesar la solicitud. Intenta de nuevo más tarde." }, 503);
    }
    if (turnstileSecret) {
        const { success, message } = await verifyTurnstileToken({
            token: typeof body?.cfToken === "string" ? body.cfToken : "",
            remoteip: ip === "unknown" ? undefined : ip,
            idempotencyKey: crypto.randomUUID(),
        });
        if (!success) return jsonResponse({ message: message || "No pudimos validar el CAPTCHA. Intenta de nuevo." }, 400);
    }

    if (limited(`ip:${ip}`, MAX_PER_IP, now) || limited(`email:${email}`, MAX_PER_EMAIL, now)) return TOO_MANY();

    // La búsqueda y el envío no bloquean la respuesta: exista o no la cuenta, se responde igual y en
    // (aprox.) el mismo tiempo. En Netlify, waitUntil mantiene viva la función hasta terminar el envío;
    // sin él (dev / otros adaptadores) se espera el trabajo y se rellena hasta el tiempo mínimo.
    const work = processRecovery(email);
    const waitUntil = (context.locals as any)?.netlify?.context?.waitUntil;
    if (typeof waitUntil === "function") {
        try {
            waitUntil.call((context.locals as any).netlify.context, work);
        } catch {
            await work;
        }
    } else {
        await work;
    }
    const elapsed = Date.now() - now;
    if (elapsed < MIN_RECOVERY_RESPONSE_MS) await sleep(MIN_RECOVERY_RESPONSE_MS - elapsed);
    return jsonResponse(GENERIC, 200);
};
