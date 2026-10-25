// Baja (y re-suscripción) del reporte semanal a productores (aitickets_user_email_optouts, topic 'weekly_report';
// RFC 8058). El token firmado identifica a la persona del equipo (public.users.id) y no vence.
// - POST ?t=<token> (one-click de List-Unsubscribe, body "List-Unsubscribe=One-Click"): da de baja y responde 200.
// - POST desde /reporte-semanal/baja (form con t y action 'baja' | 'alta'): da de baja o vuelve a suscribir y
//   redirige a la página con el resultado.
// - GET ?t=<token>: NO actúa (los escáneres de enlaces hacen GET); redirige a la página de confirmación.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { verifyWeeklyReportOptoutToken } from "../../../../netlify/lib/review-token.mjs";
import { USER_OPTOUTS_TABLE, WEEKLY_REPORT_TOPIC } from "../../../../netlify/lib/weekly-report.mjs";

export const prerender = false;

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

type Action = "baja" | "alta";

async function apply(token: string, action: Action, source: "unsubscribe_link" | "one_click"): Promise<boolean> {
  const payload = verifyWeeklyReportOptoutToken(token);
  if (!payload) return false;
  const table = getSupabaseAdmin().from(USER_OPTOUTS_TABLE);
  const { error } =
    action === "baja"
      ? await table.upsert({ user_id: payload.userId, topic: WEEKLY_REPORT_TOPIC, source }, { onConflict: "user_id,topic", ignoreDuplicates: true })
      : await table.delete().eq("user_id", payload.userId).eq("topic", WEEKLY_REPORT_TOPIC);
  if (error) throw error;
  return true;
}

const pageUrl = (token: string, params: Record<string, string>) =>
  `/reporte-semanal/baja?${new URLSearchParams({ ...(token ? { t: token } : {}), ...params }).toString()}`;

export const GET: APIRoute = async ({ url, redirect }) => {
  const t = url.searchParams.get("t") || "";
  return redirect(`/reporte-semanal/baja${t ? `?t=${encodeURIComponent(t)}` : ""}`, 302);
};

export const POST: APIRoute = async ({ request, url, redirect }) => {
  let token = url.searchParams.get("t") || "";
  let fromPage = false;
  let action: Action = "baja";
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const t = form.get("t");
      if (typeof t === "string" && t) {
        token = t;
        fromPage = form.get("from") === "page";
        if (fromPage && form.get("action") === "alta") action = "alta";
      }
    } catch {
      /* body one-click "List-Unsubscribe=One-Click" */
    }
  }
  try {
    const ok = token ? await apply(token, action, fromPage ? "unsubscribe_link" : "one_click") : false;
    if (fromPage) return redirect(ok ? pageUrl(token, { listo: action }) : pageUrl("", { error: "1" }), 303);
    return ok ? text("Listo: no recibirás más el reporte semanal de AI Tickets.") : text("Enlace de baja inválido.", 400);
  } catch (err: any) {
    console.error("[reporte-semanal/baja] error:", err?.message);
    if (fromPage) return redirect(pageUrl("", { error: "1" }), 303);
    return text("No pudimos procesar la baja. Responde al correo y te daremos de baja manualmente.", 500);
  }
};
