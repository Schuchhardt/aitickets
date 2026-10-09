// GET /api/door/<token>/attendees — lista de entradas del evento del link para el escáner de puerta (offline).
// Datos mínimos: nombre, tipo de entrada, estado y QR (para validar sin conexión). Sin email ni orden.
import type { APIRoute } from "astro";
import { authorizeDoor, doorJson } from "../_door";
import { DOOR_TICKET_SELECT, presentDoorTicket } from "../../../../lib/checkinAccess";

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
    const auth = await authorizeDoor(request, params.token);
    if (!auth.ok) return auth.response;
    try {
        const attendees: any[] = [];
        for (let from = 0; from < 50_000; from += 1000) {
            const { data, error } = await auth.supabase
                .from("event_attendees")
                .select(DOOR_TICKET_SELECT)
                .eq("event_id", auth.event.id)
                .order("id", { ascending: true })
                .range(from, from + 999);
            if (error) throw error;
            attendees.push(...(data || []));
            if (!data || data.length < 1000) break;
        }
        const { data: dates } = await auth.supabase
            .from("event_dates")
            .select("id, date, start_time")
            .eq("event_id", auth.event.id)
            .order("date", { ascending: true })
            .order("start_time", { ascending: true });
        return doorJson({ attendees: attendees.map(presentDoorTicket), dates: dates || [] });
    } catch (err: any) {
        console.error("door attendees:", err?.message);
        return doorJson({ message: "No se pudieron obtener los asistentes." }, 500);
    }
};
