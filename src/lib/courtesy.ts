// Emisión de entradas de cortesía (sin pago). La usan el panel (/api/events/courtesy) y la API de
// productores (issue_complimentary_tickets).
// Crea (o reutiliza por email) el attendee, una event_order pagada con monto 0 y N event_attendees con
// is_complimentary=true. NO pasa por la reserva atómica de stock (aitickets_reserve_order): a propósito
// puede superar total_quantity, porque las decide el productor. Queda con payment_provider='courtesy'.
// El envío del correo lo hace quien llama (sendTicketsEmail).
import { randomBytes } from "node:crypto";

export const MAX_COURTESY_PER_REQUEST = 50;

/** Columna inexistente (PostgREST/Postgres): la base todavía no tiene la migración 202609270100. */
const isMissingColumnError = (error: any) => ["42703", "PGRST204"].includes(String(error?.code || ""));

export type CourtesyInput = {
    event: { id: number };
    ticket: { id: number; ticket_name: string };
    quantity: number;
    firstName: string;
    lastName?: string | null;
    email: string;
    issuedBy: number;
};

/** Busca el attendee por email (el más antiguo) o lo crea. */
export async function findOrCreateAttendee(supabase: any, { firstName, lastName, email }: { firstName: string; lastName?: string | null; email: string }): Promise<number> {
    const { data: existing } = await supabase
        .from("attendees")
        .select("id")
        .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
    if (existing) return Number(existing.id);
    const { data: created, error } = await supabase
        .from("attendees")
        .insert({ first_name: firstName, last_name: lastName || null, email })
        .select("id")
        .single();
    if (error) throw error;
    return Number(created.id);
}

/** Nuevo código QR (64 hex). */
export const newQrCode = () => randomBytes(32).toString("hex");

/** Emite las cortesías y devuelve el id de la orden creada. Lanza si falla (sin dejar órdenes huérfanas). */
export async function issueCourtesyTickets(supabase: any, input: CourtesyInput): Promise<{ orderId: string }> {
    const { event, ticket, quantity, firstName, lastName, email, issuedBy } = input;

    // 1. Asistente (buscar por email o crear)
    const attendeeId = await findOrCreateAttendee(supabase, { firstName, lastName, email });

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
            { id: ticket.id, name: ticket.ticket_name, price: 0, quantity, total: 0, complimentary: true, issued_by: issuedBy },
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
        qr_code: newQrCode(),
        is_complimentary: true,
        status: "active",
    }));
    const { error: attendeesError } = await supabase.from("event_attendees").insert(attendeesRows);
    if (attendeesError) {
        // deshacer la orden para no dejarla huérfana
        await supabase.from("event_orders").delete().eq("id", order.id).eq("event_id", event.id);
        throw attendeesError;
    }
    return { orderId: String(order.id) };
}
