// org_*: las herramientas del MCP de productores (src/lib/producer-api/tools) ejecutadas por el admin COMO una
// organización. Se generan solas desde TOOLS: misma validación, confirmación en dos pasos, idempotencia, bitácora
// del productor (canal 'admin', autor "Soporte AI Tickets") y purga del CDN, porque se ejecutan con runTool.
// Ver docs/specs/mcp-admin.md, sección 5.7.
//
// Políticas:
//   - BLOCKED: decisiones que son del productor (pedir/anular retiros, datos bancarios) o reemplazadas por
//     herramientas de admin (get_account → get_organization). No aparecen.
//   - FORCED_CONFIRM: destructivas o de control de acceso: bajo admin siempre piden confirmación, aunque para el
//     productor no la pidan.
//   - organization_id es opcional si los argumentos traen el id de un objeto de esa organización (event_id,
//     order_id, ticket_id, payout_id… ver ORG_SOURCES): se infiere. Si viene y no calza con el objeto, se rechaza.
import { TOOLS } from "../producer-api/tools";
import { effectiveSchema, runTool, ToolError, type ConfirmationSummary, type JsonSchema, type ToolContext, type ToolDef } from "../producer-api/registry";
import { loadOrganization, orgToolContext, SUPPORT_ACTOR_NAME, type AdminContext } from "./context";
import type { AdminToolDef } from "./registry";

export const MIRROR_PREFIX = "org_";

export const BLOCKED = new Set(["get_account", "request_payout", "cancel_payout", "remove_payout_account", "create_payout_account_link"]);

export const FORCED_CONFIRM = new Set([
    "delete_event",
    "delete_ticket_type",
    "delete_discount_code",
    "remove_guest",
    "invite_member",
    "update_member_role",
    "remove_member",
    "assign_event_staff",
    "revoke_invitation",
    "transfer_ticket",
]);

/**
 * Cómo inferir la organización desde un id de los argumentos: tabla y columna con la organización (o el evento).
 * `tools` limita un argumento ambiguo (id, link_id) a las herramientas donde significa eso.
 */
const ORG_SOURCES: Array<{ arg: string; table: string; orgColumn?: string; eventColumn?: string; tools?: string[] }> = [
    { arg: "event_id", table: "events", orgColumn: "organization_id" },
    { arg: "order_id", table: "event_orders", eventColumn: "event_id" },
    { arg: "ticket_type_id", table: "event_tickets", eventColumn: "event_id" },
    { arg: "ticket_id", table: "event_attendees", eventColumn: "event_id" },
    { arg: "post_id", table: "social_posts", orgColumn: "organization_id" },
    { arg: "payout_id", table: "aitickets_payouts", orgColumn: "organization_id" },
    { arg: "message_id", table: "aitickets_scheduled_messages", orgColumn: "organization_id" },
    { arg: "invitation_id", table: "aitickets_team_invitations", orgColumn: "organization_id" },
    { arg: "user_id", table: "users", orgColumn: "organization_id" },
    { arg: "venue_id", table: "venues", orgColumn: "organization_id" },
    { arg: "id", table: "aitickets_discount_codes", orgColumn: "organization_id", tools: ["update_discount_code", "delete_discount_code"] },
    { arg: "link_id", table: "aitickets_event_preview_links", orgColumn: "organization_id", tools: ["revoke_preview_link"] },
    { arg: "link_id", table: "aitickets_checkin_links", orgColumn: "organization_id", tools: ["revoke_checkin_link"] },
];

async function eventOrg(supabase: any, eventId: number): Promise<number | null> {
    const { data } = await supabase.from("events").select("organization_id").eq("id", eventId).maybeSingle();
    return data?.organization_id != null ? Number(data.organization_id) : null;
}

/** Organización sobre la que se actúa: la indicada, o la del objeto de los argumentos (deben coincidir). */
export async function resolveOrganization(actx: AdminContext, toolName: string, given: number | undefined, args: Record<string, unknown>): Promise<number> {
    let inferred: { orgId: number; from: string } | null = null;
    for (const src of ORG_SOURCES) {
        if (src.tools && !src.tools.includes(toolName)) continue;
        const value = args[src.arg];
        if (value == null || value === "") continue;
        const { data } = await actx.supabase
            .from(src.table)
            .select(src.orgColumn || src.eventColumn || "id")
            .eq("id", value)
            .maybeSingle();
        if (!data) {
            if (given) break; // el mensaje de not_found lo da la herramienta, con la organización indicada
            throw new ToolError("not_found", `No existe ${src.arg} = ${value}. Revisa el id (search_events, search_orders…).`);
        }
        const orgId = src.orgColumn ? Number((data as any)[src.orgColumn]) : await eventOrg(actx.supabase, Number((data as any)[src.eventColumn!]));
        if (orgId) inferred = { orgId, from: `${src.arg} ${value}` };
        break;
    }
    if (given && inferred && inferred.orgId !== given) {
        throw new ToolError("invalid_input", `${inferred.from} es de la organización ${inferred.orgId}, no de la ${given}. Revisa sobre qué productor quieres actuar.`);
    }
    const orgId = given || inferred?.orgId;
    if (!orgId) {
        throw new ToolError("invalid_input", "Indica organization_id (o un event_id / order_id de esa organización) para saber sobre qué productor actuar. Usa search_organizations o search_events.");
    }
    return orgId;
}

/** Versión de la herramienta que bajo admin siempre pide confirmación. */
function withForcedConfirm(tool: ToolDef): ToolDef {
    return {
        ...tool,
        async confirm(args: any, ctx: ToolContext): Promise<ConfirmationSummary> {
            const own = tool.confirm ? await tool.confirm(args, ctx) : null;
            if (own) return own;
            const { data: org } = await ctx.supabase.from("organizations").select("public_name").eq("id", ctx.actor.orgId).maybeSingle();
            return {
                message: `${SUPPORT_ACTOR_NAME} va a ejecutar "${tool.title}" (${tool.name}) en la organización ${org?.public_name || ctx.actor.orgId} (#${ctx.actor.orgId}).`,
                details: args,
            };
        },
    };
}

const ADMIN_NEXT_STEP =
    "NADA se ha ejecutado todavía. Muestra este resumen al dueño de la plataforma (no al productor) y pregúntale si confirma. Solo si responde que sí, " +
    "repite la llamada con exactamente los mismos argumentos (incluido organization_id) más confirmation_token. El token vence en 15 minutos y sirve una sola vez.";

function mirrorOf(tool: ToolDef): AdminToolDef {
    const base = FORCED_CONFIRM.has(tool.name) ? withForcedConfirm(tool) : tool;
    const schema = effectiveSchema(base);
    const readOnly = tool.annotations?.readOnlyHint === true;
    const organizationId: JsonSchema = {
        type: "integer",
        minimum: 1,
        description: "Organización sobre la que actuar (ver search_organizations). Opcional si los argumentos traen event_id, order_id u otro id de esa organización.",
    };
    const { readOnlyHint: _readOnly, ...annotations } = tool.annotations || {};
    return {
        name: `${MIRROR_PREFIX}${tool.name}`,
        title: `${tool.title} (como productor)`,
        description:
            `[Como productor] Ejecuta ${tool.name} del MCP de productores sobre la organización indicada y responde con acting_as. ` +
            (FORCED_CONFIRM.has(tool.name) ? "Bajo admin siempre pide confirmación. " : "") +
            tool.description,
        readOnly,
        // Datos de compradores o acciones sobre la plata: nunca con la llave de solo lectura
        sensitive: readOnly && (tool.scope === "attendees" || tool.scope === "finance"),
        delegated: true,
        inputSchema: { ...schema, properties: { organization_id: organizationId, ...(schema.properties || {}) } },
        annotations,
        audit: (_args, result) => {
            const acting = (result as any)?.acting_as;
            const pending = (result as any)?.status === "confirmation_required";
            return {
                organization_id: acting?.organization_id ?? null,
                summary: `${tool.title} como ${acting?.name || `org ${acting?.organization_id ?? "?"}`}${pending ? ": confirmación solicitada" : ""}`,
            };
        },
        async handler(args, actx) {
            const { organization_id: given, ...toolArgs } = args;
            const orgId = await resolveOrganization(actx, tool.name, given, toolArgs);
            const org = await loadOrganization<any>(actx, orgId, "id, public_name");
            const ctx = await orgToolContext(actx, orgId);
            const outcome = await runTool(base, toolArgs, ctx);
            if (!outcome.ok) throw new ToolError(outcome.code, outcome.message);
            const result = outcome.result as Record<string, unknown>;
            return {
                acting_as: { organization_id: orgId, name: org.public_name, as: SUPPORT_ACTOR_NAME },
                ...result,
                ...(result.status === "confirmation_required" ? { next_step: ADMIN_NEXT_STEP } : {}),
            };
        },
    };
}

export const mirrorTools: AdminToolDef[] = TOOLS.filter((t) => !BLOCKED.has(t.name)).map(mirrorOf);
