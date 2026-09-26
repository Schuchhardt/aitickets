import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, hasRole, jsonResponse } from "../../../lib/supabaseServer";
import { sendTicketsEmail } from "../_lib/server-utils";

// Reenviar entradas: cualquier miembro del equipo del evento (incluidos validadores en la puerta)
const RESEND_ROLES = ["admin", "producer", "editor", "validator"];

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    const { dbUser } = session;
    if (!hasRole(dbUser, RESEND_ROLES)) {
        return jsonResponse({ message: "No tienes permisos para reenviar entradas" }, 403);
    }

    try {
        const { orderId } = await context.request.json();
        if (!orderId || typeof orderId !== "string") {
            return jsonResponse({ message: "orderId es obligatorio" }, 400);
        }

        // La orden debe ser de un evento de la organización del usuario
        const { data: order } = await getSupabaseAdmin()
            .from("event_orders")
            .select("id, status, events!inner ( id, organization_id )")
            .eq("id", orderId)
            .eq("events.organization_id", dbUser.organization_id)
            .maybeSingle();

        if (!order) return jsonResponse({ message: "Orden no encontrada" }, 404);
        if (order.status === "refunded") return jsonResponse({ message: "La orden fue reembolsada: sus entradas están anuladas" }, 400);
        if (order.status !== "paid") return jsonResponse({ message: "Solo se pueden reenviar órdenes pagadas" }, 400);

        const result = await sendTicketsEmail(new URL(context.request.url), order.id, true);
        if (!result.ok) {
            return jsonResponse({ message: result.data?.message || "No se pudo reenviar el email" }, 502);
        }
        return jsonResponse({ message: "Entradas reenviadas" }, 200);
    } catch (error) {
        console.error("Resend tickets error:", error);
        return jsonResponse({ message: "Error interno" }, 500);
    }
};
