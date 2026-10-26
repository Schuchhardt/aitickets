// Imagen de cada pieza de las historias automáticas (docs/specs/historias-automaticas.md): historia 1080×1920 y post
// de feed 1080×1350, en JPG. Se genera en el servidor desde una plantilla (Satori: texto → vectores, sin depender de
// las fuentes del sistema) sobre la foto base del evento (sharp), NO con IA: los datos (fecha, lugar, cuenta regresiva,
// entradas que quedan) salen exactos. La cuenta de entradas se lee al renderizar (unas 2 h antes de publicar).
//
// Zonas seguras de Instagram: en la historia los primeros y últimos ~250 px los tapa la interfaz, así que el contenido
// va entre y=260 y y=1660. Cada pieza varía color y alineación respecto de la anterior (styleIndex).
//
// Fondo = la portada del evento (o la foto base elegida para la serie), como en la página pública:
//   - "fill": si su proporción calza con el formato (±10%), la llena (con el encuadre vertical que el productor eligió
//     para la portada en móvil, cover_settings.mobile.position_y). La parte de arriba queda limpia y la información va
//     en la franja de abajo, para no tapar la portada.
//   - "framed": si no (portada horizontal, flyer 4:5 en una historia) o si el productor eligió mostrarla completa
//     (fit 'contain'), va ENTERA como tarjeta sobre una versión difuminada y oscurecida de sí misma. Así nunca se
//     pierde el texto de un flyer ni media portada por el recorte.
import satori from "satori";
import { loadSharp } from "./imageOptimize";
import { stageOf } from "./socialSeriesCadence";
import unboundedBold from "@fontsource/unbounded/files/unbounded-latin-700-normal.woff?inline";
import promptMedium from "@fontsource/prompt/files/prompt-latin-500-normal.woff?inline";
import promptBold from "@fontsource/prompt/files/prompt-latin-700-normal.woff?inline";

export const PIECE_SIZE = { story: { width: 1080, height: 1920 }, feed_post: { width: 1080, height: 1350 } } as const;
export type PieceKind = keyof typeof PIECE_SIZE;

export type PieceData = {
    kind: PieceKind;
    variant: "countdown" | "sold_out";
    daysToEvent: number;
    eventName: string;
    /** "domingo 8 de noviembre" */
    dateLabel: string;
    /** "12:00" */
    startTime: string | null;
    venue: string | null;
    keyword: string;
    /** Entradas que quedan, solo si está bajo el umbral de escasez (nunca un número inventado). */
    remaining: number | null;
    /** Variación visual respecto de la pieza anterior. */
    styleIndex: number;
};

export type PieceText = { kicker: string | null; bigLines: string[]; message: string[]; scarcity: string | null; cta: string | null };

const ACCENTS = ["#bef264", "#ffffff", "#fcd34d"];

export type BaseImageOptions = {
    /** Encuadre vertical (0 = arriba, 100 = abajo) de la portada en móvil; solo cuando se recorta. */
    positionY?: number | null;
    /** 'contain' = el productor quiere la portada completa (sobre su versión difuminada), como en la página. */
    fit?: "cover" | "contain" | null;
};

/** Tamaño máximo de la portada completa en el modo "framed". */
const FRAME_BOX = { story: { width: 920, height: 680 }, feed_post: { width: 920, height: 470 } } as const;

/**
 * ¿La portada llena el formato (fill) o va completa sobre una versión difuminada de sí misma (framed)? Llena solo si
 * su proporción está a ±10% de la del formato (historia 9:16, post 4:5): un recorte mayor cortaría el texto de un afiche
 * A4 o de un flyer. Si el productor eligió mostrarla completa en móvil (fit 'contain'), siempre va completa.
 */
export function backgroundMode(imageRatio: number, kind: PieceKind, fit?: string | null): "fill" | "framed" {
    if (fit === "contain") return "framed";
    const { width, height } = PIECE_SIZE[kind];
    const target = width / height;
    return Number.isFinite(imageRatio) && Math.abs(imageRatio / target - 1) <= 0.1 ? "fill" : "framed";
}

type Frame = { src: string; width: number; height: number };

/** Textos de la pieza según la etapa (pura: la usan el render, la vista previa y los tests). */
export function pieceText(d: PieceData): PieceText {
    const when = [d.dateLabel, d.startTime ? `${d.startTime} h` : null].filter(Boolean).join(" · ");
    const where = d.venue || null;
    const reply = d.kind === "story" ? "Responde" : "Comenta";
    const cta = `${reply} ${d.keyword} y te mandamos el link`;
    const scarcity = d.remaining != null && d.remaining > 0 ? `Quedan ${d.remaining.toLocaleString("es-CL")} ${d.remaining === 1 ? "entrada" : "entradas"}` : null;
    if (d.variant === "sold_out") {
        return { kicker: d.eventName, bigLines: ["Agotado"], message: ["Entradas agotadas.", "¡Gracias por llenar la sala!"], scarcity: null, cta: null };
    }
    switch (stageOf(d.daysToEvent)) {
        case "today":
            return {
                kicker: d.eventName,
                bigLines: ["Hoy"],
                message: [d.startTime ? `${d.startTime} h${where ? ` · ${where}` : ""}` : where || ""].filter(Boolean),
                scarcity,
                cta: `Entradas en puerta o por DM: ${reply.toLowerCase()} ${d.keyword}`,
            };
        case "tomorrow":
            return { kicker: d.eventName, bigLines: ["Mañana"], message: ["Última noche para comprar", [when, where].filter(Boolean).join(" · ")], scarcity, cta };
        default:
            return {
                kicker: d.eventName,
                bigLines: ["Faltan", String(d.daysToEvent), d.daysToEvent === 1 ? "día" : "días"],
                message: [when, where || ""].filter(Boolean),
                scarcity: stageOf(d.daysToEvent) === "week" ? scarcity : null,
                cta,
            };
    }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

type Node = { type: string; props: Record<string, any> };
const h = (style: Record<string, any>, children?: any): Node => ({ type: "div", props: { style: { display: "flex", ...style }, children } });

const dataUrlToBuffer = (url: string) => Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
let fontsCache: any[] | null = null;
function fonts() {
    if (!fontsCache) {
        fontsCache = [
            { name: "Unbounded", data: dataUrlToBuffer(unboundedBold), weight: 700, style: "normal" },
            { name: "Prompt", data: dataUrlToBuffer(promptMedium), weight: 500, style: "normal" },
            { name: "Prompt", data: dataUrlToBuffer(promptBold), weight: 700, style: "normal" },
        ];
    }
    return fontsCache;
}

/** Tamaño del título del evento según su largo. */
const titleSize = (name: string, kind: PieceKind) => {
    const base = kind === "story" ? 64 : 54;
    return name.length > 60 ? base * 0.62 : name.length > 36 ? base * 0.78 : base;
};

/** Unbounded es ancha (~0,86 em por letra): la palabra grande se achica para caber en el ancho útil. */
const wordSize = (word: string, available: number, max: number) => Math.min(max, Math.floor(available / (Math.max(1, word.length) * 0.86)));

type Layout = "plain" | "fill" | "framed";

function overlay(d: PieceData, layout: Layout, frame: Frame | null = null): Node {
    const { width, height } = PIECE_SIZE[d.kind];
    const t = pieceText(d);
    const accent = ACCENTS[Math.abs(d.styleIndex) % ACCENTS.length];
    // Con la portada completa al centro, todo va centrado; si no, alterna para que cada pieza cambie
    const centered = layout === "framed" ? true : d.styleIndex % 2 === 1;
    const story = d.kind === "story";
    const pad = 80;
    const big = t.bigLines.length > 1;
    const align = centered ? "center" : "flex-start";
    const textAlign = centered ? "center" : "left";

    // Sobre la portada, la cuenta regresiva va en una fila compacta ("13" grande junto a FALTAN / días)
    const compactBlock = big
        ? h({ flexDirection: "row", alignItems: "center", gap: story ? 28 : 22 }, [
              h({ fontFamily: "Unbounded", fontWeight: 700, fontSize: story ? 210 : 150, color: accent, lineHeight: 1 }, t.bigLines[1]),
              h({ flexDirection: "column", alignItems: "flex-start", lineHeight: 1 }, [
                  h({ fontFamily: "Prompt", fontWeight: 700, fontSize: story ? 50 : 38, color: "#ffffff", textTransform: "uppercase", letterSpacing: 4 }, t.bigLines[0]),
                  h({ fontFamily: "Unbounded", fontWeight: 700, fontSize: story ? 84 : 62, color: "#ffffff" }, t.bigLines[2]),
              ]),
          ])
        : h({ fontFamily: "Unbounded", fontWeight: 700, fontSize: wordSize(t.bigLines[0], width - 2 * pad, story ? 150 : 110), color: accent, lineHeight: 1 }, t.bigLines[0]);

    // Sin foto: cuenta regresiva grande al centro
    const bigBlock = big
        ? h({ flexDirection: "column", alignItems: align, lineHeight: 1 }, [
              h({ fontFamily: "Prompt", fontWeight: 700, fontSize: story ? 72 : 60, color: "#ffffff", textTransform: "uppercase", letterSpacing: 6 }, t.bigLines[0]),
              h({ fontFamily: "Unbounded", fontWeight: 700, fontSize: story ? 360 : 280, color: accent, marginTop: story ? 10 : 0, lineHeight: 1 }, t.bigLines[1]),
              h({ fontFamily: "Unbounded", fontWeight: 700, fontSize: story ? 110 : 90, color: "#ffffff", lineHeight: 1 }, t.bigLines[2]),
          ])
        : h({ fontFamily: "Unbounded", fontWeight: 700, fontSize: wordSize(t.bigLines[0], width - 2 * pad, story ? 190 : 160), color: accent, lineHeight: 1 }, t.bigLines[0]);

    const kicker = (size: number) =>
        t.kicker ? h({ fontFamily: "Unbounded", fontWeight: 700, fontSize: size, color: "#ffffff", textAlign, lineHeight: 1.15 }, t.kicker) : null;
    const info = h({ flexDirection: "column", alignItems: align, gap: 16 }, [
        ...t.message.map((line, i) =>
            h({ fontFamily: "Prompt", fontWeight: i === 0 ? 700 : 500, fontSize: story ? 46 : 40, color: "#ffffff", textAlign, lineHeight: 1.25 }, line),
        ),
        t.scarcity
            ? h({ fontFamily: "Prompt", fontWeight: 700, fontSize: story ? 44 : 38, color: "#111111", backgroundColor: "#fcd34d", padding: "10px 26px", borderRadius: 999, marginTop: 8 }, t.scarcity)
            : null,
        t.cta
            ? h(
                  {
                      fontFamily: "Prompt",
                      fontWeight: 700,
                      fontSize: story ? 44 : 38,
                      color: "#111111",
                      backgroundColor: accent === "#ffffff" ? "#bef264" : accent,
                      padding: story ? "26px 40px" : "22px 34px",
                      borderRadius: 28,
                      marginTop: 18,
                      textAlign,
                      lineHeight: 1.2,
                  },
                  t.cta,
              )
            : null,
    ].filter(Boolean));

    const base = { width, height, flexDirection: "column", alignItems: align, padding: story ? `260px ${pad}px 260px` : `${pad}px` };

    if (layout === "fill") {
        // La portada es el fondo: la parte de arriba queda limpia y toda la información va en la franja de abajo
        return h(
            {
                ...base,
                justifyContent: "flex-end",
                gap: story ? 26 : 18,
                backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 14%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.7) 58%, rgba(0,0,0,0.93) 100%)",
            },
            [kicker(titleSize(t.kicker || "", d.kind) * 0.75), compactBlock, info].filter(Boolean),
        );
    }
    if (layout === "framed" && frame) {
        return h(
            {
                ...base,
                justifyContent: "space-between",
                backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.45) 70%, rgba(0,0,0,0.75) 100%)",
            },
            [
                kicker(titleSize(t.kicker || "", d.kind) * 0.8),
                h({ borderRadius: 28, overflow: "hidden", boxShadow: "0 24px 70px rgba(0,0,0,0.55)", width: frame.width, height: frame.height }, [
                    { type: "img", props: { src: frame.src, width: frame.width, height: frame.height, style: { width: frame.width, height: frame.height } } },
                ]),
                compactBlock,
                info,
            ].filter(Boolean),
        );
    }
    return h(
        {
            ...base,
            justifyContent: "space-between",
            backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 35%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0.88) 100%)",
        },
        [h({ flexDirection: "column", alignItems: align }, [kicker(titleSize(t.kicker || "", d.kind))].filter(Boolean)), bigBlock, info],
    );
}

/** SVG de la capa de texto (transparente), con la portada completa embebida en el modo "framed". */
export async function renderOverlaySvg(d: PieceData, layout: Layout = "plain", frame: Frame | null = null): Promise<string> {
    const { width, height } = PIECE_SIZE[d.kind];
    return satori(overlay(d, layout, frame) as any, { width, height, fonts: fonts() });
}

/**
 * JPG final: la portada (o foto base) como fondo según backgroundMode (recortada con el encuadre de móvil, o completa
 * sobre su versión difuminada) + capa de texto; sin foto, un fondo oscuro liso. Lanza si sharp no está disponible
 * (sin imagen no se publica: la serie marca el slot como fallido).
 */
export async function renderPiece(d: PieceData, baseImage: Buffer | null, opts: BaseImageOptions = {}): Promise<Buffer> {
    const sharp = await loadSharp();
    if (!sharp) throw new Error("sharp no disponible: no se puede generar la imagen");
    const { width, height } = PIECE_SIZE[d.kind];
    let background: Buffer | null = null;
    let frame: Frame | null = null;
    let layout: Layout = "plain";
    if (baseImage) {
        try {
            // Base normalizada: orientación EXIF, primer cuadro (GIF), sin alfa
            const { data: base, info } = await sharp(baseImage, { failOn: "none", animated: false })
                .rotate()
                .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
                .flatten({ background: "#111111" })
                .toBuffer({ resolveWithObject: true });
            layout = backgroundMode(info.width / info.height, d.kind, opts.fit);
            if (layout === "fill") {
                // Recorte con el encuadre vertical elegido para la portada en móvil (por defecto, al centro)
                const scale = Math.max(width / info.width, height / info.height);
                const sw = Math.max(width, Math.round(info.width * scale));
                const sh = Math.max(height, Math.round(info.height * scale));
                const posY = Math.min(100, Math.max(0, Number.isFinite(Number(opts.positionY)) ? Number(opts.positionY) : 50));
                background = await sharp(base)
                    .resize(sw, sh)
                    .extract({ left: Math.round((sw - width) / 2), top: Math.round(((sh - height) * posY) / 100), width, height })
                    .modulate({ brightness: 0.85 })
                    .toBuffer();
            } else {
                // Portada completa sobre una versión difuminada y oscurecida de sí misma
                background = await sharp(base).resize(width, height, { fit: "cover" }).blur(40).modulate({ brightness: 0.5, saturation: 1.15 }).toBuffer();
                const box = FRAME_BOX[d.kind];
                const { data: card, info: cardInfo } = await sharp(base).resize(box.width, box.height, { fit: "inside" }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
                frame = { src: `data:image/jpeg;base64,${card.toString("base64")}`, width: cardInfo.width, height: cardInfo.height };
            }
        } catch (err: any) {
            console.warn("socialSeriesRender: foto base ilegible, se usa fondo liso:", err?.message || err);
            background = null;
            frame = null;
            layout = "plain";
        }
    }
    if (!background) {
        background = await sharp({ create: { width, height, channels: 3, background: d.styleIndex % 2 ? "#1f2937" : "#111827" } }).png().toBuffer();
    }
    const svg = await renderOverlaySvg(d, layout, frame);
    return sharp(background)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .jpeg({ quality: 86, mozjpeg: true })
        .toBuffer();
}

const dayFmt = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
/** "domingo 8 de noviembre" a partir de YYYY-MM-DD (ICU pone "domingo, 8 de…": la coma sobra en la pieza y en el DM). */
export const longDateLabel = (date: string) => dayFmt.format(new Date(`${String(date).slice(0, 10)}T12:00:00Z`)).replace(/^([^,\s]+),\s*/, "$1 ");
