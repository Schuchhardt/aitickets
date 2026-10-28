// POST /api/door/<token>/confirm { ticket_id, validated_at?, force? } — marca el ingreso (misma regla que
// /api/confirm-ticket: 409 con code already_validated | invalid_status | late_entry; force deja entrar igual
// fuera de horario).
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
        const result = await checkInTicket(auth.supabase, auth.event.id, { ticketId }, body?.validated_at, { force: body?.force === true });
        if (result.ok) {
            const { ticket: _ticket, ticket_id: _id, ok: _ok, ...rest } = result;
            return doorJson({ message: "Entrada validada exitosamente", ...rest });
        }
        if (result.code === "not_found") return doorJson({ message: "La entrada no pertenece a este evento" }, 404);
        if (result.code === "already_validated") {
            return doorJson({ message: result.function_label ? result.message : "Entrada ya validada", code: "already_validated", validated_at: result.validated_at }, 409);
        }
        if (result.code === "late_entry") {
            return doorJson({ message: result.message, code: "late_entry", entry_until: result.entry_until, deadline_at: result.deadline_at }, 409);
        }
        return doorJson({ message: result.message, code: "invalid_status", status: result.status }, 409);
    } catch (err: any) {
        console.error("door confirm:", err?.message);
        return doorJson({ message: "Error interno del servidor" }, 500);
    }
};
