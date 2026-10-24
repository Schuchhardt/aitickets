// POST /api/buyer/logout — cierra la sesión de asistente de este dispositivo ("Mis entradas").
import type { APIRoute } from "astro";
import { jsonResponse } from "../../../lib/supabaseServer";
import { clearBuyerSession } from "../../../lib/buyerSession";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  clearBuyerSession(context);
  return jsonResponse({ ok: true });
};
