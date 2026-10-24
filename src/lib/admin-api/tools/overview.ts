// Herramientas de admin: contexto inicial (get_admin_context).
import type { AdminToolDef } from "../registry";
import { SUPPORT_ACTOR_NAME } from "../context";

const headCount = async (query: any): Promise<number | null> => {
    const { count, error } = await query;
    return error ? null : (count ?? 0);
};

const getAdminContext: AdminToolDef = {
    name: "get_admin_context",
    title: "Contexto de administración",
    description:
        "Primera llamada de cada sesión: qué llave se está usando (completa o solo lectura), convenciones (CLP, hora de Chile), " +
        "conteos generales de la plataforma y qué familias de herramientas hay (plataforma, operación y org_* para actuar como un productor).",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, actx) {
        const { supabase } = actx;
        const nowIso = new Date().toISOString();
        const [organizations, published, upcoming, paidOrders] = await Promise.all([
            headCount(supabase.from("organizations").select("id", { count: "exact", head: true })),
            headCount(supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "published")),
            headCount(supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "published").gte("end_date", nowIso)),
            headCount(supabase.from("event_orders").select("id", { count: "exact", head: true }).eq("status", "paid")),
        ]);
        return {
            key: {
                kind: actx.keyKind,
                fingerprint: actx.fingerprint,
                allows: actx.keyKind === "full" ? "Todo: lecturas, operación y org_* (con motivo y confirmación donde corresponda)." : "Solo lecturas no sensibles.",
            },
            platform: {
                organizations,
                published_events: published,
                published_upcoming_events: upcoming,
                paid_orders_all_time: paidOrders,
                note: "Conteos crudos (incluyen eventos demo de la organización 1). Para métricas usa las herramientas de plataforma.",
            },
            conventions: {
                currency: "CLP, enteros.",
                timezone: "Días y horas de negocio en America/Santiago; timestamps ISO en UTC (con *_local cuando aplica).",
                sales: "Ventas = órdenes pagadas sin cortesías ni transferencias. gross = lo que pagaron los compradores; producer_net = lo del productor; aitickets_fee_net = cargo por servicio sin IVA.",
                conversion: "Conversión = órdenes vendidas ÷ visitantes únicos; ocupación (sell-through) = emitidas ÷ capacidad.",
            },
            tool_families: {
                platform: "search_organizations, get_organization, search_events y el resto de herramientas de plataforma: ven todas las organizaciones.",
                operations: "Escrituras de AI Tickets (verificar cuentas, registrar retiros y reembolsos…): exigen reason y, si mueven plata, confirmación.",
                act_as_producer: `org_<herramienta>: las herramientas del MCP de productores sobre la organización indicada (organization_id, o inferida del event_id). Quedan en la bitácora del productor firmadas por "${SUPPORT_ACTOR_NAME}".`,
            },
            spec: "docs/specs/mcp-admin.md",
        };
    },
};

export const overviewTools: AdminToolDef[] = [getAdminContext];
