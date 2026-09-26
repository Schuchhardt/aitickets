// GET /api/outreach/lead-prefill?t=<token de registro> → datos para prellenar el registro del productor.
// Responde 404 si el token no es válido o el lead no existe. No expone el lead a quien no tenga el token.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { verifyLeadToken } from "../../../lib/lead-token";
import { jsonResponse } from "../../../lib/supabaseServer";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
    const v = verifyLeadToken(url.searchParams.get("t") || "");
    if (!v) return jsonResponse({ error: "not_found" }, 404);
    try {
        const { data: lead } = await getSupabaseAdmin()
            .from("aitickets_leads")
            .select("id, org_name, email, website, city, upcoming_event, status")
            .eq("id", v.leadId)
            .maybeSingle();
        if (!lead || lead.status === "suppressed") return jsonResponse({ error: "not_found" }, 404);
        const ev = lead.upcoming_event && typeof lead.upcoming_event === "object" ? lead.upcoming_event : null;
        return new Response(
            JSON.stringify({
                leadId: lead.id,
                org_name: lead.org_name,
                email: lead.email,
                website: lead.website,
                city: lead.city,
                upcoming_event: ev ? { name: ev.name ?? null, date: ev.date ?? null, venue: ev.venue ?? null } : null,
            }),
            { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } }
        );
    } catch (err: any) {
        console.error("[outreach/lead-prefill] error:", err?.message);
        return jsonResponse({ error: "not_found" }, 404);
    }
};
