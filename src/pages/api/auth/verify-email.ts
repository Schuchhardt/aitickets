// /api/auth/verify-email?t=<token> — enlace antiguo de verificación del correo del productor.
//
// GET NO confirma nada (los escáneres de enlaces de correo hacen GET): redirige a
// /organizadores/verificar?t=, que muestra el botón de confirmación (POST).
// POST (JSON {t} o formulario t) confirma y responde JSON; lo usa quien necesite la confirmación por API.
import type { APIRoute } from "astro";
import { confirmProducerEmail } from "../../../lib/email-verification";
import { jsonResponse } from "../../../lib/supabaseServer";

export const prerender = false;

export const GET: APIRoute = async ({ url, redirect }) => {
    const token = url.searchParams.get("t") || "";
    const target = token ? `/organizadores/verificar?${new URLSearchParams({ t: token }).toString()}` : "/organizadores/verificar";
    return redirect(target, 303);
};

export const POST: APIRoute = async ({ request }) => {
    let token = "";
    try {
        const type = request.headers.get("content-type") || "";
        if (type.includes("application/json")) {
            const body = await request.json();
            token = typeof body?.t === "string" ? body.t : "";
        } else {
            const form = await request.formData();
            token = String(form.get("t") || "");
        }
    } catch {
        token = "";
    }
    const result = await confirmProducerEmail(token);
    if (result.ok) return jsonResponse({ ok: true, alreadyVerified: result.alreadyVerified, slug: result.slug }, 200);
    const status = result.error === "server" ? 500 : result.error === "not_found" ? 404 : 400;
    return jsonResponse({ ok: false, error: result.error }, status);
};
