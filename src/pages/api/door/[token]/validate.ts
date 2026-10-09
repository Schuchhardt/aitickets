// POST /api/door/<token>/validate { qr_code } — busca una entrada por QR en el evento del link.
import type { APIRoute } from "astro";
import { authorizeDoor, doorJson, readDoorBody } from "../_door";
import { findEventTicket } from "../../../../lib/checkinAccess";
import { getFunctionCheck } from "../../../../../netlify/lib/checkin.mjs";

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
    const auth = await authorizeDoor(request, params.token);
    if (!auth.ok) return auth.response;
    const body = await readDoorBody(request);
    const qrCode = typeof body?.qr_code === "string" ? body.qr_code.trim().slice(0, 200) : "";
    if (!qrCode) return doorJson({ message: "QR no recibido" }, 400);
    try {
        const row = await findEventTicket(auth.supabase, auth.event.id, { qrCode });
        if (!row) return doorJson({ message: "No se encontró una entrada con ese código QR." }, 404);
        const fn = await getFunctionCheck(auth.supabase, auth.event.id, row.event_tickets?.event_date_id ?? null);
        return doorJson({
            ticket: {
                id: row.id,
                event_id: row.event_id,
                qr_code: row.qr_code,
                is_complimentary: Boolean(row.is_complimentary),
                event_date_id: row.event_tickets?.event_date_id ?? null,
                status: row.status ?? "active",
                validated_at: row.validated_at ?? null,
                full_name: `${row.attendees?.first_name || ""} ${row.attendees?.last_name || ""}`.trim(),
                ticket_name: row.event_tickets?.ticket_name || null,
                ...fn,
            },
        });
    } catch (err: any) {
        console.error("door validate:", err?.message);
        return doorJson({ message: "Error interno del servidor" }, 500);
    }
};
