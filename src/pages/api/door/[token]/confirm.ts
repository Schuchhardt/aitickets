// POST /api/door/<token>/confirm { ticket_id, validated_at? } — marca el ingreso (misma regla que
// /api/confirm-ticket: 409 con code already_validated | invalid_status).
import type { APIRoute } from "astro";
import { authorizeDoor, doorJson, readDoorBody } from "../_door";
import { checkInTicket, UUID_RE } from "../../../../lib/checkinAccess";

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
    const auth = await authorizeDoor(request, params.token, { scanned: true });
    if (!auth.ok) return auth.response;
    const body = await readDoorBody(request);
    const ticketId = String(body?.ticket_id || "");
    if (!UUID_RE.test(ticketId)) return doorJson({ message: "ticket_id es requerido" }, 400);
    try {
        const result = await checkInTicket(auth.supabase, auth.event.id, { ticketId }, body?.validated_at);
        if (result.ok) {
            return doorJson({ message: "Entrada validada exitosamente", validated_at: result.validated_at, function_mismatch: result.function_mismatch, function_label: result.function_label });
        }
        if (result.code === "not_found") return doorJson({ message: "La entrada no pertenece a este evento" }, 404);
        if (result.code === "already_validated") return doorJson({ message: "Entrada ya validada", code: "already_validated", validated_at: result.validated_at }, 409);
        return doorJson({ message: result.message, code: "invalid_status", status: result.status }, 409);
    } catch (err: any) {
        console.error("door confirm:", err?.message);
        return doorJson({ message: "Error interno del servidor" }, 500);
    }
};
