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
