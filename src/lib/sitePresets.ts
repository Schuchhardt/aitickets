// Plantillas completas del sitio de productor: cada una combina COPY (textos y estructura de secciones), LAYOUT (tipo de
// menú y diseño de cada sección) y TEMA (estilo visual de nicho + paleta). Hay 2 o 3 por nicho, una por tipo de página
// que usan realmente esas productoras (investigación en docs/specs/sitios-plantillas-por-nicho.md).
// Módulo puro: lo usan el editor (src/components/dashboard/site/SiteBuilder.vue), la IA (/api/sites/ai) y los tests.
//
// Reglas del copy (las mismas que la IA, src/lib/aiText.ts): nada inventado. Solo se escribe lo que es cierto para
// cualquier productora que vende con AI Tickets (cómo se compra, la entrada con QR, el formulario de contacto). Lo que
// solo sabe el productor (nombres, bios, horarios, políticas, opiniones) va vacío: el editor lo muestra con un texto de
// ayuda en la vista previa y el sitio público no lo muestra hasta que se completa.
import {
  TEMPLATE_INFO,
  sanitizeLayout,
  sanitizeSections,
  type SectionData,
  type SectionItem,
  type SectionType,
  type SiteLayoutSettings,
  type SiteSection,
  type SiteTemplate,
  type TemplateDefaults,
} from "./siteTemplates";

export interface SitePreset {
  key: string;
  /** Estilo visual (plantilla de nicho o general). */
  template: SiteTemplate;
  /** Tipo de página, p. ej. "Sala o centro cultural". */
  name: string;
  /** Para quién es y qué trae. */
  description: string;
  layout: SiteLayoutSettings;
  /** Paleta propia (si no, la de la plantilla). */
  theme?: Partial<Omit<TemplateDefaults, "font">> & { font?: string };
  sections: SiteSection[];
}

// ---------------------------------------------------------------------------
// Piezas de copy reutilizables (ciertas para cualquier productora de AI Tickets)
// ---------------------------------------------------------------------------
const FAQ_TICKET: SectionItem = {
  question: "¿Cómo recibo mi entrada?",
  answer: "Después de pagar te llega un correo con tu entrada y un código QR. Lo muestras desde el celular al entrar.",
};
const FAQ_ONLINE: SectionItem = { question: "¿Puedo comprar desde el celular?", answer: "Sí. Compras en minutos desde el celular o el computador, con pago seguro." };
const FAQ_CONTACT: SectionItem = { question: "¿Tienes otra duda?", answer: "Escríbenos por el formulario de contacto y te respondemos a tu correo." };
/** Pregunta que solo el productor puede responder: la respuesta queda vacía (no se publica hasta completarla). */
const ask = (question: string): SectionItem => ({ question, answer: "" });
const person = (): SectionItem => ({ name: "", role: "", text: "" });
const people = (n: number) => Array.from({ length: n }, person);
const tab = (title: string, text = ""): SectionItem => ({ title, text });
const point = (title: string, text: string): SectionItem => ({ title, text });
const quotes = (n: number) => Array.from({ length: n }, () => ({ quote: "", author: "" }));

const CONTACT_MODAL = (what: string) =>
  `Escríbenos por el formulario de contacto con ${what} y te respondemos a tu correo con una propuesta.`;

const BUY_POINTS: SectionItem[] = [
  point("Compra online", "Compra en minutos desde el celular o el computador, con pago seguro."),
  point("Tu entrada en el celular", "Te llega por correo con un código QR para mostrar en la entrada."),
  point("Elige tu función", "Revisa las fechas y horarios disponibles y elige la que te acomoda."),
];

type Opts = { nav?: boolean | string; hidden?: boolean };
function sec(type: SectionType, id: string, data: SectionData, opts: Opts = {}): SiteSection {
  const out: SiteSection = { id, type, data: { ...data } };
  if (opts.nav) {
    out.nav = true;
    if (typeof opts.nav === "string") out.data.nav_label = opts.nav;
  }
  if (opts.hidden) out.hidden = true;
  return out;
}
const events = (title: string, layout: string, eyebrow = "", nav: boolean | string = "Cartelera") =>
  sec("events", "eventos", { eyebrow: eyebrow || undefined, title, layout }, { nav });
const contact = (title: string, text: string) => sec("contact", "contacto", { title, text }, { nav: "Contacto" });
const faq = (items: SectionItem[], title = "Preguntas frecuentes", nav: boolean | string = "Preguntas") => sec("faq", "preguntas", { title, items }, { nav });
const cta = (id: string, title: string, text: string, label: string, modalTitle: string, modalText: string, nav: boolean | string = false) =>
  sec("cta", id, { title, text, button_label: label, button_action: "modal", modal_title: modalTitle, modal_text: modalText }, { nav });

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------
const PRESETS: SitePreset[] = [
  // ----------------------------------------------------------------- Teatro
  {
    key: "teatro-compania",
    template: "teatro",
    name: "Compañía de teatro",
    description: "Obras en cartel, elenco con bios, prensa y funciones para colegios.",
    layout: { nav: "centered" },
    sections: [
      sec("hero", "portada", { eyebrow: "Temporada", layout: "centered", button_label: "Ver funciones", button_url: "#eventos" }),
      events("En escena", "posters", "Cartelera", "Funciones"),
      sec("people", "elenco", { eyebrow: "La compañía", title: "Elenco y equipo creativo", layout: "carousel", items: people(4) }, { nav: "Elenco" }),
      sec("testimonials", "prensa", { eyebrow: "Prensa", title: "Lo que dice la crítica", layout: "grid", items: quotes(2) }, { nav: "Prensa" }),
      sec("gallery", "fotos", { title: "Fotos de la temporada", layout: "grid", items: [] }),
      sec("about", "nosotros", { eyebrow: "La compañía", title: "Quiénes somos" }, { nav: "Nosotros" }),
      cta(
        "colegios",
        "Funciones para colegios y comunidades",
        "Llevamos la obra a tu colegio, empresa o municipio.",
        "Contrata una función",
        "Funciones privadas",
        CONTACT_MODAL("la institución, la fecha que buscas y la cantidad de personas")
      ),
      faq([FAQ_TICKET, ask("¿Desde qué edad se recomienda la obra?"), ask("¿Cuánto dura la función?"), FAQ_CONTACT], "Antes de la función", false),
      contact("Funciones privadas y prensa", "Colegios, empresas o medios: escríbenos y te respondemos."),
    ],
  },
  {
    key: "teatro-sala",
    template: "teatro",
    name: "Sala o centro cultural",
    description: "Cartelera de varias disciplinas, la sala, cómo llegar, accesibilidad y arriendo.",
    layout: { nav: "sidebar" },
    theme: { primary: "#e2b866", accent: "#7a1f33", background: "#170b10", text: "#f3e9dc" },
    sections: [
      sec("hero", "portada", { eyebrow: "Cartelera", layout: "split", button_label: "¿Qué ver hoy?", button_url: "#eventos" }),
      events("Esta temporada en la sala", "list", "Hoy y próximamente", "Cartelera"),
      sec("feature", "la-sala", { eyebrow: "La sala", title: "Un espacio para las artes escénicas", text: "", align: "right" }, { nav: "La sala" }),
      sec(
        "tabs",
        "visitanos",
        { eyebrow: "Planifica tu visita", title: "Visítanos", items: [tab("Cómo llegar"), tab("Boletería y horarios"), tab("Accesibilidad")] },
        { nav: "Visítanos" }
      ),
      sec("gallery", "galeria", { title: "La sala por dentro", layout: "carousel", items: [] }),
      cta(
        "arriendo",
        "Arrienda la sala",
        "Para estrenos, temporadas, ensayos o eventos.",
        "Ver condiciones",
        "Arriendo de sala",
        CONTACT_MODAL("las fechas, el tipo de montaje y el público que esperas"),
        "Arriendo"
      ),
      sec("gallery", "aliados", { title: "Con el apoyo de", layout: "logos", items: [] }),
      faq([FAQ_TICKET, FAQ_ONLINE, ask("¿Con cuánta anticipación abren las puertas?"), FAQ_CONTACT]),
      contact("Escríbenos", "Prensa, programación o arriendo de la sala: te respondemos a tu correo."),
    ],
  },
  {
    key: "teatro-festival",
    template: "teatro",
    name: "Festival de teatro",
    description: "Programación por día en pestañas, compañías invitadas y auspiciadores.",
    layout: { nav: "centered", sticky: true },
    theme: { primary: "#b3261e", accent: "#1d3a8a", background: "#f6f0e6", text: "#1d1a2b", dark: false },
    sections: [
      sec("hero", "portada", { eyebrow: "Festival", layout: "overlay", button_label: "Revisa la programación", button_url: "#programa" }),
      sec("tabs", "programa", { eyebrow: "Programación", title: "Día a día", items: [tab("Día 1"), tab("Día 2"), tab("Día 3")] }, { nav: "Programa" }),
      events("Entradas", "cards", "Funciones", "Entradas"),
      sec("people", "companias", { eyebrow: "Invitados", title: "Compañías del festival", layout: "carousel", items: people(4) }, { nav: "Compañías" }),
      sec("video", "video", { title: "Así se vivió la última edición", url: "" }),
      faq([FAQ_TICKET, ask("¿Hay funciones gratuitas o familiares?"), ask("¿Dónde están las salas?"), FAQ_CONTACT], "Información práctica", "Info"),
      sec("gallery", "auspiciadores", { title: "Presentan y auspician", layout: "logos", items: [] }, { nav: "Auspiciadores" }),
      contact("Prensa y convocatoria", "Medios, compañías o auspiciadores: escríbenos."),
    ],
  },

  // ----------------------------------------------------------------- Música
  {
    key: "musica-banda",
    template: "musica",
    name: "Banda o artista",
    description: "Portada con foto o video, fechas de gira, último video, bio y booking.",
    layout: { nav: "top", sticky: true },
    sections: [
      sec("hero", "portada", { eyebrow: "En vivo", layout: "overlay", button_label: "Ver fechas", button_url: "#eventos" }),
      events("Próximas fechas", "list", "Gira", "Fechas"),
      sec("video", "musica", { eyebrow: "Último lanzamiento", title: "Míralo aquí", url: "" }, { nav: "Música" }),
      sec("gallery", "en-vivo", { title: "En vivo", layout: "carousel", items: [] }, { nav: "Fotos" }),
      sec("about", "bio", { eyebrow: "Bio", title: "La banda" }, { nav: "Bio" }),
      cta(
        "booking",
        "Booking y prensa",
        "¿Quieres llevarnos a tu escenario o hacer una entrevista?",
        "Contactar",
        "Booking",
        CONTACT_MODAL("la ciudad, la fecha y el tipo de evento")
      ),
      contact("Booking y prensa", "¿Quieres llevarnos a tu escenario? Escríbenos."),
    ],
  },
  {
    key: "musica-productora",
    template: "musica",
    name: "Productora de conciertos o sala",
    description: "Cartelera de shows en afiches, planifica tu visita y experiencias.",
    layout: { nav: "top", sticky: true },
    theme: { primary: "#f5c518", accent: "#ff3b30", background: "#0d0f14", text: "#f2f0eb" },
    sections: [
      sec("hero", "portada", { eyebrow: "Próximo show", layout: "split", button_label: "Ver cartelera", button_url: "#eventos" }),
      events("Próximos conciertos", "posters", "Cartelera", "Cartelera"),
      sec("highlights", "entradas", { eyebrow: "Entradas", title: "Directo a la puerta", items: BUY_POINTS.map((p) => ({ ...p })) }),
      sec(
        "tabs",
        "planifica",
        { eyebrow: "Planifica tu visita", title: "Antes de venir", items: [tab("Cómo llegar"), tab("Estacionamiento"), tab("Objetos permitidos")] },
        { nav: "Tu visita" }
      ),
      sec("gallery", "shows", { title: "Shows que hicimos", layout: "carousel", items: [] }),
      faq([FAQ_TICKET, FAQ_ONLINE, ask("¿Desde qué edad pueden entrar?"), FAQ_CONTACT]),
      sec("gallery", "aliados", { title: "Venues y marcas aliadas", layout: "logos", items: [] }),
      contact("Producción y alianzas", "Artistas, venues o marcas: escríbenos."),
    ],
  },
  {
    key: "musica-festival",
    template: "musica",
    name: "Festival de música",
    description: "Line-up, programa por día, el recinto, info práctica y auspiciadores.",
    layout: { nav: "centered", sticky: true },
    theme: { primary: "#ff4fd8", accent: "#22d3ee", background: "#12052b", text: "#f5f3ff", font: "Anton" },
    sections: [
      sec("hero", "portada", { eyebrow: "Festival", layout: "centered", button_label: "Tickets", button_url: "#eventos" }),
      sec("people", "lineup", { eyebrow: "Line-up", title: "Quiénes tocan", layout: "grid", items: people(8) }, { nav: "Line-up" }),
      sec("tabs", "programa", { eyebrow: "Programa", title: "Por día", items: [tab("Día 1"), tab("Día 2")] }, { nav: "Programa" }),
      events("Tickets", "cards", "Entradas", "Tickets"),
      sec("feature", "recinto", { eyebrow: "El lugar", title: "El recinto", text: "", button_label: "", align: "left" }, { nav: "Recinto" }),
      sec("video", "aftermovie", { title: "Aftermovie", url: "" }),
      faq([FAQ_TICKET, ask("¿Desde qué edad se puede entrar?"), ask("¿Qué objetos están permitidos?"), ask("¿Hay acceso para personas con movilidad reducida?"), FAQ_CONTACT], "Info práctica", "FAQ"),
      sec("gallery", "auspiciadores", { title: "Presentan y auspician", layout: "logos", items: [] }),
      contact("Prensa, marcas y acreditaciones", "Escríbenos y te respondemos."),
    ],
  },

  // ----------------------------------------------------------------- Fiestas
  {
    key: "fiestas-productora",
    template: "fiestas",
    name: "Marca de fiestas recurrentes",
    description: "Próximas fiestas, manifiesto, revive la fiesta (fotos y aftermovie) y DJs.",
    layout: { nav: "top", sticky: true },
    sections: [
      sec("hero", "portada", { eyebrow: "¡Se viene!", layout: "split", button_label: "Quiero mi entrada", button_url: "#eventos" }),
      events("Anótate en la próxima", "posters", "Próximas fiestas", "Fiestas"),
      sec("feature", "manifiesto", { eyebrow: "Quiénes somos", title: "La fiesta la hacemos todos", text: "", align: "right" }, { nav: "Nosotros" }),
      sec("gallery", "revive", { eyebrow: "Así se vivió", title: "Revive cada fiesta", layout: "carousel", items: [] }, { nav: "Fotos" }),
      sec("video", "aftermovie", { title: "El aftermovie", url: "" }),
      sec("people", "djs", { eyebrow: "En las tornamesas", title: "Nuestros DJs", layout: "carousel", items: people(3) }),
      sec("highlights", "entradas", {
        eyebrow: "Entradas",
        title: "Así de fácil",
        items: [BUY_POINTS[0], BUY_POINTS[1], point("Compra con tiempo", "Las preventas se agotan: compra antes y asegura tu lugar.")].map((p) => ({ ...p })),
      }),
      faq([FAQ_TICKET, ask("¿Desde qué edad se puede entrar?"), ask("¿Hay dress code?"), FAQ_CONTACT]),
      contact("¿Celebras algo?", "Cumpleaños, empresas o colaboraciones: escríbenos."),
    ],
  },
  {
    key: "fiestas-tematica",
    template: "fiestas",
    name: "Fiesta temática",
    description: "Una página para tu concepto: fechas, la propuesta, line-up, el recinto y video.",
    layout: { nav: "top", sticky: true },
    theme: { primary: "#ffd400", accent: "#ff5b14", background: "#1b0b3a", text: "#fff4e4", dark: true },
    sections: [
      sec("hero", "portada", { eyebrow: "¡Vuelve la fiesta!", layout: "overlay", button_label: "Comprar", button_url: "#eventos" }),
      events("Próximas fechas", "list", "Tickets", "Tickets"),
      sec("feature", "la-fiesta", { eyebrow: "La fiesta", title: "Una noche para cantar todos los temas", text: "", align: "left" }),
      sec("people", "lineup", { eyebrow: "Line-up", title: "Quiénes tocan", layout: "grid", items: people(4) }, { nav: "Line-up" }),
      sec("video", "video", { title: "Así se vive", url: "" }, { nav: "Video" }),
      sec("feature", "recinto", { eyebrow: "El recinto", title: "Dónde es", text: "", align: "right" }, { nav: "Recinto" }),
      faq([FAQ_TICKET, ask("¿Desde qué edad se puede entrar?"), ask("¿Qué incluye cada tipo de entrada?"), FAQ_CONTACT]),
      contact("¿Quieres la fiesta en tu ciudad?", "Escríbenos y conversemos."),
    ],
  },
  {
    key: "fiestas-privadas",
    template: "fiestas",
    name: "Fiestas universitarias y eventos privados",
    description: "Fiestas abiertas más cotización de eventos privados: paquetes, requisitos y formulario.",
    layout: { nav: "top" },
    theme: { primary: "#2b36ff", accent: "#ff5b14", background: "#f2f6ff", text: "#10142b", dark: false },
    sections: [
      sec("hero", "portada", {
        eyebrow: "Fiestas y eventos",
        layout: "split",
        button_label: "Ver próximas fiestas",
        button_url: "#eventos",
      }),
      events("Fiestas abiertas", "cards", "Próximas fechas", "Fiestas"),
      sec(
        "tabs",
        "paquetes",
        { eyebrow: "Eventos privados", title: "Elige tu evento", items: [tab("Graduaciones"), tab("Mechonas y semestrales"), tab("Cumpleaños")] },
        { nav: "Eventos privados" }
      ),
      sec("highlights", "incluye", {
        eyebrow: "Con AI Tickets",
        title: "Tu evento, ordenado",
        items: [
          point("Venta online", "Cada invitado compra su entrada desde el celular y la recibe por correo con QR."),
          point("Control de acceso", "Se valida cada QR en la puerta: nadie entra dos veces con la misma entrada."),
          point("Lista de invitados", "Suma cortesías e invitados y ve en tiempo real quién llegó."),
        ],
      }),
      sec("gallery", "fotos", { title: "Fiestas anteriores", layout: "grid", items: [] }),
      faq([FAQ_TICKET, ask("¿Desde qué edad se puede entrar?"), ask("¿Hay que mostrar carnet en la entrada?"), FAQ_CONTACT], "Requisitos y preguntas", "Preguntas"),
      cta(
        "cotiza",
        "Cotiza tu fiesta",
        "Graduación, semestral o cumpleaños: armamos la fiesta contigo.",
        "Cotizar",
        "Cotiza tu evento",
        CONTACT_MODAL("la institución o el motivo, la fecha y la cantidad de personas"),
        "Cotizar"
      ),
      contact("Cotiza tu evento", "Cuéntanos qué celebras y te respondemos con una propuesta."),
    ],
  },

  // ----------------------------------------------------------------- Clubs
  {
    key: "clubs-discoteca",
    template: "clubs",
    name: "Discoteca o club",
    description: "Las noches de la semana, residentes, mesas y cumpleaños y política de entrada.",
    layout: { nav: "top", sticky: true },
    sections: [
      sec("hero", "portada", { eyebrow: "Esta noche", layout: "overlay", button_label: "Ver la semana", button_url: "#eventos" }),
      events("La semana", "list", "Próximas noches", "Noches"),
      sec("tabs", "noches", { eyebrow: "Cada noche", title: "Qué suena", items: [tab("Jueves"), tab("Viernes"), tab("Sábado")] }),
      sec("people", "residentes", { eyebrow: "Residentes", title: "Nuestros DJs", layout: "carousel", items: people(3) }, { nav: "Residentes" }),
      cta(
        "mesas",
        "Mesas, cumpleaños y eventos",
        "Reserva tu mesa o celebra con nosotros.",
        "Reservar",
        "Mesas y cumpleaños",
        CONTACT_MODAL("la fecha, la cantidad de personas y qué celebras"),
        "Reservas"
      ),
      sec("gallery", "fotos", { title: "Las noches", layout: "grid", items: [] }),
      faq([FAQ_TICKET, ask("¿Desde qué edad se puede entrar?"), ask("¿Hay dress code o política de entrada?"), ask("¿Hasta qué hora se puede entrar con entrada anticipada?"), FAQ_CONTACT], "Puerta", "Puerta"),
      contact("Mesas, cumpleaños y eventos", "Escríbenos para reservar o cotizar."),
    ],
  },
  {
    key: "clubs-colectivo",
    template: "clubs",
    name: "Colectivo o sello electrónico",
    description: "Menú lateral, fechas, crew, sets en video y fotos. Minimal y con imágenes.",
    layout: { nav: "sidebar" },
    theme: { primary: "#d4ff3f", accent: "#7c3aed", background: "#0a0a0a", text: "#ececec" },
    sections: [
      sec("hero", "portada", { layout: "overlay", button_label: "Próximas fechas", button_url: "#eventos" }),
      events("Próximas fechas", "list", "Fechas", "Fechas"),
      sec("people", "crew", { eyebrow: "Crew", title: "Residentes y artistas", layout: "grid", items: people(4) }, { nav: "Crew" }),
      sec("video", "sets", { eyebrow: "Sets", title: "Escucha un set", url: "" }, { nav: "Sets" }),
      sec("gallery", "fotos", { title: "Pistas", layout: "carousel", items: [] }, { nav: "Fotos" }),
      sec("about", "colectivo", { eyebrow: "El colectivo", title: "Quiénes somos" }, { nav: "Nosotros" }),
      contact("Booking", "Fechas, colaboraciones o prensa: escríbenos."),
    ],
  },
  {
    key: "clubs-bar",
    template: "clubs",
    name: "Bar con DJ o música en vivo",
    description: "El lugar, horarios, la agenda de la semana, carta y reservas.",
    layout: { nav: "top", sticky: true },
    theme: { primary: "#ffb347", accent: "#ff4fb8", background: "#120c07", text: "#f6eadb", font: "Space Grotesk" },
    sections: [
      sec("hero", "portada", { eyebrow: "Música todas las semanas", layout: "split", button_label: "Ver agenda", button_url: "#eventos" }),
      sec("feature", "el-lugar", { eyebrow: "El lugar", title: "Tragos, comida y buena música", text: "", align: "left" }, { nav: "El lugar" }),
      events("Esta semana", "cards", "Agenda", "Agenda"),
      sec("tabs", "horarios", { eyebrow: "Horarios", title: "Cuándo abrimos", items: [tab("Lunes a jueves"), tab("Viernes y sábado"), tab("Domingo")] }, { nav: "Horarios" }),
      sec("gallery", "fotos", { title: "Así es una noche", layout: "grid", items: [] }),
      cta("reservas", "Reserva tu mesa", "Para grupos, cumpleaños o after office.", "Reservar", "Reservas", CONTACT_MODAL("el día, la hora y la cantidad de personas"), "Reservas"),
      faq([FAQ_TICKET, ask("¿Hay que pagar entrada todos los días?"), ask("¿Se puede reservar mesa?"), FAQ_CONTACT]),
      contact("Eventos privados", "¿Quieres el bar para tu evento? Escríbenos."),
    ],
  },

  // ----------------------------------------------------------------- Stand-up
  {
    key: "standup-comediante",
    template: "standup",
    name: "Comediante",
    description: "Fechas de la gira, clips, prensa, bio y contrataciones.",
    layout: { nav: "top", sticky: true },
    sections: [
      sec("hero", "portada", { eyebrow: "Comedia en vivo", layout: "overlay", button_label: "Ver shows", button_url: "#eventos" }),
      events("Próximos shows", "list", "Gira", "Shows"),
      sec("video", "clips", { eyebrow: "Clips", title: "Un adelanto", url: "" }, { nav: "Videos" }),
      sec("testimonials", "prensa", { eyebrow: "Prensa", title: "Lo que dicen", layout: "carousel", items: quotes(3) }, { nav: "Prensa" }),
      sec("about", "bio", { eyebrow: "Detrás del micrófono", title: "Bio" }, { nav: "Bio" }),
      cta(
        "contrataciones",
        "Shows privados y empresas",
        "¿Quieres un show para tu evento?",
        "Contratar",
        "Contrataciones",
        CONTACT_MODAL("la fecha, la ciudad, el tipo de evento y la cantidad de público")
      ),
      contact("Contrataciones y prensa", "Escríbenos y te respondemos."),
    ],
  },
  {
    key: "standup-club",
    template: "standup",
    name: "Club o ciclo de comedia",
    description: "Cartelera semanal, formatos (open mic, estelar, impro), comediantes y la sala.",
    layout: { nav: "top", sticky: true },
    theme: { primary: "#ffcc00", accent: "#e94f37", background: "#1a1208", text: "#f8efe2" },
    sections: [
      sec("hero", "portada", { eyebrow: "Comedia en vivo", layout: "split", button_label: "Ver line-ups", button_url: "#eventos" }),
      events("Cartelera", "cards", "Esta semana", "Cartelera"),
      sec("tabs", "formatos", { eyebrow: "Formatos", title: "Elige tu noche", items: [tab("Open mic"), tab("Show estelar"), tab("Impro")] }, { nav: "Formatos" }),
      sec("people", "comediantes", { eyebrow: "En escena", title: "Comediantes", layout: "carousel", items: people(4) }, { nav: "Comediantes" }),
      cta("politicas", "Antes de venir", "Revisa cómo funciona la sala.", "Ver condiciones", "Condiciones de la sala", ""),
      sec("gallery", "fotos", { title: "La sala", layout: "grid", items: [] }),
      faq([FAQ_TICKET, ask("¿Desde qué edad se recomienda?"), ask("¿Con cuánta anticipación debo llegar?"), FAQ_CONTACT]),
      contact("Shows privados y comediantes", "¿Quieres actuar o llevar un show a tu evento? Escríbenos."),
    ],
  },
  {
    key: "standup-productora",
    template: "standup",
    name: "Productora de comedia",
    description: "Shows destacados, comediantes, empresas y reseñas. Energético y claro.",
    layout: { nav: "top" },
    theme: { primary: "#e94f37", accent: "#1f1a17", background: "#fff8ef", text: "#1f1a17", dark: false },
    sections: [
      sec("hero", "portada", { eyebrow: "Comedia", layout: "centered", button_label: "Comprar entradas", button_url: "#eventos" }),
      events("Shows destacados", "posters", "Cartelera", "Shows"),
      sec("people", "comediantes", { eyebrow: "Nuestros comediantes", title: "El elenco", layout: "grid", items: people(4) }, { nav: "Comediantes" }),
      sec("tabs", "servicios", { eyebrow: "Más que shows", title: "Para quién", items: [tab("Empresas"), tab("Grupos"), tab("Clases")] }, { nav: "Empresas" }),
      sec("testimonials", "resenas", { eyebrow: "Reseñas", title: "Lo que dice el público", layout: "carousel", items: quotes(3) }),
      cta("empresas", "Lleva la comedia a tu evento", "Shows para empresas, matrimonios y celebraciones.", "Cotizar", "Shows para empresas", CONTACT_MODAL("la fecha, el lugar y la cantidad de personas")),
      contact("Escríbenos", "Shows, empresas o prensa: te respondemos a tu correo."),
    ],
  },

  // ----------------------------------------------------------------- Seminarios
  {
    key: "seminarios-congreso",
    template: "seminarios",
    name: "Congreso o conferencia anual",
    description: "Programa por día, expositores con bio, la sede, auspiciadores y FAQ.",
    layout: { nav: "centered", sticky: true },
    sections: [
      sec("hero", "portada", { eyebrow: "Programa", layout: "split", button_label: "Inscribirme", button_url: "#eventos" }),
      sec("people", "expositores", { eyebrow: "Expositores", title: "Quiénes exponen", layout: "grid", items: people(4) }, { nav: "Expositores" }),
      sec("tabs", "programa", { eyebrow: "Agenda", title: "Programa", items: [tab("Día 1"), tab("Día 2")] }, { nav: "Programa" }),
      events("Inscripción", "list", "Entradas", "Inscripción"),
      sec("feature", "sede", { eyebrow: "Sede", title: "Dónde es", text: "", button_label: "", align: "right" }, { nav: "Sede" }),
      sec("gallery", "auspiciadores", { eyebrow: "Auspician", title: "Nuestros auspiciadores", layout: "logos", items: [] }, { nav: "Auspiciadores" }),
      sec("gallery", "fotos", { title: "La edición anterior", layout: "grid", items: [] }),
      faq([
        { question: "¿Cómo me acredito el día del evento?", answer: "Con tu entrada: te llega por correo con un código QR que se escanea en la acreditación." },
        ask("¿Entregan certificado de asistencia?"),
        ask("¿Las charlas quedan grabadas?"),
        FAQ_CONTACT,
      ]),
      cta("auspicios", "¿Quieres ser auspiciador?", "Conecta tu marca con nuestra comunidad.", "Quiero ser sponsor", "Auspicios", CONTACT_MODAL("tu marca y el tipo de participación que buscas")),
      contact("Empresas, auspicios y prensa", "Inscripciones grupales, auspicios o prensa: escríbenos."),
    ],
  },
  {
    key: "seminarios-ciclo",
    template: "seminarios",
    name: "Ciclo de charlas o meetup",
    description: "Próximas charlas, qué es, quiénes han expuesto y charlas anteriores en video.",
    layout: { nav: "top", sticky: true },
    theme: { primary: "#5eead4", accent: "#f59e0b", background: "#0f1b2d", text: "#e6f1ff", dark: true },
    sections: [
      sec("hero", "portada", { eyebrow: "Comunidad", layout: "split", button_label: "Inscríbete", button_url: "#eventos" }),
      events("Próximas charlas", "list", "Agenda", "Charlas"),
      sec("feature", "que-es", { eyebrow: "El ciclo", title: "Qué es", text: "", align: "left" }, { nav: "Qué es" }),
      sec("people", "speakers", { eyebrow: "Speakers", title: "Han pasado por aquí", layout: "carousel", items: people(4) }, { nav: "Speakers" }),
      sec("video", "charlas", { title: "Charlas anteriores", url: "" }, { nav: "Videos" }),
      cta("postula", "¿Quieres dar una charla?", "Buscamos speakers para las próximas fechas.", "Postula tu charla", "Postula tu charla", CONTACT_MODAL("el tema, una descripción corta y tu experiencia")),
      faq([FAQ_TICKET, ask("¿Qué tengo que llevar?"), ask("¿Hay cupos limitados?"), FAQ_CONTACT]),
      contact("Escríbenos", "Auspicios, espacios o ideas de charlas: te respondemos."),
    ],
  },
  {
    key: "seminarios-corporativo",
    template: "seminarios",
    name: "Eventos corporativos y capacitaciones",
    description: "Programas para empresas, formatos, quiénes confían y solicitud de propuesta.",
    layout: { nav: "top" },
    theme: { primary: "#1e3a8a", accent: "#0ea5e9", background: "#ffffff", text: "#0f172a", dark: false, font: "Inter" },
    sections: [
      sec("hero", "portada", { eyebrow: "Para empresas", layout: "split", button_label: "Ver próximos programas", button_url: "#eventos" }),
      events("Próximos programas", "list", "Inscripciones abiertas", "Programas"),
      sec("tabs", "formatos", { eyebrow: "Formatos", title: "Cómo trabajamos", items: [tab("Presencial"), tab("Online"), tab("In company")] }, { nav: "Formatos" }),
      sec("highlights", "plataforma", {
        eyebrow: "Inscripción",
        title: "Todo ordenado",
        items: [
          point("Inscripción online", "Cada participante se inscribe en minutos y recibe su entrada por correo."),
          point("Acreditación con QR", "Se acreditan escaneando su entrada: sin listas en papel."),
          point("Certificados de asistencia", "Al terminar, cada asistente puede recibir su certificado."),
        ],
      }),
      sec("gallery", "clientes", { title: "Han confiado en nosotros", layout: "logos", items: [] }, { nav: "Clientes" }),
      sec("testimonials", "opiniones", { title: "Lo que dicen los participantes", layout: "grid", items: quotes(2) }),
      cta("propuesta", "Capacitación para tu equipo", "Diseñamos el programa según tus objetivos.", "Solicitar propuesta", "Solicita una propuesta", CONTACT_MODAL("tu empresa, el tema, la cantidad de personas y la fecha estimada"), "Empresas"),
      contact("Conversemos", "Escríbenos y te respondemos en el día."),
    ],
  },

  // ----------------------------------------------------------------- Talleres
  {
    key: "talleres-tallerista",
    template: "talleres",
    name: "Tallerista independiente",
    description: "Próximos talleres, qué vas a hacer, quién enseña, trabajos y preguntas.",
    layout: { nav: "top" },
    sections: [
      sec("hero", "portada", { eyebrow: "Talleres", layout: "split", button_label: "Reservar mi cupo", button_url: "#eventos" }),
      events("Elige tu taller", "cards", "Próximos talleres", "Talleres"),
      sec("highlights", "haras", { eyebrow: "En el taller", title: "Lo que vas a hacer", items: [point("", ""), point("", ""), point("", "")] }),
      sec("feature", "quien-ensena", { eyebrow: "Quién enseña", title: "Hola, soy…", text: "", align: "left" }, { nav: "Sobre mí" }),
      sec("gallery", "trabajos", { title: "Trabajos de alumnos", layout: "grid", items: [] }, { nav: "Galería" }),
      sec("testimonials", "opiniones", { title: "Lo que dicen", layout: "grid", items: quotes(2) }),
      faq([FAQ_TICKET, ask("¿Necesito experiencia previa?"), ask("¿Incluye materiales?"), ask("¿Qué pasa si no puedo asistir?"), FAQ_CONTACT]),
      contact("Talleres a medida", "Para grupos, colegios o empresas: escríbenos."),
    ],
  },
  {
    key: "talleres-estudio",
    template: "talleres",
    name: "Estudio o espacio con varios talleres",
    description: "Menú lateral, disciplinas en pestañas, calendario, profes, el espacio y arriendo.",
    layout: { nav: "sidebar" },
    theme: { primary: "#c2410c", accent: "#0f766e", background: "#fbf6ee", text: "#1c1917", dark: false },
    sections: [
      sec("hero", "portada", { eyebrow: "Escuela de talleres", layout: "overlay", button_label: "Elige tu taller", button_url: "#eventos" }),
      sec("tabs", "disciplinas", { eyebrow: "Disciplinas", title: "Qué enseñamos", items: [tab("Disciplina 1"), tab("Disciplina 2"), tab("Disciplina 3")] }, { nav: "Disciplinas" }),
      events("Calendario", "list", "Matrícula abierta", "Calendario"),
      sec("people", "profes", { eyebrow: "Profes", title: "Quiénes enseñan", layout: "grid", items: people(4) }, { nav: "Profes" }),
      sec("feature", "espacio", { eyebrow: "El espacio", title: "Dónde nos encontramos", text: "", align: "right" }, { nav: "El espacio" }),
      sec("gallery", "galeria", { title: "Así son las clases", layout: "carousel", items: [] }),
      cta("empresas", "Talleres para empresas", "Llevamos nuestros talleres a tu equipo.", "Más información", "Talleres para empresas", CONTACT_MODAL("tu empresa, el taller que te interesa y la cantidad de personas")),
      faq([FAQ_TICKET, ask("¿Hay clases de prueba?"), ask("¿Incluye materiales?"), FAQ_CONTACT]),
      contact("Escríbenos", "Dudas, grupos o arriendo del espacio: te respondemos."),
    ],
  },
  {
    key: "talleres-empresas",
    template: "talleres",
    name: "Talleres para empresas y grupos",
    description: "Beneficios, formatos por tamaño de grupo, qué incluye y cotización.",
    layout: { nav: "top" },
    theme: { primary: "#166534", accent: "#facc15", background: "#f4f6f1", text: "#1f2329", dark: false },
    sections: [
      sec("hero", "portada", { eyebrow: "Team building", layout: "split", button_label: "Cotiza para tu equipo", button_url: "#cotiza" }),
      sec("highlights", "beneficios", { eyebrow: "Por qué un taller", title: "Para tu equipo", items: [point("", ""), point("", ""), point("", "")] }),
      sec("tabs", "formatos", { eyebrow: "Formatos", title: "Según el tamaño de tu grupo", items: [tab("Grupos pequeños"), tab("Grupos medianos"), tab("Grupos grandes")] }, { nav: "Formatos" }),
      sec("gallery", "empresas", { title: "Empresas que nos han elegido", layout: "logos", items: [] }, { nav: "Clientes" }),
      sec("testimonials", "opiniones", { title: "Lo que dicen los equipos", layout: "grid", items: quotes(2) }),
      events("Talleres abiertos", "cards", "También para personas", "Talleres"),
      cta("cotiza", "Cotiza tu taller", "Cuéntanos de tu equipo y armamos la propuesta.", "Cotizar", "Cotiza tu taller", CONTACT_MODAL("tu empresa, la cantidad de personas, la fecha y el lugar"), "Cotizar"),
      contact("Conversemos", "Escríbenos y te respondemos con una propuesta."),
    ],
  },

  // ----------------------------------------------------------------- Academias
  {
    key: "academias-baile",
    template: "academias",
    name: "Academia de baile",
    description: "Horarios por nivel, clases e inscripción, profes, clase de prueba y FAQ.",
    layout: { nav: "top", sticky: true },
    theme: { primary: "#f472b6", accent: "#facc15", background: "#140a1f", text: "#f8eefc", dark: true, font: "Bricolage Grotesque" },
    sections: [
      sec("hero", "portada", { eyebrow: "Inscripciones abiertas", layout: "overlay", button_label: "Inscríbete", button_url: "#eventos" }),
      sec("tabs", "horarios", { eyebrow: "Horarios", title: "Encuentra tu nivel", items: [tab("Principiante"), tab("Intermedio"), tab("Avanzado")] }, { nav: "Horarios" }),
      events("Clases y talleres", "cards", "Inscripción", "Inscripción"),
      sec("people", "profes", { eyebrow: "Profes", title: "Quiénes enseñan", layout: "carousel", items: people(3) }, { nav: "Profes" }),
      cta("prueba", "¿Primera vez?", "Ven a conocer la academia.", "Pedir clase de prueba", "Clase de prueba", CONTACT_MODAL("el estilo que te interesa y tu nivel")),
      sec("gallery", "galeria", { title: "Así bailamos", layout: "carousel", items: [] }),
      faq([FAQ_TICKET, ask("¿Necesito ir con pareja?"), ask("¿Qué ropa y zapatos llevo?"), ask("¿Desde qué edad pueden inscribirse?"), FAQ_CONTACT], "Si es tu primera vez", "Preguntas"),
      contact("¿Tienes dudas?", "Escríbenos y te ayudamos a elegir tu clase."),
    ],
  },
  {
    key: "academias-musica",
    template: "academias",
    name: "Escuela de música",
    description: "Instrumentos en pestañas, docentes, inscripciones, muestras y conciertos.",
    layout: { nav: "centered" },
    theme: { primary: "#1e3a5f", accent: "#e0a526", background: "#fbf7f0", text: "#1b1712", dark: false, font: "Playfair Display" },
    sections: [
      sec("hero", "portada", { eyebrow: "Admisión abierta", layout: "split", button_label: "Inscríbete aquí", button_url: "#eventos" }),
      sec("tabs", "instrumentos", { eyebrow: "Clases", title: "Qué puedes aprender", items: [tab("Guitarra"), tab("Piano"), tab("Canto")] }, { nav: "Clases" }),
      sec("people", "docentes", { eyebrow: "Docentes", title: "Quiénes enseñan", layout: "grid", items: people(4) }, { nav: "Docentes" }),
      events("Inscripciones abiertas", "list", "Cursos y muestras", "Inscripción"),
      sec("feature", "conciertos", { eyebrow: "Muestras y conciertos", title: "Los alumnos al escenario", text: "", align: "right" }),
      sec("testimonials", "opiniones", { title: "Lo que dicen alumnos y apoderados", layout: "carousel", items: quotes(3) }),
      cta("informacion", "¿Quieres más información?", "Te orientamos según tu edad y tu nivel.", "Quiero información", "Quiero información", CONTACT_MODAL("el instrumento, tu edad y tu nivel")),
      faq([FAQ_TICKET, ask("¿Necesito tener instrumento?"), ask("¿Desde qué edad se puede empezar?"), FAQ_CONTACT]),
      contact("Admisión", "Escríbenos y te ayudamos a elegir tu curso."),
    ],
  },
  {
    key: "academias-cursos",
    template: "academias",
    name: "Cursos y formación",
    description: "Catálogo de cursos, programa por módulos, metodología, docentes y certificado.",
    layout: { nav: "top", sticky: true },
    sections: [
      sec("hero", "portada", { eyebrow: "Cursos", layout: "split", button_label: "Inscribirme ahora", button_url: "#eventos" }),
      events("Próximos cursos", "list", "Catálogo", "Cursos"),
      sec("tabs", "programa", { eyebrow: "Programa", title: "Qué vas a aprender", items: [tab("Módulo 1"), tab("Módulo 2"), tab("Módulo 3")] }, { nav: "Programa" }),
      sec("feature", "metodologia", { eyebrow: "Metodología", title: "Cómo aprendes", text: "", align: "left" }, { nav: "Metodología" }),
      sec("people", "docentes", { eyebrow: "Docentes", title: "Quiénes enseñan", layout: "grid", items: people(3) }, { nav: "Docentes" }),
      sec("testimonials", "opiniones", { title: "Lo que dicen quienes estudiaron", layout: "carousel", items: quotes(3) }),
      faq([FAQ_TICKET, ask("¿Entregan certificado?"), ask("¿Las clases son presenciales u online?"), ask("¿Puedo pagar en cuotas?"), FAQ_CONTACT]),
      cta("empresas", "Formación para empresas", "Cursos cerrados para tu equipo.", "Conversemos", "Cursos para empresas", CONTACT_MODAL("tu empresa, el tema y la cantidad de personas")),
      contact("¿Tienes dudas?", "Escríbenos y te ayudamos a elegir tu curso."),
    ],
  },

  // ----------------------------------------------------------------- General
  {
    key: "general-productora",
    template: "clasico",
    name: "Productora multiformato",
    description: "Para productoras con eventos de distintos tipos: cartelera, quiénes somos, fotos y contacto.",
    layout: { nav: "top" },
    sections: [
      sec("hero", "portada", { layout: "split", button_label: "Ver eventos", button_url: "#eventos" }),
      events("Próximos eventos", "cards", "", "Eventos"),
      sec("feature", "nosotros-bloque", { eyebrow: "Productora", title: "Lo que hacemos", text: "", align: "right" }, { nav: "Nosotros" }),
      sec("gallery", "fotos", { title: "Eventos anteriores", layout: "carousel", items: [] }, { nav: "Fotos" }),
      sec("highlights", "comprar", { title: "Cómo comprar", items: BUY_POINTS.map((p) => ({ ...p })) }),
      faq([FAQ_TICKET, FAQ_ONLINE, FAQ_CONTACT]),
      contact("¿Quieres contactarnos?", "Escríbenos y te responderemos a tu correo."),
    ],
  },
];

// Copias saneadas (mismas reglas que lo que guarda el editor); los ítems vacíos se conservan como guía
export const SITE_PRESETS: SitePreset[] = PRESETS.map((p) => ({
  ...p,
  layout: sanitizeLayout(p.layout),
  sections: sanitizeSections(p.sections, { keepEmpty: true }),
}));

export const PRESET_BY_KEY: Record<string, SitePreset> = Object.fromEntries(SITE_PRESETS.map((p) => [p.key, p]));

/** Plantillas agrupadas por estilo (nicho), en el orden del editor. */
export function presetGroups(templates: SiteTemplate[]): { template: SiteTemplate; name: string; presets: SitePreset[] }[] {
  return templates
    .map((template) => ({ template, name: TEMPLATE_INFO[template]?.name || template, presets: SITE_PRESETS.filter((p) => p.template === template) }))
    .filter((g) => g.presets.length);
}

export interface AppliedPreset {
  template: SiteTemplate;
  theme: Record<string, unknown>;
  layout: SiteLayoutSettings;
  sections: SiteSection[];
  preset: string;
}

/**
 * Aplica una plantilla al borrador: estilo, paleta, menú y secciones con su copy. Se conservan el logo y la imagen de
 * portada del productor (y su "Sobre nosotros", que vive fuera de las secciones). null si la plantilla no existe.
 */
export function applyPreset(key: string, currentTheme: Record<string, unknown> = {}): AppliedPreset | null {
  const preset = PRESET_BY_KEY[key];
  if (!preset) return null;
  const theme: Record<string, unknown> = { ...(preset.theme || {}) };
  if (typeof currentTheme.logo_url === "string") theme.logo_url = currentTheme.logo_url;
  if (typeof currentTheme.hero_image_url === "string") theme.hero_image_url = currentTheme.hero_image_url;
  return {
    template: preset.template,
    theme,
    layout: { ...preset.layout },
    sections: JSON.parse(JSON.stringify(preset.sections)),
    preset: preset.key,
  };
}
