import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";

export const GET: APIRoute = async () => {
  const supabaseAdmin = getSupabaseAdmin();
  const id = 126; // Integer ID check
  const userId = 46; // Integer

  const { data, error } = await supabaseAdmin
    .from("events")
    .select(`
            *,
            event_tickets (
              id,
              ticket_name,
              price,
              total_quantity
            ),
            event_locations (
              *,
              venues (
                name,
                city
              )
            )
        `)
    .eq("id", id)
    .eq("created_by", userId)
    .single();

  return new Response(JSON.stringify({
    data,
    error
  }, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
};
