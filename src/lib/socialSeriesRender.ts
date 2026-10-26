// Imagen de cada pieza de las historias automáticas (docs/specs/historias-automaticas.md): historia 1080×1920 y post
// de feed 1080×1350, en JPG. Se genera en el servidor desde una plantilla (Satori: texto → vectores, sin depender de
// las fuentes del sistema) sobre la foto base del evento (sharp), NO con IA: los datos (fecha, lugar, cuenta regresiva,
// entradas que quedan) salen exactos. La cuenta de entradas se lee al renderizar (unas 2 h antes de publicar).
//
// Zonas seguras de Instagram: en la historia los primeros y últimos ~250 px los tapa la interfaz, así que el contenido
// va entre y=260 y y=1660. Cada pieza varía color y alineación respecto de la anterior (styleIndex).
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

function overlay(d: PieceData): Node {
    const { width, height } = PIECE_SIZE[d.kind];
    const t = pieceText(d);
    const accent = ACCENTS[Math.abs(d.styleIndex) % ACCENTS.length];
    const centered = d.styleIndex % 2 === 1;
    const story = d.kind === "story";
    const pad = 80;
    const big = t.bigLines.length > 1;
    const align = centered ? "center" : "flex-start";
    const textAlign = centered ? "center" : "left";

    const bigBlock = big
        ? h({ flexDirection: "column", alignItems: align, lineHeight: 1 }, [
              h({ fontFamily: "Prompt", fontWeight: 700, fontSize: story ? 72 : 60, color: "#ffffff", textTransform: "uppercase", letterSpacing: 6 }, t.bigLines[0]),
              h({ fontFamily: "Unbounded", fontWeight: 700, fontSize: story ? 360 : 280, color: accent, marginTop: story ? 10 : 0, lineHeight: 1 }, t.bigLines[1]),
              h({ fontFamily: "Unbounded", fontWeight: 700, fontSize: story ? 110 : 90, color: "#ffffff", lineHeight: 1 }, t.bigLines[2]),
          ])
        : h({ fontFamily: "Unbounded", fontWeight: 700, fontSize: wordSize(t.bigLines[0], width - 2 * pad, story ? 190 : 160), color: accent, lineHeight: 1 }, t.bigLines[0]);

    const children: Node[] = [
        h({ flexDirection: "column", alignItems: align, gap: 18 }, [
            t.kicker ? h({ fontFamily: "Unbounded", fontWeight: 700, fontSize: titleSize(t.kicker, d.kind), color: "#ffffff", textAlign, lineHeight: 1.15 }, t.kicker) : null,
        ].filter(Boolean)),
        bigBlock,
        h({ flexDirection: "column", alignItems: align, gap: 16 }, [
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
        ].filter(Boolean)),
    ];

    return h(
        {
            width,
            height,
            flexDirection: "column",
            justifyContent: "space-between",
            alignItems: align,
            padding: story ? `260px ${pad}px 260px` : `${pad}px`,
            backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 35%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0.88) 100%)",
        },
        children,
    );
}

/** SVG de la capa de texto (transparente). */
export async function renderOverlaySvg(d: PieceData): Promise<string> {
    const { width, height } = PIECE_SIZE[d.kind];
    return satori(overlay(d) as any, { width, height, fonts: fonts() });
}

/**
 * JPG final: foto base recortada al formato (o un fondo oscuro si no hay foto) + capa de texto. Lanza si sharp no
 * está disponible (sin imagen no se publica: la serie marca el slot como fallido).
 */
export async function renderPiece(d: PieceData, baseImage: Buffer | null): Promise<Buffer> {
    const sharp = await loadSharp();
    if (!sharp) throw new Error("sharp no disponible: no se puede generar la imagen");
    const { width, height } = PIECE_SIZE[d.kind];
    let background: Buffer | null = null;
    if (baseImage) {
        try {
            background = await sharp(baseImage, { failOn: "none", animated: false })
                .rotate()
                .resize(width, height, { fit: "cover", position: "attention" })
                .flatten({ background: "#111111" })
                .modulate({ brightness: 0.85 })
                .toBuffer();
        } catch (err: any) {
            console.warn("socialSeriesRender: foto base ilegible, se usa fondo liso:", err?.message || err);
        }
    }
    if (!background) {
        background = await sharp({ create: { width, height, channels: 3, background: d.styleIndex % 2 ? "#1f2937" : "#111827" } }).png().toBuffer();
    }
    const svg = await renderOverlaySvg(d);
    return sharp(background)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .jpeg({ quality: 86, mozjpeg: true })
        .toBuffer();
}

const dayFmt = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
/** "domingo 8 de noviembre" a partir de YYYY-MM-DD (ICU pone "domingo, 8 de…": la coma sobra en la pieza y en el DM). */
export const longDateLabel = (date: string) => dayFmt.format(new Date(`${String(date).slice(0, 10)}T12:00:00Z`)).replace(/^([^,\s]+),\s*/, "$1 ");
