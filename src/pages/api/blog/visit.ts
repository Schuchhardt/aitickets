// POST /api/blog/visit — registra una lectura de un artículo del blog o un clic hacia AI Tickets desde él
// (aitickets_blog_visits, migración 202611090300_blog_analytics.sql).
//
// Las páginas del blog salen del CDN, así que la visita la avisa el navegador (script de BlogArticle.astro), igual que
// /api/events/visit. Body: { post_id, kind: "view" | "cta", referrer?, utm_source?, utm_medium?, utm_campaign?, cta_path? }.
// Solo cuenta artículos publicados; los bots se guardan marcados (is_bot) con las reglas de netlify/lib/visit-bots.mjs.
// Responde 204 siempre que el cuerpo sea válido: una visita que no se pudo guardar no es un error del lector.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { clientIpFrom } from "../../../lib/sites";
import { botReason } from "../../../../netlify/lib/visit-bots.mjs";
import { classifyBlogSource } from "../../../../netlify/lib/blog/traffic.mjs";

export const prerender = false;

const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

function geoOf(request: Request, locals: any) {
    let geo: any = locals?.netlify?.context?.geo || null;
    if (!geo) {
        const header = request.headers.get("x-nf-geo");
        if (header) {
            try {
                geo = JSON.parse(atob(header));
            } catch {
                try {
                    geo = JSON.parse(header);
                } catch {
                    geo = null;
                }
            }
        }
    }
    return { country: clip(geo?.country?.code, 8) || clip(request.headers.get("x-country"), 8), city: clip(geo?.city, 128) };
}

export const POST: APIRoute = async ({ request, locals }) => {
    let body: any;
    try {
        body = await request.json();
    } catch {
        return new Response(null, { status: 400 });
    }
    const postId = Number(body?.post_id);
    const kind = body?.kind === "cta" ? "cta" : body?.kind === "view" || body?.kind == null ? "view" : null;
    if (!Number.isSafeInteger(postId) || postId <= 0 || !kind) return new Response(null, { status: 400 });
    // Solo rutas internas ("/organizadores", "/registro?x"): nunca una URL externa
    const ctaPath = kind === "cta" ? clip(body.cta_path, 200) : null;
    if (kind === "cta" && (!ctaPath || !/^\/(?!\/)[^\s]*$/.test(ctaPath))) return new Response(null, { status: 400 });

    try {
        const supabase = getSupabaseAdmin();
        const { data: post } = await supabase.from("aitickets_blog_posts").select("id").eq("id", postId).eq("status", "published").maybeSingle();
        if (post) {
            const ua = request.headers.get("user-agent") || "";
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientIpFrom(request)));
            const ipHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
            const { country, city } = geoOf(request, locals);
            let host: string | null = null;
            try {
                host = new URL(request.url).host;
            } catch {
                /* sin URL */
            }
            const referrer = clip(body.referrer, 1024);
            const utmSource = clip(body.utm_source, 256);
            const utmMedium = clip(body.utm_medium, 256);
            const reason = botReason({ user_agent: ua, city, country, referrer, host });
            await supabase.from("aitickets_blog_visits").insert({
                post_id: postId,
                kind,
                ip_hash: ipHash,
                source: classifyBlogSource({ referrer: referrer || "", utmSource: utmSource || "", utmMedium: utmMedium || "", siteHost: host || "" }),
                referrer,
                utm_source: utmSource,
                utm_medium: utmMedium,
                utm_campaign: clip(body.utm_campaign, 256),
                cta_path: ctaPath,
                country,
                city,
                user_agent: ua.slice(0, 512) || null,
                is_bot: Boolean(reason),
                bot_reason: reason,
            });
        }
    } catch (err: any) {
        console.error("[blog/visit]", err?.message);
    }
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
};
