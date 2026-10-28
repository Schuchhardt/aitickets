// Herramientas: difusión automática en Instagram (historias y posts hasta el día del evento, link por DM) y, si el
// productor las activa para el evento, Facebook y TikTok con la misma cadencia, más un reel con el video del evento. La lógica
// vive en src/lib/socialSeries.ts; estas herramientas las usan el MCP/REST de productores, la tarjeta "Difusión
// automática" del panel (/api/events/social-series) y el admin (org_*). Spec: docs/specs/historias-automaticas.md.
//
// Flujo: prepare_social_series (borrador, se puede llamar varias veces) → get_social_series (preview del calendario)
// → approve_social_series (confirmación: es público) → la plataforma publica sola. pause / resume / cancel.
import { ToolError, type ToolContext, type ToolDef } from "../registry";
import { eventDashboardUrl, eventIdSchema, eventPublicUrl, loadOwnedEvent, localDateTime } from "./common";
import { serverEnv } from "../../../pages/api/_lib/server-utils";
import * as S from "../../socialSeries";
import { EXTRA_NETWORKS, expandNetworkSlots, normalizeCadence, type SeriesPlatform } from "../../socialSeriesCadence";
import { pieceText } from "../../socialSeriesRender";
import { ZernioError, friendlyAdsError } from "../../../../netlify/lib/zernio-ads.mjs";

const KEYWORD_PATTERN = "^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]{2,30}$";

const actorOf = (ctx: ToolContext): S.Actor => ({ orgId: ctx.actor.orgId, userId: ctx.actor.userId, channel: ctx.channel, origin: ctx.origin });

async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (err: any) {
        if (err instanceof S.SeriesError) throw new ToolError(err.code, err.message);
        if (err instanceof ZernioError) throw new ToolError("upstream", `Instagram/Zernio: ${friendlyAdsError(err)}`);
        throw err;
    }
}

const STATUS_LABELS: Record<string, string> = {
    planned: "Programada",
    rendering: "Preparando",
    queued: "En cola para publicar",
    published: "Publicada",
    failed: "Falló",
    skipped: "Omitida",
};
const SERIES_STATUS_LABELS: Record<string, string> = { draft: "Sin activar (borrador)", active: "Activa", paused: "Pausada", completed: "Terminada", cancelled: "Cancelada" };

const KIND_LABELS: Record<string, string> = { story: "Historia", feed_post: "Post de feed", reel: "Reel" };
const kindLabel = (kind: string, platform = "instagram") => (platform === "tiktok" && kind === "feed_post" ? "Post de foto" : platform === "tiktok" && kind === "reel" ? "Video" : KIND_LABELS[kind] || kind);

const stageLabel = (kind: string, variant: string, days: number) => {
    const t = pieceText({ kind: kind === "feed_post" ? "feed_post" : "story", variant: variant === "sold_out" ? "sold_out" : "countdown", daysToEvent: days, eventName: "", dateLabel: "", startTime: null, venue: null, keyword: "", remaining: null, styleIndex: 0 });
    return t.bigLines.join(" ");
};

function presentSlot(s: any) {
    const platform = s.platform || "instagram";
    return {
        id: Number(s.id),
        platform,
        platform_label: S.NETWORK_NAMES[platform] || platform,
        kind: s.kind,
        kind_label: kindLabel(s.kind, platform),
        variant: s.variant,
        days_to_event: s.days_to_event,
        stage: stageLabel(s.kind, s.variant, s.days_to_event),
        publish_at: s.publish_at,
        publish_local: localDateTime(s.publish_at),
        status: s.status,
        status_label: STATUS_LABELS[s.status] || s.status,
        image_url: s.image_url || null,
        video_url: s.video_url || null,
        caption: s.caption || null,
        post_url: s.platform_post_url || null,
        error: s.error || null,
        skip_reason: s.skip_reason || null,
    };
}

function presentSeries(series: any) {
    return {
        id: Number(series.id),
        status: series.status,
        status_label: SERIES_STATUS_LABELS[series.status] || series.status,
        keyword: series.keyword,
        extra_keywords: series.extra_keywords || [],
        dm_message: series.dm_message || null,
        feed_posts_enabled: series.feed_posts_enabled,
        sold_out_story_enabled: series.sold_out_story_enabled,
        reel_enabled: series.reel_enabled !== false,
        networks: S.networkStates(series),
        base_image_url: series.base_image_url || null,
        publish_time: series.cadence_config?.publish_time || null,
        publish_time_source: series.cadence_config?.publish_time_source || null,
        anchor_starts_at: series.anchor_starts_at || null,
        anchor_local: localDateTime(series.anchor_starts_at),
        approved_at: series.approved_at || null,
        created_via: series.created_via || null,
        pause_reason: series.pause_reason || null,
        sold_out_at: series.sold_out_at || null,
        notice: series.notice || null,
        cancel_reason: series.cancel_reason || null,
    };
}

/** Estado completo de la difusión de un evento: la vista de get_social_series y de la tarjeta del panel. */
export async function seriesView(ctx: ToolContext, eventId: number, { refreshStats = true } = {}) {
    const supabase = ctx.supabase;
    const event = await S.loadSeriesEvent(supabase, eventId);
    if (!event) throw new ToolError("not_found", "Evento no encontrado.");
    const live = await S.loadLiveSeries(supabase, eventId);
    const series = live || (await S.loadLatestSeries(supabase, eventId));
    const [ig, fb, tt, blockers] = await Promise.all([
        S.instagramAccount(supabase, ctx.actor.orgId),
        S.socialAccount(supabase, ctx.actor.orgId, "facebook"),
        S.socialAccount(supabase, ctx.actor.orgId, "tiktok"),
        S.activationBlockers(supabase, event, ctx.actor.orgId, new Date(), live?.status === "draft" ? live : null),
    ]);
    const reelVideo = S.reelVideoFor(event);
    const states = S.networkStates(live || series);
    const config = series && series.status !== "draft" ? normalizeCadence(series.cadence_config) : await S.loadCadenceConfig(supabase);
    const draftLike = !series || series.status === "draft" || series.status === "cancelled" || series.status === "completed";

    let plan: any = null;
    if (draftLike && event.status === "published") {
        const p = await S.buildPlan(supabase, event, { feedPosts: live?.feed_posts_enabled ?? true, config });
        const labels = p.anchorStart ? S.eventLabels(event, p.anchorStart) : null;
        // Piezas por red si se aprueba ahora: Facebook y TikTok solo si están activadas y conectadas
        const platforms: SeriesPlatform[] = ["instagram", ...(states.facebook.enabled && fb ? ["facebook" as const] : []), ...(states.tiktok.enabled && tt ? ["tiktok" as const] : [])];
        const expanded = expandNetworkSlots(p.slots, { platforms, reel: Boolean(reelVideo) && (live?.reel_enabled ?? true), config });
        const per = (platform: string) => expanded.filter((x) => x.platform === platform && x.kind !== "reel").length;
        plan = {
            anchor_starts_at: p.anchorStart?.toISOString() || null,
            anchor_local: localDateTime(p.anchorStart),
            publish_time: p.publishTime.time,
            publish_time_source:
                p.publishTime.source === "peak"
                    ? `hora pico de visitas ${p.publishTime.scope === "organization" ? "de tus eventos" : "del evento"} (${p.publishTime.visits} visitas)`
                    : `hora por defecto (menos de ${config.peak_min_visits} visitas para calcular la hora pico)`,
            stories: p.slots.filter((s) => s.kind === "story").length,
            feed_posts: p.slots.filter((s) => s.kind === "feed_post").length,
            facebook_posts: per("facebook"),
            tiktok_posts: per("tiktok"),
            reels: expanded.filter((x) => x.kind === "reel").map((x) => ({ platform: x.platform, publish_local: localDateTime(x.publish_at) })),
            first_local: localDateTime(p.slots[0]?.publish_at),
            last_local: localDateTime(p.slots[p.slots.length - 1]?.publish_at),
            slots: p.slots.map((s) => ({
                kind: s.kind,
                kind_label: s.kind === "feed_post" ? "Post de feed" : "Historia",
                days_to_event: s.days_to_event,
                stage: stageLabel(s.kind, "countdown", s.days_to_event),
                publish_at: s.publish_at,
                publish_local: localDateTime(s.publish_at),
                ...(s.kind === "feed_post" ? { caption_example: `${S.fallbackCaption(event, s.days_to_event, p.anchorStart)}\n\nComenta ${live?.keyword || S.DEFAULT_KEYWORD} y te mandamos el link 📩` } : {}),
            })),
            event_label: labels ? `${labels.dateLabel} a las ${labels.startTime}${labels.venue ? ` · ${labels.venue}` : ""}` : null,
        };
    }

    const slots = series && series.status !== "draft" ? await S.loadSlots(supabase, series.id) : [];
    const shown = slots.filter((s) => s.status !== "skipped" || s.published_at);
    const counts: Record<string, number> = {};
    for (const s of slots) counts[s.status] = (counts[s.status] || 0) + 1;
    const next = slots.find((s) => ["planned", "rendering", "queued"].includes(s.status) && Date.parse(s.publish_at) > Date.now() - 30 * 60_000);
    const dms = series && !draftLike && refreshStats ? await S.refreshDmStats(supabase, series, slots).catch(() => series.dm_stats || null) : series?.dm_stats || null;
    const tickets = await S.ticketState(supabase, event, config).catch(() => null);
    const anchor = series?.anchor_starts_at ? new Date(series.anchor_starts_at) : S.anchorFor(event);
    const storyLink = S.dmTrackingUrl(ctx.origin, event.slug || "", S.DM_REFS.story);
    const baseImage = S.baseImageUrlFor(live, event);

    return {
        event: { id: Number(event.id), name: event.name, status: event.status, public_url: eventPublicUrl(ctx, event.slug) },
        enabled: S.socialSeriesEnabled(),
        instagram: ig ? { connected: true, account: ig.name } : { connected: false, connect_url: `${ctx.origin}/dashboard/promote` },
        networks: Object.fromEntries(
            EXTRA_NETWORKS.map((n) => {
                const acc = n === "facebook" ? fb : tt;
                return [n, { connected: Boolean(acc), account: acc?.name || null, enabled: states[n].enabled, status: states[n].status, error: states[n].error }];
            }),
        ),
        reel: {
            available: Boolean(reelVideo),
            enabled: (live || series)?.reel_enabled !== false,
            video_url: reelVideo?.url || null,
            note: reelVideo
                ? `Reel con el video del evento (${reelVideo.duration} s), unos días antes de la función.`
                : "Para el reel, sube un video vertical de 3 a 60 segundos como video de portada o de galería del evento.",
        },
        can_activate: blockers.length === 0 && (!live || live.status === "draft"),
        blockers,
        series: series ? presentSeries(series) : null,
        plan,
        slots: shown.map(presentSlot),
        slot_counts: counts,
        next_slot: next ? presentSlot(next) : null,
        dms: dms
            ? {
                  sent: dms.dms_sent ?? 0,
                  failed: dms.dms_failed ?? 0,
                  link_clicks: dms.link_clicks ?? 0,
                  unique_clicks: dms.unique_clicks ?? 0,
                  note: "Incluye las respuestas a historias de la cuenta (la automatización de historias es una por cuenta).",
              }
            : null,
        attributed_sales: await S.attributedSales(supabase, [Number(event.id)]),
        tickets: tickets ? { capacity: tickets.capacity, issued: tickets.issued, remaining: tickets.remaining, sold_out: tickets.soldOut } : null,
        dm_preview: S.dmMessageFor(live || series || {}, event, anchor, storyLink),
        base_image: {
            url: baseImage,
            source: live?.base_image_url ? "elegida para la serie" : event.image_url ? "portada del evento" : event.cover_video?.poster_url ? "fotograma del video de portada" : null,
        },
        tracking: {
            story_dm_ref: S.DM_REFS.story,
            post_dm_ref: S.DM_REFS.post,
            facebook_dm_ref: S.DM_REFS.facebook_post,
            facebook_link_ref: S.LINK_REFS.facebook,
            tiktok_link_ref: S.LINK_REFS.tiktok,
            note: "Las ventas aparecen como canales ig-story-dm, ig-post-dm, fb-post-dm, fb-serie y tiktok-serie en la analítica del evento.",
        },
        dashboard_url: eventDashboardUrl(ctx, Number(event.id)),
    };
}

const storageBase = () => serverEnv("SUPABASE_URL")?.replace(/\/+$/, "");

// ---------------------------------------------------------------------------

const getSocialSeries: ToolDef = {
    name: "get_social_series",
    title: "Ver difusión automática (historias)",
    description:
        "Estado de las historias y posts automáticos de un evento (Instagram y, si están activadas, Facebook y TikTok): si se puede activar (y qué falta), el calendario propuesto " +
        "(borrador) o las piezas programadas y publicadas con su estado, la próxima publicación, DMs enviados y clics, y ventas atribuidas a " +
        "los DM (ref ig-story-dm / ig-post-dm). Responde \"¿cómo va mi difusión?\".",
    scope: "read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        await loadOwnedEvent(ctx, args.event_id, "id");
        return guard(() => seriesView(ctx, args.event_id));
    },
};

const prepareSocialSeries: ToolDef = {
    name: "prepare_social_series",
    title: "Preparar difusión automática (borrador)",
    description:
        "Deja preparada (en borrador, sin publicar nada) la serie de historias automáticas de un evento: cadencia automática (cada 3 días, diaria la " +
        "última semana y el día del evento), posts de feed la última semana (feed_posts_enabled), palabra clave del DM (ENTRADAS por defecto), " +
        "mensaje del DM ({link} = link con seguimiento), foto base (por defecto la portada), si publica también en la página de Facebook " +
        "(facebook_enabled) y en TikTok (tiktok_enabled; foto vertical cada día de la última semana), y el reel con el video vertical del " +
        "evento (reel_enabled; 3 a 60 s). Devuelve el calendario para que el productor lo " +
        "revise; se activa con approve_social_series. Se puede llamar varias veces para ajustar el borrador.",
    scope: "write",
    audit: (args) => ({ summary: "Preparó la difusión automática (borrador)", target: `event:${args.event_id}` }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: {
            event_id: eventIdSchema,
            feed_posts_enabled: { type: "boolean", description: "Un post de feed diario la última semana (por defecto sí)." },
            sold_out_story_enabled: { type: "boolean", description: "Si se agota, publicar una historia \"Entradas agotadas, gracias\" (por defecto no)." },
            keyword: { type: "string", pattern: KEYWORD_PATTERN, description: "Palabra que la gente responde o comenta para recibir el link (por defecto ENTRADAS)." },
            extra_keywords: { type: "array", maxItems: 5, items: { type: "string", pattern: KEYWORD_PATTERN }, description: "Variantes que también activan el DM (por defecto entrada y link)." },
            dm_message: { type: "string", maxLength: 600, description: "Texto del DM. {link} se reemplaza por el link con seguimiento (si no está, va al final). Vacío = mensaje por defecto." },
            base_image_url: { type: "string", maxLength: 2000, pattern: "^(https://.*)?$", description: "Foto base (de upload_image). Vacío = la portada del evento." },
            facebook_enabled: { type: "boolean", description: "Publicar también las historias y posts en la página de Facebook conectada (por defecto no)." },
            tiktok_enabled: { type: "boolean", description: "Publicar también en TikTok: un post de foto vertical cada día de la última semana (por defecto no)." },
            reel_enabled: { type: "boolean", description: "Si el evento tiene un video vertical de 3 a 60 s, publicarlo como reel unos días antes (por defecto sí)." },
        },
    },
    async handler(args, ctx) {
        await loadOwnedEvent(ctx, args.event_id, "id");
        if (args.base_image_url) {
            const base = storageBase();
            if (base && !String(args.base_image_url).startsWith(`${base}/storage/v1/object/public/`)) {
                throw new ToolError("invalid_input", "La foto base debe estar alojada en AI Tickets: súbela antes con upload_image.");
            }
        }
        return guard(async () => {
            await S.prepareSeries(ctx.supabase, actorOf(ctx), args.event_id, {
                feed_posts_enabled: args.feed_posts_enabled,
                sold_out_story_enabled: args.sold_out_story_enabled,
                keyword: args.keyword,
                extra_keywords: args.extra_keywords,
                dm_message: args.dm_message === undefined ? undefined : args.dm_message || null,
                base_image_url: args.base_image_url === undefined ? undefined : args.base_image_url || null,
                facebook_enabled: args.facebook_enabled,
                tiktok_enabled: args.tiktok_enabled,
                reel_enabled: args.reel_enabled,
            });
            return {
                ...(await seriesView(ctx, args.event_id, { refreshStats: false })),
                next_steps: "Muestra el calendario al productor. Si lo aprueba, llama approve_social_series (pide confirmación: publica en sus redes).",
            };
        });
    },
};


const approveSocialSeries: ToolDef = {
    name: "approve_social_series",
    title: "Aprobar y programar difusión automática",
    description:
        "Aprueba la serie (aprobación única): desde aquí AI Tickets publica sola las historias (y los posts de feed) en el Instagram de la " +
        "organización (y en Facebook y TikTok si se activaron) hasta el día del evento y responde por DM con el link a quien responda o comente la palabra clave. Acción pública: el " +
        "servidor devuelve primero el resumen y solo activa al repetir la llamada con confirmation_token.",
    scope: "publish",
    async confirm(args, ctx) {
        await loadOwnedEvent(ctx, args.event_id, "id");
        return guard(async () => {
            const view = await seriesView(ctx, args.event_id, { refreshStats: false });
            if (!view.can_activate) throw new ToolError("invalid_input", view.blockers.join(" ") || "La difusión de este evento ya está activa.");
            const plan = view.plan;
            if (!plan?.slots?.length) throw new ToolError("invalid_input", "No quedan horarios para publicar antes del evento.");
            const series = view.series;
            const extra = [
                plan.facebook_posts ? `Facebook (${view.networks.facebook.account || "página conectada"}): ${plan.facebook_posts} pieza(s)` : null,
                plan.tiktok_posts ? `TikTok (${view.networks.tiktok.account || "cuenta conectada"}): ${plan.tiktok_posts} post(s) de foto` : null,
                plan.reels.length ? `reel con el video del evento el ${plan.reels[0].publish_local?.replace("T", " ")} en ${plan.reels.map((r: any) => S.NETWORK_NAMES[r.platform]).join(", ")}` : null,
            ].filter(Boolean);
            return {
                message:
                    `Activar la difusión automática de "${view.event.name}" en Instagram (${view.instagram.connected ? (view.instagram as any).account || "cuenta conectada" : "sin cuenta"}): ` +
                    `${plan.stories} historia(s)${plan.feed_posts ? ` y ${plan.feed_posts} post(s) de feed` : ""} entre el ${plan.first_local?.replace("T", " ")} y el ${plan.last_local?.replace("T", " ")} ` +
                    `(hora de Chile), con DM automático a quien responda o comente ${series?.keyword || S.DEFAULT_KEYWORD}.` +
                    `${extra.length ? ` Además: ${extra.join("; ")}.` : ""} Se publican solas, sin otra aprobación.`,
                details: {
                    event_id: view.event.id,
                    publish_time: plan.publish_time,
                    publish_time_source: plan.publish_time_source,
                    slots: plan.slots.slice(0, 30).map((s: any) => `${s.publish_local?.replace("T", " ")} · ${s.kind_label} · ${s.stage}`),
                    dm_preview: view.dm_preview,
                },
                warnings: [
                    !view.base_image.url ? "El evento no tiene portada ni foto base: las piezas usarán un fondo liso. Sube una foto para que se vean mejor." : null,
                    "Instagram no permite stickers de link por API: el link va por DM a quien responda la historia.",
                    plan.tiktok_posts ? "En TikTok se publica como contenido de tu marca, público y con comentarios activos; el link va en la descripción (TikTok no lo hace clickeable)." : null,
                ].filter(Boolean) as string[],
            };
        });
    },
    audit: (args) => ({ summary: "Aprobó la difusión automática en redes", target: `event:${args.event_id}` }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        await loadOwnedEvent(ctx, args.event_id, "id");
        return guard(async () => {
            await S.approveSeries(ctx.supabase, actorOf(ctx), args.event_id);
            return { result: "approved", ...(await seriesView(ctx, args.event_id, { refreshStats: false })) };
        });
    },
};

async function liveSeriesOf(ctx: ToolContext, eventId: number) {
    await loadOwnedEvent(ctx, eventId, "id");
    const series = await S.loadLiveSeries(ctx.supabase, eventId);
    if (!series) throw new ToolError("not_found", "Este evento no tiene difusión automática. Prepárala con prepare_social_series.");
    return series;
}

const pauseSocialSeries: ToolDef = {
    name: "pause_social_series",
    title: "Pausar difusión automática",
    description: "Pausa las historias automáticas: no se publica nada hasta reanudar (resume_social_series recalcula desde hoy). El DM sigue respondiendo.",
    scope: "publish",
    audit: (args) => ({ summary: "Pausó la difusión automática", target: `event:${args.event_id}` }),
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        const series = await liveSeriesOf(ctx, args.event_id);
        return guard(async () => {
            await S.pauseSeries(ctx.supabase, series, "producer", ctx.origin);
            return { result: "paused", ...(await seriesView(ctx, args.event_id, { refreshStats: false })) };
        });
    },
};

const resumeSocialSeries: ToolDef = {
    name: "resume_social_series",
    title: "Reanudar difusión automática",
    description: "Reanuda una difusión pausada recalculando las publicaciones desde hoy (lo que no salió mientras estaba pausada no se publica tarde). Pide confirmación.",
    scope: "publish",
    async confirm(args, ctx) {
        const series = await liveSeriesOf(ctx, args.event_id);
        if (series.status !== "paused") throw new ToolError("conflict", "La difusión no está pausada.");
        return { message: `Reanudar la difusión automática del evento ${args.event_id}: se recalculan las publicaciones desde hoy y vuelven a salir solas en tus redes.` };
    },
    audit: (args) => ({ summary: "Reanudó la difusión automática", target: `event:${args.event_id}` }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: { type: "object", required: ["event_id"], additionalProperties: false, properties: { event_id: eventIdSchema } },
    async handler(args, ctx) {
        const series = await liveSeriesOf(ctx, args.event_id);
        return guard(async () => {
            await S.resumeSeries(ctx.supabase, series, ctx.origin);
            return { result: "resumed", ...(await seriesView(ctx, args.event_id, { refreshStats: false })) };
        });
    },
};

const cancelSocialSeries: ToolDef = {
    name: "cancel_social_series",
    title: "Cancelar difusión automática",
    description: "Cancela la difusión: borra lo programado en Instagram, Facebook y TikTok y desactiva el DM automático. Lo ya publicado no se borra. Pide confirmación.",
    scope: "publish",
    async confirm(args, ctx) {
        const series = await liveSeriesOf(ctx, args.event_id);
        return {
            message:
                series.status === "draft"
                    ? `Descartar el borrador de la difusión automática del evento ${args.event_id}.`
                    : `Cancelar la difusión automática del evento ${args.event_id}: se borra lo programado y se desactiva el DM automático. Lo ya publicado queda.`,
        };
    },
    audit: (args) => ({ summary: "Canceló la difusión automática", target: `event:${args.event_id}` }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["event_id"],
        additionalProperties: false,
        properties: { event_id: eventIdSchema, reason: { type: "string", maxLength: 200, description: "Motivo (opcional, para el historial)." } },
    },
    async handler(args, ctx) {
        const series = await liveSeriesOf(ctx, args.event_id);
        return guard(async () => {
            await S.cancelSeries(ctx.supabase, series, args.reason || `cancelada por ${ctx.actor.name || "el productor"}`, ctx.origin);
            return { result: "cancelled", ...(await seriesView(ctx, args.event_id, { refreshStats: false })) };
        });
    },
};

export const socialSeriesTools: ToolDef[] = [getSocialSeries, prepareSocialSeries, approveSocialSeries, pauseSocialSeries, resumeSocialSeries, cancelSocialSeries];
