// Aviso público de un sitio de productor que existe pero no está publicado (lo ocultó el productor, aún no lo
// publica o su organización no verificó el correo).
//
// Antes estos casos respondían "Página no encontrada / El sitio o la página que buscas no existe", que en un
// dominio propio recién conectado parece un dominio roto. Ahora el visitante sabe que el sitio existe y que el
// productor lo tiene oculto por ahora (p. ej. en mantenimiento), y el productor ve cómo volver a publicarlo.
//
// 503 + Retry-After: indisponibilidad temporal (Google no desindexa por un 503 corto, a diferencia de un 404).
// no-store en el navegador y en el CDN de Netlify: al publicar de nuevo el sitio se ve de inmediato.
import { mainOrigin } from "./sites";

/** Segundos que sugerimos esperar (Retry-After). */
export const SITE_UNAVAILABLE_RETRY_AFTER_S = 3600;

export interface SiteUnavailableOptions {
  /** Respuesta JSON (rutas /api/* de un host de tenant). */
  json?: boolean;
  /**
   * La petición llegó por un dominio propio o subdominio del sitio (host de tenant): el aviso aclara que el
   * dominio está conectado a AI Tickets y que lo que falta es publicar el sitio.
   */
  onTenantHost?: boolean;
  /** Origen de la app principal (por defecto mainOrigin()). */
  origin?: string;
}

const HEADERS = {
  "Cache-Control": "no-store",
  "Netlify-CDN-Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Retry-After": String(SITE_UNAVAILABLE_RETRY_AFTER_S),
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** Textos del aviso (separados del HTML para poder probarlos). */
export function siteUnavailableCopy(onTenantHost = false) {
  return {
    title: "Sitio no publicado por ahora",
    heading: "Este sitio no está publicado por ahora",
    body: onTenantHost
      ? "El dominio está conectado a AI Tickets, pero el productor todavía no publica su sitio o lo ocultó mientras lo actualiza. Puede estar en mantenimiento."
      : "El productor todavía no publica su sitio o lo ocultó mientras lo actualiza. Puede estar en mantenimiento.",
    retry: "Vuelve a intentarlo más tarde.",
    eventsLink: "Ver eventos en AI Tickets",
    ownerHint: "¿Es tu sitio? Publícalo desde tu panel, en Mi sitio web → Publicar sitio.",
  };
}

/** Respuesta 503 para un sitio que existe pero no es público. */
export function siteUnavailableResponse(opts: SiteUnavailableOptions = {}): Response {
  const copy = siteUnavailableCopy(!!opts.onTenantHost);
  if (opts.json) {
    return new Response(JSON.stringify({ error: copy.heading, code: "site_unpublished" }), {
      status: 503,
      headers: { ...HEADERS, "Content-Type": "application/json" },
    });
  }

  const origin = (opts.origin || mainOrigin()).replace(/\/+$/, "");
  const e = (s: string) => escapeHtml(s);
  const html =
    `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${e(copy.title)}</title></head>` +
    '<body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f9fafb;color:#111827">' +
    '<main style="text-align:center;padding:24px;max-width:32rem" data-testid="site-unpublished">' +
    `<h1 style="font-size:1.5rem;margin:0 0 12px">${e(copy.heading)}</h1>` +
    `<p style="margin:0 0 8px;line-height:1.5">${e(copy.body)}</p>` +
    `<p style="margin:0 0 20px;line-height:1.5">${e(copy.retry)}</p>` +
    `<p style="margin:0 0 28px"><a href="${e(`${origin}/eventos`)}" style="color:#4d7c0f;font-weight:600">${e(copy.eventsLink)}</a></p>` +
    `<p style="margin:0;font-size:.875rem;color:#6b7280">${e(copy.ownerHint).replace(
      "Mi sitio web",
      `<a href="${e(`${origin}/dashboard/sitio`)}" style="color:#6b7280">Mi sitio web</a>`
    )}</p>` +
    "</main></body></html>";

  return new Response(html, { status: 503, headers: { ...HEADERS, "Content-Type": "text/html; charset=utf-8" } });
}
