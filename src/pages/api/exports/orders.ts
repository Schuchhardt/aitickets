// GET /api/exports/orders?token=… — descarga el CSV contable de órdenes que entrega export_orders (API de
// productores). El token (HMAC, 30 min) lleva organización, usuario, eventos y rango; aquí se vuelve a revisar
// que el usuario siga activo en la organización y con permiso para ver compradores. Sin cookies.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { buildOrderExportRows, rowsToCsv, verifyExportToken } from "../../../lib/ordersExport";
import { roleAllows } from "../../../lib/producer-api/permissions";

export const prerender = false;

const fail = (status: number, message: string) =>
    new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });

export const GET: APIRoute = async ({ url }) => {
    const claims = verifyExportToken(url.searchParams.get("token"));
    if (!claims) return fail(410, "El link de descarga no es válido o venció. Pide uno nuevo con export_orders.");

    const supabase = getSupabaseAdmin();
    const { data: user } = await supabase.from("users").select("id, organization_id, role, active").eq("id", claims.uid).maybeSingle();
    if (!user || user.active === false || Number(user.organization_id) !== claims.org || !roleAllows(user.role, "attendees.read")) {
        return fail(403, "Ya no tienes acceso a estas órdenes.");
    }

    try {
        const rows = await buildOrderExportRows(supabase, { orgId: claims.org, eventIds: claims.events, from: claims.from, to: claims.to });
        const stamp = new Date().toISOString().slice(0, 10);
        return new Response(rowsToCsv(rows), {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="ordenes-aitickets-${stamp}.csv"`,
                "Cache-Control": "no-store",
                "X-Robots-Tag": "noindex, nofollow",
                "Referrer-Policy": "no-referrer",
            },
        });
    } catch (err: any) {
        console.error("exports/orders:", err?.message);
        return fail(500, "No se pudo generar el archivo. Intenta nuevamente.");
    }
};
