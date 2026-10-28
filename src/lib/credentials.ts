// Credenciales con nombre para imprimir (panel, pestaña Puerta: CredentialsPrintCard.vue → /api/events/credentials).
// Una credencial por entrada vigente (sin anuladas), en orden alfabético para entregarlas en la mesa: nombre del
// titular (attendeeHolder), empresa si la compra la pidió (event_orders.company_name), tipo de entrada, la función si
// es de una sola, y el QR de la entrada (el mismo que lee el escáner: también sirve para acreditar con la credencial).
import { loadEventTickets, loadOrderCompanies, ticketHolder } from "./attendeeHolder.mjs";
import { formatFunctionLabel } from "../../netlify/lib/dates.mjs";
import { credentialsPdf } from "./attendeePdf.mjs";

/** Tope de credenciales en un PDF (4 por hoja): más que eso, filtrar por función. */
export const MAX_CREDENTIALS_PER_PDF = 2000;

export type CredentialCard = { ticket_id: string; name: string; company: string | null; ticketType: string; functionLabel: string | null; qr: string | null; code: string };

const isLive = (status: string | null | undefined) => status == null || status === "active" || status === "validated";

/**
 * Credenciales de un evento (lógica pura). Con `functionId`, las entradas de esa función y las válidas para todas.
 */
export function credentialCards(
    tickets: any[],
    types: Map<number, any>,
    dates: any[],
    companies: Map<string, string>,
    { functionId = null }: { functionId?: number | null } = {},
): CredentialCard[] {
    const dateById = new Map(dates.map((d) => [String(d.id), d]));
    const multi = dates.length > 1;
    return tickets
        .filter((t) => isLive(t.status))
        .filter((t) => {
            if (functionId == null) return true;
            const fn = types.get(Number(t.event_ticket_id))?.event_date_id ?? null;
            return fn == null || String(fn) === String(functionId);
        })
        .map((t) => {
            const type = types.get(Number(t.event_ticket_id));
            const fnId = type?.event_date_id ?? null;
            const fn = fnId != null ? dateById.get(String(fnId)) : null;
            const holder = ticketHolder(t);
            return {
                ticket_id: String(t.id),
                name: holder.name,
                company: (t.event_order_id && companies.get(String(t.event_order_id))) || null,
                ticketType: type?.ticket_name || (t.is_complimentary ? "Cortesía" : "Entrada"),
                functionLabel: fn ? formatFunctionLabel(fn, { withPlace: false }) : multi ? "Todas las funciones" : null,
                qr: t.qr_code || null,
                code: String(t.id).replace(/-/g, "").slice(0, 8).toUpperCase(),
            };
        })
        .sort((a, b) => (a.name || "~").localeCompare(b.name || "~", "es"));
}

/** Carga las entradas del evento y arma las credenciales. */
export async function loadCredentials(supabase: any, eventId: number, { functionId = null }: { functionId?: number | null } = {}) {
    const [{ data: types }, { data: dates }] = await Promise.all([
        supabase.from("event_tickets").select("id, ticket_name, event_date_id").eq("event_id", eventId),
        supabase.from("event_dates").select("id, date, start_time").eq("event_id", eventId).order("date", { ascending: true }).order("start_time", { ascending: true }),
    ]);
    if (functionId != null && !(dates || []).some((d: any) => String(d.id) === String(functionId))) return null;
    const tickets = await loadEventTickets(supabase, eventId, "id, status, qr_code, event_ticket_id, event_order_id, is_complimentary, created_at");
    const live = tickets.filter((t: any) => isLive(t.status));
    const companies = await loadOrderCompanies(supabase, live.map((t: any) => t.event_order_id));
    const typeMap = new Map<number, any>((types || []).map((t: any) => [Number(t.id), t]));
    return credentialCards(live, typeMap, dates || [], companies, { functionId });
}

export const renderCredentials = (cards: CredentialCard[], eventName: string) => credentialsPdf(cards, { eventName, title: `Credenciales · ${eventName}` });
