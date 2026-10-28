// Landings SEO para productores (verticales y por funcionalidad). Una página por intención de búsqueda, cada una
// con contenido propio: NO clonar textos cambiando solo el tipo de evento (política de Google sobre contenido
// a escala). Todo lo que se promete está verificado contra el producto (docs/slide.txt: solo lo que hace HOY):
//   tarifas → netlify/lib/fees.mjs · plazos de pago → netlify/lib/legal.mjs (PAYOUT_*)
//   funciones (máx. 60) → producer-api/tools/schedule.ts · duplicar → tools/lifecycle.ts
//   códigos de descuento → netlify/lib/discounts.mjs · links con ref/UTM → TrackingLinkBuilder.vue
//   métricas por canal → dashboard/events/[id]/analytics.astro · check-in offline → ValidateQR.vue
//   link de puerta sin cuenta → tools/access.ts (hoy solo desde el conector de IA)
//   máximo por compra → event_tickets.max_quantity (DEFAULT_MAX_PER_PURCHASE; hoy se cambia desde tools/tickets.ts)
//   búsqueda por nombre y reenvío de entradas en la puerta → ValidateQR.vue (/api/orders/resend)
// Si cambia el producto, actualizar aquí y en src/data/producerFaq.ts.
import { IVA_PERCENT_LABEL, SERVICE_FEE_PERCENT_LABEL, computeFeeSplit } from "../../netlify/lib/fees.mjs";
import { PAYOUT_RELEASE_HOURS, PAYOUT_BUSINESS_DAYS } from "../../netlify/lib/legal.mjs";
import { DEFAULT_MAX_PER_PURCHASE } from "../components/Reservation/pricing.js";
import { ABSORB_FEE_ACTIVATION, MAX_EVENT_FUNCTIONS, PRODUCER_FAQ, type FaqItem } from "./producerFaq";

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
    /**
     * La landing tiene página propia con diseño especializado en src/pages/<slug>.astro (por ejemplo
     * /ticketera-stand-up, docs/specs/rediseno/SPEC_landing_standup_aitickets.md): [landing].astro no la genera, pero
     * la tarjeta, el sitemap, las relacionadas y las guías siguen leyendo estos datos.
     */
    dedicated?: boolean;
};

const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const fee = `${SERVICE_FEE_PERCENT_LABEL} + IVA`;
const ex = computeFeeSplit(10000);
const payout = `Lo de cada función queda disponible ${PAYOUT_RELEASE_HOURS} h después de que termina; pides el retiro y llega en hasta ${PAYOUT_BUSINESS_DAYS} días hábiles.`;
const producerFaq = (q: string): FaqItem => {
    const item = PRODUCER_FAQ.find((f) => f.q === q);
    if (!item) throw new Error(`Falta la pregunta "${q}" en PRODUCER_FAQ`);
    return item;
};

export const LANDINGS: Landing[] = [
    {
        slug: "ticketera-stand-up",
        kind: "vertical",
        card: { title: "Stand-up y comedia", text: "Funciones semanales, line-up que promociona y un link por comediante." },
        title: "Vende entradas para stand-up en Chile · 0% de comisión | AI Tickets",
        description: "Ticketera para stand-up: vende entradas para tus shows de comedia y open mics, con un link por comediante para saber quién vende, difusión automática en Instagram, check-in con QR y 0% de comisión para ti.",
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
        dedicated: true,
    },
    {
        slug: "ticketera-teatro",
        kind: "vertical",
        card: { title: "Teatro independiente", text: "Una obra, muchas funciones: cartelera, prensa e invitados en un solo evento." },
        title: "Ticketera para teatro en Chile: vende tu temporada · 0% de comisión | AI Tickets",
        description:
            "Vende las entradas de tu obra: todas las funciones en una página, aforo por función, cortesías de prensa con QR y cobro por función. 0% de comisión.",
        eyebrow: "Para compañías de teatro y salas",
        h1: "Que suba el telón. La boletería de tu obra ya está lista.",
        intro:
            `Una obra en cartelera son muchas funciones con el mismo elenco, la misma sala y el mismo público. En AI Tickets publicas la obra una vez con todas sus funciones, cada una con su aforo; mandas las cortesías de prensa con su QR y lo de cada función queda disponible ${PAYOUT_RELEASE_HOURS} h después de que termina.`,
        highlights: ["Todas las funciones en una sola página", "Cortesías de prensa con QR", "Aforo por función"],
        // Plata: la spec (§9) pide "cobro función por función" y el highlight "Cobras función por función*"; con
        // dedicated nada pinta los highlights (ni el asterisco de TERMS_NOTE), y el cobro por función depende de la
        // reserva por riesgo (Preguntas abiertas 1), así que aquí va solo lo de legal.mjs, sin promesa con asterisco.
        // La página es propia (src/pages/ticketera-teatro.astro, SPEC_landing_teatro): las secciones viven en
        // src/components/landing/teatro y las preguntas en src/data/teatroFaq.ts (que toma de aquí estas dos). La de
        // "¿Cuánto paga el público?" queda cubierta por las de costo y cargo absorbido de PRODUCER_FAQ.
        sections: [],
        faq: [
            {
                q: "¿Puedo tener entradas generales y precios distintos por función?",
                a: "Sí. Puedes crear tipos de entrada para una función específica (por ejemplo, el estreno) o válidos para cualquier función.",
            },
            {
                q: "¿Funciona si la obra es en una sala que no tiene ticketera propia?",
                a: "Sí. AI Tickets te da la boletería online de tu obra, el cobro y el control de acceso con QR desde el celular, en Santiago, Valparaíso, Concepción o cualquier ciudad de Chile; no necesitas equipos especiales.",
            },
        ],
        demo: { url: "/eventos/evento-demo-teatro", label: "Ver una obra de ejemplo" },
        cta: { label: "Publicar mi obra", campaign: "vertical_teatro" },
        related: ["entradas-con-qr", "academias", "guias/como-hacer-una-preventa"],
        dedicated: true,
    },
    {
        slug: "ticketera-musica-en-vivo",
        kind: "vertical",
        card: { title: "Música en vivo", text: "Preventas, tipos de entrada con cupo y difusión medida por canal." },
        title: "Ticketera para conciertos y tocatas en Chile · 0% de comisión | AI Tickets",
        description:
            "Vende entradas para tus conciertos, tocatas y giras: preventa por tandas con cupo, un link por banda del cartel, check-in con QR aunque no haya señal y cobro por fecha. 0% de comisión para bandas, productoras y salas.",
        eyebrow: "Para bandas, solistas, productoras y salas",
        h1: "Tú pon la música. La boletería corre por nuestra cuenta.",
        intro:
            "En música la venta se juega en las primeras horas de la preventa y en la última semana. AI Tickets te ayuda a armar las tandas, ver qué banda o canal vende y llegar a la puerta con todo ordenado.",
        highlights: ["Preventa por tandas con cupo", "Un link para cada banda, medio o campaña", "Check-in con QR aunque no haya señal"],
        // La página es propia (src/pages/ticketera-musica-en-vivo.astro, SPEC_landing_musica): las secciones viven en
        // src/components/landing/musica y las preguntas en src/data/musicaFaq.ts (que toma de aquí la de zonas). Las de
        // cobro por fecha y costo que tenía la landing genérica quedan cubiertas por las de PRODUCER_FAQ.
        sections: [],
        faq: [
            {
                q: "¿Puedo vender entradas de distintas zonas o precios?",
                a: "Sí, con tipos de entrada distintos, cada uno con su precio y su cupo. AI Tickets no tiene mapa de asientos numerados.",
            },
        ],
        demo: { url: "/eventos/evento-demo-concierto", label: "Ver un concierto de ejemplo" },
        cta: { label: "Publicar mi próximo concierto", campaign: "vertical_musica" },
        related: ["ventas-por-promotor", "academias", "guias/como-hacer-una-preventa"],
        dedicated: true,
    },
    {
        // Ruta "discotecas" y no "clubs": en Chile se busca más "ticketera para discotecas" / "lista free discoteca"
        // (SPEC_landing_clubs, Preguntas abiertas 1). /ticketera-clubs y /ticketera-clubes redirigen aquí con 301
        // (astro.config.mjs); el sitemap lista solo esta URL.
        slug: "ticketera-discotecas",
        kind: "vertical",
        card: { title: "Clubs y discotecas", text: "Lista free por RRPP, cover y mesas pagadas antes de llegar, y la puerta con QR." },
        title: "Ticketera para discotecas y clubs en Chile: lista free, cover y mesas · 0% de comisión | AI Tickets",
        description:
            "Vende entradas para tu discoteca o club: lista free con QR para cada RRPP, cover y mesas VIP con pago online, check-in en la puerta aunque no haya señal y cobro por noche. 0% de comisión para el club.",
        eyebrow: "Para clubs, discotecas y productoras de noche",
        h1: "Abre la puerta. Nosotros llevamos la lista.",
        intro: `Lista free con QR para cada RRPP, cover y mesas pagados antes de llegar y check-in en la puerta aunque no haya señal. Lo de cada noche queda disponible ${PAYOUT_RELEASE_HOURS} h después de que termina. 0% de comisión para el club.`,
        highlights: ["Lista free con QR para cada RRPP", "Cover y mesas pagados antes de llegar", "Check-in en la puerta aunque no haya señal"],
        // La página es propia (src/pages/ticketera-discotecas.astro, SPEC_landing_clubs): las secciones viven en
        // src/components/landing/clubs y las preguntas en src/data/clubsFaq.ts, que toma de aquí estas seis (las propias
        // de clubs; las de dinero, plazos, redes y anuncios vienen de PRODUCER_FAQ y ORGANIZADORES_FAQ). Verificado:
        //   lista con hora de cierre → ventana de venta por entrada (isTicketOnSale), hoy desde tools/tickets.ts
        //   mesas → un QR por unidad (buildAttendeeRows); cortesías → CourtesyTicketsForm.vue
        //   transferir una entrada → transfer_ticket (tools/postsale.ts); lista de invitados → tools/guests.ts
        //   sin preguntas en el checkout (edad, RUT) ni venta en la puerta (POS)
        sections: [],
        faq: [
            {
                q: "¿Cómo armo la lista free?",
                a: "Creas un tipo de entrada de $0 llamado, por ejemplo, \"Lista free\", con su cupo. Cada persona se inscribe con su nombre y correo y le llega su QR. Si quieres que la inscripción se cierre a una hora, hoy se programa desde tu asistente de IA conectado o escribiéndonos por WhatsApp. En la puerta, tu equipo ve que es una entrada de lista al escanearla.",
            },
            {
                q: "¿Cómo vendo mesas?",
                a: "Cada mesa es un tipo de entrada con su precio, su cupo y la descripción de lo que incluye. Quien la compra recibe un QR para la mesa. Si quieres que cada invitado tenga su propia entrada, envíaselas como cortesías. No hay plano para elegir mesa.",
            },
            {
                q: "¿Puedo pedir que sean mayores de 18?",
                a: "Hoy AI Tickets no verifica la edad al comprar. Indícalo en la descripción del evento y en el nombre de la entrada (\"+18\"): el asistente de la página lo responde a quien pregunte, y tu equipo revisa el carnet en la puerta.",
            },
            {
                q: "¿Qué pasa si alguien comparte el pantallazo de su QR?",
                a: "Cada QR entra una sola vez. Si el pantallazo ya se usó, el escáner lo marca como validado y no pasa. Si una persona no puede ir, tu equipo le transfiere la entrada a otra persona desde tu asistente de IA: el QR anterior deja de servir.",
            },
            {
                q: "¿Puedo tener lista de invitados y cortesías?",
                a: "Sí. Las cortesías se envían desde el panel por correo, cada una con su QR, y no cuentan como venta. La lista de invitados del club, con acompañantes, la manejas desde tu asistente de IA: les manda el link por correo o te deja los WhatsApp listos para enviar.",
            },
            {
                q: "¿Se puede pagar el cover en la puerta?",
                a: "AI Tickets vende online: tu público compra desde el celular en la página de la noche, mientras haya cupo y la venta esté abierta. No hay cobro en efectivo ni con máquina en la puerta.",
            },
        ],
        // No hay un evento de ejemplo de club en demoEvent.mjs (Preguntas abiertas 3): mientras tanto, el concierto
        demo: { url: "/eventos/evento-demo-concierto", label: "Ver un evento de ejemplo" },
        cta: { label: "Publicar mi próxima noche", campaign: "vertical_clubs" },
        related: ["ventas-por-promotor", "entradas-con-qr", "ticketera-musica-en-vivo", "ticketera-fiestas"],
        dedicated: true,
    },
    {
        slug: "ticketera-fiestas",
        kind: "vertical",
        card: { title: "Fiestas", text: "Preventa por etapas, un código para cada promotor y la puerta con QR aunque no haya señal." },
        title: "Ticketera para fiestas en Chile: preventa por etapas y códigos para promotores · 0% de comisión | AI Tickets",
        description:
            "Vende entradas para tu fiesta: preventa por etapas con fecha de apertura, un código y un link para cada promotor, tu flyer en Instagram toda la semana y check-in con QR aunque no haya señal. 0% de comisión para la productora.",
        eyebrow: "Para productoras de fiestas y centros de estudiantes",
        h1: "Preventa 1: agotada. ¿Abrimos la 2?",
        intro: `Vende tu fiesta por etapas, con un código para cada promotor, tu flyer en Instagram toda la semana y la puerta con QR aunque el galpón no tenga señal. Lo de tu fiesta queda disponible ${PAYOUT_RELEASE_HOURS} h después de que termina. 0% de comisión para la productora.`,
        highlights: ["Preventa por etapas con fecha de apertura", "Un código y un link para cada promotor", "Check-in con QR aunque no haya señal"],
        // La página es propia (src/pages/ticketera-fiestas.astro, SPEC_landing_fiestas): las secciones viven en
        // src/components/landing/fiestas y las preguntas en src/data/fiestasFaq.ts, que toma de aquí estas siete (las
        // propias de fiestas; las de dinero, plazos, redes y anuncios vienen de PRODUCER_FAQ y ORGANIZADORES_FAQ).
        // Verificado:
        //   etapas → un tipo de entrada con ventana de venta (isTicketOnSale), hoy programada desde tools/tickets.ts;
        //            la siguiente se abre sola al agotarse la anterior (opens_after_ticket_id, netlify/lib/tickets.mjs)
        //   "Ver QR" por entrada → src/pages/ticket/[id].astro; máximo por compra → DEFAULT_MAX_PER_PURCHASE
        //   dirección exacta → mensaje programado (send_attendee_message / schedule_reminder en tools/messaging.ts);
        //                      un lugar sin dirección exacta suma riesgo (event-risk.mjs) y puede dejar una reserva
        //   transferir una entrada → transfer_ticket (tools/postsale.ts)
        //   sin preguntas en el checkout (edad, RUT, ser alumno) ni venta en la puerta (POS)
        sections: [],
        faq: [
            {
                q: "¿Cómo armo una preventa por etapas?",
                a: "Cada etapa es un tipo de entrada con su precio, su cupo y su fecha y hora de apertura y cierre. Hoy las fechas se programan desde tu asistente de IA conectado o escribiéndonos por WhatsApp. Mientras una etapa está a la venta, tu público ve las siguientes con su fecha de apertura. Si quieres que la siguiente se abra sola cuando se agota la anterior, la encadenas al crear o editar el evento (\"Se abre al agotarse…\").",
            },
            {
                q: "¿Puedo tener entrada alumno y entrada general?",
                a: "Sí: son dos tipos de entrada, cada uno con su precio y su cupo. AI Tickets no verifica al comprar que la persona sea alumna: en la puerta tu equipo ve el tipo de entrada al escanearla y pide la credencial.",
            },
            {
                q: "¿Puedo pedir que sean mayores de 18?",
                a: "Hoy AI Tickets no verifica la edad al comprar. Indícalo en la descripción de la fiesta y en el nombre de la entrada (\"+18\"): el asistente de la página lo responde a quien pregunte, y tu equipo revisa el carnet en la puerta.",
            },
            {
                q: "¿Puedo avisar la dirección a última hora?",
                a: "Sí. Publica la comuna o un punto de referencia y, el mismo día, programa un correo a todos los que compraron con la dirección exacta desde tu asistente de IA. Ten en cuenta que un evento sin dirección exacta puede quedar con una parte de lo vendido en reserva (ver términos).",
                terms: true,
            },
            {
                q: "¿Qué pasa si alguien comparte el pantallazo de su QR?",
                a: "Cada QR entra una sola vez: si el pantallazo ya se usó, el escáner lo marca como validado y no pasa. Si la señal se cae, cada celular sigue validando y rechaza lo que él ya escaneó, y todo se cruza al volver la conexión. Si una persona no puede ir, tu equipo le transfiere la entrada a otra persona desde tu asistente de IA y el QR anterior deja de servir.",
            },
            {
                q: "¿Cómo le paso su entrada a cada amigo?",
                a: `Quien compra recibe un correo con cada entrada y su link "Ver QR": le manda a cada amigo la suya. Si no lo cambias, son hasta ${DEFAULT_MAX_PER_PURCHASE} entradas por compra.`,
            },
            {
                q: "¿Se puede vender en la puerta?",
                a: "AI Tickets vende online: tu público compra desde el celular en la página de la fiesta, mientras haya cupo y la venta esté abierta. No hay cobro en efectivo ni con máquina en la puerta.",
            },
        ],
        // No hay un evento de ejemplo de fiesta en demoEvent.mjs (Preguntas abiertas 10): mientras tanto, el concierto
        demo: { url: "/eventos/evento-demo-concierto", label: "Ver un evento de ejemplo" },
        cta: { label: "Publicar mi fiesta", campaign: "vertical_fiestas" },
        related: ["ventas-por-promotor", "ticketera-discotecas", "entradas-con-qr"],
        dedicated: true,
    },
    {
        slug: "ticketera-seminarios",
        kind: "vertical",
        card: { title: "Seminarios y congresos", text: "Varios días en un evento, precios para empresas y estudiantes, y acreditación con QR." },
        title: "Ticketera para seminarios y congresos en Chile: inscripciones y acreditación con QR · 0% de comisión | AI Tickets",
        description:
            "Inscripciones gratis o pagadas con Webpay para seminarios, charlas y congresos: varios días en un evento con pase completo o por día, precio estudiante y de convenio, cortesías para expositores y acreditación con QR desde el celular. 0% de comisión.",
        eyebrow: "Para organizadores de seminarios, congresos y charlas",
        h1: "Tú armas el programa. La acreditación es un QR.",
        intro: `Inscripciones gratis o pagadas con Webpay, un congreso de varios días en un solo evento, precios para estudiantes y convenios, y la acreditación con el celular aunque se caiga el wifi del hotel. Lo de cada día queda disponible ${PAYOUT_RELEASE_HOURS} h después de que termina; el pase completo, ${PAYOUT_RELEASE_HOURS} h después del último día. 0% de comisión para ti.`,
        highlights: ["Varios días en un evento, con pase completo o por día", "Precio estudiante y códigos de convenio", "Acreditación con QR aunque se caiga el wifi"],
        // La página es propia (src/pages/ticketera-seminarios.astro, SPEC_landing_seminarios): las secciones viven en
        // src/components/landing/seminarios y las preguntas en src/data/seminariosFaq.ts, que toma de aquí estas diez (las
        // propias de seminarios; las de dinero, plazos, cortesías, compras de empresa y eventos grandes se arman allá con
        // sus constantes, y las de redes y reseñas vienen de PRODUCER_FAQ y ORGANIZADORES_FAQ).
        // Verificado:
        //   varios días → hasta MAX_EVENT_FUNCTIONS funciones (schedule.ts); cada entrada para una función o para todas
        //                 (event_date_id NULL); el pase completo se valida una vez (confirm-ticket): ingreso diario "Pronto"
        //   programa → descripción con títulos y listas (sanitize.ts) y el asistente de la página (EventAssistant.vue);
        //              agenda con expositores y salas "Pronto"
        //   documentos → terms.astro §3 (boleta del cargo; el precio de la entrada lo documenta el productor), pendiente de
        //                validar con abogado y contador; RUT y razón social al comprar "Pronto"
        //   convenios → códigos de descuento por evento o de la organización (discounts.mjs); sin entradas ocultas
        //   certificados de asistencia → "Pronto"; hoy, la lista de quienes ingresaron (list_attendees)
        //   sin transmisión online ni pago con orden de compra o transferencia
        sections: [],
        faq: [
            { q: "¿Cuánto cuesta una charla gratuita?", a: "Nada. Las inscripciones gratis no pagan cargo por servicio y no hay mensualidad." },
            {
                q: "¿Cómo publico un congreso de varios días?",
                a: `Un solo evento con un día por función (hasta ${MAX_EVENT_FUNCTIONS}), y entradas que sirven para un día o para todos (pase completo). Tu público ve las fechas en la página y elige. El pase completo entra una vez cada día con el mismo QR.`,
            },
            {
                q: "¿Dónde va el programa con los expositores?",
                a: "En la descripción del evento, con un título por día y una lista por bloque. El asistente de tu página lo usa para responder preguntas como \"¿a qué hora es el panel?\". Una sección propia de agenda, con expositores y salas, todavía no existe.",
            },
            {
                q: "¿Pueden pedirme factura?",
                a: "El cargo por servicio lo documenta AI Tickets con boleta electrónica. El valor de la entrada lo documentas tú, como organizador: si una empresa necesita factura, se la emites con los datos de su compra. Desde tu panel exportas las órdenes a CSV con comprador, correo, entradas, montos y medio de pago.",
                terms: true,
            },
            {
                q: "¿Puedo tener precio de socio o de convenio?",
                a: "Sí, con un código de descuento por institución: porcentaje o monto, usos máximos, límite por persona y fecha de término. Puede servir para un evento o para todos los tuyos, y se aplica al total de la compra.",
            },
            {
                q: "¿Cómo funciona la entrada estudiante?",
                a: "Es un tipo de entrada con su precio y su cupo. AI Tickets no verifica al comprar que la persona sea estudiante: en la acreditación tu equipo ve el tipo de entrada al escanearla y pide la credencial.",
            },
            {
                q: "¿Qué pasa si se cae el wifi del lugar?",
                a: "Antes de abrir, el escáner descarga la lista de entradas. Si se cae la conexión, cada celular sigue acreditando y rechaza lo que él ya escaneó; al volver, se sincroniza con los demás. Si alguien no trae su QR, se busca por nombre o correo y se acredita a mano o se le reenvía la entrada.",
            },
            {
                q: "¿Entregan certificado de asistencia?",
                a: "Todavía no: está en camino. Hoy tu asistente de IA te da la lista de quienes ingresaron, con su hora, para que emitas los certificados.",
            },
            {
                q: "¿Puedo hacer un evento solo para mi empresa o mis socios?",
                a: "Sí. Un evento privado no aparece en la cartelera de AI Tickets ni en buscadores: solo entra quien tiene el link. Antes de publicarlo, puedes compartir una vista previa privada con tu comité o tus auspiciadores.",
            },
            {
                q: "¿Sirve para una charla online o híbrida?",
                a: "AI Tickets inscribe y acredita eventos presenciales; no transmite. Si tu charla tiene transmisión, mandas el link a tus inscritos por correo desde tu asistente de IA.",
            },
        ],
        // No hay un seminario de ejemplo en demoEvent.mjs (Preguntas abiertas 12): mientras tanto, la inscripción gratuita
        demo: { url: "/eventos/evento-demo-gratis", label: "Ver una inscripción de ejemplo" },
        cta: { label: "Publicar mi seminario", campaign: "vertical_seminarios" },
        related: ["entradas-con-qr", "ticketera-talleres", "vender-entradas-online"],
        dedicated: true,
    },
    {
        slug: "ticketera-talleres",
        kind: "vertical",
        // Sin "charlas": quedan para /ticketera-seminarios (SPEC_landing_talleres, Preguntas abiertas 8)
        card: { title: "Talleres y cursos", text: "Cupos por fecha, inscripciones gratis o pagadas y recordatorio el día antes." },
        title: "Inscripciones para talleres en Chile: cupos, Webpay y QR · 0% de comisión | AI Tickets",
        description:
            "Abre inscripciones para tus talleres y cursos cortos: cupos por fecha, gratis o con pago por Webpay, entrada con QR, recordatorio el día antes y lista de asistentes en el celular. 0% de comisión.",
        eyebrow: "Para talleristas y espacios que dictan talleres",
        h1: "Abre inscripciones con un link. El día del taller, solo enseña.",
        intro:
            "Cupos por fecha que se cierran solos, inscripción gratis o pagada con Webpay, la entrada con QR al correo de cada persona y un recordatorio el día antes. Sin DM preguntando si queda cupo, sin pantallazos de transferencias, sin planillas. 0% de comisión para ti.",
        // "Recordatorio por correo el día antes" y no "antes de cada sesión": a quien tiene una entrada para todas las
        // funciones (un curso) el recordatorio automático le llega solo antes de la primera fecha (send-event-reminders).
        highlights: ["Gratis si tu taller es gratis", "Cupos por fecha", "Recordatorio por correo el día antes"],
        // La página es propia (src/pages/ticketera-talleres.astro, SPEC_landing_talleres): las secciones viven en
        // src/components/landing/talleres y las preguntas en src/data/talleresFaq.ts (que toma de aquí estas tres).
        sections: [],
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
        // No hay un taller de ejemplo en demoEvent.mjs (Preguntas abiertas 9): mientras tanto, la inscripción gratuita
        demo: { url: "/eventos/evento-demo-gratis", label: "Ver una inscripción gratuita de ejemplo" },
        cta: { label: "Abrir inscripciones", campaign: "vertical_talleres" },
        related: ["academias", "entradas-con-qr", "guias/como-vender-entradas-online", "ticketera-seminarios"],
        dedicated: true,
    },
    {
        slug: "academias",
        kind: "vertical",
        card: { title: "Academias", text: "Muestras y recitales de fin de año, gratis o con entrada, con el QR en el celular de cada familia." },
        title: "Entradas para muestras y recitales de academias · Gratis o con venta | AI Tickets",
        description:
            "Venta y reserva de entradas para la muestra de fin de año de tu academia de música, danza o teatro: un link para los apoderados, entrada con QR al celular y control de acceso desde el celular. Gratis si la muestra es gratis.",
        eyebrow: "Para academias de música, danza y teatro",
        h1: "El día de la muestra, preocúpate solo del escenario",
        intro:
            "Las familias compran o reservan con un link, reciben su entrada en el celular y entran con QR. Sin planillas, sin transferencias que revisar, sin entradas impresas y sin caja en la puerta.",
        highlights: [
            "Gratis si tu muestra es gratis",
            "Un link por curso para saber cuántas entradas compró cada uno",
            `0% de comisión para la academia; la familia paga ${fee}`,
        ],
        // La página es propia (src/pages/academias.astro): las secciones viven en src/components/landing/academias
        sections: [],
        faq: [
            {
                q: "¿Cuánto cuesta?",
                a: `Si tu muestra es gratis, nada. Si cobras entrada, la academia no paga comisión: la familia paga un cargo por servicio de ${SERVICE_FEE_PERCENT_LABEL} más IVA (${IVA_PERCENT_LABEL}) sobre ese cargo, o lo absorbe la academia para mostrar un precio redondo. ${ABSORB_FEE_ACTIVATION}`,
            },
            {
                q: "¿Las familias tienen que descargar una app?",
                a: "No. Compran o reservan desde el navegador del celular y reciben su entrada con QR por correo.",
            },
            {
                q: "¿Puedo tener dos funciones, en la mañana y en la tarde?",
                a: "Sí. Cada función tiene su propio cupo y cada familia elige la suya al comprar.",
            },
            {
                q: "¿Puedo limitar cuántas entradas compra cada familia?",
                a: `Sí. Cada tipo de entrada tiene un máximo por compra (${DEFAULT_MAX_PER_PURCHASE} si no lo cambias), para que alcance para todos. Hoy se ajusta desde tu asistente de IA conectado o escribiéndonos por WhatsApp.`,
            },
            {
                q: "¿Cómo sé cuántas entradas compró cada curso?",
                a: "Creas un link con seguimiento por curso y lo compartes en el grupo de cada uno. En las métricas del evento ves las órdenes, entradas e ingresos que trajo cada link.",
            },
            {
                q: "¿Y si una familia pierde su entrada?",
                a: "Se la reenvías a su correo desde el panel. En la puerta también se puede buscar por nombre.",
            },
            { q: "¿Cuándo recibo lo recaudado?", a: producerFaq("¿Cuándo recibo el dinero de mis ventas?").a, terms: true },
            {
                q: "¿Me ayudan con la primera muestra?",
                a: "Sí. Escríbenos por WhatsApp o agenda una videollamada de 15 minutos y la dejamos lista contigo.",
            },
        ],
        // Hasta que haya una muestra real enlazada (SPEC_landing_academias Fase 3): la inscripción gratuita de ejemplo
        demo: { url: "/eventos/evento-demo-gratis", label: "Ver un evento de ejemplo" },
        cta: { label: "Crear mi muestra gratis", campaign: "vertical_academias" },
        related: ["ticketera-teatro", "ticketera-talleres", "entradas-con-qr"],
        dedicated: true,
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
