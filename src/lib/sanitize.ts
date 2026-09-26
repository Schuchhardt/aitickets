// Sanitización de texto enriquecido (descripciones de eventos). Contrato R3.
// Se usa al ESCRIBIR (create/update/duplicate) y al LEER antes de renderizar con v-html / set:html.
import sanitizeHtml from "sanitize-html";

const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "h2", "h3", "blockquote"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    // Eliminar por completo el contenido de estas etiquetas (no solo la etiqueta)
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "embed", "svg", "math"],
    transformTags: {
        a: (tagName, attribs) => {
            const out: Record<string, string> = { rel: "noopener noreferrer nofollow" };
            if (attribs.href) out.href = attribs.href;
            if (attribs.target === "_blank") out.target = "_blank";
            return { tagName, attribs: out };
        },
    },
};

/** Devuelve HTML seguro según la allowlist de R3. Acepta null/undefined (=> ""). */
export function sanitizeRichText(html: unknown): string {
    if (html === null || html === undefined) return "";
    const input = String(html).slice(0, 50000);
    return sanitizeHtml(input, RICH_TEXT_OPTIONS).trim();
}

const HAS_TAG_RE = /<\/?[a-z][^>]*>/i;

/**
 * Para renderizar una descripción: sanitiza y, si es texto plano (sin etiquetas, como lo guarda
 * el textarea del dashboard), convierte los saltos de línea en <br> para conservar los párrafos.
 */
export function descriptionToHtml(raw: unknown): string {
    const clean = sanitizeRichText(raw);
    if (!clean || HAS_TAG_RE.test(clean)) return clean;
    return clean.replace(/\r?\n/g, "<br>");
}

/** Decodifica las entidades básicas que sanitize-html agrega, para mostrar texto plano en un textarea. */
export function decodeBasicEntities(text: unknown): string {
    return String(text ?? "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
}
