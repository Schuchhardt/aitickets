// GET /api/auth/session — quién es el visitante, para las páginas estáticas (portada, landings, header):
// { producer: { name, organization } | null, buyer: { email } | null }
// Solo lo llaman si existe alguna pista de sesión (cookies ait_p / ait_b, src/lib/sessionHints.js). Si la pista
// quedó vieja (sesión vencida o cerrada en otro lado) se borra aquí, así no se vuelve a preguntar en cada página.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext } from "../../../lib/supabaseServer";
import { getBuyerSession, clearBuyerSession } from "../../../lib/buyerSession";
import { BUYER_HINT_COOKIE, PRODUCER_HINT_COOKIE } from "../../../../netlify/lib/buyer-session.mjs";

export const prerender = false;

const firstName = (name: string | null | undefined) => String(name || "").trim().split(/\s+/)[0] || "";

export const GET: APIRoute = async (context) => {
  let producer: { name: string; organization: string } | null = null;
  try {
    const session = await getSessionContext(context);
    if (session) {
      const { data: org } = await getSupabaseAdmin()
        .from("organizations")
        .select("public_name")
        .eq("id", session.dbUser.organization_id)
        .maybeSingle();
      producer = { name: firstName(session.dbUser.name), organization: String(org?.public_name || "").trim() };
    }
  } catch (err: any) {
    console.error("auth/session:", err?.message || err);
  }
  if (!producer && context.cookies.get(PRODUCER_HINT_COOKIE)?.value) context.cookies.delete(PRODUCER_HINT_COOKIE, { path: "/" });

  const buyer = getBuyerSession(context);
  if (!buyer && context.cookies.get(BUYER_HINT_COOKIE)?.value) clearBuyerSession(context);

  return new Response(JSON.stringify({ producer, buyer: buyer ? { email: buyer.email } : null }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
};
