// Herramienta: editar fechas y horarios de las funciones de un evento (update_event_functions).
//
// Mismo efecto que guardar las funciones en el panel (/api/events/update): actualiza event_dates, recalcula
// events.start_date/end_date (refreshEventDenorm) y, si el evento está publicado, avisa a los asistentes con
// la misma descripción del cambio (describeScheduleChange) vía send-event-notification-background.
// Pide confirmación solo cuando el cambio afecta a asistentes (evento publicado con entradas vigentes).
// "repeat" crea las funciones de un patrón (jueves a domingo hasta tal fecha, src/lib/functionPattern.mjs) y
// copy_tickets_from_function_id copia las entradas de una función a cada función nueva (cada una con su cupo).
import { ToolError, type ToolDef, type ToolContext, type ConfirmationSummary } from "../registry";
import { eventIdSchema, loadOwnedEvent, DATE_PATTERN, TIME_PATTERN, descriptionDateWarning, eventDateFields, DATES_NOTE, eventUrls, TZ } from "./common";
import { refreshEventDenorm } from "../../../pages/api/_lib/events";
import { loadSchedule, describeScheduleChange, type Schedule } from "../../../pages/api/_lib/eventSchedule";
import { callInternalFunction, santiagoToDate } from "../../../pages/api/_lib/server-utils";
import { MAX_FUNCTIONS, WEEKDAYS, patternError, repeatDates } from "../../functionPattern.mjs";
import { loadTicketChain } from "../../../../netlify/lib/tickets.mjs";

const todayInChile = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

type ScheduleDate = Schedule["dates"][number];

const functionInput = {
    date: { type: "string" as const, pattern: DATE_PATTERN, description: "YYYY-MM-DD (hora de Chile)." },
    start_time: { type: "string" as const, pattern: TIME_PATTERN, description: "HH:MM (24h)." },
    end_time: { type: "string" as const, pattern: TIME_PATTERN, nullable: true, description: "HH:MM (24h). Puede ser después de medianoche. null = sin hora de término." },
};

const fmtLocal = (d: Date) =>
    new Intl.DateTimeFormat("es-CL", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

/** Cuenta entradas vigentes (no anuladas). status NULL cuenta como vigente. */
async function liveAttendees(ctx: ToolContext, filter: { eventId: number; ticketIds?: number[] }): Promise<number> {
    const head = { count: "exact" as const, head: true };
    let total = ctx.supabase.from("event_attendees").select("id", head).eq("event_id", filter.eventId);
    let cancelled = ctx.supabase.from("event_attendees").select("id", head).eq("event_id", filter.eventId).eq("status", "cancelled");
    if (filter.ticketIds) {
        if (!filter.ticketIds.length) return 0;
        total = total.in("event_ticket_id", filter.ticketIds);
        cancelled = cancelled.in("event_ticket_id", filter.ticketIds);
    }
    const [a, b] = await Promise.all([total, cancelled]);
    if (a.error) throw a.error;
    return Math.max(0, (a.count || 0) - (b.count || 0));
}

/**
 * Valida y simula el cambio sin escribir nada. Lo usan confirm (resumen) y handler (que vuelve a planificar
 * con el estado actual antes de aplicar).
 */
async function planScheduleChange(args: any, ctx: ToolContext) {
    const changes: any[] = args.changes || [];
    const additions: any[] = [...(args.add || [])];
    const removals: number[] = (args.remove || []).map(Number);
    const repeat = args.repeat || null;
    if (args.copy_tickets_from_function_id != null && !additions.length && !repeat) {
        throw new ToolError("invalid_input", "copy_tickets_from_function_id copia entradas a funciones nuevas: úsalo junto con add o repeat.");
    }
    if (!changes.length && !additions.length && !removals.length && !repeat) {
        throw new ToolError("invalid_input", "No enviaste cambios (changes, add, repeat o remove).");
    }

    const event = await loadOwnedEvent<any>(ctx, args.event_id, "id, name, slug, status, description, start_date, end_date");
    const before = await loadSchedule(Number(event.id), ctx.supabase);
    const byId = new Map(before.dates.map((d) => [Number(d.id), d]));

    // Funciones resultantes (simulación)
    const after: ScheduleDate[] = before.dates.map((d) => ({ ...d }));
    const touched = new Set<number>();
    for (const c of changes) {
        let id = c.function_id != null ? Number(c.function_id) : null;
        if (id === null) {
            if (before.dates.length !== 1) {
                throw new ToolError("invalid_input", `El evento tiene ${before.dates.length} funciones: indica function_id en cada cambio (get_event → functions[].id).`);
            }
            id = Number(before.dates[0].id);
        }
        if (!byId.has(id)) throw new ToolError("not_found", `La función ${id} no pertenece al evento ${event.id}. Usa get_event para ver sus funciones.`);
        if (touched.has(id)) throw new ToolError("invalid_input", `La función ${id} aparece dos veces en changes.`);
        if (removals.includes(id)) throw new ToolError("invalid_input", `La función ${id} está en changes y en remove a la vez.`);
        if (c.date === undefined && c.start_time === undefined && c.end_time === undefined) {
            throw new ToolError("invalid_input", `El cambio de la función ${id} no trae date, start_time ni end_time.`);
        }
        touched.add(id);
        const target = after.find((d) => Number(d.id) === id)!;
        if (c.date !== undefined) target.date = c.date;
        if (c.start_time !== undefined) target.start_time = c.start_time;
        if (c.end_time !== undefined) target.end_time = c.end_time || null;
    }

    for (const id of removals) {
        if (!byId.has(id)) throw new ToolError("not_found", `La función ${id} no pertenece al evento ${event.id}. Usa get_event para ver sus funciones.`);
    }
    // Una función con entradas vendidas propias no se elimina: sus asistentes quedarían sin función
    if (removals.length) {
        const { data: tickets, error } = await ctx.supabase.from("event_tickets").select("id, event_date_id").eq("event_id", event.id).in("event_date_id", removals);
        if (error) throw error;
        for (const id of removals) {
            const ticketIds = (tickets || []).filter((t: any) => Number(t.event_date_id) === id).map((t: any) => Number(t.id));
            const sold = await liveAttendees(ctx, { eventId: Number(event.id), ticketIds });
            if (sold > 0) {
                throw new ToolError(
                    "conflict",
                    `La función ${id} tiene ${sold} entrada(s) vigente(s) propias: no se puede eliminar. Cámbiale la fecha con changes, o anula/reembolsa esas entradas primero.`,
                );
            }
        }
    }
    const remaining = after.filter((d) => !removals.includes(Number(d.id)));

    // Las nuevas funciones van al mismo lugar que las existentes (cambiar de lugar se hace desde el panel)
    const locationId = before.dates[0]?.event_location_id ?? before.locations[0]?.id ?? null;
    if (additions.length && !locationId) throw new ToolError("conflict", "El evento no tiene un lugar asociado: agrégalo desde el panel antes de sumar funciones.");
    // Patrón: se omiten las fechas que ya tienen función a esa hora y las que ya pasaron
    let repeatSkipped = 0;
    if (repeat) {
        const pattern = { weekdays: repeat.weekdays, from: repeat.from || todayInChile(), until: repeat.until };
        const reason = patternError(pattern);
        if (reason) throw new ToolError("invalid_input", `repeat: ${reason}`);
        const taken = new Set([...remaining, ...additions].map((d: any) => `${d.date}|${String(d.start_time).slice(0, 5)}`));
        const now = Date.now();
        for (const date of repeatDates(pattern)) {
            const starts = santiagoToDate(date, repeat.start_time);
            if (taken.has(`${date}|${repeat.start_time}`) || (starts && starts.getTime() <= now)) {
                repeatSkipped += 1;
                continue;
            }
            additions.push({ date, start_time: repeat.start_time, end_time: repeat.end_time || null });
        }
        if (additions.length === 0 && !changes.length && !removals.length) {
            throw new ToolError("invalid_input", "El patrón no agrega funciones: todas sus fechas ya existen o ya pasaron.");
        }
    }

    const added: ScheduleDate[] = additions.map((a, i) => ({
        id: -(i + 1),
        date: a.date,
        start_time: a.start_time,
        end_time: a.end_time || null,
        event_location_id: locationId,
    }));
    const result = [...remaining, ...added];

    if (!result.length) throw new ToolError("invalid_input", "El evento debe quedar con al menos una función. Para suspenderlo usa cancel_event.");
    if (result.length > MAX_FUNCTIONS) {
        throw new ToolError(
            "invalid_input",
            `Quedarían ${result.length} funciones y el máximo es ${MAX_FUNCTIONS} por evento. No se creó nada: acorta el período o elige menos días.`,
        );
    }

    // Entradas a copiar en cada función nueva (cada una con su propio cupo). Las cortesías no se copian.
    let ticketTemplate: any[] = [];
    if (args.copy_tickets_from_function_id != null) {
        const sourceId = Number(args.copy_tickets_from_function_id);
        if (!byId.has(sourceId)) throw new ToolError("not_found", `La función ${sourceId} no pertenece al evento ${event.id}. Usa get_event para ver sus funciones.`);
        if (removals.includes(sourceId)) throw new ToolError("invalid_input", `No puedes copiar las entradas de la función ${sourceId} y eliminarla a la vez.`);
        const { data, error } = await ctx.supabase
            .from("event_tickets")
            .select("id, ticket_name, price, max_quantity, status, init_date, end_date, total_quantity")
            .eq("event_id", event.id)
            .eq("event_date_id", sourceId)
            .not("is_gift", "is", true)
            .order("id", { ascending: true });
        if (error) throw error;
        ticketTemplate = (data || []).filter((t: any) => t.status !== "unavailable");
        if (!ticketTemplate.length) {
            throw new ToolError(
                "invalid_input",
                `La función ${sourceId} no tiene entradas propias para copiar (las de "todas las funciones" no se copian). Crea primero sus entradas con create_ticket_type y function_id.`,
            );
        }
    }
    const seen = new Set<string>();
    for (const d of result) {
        const key = `${d.date}|${d.start_time}`;
        if (seen.has(key)) throw new ToolError("invalid_input", `Hay dos funciones el ${d.date} a las ${d.start_time}.`);
        seen.add(key);
    }
    // Las funciones nuevas o movidas no pueden quedar en el pasado
    const now = Date.now();
    for (const d of [...added, ...remaining.filter((d) => touched.has(Number(d.id)))]) {
        const starts = santiagoToDate(d.date, d.start_time);
        if (!starts) throw new ToolError("invalid_input", `Fecha u hora inválida: ${d.date} ${d.start_time}.`);
        if (starts.getTime() <= now) throw new ToolError("invalid_input", `${d.date} ${d.start_time} (hora de Chile) ya pasó. Las funciones deben quedar en el futuro.`);
    }

    const afterSchedule: Schedule = { ...before, dates: result };
    const change = describeScheduleChange(before, afterSchedule);
    const attendees = change && event.status === "published" ? await liveAttendees(ctx, { eventId: Number(event.id) }) : 0;
    const affectsAttendees = !!change && event.status === "published" && attendees > 0;
    const notify = affectsAttendees && args.notify_attendees !== false;
    const updates = remaining.filter((d) => touched.has(Number(d.id)));
    return { event, before, change, attendees, affectsAttendees, notify, updates, added, removals, repeatSkipped, ticketTemplate };
}

/** Copia las entradas modelo a cada función nueva, con las tandas encadenadas dentro de la misma función. */
async function copyTicketsToFunctions(ctx: ToolContext, eventId: number, template: any[], dateIds: number[]): Promise<number> {
    const chain: Map<number, number> = await loadTicketChain(ctx.supabase, eventId);
    let copied = 0;
    for (const dateId of dateIds) {
        const { data, error } = await ctx.supabase
            .from("event_tickets")
            .insert(
                template.map((t) => ({
                    event_id: eventId,
                    event_date_id: dateId,
                    ticket_name: t.ticket_name,
                    price: t.price,
                    max_quantity: t.max_quantity,
                    is_gift: false,
                    status: t.status,
                    init_date: t.init_date,
                    end_date: t.end_date,
                    total_quantity: t.total_quantity,
                })),
            )
            .select("id");
        if (error) throw error;
        // Mismo orden de inserción: la copia i corresponde a template[i]
        const copyOf = new Map(template.map((t, i) => [Number(t.id), Number(data?.[i]?.id)]));
        copied += data?.length || 0;
        for (const t of template) {
            const prev = chain.get(Number(t.id));
            const id = copyOf.get(Number(t.id));
            const prevCopy = prev != null ? copyOf.get(Number(prev)) : undefined;
            if (!id || !prevCopy) continue;
            const { error: chainErr } = await ctx.supabase.from("event_tickets").update({ opens_after_ticket_id: prevCopy }).eq("id", id).eq("event_id", eventId);
            if (chainErr) console.warn("update_event_functions: no se pudo copiar la tanda anterior:", chainErr.message);
        }
    }
    return copied;
}

const label = (d: { date: string; start_time: string; end_time: string | null }) => `${d.date} ${d.start_time}${d.end_time ? `–${d.end_time}` : ""}`;

const updateEventFunctions: ToolDef = {
    name: "update_event_functions",
    title: "Cambiar fechas y funciones",
    description:
        "Cambia la fecha y/u horario de las funciones de un evento, agrega funciones nuevas o elimina funciones sin entradas vendidas. " +
        "Las fechas del evento (start_date/end_date) se recalculan solas a partir de las funciones. Fechas en hora de Chile. " +
        "Usa get_event para ver functions[].id; si el evento tiene una sola función, function_id es opcional. " +
        "Las funciones nuevas usan el mismo lugar del evento (cambiar de lugar se hace en el panel). " +
        'Para muchas funciones usa repeat (p. ej. "jueves a domingo, 20:00, hasta el 30 de noviembre") y, si cada función debe tener ' +
        "su propio cupo, copy_tickets_from_function_id para copiarles las entradas de una función existente. " +
        "Si el evento está publicado y tiene entradas vigentes, el servidor devuelve primero un resumen (confirmation_required) y, al " +
        "confirmar, avisa por correo a los asistentes con el cambio (notify_attendees=false para no avisar). En borradores o eventos sin " +
        "asistentes se aplica directo. Después revisa los warnings: la descripción o los recordatorios programados pueden mencionar la fecha anterior.",
    scope: "write",
    audit: (args, result: any) => ({
        summary: `Cambió funciones: ${result.summary || "sin cambios"}${result.attendees_notification_queued ? " (avisó a asistentes)" : ""}`,
        target: `event:${args.event_id}`,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            changes: {
                type: "array",
                maxItems: MAX_FUNCTIONS,
                description: "Funciones existentes a modificar. Solo cambia los campos enviados.",
                items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        function_id: { type: "integer", minimum: 1, description: "functions[].id de get_event. Opcional si el evento tiene una sola función." },
                        ...functionInput,
                    },
                },
            },
            add: {
                type: "array",
                maxItems: MAX_FUNCTIONS,
                description: "Funciones nuevas (mismo lugar del evento).",
                items: { type: "object", required: ["date", "start_time"], additionalProperties: false, properties: functionInput },
            },
            repeat: {
                type: "object",
                required: ["weekdays", "until", "start_time"],
                additionalProperties: false,
                description:
                    'Crea de una vez las funciones de un patrón, p. ej. "jueves a domingo, 20:00, hasta el 30 de noviembre". ' +
                    "Se omiten las fechas que ya tienen función a esa hora y las que ya pasaron. Si el evento quedaría con más de " +
                    `${MAX_FUNCTIONS} funciones no se crea nada y responde el total: acórtalo y vuelve a intentar.`,
                properties: {
                    weekdays: {
                        type: "array",
                        minItems: 1,
                        maxItems: 7,
                        items: { type: "string", enum: WEEKDAYS.map((d) => d.key) },
                        description: "Días de la semana (sin tildes).",
                    },
                    from: { type: "string", pattern: DATE_PATTERN, description: "Primer día del período, YYYY-MM-DD. Por defecto, hoy." },
                    until: { type: "string", pattern: DATE_PATTERN, description: "Último día del período (incluido), YYYY-MM-DD." },
                    start_time: functionInput.start_time,
                    end_time: functionInput.end_time,
                },
            },
            copy_tickets_from_function_id: {
                type: "integer",
                minimum: 1,
                description:
                    "Copia los tipos de entrada propios de esta función (precio, cupo, ventana de venta y tandas encadenadas) a cada función " +
                    "nueva de add/repeat, para que cada función tenga su propio cupo. No copia cortesías ni entradas de \"todas las funciones\".",
            },
            remove: {
                type: "array",
                maxItems: MAX_FUNCTIONS,
                description: "IDs de funciones a eliminar. Solo si no tienen entradas vendidas propias; el evento debe quedar con al menos una.",
                items: { type: "integer", minimum: 1 },
            },
            notify_attendees: { type: "boolean", default: true, description: "Evento publicado con asistentes: avisarles por correo del cambio (recomendado)." },
            notify_message: { type: "string", maxLength: 1500, description: "Mensaje opcional del organizador que se agrega al aviso (p. ej. el motivo del cambio)." },
        },
    },
    async confirm(args, ctx): Promise<ConfirmationSummary | null> {
        const plan = await planScheduleChange(args, ctx);
        // Sin asistentes afectados (borrador, sin entradas o sin cambio real) no hay nada que confirmar
        if (!plan.affectsAttendees) return null;
        return {
            message:
                `Cambiar las funciones de "${plan.event.name}" (publicado, ${plan.attendees} entrada(s) vigente(s)).\n\n${plan.change!.description}\n\n` +
                (plan.notify
                    ? `Se enviará un correo a los asistentes avisando el cambio${args.notify_message ? " con tu mensaje" : ""}.`
                    : "NO se avisará a los asistentes (notify_attendees=false): avísales tú por otro canal."),
            details: {
                event_id: Number(plan.event.id),
                updated: plan.updates.map((d) => ({ function_id: Number(d.id), from: label(plan.before.dates.find((b) => Number(b.id) === Number(d.id))!), to: label(d) })),
                added: plan.added.map(label),
                ...(plan.ticketTemplate.length ? { tickets_to_copy: plan.ticketTemplate.map((t: any) => t.ticket_name), tickets_per_new_function: plan.ticketTemplate.length } : {}),
                removed: plan.removals,
                attendees: plan.attendees,
                notify_attendees: plan.notify,
            },
        };
    },
    async handler(args, ctx) {
        const plan = await planScheduleChange(args, ctx);
        // Entre el resumen y la confirmación pudo venderse la primera entrada: no aplicar un cambio que nadie confirmó
        if (plan.affectsAttendees && !ctx.confirmed) {
            throw new ToolError("conflict", "El evento ahora tiene asistentes afectados por este cambio. Llama de nuevo sin confirmation_token para ver el resumen y confirmarlo.");
        }
        const eventId = Number(plan.event.id);

        for (const d of plan.updates) {
            const { error } = await ctx.supabase
                .from("event_dates")
                .update({ date: d.date, start_time: d.start_time, end_time: d.end_time })
                .eq("id", d.id)
                .eq("event_id", eventId);
            if (error) throw error;
        }
        let newDates: Array<{ id: number }> = [];
        if (plan.added.length) {
            const { data, error } = await ctx.supabase
                .from("event_dates")
                .insert(plan.added.map((d) => ({ event_id: eventId, event_location_id: d.event_location_id, date: d.date, start_time: d.start_time, end_time: d.end_time })))
                .select("id");
            if (error) throw error;
            newDates = data || [];
        }
        const ticketsCopied = plan.ticketTemplate.length ? await copyTicketsToFunctions(ctx, eventId, plan.ticketTemplate, newDates.map((d) => Number(d.id))) : 0;
        if (plan.removals.length) {
            // event_tickets.event_date_id tiene ON DELETE SET NULL: sus entradas pasan a "todas las funciones"
            const { error } = await ctx.supabase.from("event_dates").delete().eq("event_id", eventId).in("id", plan.removals);
            if (error) throw error;
        }
        const range = await refreshEventDenorm(eventId);

        let notificationQueued = false;
        if (plan.notify && plan.change) {
            const extra = args.notify_message ? `\n\nMensaje del organizador: ${String(args.notify_message).trim()}` : "";
            const res = await callInternalFunction(ctx.requestUrl, "/.netlify/functions/send-event-notification-background", {
                eventId,
                changeType: plan.change.type,
                changeDescription: plan.change.description + extra,
                requestedBy: { type: "user", userId: ctx.actor.userId, organizationId: ctx.actor.orgId, via: ctx.channel },
            });
            notificationQueued = res.ok;
        }

        const after = await loadSchedule(eventId, ctx.supabase);
        const functions = after.dates
            .slice()
            .sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`))
            .map((d) => ({ id: Number(d.id), date: d.date, start_time: d.start_time, end_time: d.end_time }));

        const warnings: string[] = [];
        const descWarning = descriptionDateWarning(plan.event.description, functions.map((f) => f.date));
        if (descWarning) warnings.push(descWarning);
        const { data: scheduled } = await ctx.supabase.from("aitickets_scheduled_messages").select("id, status, send_at").eq("event_id", eventId).eq("status", "scheduled");
        if (scheduled?.length) {
            warnings.push(
                `Hay ${scheduled.length} mensaje(s) programado(s) (list_scheduled_messages) creados con la fecha anterior: revisa su texto y hora; ` +
                    "si corresponde, cancélalos (cancel_scheduled_message) y vuelve a programarlos (schedule_reminder).",
            );
        }
        const { data: windows } = await ctx.supabase.from("event_tickets").select("id, ticket_name, end_date").eq("event_id", eventId).not("end_date", "is", null);
        const lastEnd = range.end_date ? new Date(range.end_date).getTime() : null;
        const firstStart = range.start_date ? new Date(range.start_date).getTime() : null;
        for (const t of windows || []) {
            const salesEnd = new Date(t.end_date).getTime();
            if (firstStart && salesEnd < firstStart - 7 * 86400_000) {
                warnings.push(`La venta de "${t.ticket_name}" termina el ${fmtLocal(new Date(t.end_date))}, más de una semana antes del evento: revisa sales_end (update_ticket_type).`);
            } else if (lastEnd && salesEnd > lastEnd) {
                warnings.push(`La venta de "${t.ticket_name}" termina después del evento (${fmtLocal(new Date(t.end_date))}).`);
            }
        }
        if (plan.affectsAttendees && !plan.notify) warnings.push("No se avisó a los asistentes: comunícales el cambio (send_attendee_message).");
        if (plan.notify && !notificationQueued) warnings.push("El aviso por correo a los asistentes NO se pudo encolar: usa send_attendee_message para avisarles.");

        const summaryParts = [
            ...plan.updates.map((d) => `#${d.id} → ${label(d)}`),
            ...(plan.added.length ? [`+${plan.added.length} nueva(s)`] : []),
            ...(ticketsCopied ? [`${ticketsCopied} entrada(s) copiada(s)`] : []),
            ...(plan.removals.length ? [`-${plan.removals.length} eliminada(s)`] : []),
        ];
        return {
            event_id: eventId,
            summary: summaryParts.join(", "),
            ...eventDateFields(range),
            dates_note: DATES_NOTE,
            functions,
            ...(args.repeat ? { repeat_added: plan.added.length, repeat_skipped: plan.repeatSkipped } : {}),
            ...(plan.ticketTemplate.length ? { tickets_copied: ticketsCopied } : {}),
            change_detected: !!plan.change,
            attendees_affected: plan.affectsAttendees ? plan.attendees : 0,
            attendees_notification_queued: notificationQueued,
            ...eventUrls(ctx, plan.event),
            ...(warnings.length ? { warnings } : {}),
        };
    },
};

export const scheduleTools: ToolDef[] = [updateEventFunctions];
