// Herramientas de admin del blog SEO automatizado (docs/specs/blog-seo.md): estado y configuración, temas (clusters
// y su cuota), keywords con sus métricas de Search Console / Keyword Planner, artículos, corridas y disparo manual.
// El motor vive en netlify/lib/blog; aquí solo se lee la base y se dispara la background function blog-background.
import type { JsonSchema } from "../../producer-api/registry";
import { ToolError } from "../../producer-api/registry";
import type { AdminToolDef } from "../registry";
import { blogSetup } from "../../../../netlify/lib/blog/config.mjs";
import { plannedTasks, RUNS_TABLE, BLOG_TASKS } from "../../../../netlify/lib/blog/runner.mjs";
import { KEYWORDS_TABLE, TOPICS_TABLE } from "../../../../netlify/lib/blog/keywords.mjs";
import { POSTS_TABLE } from "../../../../netlify/lib/blog/posts.mjs";
import { afterBlogChange } from "../../../../netlify/lib/blog/publish.mjs";
import { signBlogPreview } from "../../../../netlify/lib/blog/preview-token.mjs";
import { countWords, normalizeKeyword } from "../../../../netlify/lib/blog/text.mjs";
import { functionsOrigin, triggerBackground } from "../../../../netlify/lib/outreach/background.mjs";

const POST_STATUSES = ["draft", "published", "archived"] as const;
const KEYWORD_STATUSES = ["new", "queued", "used", "rejected"] as const;
const slugSchema: JsonSchema = { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$", maxLength: 60, description: "slug del tema (list_blog_topics)." };
const n = (v: unknown) => (v == null ? null : Number(v));

const postUrl = (origin: string, slug: string) => `${origin}/blog/${slug}`;
const previewUrl = (origin: string, id: number) => {
    const t = signBlogPreview(id);
    return t ? `${origin}/blog/vista-previa/${id}?t=${encodeURIComponent(t)}` : null;
};

async function topicsBySlug(supabase: any) {
    const { data, error } = await supabase.from(TOPICS_TABLE).select("*").order("id");
    if (error) throw new ToolError("unavailable", `El blog no está instalado en esta base (${error.message}): falta aplicar 202611090200_blog.sql.`);
    return new Map<string, any>((data || []).map((t: any) => [t.slug, t]));
}

async function topicIdFor(supabase: any, slug?: string | null): Promise<number | null> {
    if (!slug) return null;
    const topic = (await topicsBySlug(supabase)).get(slug);
    if (!topic) throw new ToolError("not_found", `No existe el tema "${slug}". Revisa list_blog_topics.`);
    return Number(topic.id);
}

async function countBy(supabase: any, table: string, column: string, values: readonly string[]) {
    const out: Record<string, number> = {};
    for (const v of values) {
        const { count } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(column, v);
        out[v] = count || 0;
    }
    return out;
}

const getBlogOverview: AdminToolDef = {
    name: "get_blog_overview",
    title: "Blog SEO: estado general",
    description:
        "Estado del blog automatizado: qué integraciones están configuradas (Claude, Search Console, Keyword Planner, IndexNow) y qué falta, " +
        "si la función diaria está activa (BLOG_ENABLED), cuántos artículos y keywords hay por estado, la última corrida de cada tarea, " +
        "qué haría hoy la corrida automática, las mejores keywords pendientes y los artículos con más clics. Empieza por aquí.",
    readOnly: true,
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    async handler(_args, actx) {
        const { supabase, origin } = actx;
        await topicsBySlug(supabase);
        const [posts, keywords, planned] = await Promise.all([
            countBy(supabase, POSTS_TABLE, "status", POST_STATUSES),
            countBy(supabase, KEYWORDS_TABLE, "status", KEYWORD_STATUSES),
            plannedTasks(supabase),
        ]);
        const lastRuns: Record<string, unknown> = {};
        for (const task of BLOG_TASKS) {
            const { data } = await supabase.from(RUNS_TABLE).select("id, status, started_at, error, details").eq("task", task).order("started_at", { ascending: false }).limit(1);
            const r = data?.[0];
            lastRuns[task] = r ? { run_id: Number(r.id), status: r.status, started_at: r.started_at, error: r.error, cost_usd: r.details?.cost?.usd ?? null } : null;
        }
        const { data: topKeywords } = await supabase.from(KEYWORDS_TABLE).select("id, keyword, score, status, planner_searches, gsc_impressions, gsc_position").in("status", ["queued", "new"]).order("status", { ascending: false }).order("score", { ascending: false }).limit(10);
        const { data: topPosts } = await supabase.from(POSTS_TABLE).select("id, slug, title, gsc_clicks, gsc_impressions, gsc_position").eq("status", "published").order("gsc_clicks", { ascending: false, nullsFirst: false }).limit(5);
        return {
            setup: blogSetup(),
            posts,
            keywords,
            last_runs: lastRuns,
            planned_today: planned,
            next_keywords: (topKeywords || []).map((k: any) => ({ ...k, id: Number(k.id), score: n(k.score), gsc_position: n(k.gsc_position) })),
            top_posts: (topPosts || []).map((p: any) => ({ id: Number(p.id), title: p.title, url: postUrl(origin, p.slug), clicks_28d: p.gsc_clicks, impressions_28d: p.gsc_impressions, position: n(p.gsc_position) })),
        };
    },
};

const listBlogTopics: AdminToolDef = {
    name: "list_blog_topics",
    title: "Blog SEO: temas",
    description:
        "Temas del blog (clusters): por nicho (tipo de evento) o por funcionalidad, con su peso (cuota de artículos), semillas para buscar " +
        "keywords, la landing a la que lleva el cierre y cuántos artículos y keywords pendientes tiene cada uno.",
    readOnly: true,
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    async handler(_args, actx) {
        const { supabase } = actx;
        const topics = [...(await topicsBySlug(supabase)).values()];
        const totalWeight = topics.filter((t) => t.active).reduce((s, t) => s + t.weight, 0) || 1;
        const out = [];
        for (const t of topics) {
            const [{ count: published }, { count: drafts }, { count: pending }] = await Promise.all([
                supabase.from(POSTS_TABLE).select("id", { count: "exact", head: true }).eq("topic_id", t.id).eq("status", "published"),
                supabase.from(POSTS_TABLE).select("id", { count: "exact", head: true }).eq("topic_id", t.id).eq("status", "draft"),
                supabase.from(KEYWORDS_TABLE).select("id", { count: "exact", head: true }).eq("topic_id", t.id).in("status", ["new", "queued"]),
            ]);
            out.push({
                slug: t.slug,
                kind: t.kind,
                name: t.name,
                active: t.active,
                weight: t.weight,
                share_pct: t.active ? Math.round((t.weight / totalWeight) * 1000) / 10 : 0,
                landing_path: t.landing_path,
                description: t.description,
                seed_keywords: t.seed_keywords,
                posts_published: published || 0,
                posts_draft: drafts || 0,
                keywords_pending: pending || 0,
            });
        }
        return { topics: out };
    },
};

const upsertBlogTopic: AdminToolDef = {
    name: "upsert_blog_topic",
    title: "Blog SEO: crear o editar un tema",
    description:
        "Crea un tema (requiere slug, kind y name) o cambia uno existente por su slug: nombre, descripción (intro del hub /blog/tema/<slug>), " +
        "landing del cierre, semillas (búsquedas informativas que se expanden con Keyword Planner y el autocompletado), peso (cuota relativa " +
        "de artículos; 0 = no se escriben nuevos) y activo. Las semillas nuevas se usan en la próxima corrida de keywords.",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["slug"],
        properties: {
            slug: slugSchema,
            kind: { type: "string", enum: ["niche", "feature"] },
            name: { type: "string", minLength: 2, maxLength: 80 },
            description: { type: "string", maxLength: 600 },
            landing_path: { type: "string", pattern: "^/[a-z0-9/-]*$", maxLength: 120 },
            seed_keywords: { type: "array", items: { type: "string", minLength: 3, maxLength: 120 }, maxItems: 20 },
            weight: { type: "integer", minimum: 0, maximum: 100 },
            active: { type: "boolean" },
        },
    },
    audit: (args) => ({ summary: `Tema del blog ${args.slug}: ${Object.keys(args).filter((k) => k !== "slug" && k !== "reason").join(", ") || "sin cambios"}` }),
    async handler(args, actx) {
        const { supabase } = actx;
        const existing = (await topicsBySlug(supabase)).get(args.slug);
        const fields = ["kind", "name", "description", "landing_path", "seed_keywords", "weight", "active"] as const;
        const patch: Record<string, unknown> = {};
        for (const f of fields) if (args[f] !== undefined) patch[f] = args[f];
        if (patch.seed_keywords) patch.seed_keywords = [...new Set((patch.seed_keywords as string[]).map((s) => s.trim()).filter(Boolean))];
        if (!existing) {
            if (!args.kind || !args.name) throw new ToolError("invalid_input", "Para crear un tema nuevo indica kind y name.");
            const { data, error } = await supabase.from(TOPICS_TABLE).insert({ slug: args.slug, ...patch }).select("*").single();
            if (error) throw new ToolError("invalid_input", error.message);
            return { created: true, topic: data };
        }
        if (!Object.keys(patch).length) return { created: false, changed: [], topic: existing };
        const { data, error } = await supabase.from(TOPICS_TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", existing.id).select("*").single();
        if (error) throw new ToolError("invalid_input", error.message);
        return { created: false, changed: Object.keys(patch), topic: data };
    },
};

const listBlogKeywords: AdminToolDef = {
    name: "list_blog_keywords",
    title: "Blog SEO: keywords",
    description:
        "Keywords candidatas con sus métricas: búsquedas mensuales y competencia en Chile (Keyword Planner), impresiones, clics y posición de los " +
        "últimos 28 días (Search Console) y la página que hoy rankea, intención y relevancia (IA), score (0-100) y estado: new (candidata), " +
        "queued (priorizada a mano: se escribe antes que todo), used (ya tiene artículo) o rejected (con el motivo). Por defecto las pendientes por score.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            topic_slug: slugSchema,
            statuses: { type: "array", items: { type: "string", enum: KEYWORD_STATUSES }, minItems: 1, maxItems: 4, description: "Por defecto queued y new." },
            query: { type: "string", minLength: 2, maxLength: 80, description: "Texto que debe contener la keyword." },
            min_score: { type: "number", minimum: 0, maximum: 100 },
            striking_distance: { type: "boolean", description: "Solo las que Search Console ya muestra entre las posiciones 4 y 30." },
            sort: { type: "string", enum: ["score", "searches", "impressions", "recent"], default: "score" },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
    },
    async handler(args, actx) {
        const { supabase } = actx;
        const topics = await topicsBySlug(supabase);
        const topicNames = new Map([...topics.values()].map((t: any) => [Number(t.id), t.slug]));
        let q = supabase.from(KEYWORDS_TABLE).select("*").in("status", args.statuses?.length ? args.statuses : ["queued", "new"]);
        if (args.topic_slug) q = q.eq("topic_id", await topicIdFor(supabase, args.topic_slug));
        if (args.query) q = q.ilike("normalized", `%${normalizeKeyword(args.query).replace(/[%_]/g, "")}%`);
        if (args.min_score != null) q = q.gte("score", args.min_score);
        if (args.striking_distance) q = q.gte("gsc_position", 4).lte("gsc_position", 30);
        const order: Record<string, [string, boolean]> = { score: ["score", false], searches: ["planner_searches", false], impressions: ["gsc_impressions", false], recent: ["created_at", false] };
        const [col, asc] = order[args.sort || "score"];
        const { data, error } = await q.order(col, { ascending: asc, nullsFirst: false }).limit(args.limit || 50);
        if (error) throw new ToolError("internal", error.message);
        return {
            keywords: (data || []).map((k: any) => ({
                id: Number(k.id),
                keyword: k.keyword,
                topic: k.topic_id ? topicNames.get(Number(k.topic_id)) || null : null,
                status: k.status,
                score: n(k.score),
                intent: k.intent,
                relevance: k.relevance,
                planner: k.planner_searches != null ? { searches: k.planner_searches, competition: k.planner_competition } : null,
                search_console: k.gsc_impressions != null ? { impressions: k.gsc_impressions, clicks: k.gsc_clicks, position: n(k.gsc_position), page: k.gsc_page } : null,
                sources: k.sources,
                note: k.note,
                post_id: n(k.post_id),
            })),
        };
    },
};

const upsertBlogKeywords: AdminToolDef = {
    name: "upsert_blog_keywords",
    title: "Blog SEO: agregar o priorizar keywords",
    description:
        "Agrega keywords a mano o cambia el estado de las existentes: queued = escribir pronto (el generador toma primero las queued), " +
        "new = candidata normal, rejected = no escribir (con note). Las nuevas se clasifican con IA en la próxima corrida de keywords; " +
        "con topic_slug quedan en ese tema. No se puede marcar used a mano.",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["keywords", "status"],
        properties: {
            keywords: { type: "array", items: { type: "string", minLength: 3, maxLength: 120 }, minItems: 1, maxItems: 50 },
            status: { type: "string", enum: ["queued", "new", "rejected"] },
            topic_slug: slugSchema,
            note: { type: "string", maxLength: 300 },
        },
    },
    audit: (args) => ({ summary: `Keywords del blog → ${args.status}: ${args.keywords.slice(0, 5).join(", ")}${args.keywords.length > 5 ? "…" : ""}` }),
    async handler(args, actx) {
        const { supabase } = actx;
        const topicId = await topicIdFor(supabase, args.topic_slug);
        const byNorm = new Map<string, string>();
        for (const k of args.keywords as string[]) {
            const norm = normalizeKeyword(k);
            if (norm.length >= 3) byNorm.set(norm, k.trim().replace(/\s+/g, " "));
        }
        const { data: existing } = await supabase.from(KEYWORDS_TABLE).select("id, normalized, status").in("normalized", [...byNorm.keys()]);
        const found = new Map((existing || []).map((r: any) => [r.normalized, r]));
        const now = new Date().toISOString();
        const created: string[] = [];
        const updated: string[] = [];
        const skipped: string[] = [];
        for (const [norm, keyword] of byNorm) {
            const prev: any = found.get(norm);
            if (prev?.status === "used") {
                skipped.push(`${keyword}: ya tiene artículo`);
                continue;
            }
            const patch = { status: args.status, note: args.note ?? (args.status === "rejected" ? "Descartada a mano" : null), updated_at: now, ...(topicId ? { topic_id: topicId } : {}) };
            const { error } = prev
                ? await supabase.from(KEYWORDS_TABLE).update(patch).eq("id", prev.id)
                : await supabase.from(KEYWORDS_TABLE).insert({ keyword, normalized: norm, sources: ["manual"], ...patch });
            if (error) skipped.push(`${keyword}: ${error.message}`);
            else (prev ? updated : created).push(keyword);
        }
        return { created, updated, skipped };
    },
};

function presentPost(p: any, origin: string, topics: Map<number, string>) {
    return {
        id: Number(p.id),
        slug: p.slug,
        status: p.status,
        title: p.title,
        topic: p.topic_id ? topics.get(Number(p.topic_id)) || null : null,
        primary_keyword: p.primary_keyword,
        url: p.status === "published" ? postUrl(origin, p.slug) : null,
        preview_url: p.status !== "published" ? previewUrl(origin, Number(p.id)) : null,
        words: p.word_count,
        published_at: p.published_at,
        content_updated_at: p.content_updated_at,
        refresh_count: p.refresh_count,
        quality_ok: p.quality?.ok ?? null,
        quality_errors: (p.quality?.issues || []).filter((i: any) => i.level === "error").map((i: any) => i.message),
        search_console_28d: p.gsc_updated_at
            ? { impressions: p.gsc_impressions, clicks: p.gsc_clicks, ctr: n(p.gsc_ctr), position: n(p.gsc_position), as_of: p.gsc_updated_at }
            : null,
    };
}

const topicSlugsById = async (supabase: any) => new Map<number, string>([...(await topicsBySlug(supabase)).values()].map((t: any) => [Number(t.id), t.slug]));

const listBlogPosts: AdminToolDef = {
    name: "list_blog_posts",
    title: "Blog SEO: artículos",
    description:
        "Artículos del blog con URL (o link de vista previa firmado si es borrador), keyword principal, calidad (errores que impidieron publicarlo " +
        "solo) y métricas de Search Console de los últimos 28 días: impresiones, clics, CTR y posición.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            statuses: { type: "array", items: { type: "string", enum: POST_STATUSES }, minItems: 1, maxItems: 3 },
            topic_slug: slugSchema,
            sort: { type: "string", enum: ["recent", "clicks", "impressions"], default: "recent" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
        },
    },
    async handler(args, actx) {
        const { supabase, origin } = actx;
        const topics = await topicSlugsById(supabase);
        let q = supabase
            .from(POSTS_TABLE)
            .select("id, slug, status, title, topic_id, primary_keyword, word_count, published_at, content_updated_at, refresh_count, quality, gsc_impressions, gsc_clicks, gsc_ctr, gsc_position, gsc_updated_at");
        if (args.statuses?.length) q = q.in("status", args.statuses);
        if (args.topic_slug) q = q.eq("topic_id", await topicIdFor(supabase, args.topic_slug));
        const col = args.sort === "clicks" ? "gsc_clicks" : args.sort === "impressions" ? "gsc_impressions" : "created_at";
        const { data, error } = await q.order(col, { ascending: false, nullsFirst: false }).limit(args.limit || 30);
        if (error) throw new ToolError("internal", error.message);
        return { posts: (data || []).map((p: any) => presentPost(p, origin, topics)) };
    },
};

const postIdSchema: JsonSchema = { type: "integer", minimum: 1, description: "id del artículo (list_blog_posts)." };

const getBlogPost: AdminToolDef = {
    name: "get_blog_post",
    title: "Blog SEO: detalle de un artículo",
    description:
        "Un artículo completo: Markdown, preguntas frecuentes, fuentes, keywords, el detalle de calidad, el plan con que se escribió y su costo, " +
        "los refrescos, y las consultas de Search Console que lo traen (para decidir qué mejorar). Incluye el link de vista previa si no está publicado.",
    readOnly: true,
    inputSchema: { type: "object", additionalProperties: false, required: ["post_id"], properties: { post_id: postIdSchema } },
    async handler(args, actx) {
        const { supabase, origin } = actx;
        const { data: p, error } = await supabase.from(POSTS_TABLE).select("*").eq("id", args.post_id).maybeSingle();
        if (error) throw new ToolError("internal", error.message);
        if (!p) throw new ToolError("not_found", `No existe el artículo ${args.post_id}.`);
        const topics = await topicSlugsById(supabase);
        const { data: keywords } = await supabase.from(KEYWORDS_TABLE).select("id, keyword, score").eq("post_id", p.id).limit(50);
        return {
            ...presentPost(p, origin, topics),
            meta_title: p.meta_title,
            description: p.description,
            excerpt: p.excerpt,
            body_md: p.body_md,
            faq: p.faq,
            sources: p.sources,
            secondary_keywords: p.secondary_keywords,
            keywords_covered: (keywords || []).map((k: any) => ({ id: Number(k.id), keyword: k.keyword, score: n(k.score) })),
            quality: p.quality,
            generation: p.generation,
            search_console_queries: p.gsc_queries || [],
        };
    },
};

const updateBlogPost: AdminToolDef = {
    name: "update_blog_post",
    title: "Blog SEO: publicar, despublicar o editar un artículo",
    description:
        "Cambia el estado (published publica un borrador; draft lo despublica; archived lo saca del blog) o edita título, meta título, meta " +
        "descripción, extracto o el cuerpo en Markdown. Al publicar o editar uno publicado se vacía la caché del blog y se avisa a Search Console " +
        "(sitemap) e IndexNow. El slug no cambia.",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["post_id"],
        properties: {
            post_id: postIdSchema,
            status: { type: "string", enum: POST_STATUSES },
            title: { type: "string", minLength: 10, maxLength: 120 },
            meta_title: { type: "string", minLength: 10, maxLength: 70 },
            description: { type: "string", minLength: 50, maxLength: 170 },
            excerpt: { type: "string", maxLength: 400 },
            body_md: { type: "string", minLength: 200, maxLength: 60000 },
        },
    },
    audit: (args) => ({ summary: `Artículo del blog ${args.post_id}: ${Object.keys(args).filter((k) => !["post_id", "reason"].includes(k)).join(", ")}`, target: `blog_post:${args.post_id}` }),
    async handler(args, actx) {
        const { supabase, origin } = actx;
        const { data: p } = await supabase.from(POSTS_TABLE).select("id, slug, status, published_at").eq("id", args.post_id).maybeSingle();
        if (!p) throw new ToolError("not_found", `No existe el artículo ${args.post_id}.`);
        const now = new Date().toISOString();
        const patch: Record<string, unknown> = { updated_at: now };
        for (const f of ["title", "meta_title", "description", "excerpt"] as const) if (args[f] !== undefined) patch[f] = String(args[f]).trim();
        if (args.body_md !== undefined) {
            patch.body_md = args.body_md;
            patch.word_count = countWords(args.body_md);
            patch.content_updated_at = now;
        }
        if (args.status && args.status !== p.status) {
            patch.status = args.status;
            if (args.status === "published" && !p.published_at) patch.published_at = now;
        }
        const { error } = await supabase.from(POSTS_TABLE).update(patch).eq("id", p.id);
        if (error) throw new ToolError("invalid_input", error.message);
        const nowPublished = (args.status || p.status) === "published";
        const visibleChange = nowPublished || p.status === "published";
        const effects = visibleChange ? await afterBlogChange([`/blog/${p.slug}`], { notify: nowPublished }) : null;
        return {
            post_id: Number(p.id),
            status: args.status || p.status,
            changed: Object.keys(patch).filter((k) => k !== "updated_at"),
            url: nowPublished ? postUrl(origin, p.slug) : null,
            preview_url: nowPublished ? null : previewUrl(origin, Number(p.id)),
            effects,
        };
    },
};

const runBlogTask: AdminToolDef = {
    name: "run_blog_task",
    title: "Blog SEO: correr una tarea ahora",
    description:
        "Dispara una tarea en segundo plano (el resultado llega en 1 a 8 minutos a list_blog_runs y a Slack): keywords (descubrir y puntuar con " +
        "Planner, Search Console, autocompletado e IA), metrics (Search Console por artículo), generate (un artículo nuevo: con keyword_id esa " +
        "keyword, con topic_slug la mejor de ese tema; publish=false lo deja en borrador) o refresh (reescribir un artículo que ya rankea; con " +
        "post_id ese). generate y refresh gastan créditos de IA (≈ US$0,5-2 cada uno): piden confirmación.",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["task"],
        properties: {
            task: { type: "string", enum: BLOG_TASKS },
            keyword_id: { type: "integer", minimum: 1 },
            topic_slug: slugSchema,
            post_id: postIdSchema,
            publish: { type: "boolean", description: "Solo generate: false lo deja en borrador aunque pase las validaciones." },
        },
    },
    async confirm(args) {
        if (args.task !== "generate" && args.task !== "refresh") return null;
        return {
            message:
                args.task === "generate"
                    ? `Escribir un artículo nuevo${args.keyword_id ? ` para la keyword ${args.keyword_id}` : args.topic_slug ? ` del tema ${args.topic_slug}` : " (la mejor keyword pendiente)"}${args.publish === false ? ", en borrador" : ""}.`
                    : `Refrescar ${args.post_id ? `el artículo ${args.post_id}` : "el artículo con más potencial"} con datos de Search Console.`,
            details: { costo_estimado_usd: "0,5 - 2", tarea: args.task },
        };
    },
    audit: (args) => ({ summary: `Tarea del blog: ${args.task}${args.keyword_id ? ` keyword ${args.keyword_id}` : ""}${args.post_id ? ` artículo ${args.post_id}` : ""}` }),
    async handler(args, actx) {
        const origin = functionsOrigin(new Request(actx.requestUrl.href));
        const result = await triggerBackground(origin, "blog-background", {
            task: args.task,
            trigger: "admin",
            ...(args.keyword_id ? { keywordId: args.keyword_id } : {}),
            ...(args.topic_slug ? { topicSlug: args.topic_slug } : {}),
            ...(args.post_id ? { postId: args.post_id } : {}),
            ...(typeof args.publish === "boolean" ? { publish: args.publish } : {}),
        });
        if ((result as any).error) throw new ToolError("unavailable", `No se pudo disparar la tarea: ${(result as any).error}`);
        return { started: true, task: args.task, note: "Corre en segundo plano: revisa list_blog_runs en unos minutos." };
    },
};

const listBlogRuns: AdminToolDef = {
    name: "list_blog_runs",
    title: "Blog SEO: corridas",
    description: "Bitácora de las corridas del blog (automáticas y manuales): tarea, estado, resultado (artículo creado, keywords, errores) y costo estimado en USD.",
    readOnly: true,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            task: { type: "string", enum: BLOG_TASKS },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
    },
    async handler(args, actx) {
        let q = actx.supabase.from(RUNS_TABLE).select("*").order("started_at", { ascending: false }).limit(args.limit || 20);
        if (args.task) q = q.eq("task", args.task);
        const { data, error } = await q;
        if (error) throw new ToolError("unavailable", error.message);
        return {
            runs: (data || []).map((r: any) => {
                const { cost, opts, ...details } = r.details || {};
                return {
                    run_id: Number(r.id),
                    task: r.task,
                    trigger: r.trigger,
                    status: r.status,
                    started_at: r.started_at,
                    finished_at: r.finished_at,
                    post_id: n(r.post_id),
                    cost_usd: cost?.usd ?? null,
                    web_searches: cost?.web_searches ?? null,
                    error: r.error,
                    options: opts || null,
                    result: details,
                };
            }),
        };
    },
};

export const blogAdminTools: AdminToolDef[] = [
    getBlogOverview,
    listBlogTopics,
    upsertBlogTopic,
    listBlogKeywords,
    upsertBlogKeywords,
    listBlogPosts,
    getBlogPost,
    updateBlogPost,
    runBlogTask,
    listBlogRuns,
];
