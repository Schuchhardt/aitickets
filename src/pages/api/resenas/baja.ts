// Baja de los recordatorios de reseña de un evento (correos "¿Cómo estuvo?", netlify/lib/review-requests.mjs).
// Queda en notification_log (type 'review_request_optout', email) y el envío la respeta. RFC 8058.
// - POST ?t=<token> (one-click de List-Unsubscribe, body "List-Unsubscribe=One-Click"): da de baja y responde 200.
// - POST desde el botón de /resenas/baja (form con t): da de baja y redirige a /resenas/baja?listo=1.
// - GET ?t=<token>: NO actúa (los escáneres de enlaces hacen GET); redirige a la página de confirmación.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { verifyReviewReminderOptoutToken } from "../../../../netlify/lib/review-token.mjs";
import { REVIEW_REQUEST_OPTOUT_TYPE } from "../../../../netlify/lib/reviews.mjs";

export const prerender = false;

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** Registra la baja (una sola fila por email y evento). false si el token no es válido. */
export async function optOutOfReviewReminders(token: string, supabase = getSupabaseAdmin()): Promise<boolean> {
  const payload = verifyReviewReminderOptoutToken(token);
  if (!payload) return false;
  const { data: existing, error: readError } = await supabase
    .from("notification_log")
    .select("id")
    .eq("event_id", payload.eventId)
    .eq("type", REVIEW_REQUEST_OPTOUT_TYPE)
    .eq("email", payload.email)
    .limit(1);
  if (readError) throw readError;
  if (existing?.length) return true;
  const { error } = await supabase
    .from("notification_log")
    .insert({ event_id: payload.eventId, attendee_id: null, email: payload.email, type: REVIEW_REQUEST_OPTOUT_TYPE, channel: "email", status: "optout" });
  if (error) throw error;
  return true;
}

export const GET: APIRoute = async ({ url, redirect }) => {
  const t = url.searchParams.get("t") || "";
  return redirect(`/resenas/baja${t ? `?t=${encodeURIComponent(t)}` : ""}`, 302);
};

export const POST: APIRoute = async ({ request, url, redirect }) => {
  let token = url.searchParams.get("t") || "";
  let fromPage = false;
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const t = form.get("t");
      if (typeof t === "string" && t) {
        token = t;
        fromPage = form.get("from") === "page";
      }
    } catch {
      /* body one-click "List-Unsubscribe=One-Click" */
    }
  }
  try {
    const ok = token ? await optOutOfReviewReminders(token) : false;
    if (fromPage) return redirect(ok ? "/resenas/baja?listo=1" : "/resenas/baja?error=1", 303);
    return ok ? text("Listo: no recibirás más recordatorios para calificar este evento.") : text("Enlace de baja inválido.", 400);
  } catch (err: any) {
    console.error("[resenas/baja] error:", err?.message);
    if (fromPage) return redirect("/resenas/baja?error=1", 303);
    return text("No pudimos procesar la baja. Responde al correo y te daremos de baja manualmente.", 500);
  }
};
