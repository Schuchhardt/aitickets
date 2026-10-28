// Plantillas y secciones de los sitios de productores. Módulo puro (sin BD ni Node): lo usan el servidor
// (src/lib/sites.ts, /api/sites), el sitio público (src/components/sites/SitePage.vue, también en el navegador para la
// vista previa en vivo) y el editor del panel.
//
// Plantillas:
//   * Generales (clasico, nocturno, minimal, festival): las originales.
//   * Por nicho (teatro, musica, fiestas, clubs, standup, seminarios, talleres, academias): toman el lenguaje visual de
//     cada landing de nicho (src/styles/landing-<nicho>.css): mismos colores, tipografía de titulares y recursos
//     (filetes dorados del programa de mano, afiche de gira, stickers, letrero LED...). Los recursos viven en
//     src/styles/site-niches.css con scope [data-niche="<plantilla>"]; los colores salen siempre del tema (el productor
//     los puede cambiar).
//
// Secciones (content.sections): lista ordenada que arma la página de inicio. Cada sección tiene un tipo, datos de texto
// plano (nunca HTML: se renderizan como texto) y puede ocultarse. "Sobre nosotros" usa content.about (HTML saneado).
// Un sitio sin content.sections se ve con la plantilla original (src/components/sites/templates/*).

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------
export const LEGACY_TEMPLATES = ["clasico", "nocturno", "minimal", "festival"] as const;
export const NICHE_TEMPLATES = ["teatro", "musica", "fiestas", "clubs", "standup", "seminarios", "talleres", "academias"] as const;
export type SiteTemplate = (typeof LEGACY_TEMPLATES)[number] | (typeof NICHE_TEMPLATES)[number];
export const SITE_TEMPLATES: SiteTemplate[] = [...LEGACY_TEMPLATES, ...NICHE_TEMPLATES];

export const SITE_FONTS = [
  "Unbounded",
  "Prompt",
  "Inter",
  "Montserrat",
  "Playfair Display",
  "Space Grotesk",
  "Bebas Neue",
  // Las de las landings de nicho (servidas desde el sitio con @fontsource, src/styles/site-niches.css)
  "Bodoni Moda",
  "Anton",
  "Bagel Fat One",
  "Doto",
  "Archivo",
  "Bricolage Grotesque",
];

/** Fuentes que se cargan desde Google Fonts (las demás vienen de @fontsource en global.css y site-niches.css). */
export const GOOGLE_FONT_QUERIES: Record<string, string> = {
  Inter: "Inter:wght@400;500;600;700",
  Montserrat: "Montserrat:wght@400;500;600;700",
  "Playfair Display": "Playfair+Display:wght@400;600;700",
  "Space Grotesk": "Space+Grotesk:wght@400;500;600;700",
  "Bebas Neue": "Bebas+Neue",
};

// @fontsource-variable publica las fuentes variables con el sufijo "Variable"
const VARIABLE_FONTS: Record<string, string> = { "Bodoni Moda": "Bodoni Moda Variable", Archivo: "Archivo Variable" };

/** Valor de font-family para la tipografía de titulares del tema. */
export function fontStack(font: string | undefined): string {
  const f = font || "Unbounded";
  return [VARIABLE_FONTS[f], f].filter(Boolean).map((name) => `'${name}'`).join(", ") + ", 'Prompt', system-ui, sans-serif";
}

export type HeroLayout = "split" | "overlay" | "centered";
export type EventsLayout = "cards" | "posters" | "list";

export interface TemplateDefaults {
  primary: string;
  accent: string;
  background: string;
  text: string;
  font: string;
  dark: boolean;
}

export interface TemplateInfo {
  name: string;
  description: string;
  /** "nicho" se muestra primero en el editor, agrupado por tipo de evento. */
  group: "nicho" | "general";
  defaults: TemplateDefaults;
  hero: HeroLayout;
  events: EventsLayout;
  /** Texto de los botones de compra. */
  buyLabel: string;
  copy: {
    heroEyebrow: string;
    eventsEyebrow: string;
    eventsTitle: string;
    emptyEvents: string;
    aboutEyebrow: string;
    aboutTitle: string;
    highlightsEyebrow: string;
    highlightsTitle: string;
    highlights: { title: string; text: string }[];
    contactTitle: string;
    contactText: string;
  };
}

// Lo que se promete en "Antes de ir" es lo que hace AI Tickets en todas las compras: nada de políticas inventadas.
const PLATFORM_HIGHLIGHTS = {
  online: { title: "Compra online", text: "Compra en minutos desde el celular o el computador, con pago seguro." },
  qr: { title: "Tu entrada en el celular", text: "Te llega por correo con un código QR para mostrar en la entrada." },
  functions: { title: "Elige tu función", text: "Revisa las fechas y horarios disponibles y elige la que te acomoda." },
};

export const TEMPLATE_INFO: Record<SiteTemplate, TemplateInfo> = {
  clasico: {
    name: "Clásico",
    description: "Fondo claro, tipografía marcada. Sirve para cualquier tipo de evento.",
    group: "general",
    defaults: { primary: "#111827", accent: "#a3e635", background: "#ffffff", text: "#111827", font: "Unbounded", dark: false },
    hero: "split",
    events: "cards",
    buyLabel: "Comprar entradas",
    copy: {
      heroEyebrow: "",
      eventsEyebrow: "",
      eventsTitle: "Próximos eventos",
      emptyEvents: "Pronto anunciaremos nuevos eventos.",
      aboutEyebrow: "",
      aboutTitle: "Sobre nosotros",
      highlightsEyebrow: "",
      highlightsTitle: "Cómo comprar",
      highlights: [PLATFORM_HIGHLIGHTS.online, PLATFORM_HIGHLIGHTS.qr, PLATFORM_HIGHLIGHTS.functions],
      contactTitle: "¿Quieres contactarnos?",
      contactText: "Escríbenos y te responderemos a tu correo.",
    },
  },
  nocturno: {
    name: "Nocturno",
    description: "Fondo oscuro y acentos neón. Para fiestas, música y vida nocturna.",
    group: "general",
    defaults: { primary: "#a78bfa", accent: "#f472b6", background: "#0b0b12", text: "#f5f5f5", font: "Space Grotesk", dark: true },
    hero: "overlay",
    events: "cards",
    buyLabel: "Comprar entradas",
    copy: {
      heroEyebrow: "",
      eventsEyebrow: "Agenda",
      eventsTitle: "Próximos eventos",
      emptyEvents: "Pronto anunciaremos nuevas fechas.",
      aboutEyebrow: "Nosotros",
      aboutTitle: "Quiénes somos",
      highlightsEyebrow: "Entradas",
      highlightsTitle: "Cómo comprar",
      highlights: [PLATFORM_HIGHLIGHTS.online, PLATFORM_HIGHLIGHTS.qr, PLATFORM_HIGHLIGHTS.functions],
      contactTitle: "Hablemos",
      contactText: "Reservas, prensa o colaboraciones: escríbenos.",
    },
  },
  minimal: {
    name: "Minimal",
    description: "Sobria, mucho aire y eventos en lista.",
    group: "general",
    defaults: { primary: "#111111", accent: "#111111", background: "#fafafa", text: "#171717", font: "Inter", dark: false },
    hero: "split",
    events: "list",
    buyLabel: "Entradas",
    copy: {
      heroEyebrow: "",
      eventsEyebrow: "",
      eventsTitle: "Próximos eventos",
      emptyEvents: "Pronto anunciaremos nuevos eventos.",
      aboutEyebrow: "",
      aboutTitle: "Sobre nosotros",
      highlightsEyebrow: "",
      highlightsTitle: "Cómo comprar",
      highlights: [PLATFORM_HIGHLIGHTS.online, PLATFORM_HIGHLIGHTS.qr, PLATFORM_HIGHLIGHTS.functions],
      contactTitle: "Contacto",
      contactText: "Escríbenos y te responderemos a tu correo.",
    },
  },
  festival: {
    name: "Festival",
    description: "Colores intensos, títulos grandes y eventos como pósters.",
    group: "general",
    defaults: { primary: "#f97316", accent: "#facc15", background: "#fff7ed", text: "#1c1917", font: "Bebas Neue", dark: false },
    hero: "split",
    events: "posters",
    buyLabel: "Comprar entradas",
    copy: {
      heroEyebrow: "",
      eventsEyebrow: "",
      eventsTitle: "Próximos eventos",
      emptyEvents: "Pronto anunciaremos nuevos eventos.",
      aboutEyebrow: "",
      aboutTitle: "Sobre nosotros",
      highlightsEyebrow: "",
      highlightsTitle: "Cómo comprar",
      highlights: [PLATFORM_HIGHLIGHTS.online, PLATFORM_HIGHLIGHTS.qr, PLATFORM_HIGHLIGHTS.functions],
      contactTitle: "¿Quieres contactarnos?",
      contactText: "Escríbenos y te responderemos a tu correo.",
    },
  },

  // --- Por nicho (mismo lenguaje que cada landing) ---
  teatro: {
    name: "Teatro",
    description: "Programa de mano y luz de sala: azul noche, dorado de palco y Bodoni.",
    group: "nicho",
    defaults: { primary: "#d4af6a", accent: "#5a1426", background: "#0c1220", text: "#f0e8d8", font: "Bodoni Moda", dark: true },
    hero: "centered",
    events: "posters",
    buyLabel: "Reservar entradas",
    copy: {
      heroEyebrow: "Temporada",
      eventsEyebrow: "Cartelera",
      eventsTitle: "En escena",
      emptyEvents: "Pronto anunciaremos la próxima temporada.",
      aboutEyebrow: "La compañía",
      aboutTitle: "Quiénes somos",
      highlightsEyebrow: "Antes de la función",
      highlightsTitle: "Tu entrada, sin filas",
      highlights: [PLATFORM_HIGHLIGHTS.functions, PLATFORM_HIGHLIGHTS.online, PLATFORM_HIGHLIGHTS.qr],
      contactTitle: "Funciones privadas y prensa",
      contactText: "Colegios, empresas o medios: escríbenos y te respondemos.",
    },
  },
  musica: {
    name: "Música en vivo",
    description: "Afiche de gira: negro escenario, rojo de sala y Anton en mayúsculas.",
    group: "nicho",
    defaults: { primary: "#ff3b30", accent: "#eee9df", background: "#0a0a0d", text: "#f2f0eb", font: "Anton", dark: true },
    hero: "overlay",
    events: "list",
    buyLabel: "Entradas",
    copy: {
      heroEyebrow: "En vivo",
      eventsEyebrow: "Gira",
      eventsTitle: "Próximas fechas",
      emptyEvents: "Nuevas fechas muy pronto.",
      aboutEyebrow: "Bio",
      aboutTitle: "La banda",
      highlightsEyebrow: "Entradas",
      highlightsTitle: "Directo a la puerta",
      highlights: [PLATFORM_HIGHLIGHTS.online, PLATFORM_HIGHLIGHTS.qr, PLATFORM_HIGHLIGHTS.functions],
      contactTitle: "Booking y prensa",
      contactText: "¿Quieres llevarnos a tu escenario? Escríbenos.",
    },
  },
  fiestas: {
    name: "Fiestas",
    description: "Pulsera, sticker y desechable: naranjo, cobalto y crema a todo color.",
    group: "nicho",
    defaults: { primary: "#ff5b14", accent: "#2b36ff", background: "#fff4e4", text: "#16110d", font: "Bagel Fat One", dark: false },
    hero: "split",
    events: "posters",
    buyLabel: "Quiero mi entrada",
    copy: {
      heroEyebrow: "¡Se viene!",
      eventsEyebrow: "Próximas fiestas",
      eventsTitle: "Anótate en la próxima",
      emptyEvents: "La próxima fiesta se anuncia muy pronto.",
      aboutEyebrow: "Quiénes somos",
      aboutTitle: "La fiesta la hacemos todos",
      highlightsEyebrow: "Entradas",
      highlightsTitle: "Así de fácil",
      highlights: [PLATFORM_HIGHLIGHTS.online, PLATFORM_HIGHLIGHTS.qr, { title: "Compra con tiempo", text: "Las preventas se agotan: compra antes y asegura tu lugar." }],
      contactTitle: "¿Celebras algo?",
      contactText: "Cumpleaños, empresas o colaboraciones: escríbenos.",
    },
  },
  clubs: {
    name: "Clubs y discotecas",
    description: "Luz negra: negro violáceo, rosa flúor y letrero LED.",
    group: "nicho",
    defaults: { primary: "#ff4fb8", accent: "#8a5cff", background: "#07060b", text: "#eeeaf8", font: "Doto", dark: true },
    hero: "overlay",
    events: "list",
    buyLabel: "Entrar",
    copy: {
      heroEyebrow: "Esta noche",
      eventsEyebrow: "Próximas noches",
      eventsTitle: "La semana",
      emptyEvents: "Las próximas noches se anuncian muy pronto.",
      aboutEyebrow: "El club",
      aboutTitle: "Quiénes somos",
      highlightsEyebrow: "Puerta",
      highlightsTitle: "Entra sin fila",
      highlights: [PLATFORM_HIGHLIGHTS.online, PLATFORM_HIGHLIGHTS.qr, { title: "Elige tu noche", text: "Revisa la cartelera de la semana y compra para la noche que quieras." }],
      contactTitle: "Mesas, cumpleaños y eventos",
      contactText: "Escríbenos para reservar o cotizar.",
    },
  },
  standup: {
    name: "Stand-up",
    description: "Luz de escenario sobre fondo cálido y oscuro, con notas en cursiva.",
    group: "nicho",
    defaults: { primary: "#a3e635", accent: "#e9dccb", background: "#0e0b09", text: "#f4ede4", font: "Unbounded", dark: true },
    hero: "overlay",
    events: "cards",
    buyLabel: "Comprar entradas",
    copy: {
      heroEyebrow: "Comedia en vivo",
      eventsEyebrow: "Próximos shows",
      eventsTitle: "Cartelera",
      emptyEvents: "Pronto anunciaremos nuevos shows.",
      aboutEyebrow: "Detrás del micrófono",
      aboutTitle: "Quiénes somos",
      highlightsEyebrow: "Antes del show",
      highlightsTitle: "Llega y ríete",
      highlights: [PLATFORM_HIGHLIGHTS.functions, PLATFORM_HIGHLIGHTS.online, PLATFORM_HIGHLIGHTS.qr],
      contactTitle: "Shows privados y empresas",
      contactText: "¿Quieres un show para tu evento? Escríbenos.",
    },
  },
  seminarios: {
    name: "Seminarios y congresos",
    description: "Credencial y programa: papel neutro, grafito y turquesa del cordón.",
    group: "nicho",
    defaults: { primary: "#006b65", accent: "#00877f", background: "#f5f5f0", text: "#15191c", font: "Archivo", dark: false },
    hero: "split",
    events: "list",
    buyLabel: "Inscribirme",
    copy: {
      heroEyebrow: "Programa",
      eventsEyebrow: "Próximos encuentros",
      eventsTitle: "Agenda",
      emptyEvents: "Pronto publicaremos el próximo encuentro.",
      aboutEyebrow: "Organiza",
      aboutTitle: "Quiénes somos",
      highlightsEyebrow: "Inscripción",
      highlightsTitle: "Acreditación sin filas",
      highlights: [PLATFORM_HIGHLIGHTS.online, { title: "Credencial en tu correo", text: "Recibes tu entrada con código QR para acreditarte el día del evento." }, PLATFORM_HIGHLIGHTS.functions],
      contactTitle: "Empresas y auspicios",
      contactText: "Inscripciones grupales, auspicios o prensa: escríbenos.",
    },
  },
  talleres: {
    name: "Talleres",
    description: "Cuaderno de taller: papel cuadriculado, fichas y destacador amarillo.",
    group: "nicho",
    defaults: { primary: "#2547c5", accent: "#ffe45c", background: "#f4f6f1", text: "#1f2329", font: "Bricolage Grotesque", dark: false },
    hero: "split",
    events: "cards",
    buyLabel: "Reservar mi cupo",
    copy: {
      heroEyebrow: "Talleres",
      eventsEyebrow: "Próximos talleres",
      eventsTitle: "Elige tu taller",
      emptyEvents: "Pronto abriremos nuevos talleres.",
      aboutEyebrow: "Quién enseña",
      aboutTitle: "Sobre el taller",
      highlightsEyebrow: "Inscripción",
      highlightsTitle: "Reserva tu cupo",
      highlights: [PLATFORM_HIGHLIGHTS.functions, PLATFORM_HIGHLIGHTS.online, { title: "Confirmación al instante", text: "Te llega un correo con tu inscripción y los datos del taller." }],
      contactTitle: "Talleres a medida",
      contactText: "Para grupos, colegios o empresas: escríbenos.",
    },
  },
  academias: {
    name: "Academias y cursos",
    description: "Claro y cálido: papel, tinta y notas en cursiva.",
    group: "nicho",
    defaults: { primary: "#1b1712", accent: "#a3e635", background: "#fbf7f0", text: "#1b1712", font: "Unbounded", dark: false },
    hero: "split",
    events: "cards",
    buyLabel: "Inscribirme",
    copy: {
      heroEyebrow: "Inscripciones abiertas",
      eventsEyebrow: "Cursos y clases",
      eventsTitle: "Próximas clases",
      emptyEvents: "Pronto abriremos nuevas inscripciones.",
      aboutEyebrow: "La academia",
      aboutTitle: "Quiénes somos",
      highlightsEyebrow: "Inscripción",
      highlightsTitle: "Inscríbete en minutos",
      highlights: [PLATFORM_HIGHLIGHTS.online, { title: "Confirmación al instante", text: "Te llega un correo con tu inscripción y los datos de la clase." }, PLATFORM_HIGHLIGHTS.functions],
      contactTitle: "¿Tienes dudas?",
      contactText: "Escríbenos y te ayudamos a elegir tu curso.",
    },
  },
};

export const TEMPLATE_DEFAULTS: Record<SiteTemplate, TemplateDefaults> = Object.fromEntries(
  SITE_TEMPLATES.map((t) => [t, TEMPLATE_INFO[t].defaults])
) as Record<SiteTemplate, TemplateDefaults>;

export const isNicheTemplate = (t: unknown): boolean => (NICHE_TEMPLATES as readonly string[]).includes(String(t));

// ---------------------------------------------------------------------------
// Tema
// ---------------------------------------------------------------------------
export interface SiteThemeInput {
  primary?: string;
  accent?: string;
  background?: string;
  text?: string;
  font?: string;
  logo_url?: string;
  hero_image_url?: string;
  dark?: boolean;
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isSafeHttpUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Tema final (valores del productor validados + defaults de la plantilla). */
export function resolveThemeFor(template: SiteTemplate, theme: SiteThemeInput | null | undefined): SiteThemeInput & { dark: boolean } {
  const defaults = TEMPLATE_DEFAULTS[template] || TEMPLATE_DEFAULTS.clasico;
  const t = theme || {};
  const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX_RE.test(v.trim()) ? v.trim() : fallback);
  return {
    primary: color(t.primary, defaults.primary),
    accent: color(t.accent, defaults.accent),
    background: color(t.background, defaults.background),
    text: color(t.text, defaults.text),
    font: typeof t.font === "string" && SITE_FONTS.includes(t.font) ? t.font : defaults.font,
    logo_url: isSafeHttpUrl(t.logo_url) ? t.logo_url : undefined,
    hero_image_url: isSafeHttpUrl(t.hero_image_url) ? t.hero_image_url : undefined,
    dark: typeof t.dark === "boolean" ? t.dark : defaults.dark,
  };
}

/** Texto legible sobre un color de fondo (#111 o #fff según su luminancia). */
export function readableOn(hex: string | undefined): string {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return "#111111";
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Umbral donde el contraste con negro y con blanco se iguala
  return luminance > 0.179 ? "#111111" : "#ffffff";
}

// ---------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------
export const SECTION_TYPES = ["hero", "events", "about", "highlights", "gallery", "video", "faq", "testimonials", "cta", "contact"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export interface SectionItem {
  title?: string;
  text?: string;
  question?: string;
  answer?: string;
  quote?: string;
  author?: string;
  image_url?: string;
  caption?: string;
}

export interface SectionData {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  text?: string;
  button_label?: string;
  button_url?: string;
  image_url?: string;
  url?: string;
  layout?: EventsLayout;
  items?: SectionItem[];
}

export interface SiteSection {
  id: string;
  type: SectionType;
  hidden?: boolean;
  data: SectionData;
}

export const SECTION_INFO: Record<SectionType, { name: string; description: string; single?: boolean; maxItems?: number }> = {
  hero: { name: "Portada", description: "Título grande, frase e imagen principal.", single: true },
  events: { name: "Próximos eventos", description: "Tus eventos publicados, siempre al día.", single: true },
  about: { name: "Sobre nosotros", description: "Quiénes son y qué hacen." },
  highlights: { name: "Destacados", description: "Tres a seis puntos cortos (cómo comprar, qué incluye...).", maxItems: 6 },
  gallery: { name: "Galería", description: "Fotos de funciones, fiestas o clases anteriores.", maxItems: 12 },
  video: { name: "Video", description: "Un video de YouTube o Vimeo." },
  faq: { name: "Preguntas frecuentes", description: "Preguntas y respuestas.", maxItems: 12 },
  testimonials: { name: "Opiniones", description: "Lo que dice tu público o la prensa.", maxItems: 6 },
  cta: { name: "Llamado a la acción", description: "Un mensaje con un botón." },
  contact: { name: "Contacto", description: "Invita a escribirte por el formulario.", single: true },
};

export const MAX_SECTIONS = 20;

const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  // Sin caracteres de control (salvo saltos de línea), sin espacios repetidos al borde
  const s = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
  return s || undefined;
};
const cleanLine = (v: unknown, max: number) => clean(typeof v === "string" ? v.replace(/\s*\n\s*/g, " ") : v, max);

function cleanUrl(v: unknown, { allowAnchors = false } = {}): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (allowAnchors && /^#[a-z0-9-]{1,40}$/i.test(s)) return s;
  if (allowAnchors && s === "contacto") return s;
  if (!isSafeHttpUrl(s) || s.length > 1000) return undefined;
  return s;
}

function cleanImage(v: unknown, allowedImages?: Set<string>): string | undefined {
  const url = cleanUrl(v);
  if (!url || !url.startsWith("https://")) return undefined;
  if (allowedImages && !allowedImages.has(url)) return undefined;
  return url;
}

/** Id de sección: corto y estable. */
export function newSectionId(type: string): string {
  return `${type}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanItems(type: SectionType, items: unknown, allowedImages?: Set<string>): SectionItem[] {
  if (!Array.isArray(items)) return [];
  const max = SECTION_INFO[type].maxItems || 0;
  const out: SectionItem[] = [];
  for (const raw of items) {
    if (out.length >= max) break;
    if (!raw || typeof raw !== "object") continue;
    const i = raw as Record<string, unknown>;
    let item: SectionItem | null = null;
    if (type === "highlights") {
      const title = cleanLine(i.title, 80);
      const text = clean(i.text, 300);
      if (title || text) item = { title, text };
    } else if (type === "faq") {
      const question = cleanLine(i.question, 200);
      const answer = clean(i.answer, 1500);
      if (question && answer) item = { question, answer };
    } else if (type === "testimonials") {
      const quote = clean(i.quote, 500);
      if (quote) item = { quote, author: cleanLine(i.author, 100) };
    } else if (type === "gallery") {
      const image_url = cleanImage(i.image_url, allowedImages);
      if (image_url) item = { image_url, caption: cleanLine(i.caption, 140) };
    }
    if (item) out.push(Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)) as SectionItem);
  }
  return out;
}

/**
 * Valida y limpia las secciones (del editor o de la IA). allowedImages: si se indica, solo se aceptan esas URLs de
 * imagen (la IA no puede inventar imágenes; las del productor vienen de /api/sites/upload).
 */
export function sanitizeSections(input: unknown, opts: { allowedImages?: Set<string> } = {}): SiteSection[] {
  if (!Array.isArray(input)) return [];
  const out: SiteSection[] = [];
  const ids = new Set<string>();
  const singles = new Set<SectionType>();
  for (const raw of input) {
    if (out.length >= MAX_SECTIONS) break;
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, any>;
    const type = s.type as SectionType;
    if (!SECTION_TYPES.includes(type)) continue;
    if (SECTION_INFO[type].single) {
      if (singles.has(type)) continue;
      singles.add(type);
    }
    let id = typeof s.id === "string" && /^[a-z0-9-]{1,40}$/i.test(s.id) ? s.id : newSectionId(type);
    while (ids.has(id)) id = newSectionId(type);
    ids.add(id);

    const d = s.data && typeof s.data === "object" ? s.data : {};
    const data: SectionData = {
      eyebrow: cleanLine(d.eyebrow, 60),
      title: cleanLine(d.title, 120),
    };
    if (type === "hero") {
      data.subtitle = clean(d.subtitle, 300);
      data.button_label = cleanLine(d.button_label, 40);
      data.image_url = cleanImage(d.image_url, opts.allowedImages);
    } else if (type === "events") {
      data.text = clean(d.text, 300);
      if (["cards", "posters", "list"].includes(d.layout)) data.layout = d.layout;
    } else if (type === "video") {
      data.text = clean(d.text, 600);
      data.url = videoEmbedUrl(d.url) ? cleanUrl(d.url) : undefined;
    } else if (type === "cta") {
      data.text = clean(d.text, 400);
      data.button_label = cleanLine(d.button_label, 40);
      data.button_url = cleanUrl(d.button_url, { allowAnchors: true });
    } else if (type === "contact") {
      data.text = clean(d.text, 300);
    } else if (type === "highlights" || type === "faq" || type === "testimonials" || type === "gallery") {
      data.items = cleanItems(type, d.items, opts.allowedImages);
    }
    out.push({
      id,
      type,
      ...(s.hidden === true ? { hidden: true } : {}),
      data: Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as SectionData,
    });
  }
  return out;
}

/** Secciones sugeridas de una plantilla (las que no necesitan datos que solo el productor conoce). */
export function defaultSections(template: SiteTemplate): SiteSection[] {
  const info = TEMPLATE_INFO[template] || TEMPLATE_INFO.clasico;
  const c = info.copy;
  const sections: SiteSection[] = [
    { id: "hero", type: "hero", data: { eyebrow: c.heroEyebrow || undefined, button_label: "Ver eventos" } },
    { id: "events", type: "events", data: { eyebrow: c.eventsEyebrow || undefined, title: c.eventsTitle } },
  ];
  if (info.group === "nicho") {
    sections.push({
      id: "highlights",
      type: "highlights",
      data: { eyebrow: c.highlightsEyebrow, title: c.highlightsTitle, items: c.highlights.map((h) => ({ ...h })) },
    });
  }
  sections.push(
    { id: "about", type: "about", data: { eyebrow: c.aboutEyebrow || undefined, title: c.aboutTitle } },
    { id: "contact", type: "contact", data: { title: c.contactTitle, text: c.contactText } }
  );
  return sections.map((s) => ({ ...s, data: Object.fromEntries(Object.entries(s.data).filter(([, v]) => v !== undefined)) }));
}

/** Sección nueva y vacía (con textos de ejemplo de la plantilla) para "Agregar sección". */
export function blankSection(type: SectionType, template: SiteTemplate): SiteSection {
  const fromDefaults = defaultSections(template).find((s) => s.type === type);
  if (fromDefaults) return { ...fromDefaults, id: newSectionId(type) };
  const data: Record<SectionType, SectionData> = {
    hero: {},
    events: {},
    about: { title: "Sobre nosotros" },
    highlights: { title: "Destacados", items: [{ title: "", text: "" }] },
    gallery: { title: "Galería", items: [] },
    video: { title: "Mira cómo se vive", url: "" },
    faq: { title: "Preguntas frecuentes", items: [{ question: "", answer: "" }] },
    testimonials: { title: "Lo que dicen", items: [{ quote: "", author: "" }] },
    cta: { title: "¿Nos vemos en la próxima?", text: "", button_label: "Ver eventos", button_url: "#eventos" },
    contact: { title: "Contacto", text: "Escríbenos y te responderemos a tu correo." },
  };
  return { id: newSectionId(type), type, data: data[type] };
}

/** URL para incrustar un video de YouTube o Vimeo (null si no es de uno de ellos). */
export function videoEmbedUrl(url: unknown): string | null {
  if (typeof url !== "string" || !isSafeHttpUrl(url)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/);
      id = m ? m[1] : null;
    }
  }
  if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/(?:^|\/)(\d{5,12})(?:$|\/)/);
    if (m) return `https://player.vimeo.com/video/${m[1]}`;
  }
  return null;
}

/** Texto plano con párrafos (línea en blanco) → HTML con <p> y <br>, escapado. */
export function plainTextToHtml(text: string | null | undefined): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return String(text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Aplica la respuesta de la IA (secciones nuevas o cambiadas + orden final) sobre las secciones actuales. Con sectionId
 * solo se reemplazan los datos de esa sección. Devuelve las secciones sin sanear (quien llama las sanea).
 */
export function mergeSectionEdits(current: SiteSection[], changed: unknown[], order: string[], sectionId?: string | null): unknown[] {
  const changedList = (Array.isArray(changed) ? changed : []).filter((s): s is Record<string, any> => !!s && typeof s === "object");
  if (sectionId) {
    const target = current.find((s) => s.id === sectionId);
    if (!target) return current;
    const edit = changedList.find((s) => s.id === sectionId) || changedList.find((s) => s.type === target.type);
    if (!edit) return current;
    return current.map((s) => (s.id === sectionId ? { ...s, hidden: edit.hidden === true ? true : s.hidden, data: edit.data || s.data } : s));
  }
  const byId = new Map<string, unknown>(current.map((s) => [s.id, s]));
  for (const s of changedList) if (typeof s.id === "string") byId.set(s.id, s);
  const ids = (Array.isArray(order) && order.length ? order : current.map((s) => s.id)).filter((id) => byId.has(id));
  // Una sección nueva que la IA olvidó poner en el orden va al final
  for (const s of changedList) if (typeof s.id === "string" && !ids.includes(s.id)) ids.push(s.id);
  return [...new Set(ids)].map((id) => byId.get(id));
}
