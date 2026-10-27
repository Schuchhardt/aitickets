// Imagen para compartir (og:image / twitter:image) de cada página pública que no es un evento ni un sitio de
// productor: qué dice cada tarjeta y en qué URL queda. Las genera en el build src/pages/og/paginas/[page].jpg.ts
// (render en src/lib/ogCard.ts) y las usa src/layouts/Layout.astro según la ruta canónica.
//
// La URL lleva ?v=<hash del contenido de la tarjeta>: al cambiar un texto o una foto cambia la URL, así WhatsApp,
// Facebook y Slack no siguen mostrando la versión que tienen en caché.
import { createHash } from "node:crypto";
import { COMPARISONS } from "../data/comparisons";
import { LANDINGS } from "../data/landings";

/** Subir al cambiar el diseño (src/lib/ogCard.ts) para invalidar las cachés de las redes. */
const OG_CARD_RENDER_VERSION = "c1";

export type OgCard = {
  /** Línea chica sobre el título, en lima. */
  eyebrow: string;
  /** Titular (corto: se lee en una miniatura). */
  title: string;
  /** Píldora de abajo. */
  badge: string;
  /** Fotos de public/: una llena el panel derecho; varias arman un mosaico. */
  photos: string[];
  /** Texto alternativo (og:image:alt). */
  alt: string;
};

const BADGE = "0% de comisión para el productor";
const p = (name: string) => `/landing/${name}.jpg`;

/** Mosaico de nichos (el mismo espíritu del hero de la portada). */
const MOSAIC = [
  "aitk-comediante",
  "aitk-teatro",
  "aitk-musica",
  "aitk-club-vip",
  "aitk-fiesta-universitaria",
  "aitk-puerta-qr",
  "aitk-taller-tallerista",
  "aitk-seminario-acreditacion",
  "aitk-acad-teatro",
].map(p);

/** Foto de cada landing (la de su hero). Las que no están usan el mosaico. */
const LANDING_PHOTO: Record<string, string> = {
  "ticketera-stand-up": p("aitk-hero-standup"),
  "ticketera-teatro": p("aitk-teatro-funcion"),
  "ticketera-musica-en-vivo": p("aitk-musica-sala"),
  "ticketera-discotecas": p("aitk-club-pista"),
  "ticketera-fiestas": p("aitk-fiesta-pista"),
  "ticketera-seminarios": p("aitk-seminario-sala"),
  "ticketera-talleres": p("aitk-taller-clase"),
  academias: p("aitk-acad-recital"),
  "vender-entradas-online": p("aitk-publico"),
  "entradas-con-qr": p("aitk-puerta-qr"),
  "ventas-por-promotor": p("aitk-fiesta-promotor"),
};

const card = (eyebrow: string, title: string, photos: string[] = MOSAIC, badge = BADGE): OgCard => ({
  eyebrow,
  title,
  badge,
  photos,
  alt: `${title} · AI Tickets`,
});

const landingCard = (slug: string, eyebrow: string, title: string) => card(eyebrow, title, LANDING_PHOTO[slug] ? [LANDING_PHOTO[slug]] : MOSAIC);

/** Tarjetas fijas por ruta canónica. */
const CARDS: Record<string, OgCard> = {
  "/": card("Ticketera para productores en Chile", "Tu próxima función, sea cual sea el escenario."),
  "/organizadores": card("AI Tickets para productores", "Tu próxima función merece vender más.", [p("aitk-productor")]),
  "/precios": card("Precios sin letra chica", "0% de comisión para el productor", [p("aitk-publico")], "Sin mensualidad"),
  "/eventos": card("Próximos eventos en Chile", "Encuentra tu próxima función y compra tu entrada", MOSAIC, "Entradas online con QR"),
  "/ticketeras-en-chile": card("Comparación con fuentes", "Ticketeras en Chile: cuánto cobra cada una", [p("aitk-publico")]),
  "/web-gratis": card("Para productoras", "Tu web de eventos gratis", [p("aitk-musica")]),
  "/guias": card("Guías para productores", "Lo práctico de vender entradas y llenar tus funciones", [p("aitk-backstage")]),
  "/presentacion": card("Presentación de AI Tickets", "¿Y si cada función estuviera llena?", [p("aitk-publico")]),
  "/organizadores/registro": card("Crea tu cuenta gratis", "Publica tu próxima función hoy", [p("aitk-seminario-organizadora")]),
  "/terms": card("Legal", "Términos y condiciones para compradores"),
  "/privacy": card("Legal", "Aviso de privacidad"),
  "/terminos-productores": card("Legal", "Términos para productores"),
  "/bot": card("AITicketsBot", "El agente que revisa eventos publicados en la web"),
  ...Object.fromEntries(LANDINGS.map((l) => [`/${l.slug}`, landingCard(l.slug, l.eyebrow, l.h1)])),
  ...Object.fromEntries(COMPARISONS.map((c) => [`/comparar/${c.slug}`, card("Comparación de ticketeras", `AI Tickets vs ${c.name}`)])),
};

/** Tarjeta de una guía (src/content/guias): la foto de su landing. */
export function guideOgCard(guide: { data: { title: string; landing: string } }): OgCard {
  return card("Guía para productores", guide.data.title, LANDING_PHOTO[guide.data.landing] ? [LANDING_PHOTO[guide.data.landing]] : MOSAIC);
}

/** "/" → "inicio"; "/comparar/passline" → "comparar--passline". */
export function ogPageKey(pathname: string): string {
  const clean = pathname.replace(/\.html$/, "").replace(/^\/+|\/+$/g, "");
  return clean ? clean.replace(/\//g, "--") : "inicio";
}

export const DEFAULT_OG_CARD = CARDS["/"];

/** Tarjetas fijas (sin las guías), por clave de archivo. */
export function staticOgCards(): Record<string, OgCard> {
  return Object.fromEntries(Object.entries(CARDS).map(([route, c]) => [ogPageKey(route), c]));
}

export function ogCardForPath(pathname: string): OgCard | null {
  return CARDS[pathname.replace(/\.html$/, "").replace(/(.)\/+$/, "$1")] ?? null;
}

/** Ruta versionada de la imagen de una tarjeta: /og/paginas/<clave>.jpg?v=<hash>. */
export function ogCardImagePath(key: string, c: OgCard): string {
  const v = createHash("sha256").update(`${OG_CARD_RENDER_VERSION}:${JSON.stringify(c)}`).digest("hex").slice(0, 12);
  return `/og/paginas/${key}.jpg?v=${v}`;
}

/** Imagen genérica de AI Tickets (la de la portada): fallback de eventos sin portada y de páginas sin tarjeta. */
export function defaultOgImagePath(): string {
  return ogCardImagePath("inicio", DEFAULT_OG_CARD);
}
