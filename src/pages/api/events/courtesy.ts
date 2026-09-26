import type { APIRoute } from "astro";
import { randomBytes } from "node:crypto";
import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { sendTicketsEmail } from "../_lib/server-utils";

const MAX_COURTESY_PER_REQUEST = 50;

/** Columna inexistente (PostgREST/Postgres): la base todavía no tiene la migración 202609270100. */
const isMissingColumnError = (error: any) => ["42703", "PGRST204"].includes(String(error?.code || ""));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Emite N entradas de cortesía de un tipo de entrada a un nombre + email.
 * Crea (o reutiliza) el attendee, una event_order pagada con monto 0 y N event_attendees
 * con is_complimentary=true, y envía las entradas por email (contrato C6).
 * Las cortesías NO pasan por la reserva atómica (aitickets_reserve_order): a propósito pueden superar
 * el stock (total_quantity), porque las decide el productor. Quedan con payment_provider='courtesy'.
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

        if (!eventId || !ticketId) return jsonResponse({ message: "Evento y tipo de entrada son obligatorios" }, 400);
        if (!firstName) return jsonResponse({ message: "El nombre es obligatorio" }, 400);
        if (!EMAIL_RE.test(email)) return jsonResponse({ message: "Email inválido" }, 400);
        if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_COURTESY_PER_REQUEST) {
            return jsonResponse({ message: `La cantidad debe estar entre 1 y ${MAX_COURTESY_PER_REQUEST}` }, 400);
        }

        const event = await getOwnedEvent<{ id: number; name: string }>(eventId, dbUser.organization_id, "id, name");
        if (!event) return jsonResponse({ message: "Evento no encontrado o no autorizado" }, 404);

        const { data: ticket } = await supabase
            .from("event_tickets")
            .select("id, ticket_name, price")
            .eq("id", ticketId)
            .eq("event_id", event.id)
            .single();
        if (!ticket) return jsonResponse({ message: "Tipo de entrada no encontrado para este evento" }, 404);

        // 1. Asistente (buscar por email o crear)
        let attendeeId: number;
        const { data: existingAttendee } = await supabase
            .from("attendees")
            .select("id")
            .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
        if (existingAttendee) {
            attendeeId = existingAttendee.id;
        } else {
            const { data: newAttendee, error } = await supabase
                .from("attendees")
                .insert({ first_name: firstName, last_name: lastName || null, email })
                .select("id")
                .single();
            if (error) throw error;
            attendeeId = newAttendee.id;
        }

        // 2. Orden pagada con monto 0
        const orderRow = {
            event_id: event.id,
            attendee_id: attendeeId,
            status: "paid",
            amount: 0,
            payment_fee: 0,
            ticket_fee: 0,
            total_payment: 0,
            balance: 0,
            ticket_qty: quantity,
            // R2: destinatario de esta orden (attendees se comparte por email)
            buyer_first_name: firstName,
            buyer_last_name: lastName || null,
            buyer_email: email,
            // Mismo formato que purchase-tickets: { id, name, price, quantity, total }
            ticket_details: [
                { id: ticket.id, name: ticket.ticket_name, price: 0, quantity, total: 0, complimentary: true, issued_by: dbUser.id },
            ],
        };
        let { data: order, error: orderError } = await supabase
            .from("event_orders")
            .insert({ ...orderRow, payment_provider: "courtesy", currency: "CLP" })
            .select("id")
            .single();
        if (orderError && isMissingColumnError(orderError)) {
            // Base aún sin la migración de proveedores (deploy preview): insertar sin las columnas nuevas
            ({ data: order, error: orderError } = await supabase.from("event_orders").insert(orderRow).select("id").single());
        }
        if (orderError || !order) throw orderError || new Error("No se pudo crear la orden de cortesía");

        // 3. N entradas con QR único
        const attendeesRows = Array.from({ length: quantity }, () => ({
            event_id: event.id,
            event_ticket_id: ticket.id,
            attendee_id: attendeeId,
            event_order_id: order.id,
            qr_code: randomBytes(32).toString("hex"),
            is_complimentary: true,
            status: "active",
        }));
        const { error: attendeesError } = await supabase.from("event_attendees").insert(attendeesRows);
        if (attendeesError) {
            // deshacer la orden para no dejarla huérfana
            await supabase.from("event_orders").delete().eq("id", order.id).eq("event_id", event.id);
            throw attendeesError;
        }

        // 4. Enviar entradas por email
        const mail = await sendTicketsEmail(new URL(context.request.url), order.id);

        return jsonResponse(
            {
                message: mail.ok
                    ? `Se emitieron ${quantity} cortesía(s) y se enviaron a ${email}.`
                    : `Se emitieron ${quantity} cortesía(s), pero falló el envío del email. Usa "Reenviar entradas" desde el check-in.`,
                orderId: order.id,
                emailSent: mail.ok,
            },
            200,
        );
    } catch (error) {
        console.error("Courtesy tickets error:", error);
        return jsonResponse({ message: getFriendlyErrorMessage(error) }, 500);
    }
};
