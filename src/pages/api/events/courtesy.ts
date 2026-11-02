import type { APIRoute } from "astro";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { sendTicketsEmail } from "../_lib/server-utils";
import { issueCourtesyTickets, ensureCourtesyTicket, CourtesyError, MAX_COURTESY_PER_REQUEST } from "../../../lib/courtesy";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Emite N entradas de cortesía de un tipo de entrada a un nombre + email (lógica en src/lib/courtesy.ts)
 * y envía las entradas por email (contrato C6).
 * ticketId: id de un tipo de entrada del evento o "courtesy" (el tipo Cortesía, que se crea si no existe).
 * Entradas numeradas: eventDateId (función) y seatKeys opcionales; sin seatKeys los asientos se asignan solos.
 */
export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, EVENT_MANAGER_ROLES)) {
        return jsonResponse({ message: "No tienes permisos para emitir cortesías" }, 403);
    }

    const supabase = getSupabaseAdmin();

    try {
        const body = await context.request.json();
        const eventId = body?.eventId;
        const ticketId = body?.ticketId;
        const quantity = Math.floor(Number(body?.quantity));
        const firstName = String(body?.firstName || "").trim().slice(0, 100);
        const lastName = String(body?.lastName || "").trim().slice(0, 100);
        const email = String(body?.email || "").trim().toLowerCase().slice(0, 200);

        if (!eventId) return jsonResponse({ message: "Evento y tipo de entrada son obligatorios" }, 400);
        const eventDateId = Number(body?.eventDateId) > 0 ? Number(body.eventDateId) : null;
        const seatKeys = Array.isArray(body?.seatKeys) ? body.seatKeys.slice(0, MAX_COURTESY_PER_REQUEST).map((k: unknown) => String(k).slice(0, 60)) : null;
        if (!firstName) return jsonResponse({ message: "El nombre es obligatorio" }, 400);
        if (!EMAIL_RE.test(email)) return jsonResponse({ message: "Email inválido" }, 400);
        if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_COURTESY_PER_REQUEST) {
            return jsonResponse({ message: `La cantidad debe estar entre 1 y ${MAX_COURTESY_PER_REQUEST}` }, 400);
        }

        const event = await getOwnedEvent<{ id: number; name: string }>(eventId, dbUser.organization_id, "id, name", dbUser.id);
        if (!event) return jsonResponse({ message: "Evento no encontrado o no autorizado" }, 404);

        // Sin tipo elegido (o "courtesy"): el tipo Cortesía del evento, que se crea la primera vez
        let ticket: { id: number; ticket_name: string } | null = null;
        if (!ticketId || ticketId === "courtesy") {
            ticket = await ensureCourtesyTicket(supabase, Number(event.id));
        } else {
            const { data } = await supabase.from("event_tickets").select("id, ticket_name").eq("id", ticketId).eq("event_id", event.id).maybeSingle();
            ticket = data ? { id: Number(data.id), ticket_name: data.ticket_name } : null;
        }
        if (!ticket) return jsonResponse({ message: "Tipo de entrada no encontrado para este evento" }, 404);

        let issued: { orderId: string; seats: string[] };
        try {
            issued = await issueCourtesyTickets(supabase, { event, ticket, quantity, firstName, lastName, email, issuedBy: dbUser.id, eventDateId, seatKeys });
        } catch (err) {
            if (err instanceof CourtesyError) return jsonResponse({ message: err.message }, 400);
            throw err;
        }
        const { orderId, seats } = issued;
        const seatNote = seats.length ? ` Asientos: ${seats.join(", ")}.` : "";

        // Enviar entradas por email
        const mail = await sendTicketsEmail(new URL(context.request.url), orderId);

        return jsonResponse(
            {
                message: mail.ok
                    ? `Se emitieron ${quantity} cortesía(s) y se enviaron a ${email}.${seatNote}`
                    : `Se emitieron ${quantity} cortesía(s), pero falló el envío del email. Usa "Reenviar entradas" desde el check-in.${seatNote}`,
                orderId,
                seats,
                emailSent: mail.ok,
            },
            200,
        );
    } catch (error) {
        console.error("Courtesy tickets error:", error);
        return jsonResponse({ message: getFriendlyErrorMessage(error) }, 500);
    }
};
