// Textos del evento generados con Claude para el panel (descripción y preguntas frecuentes).
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
