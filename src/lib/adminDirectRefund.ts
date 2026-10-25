// Devolución directa (Términos para compradores §7 y para productores §9 bis): AI Tickets cancela un evento y
// devuelve a los compradores el total pagado (entradas + cargo por servicio + IVA) SIN autorización del productor.
// Reusa la lógica de cancel_event (src/lib/producer-api/tools/postsale.ts) con un actor interno (channel "admin"):
// anula las entradas, registra un reembolso total por orden (requested_via 'admin') y avisa a los compradores.
// El precio de las entradas devueltas se descuenta de lo pendiente por transferir al productor (ledger.ts).
//
// Acceso: solo con el header x-admin-secret igual a ADMIN_API_SECRET (mínimo 24 caracteres). Sin esa variable,
// el endpoint responde 503. Runbook: docs/runbooks/devolucion-directa.md.
import { timingSafeEqual } from "node:crypto";
import { cancelEvent } from "./producer-api/tools/postsale";
import { ToolError, type ToolContext } from "./producer-api/registry";
import { notifySlack, serverEnv } from "../pages/api/_lib/server-utils";
import { purgeEventPages } from "./cdnCache";

export const DIRECT_REFUND_REASONS = {
    not_held: "El evento no se realizó en la fecha anunciada y el productor no informó una reprogramación dentro de 5 días hábiles",
    producer_unresponsive: "El productor no respondió nuestras comunicaciones durante 5 días hábiles después de un cambio o cancelación",
    permit_revoked: "Una autoridad negó, revocó o suspendió la autorización del evento",
    fraud: "Detectamos indicios de fraude o de que el evento no existe",
} as const;

export type DirectRefundReason = keyof typeof DIRECT_REFUND_REASONS;

const MIN_SECRET_LENGTH = 24;

/** "ok" si el header x-admin-secret coincide con ADMIN_API_SECRET; "disabled" si no está configurado. */
export function checkAdminSecret(request: Request, secret = serverEnv("ADMIN_API_SECRET")): "ok" | "unauthorized" | "disabled" {
    if (!secret || secret.length < MIN_SECRET_LENGTH) return "disabled";
    const given = Buffer.from(String(request.headers.get("x-admin-secret") || ""));
    const expected = Buffer.from(secret);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "unauthorized";
    return "ok";
}

export type DirectRefundInput = {
    supabase: any;
    eventId: number;
    reasonCode: DirectRefundReason;
    /** Detalle interno (qué se verificó, número de reclamo, etc.). Va a la bitácora y a Slack, no al correo. */
    detail?: string;
    /** Texto del aviso a los compradores. Por defecto, el motivo del código. */
    buyerMessage?: string;
    notifyBuyers?: boolean;
    /** Quién lo ejecuta (nombre o correo del equipo de AI Tickets), para la bitácora. */
    admin: string;
    requestUrl: URL;
    origin: string;
    /** true = solo devuelve el resumen (cuántas órdenes y montos), sin ejecutar nada. */
    dryRun?: boolean;
};

async function adminContext(input: DirectRefundInput): Promise<{ ctx: ToolContext; event: any }> {
    const { data: event, error } = await input.supabase
        .from("events")
        .select("id, name, slug, organization_id, cancelled_at")
        .eq("id", input.eventId)
        .maybeSingle();
    if (error) throw error;
    if (!event) throw new ToolError("not_found", `No existe el evento ${input.eventId}.`);
    const ctx: ToolContext = {
        supabase: input.supabase,
        actor: {
            keyId: null,
            // Acción de AI Tickets, no de un usuario del productor: requested_by queda NULL.
            userId: null as unknown as number,
            orgId: Number(event.organization_id),
            role: "owner",
            name: `AI Tickets (${input.admin})`,
            email: null,
            scopes: ["read", "write", "publish", "attendees", "finance", "team"] as any,
            eventIds: null,
        },
        origin: input.origin,
        requestUrl: input.requestUrl,
        // Fuera del tipo a propósito: las herramientas no lo conocen; queda como requested_via 'admin' en los reembolsos.
        channel: "admin" as ToolContext["channel"],
    };
    return { ctx, event };
}

async function auditAdmin(ctx: ToolContext, eventId: number, ok: boolean, summary: string, errorCode: string | null = null) {
    const row = {
        organization_id: ctx.actor.orgId,
        api_key_id: null,
        user_id: null,
        tool: "admin_direct_refund",
        channel: "admin",
        ok,
        error_code: errorCode,
        event_id: eventId,
        summary: summary.slice(0, 300),
        target: `event:${eventId}`,
    };
    const { error } = await ctx.supabase.from("aitickets_api_audit").insert(row);
    if (error) console.warn("admin audit:", error.message);
}

export async function directRefundEvent(input: DirectRefundInput) {
    if (!(input.reasonCode in DIRECT_REFUND_REASONS)) {
        throw new ToolError("invalid_input", `reason_code debe ser uno de: ${Object.keys(DIRECT_REFUND_REASONS).join(", ")}.`);
    }
    if (!String(input.admin || "").trim()) throw new ToolError("invalid_input", "Indica quién ejecuta la devolución (admin).");
    const { ctx, event } = await adminContext(input);
    const reasonText = DIRECT_REFUND_REASONS[input.reasonCode];
    const args = {
        event_id: Number(event.id),
        reason: (input.buyerMessage || `${reasonText}. AI Tickets devolverá el total pagado según los Términos y condiciones.`).slice(0, 1000),
        notify_buyers: input.notifyBuyers !== false,
    };

    if (input.dryRun) {
        const summary = await cancelEvent.confirm!(args, ctx);
        return { dry_run: true, event_id: Number(event.id), event_name: event.name, reason_code: input.reasonCode, summary };
    }

    try {
        const result: any = await cancelEvent.handler(args, ctx);
        const summary = `Devolución directa (${input.reasonCode}) por ${input.admin}: ${result.refunds_created} reembolso(s)${input.detail ? ` · ${input.detail}` : ""}`;
        await auditAdmin(ctx, Number(event.id), true, summary);
        await purgeEventPages();
        await notifySlack(
            `🧾 *Devolución directa sin autorización del productor*\n• *Evento:* ${event.name} (#${event.id}, org ${event.organization_id})\n` +
                `• *Motivo:* ${input.reasonCode} — ${reasonText}\n• *Por:* ${input.admin}${input.detail ? `\n• *Detalle:* ${input.detail.slice(0, 500)}` : ""}\n` +
                `• *Reembolsos:* ${result.refunds_created} por $${Number(result.refund_total_clp || 0).toLocaleString("es-CL")}\n` +
                "• Si ya se transfirió al productor, pedirle la restitución en 5 días hábiles (Términos para productores §9 bis).",
        );
        return { ...result, reason_code: input.reasonCode };
    } catch (err: any) {
        await auditAdmin(ctx, Number(event.id), false, `Devolución directa (${input.reasonCode}) por ${input.admin}: falló`, err instanceof ToolError ? err.code : "internal");
        throw err;
    }
}
