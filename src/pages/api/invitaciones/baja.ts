// Baja de las invitaciones de una productora (aitickets_org_email_optouts; Ley 19.496 art. 28 B, RFC 8058).
// - POST ?t=<token> (one-click de List-Unsubscribe, body "List-Unsubscribe=One-Click"): da de baja y responde 200.
// - POST desde el botón de /invitaciones/baja (form con t): da de baja y redirige a /invitaciones/baja?listo=1.
// - GET ?t=<token>: NO actúa (los escáneres de enlaces hacen GET); redirige a la página de confirmación.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { verifyInviteOptoutToken } from "../../../../netlify/lib/review-token.mjs";
import { OPTOUTS_TABLE } from "../../../../netlify/lib/reviews.mjs";

export const prerender = false;

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

async function optOut(token: string, source: "unsubscribe_link" | "one_click"): Promise<boolean> {
  const payload = verifyInviteOptoutToken(token);
  if (!payload) return false;
  const { error } = await getSupabaseAdmin()
    .from(OPTOUTS_TABLE)
    .upsert({ organization_id: payload.organizationId, email: payload.email, source }, { onConflict: "organization_id,email", ignoreDuplicates: true });
  if (error) throw error;
  return true;
}

export const GET: APIRoute = async ({ url, redirect }) => {
  const t = url.searchParams.get("t") || "";
  return redirect(`/invitaciones/baja${t ? `?t=${encodeURIComponent(t)}` : ""}`, 302);
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
    const ok = token ? await optOut(token, fromPage ? "unsubscribe_link" : "one_click") : false;
    if (fromPage) return redirect(ok ? "/invitaciones/baja?listo=1" : "/invitaciones/baja?error=1", 303);
    return ok ? text("Listo: no recibirás más invitaciones de esta productora.") : text("Enlace de baja inválido.", 400);
  } catch (err: any) {
    console.error("[invitaciones/baja] error:", err?.message);
    if (fromPage) return redirect("/invitaciones/baja?error=1", 303);
    return text("No pudimos procesar la baja. Responde al correo y te daremos de baja manualmente.", 500);
  }
};
