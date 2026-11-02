// Emisión de entradas de cortesía (sin pago). La usan el panel (/api/events/courtesy) y la API de
// productores (issue_complimentary_tickets).
// Crea (o reutiliza por email) el attendee, una event_order pagada con monto 0 y N event_attendees con
// is_complimentary=true. NO pasa por la reserva atómica de stock (aitickets_reserve_order): a propósito
// puede superar total_quantity, porque las decide el productor. Queda con payment_provider='courtesy'.
// El envío del correo lo hace quien llama (sendTicketsEmail).
//
// Tipo de entrada "Cortesía" (event_tickets.is_gift = true): nunca se vende. Antes lo creaba un trigger de la base con
// cada evento (se quitó en la migración 202611020200); ahora ensureCourtesyTicket lo crea la primera vez que se emite
// una cortesía sin elegir tipo, en cualquier evento (nuevo, antiguo o duplicado).
//
// Entradas numeradas (src/lib/seatMap.mjs): en un evento con mapa de asientos cada cortesía ocupa un asiento de la
// función elegida (eventDateId; si el evento tiene una sola función, esa). Los asientos se pueden indicar (seatKeys) o
// se asignan solos, juntos y centrados (pickBestSeats). Se toman en aitickets_event_seats igual que una compra, así
// nunca se regala un asiento vendido.
import { randomBytes } from "node:crypto";
import { normalizeNameParts } from "../../netlify/lib/buyer-name.mjs";
import { loadEventSeating, holdOrderSeats, markSeatsSold, takenSeats } from "../../netlify/lib/seats.mjs";
import { pickBestSeats, seatIndex, seatLabel } from "./seatMap.mjs";

export const MAX_COURTESY_PER_REQUEST = 50;

/** Columna inexistente (PostgREST/Postgres): la base todavía no tiene la migración 202609270100. */
const isMissingColumnError = (error: any) => ["42703", "PGRST204"].includes(String(error?.code || ""));

export const COURTESY_TICKET_NAME = "Cortesía";

/** Error que quien llama muestra tal cual (400). */
export class CourtesyError extends Error {}

/**
 * Tipo "Cortesía" del evento (is_gift = true): el existente o uno nuevo. Precio 0, sin cupo y nunca a la venta
 * (isTicketOnSale descarta is_gift). Dos emisiones simultáneas podrían crear dos: se usa siempre el de id menor.
 */
export async function ensureCourtesyTicket(supabase: any, eventId: number): Promise<{ id: number; ticket_name: string }> {
    const find = () => supabase.from("event_tickets").select("id, ticket_name").eq("event_id", eventId).eq("is_gift", true).order("id", { ascending: true }).limit(1).maybeSingle();
    const { data: existing, error } = await find();
    if (error) throw error;
    if (existing) return { id: Number(existing.id), ticket_name: existing.ticket_name };
    const { error: insertError } = await supabase.from("event_tickets").insert({
        event_id: eventId,
        ticket_name: COURTESY_TICKET_NAME,
        price: 0,
        max_quantity: null,
        total_quantity: null,
        is_gift: true,
        status: "available",
    });
    if (insertError) throw insertError;
    const { data: created, error: readError } = await find();
    if (readError || !created) throw readError || new Error("No se pudo crear el tipo Cortesía");
    return { id: Number(created.id), ticket_name: created.ticket_name };
}

export type CourtesyInput = {
    event: { id: number };
    ticket: { id: number; ticket_name: string };
    quantity: number;
    /** Entradas numeradas: función de las cortesías (obligatoria si el evento tiene varias). */
    eventDateId?: number | null;
    /** Entradas numeradas: asientos elegidos (si no, se asignan solos). */
    seatKeys?: string[] | null;
    firstName: string;
    lastName?: string | null;
    email: string;
    issuedBy: number;
};

/** Busca el attendee por email (el más antiguo) o lo crea. */
export async function findOrCreateAttendee(supabase: any, { firstName: rawFirst, lastName: rawLast, email }: { firstName: string; lastName?: string | null; email: string }): Promise<number> {
    const { firstName, lastName } = normalizeNameParts(rawFirst, rawLast);
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

/**
 * Asientos para las cortesías de un evento con entradas numeradas (null si el evento no tiene mapa). Valida la función
 * y los asientos pedidos, o elige los mejores libres. Lanza CourtesyError con un mensaje para el productor.
 */
export async function planCourtesySeats(
    supabase: any,
    { eventId, ticketId, quantity, eventDateId, seatKeys }: { eventId: number; ticketId: number; quantity: number; eventDateId?: number | null; seatKeys?: string[] | null },
): Promise<{ event_date_id: number; seats: Array<{ key: string; label: string; ticket_id: number }> } | null> {
    const seating = await loadEventSeating(supabase, eventId);
    if (!seating.seated) return null;
    const ids = [...seating.mapsByDate.keys()] as number[];
    const dateId = eventDateId ? Number(eventDateId) : ids.length === 1 ? ids[0] : null;
    if (!dateId || !seating.mapsByDate.has(dateId)) {
        throw new CourtesyError("Este evento tiene entradas numeradas: elige la función de las cortesías.");
    }
    const map = seating.mapsByDate.get(dateId);
    const { data: t } = await supabase.from("event_tickets").select("event_date_id, seat_sections").eq("id", ticketId).maybeSingle();
    if (t?.event_date_id && Number(t.event_date_id) !== dateId) throw new CourtesyError("Ese tipo de entrada es de otra función.");
    const sections: string[] | null = Array.isArray(t?.seat_sections) && t.seat_sections.length ? t.seat_sections : null;
    const taken = new Set<string>(await takenSeats(supabase, dateId));
    let keys: string[];
    if (Array.isArray(seatKeys) && seatKeys.length) {
        keys = [...new Set(seatKeys.map(String))];
        const index = seatIndex(map);
        if (keys.length !== quantity) throw new CourtesyError(`Elige ${quantity} ${quantity === 1 ? "asiento" : "asientos"}.`);
        for (const k of keys) {
            const seat = index.get(k);
            if (!seat) throw new CourtesyError(`El asiento ${k} no existe en el mapa.`);
            if (sections && !sections.includes(seat.sectionId)) throw new CourtesyError(`${seatLabel(map, k)} no corresponde a ese tipo de entrada.`);
            if (taken.has(k)) throw new CourtesyError(`${seatLabel(map, k)} ya está ocupado.`);
        }
    } else {
        keys = pickBestSeats(map, taken, quantity, sections);
        if (keys.length < quantity) throw new CourtesyError(`No quedan ${quantity} asientos libres en esa función.`);
    }
    return { event_date_id: dateId, seats: keys.map((key) => ({ key, label: seatLabel(map, key), ticket_id: ticketId })) };
}

/** Emite las cortesías y devuelve el id de la orden creada. Lanza si falla (sin dejar órdenes huérfanas). */
export async function issueCourtesyTickets(supabase: any, input: CourtesyInput): Promise<{ orderId: string; seats: string[] }> {
    const { event, ticket, quantity, email, issuedBy } = input;
    // Nombre normalizado ("  jaVier " => "Javier") para el attendee y la orden
    const { firstName, lastName } = normalizeNameParts(input.firstName, input.lastName);
    // Entradas numeradas: antes de crear nada (un error de asientos no deja órdenes)
    const seatPlan = await planCourtesySeats(supabase, { eventId: event.id, ticketId: ticket.id, quantity, eventDateId: input.eventDateId, seatKeys: input.seatKeys });

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
            {
                id: ticket.id,
                name: ticket.ticket_name,
                price: 0,
                quantity,
                total: 0,
                complimentary: true,
                issued_by: issuedBy,
                ...(seatPlan ? { event_date_id: seatPlan.event_date_id } : {}),
            },
        ],
        ...(seatPlan ? { seat_selection: seatPlan } : {}),
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
    const undo = () => supabase.from("event_orders").delete().eq("id", order.id).eq("event_id", event.id);

    // 2b. Asientos: se toman como en una compra (la orden ya está pagada, así que no vencen)
    if (seatPlan) {
        let held: { ok: boolean; taken?: string[] };
        try {
            held = await holdOrderSeats(supabase, order.id, seatPlan, null);
        } catch (err) {
            await undo();
            throw err;
        }
        if (!held.ok) {
            await undo();
            throw new CourtesyError(`Alguien acaba de tomar ${(held.taken || []).join(", ")}. Intenta de nuevo.`);
        }
    }

    // 3. N entradas con QR único
    const attendeesRows = Array.from({ length: quantity }, (_, i) => ({
        event_id: event.id,
        event_ticket_id: ticket.id,
        attendee_id: attendeeId,
        event_order_id: order.id,
        qr_code: newQrCode(),
        is_complimentary: true,
        status: "active",
        ...(seatPlan ? { seat_key: seatPlan.seats[i].key, seat_label: seatPlan.seats[i].label } : {}),
    }));
    const { data: inserted, error: attendeesError } = await supabase.from("event_attendees").insert(attendeesRows).select("id, seat_key");
    if (attendeesError) {
        // deshacer la orden para no dejarla huérfana (sus asientos se borran con ella)
        await undo();
        throw attendeesError;
    }
    if (seatPlan) await markSeatsSold(supabase, order.id, seatPlan.event_date_id, inserted);
    return { orderId: String(order.id), seats: seatPlan ? seatPlan.seats.map((s) => s.label) : [] };
}
