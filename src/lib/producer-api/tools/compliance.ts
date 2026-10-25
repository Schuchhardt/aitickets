// Herramientas: liberación de fondos y cumplimiento del evento (Términos para productores §2 ter y §8).
//   attest_function_held   el productor acredita que una función se realizó (reemplaza el mínimo de check-ins)
//   get_event_compliance   riesgo, reserva, autorización y documentos del evento, y estado de liberación por función
import { ToolError, type ToolDef } from "../registry";
import { eventIdSchema, loadOwnedEvent, localDateTime, clp } from "./common";
import { computeEventLedger, functionEnd, CHECKIN_RELEASE_THRESHOLD, RELEASE_HOURS } from "../ledger";
import { DOCUMENT_KINDS, PERMIT_STATUS_LABELS, loadEventDocuments, missingDocumentKinds } from "../../eventDocuments";
import { RISK_LEVEL_LABELS } from "../../eventRisk";
import { notifySlack } from "../../../pages/api/_lib/server-utils";

const MISSING = ["42P01", "PGRST205", "42703", "PGRST204"];
const isMissing = (err: any) => MISSING.includes(String(err?.code || ""));

const attestFunctionHeld: ToolDef = {
    name: "attest_function_held",
    title: "Acreditar que la función se realizó",
    description:
        `Declara que una función ya realizada efectivamente ocurrió. Lo vendido para una función se libera ${RELEASE_HOURS} h después de que termina si tiene ` +
        `check-ins de al menos ${Math.round(CHECKIN_RELEASE_THRESHOLD * 100)}% de las entradas; si no (p. ej. no se usó el escáner de AI Tickets), el productor ` +
        "puede acreditar que se realizó con esta herramienta. event_date_id omitido = todo el evento (abonos y entradas para varias funciones). " +
        "Es una declaración del productor: AI Tickets puede pedir evidencia (fotos, contrato del lugar) y una declaración falsa es causal de retención y término.",
    scope: "finance",
    permission: "finance.manage",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id", "note"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            event_date_id: { type: "integer", minimum: 1, description: "Función (ver get_event). Omitir = todo el evento." },
            note: { type: "string", minLength: 3, maxLength: 1000, description: "Cómo se realizó y qué evidencia tienes (p. ej. asistentes aproximados, link a fotos)." },
        },
    },
    audit: (args) => ({ summary: `Acreditó que se realizó ${args.event_date_id ? `la función ${args.event_date_id}` : "el evento"}`, target: `event:${args.event_id}` }),
    async handler(args, ctx) {
        const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, end_date, cancelled_at");
        if (event.cancelled_at) throw new ToolError("conflict", "El evento está cancelado: no se puede acreditar que se realizó.");
        const now = new Date();
        const stamp = { held_attested_at: now.toISOString(), held_attested_by: ctx.actor.userId ?? null };
        let label: string;
        if (args.event_date_id) {
            const { data: fn, error } = await ctx.supabase
                .from("event_dates")
                .select("id, event_id, date, start_time, end_time")
                .eq("id", args.event_date_id)
                .eq("event_id", event.id)
                .maybeSingle();
            if (error) throw error;
            if (!fn) throw new ToolError("not_found", `La función ${args.event_date_id} no es de este evento.`);
            const end = functionEnd(fn);
            if (!end || end.getTime() > now.getTime()) throw new ToolError("conflict", "La función aún no termina: solo se puede acreditar una función ya realizada.");
            const { error: upError } = await ctx.supabase
                .from("event_dates")
                .update({ ...stamp, held_attested_note: args.note })
                .eq("id", fn.id)
                .eq("event_id", event.id);
            if (upError) {
                if (isMissing(upError)) throw new ToolError("unavailable", "Esta opción aún no está disponible. Intenta en unos minutos.");
                throw upError;
            }
            label = `función ${String(fn.date).slice(0, 10)} ${String(fn.start_time || "").slice(0, 5)}`;
        } else {
            if (event.end_date && new Date(event.end_date).getTime() > now.getTime()) {
                throw new ToolError("conflict", "El evento aún no termina: acredita cada función ya realizada con event_date_id.");
            }
            const { error: upError } = await ctx.supabase.from("events").update(stamp).eq("id", event.id).eq("organization_id", ctx.actor.orgId);
            if (upError) {
                if (isMissing(upError)) throw new ToolError("unavailable", "Esta opción aún no está disponible. Intenta en unos minutos.");
                throw upError;
            }
            label = "todo el evento";
        }
        await notifySlack(
            `✅ *Función acreditada por el productor*\n• *Evento:* ${event.name} (#${event.id}, org ${ctx.actor.orgId})\n• *Qué:* ${label}\n• *Nota:* ${String(args.note).slice(0, 500)}\n• *Por:* ${ctx.actor.name || ctx.actor.email}`,
        );
        const ledger = await computeEventLedger(ctx.supabase, ctx.actor.orgId, Number(event.id));
        return {
            event_id: Number(event.id),
            event_date_id: args.event_date_id ?? null,
            attested_at: stamp.held_attested_at,
            available_now: ledger?.available ?? 0,
            still_held: ledger?.hold_reasons?.map((r) => r.label) || [],
            note: "Quedó registrada tu declaración. AI Tickets puede pedirte evidencia antes de transferir.",
        };
    },
};

const getEventCompliance: ToolDef = {
    name: "get_event_compliance",
    title: "Autorización, documentos y liberación del evento",
    description:
        "Muestra el nivel de riesgo y la reserva del evento, si es masivo, el estado de su autorización (Delegación Presidencial), los documentos subidos y " +
        "los que faltan, y por cada función si lo vendido está liberado o retenido y por qué. Los documentos se suben desde el panel del evento.",
    scope: "read",
    permission: "events.read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        let event: any;
        try {
            event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, is_massive, requires_documents, permit_status, risk_level, risk_signals, reserve_pct");
        } catch (err) {
            if (err instanceof ToolError) throw err;
            event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name");
        }
        const [{ documents }, ledger] = await Promise.all([
            loadEventDocuments(ctx.supabase, Number(event.id)).catch(() => ({ documents: [] as any[] })),
            computeEventLedger(ctx.supabase, ctx.actor.orgId, Number(event.id)),
        ]);
        const permit = (event.permit_status || "none") as keyof typeof PERMIT_STATUS_LABELS;
        return {
            event_id: Number(event.id),
            name: event.name,
            risk_level: event.risk_level || null,
            risk_level_label: event.risk_level ? RISK_LEVEL_LABELS[event.risk_level as keyof typeof RISK_LEVEL_LABELS] : null,
            risk_signals: (event.risk_signals || []).map((s: any) => s.label),
            reserve_pct: Number(event.reserve_pct) || 0,
            is_massive: Boolean(event.is_massive),
            requires_documents: Boolean(event.requires_documents),
            permit_status: permit,
            permit_status_label: PERMIT_STATUS_LABELS[permit],
            documents: documents.map((d: any) => ({ id: d.id, kind: d.kind, kind_label: DOCUMENT_KINDS[d.kind as keyof typeof DOCUMENT_KINDS], status: d.status, file_name: d.file_name, created_at: d.created_at })),
            missing_documents: missingDocumentKinds(event, documents).map((k) => ({ kind: k, label: DOCUMENT_KINDS[k] })),
            balance: ledger
                ? {
                      available: ledger.available,
                      pending: ledger.pending,
                      retained: ledger.retained,
                      reserve_amount: ledger.reserve_amount,
                      reserve_release_local: localDateTime(ledger.reserve_release_at),
                      hold_reasons: ledger.hold_reasons.map((r) => ({ code: r.code, label: r.label, amount: r.amount ?? null })),
                      summary: `Disponible ${clp(ledger.available)} · Pendiente ${clp(ledger.pending)} · Retenido ${clp(ledger.retained)}`,
                  }
                : null,
            functions: (ledger?.functions || []).map((f) => ({
                event_date_id: f.event_date_id,
                date: f.date,
                start_time: f.start_time,
                release_status: f.release_status,
                releases_local: localDateTime(f.releases_at),
                checkins: f.checkins,
                checkin_ratio: f.checkin_ratio,
                attested: Boolean(f.attested_at),
                hold_reasons: f.hold_reasons.map((r) => r.label),
                reserve_amount: f.reserve_amount,
                reserve_release_local: localDateTime(f.reserve_release_at),
            })),
        };
    },
};

export const complianceTools: ToolDef[] = [attestFunctionHeld, getEventCompliance];
