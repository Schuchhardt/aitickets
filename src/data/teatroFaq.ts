// Preguntas frecuentes de /ticketera-teatro (SPEC_landing_teatro §4.10), en el orden de la spec: las de dinero y plazos
// tal cual de PRODUCER_FAQ (fees.mjs, legal.mjs); difusión, video de portada y reseñas de ORGANIZADORES_FAQ; las dos que
// ya tenía la página (src/data/landings.ts) y las propias de teatro. Tres se reformulan para teatro (teaser, reseñas,
// primera obra): la respuesta es la de origen. Todo verificado en el código:
//   aforo por función → event_tickets.event_date_id (EditEventForm.vue paso 3); "Últimas" / agotada → eventView.js
//   butacas numeradas → no existen (tipos de entrada con cupo; no va como "Pronto", §0.6)
//   cortesías → CourtesyTicketsForm.vue y src/lib/courtesy.ts (no cuentan como venta); lista de invitados →
//               tools/guests.ts (hoy solo desde el asistente de IA)
//   otra función en la puerta → ValidateQR.vue (function_mismatch, "Validar de todas formas")
//   máximo por compra → DEFAULT_MAX_PER_PURCHASE (Reservation/pricing.js); subirlo → tools/tickets.ts (max_per_order)
//   reseñas en la página → EventDetail.vue (showReviews: al terminar o, con review_settings.show_while_on_sale, en cartelera)
//   invitar a la próxima obra → invitations.ts y filterInviteRecipients de reviews.mjs (INVITE_AUDIENCES, bajas y
//               quienes ya tienen entrada quedan fuera)
//   CSV de órdenes → /api/events/orders-csv (fecha, entradas, montos, cortesía, ref/UTM)
import { PRODUCER_FAQ, type FaqItem } from "./producerFaq";
import { ORGANIZADORES_FAQ } from "./organizadoresFaq";
import { getLanding } from "./landings";
import { DEFAULT_MAX_PER_PURCHASE } from "../components/Reservation/pricing.js";
import { INVITE_AUDIENCE_TEXT } from "./inviteAudience";

const pick = (list: FaqItem[], q: string): FaqItem => {
    const item = list.find((f) => f.q === q);
    if (!item) throw new Error(`Falta la pregunta "${q}"`);
    return item;
};
/** La misma respuesta de `from` con otra pregunta (y, si hace falta, una frase más al final). */
const reword = (from: FaqItem, q: string, extra = ""): FaqItem => ({ ...from, q, a: extra ? `${from.a} ${extra}` : from.a });

/**
 * A quiénes puedes invitar a la próxima obra (src/data/inviteAudience.ts, compartida con talleres). La usan esta FAQ y el
 * paso "Bajó el telón" de la temporada (TheatreSeason.astro).
 */
export { INVITE_AUDIENCE_TEXT };

const theatreLanding = getLanding("ticketera-teatro");
if (!theatreLanding) throw new Error("Falta la landing ticketera-teatro en src/data/landings.ts");

export const TEATRO_FAQ: FaqItem[] = [
    pick(PRODUCER_FAQ, "¿Cuánto cuesta usar AI Tickets?"),
    pick(PRODUCER_FAQ, "¿Cuándo recibo el dinero de mis ventas?"),
    pick(PRODUCER_FAQ, "¿Puedo absorber el cargo por servicio?"),
    pick(PRODUCER_FAQ, "¿Puedo publicar varias funciones de una misma obra o show?"),
    {
        q: "¿Cada función puede tener su propio aforo?",
        a: "Sí. Creas un tipo de entrada amarrado a cada función, con su cupo. Una entrada \"para todas las funciones\" comparte el cupo entre todas las fechas. Cuando a una función le quedan pocas entradas, la página la muestra como \"Últimas\"; cuando se agota, tu público elige otra.",
    },
    pick(theatreLanding.faq, "¿Puedo tener entradas generales y precios distintos por función?"),
    {
        q: "¿Tienen butacas numeradas?",
        a: "No. AI Tickets no tiene mapa de asientos numerados: las entradas son por función y por tipo. Si separas zonas, como platea y galería, cada una es un tipo de entrada con su propio cupo.",
    },
    {
        q: "¿Cómo mando las cortesías de prensa?",
        a: "Desde el panel de la obra: nombre, correo y cuántas entradas. Si eliges la entrada de una función, la cortesía es para esa noche. Llega por correo con su QR, no cuenta como venta y se valida igual en la puerta. Para una lista de invitados con acompañantes, hoy se arma desde tu asistente de IA conectado.",
    },
    {
        q: "¿Qué pasa si alguien llega a otra función con su entrada?",
        a: "El escáner avisa que la entrada es para otra función y muestra cuál. Tu equipo decide si la valida igual.",
    },
    {
        q: "¿Puedo vender funciones para colegios o grupos?",
        a: `Sí. Creas la función (o un tipo de entrada solo para ese grupo) con su cupo. Cada compra tiene un máximo de ${DEFAULT_MAX_PER_PURCHASE} entradas si no lo cambias; para un curso completo lo subimos desde tu asistente de IA o por WhatsApp.`,
    },
    pick(theatreLanding.faq, "¿Funciona si la obra es en una sala que no tiene ticketera propia?"),
    pick(ORGANIZADORES_FAQ, "¿Cómo funciona la publicación automática en redes?"),
    reword(pick(ORGANIZADORES_FAQ, "¿Puedo poner un video como portada del evento?"), "¿Puedo poner el teaser de la obra como portada?"),
    reword(
        pick(ORGANIZADORES_FAQ, "¿Cómo funcionan las reseñas?"),
        "¿Cómo funcionan las reseñas?",
        "Si lo activas, la página de la obra muestra las reseñas mientras sigue en cartelera, junto al botón de compra.",
    ),
    {
        q: "¿Puedo invitar a mi público a la próxima obra?",
        a: `Sí. Cuando termina la obra, desde el panel les mandas un correo a ${INVITE_AUDIENCE_TEXT}. No llega a quienes se dieron de baja ni a quienes ya tienen entrada.`,
    },
    {
        q: "¿Puedo descargar las ventas para rendir cuentas?",
        a: "Sí. Descargas las órdenes de cada obra en CSV, con fecha, entradas, montos, cortesías y el canal de cada compra, para la sala, tu contador o un fondo.",
    },
    pick(PRODUCER_FAQ, "¿Qué pasa si tengo que cambiar o cancelar una función?"),
    reword(pick(PRODUCER_FAQ, "¿Me ayudan a publicar mi primer evento?"), "¿Me ayudan a publicar mi primera obra?"),
];
