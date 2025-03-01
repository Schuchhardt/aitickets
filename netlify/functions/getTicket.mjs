import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const ticketId = searchParams.get("id");

  if (!ticketId) {
    return new Response(JSON.stringify({ message: "ID de ticket requerido" }), { status: 400 });
  }

  const { data: ticket, error } = await supabase
    .from("event_attendees")
    .select("id, event_id, event_ticket_id, attendee_id, qr_code")
    .eq("id", ticketId)
    .single();

  if (error || !ticket) {
    return new Response(JSON.stringify({ message: "Ticket no encontrado" }), { status: 404 });
  }

  // Obtener datos del evento y asistente
  const { data: event } = await supabase
    .from("events")
    .select("name, start_date")
    .eq("id", ticket.event_id)
    .single();

  const { data: attendee } = await supabase
    .from("attendees")
    .select("first_name, last_name, email")
    .eq("id", ticket.attendee_id)
    .single();

  return new Response(JSON.stringify({
    event_name: event?.name || "Evento desconocido",
    event_date: event?.start_date || "Fecha no disponible",
    ticket_name: "Entrada General",
    attendee_name: `${attendee?.first_name || ""} ${attendee?.last_name || ""}`.trim(),
    attendee_email: attendee?.email || "Correo no disponible",
    qr_code: ticket.qr_code || null
  }), { status: 200 });
}
