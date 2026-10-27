// Render de la imagen para compartir de las páginas públicas (WhatsApp, Slack, Facebook, Instagram, LinkedIn, X):
// 1200×630 JPEG bajo OG_MAX_BYTES, con el estilo del rediseño (fondo --brand-ink, título en Unbounded, lima de acento)
// y la foto de la página (o un mosaico de fotos de nichos) a la derecha.
//
// Se genera en el build (src/pages/og/paginas/[page].jpg.ts es prerender): lee las fuentes de node_modules y las fotos
// de public/landing desde disco, así no carga satori ni harfbuzz en las funciones. Las tarjetas (textos y fotos) están
// en src/lib/ogPages.ts.
//
// Composición: lo importante (logo, título) va en la mitad izquierda con buen tamaño; WhatsApp y Slack muestran la
// imagen completa en 1200×630, y donde se ve chica (miniatura cuadrada de WhatsApp o de iMessage) el recorte central
// deja ver la foto y el comienzo del título.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadSharp, OG_HEIGHT, OG_MAX_BYTES, OG_WIDTH } from "./imageOptimize";
import type { OgCard } from "./ogPages";

const INK = "#0a0a0b";
const LIME = "#a3e635";
const MUTED = "#a1a1aa";

const PANEL_X = 700;
const PANEL_W = OG_WIDTH - PANEL_X;
const PAD = 64;

type Node = { type: string; props: Record<string, any> };
const h = (style: Record<string, any>, children?: any): Node => ({ type: "div", props: { style: { display: "flex", ...style }, children } });
const img = (src: string, style: Record<string, any>): Node => ({ type: "img", props: { src, style } });

const root = () => process.cwd();

let fontsPromise: Promise<any[]> | null = null;
function fonts() {
  if (!fontsPromise) {
    const font = (pkg: string, file: string) => readFile(path.join(root(), "node_modules", "@fontsource", pkg, "files", file));
    fontsPromise = Promise.all([
      font("unbounded", "unbounded-latin-700-normal.woff"),
      font("prompt", "prompt-latin-500-normal.woff"),
      font("prompt", "prompt-latin-600-normal.woff"),
    ]).then(([unbounded, prompt500, prompt600]) => [
      { name: "Unbounded", data: unbounded, weight: 700, style: "normal" },
      { name: "Prompt", data: prompt500, weight: 500, style: "normal" },
      { name: "Prompt", data: prompt600, weight: 600, style: "normal" },
    ]);
  }
  return fontsPromise;
}

/** Foto de public/ recortada al tamaño exacto, como data URL (JPEG). */
async function photoDataUrl(publicPath: string, width: number, height: number): Promise<string> {
  const sharp = await loadSharp();
  if (!sharp) throw new Error("sharp no disponible");
  const file = path.join(root(), "public", publicPath.replace(/^\//, ""));
  const buf = await sharp(await readFile(file))
    .resize(width, height, { fit: "cover", position: "attention" })
    .jpeg({ quality: 90 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

async function logoDataUrl(): Promise<string> {
  const buf = await readFile(path.join(root(), "public", "logo-dark.png"));
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/** Tamaño del título según su largo (Unbounded es ancha: ~0,8 em por letra). */
function titleSize(title: string): number {
  const n = title.length;
  if (n <= 28) return 60;
  if (n <= 44) return 52;
  if (n <= 64) return 44;
  return 38;
}

async function panel(card: OgCard): Promise<Node> {
  const photos = card.photos;
  if (photos.length === 1) {
    return h({ position: "absolute", left: PANEL_X, top: 0, width: PANEL_W, height: OG_HEIGHT }, [
      img(await photoDataUrl(photos[0], PANEL_W, OG_HEIGHT), { width: PANEL_W, height: OG_HEIGHT }),
    ]);
  }
  // Mosaico: tres columnas desfasadas, como el hero de la portada
  const gap = 14;
  const colW = Math.floor((PANEL_W + 60 - gap * 2) / 3);
  const tileH = Math.round(colW * 1.3);
  const offsets = [-70, -190, -20];
  const columns = await Promise.all(
    [0, 1, 2].map(async (c) => {
      const tiles = photos.filter((_, i) => i % 3 === c);
      const nodes = await Promise.all(tiles.map(async (p) => img(await photoDataUrl(p, colW * 2, tileH * 2), { width: colW, height: tileH, borderRadius: 18 })));
      return h({ flexDirection: "column", gap, marginTop: offsets[c] }, nodes);
    }),
  );
  return h({ position: "absolute", left: PANEL_X - 20, top: 0, width: PANEL_W + 60, height: OG_HEIGHT, gap, overflow: "hidden" }, columns);
}

async function tree(card: OgCard): Promise<Node> {
  const size = titleSize(card.title);
  // El mosaico empieza con fotos chicas: un fundido más corto para que la primera columna se vea
  const fade = card.photos.length === 1 ? 260 : 150;
  return h({ width: OG_WIDTH, height: OG_HEIGHT, backgroundColor: INK, position: "relative" }, [
    await panel(card),
    // Fundido de la foto hacia el fondo, para que el texto nunca quede sobre la foto
    h({
      position: "absolute",
      left: PANEL_X - 40,
      top: 0,
      width: fade,
      height: OG_HEIGHT,
      backgroundImage: `linear-gradient(90deg, ${INK} 0%, ${INK} 18%, rgba(10,10,11,0.55) 55%, rgba(10,10,11,0) 100%)`,
    }),
    h(
      {
        position: "absolute",
        left: 0,
        top: 0,
        width: PANEL_X + 20,
        height: OG_HEIGHT,
        padding: `${PAD - 8}px ${PAD}px ${PAD}px`,
        flexDirection: "column",
        justifyContent: "space-between",
      },
      [
        img(await logoDataUrl(), { width: 196, height: 42 }),
        h({ flexDirection: "column", gap: 22 }, [
          h({ fontFamily: "Prompt", fontWeight: 600, fontSize: 24, color: LIME, lineHeight: 1.25 }, card.eyebrow),
          h({ fontFamily: "Unbounded", fontWeight: 700, fontSize: size, color: "#ffffff", lineHeight: 1.12, letterSpacing: -0.5 }, card.title),
        ]),
        h({ alignItems: "center", gap: 18 }, [
          h(
            { fontFamily: "Prompt", fontWeight: 600, fontSize: 22, color: INK, backgroundColor: LIME, padding: "10px 22px", borderRadius: 999 },
            card.badge,
          ),
          h({ fontFamily: "Prompt", fontWeight: 500, fontSize: 22, color: MUTED }, "aitickets.cl"),
        ]),
      ],
    ),
  ]);
}

/** JPEG 1200×630 de la tarjeta, bajo OG_MAX_BYTES. Lanza si falta sharp (solo corre en el build). */
export async function renderOgCard(card: OgCard): Promise<Buffer> {
  const sharp = await loadSharp();
  if (!sharp) throw new Error("sharp no disponible: no se pueden generar las imágenes para compartir");
  const { default: satori } = await import("satori");
  const svg = await satori((await tree(card)) as any, { width: OG_WIDTH, height: OG_HEIGHT, fonts: await fonts() });
  const raster = await sharp(Buffer.from(svg)).flatten({ background: INK }).toBuffer();
  let out: Buffer | null = null;
  for (const quality of [84, 78, 72, 64, 56]) {
    out = await sharp(raster).jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
    if (out.length <= OG_MAX_BYTES) break;
  }
  return out!;
}
