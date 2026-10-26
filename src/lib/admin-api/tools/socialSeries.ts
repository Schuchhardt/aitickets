// Herramientas de admin: difusión automática en Instagram (docs/specs/historias-automaticas.md). Las acciones sobre
// una serie (preparar, aprobar, pausar…) son las del productor vía org_*_social_series; aquí, la vista de toda la
// plataforma y la configuración global de cadencia (bandas y horas).
import { fetchAll, localDateTime } from "../../producer-api/tools/common";
import type { JsonSchema } from "../../producer-api/registry";
import { DEFAULT_CADENCE, normalizeCadence, type CadenceConfig } from "../../socialSeriesCadence";
import { attributedSales, loadCadenceConfig, saveCadenceConfig, SERIES_TABLE, SLOTS_TABLE } from "../../socialSeries";
import type { AdminToolDef } from "../registry";
import { organizationIdSchema } from "./organizations";
import { orgNames } from "./analytics";

const STATUSES = ["draft", "active", "paused", "completed", "cancelled"] as const;

const listSocialSeries: AdminToolDef = {
    name: "list_social_series",
    title: "Difusiones automáticas (toda la plataforma)",
    description:
        "Series de historias automáticas en Instagram de todos los productores (o una organización): estado, evento, hora de publicación, piezas " +
        "publicadas, pendientes y fallidas (con el último error), avisos, DMs enviados y ventas atribuidas al DM. Por defecto las vivas " +
        "(borrador, activas y pausadas). Para el detalle de una usa org_get_social_series.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            statuses: { type: "array", items: { type: "string", enum: STATUSES }, minItems: 1, maxItems: STATUSES.length, description: "Por defecto draft, active y paused." },
            organization_id: organizationIdSchema,
            limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
        },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        const statuses: string[] = args.statuses?.length ? args.statuses : ["draft", "active", "paused"];
        const series = await fetchAll<any>(() => {
            let q = supabase.from(SERIES_TABLE).select("*").in("status", statuses);
            if (args.organization_id) q = q.eq("organization_id", args.organization_id);
            return q.order("id", { ascending: false });
        }, { max: 2000 }).catch(() => []);
        const top = series.slice(0, args.limit);
        const eventIds = [...new Set(top.map((s: any) => Number(s.event_id)))];
        const events = eventIds.length ? await fetchAll<any>(() => supabase.from("events").select("id, name, slug, start_date").in("id", eventIds).order("id", { ascending: true })) : [];
        const eventById = new Map(events.map((e: any) => [Number(e.id), e]));
        const names = await orgNames(supabase, top.map((s: any) => Number(s.organization_id)));
        const out = [];
        for (const s of top) {
            const slots = await fetchAll<any>(() => supabase.from(SLOTS_TABLE).select("status, error, publish_at, kind").eq("series_id", s.id).order("publish_at", { ascending: true })).catch(() => []);
            const count = (st: string) => slots.filter((x: any) => x.status === st).length;
            const lastFailed = [...slots].reverse().find((x: any) => x.status === "failed");
            const next = slots.find((x: any) => ["planned", "rendering", "queued"].includes(x.status));
            const ev = eventById.get(Number(s.event_id));
            out.push({
                series_id: Number(s.id),
                status: s.status,
                organization: { id: Number(s.organization_id), name: names.get(Number(s.organization_id)) || null },
                event: { id: Number(s.event_id), name: ev?.name ?? null, starts_local: localDateTime(s.anchor_starts_at || ev?.start_date) },
                created_via: s.created_via,
                approved_local: localDateTime(s.approved_at),
                publish_time: s.cadence_config?.publish_time || null,
                pieces: { published: count("published"), pending: count("planned") + count("rendering") + count("queued"), failed: count("failed"), skipped: count("skipped") },
                next_local: next ? localDateTime(next.publish_at) : null,
                last_error: lastFailed?.error || null,
                pause_reason: s.pause_reason || null,
                notice: s.notice || null,
                sold_out: Boolean(s.sold_out_at),
                dms_sent: s.dm_stats?.dms_sent ?? null,
                attributed_sales: s.approved_at ? await attributedSales(supabase, [Number(s.event_id)]) : null,
            });
        }
        return { total: series.length, returned: out.length, series: out };
    },
};

const timeSchema = (description: string): JsonSchema => ({ type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description });
const intSchema = (min: number, max: number, description: string): JsonSchema => ({ type: "integer", minimum: min, maximum: max, description });

const CONFIG_PROPS: Record<keyof CadenceConfig, JsonSchema> = {
    daily_from_days: intSchema(0, 30, `Desde cuántos días antes la historia es diaria (hoy ${DEFAULT_CADENCE.daily_from_days}).`),
    sparse_every_days: intSchema(1, 14, "Antes de la banda diaria: una historia cada N días."),
    sparse_start_days: intSchema(1, 60, "Primer día de la banda espaciada (debe ser mayor que daily_from_days)."),
    feed_posts_from_days: intSchema(0, 30, "Posts de feed desde D-N."),
    feed_posts_to_days: intSchema(0, 30, "Posts de feed hasta D-N."),
    default_time: timeSchema("Hora por defecto sin datos de visitas (HH:MM, Chile)."),
    event_day_time: timeSchema("Hora de la historia del día del evento."),
    min_hours_before_start: intSchema(1, 12, "La historia del día sale al menos estas horas antes del inicio."),
    peak_min_visits: intSchema(0, 100000, "Visitas mínimas para usar la hora pico."),
    lead_minutes: intSchema(30, 360, "Minutos antes de publicar en que se renderiza y programa en Zernio."),
    scarcity_threshold_pct: intSchema(1, 100, "\"Quedan N entradas\" bajo este % disponible."),
};

const updateSocialSeriesConfig: AdminToolDef = {
    name: "update_social_series_config",
    title: "Configurar cadencia de la difusión automática",
    description:
        "Cambia las bandas y horas globales de las historias automáticas (aitickets_platform_settings 'social_series_cadence'). Aplica a las series " +
        "que se aprueben o reanuden desde ahora: cada serie guarda la configuración con la que se planificó. Sin cambios, devuelve la configuración vigente.",
    readOnly: false,
    inputSchema: { type: "object", additionalProperties: false, properties: { ...CONFIG_PROPS } },
    audit: (args) => ({ summary: `Cadencia de la difusión automática: ${Object.keys(args).join(", ") || "sin cambios"}` }),
    async handler(args, actx) {
        const before = await loadCadenceConfig(actx.supabase);
        const changes = Object.fromEntries(Object.entries(args).filter(([k]) => k in CONFIG_PROPS));
        if (!Object.keys(changes).length) return { config: before, changed: [] };
        const after = normalizeCadence({ ...before, ...changes });
        await saveCadenceConfig(actx.supabase, after);
        const changed = Object.keys(after).filter((k) => (after as any)[k] !== (before as any)[k]);
        const ignored = Object.keys(changes).filter((k) => (after as any)[k] !== (changes as any)[k]);
        return {
            config: after,
            changed: changed.map((k) => ({ key: k, before: (before as any)[k], after: (after as any)[k] })),
            ...(ignored.length ? { adjusted: ignored.map((k) => `${k}: se ajustó a ${(after as any)[k]} (fuera de rango o incompatible)`) } : {}),
            note: "Las series activas siguen con la configuración con que se aprobaron; se aplica a las nuevas y a las que se reanuden.",
        };
    },
};

export const socialSeriesAdminTools: AdminToolDef[] = [listSocialSeries, updateSocialSeriesConfig];
