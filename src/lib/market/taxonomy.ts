// Taxonomía del mapa de mercado (eventos externos + eventos de AI Tickets): tipos de evento, ticketeras, ciudades y
// regiones de Chile, y las claves normalizadas para agrupar y evitar duplicados. Lo usan el MCP de admin
// (src/lib/admin-api/tools/market.ts) y el modelo de fechas (dateModel.ts). Spec: docs/specs/eventos-externos.md.

export const EVENT_TYPES = [
    "concierto",
    "festival",
    "fiesta",
    "club",
    "stand_up",
    "teatro",
    "danza",
    "infantil",
    "conferencia",
    "taller",
    "deportes",
    "feria",
    "cine",
    "otro",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Cuándo ocurre típicamente: define cómo afectan los feriados y fines de semana largos. */
export type TypeGroup = "noche" | "dia" | "formacion";

type TypeInfo = {
    label: string;
    group: TypeGroup;
    /** Preferencia inicial por día de la semana (0 = domingo … 6 = sábado), 0 a 1. Supuesto que los datos corrigen. */
    weekday: [number, number, number, number, number, number, number];
};

export const TYPE_INFO: Record<EventType, TypeInfo> = {
    concierto: { label: "Concierto / música en vivo", group: "noche", weekday: [0.45, 0.15, 0.25, 0.4, 0.65, 1, 1] },
    festival: { label: "Festival", group: "dia", weekday: [0.8, 0.05, 0.05, 0.1, 0.2, 0.6, 1] },
    fiesta: { label: "Fiesta (electrónica, reggaetón, temática)", group: "noche", weekday: [0.15, 0.05, 0.05, 0.2, 0.45, 0.95, 1] },
    club: { label: "Club / noche de DJ", group: "noche", weekday: [0.1, 0.05, 0.1, 0.3, 0.6, 1, 1] },
    stand_up: { label: "Stand-up / comedia", group: "noche", weekday: [0.5, 0.2, 0.35, 0.55, 0.85, 1, 1] },
    teatro: { label: "Teatro / musical / circo", group: "noche", weekday: [0.8, 0.1, 0.2, 0.5, 0.8, 1, 1] },
    danza: { label: "Danza / ballet", group: "noche", weekday: [0.8, 0.1, 0.2, 0.4, 0.6, 0.9, 1] },
    infantil: { label: "Infantil / familiar", group: "dia", weekday: [0.95, 0.1, 0.1, 0.15, 0.15, 0.3, 1] },
    conferencia: { label: "Conferencia / seminario / congreso", group: "formacion", weekday: [0.05, 0.6, 0.95, 1, 1, 0.6, 0.35] },
    taller: { label: "Taller / curso / clase", group: "formacion", weekday: [0.45, 0.5, 0.7, 0.75, 0.75, 0.5, 1] },
    deportes: { label: "Deportes / carreras / e-sports", group: "dia", weekday: [1, 0.05, 0.1, 0.15, 0.15, 0.2, 0.8] },
    feria: { label: "Feria / gastronomía / exposición", group: "dia", weekday: [0.95, 0.05, 0.05, 0.1, 0.2, 0.5, 1] },
    cine: { label: "Cine / proyección", group: "noche", weekday: [0.8, 0.3, 0.4, 0.6, 0.7, 0.9, 1] },
    otro: { label: "Otro", group: "noche", weekday: [0.7, 0.3, 0.4, 0.5, 0.6, 0.9, 1] },
};

export const isEventType = (v: unknown): v is EventType => typeof v === "string" && (EVENT_TYPES as readonly string[]).includes(v);

/** Cuánto compiten dos tipos por el mismo público (0 a 1). Simétrica; el mismo tipo = 1. */
const AFFINITY_PAIRS: [EventType, EventType, number][] = [
    ["fiesta", "club", 0.8],
    ["concierto", "festival", 0.6],
    ["concierto", "fiesta", 0.3],
    ["concierto", "club", 0.3],
    ["festival", "fiesta", 0.4],
    ["festival", "feria", 0.3],
    ["stand_up", "teatro", 0.5],
    ["teatro", "danza", 0.5],
    ["teatro", "infantil", 0.3],
    ["danza", "infantil", 0.2],
    ["conferencia", "taller", 0.5],
    ["cine", "teatro", 0.2],
    ["feria", "infantil", 0.3],
    ["otro", "concierto", 0.2],
    ["otro", "fiesta", 0.2],
    ["otro", "teatro", 0.2],
];
const AFFINITY = new Map<string, number>();
for (const [a, b, v] of AFFINITY_PAIRS) {
    AFFINITY.set(`${a}|${b}`, v);
    AFFINITY.set(`${b}|${a}`, v);
}
export const affinity = (a: string, b: string) => (a === b ? 1 : AFFINITY.get(`${a}|${b}`) || 0);

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** minúsculas, sin tildes y con espacios simples. */
export const normalizeText = (v: unknown) =>
    String(v ?? "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

/** "Viña del Mar" → "vina_del_mar". */
export const slugKey = (v: unknown) =>
    normalizeText(v)
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

// ---------------------------------------------------------------------------
// Ticketeras
// ---------------------------------------------------------------------------

export const PLATFORM_LABELS: Record<string, string> = {
    aitickets: "AI Tickets",
    passline: "Passline",
    puntoticket: "Puntoticket",
    ticketmaster: "Ticketmaster",
    ticketplus: "Ticketplus",
    eventrid: "Eventrid",
    welcu: "Welcu",
    eventbrite: "Eventbrite",
    joinnus: "Joinnus",
    own_site: "Venta propia (web o boletería del recinto)",
    none: "Sin ticketera (DM, transferencia, puerta o entrada liberada)",
};
export const KNOWN_PLATFORMS = Object.keys(PLATFORM_LABELS);

const PLATFORM_ALIASES: Record<string, string> = {
    ai_tickets: "aitickets",
    aitickets_cl: "aitickets",
    passline_com: "passline",
    punto_ticket: "puntoticket",
    puntoticket_com: "puntoticket",
    ticketmaster_chile: "ticketmaster",
    ticketmaster_cl: "ticketmaster",
    ticket_plus: "ticketplus",
    welcu_com: "welcu",
    eventbrite_cl: "eventbrite",
    eventbrite_com: "eventbrite",
    propia: "own_site",
    venta_propia: "own_site",
    boleteria: "own_site",
    web_propia: "own_site",
    sitio_propio: "own_site",
    sin_ticketera: "none",
    ninguna: "none",
    directo: "none",
    venta_directa: "none",
    dm: "none",
    instagram: "none",
    whatsapp: "none",
    transferencia: "none",
    puerta: "none",
    gratis: "none",
    liberado: "none",
    liberada: "none",
};

/** Slug de ticketera a partir de lo que venga (alias, mayúsculas, ".com"). null = no se sabe. */
export function normalizePlatform(v: unknown): { slug: string | null; known: boolean } {
    if (v === null || v === undefined || String(v).trim() === "") return { slug: null, known: true };
    const key = slugKey(String(v).replace(/^https?:\/\/(www\.)?/i, "").replace(/\/.*$/, ""));
    if (!key || key === "unknown" || key === "desconocida" || key === "no_se_sabe") return { slug: null, known: true };
    const slug = PLATFORM_ALIASES[key] || key;
    return { slug, known: KNOWN_PLATFORMS.includes(slug) };
}

export const platformLabel = (slug: string | null | undefined) => (slug ? PLATFORM_LABELS[slug] || slug : "No se sabe");
/** ¿Usa una ticketera (de terceros o AI Tickets)? null = no se sabe. */
export const usesTicketing = (slug: string | null | undefined) => (slug == null ? null : slug !== "none" && slug !== "own_site");

// ---------------------------------------------------------------------------
// Ciudades y regiones
// ---------------------------------------------------------------------------

export const REGIONS = [
    "arica_parinacota",
    "tarapaca",
    "antofagasta",
    "atacama",
    "coquimbo",
    "valparaiso",
    "metropolitana",
    "ohiggins",
    "maule",
    "nuble",
    "biobio",
    "araucania",
    "los_rios",
    "los_lagos",
    "aysen",
    "magallanes",
] as const;
export type Region = (typeof REGIONS)[number];

/** Comunas que se agrupan en una ciudad (el público se mueve entre ellas). */
const METRO_AREAS: Record<string, string[]> = {
    santiago: [
        "santiago", "santiago_centro", "providencia", "nunoa", "las_condes", "vitacura", "lo_barnechea", "la_reina", "penalolen", "macul",
        "la_florida", "puente_alto", "san_miguel", "san_joaquin", "la_cisterna", "estacion_central", "quinta_normal", "recoleta",
        "independencia", "conchali", "huechuraba", "quilicura", "renca", "cerro_navia", "lo_prado", "pudahuel", "maipu", "cerrillos",
        "pedro_aguirre_cerda", "lo_espejo", "el_bosque", "la_granja", "la_pintana", "san_ramon", "san_bernardo", "colina", "padre_hurtado",
        "pirque", "san_jose_de_maipo", "lampa", "calera_de_tango", "gran_santiago", "stgo", "santiago_de_chile", "region_metropolitana",
    ],
    gran_valparaiso: ["valparaiso", "vina_del_mar", "vina", "concon", "quilpue", "villa_alemana", "renaca", "gran_valparaiso"],
    gran_concepcion: ["concepcion", "talcahuano", "san_pedro_de_la_paz", "chiguayante", "hualpen", "penco", "coronel", "gran_concepcion"],
    la_serena_coquimbo: ["la_serena", "coquimbo", "la_serena_coquimbo"],
    temuco: ["temuco", "padre_las_casas"],
    puerto_montt: ["puerto_montt", "puerto_varas_puerto_montt"],
};
const CITY_TO_METRO = new Map<string, string>();
for (const [metro, communes] of Object.entries(METRO_AREAS)) for (const c of communes) CITY_TO_METRO.set(c, metro);

const CITY_LABELS: Record<string, string> = {
    santiago: "Santiago",
    gran_valparaiso: "Gran Valparaíso (Viña, Valparaíso, Concón…)",
    gran_concepcion: "Gran Concepción",
    la_serena_coquimbo: "La Serena / Coquimbo",
    online: "Online",
};

const CITY_REGION: Record<string, Region> = {
    santiago: "metropolitana",
    gran_valparaiso: "valparaiso",
    gran_concepcion: "biobio",
    la_serena_coquimbo: "coquimbo",
    temuco: "araucania",
    puerto_montt: "los_lagos",
    arica: "arica_parinacota",
    iquique: "tarapaca",
    alto_hospicio: "tarapaca",
    antofagasta: "antofagasta",
    calama: "antofagasta",
    san_pedro_de_atacama: "antofagasta",
    copiapo: "atacama",
    ovalle: "coquimbo",
    quillota: "valparaiso",
    los_andes: "valparaiso",
    san_antonio: "valparaiso",
    algarrobo: "valparaiso",
    el_quisco: "valparaiso",
    cartagena: "valparaiso",
    maitencillo: "valparaiso",
    zapallar: "valparaiso",
    papudo: "valparaiso",
    santo_domingo: "valparaiso",
    rancagua: "ohiggins",
    pichilemu: "ohiggins",
    san_fernando: "ohiggins",
    talca: "maule",
    curico: "maule",
    linares: "maule",
    chillan: "nuble",
    los_angeles: "biobio",
    pucon: "araucania",
    villarrica: "araucania",
    valdivia: "los_rios",
    osorno: "los_lagos",
    puerto_varas: "los_lagos",
    frutillar: "los_lagos",
    castro: "los_lagos",
    ancud: "los_lagos",
    coyhaique: "aysen",
    punta_arenas: "magallanes",
    puerto_natales: "magallanes",
};

/** Destinos de verano y de fin de semana largo: ahí la gente LLEGA (en Santiago se va). */
const DESTINATIONS = new Set([
    "gran_valparaiso", "la_serena_coquimbo", "pucon", "villarrica", "puerto_varas", "frutillar", "pichilemu", "algarrobo", "el_quisco",
    "maitencillo", "zapallar", "papudo", "cartagena", "santo_domingo", "iquique", "san_pedro_de_atacama", "puerto_natales", "castro",
]);

export type CityInfo = { key: string | null; label: string | null; region: Region | null; destination: boolean };

/** Ciudad normalizada: las comunas del Gran Santiago son "santiago"; Viña y Valparaíso, "gran_valparaiso". */
export function cityInfo(city: unknown, region?: unknown): CityInfo {
    const raw = slugKey(city);
    if (!raw) return { key: null, label: null, region: isRegion(region) ? region : null, destination: false };
    if (["online", "virtual", "streaming", "zoom", "remoto"].includes(raw)) return { key: "online", label: "Online", region: null, destination: false };
    const key = CITY_TO_METRO.get(raw) || raw;
    return {
        key,
        label: CITY_LABELS[key] || String(city).trim(),
        region: CITY_REGION[key] || (isRegion(region) ? region : null),
        destination: DESTINATIONS.has(key),
    };
}

export const isRegion = (v: unknown): v is Region => typeof v === "string" && (REGIONS as readonly string[]).includes(v);
export const isDestination = (cityKey: string | null | undefined) => Boolean(cityKey && DESTINATIONS.has(cityKey));
export const cityLabel = (cityKey: string | null | undefined) => (cityKey ? CITY_LABELS[cityKey] || cityKey.replace(/_/g, " ") : null);

// ---------------------------------------------------------------------------
// Organizadores y duplicados
// ---------------------------------------------------------------------------

/** "@Mi.Productora", "instagram.com/mi.productora/" → "mi.productora". */
export function normalizeInstagram(v: unknown): string | null {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const handle = s
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
        .replace(/^@/, "")
        .replace(/[/?#].*$/, "")
        .toLowerCase();
    return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

/** Clave del organizador: su Instagram si se conoce (más estable que el nombre), si no el nombre normalizado. */
export function organizerKey(name: unknown, instagram: unknown): string | null {
    const ig = normalizeInstagram(instagram);
    if (ig) return `ig:${ig}`;
    const n = slugKey(name);
    return n ? `name:${n}` : null;
}

/** Mismo evento si coincide nombre normalizado, día y ciudad (una fila por función y día). */
export const dedupeKey = (name: unknown, date: string, cityKey: string | null | undefined) => `${slugKey(name)}|${date}|${cityKey || "-"}`;

// ---------------------------------------------------------------------------
// Categorías de AI Tickets (category_tags.name, texto libre) → tipo
// ---------------------------------------------------------------------------

const CATEGORY_RULES: [RegExp, EventType][] = [
    [/festival/, "festival"],
    [/stand.?up|comedia|humor|impro/, "stand_up"],
    [/infantil|ninos|familia/, "infantil"],
    [/danza|ballet/, "danza"],
    [/teatro|obra|musical|circo/, "teatro"],
    [/\bcine\b|pelicula|documental/, "cine"],
    [/\bclub\b|disco|\bdj\b/, "club"],
    [/fiesta|party|electronica|reggaeton|techno/, "fiesta"],
    [/concierto|musica|banda|rock|jazz|tocata|indie|recital/, "concierto"],
    [/taller|curso|clase|workshop|academia/, "taller"],
    [/conferencia|seminario|congreso|charla|summit|meetup|webinar/, "conferencia"],
    [/deporte|carrera|running|futbol|e-?sports|maraton/, "deportes"],
    [/feria|gastronom|mercado|expo/, "feria"],
];

export function typeFromCategory(category: string | null | undefined): EventType {
    const n = normalizeText(category);
    return CATEGORY_RULES.find(([re]) => re.test(n))?.[1] || "otro";
}
