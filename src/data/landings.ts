// Landings SEO para productores (verticales y por funcionalidad). Una página por intención de búsqueda, cada una
// con contenido propio: NO clonar textos cambiando solo el tipo de evento (política de Google sobre contenido
// a escala). Todo lo que se promete está verificado contra el producto (docs/slide.txt: solo lo que hace HOY):
//   tarifas → netlify/lib/fees.mjs · plazos de pago → netlify/lib/legal.mjs (PAYOUT_*)
//   funciones (máx. 60) → producer-api/tools/schedule.ts · duplicar → tools/lifecycle.ts
//   códigos de descuento → netlify/lib/discounts.mjs · links con ref/UTM → TrackingLinkBuilder.vue
//   métricas por canal → dashboard/events/[id]/analytics.astro · check-in offline → ValidateQR.vue
//   link de puerta sin cuenta → tools/access.ts (hoy solo desde el conector de IA)
// Si cambia el producto, actualizar aquí y en src/data/producerFaq.ts.
import { SERVICE_FEE_PERCENT_LABEL, computeFeeSplit } from "../../netlify/lib/fees.mjs";
import { PAYOUT_RELEASE_HOURS, PAYOUT_BUSINESS_DAYS } from "../../netlify/lib/legal.mjs";
import type { FaqItem } from "./producerFaq";

export type LandingSection = {
    heading: string;
    body?: string;
    items?: { title: string; text: string }[];
    /** Pasos numerados (cómo se hace). */
    steps?: string[];
};

export type Landing = {
    slug: string;
    kind: "vertical" | "feature";
    /** Tarjeta en el hub /organizadores y en "relacionadas". */
    card: { title: string; text: string };
    title: string;
    description: string;
    eyebrow: string;
    h1: string;
    intro: string;
    highlights: string[];
    sections: LandingSection[];
    faq: FaqItem[];
    demo?: { url: string; label: string };
    cta: { label: string; campaign: string };
    related: string[];
};

const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const fee = `${SERVICE_FEE_PERCENT_LABEL} + IVA`;
const ex = computeFeeSplit(10000);
const payout = `Lo de cada función queda disponible ${PAYOUT_RELEASE_HOURS} h después de que termina; pides el retiro y llega en hasta ${PAYOUT_BUSINESS_DAYS} días hábiles.`;

export const LANDINGS: Landing[] = [
    {
        slug: "ticketera-stand-up",
        kind: "vertical",
        card: { title: "Stand-up y comedia", text: "Funciones semanales, line-up que promociona y un link por comediante." },
        title: "Ticketera para stand-up y comedia en Chile | AI Tickets",
        description: "Vende entradas para tus shows de stand-up: funciones semanales, un link de venta por comediante para saber quién vende, check-in con QR y 0% de comisión para el productor.",
        eyebrow: "Para productores de comedia",
        h1: "La ticketera para el stand-up que se presenta todas las semanas",
        intro:
            "Un show de comedia se vende entre todos: el local, el productor y cada comediante del line-up compartiendo en sus redes. AI Tickets te deja publicar las funciones de la semana en minutos y saber qué parte de la venta trajo cada uno.",
        highlights: [
            "Un link de venta por comediante",
            "Duplica el show para la próxima semana",
            `0% de comisión para ti; el comprador paga ${fee}`,
        ],
        sections: [
            {
                heading: "¿Quién del line-up está moviendo el show?",
                body:
                    "Crea un link con seguimiento para cada comediante y pídeles que lo usen en sus historias. En las métricas del evento ves cuántas órdenes, entradas e ingresos llegaron por cada link, comparados con la venta directa y tus campañas. Sirve para ordenar el line-up, decidir a quién invitar de nuevo o repartir incentivos con números en la mano.",
            },
            {
                heading: "Del jueves de esta semana al de la próxima",
                items: [
                    { title: "Duplica el evento", text: "Copia descripción, imagen, lugar, tipos de entrada y preguntas frecuentes. Solo agregas la fecha nueva." },
                    { title: "Varias funciones en un evento", text: "¿Dos funciones el mismo sábado o una gira corta? Hasta 60 funciones por evento, con entradas para cada una." },
                    { title: "Códigos para el line-up", text: "Dale a cada comediante su código de descuento con cupo y fecha límite para su público." },
                ],
            },
            {
                heading: "La noche del show",
                body:
                    "La entrada llega al comprador por email con su QR. En la puerta, tu equipo valida desde el celular, incluso si el bar tiene mala señal: la lista se descarga y se sincroniza después. Las cortesías para invitados del elenco llegan con su propio QR.",
            },
        ],
        faq: [
            {
                q: "¿Cada comediante puede ver cuánto vendió?",
                a: "Las métricas las ve tu equipo en el panel según su rol. Para compartir el resultado con el line-up, exporta las órdenes a CSV o comparte la tabla de ventas por canal.",
            },
            {
                q: "¿Sirve para open mics o funciones gratis?",
                a: "Sí. Puedes publicar eventos gratuitos con inscripción: la gente recibe su QR igual que en una función pagada y no se cobra cargo por servicio.",
            },
            { q: "¿Cuándo recibo la plata de cada show?", a: payout, terms: true },
        ],
        demo: { url: "/eventos/evento-demo-aitickets", label: "Ver un evento de stand-up de ejemplo" },
        cta: { label: "Publicar mi próximo show", campaign: "vertical_standup" },
        related: ["ventas-por-promotor", "entradas-con-qr", "guias/como-medir-ventas-por-promotor"],
    },
    {
        slug: "ticketera-teatro",
        kind: "vertical",
        card: { title: "Teatro independiente", text: "Una obra, muchas funciones: cartelera, prensa e invitados en un solo evento." },
        title: "Venta de entradas para teatro independiente | AI Tickets",
        description: "Publica tu obra con todas sus funciones, vende entradas por función con Webpay y tarjetas, maneja cortesías de prensa y valida con QR. Sin mensualidad.",
        eyebrow: "Para compañías y productoras de teatro",
        h1: "Vende las funciones de tu obra sin rehacer el evento cada semana",
        intro:
            "Una obra en cartelera son muchas funciones con el mismo elenco, la misma sala y el mismo público objetivo. En AI Tickets publicas la obra una vez y agregas sus funciones; cada entrada queda asociada a su fecha y la sala sabe exactamente quién llega.",
        highlights: ["Todas las funciones en una sola página", "Cortesías de prensa e invitados con QR", "Cobras función por función"],
        sections: [
            {
                heading: "Una página para toda la temporada",
                body:
                    "Agrega hasta 60 funciones a la obra. El público elige la fecha en la misma página y recibe su entrada para esa función. Si cambia un horario, avisamos por email a quienes ya compraron para esa fecha.",
            },
            {
                heading: "Prensa, elenco e invitados",
                items: [
                    { title: "Cortesías en un minuto", text: "Envía cortesías por email desde el panel, con la cantidad de entradas que necesites. No cuentan como venta." },
                    { title: "Equipo con su rol", text: "Producción, boletería y difusión con permisos distintos: Puerta, Marketing, Finanzas o Solo lectura." },
                    { title: "Preguntas del público", text: "La página de la obra tiene un asistente que responde dudas de duración, edad recomendada o accesos con la información que cargaste." },
                ],
            },
            {
                heading: "Cobras cada función, no al cierre de la temporada",
                body: `${payout} Así puedes pagar sala, técnica y elenco mientras la obra sigue en cartelera.`,
            },
        ],
        faq: [
            {
                q: "¿Puedo tener entradas generales y precios distintos por función?",
                a: "Sí. Puedes crear tipos de entrada para una función específica (por ejemplo, el estreno) o válidos para cualquier función.",
            },
            {
                q: "¿Funciona si la obra es en una sala que no tiene ticketera propia?",
                a: "Sí. AI Tickets te da la página de venta, el cobro y el control de acceso con QR desde el celular; no necesitas equipos especiales.",
            },
            {
                q: "¿Cuánto paga el público?",
                a: `El valor de la entrada más un cargo por servicio de ${fee}. En una entrada de ${clp(10000)}, el comprador paga ${clp(ex.total)} y tú recibes ${clp(ex.producerNet)}. También puedes absorber el cargo.`,
            },
        ],
        demo: { url: "/eventos/evento-demo-teatro", label: "Ver una obra de ejemplo" },
        cta: { label: "Publicar mi obra", campaign: "vertical_teatro" },
        related: ["entradas-con-qr", "vender-entradas-online", "guias/como-hacer-una-preventa"],
    },
    {
        slug: "ticketera-musica-en-vivo",
        kind: "vertical",
        card: { title: "Música en vivo", text: "Preventas, tipos de entrada con cupo y difusión medida por canal." },
        title: "Plataforma para vender entradas de conciertos | AI Tickets",
        description: "Vende entradas para tus tocatas y conciertos: preventa, tipos de entrada con cupo, códigos de descuento, links por canal y check-in con QR. 0% de comisión para el productor.",
        eyebrow: "Para bandas, salas y productores de música",
        h1: "Entradas para tus conciertos, con preventa y difusión medida",
        intro:
            "En música la venta se juega en las primeras horas y en la última semana. AI Tickets te ayuda a armar la preventa, ver qué canal de difusión vende y llegar a la puerta con todo ordenado.",
        highlights: ["Preventa con cupo limitado", "Links para cada banda, medio o campaña", "Check-in con QR aunque no haya señal"],
        sections: [
            {
                heading: "Preventa que se agota de verdad",
                items: [
                    { title: "Tipos de entrada con cupo", text: "Crea una entrada \"Preventa\" con menos unidades y menor precio; cuando se agota, queda la general." },
                    { title: "Códigos con fecha límite", text: "Descuentos por porcentaje o monto, con usos máximos, límite por comprador y fecha de término." },
                    { title: "Varias fechas", text: "¿Gira o doble fecha? Hasta 60 funciones por evento, cada una con sus entradas." },
                ],
            },
            {
                heading: "Mide la difusión",
                body:
                    "Arma un link con seguimiento para cada banda del cartel, medio o campaña pagada. En las métricas del evento ves visitas, conversión y ventas por canal, y también desde qué ciudades te visitan y a qué hora se vende más.",
            },
            {
                heading: "Posts con IA para cada anuncio",
                body: "Genera textos e imágenes para Instagram y Facebook a partir de tu evento y publícalos desde el panel cuando conectes tus cuentas.",
            },
        ],
        faq: [
            {
                q: "¿Puedo vender entradas de distintas zonas o precios?",
                a: "Sí, con tipos de entrada distintos, cada uno con su precio y su cupo. AI Tickets no tiene mapa de asientos numerados.",
            },
            { q: "¿Cómo cobro si hago varias fechas?", a: payout, terms: true },
            {
                q: "¿Hay costo por usar la plataforma?",
                a: `No hay mensualidad ni costo por publicar. El comprador paga un cargo por servicio de ${fee} por entrada pagada.`,
            },
        ],
        demo: { url: "/eventos/evento-demo-concierto", label: "Ver un concierto de ejemplo" },
        cta: { label: "Publicar mi próximo concierto", campaign: "vertical_musica" },
        related: ["ventas-por-promotor", "guias/como-hacer-una-preventa", "vender-entradas-online"],
    },
    {
        slug: "ticketera-talleres",
        kind: "vertical",
        card: { title: "Talleres y charlas", text: "Cupos por fecha, inscripciones gratis o pagadas y recordatorios automáticos." },
        title: "Venta de entradas e inscripciones para talleres | AI Tickets",
        description: "Publica tus talleres, cursos cortos y charlas con cupos por fecha. Inscripciones gratis sin costo o pagadas con Webpay, recordatorio automático y asistencia con QR.",
        eyebrow: "Para talleres, cursos cortos y charlas",
        h1: "Inscripciones para tus talleres, con cupos y recordatorios automáticos",
        intro:
            "Un taller tiene cupos chicos, fechas que se repiten y asistentes que hay que recordar. AI Tickets te da una página de inscripción, cobra si corresponde y le avisa a cada persona antes de la sesión.",
        highlights: ["Gratis para eventos gratuitos", "Cupos por fecha", "Recordatorio por email antes de cada sesión"],
        sections: [
            {
                heading: "Cupos claros en cada fecha",
                body:
                    "Agrega cada sesión como una función y define cuántos cupos tiene cada tipo de entrada. Cuando se llena, la página deja de vender esa entrada.",
            },
            {
                heading: "Gratis o pagado",
                items: [
                    { title: "Eventos gratuitos", text: "Inscripción con nombre y email, entrada con QR y sin cargo por servicio." },
                    { title: "Pagado con Webpay", text: `El participante paga con Webpay o tarjeta; el cargo por servicio es ${fee} y puedes absorberlo para mostrar un precio final.` },
                    { title: "Códigos para tu comunidad", text: "Descuentos para ex alumnos, socios o grupos, con cupo y fecha límite." },
                ],
            },
            {
                heading: "Que nadie se olvide",
                body:
                    "Cada inscrito recibe su entrada por email al instante y un recordatorio antes de la sesión. Si cambias fecha u horario, les avisamos automáticamente.",
            },
        ],
        faq: [
            {
                q: "¿Puedo pedir datos adicionales al inscribirse?",
                a: "Cada inscripción guarda el nombre y el email de la persona. Puedes exportar las órdenes a CSV para tu registro.",
            },
            {
                q: "¿Puedo escribirle a los inscritos?",
                a: "Sí, por email a quienes tienen entrada para tu evento (por ejemplo, para enviar materiales o indicaciones), desde tu asistente de IA conectado.",
            },
            { q: "¿Cuánto cuesta un taller gratuito?", a: "Nada. Las entradas gratis no pagan cargo por servicio y no hay mensualidad." },
        ],
        demo: { url: "/eventos/evento-demo-gratis", label: "Ver una inscripción gratuita de ejemplo" },
        cta: { label: "Publicar mi taller", campaign: "vertical_talleres" },
        related: ["vender-entradas-online", "entradas-con-qr", "guias/como-vender-entradas-online"],
    },
    {
        slug: "vender-entradas-online",
        kind: "feature",
        card: { title: "Vender entradas online", text: "Cómo publicar tu evento y cobrar con Webpay en Chile, paso a paso." },
        title: "Vender entradas online en Chile: gratis para publicar | AI Tickets",
        description: "Crea la página de tu evento y vende entradas online con Webpay y tarjetas. Publicar es gratis, sin mensualidad y con 0% de comisión para el productor.",
        eyebrow: "Vender entradas online",
        h1: "Vende entradas online para tu evento en Chile",
        intro:
            "Publicar tu evento en AI Tickets es gratis: creas la página, defines tus entradas y la compartes. El comprador paga con Webpay o tarjeta, recibe su entrada con QR por email y tú ves cada venta en tu panel.",
        highlights: ["Publicar es gratis", "Webpay y tarjetas", `0% de comisión para ti; el comprador paga ${fee}`],
        sections: [
            {
                heading: "Cómo empezar",
                steps: [
                    "Crea tu cuenta con tu correo y confírmalo.",
                    "Ponle nombre a tu productora: con eso también queda lista tu web de eventos gratis.",
                    "Crea el evento: fotos, descripción, lugar, funciones y tipos de entrada. La IA te ayuda con la descripción y las preguntas frecuentes.",
                    "Revísalo con el link de vista previa y publícalo.",
                    "Comparte el link (uno con seguimiento por canal) y mira las ventas en el panel.",
                ],
            },
            {
                heading: "Qué incluye",
                items: [
                    { title: "Página del evento", text: "Optimizada para el celular, con preguntas frecuentes y un asistente que responde dudas de los compradores." },
                    { title: "Pagos", text: "Webpay y tarjetas. La comisión de la pasarela de pago la cubre AI Tickets." },
                    { title: "Entradas con QR", text: "Llegan por email al instante, con recordatorio antes del evento." },
                    { title: "Métricas", text: "Visitas, conversión, ventas por día, por canal y por tipo de entrada. Exporta a CSV." },
                ],
            },
            {
                heading: "Cuánto cuesta",
                body: `Publicar es gratis y no hay mensualidad. Por cada entrada pagada, el comprador paga un cargo por servicio de ${fee}: en una entrada de ${clp(10000)} paga ${clp(ex.total)} y tú recibes ${clp(ex.producerNet)}. ${payout}`,
            },
        ],
        faq: [
            {
                q: "¿Necesito iniciación de actividades o empresa?",
                a: "Para publicar basta con tu cuenta. Para retirar el dinero registras una cuenta bancaria a tu nombre o al de tu empresa, que AI Tickets verifica.",
            },
            { q: "¿Puedo vender entradas para eventos gratis?", a: "Sí. Las entradas gratis no pagan cargo y los asistentes reciben su QR igual." },
            { q: "¿Puedo ver mi evento antes de publicarlo?", a: "Sí. Los eventos se crean como borrador y puedes compartir un link de vista previa privado con tu equipo o el artista." },
        ],
        cta: { label: "Crear mi evento gratis", campaign: "feature_vender_online" },
        related: ["guias/como-vender-entradas-online", "entradas-con-qr", "ticketeras-en-chile"],
    },
    {
        slug: "entradas-con-qr",
        kind: "feature",
        card: { title: "Entradas con QR y check-in", text: "Control de acceso desde el celular, con o sin señal." },
        title: "Entradas con QR y control de acceso para eventos | AI Tickets",
        description: "Cada entrada lleva un código QR único. Valídalas desde el celular, aunque se caiga la señal, con un equipo de puerta sin contraseñas compartidas. Gratis para eventos gratuitos.",
        eyebrow: "Control de acceso",
        h1: "Entradas con QR y check-in desde el celular",
        intro:
            "Cada entrada vendida o inscrita en AI Tickets lleva un código QR único. En la puerta, tu equipo lo escanea con la cámara del celular y el sistema avisa si la entrada ya se usó.",
        highlights: ["Sin apps ni lectores especiales", "Funciona sin señal", "Sin compartir tu contraseña"],
        sections: [
            {
                heading: "Así funciona en la puerta",
                steps: [
                    "Cada comprador recibe su entrada con QR por email al instante.",
                    "Tu equipo abre el validador en el navegador del celular y escanea cada QR.",
                    "Si la entrada ya se usó, el validador lo indica y no deja pasar dos veces con el mismo código.",
                    "Si se cae la señal, sigue validando con la lista descargada; al volver la conexión, se sincroniza.",
                ],
            },
            {
                heading: "Tu equipo de puerta",
                items: [
                    { title: "Rol Puerta", text: "Invita a tu equipo con el rol Puerta: valida entradas, pero no ve finanzas ni exporta datos de los compradores." },
                    { title: "Link temporal sin cuenta", text: "Para personal de un día, crea un link de puerta desde tu asistente de IA: no pide cuenta, solo muestra nombre y tipo de entrada, y vence solo." },
                    { title: "Cortesías", text: "Las cortesías tienen su propio QR y se validan como cualquier entrada." },
                ],
            },
            {
                heading: "Para eventos gratis también",
                body: "Si tu evento es gratuito, los asistentes se inscriben y reciben su QR sin pagar nada, y tú tampoco pagas cargo por servicio. Así sabes quién llegó y quién no.",
            },
        ],
        faq: [
            {
                q: "¿Qué pasa si dos personas escanean al mismo tiempo sin señal?",
                a: "Con conexión, el sistema rechaza el segundo escaneo. Sin señal, cada celular valida con su lista descargada; recomendamos que cada puerta use un solo dispositivo mientras no haya conexión.",
            },
            { q: "¿Necesito comprar lectores?", a: "No. Basta un celular con cámara y navegador." },
            {
                q: "¿Puedo ver cuánta gente ha llegado?",
                a: "Sí. Puedes preguntar por la asistencia (llegadas por tipo de entrada y por función) a tu asistente de IA conectado.",
            },
        ],
        cta: { label: "Crear mi evento con QR", campaign: "feature_qr" },
        related: ["guias/como-hacer-check-in-con-qr", "ticketera-teatro", "ticketera-talleres"],
    },
    {
        slug: "ventas-por-promotor",
        kind: "feature",
        card: { title: "Ventas por promotor", text: "Links con seguimiento para saber quién vende tus entradas." },
        title: "Links de venta por promotor: mide quién vende | AI Tickets",
        description: "Crea un link de venta para cada promotor, comediante o campaña y ve cuántas entradas e ingresos trae cada uno en las métricas de tu evento.",
        eyebrow: "Seguimiento de ventas",
        h1: "Sabe qué promotor, artista o campaña vende tus entradas",
        intro:
            "Cuando varias personas difunden un evento, es difícil saber quién trajo cada venta. Con AI Tickets le das a cada uno su propio link y las métricas del evento muestran el resultado de cada canal.",
        highlights: ["Un link por persona o campaña", "Órdenes, entradas e ingresos por canal", "Se combina con códigos de descuento"],
        sections: [
            {
                heading: "Cómo se arma",
                steps: [
                    "En el panel, abre el generador de links de tu evento y ponle un nombre a cada canal (por ejemplo, \"pedro-ig\" o \"campana-meta\").",
                    "Comparte cada link con su promotor, artista o en su campaña.",
                    "Cada compra hecha desde ese link queda marcada con su canal.",
                    "En las métricas del evento revisa la tabla de ventas por canal: órdenes, entradas e ingresos, ordenados por ventas.",
                ],
            },
            {
                heading: "Qué cuenta y qué no",
                body:
                    "La venta se asocia al link cuando la persona compra en la misma visita en que llegó con él. Si vuelve otro día escribiendo la dirección a mano, cuenta como venta directa. Para campañas largas, súmale un código de descuento propio de cada promotor: así también capturas las compras que llegan por otra vía.",
            },
            {
                heading: "Para qué te sirve",
                items: [
                    { title: "Decidir dónde difundir", text: "Concentra tu próxima publicación o tu presupuesto en el canal que convierte." },
                    { title: "Ordenar el line-up", text: "Ve qué artistas mueven su show y cuáles necesitan apoyo." },
                    { title: "Calcular incentivos", text: "Exporta las órdenes a CSV con su canal para liquidar comisiones de tus promotores." },
                ],
            },
        ],
        faq: [
            {
                q: "¿Los promotores necesitan cuenta?",
                a: "No. Solo necesitan su link. Las métricas las ve tu equipo en el panel según su rol.",
            },
            {
                q: "¿Puedo comparar el mismo promotor en varias fechas?",
                a: "Las métricas por canal se ven por evento. Si haces funciones semanales, puedes comparar evento contra evento o exportar las órdenes a CSV.",
            },
            {
                q: "¿Funciona con los UTM de mis campañas?",
                a: "Sí. Los links usan ref y parámetros UTM estándar, así que también puedes usarlos en tus anuncios.",
            },
        ],
        cta: { label: "Crear mis links de venta", campaign: "feature_promotores" },
        related: ["ticketera-stand-up", "guias/como-medir-ventas-por-promotor", "ticketera-musica-en-vivo"],
    },
];

export const getLanding = (slug: string) => LANDINGS.find((l) => l.slug === slug);
