// Llave de IndexNow (https://www.indexnow.org/documentation): los buscadores la leen aquí para confirmar que los avisos
// de URLs nuevas del blog (netlify/lib/blog/publish.mjs, keyLocation) vienen del dueño del sitio. Sin INDEXNOW_KEY: 404.
import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = () => {
    const key = (process.env.INDEXNOW_KEY || "").trim();
    if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) return new Response("Not found", { status: 404 });
    return new Response(key, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
};
