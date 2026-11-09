// Lectura y render del blog para las páginas públicas (src/pages/blog). Los artículos los escribe el motor de
// netlify/lib/blog (docs/specs/blog-seo.md) en Markdown; aquí se convierten a HTML con una allowlist propia (tablas y
// títulos con id para el índice) y los links externos abren en otra pestaña.
//
// Todas las lecturas toleran que las tablas no existan (deploy preview sin migrar) o que no haya credenciales (dev
// local, CI sin BD): devuelven vacío o null.
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { getSupabaseAdmin } from "./auth-helpers";
import { slugify } from "../../netlify/lib/blog/text.mjs";
import { ogCardForPath, ogCardImagePath, ogPageKey } from "./ogPages";

export type BlogTopic = {
    id: number;
    slug: string;
    kind: "niche" | "feature";
    name: string;
    description: string | null;
    landing_path: string | null;
    weight: number;
    active: boolean;
};

export type BlogPostCard = {
    id: number;
    slug: string;
    title: string;
    description: string;
    excerpt: string | null;
    topic_id: number | null;
    published_at: string | null;
    content_updated_at: string | null;
    word_count: number | null;
};

export type BlogFaq = { question: string; answer: string };
export type BlogSource = { url: string; title: string; cited?: boolean };

export type BlogPost = BlogPostCard & {
    status: string;
    meta_title: string | null;
    body_md: string;
    faq: BlogFaq[];
    sources: BlogSource[];
    primary_keyword: string | null;
    created_at: string;
};

const CARD_COLUMNS = "id, slug, title, description, excerpt, topic_id, published_at, content_updated_at, word_count";
const POST_COLUMNS = `${CARD_COLUMNS}, status, meta_title, body_md, faq, sources, primary_keyword, created_at`;

const db = () => getSupabaseAdmin();

/** Ejecuta una lectura; ante cualquier falla (sin credenciales, tabla inexistente) devuelve `fallback`. */
async function safe<T>(read: () => PromiseLike<{ data: any; error: any }>, map: (data: any) => T, fallback: T): Promise<T> {
    try {
        const { data, error } = await read();
        return error || data == null ? fallback : map(data);
    } catch {
        return fallback;
    }
}

export async function listTopics(): Promise<BlogTopic[]> {
    return safe(
        () => db().from("aitickets_blog_topics").select("id, slug, kind, name, description, landing_path, weight, active").order("weight", { ascending: false }),
        (data) => data.map((t: any) => ({ ...t, id: Number(t.id) })),
        [],
    );
}

export async function listPublishedPosts({ topicId, limit = 60 }: { topicId?: number; limit?: number } = {}): Promise<BlogPostCard[]> {
    return safe(
        () => {
            let q = db().from("aitickets_blog_posts").select(CARD_COLUMNS).eq("status", "published").order("published_at", { ascending: false }).limit(limit);
            if (topicId) q = q.eq("topic_id", topicId);
            return q;
        },
        (data) => data.map((p: any) => ({ ...p, id: Number(p.id), topic_id: p.topic_id == null ? null : Number(p.topic_id) })),
        [],
    );
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
    if (!/^[a-z0-9-]{1,90}$/.test(slug)) return null;
    return safe(() => db().from("aitickets_blog_posts").select(POST_COLUMNS).eq("slug", slug).eq("status", "published").maybeSingle(), normalizePost, null);
}

/** Cualquier estado (vista previa firmada de un borrador). */
export async function getPostById(id: number): Promise<BlogPost | null> {
    return safe(() => db().from("aitickets_blog_posts").select(POST_COLUMNS).eq("id", id).maybeSingle(), normalizePost, null);
}

function normalizePost(p: any): BlogPost {
    return {
        ...p,
        id: Number(p.id),
        topic_id: p.topic_id == null ? null : Number(p.topic_id),
        faq: Array.isArray(p.faq) ? p.faq.filter((f: any) => f?.question && f?.answer) : [],
        sources: Array.isArray(p.sources) ? p.sources.filter((s: any) => /^https:\/\//.test(String(s?.url || ""))) : [],
    };
}

/** Del mismo tema primero; si faltan, los más recientes. */
export async function relatedPosts(post: Pick<BlogPost, "id" | "topic_id">, limit = 3): Promise<BlogPostCard[]> {
    const same = post.topic_id ? await listPublishedPosts({ topicId: post.topic_id, limit: limit + 1 }) : [];
    const out = same.filter((p) => p.id !== post.id).slice(0, limit);
    if (out.length < limit) {
        for (const p of await listPublishedPosts({ limit: limit * 3 })) {
            if (out.length >= limit) break;
            if (p.id !== post.id && !out.some((o) => o.id === p.id)) out.push(p);
        }
    }
    return out;
}

export const readingMinutes = (words: number | null) => Math.max(1, Math.round((words || 0) / 220));

const SANITIZE: sanitizeHtml.IOptions = {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "a", "h2", "h3", "h4", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "code", "pre", "hr"],
    allowedAttributes: { a: ["href", "target", "rel"], th: ["align"], td: ["align"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "embed", "svg", "math"],
    transformTags: {
        a: (tagName, attribs) => {
            const href = attribs.href || "";
            const external = /^https?:\/\//i.test(href) && !/^https?:\/\/(www\.)?aitickets\.cl(\/|$)/i.test(href);
            const out: Record<string, string> = { href };
            if (external) Object.assign(out, { target: "_blank", rel: "noopener" });
            return { tagName, attribs: out };
        },
    },
};

/** Markdown del artículo → HTML seguro + índice (títulos ## con id). */
export function renderArticle(markdown: string): { html: string; toc: { id: string; text: string }[] } {
    const clean = sanitizeHtml(marked.parse(String(markdown || ""), { async: false }) as string, SANITIZE);
    const toc: { id: string; text: string }[] = [];
    const used = new Set<string>();
    const html = clean.replace(/<h2>([\s\S]*?)<\/h2>/g, (_m, inner: string) => {
        const text = inner.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
        let id = slugify(text, 60);
        for (let n = 2; used.has(id); n++) id = `${slugify(text, 56)}-${n}`;
        used.add(id);
        toc.push({ id, text });
        return `<h2 id="${id}">${inner}</h2>`;
    });
    return { html, toc };
}

/**
 * Imagen para compartir de un artículo o tema: la tarjeta (ya generada en el build) de la landing del tema, o la del
 * blog. Los artículos se crean después del build, así que no tienen tarjeta propia.
 */
export function blogShareImage(topic: Pick<BlogTopic, "landing_path"> | null): { image: string; alt: string } {
    const path = topic?.landing_path || "/blog";
    const card = ogCardForPath(path) || ogCardForPath("/blog")!;
    const key = ogCardForPath(path) ? ogPageKey(path) : ogPageKey("/blog");
    return { image: ogCardImagePath(key, card), alt: card.alt };
}
