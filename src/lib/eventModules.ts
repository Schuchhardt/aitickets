// Módulos del detalle del evento en el panel (src/pages/dashboard/events/[id].astro): qué tarjetas se muestran, en
// qué pestaña y en qué orden. Es la única fuente de verdad: para sumar una capacidad nueva (por ejemplo las de
// docs/specs/rediseno/PENDIENTES_pronto.md) se agrega un módulo aquí y su tarjeta en la página.
//
// Tres capas deciden si un módulo se ve:
//   1. when(ctx): condición del evento (estado, número de funciones, fase). Si no se cumple, el módulo no aplica y
//      no aparece ni en "Más herramientas".
//   2. suggest(ctx) o profiles: si le sirve a este evento (por un dato del evento, o por los perfiles derivados de la
//      categoría). Sin ninguno = a todos. Si no le sirve, queda en "Más herramientas" de su pestaña.
//   3. events.panel_modules: los que el productor agregó desde "Más herramientas" de cada pestaña (lista de ids).
// Lo que se muestra no se quita del panel: "Más herramientas" solo suma lo que no viene para este tipo de evento.

export type EventProfile = "noche" | "musica" | "funciones" | "formacion" | "general";
export type EventTab = "ventas" | "difusion" | "pagina" | "puerta" | "despues";
export type EventPhase = "before" | "during" | "after";

export type EventModuleContext = {
    profile: EventProfile;
    status: string;
    functionCount: number;
    ticketTypeCount: number;
    phase: EventPhase;
    // Evento masivo (Ley 21.659) o con documentos exigidos por AI Tickets (events.is_massive, requires_documents)
    isMassive: boolean;
};

export type EventModule = {
    id: string;
    title: string;
    description: string;
    tab: EventTab;
    core?: boolean;
    profiles?: EventProfile[];
    suggest?: (ctx: EventModuleContext) => boolean;
    when?: (ctx: EventModuleContext) => boolean;
};


export const PROFILE_LABELS: Record<EventProfile, string> = {
    noche: "fiestas y discotecas",
    musica: "música y festivales",
    funciones: "teatro, stand-up y funciones",
    formacion: "talleres, cursos y seminarios",
    general: "eventos en general",
};

export const TABS: { id: EventTab; label: string }[] = [
    { id: "ventas", label: "Entradas y ventas" },
    { id: "difusion", label: "Difusión" },
    { id: "pagina", label: "Página" },
    { id: "puerta", label: "Puerta" },
    { id: "despues", label: "Asistentes y después" },
];

// Orden de la lista = orden dentro de cada pestaña
export const EVENT_MODULES: EventModule[] = [
    { id: "tickets", title: "Tipos de entrada", description: "Precios, cupos y entradas emitidas.", tab: "ventas", core: true },
    { id: "courtesy", title: "Entradas de cortesía", description: "Emite entradas sin costo con su QR.", tab: "ventas" },
    { id: "discounts", title: "Códigos de descuento", description: "Descuentos del evento y de la organización.", tab: "ventas" },
    // En borrador el link público da error: ahí se comparte con los links de vista previa
    {
        id: "public-link",
        title: "Link público",
        description: "El link para vender entradas.",
        tab: "difusion",
        core: true,
        when: (ctx) => ctx.status === "published",
    },
    {
        id: "social-series",
        title: "Difusión automática en Instagram",
        description: "Historias y posts hasta el día del evento.",
        tab: "difusion",
        when: (ctx) => ctx.status === "published" && ctx.phase !== "after",
    },
    {
        id: "promote",
        title: "Posts y anuncios",
        description: "Publica un post en tus redes o crea un anuncio pagado para este evento.",
        tab: "difusion",
        when: (ctx) => ctx.status === "published" && ctx.phase !== "after",
    },
    {
        id: "tracking-links",
        title: "Links con seguimiento",
        description: "Un link por canal o promotor para medir ventas.",
        tab: "difusion",
        when: (ctx) => ctx.status === "published",
    },
    // Solo en borrador: publicado, el link público ya muestra la página
    {
        id: "preview-links",
        title: "Links de vista previa",
        description: "Muestra el evento sin publicarlo.",
        tab: "difusion",
        when: (ctx) => ctx.status !== "published",
    },
    { id: "cover", title: "Portada", description: "Imagen de la página, ajuste por dispositivo y generación con IA.", tab: "pagina", core: true },
    { id: "faq", title: "Preguntas frecuentes", description: "Respuestas que se muestran en la página del evento.", tab: "pagina" },
    { id: "gallery", title: "Galería", description: "Fotos y video al final de la página del evento.", tab: "pagina" },
    // Fuera de un evento masivo queda en Más herramientas: desde la tarjeta se marca "Es un evento masivo"
    {
        id: "documents",
        title: "Permisos y documentos",
        description: "Autorización de evento masivo, contrato del lugar y póliza.",
        tab: "pagina",
        suggest: (ctx) => ctx.isMassive,
    },
    { id: "community", title: "Mensajes y muro de asistentes", description: "Mensajes de quienes compraron y reacciones.", tab: "despues" },
    {
        id: "reviews",
        title: "Reseñas",
        description: "Calificaciones, fotos de asistentes e invitación al próximo evento.",
        tab: "despues",
        when: (ctx) => ctx.phase === "after",
    },
];

const normalize = (s: string) =>
    String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");

// Orden importa, igual que en src/components/event/categoryIcons.js ("Festival de música" => musica)
const PROFILE_RULES: [RegExp, EventProfile][] = [
    [/taller|charla|conferencia|curso|seminario|workshop|academia|clase/, "formacion"],
    [/fiesta|party|club|disco|dj|electronica/, "noche"],
    [/festival|musica|concierto|banda|rock|jazz|indie|tocata/, "musica"],
    [/stand.?up|comedia|humor|impro|teatro|obra|musical|circo|danza|ballet|infantil|ninos/, "funciones"],
];

/** Perfil del evento según su categoría (category_tags.name, texto libre en eventos antiguos o del MCP). */
export function eventProfile(category: string | null | undefined): EventProfile {
    const n = normalize(category || "");
    return PROFILE_RULES.find(([re]) => re.test(n))?.[1] || "general";
}

/** Fase del evento respecto de ahora: antes de la primera función, durante (hasta el fin) o después. */
export function eventPhase(startDate: string | null | undefined, endDate: string | null | undefined, now = new Date()): EventPhase {
    const start = startDate ? new Date(startDate).getTime() : NaN;
    if (Number.isNaN(start) || now.getTime() < start) return "before";
    // Sin fin conocido, el evento dura el día de la función
    const end = endDate ? new Date(endDate).getTime() : start + 24 * 3600 * 1000;
    return now.getTime() <= end ? "during" : "after";
}

/** Limpia lo guardado en events.panel_modules: ids de módulos opcionales, sin repetir, en el orden del registro. */
export function normalizeAddedModules(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return EVENT_MODULES.filter((m) => !m.core && raw.includes(m.id)).map((m) => m.id);
}

export const isAddableModule = (id: string) => EVENT_MODULES.some((m) => m.id === id && !m.core);

const suggestedFor = (m: EventModule, ctx: EventModuleContext) =>
    m.suggest ? m.suggest(ctx) : !m.profiles || m.profiles.includes(ctx.profile);

export type ResolvedModule = EventModule & { enabled: boolean; suggested: boolean };

/** Módulos que aplican a este evento, con si se muestran (enabled) y si le sirven a su tipo (suggested). */
export function resolveModules(ctx: EventModuleContext, added: string[] = []): ResolvedModule[] {
    return EVENT_MODULES.filter((m) => !m.when || m.when(ctx)).map((m) => {
        const suggested = !!m.core || suggestedFor(m, ctx);
        return { ...m, enabled: suggested || added.includes(m.id), suggested };
    });
}

/** Pestañas con al menos un módulo que aplica, cada una con sus módulos en orden (también los que no se muestran:
 *  van en "Más herramientas" de esa pestaña). */
export function panelTabs(modules: ResolvedModule[]): { id: EventTab; label: string; modules: ResolvedModule[] }[] {
    return TABS.map((t) => ({ ...t, modules: modules.filter((m) => m.tab === t.id) })).filter((t) => t.modules.length > 0);
}

/** Pestaña que se abre por defecto: después del evento importan los asistentes; antes, las ventas. */
export function defaultTab(ctx: EventModuleContext, tabs: { id: EventTab }[]): EventTab | undefined {
    const preferred: EventTab = ctx.phase === "after" ? "despues" : "ventas";
    return tabs.find((t) => t.id === preferred)?.id ?? tabs[0]?.id;
}
