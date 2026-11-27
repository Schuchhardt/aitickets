// Textos generados con Claude para el panel (descripción y preguntas frecuentes del evento, anuncios, publicaciones y el sitio web).
import Anthropic from "@anthropic-ai/sdk";
import { marked } from "marked";
import { serverEnv } from "../pages/api/_lib/server-utils";
import { sanitizeRichText } from "./sanitize";

export const isTextGenerationConfigured = () => Boolean(serverEnv("ANTHROPIC_API_KEY"));

export class AiRefusalError extends Error {}

async function ask(system: string, user: string, format?: { type: "json_schema"; schema: Record<string, unknown> }): Promise<string> {
    const client = new Anthropic({ apiKey: serverEnv("ANTHROPIC_API_KEY"), timeout: 60_000, maxRetries: 1 });
    const response = await client.beta.messages.create({
        model: serverEnv("ANTHROPIC_MODEL") || "claude-opus-5-5",
        max_tokens: 8000,
        output_config: { effort: "low", ...(format ? { format } : {}) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages: [{ role: "user", content: user }],
    });
    if (response.stop_reason === "refusal") throw new AiRefusalError("La IA no pudo generar este contenido");
    return response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
}

const guideLine = (guide?: string) => (guide?.trim() ? `\n\nIndicaciones del productor: ${guide.trim().slice(0, 1000)}` : "");

/**
 * Descripción para la página pública del evento. El modelo escribe Markdown y se devuelve HTML ya
 * sanitizado (misma allowlist que al guardar).
 */
export async function generateEventDescription(eventContext: string, guide?: string): Promise<string> {
    const markdown = await ask(
        "Eres redactor de una ticketera chilena. Escribes la descripción de la página de venta de un evento, en español de Chile, " +
            "cercana y concreta, sin exagerar ni inventar datos (artistas, horarios, precios, servicios) que no estén en la información entregada. " +
            "Formato Markdown: 2 a 4 párrafos breves; puedes usar **negritas**, una lista de viñetas si ayuda (por ejemplo, qué incluye) " +
            "y subtítulos ## solo si el texto es largo. No incluyas el nombre del evento como título, ni enlaces, ni emojis en exceso. " +
            "Responde solo con la descripción, sin introducción ni comentarios.",
        `Información del evento:\n${eventContext}${guideLine(guide)}`,
    );
    return sanitizeRichText(await marked.parse(markdown));
}

export type FaqSuggestion = { question: string; answer: string };

/** Preguntas frecuentes sugeridas (sin repetir las que ya existen). */
export async function generateEventFaqs(eventContext: string, existing: string[], guide?: string): Promise<FaqSuggestion[]> {
    const text = await ask(
        "Eres el equipo de atención de una ticketera chilena. Propón preguntas frecuentes útiles para la página de venta de un evento " +
            "(acceso, edad mínima, horarios, qué llevar, entradas y cambios, accesibilidad, estacionamiento, etc.), en español de Chile. " +
            "Las respuestas deben ser breves y basarse solo en la información entregada; si un dato no está, responde de forma general " +
            "y sugiere consultar con la productora, sin inventar políticas, precios ni horarios.",
        `Información del evento:\n${eventContext}` +
            (existing.length ? `\n\nYa existen estas preguntas (no las repitas):\n- ${existing.join("\n- ")}` : "") +
            guideLine(guide) +
            "\n\nPropón entre 4 y 6 preguntas.",
        {
            type: "json_schema",
            schema: {
                type: "object",
                additionalProperties: false,
                required: ["faqs"],
                properties: {
                    faqs: {
                        type: "array",
                        items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["question", "answer"],
                            properties: { question: { type: "string" }, answer: { type: "string" } },
                        },
                    },
                },
            },
        },
    );
    const parsed = JSON.parse(text);
    return (parsed.faqs || [])
        .map((f: any) => ({ question: String(f.question || "").trim().slice(0, 500), answer: String(f.answer || "").trim().slice(0, 3000) }))
        .filter((f: FaqSuggestion) => f.question && f.answer)
        .slice(0, 8);
}

export type AdCopy = { headline: string; body: string };

/**
 * Texto para un anuncio pagado en Meta (Facebook e Instagram): título corto y texto principal, sin hashtags ni links
 * (el botón "Comprar entradas" ya lleva a la página del evento). Límites de AD_LIMITS (netlify/lib/zernio-ads.mjs).
 */
export async function generateAdCopy(eventContext: string, guide?: string): Promise<AdCopy> {
    const text = await ask(
        "Eres redactor de anuncios pagados de una ticketera chilena. Escribes anuncios de Meta (Facebook e Instagram) para vender " +
            "entradas, en español de Chile, cercanos y directos. El título (headline) tiene como máximo 40 caracteres y dice qué es y cuándo " +
            "(p. ej. el nombre corto y el día). El texto principal (body) tiene 1 a 3 frases (máx. 300 caracteres): un gancho en la primera " +
            "línea, qué se va a vivir, fecha y lugar, y un llamado a comprar. Como máximo 2 emojis. Sin hashtags, sin links y sin inventar " +
            "artistas, precios, descuentos ni beneficios que no estén en la información entregada.",
        `Información del evento:\n${eventContext}${guideLine(guide)}`,
        {
            type: "json_schema",
            schema: {
                type: "object",
                additionalProperties: false,
                required: ["headline", "body"],
                properties: { headline: { type: "string" }, body: { type: "string" } },
            },
        },
    );
    const parsed = JSON.parse(text);
    const clean = (v: unknown, max: number) => String(v || "").replace(/https?:\/\/\S+/g, "").replace(/#\S+/g, "").replace(/\s+/g, " ").trim().slice(0, max);
    return { headline: clean(parsed.headline, 40), body: clean(parsed.body, 1000) };
}

/**
 * Caption de un post de feed de las historias automáticas (src/lib/socialSeries.ts): 2 a 4 frases desde la
 * descripción del evento, distinto según los días que faltan. Sin links ni hashtags inventados: el cierre fijo
 * ("Comenta ENTRADAS y te mandamos el link") lo agrega quien llama.
 */
export async function generateSeriesCaption(eventContext: string, daysToEvent: number, previous: string[] = []): Promise<string> {
    const when = daysToEvent <= 0 ? "hoy" : daysToEvent === 1 ? "mañana" : `en ${daysToEvent} días`;
    const text = await ask(
        "Eres community manager de una ticketera chilena. Escribes el texto de una publicación de Instagram para vender entradas de un evento, " +
            "en español de Chile, cercano y concreto: 2 a 4 frases cortas, máximo 2 emojis, sin hashtags, sin links y sin inventar artistas, " +
            "precios, descuentos ni beneficios que no estén en la información entregada. Menciona cuándo es (el evento es " + when + "). " +
            "No termines con un llamado a comentar: eso se agrega después. Responde solo con el texto de la publicación.",
        `Información del evento:\n${eventContext}` +
            (previous.length ? `\n\nPosts anteriores de esta misma serie (no los repitas, cambia el ángulo):\n- ${previous.slice(-3).join("\n- ")}` : ""),
    );
    return text.replace(/https?:\/\/\S+/g, "").replace(/#\S+/g, "").replace(/[ \t]+/g, " ").trim().slice(0, 1500);
}

export type SiteDraft = {
    template: string;
    theme: Record<string, unknown>;
    title: string;
    tagline: string;
    about: string;
    sections: unknown[];
    layout?: { nav?: string; sticky?: boolean };
};

export type SiteEditResult = {
    summary: string;
    template?: string;
    theme?: Record<string, string>;
    title?: string;
    tagline?: string;
    about?: string;
    /** Secciones nuevas o cambiadas. */
    sections: unknown[];
    /** Ids de todas las secciones en su orden final (vacío al editar una sola sección). */
    order: string[];
    /** Tipo de menú y si queda fijo (solo los campos que cambian). */
    layout?: { nav?: string; sticky?: boolean };
    /** Plantilla completa a aplicar (src/lib/sitePresets.ts), si el productor la pidió. */
    preset?: string;
};

// Salida estructurada: todos los campos obligatorios (la API limita los opcionales). "" o null = vacío / sin cambio.
const requiredStrings = (keys: string[]) => ({
    type: "object",
    additionalProperties: false,
    required: keys,
    properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
});
const SITE_ITEM_SCHEMA = requiredStrings(["title", "text", "question", "answer", "quote", "author", "image_url", "caption", "name", "role", "link_url"]);

/**
 * Edición del sitio web del productor con IA (src/components/dashboard/site/SiteAiPanel.vue): recibe el borrador actual
 * y una instrucción y devuelve los cambios. Quien llama sanea todo con sanitizeSections / sanitizeTheme, descarta las
 * imágenes que no estaban en el borrador y conserva los videos (la IA no los ve ni los inventa).
 */
export async function generateSiteEdit(input: {
    instruction: string;
    draft: SiteDraft;
    /** Productora y próximos eventos, en texto. */
    context: string;
    templates: { key: string; name: string; description: string }[];
    fonts: string[];
    sectionTypes: { type: string; name: string; description: string }[];
    /** Variantes de diseño por tipo de sección. */
    layouts?: Record<string, string[]>;
    /** Plantillas completas (copy + diseño + tema) por tipo de página. */
    presets?: { key: string; template: string; name: string; description: string }[];
    navStyles?: { value: string; label: string }[];
    /** Solo editar esta sección. */
    sectionId?: string | null;
}): Promise<SiteEditResult> {
    const { draft, sectionId } = input;
    const presets = input.presets || [];
    const navStyles = input.navStyles || [];
    const layoutValues = [...new Set(Object.values(input.layouts || {}).flat())];
    // Para que la respuesta sea corta (y rápida), la IA devuelve solo las secciones nuevas o cambiadas y el orden final
    const scope = sectionId
        ? `Edita SOLO la sección con id "${sectionId}": devuelve en "sections" un arreglo con esa única sección (mismo id y tipo), "order" vacío, preset "" y deja template, los campos de theme y layout, title, tagline y about en "" o null.`
        : 'Devuelve en "sections" SOLO las secciones nuevas o que cambias (completas, con todos sus campos; conserva el id de las que ya existen y a las nuevas ponles un id corto en minúsculas, p. ej. "faq-1"), y en "order" los ids de TODAS las secciones como deben quedar, en orden (una sección que no esté en order se elimina). Para template, preset, los campos de theme y layout, title, tagline y about: "" o null si no los cambias.';
    const text = await ask(
        "Eres diseñador y redactor web de AI Tickets, una ticketera chilena. Editas el sitio web gratis de una productora de eventos " +
            "siguiendo la instrucción del productor, en español de Chile, con textos breves, concretos y cercanos.\n\n" +
            "Cómo es el sitio:\n" +
            "- Una plantilla (template) define el estilo visual según el tipo de evento:\n" +
            input.templates.map((t) => `  * ${t.key}: ${t.name}. ${t.description}`).join("\n") +
            (presets.length
                ? "\n- Plantillas completas (preset): combinan textos, secciones, menú y colores para un tipo de página. Si el productor pide " +
                  "usar o cambiar a una de ellas (\"hazlo como un festival\", \"usa la plantilla de academia de baile\"), pon su key en preset y deja " +
                  "sections y order vacíos (se aplican las secciones de la plantilla; no se pierden logo ni \"Sobre nosotros\"):\n" +
                  presets.map((p) => `  * ${p.key} (${p.template}): ${p.name}. ${p.description}`).join("\n")
                : "") +
            "\n- El tema (theme) tiene colores hex: primary (botones y acentos), accent (segundo color), background (fondo) y text (texto); " +
            `y font (tipografía de titulares), una de: ${input.fonts.join(", ")}. Si cambias colores, cuida el contraste entre background y text.\n` +
            (navStyles.length ? `- layout.nav es el tipo de menú: ${navStyles.map((n) => `${n.value} (${n.label})`).join(", ")}; layout.sticky deja el menú fijo arriba.\n` : "") +
            "- title es el nombre a mostrar, tagline una frase corta (máx. 200 caracteres) y about el texto de \"Sobre nosotros\" en texto plano " +
            "(párrafos separados por una línea en blanco; se muestra en la sección de tipo about).\n" +
            "- La página de inicio es una lista de secciones. Tipos:\n" +
            input.sectionTypes.map((s) => `  * ${s.type}: ${s.name}. ${s.description}`).join("\n") +
            "\n- Campos de data por tipo: todas aceptan eyebrow (antetítulo corto), title y nav_label (texto corto en el menú). " +
            "hero: subtitle, button_label, button_url, image_url, layout. events: text, layout. feature: text, image_url, align (left | right), " +
            "button_label, button_url, button_action, modal_title, modal_text. video: url (YouTube o Vimeo), text. cta: text, button_label, button_url, " +
            'button_action, modal_title, modal_text. button_url: "#eventos", "contacto", "#<id de otra sección>" o una URL https. ' +
            'button_action "modal" hace que el botón abra una ventana con modal_title y modal_text (condiciones, reservas, cotizaciones); "" lo deja como enlace. ' +
            "contact: text. highlights: items [{title, text}]. faq: items [{question, answer}]. testimonials: items [{quote, author}], layout. " +
            "tabs: items [{title (nombre de la pestaña), text, image_url}]. people: items [{name, role, text (bio), image_url, link_url}], layout. " +
            "gallery: items [{image_url, caption}], layout. about: solo eyebrow, title y nav_label. " +
            (input.layouts ? `Valores de layout por tipo: ${Object.entries(input.layouts).map(([t, v]) => `${t}: ${v.join(" | ")}`).join("; ")}. ` : "") +
            "hidden: true oculta una sección sin borrarla; nav: true la pone en el menú. Los campos que no usa un tipo van como \"\" (y items como []).\n\n" +
            "Reglas:\n" +
            "- La sección events muestra sola los eventos publicados: nunca escribas eventos, fechas ni precios a mano.\n" +
            "- No inventes datos que no estén en la información entregada: artistas, nombres de personas, precios, fechas, direcciones, horarios, políticas (edad, devoluciones, " +
            "estacionamiento), premios, cifras ni opiniones o testimonios de personas reales. Si te piden opiniones o personas y no hay, no inventes: deja los ítems vacíos " +
            "(\"\") para que el productor los complete y explícalo en summary. En preguntas frecuentes, responde solo con lo que se sabe (por ejemplo, que la entrada llega por correo con un QR) " +
            "o deja la respuesta vacía para que el productor la escriba.\n" +
            "- Usa solo URLs de imágenes que ya estén en el borrador; no inventes URLs. Los videos subidos (campo video del borrador) se conservan solos: no los incluyas.\n" +
            "- Texto plano en todos los campos: sin HTML, sin Markdown y con pocos emojis o ninguno.\n" +
            "- Respeta lo que no te pidieron cambiar.\n" +
            "- summary: una o dos frases para el productor sobre lo que cambiaste, en primera persona (p. ej. \"Agregué preguntas frecuentes y...\"), sin tecnicismos.",
        `Información de la productora y sus eventos:\n${input.context}\n\n` +
            `Borrador actual del sitio (JSON):\n${JSON.stringify(draft).slice(0, 40000)}\n\n` +
            `Instrucción del productor: ${input.instruction.slice(0, 1500)}\n\n${scope}`,
        {
            type: "json_schema",
            schema: {
                type: "object",
                additionalProperties: false,
                required: ["summary", "order", "sections", "template", "preset", "theme", "layout", "title", "tagline", "about"],
                properties: {
                    summary: { type: "string" },
                    order: { type: "array", items: { type: "string" } },
                    sections: {
                        type: "array",
                        items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["id", "type", "hidden", "nav", "data"],
                            properties: {
                                id: { type: "string" },
                                type: { type: "string", enum: input.sectionTypes.map((s) => s.type) },
                                hidden: { type: "boolean" },
                                nav: { type: "boolean" },
                                data: {
                                    type: "object",
                                    additionalProperties: false,
                                    required: [
                                        "eyebrow", "title", "nav_label", "subtitle", "text", "button_label", "button_url", "button_action",
                                        "modal_title", "modal_text", "image_url", "url", "layout", "align", "items",
                                    ],
                                    properties: {
                                        ...requiredStrings(["eyebrow", "title", "nav_label", "subtitle", "text", "button_label", "button_url", "modal_title", "modal_text", "image_url", "url"]).properties,
                                        button_action: { type: "string", enum: ["", "modal"] },
                                        layout: { type: "string", enum: ["", ...(layoutValues.length ? layoutValues : ["cards", "posters", "list"])] },
                                        align: { type: "string", enum: ["", "left", "right"] },
                                        items: { type: "array", items: SITE_ITEM_SCHEMA },
                                    },
                                },
                            },
                        },
                    },
                    template: { type: "string", enum: ["", ...input.templates.map((t) => t.key)] },
                    preset: { type: "string", enum: ["", ...presets.map((p) => p.key)] },
                    theme: {
                        type: "object",
                        additionalProperties: false,
                        required: ["primary", "accent", "background", "text", "font"],
                        properties: {
                            ...requiredStrings(["primary", "accent", "background", "text"]).properties,
                            font: { type: "string", enum: ["", ...input.fonts] },
                        },
                    },
                    layout: {
                        type: "object",
                        additionalProperties: false,
                        required: ["nav", "sticky"],
                        properties: {
                            nav: { type: "string", enum: ["", ...navStyles.map((n) => n.value)] },
                            sticky: { type: ["boolean", "null"] },
                        },
                    },
                    title: { type: ["string", "null"] },
                    tagline: { type: ["string", "null"] },
                    about: { type: ["string", "null"] },
                },
            },
        },
    );
    const parsed = JSON.parse(text);
    const layout: { nav?: string; sticky?: boolean } = {};
    if (parsed.layout && typeof parsed.layout === "object") {
        if (typeof parsed.layout.nav === "string" && parsed.layout.nav) layout.nav = parsed.layout.nav;
        if (typeof parsed.layout.sticky === "boolean") layout.sticky = parsed.layout.sticky;
    }
    return {
        summary: String(parsed.summary || "").trim().slice(0, 500),
        template: typeof parsed.template === "string" && parsed.template ? parsed.template : undefined,
        preset: typeof parsed.preset === "string" && parsed.preset ? parsed.preset : undefined,
        // Solo los campos del tema que la IA cambió ("" = sin cambio)
        theme: parsed.theme && typeof parsed.theme === "object"
            ? (Object.fromEntries(Object.entries(parsed.theme).filter(([, v]) => typeof v === "string" && v.trim())) as Record<string, string>)
            : undefined,
        layout: Object.keys(layout).length ? layout : undefined,
        title: typeof parsed.title === "string" ? parsed.title : undefined,
        tagline: typeof parsed.tagline === "string" ? parsed.tagline : undefined,
        about: typeof parsed.about === "string" ? parsed.about : undefined,
        sections: Array.isArray(parsed.sections) ? parsed.sections : [],
        order: Array.isArray(parsed.order) ? parsed.order.filter((id: unknown) => typeof id === "string") : [],
    };
}
