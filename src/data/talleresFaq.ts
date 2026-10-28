// Preguntas frecuentes de /ticketera-talleres (SPEC_landing_talleres §4.11), en el orden de la spec: las de dinero y
// plazos tal cual de PRODUCER_FAQ (fees.mjs, legal.mjs); difusión y reseñas de ORGANIZADORES_FAQ; las tres que ya tenía
// la página (src/data/landings.ts) y las propias de talleres. Cuatro se reformulan para talleres (fechas, reseñas,
// suspender, primer taller): la respuesta es la de origen. Todo verificado en el código:
//   curso con una sola entrada → src/lib/producer-api/ledger.ts (event_date_id NULL: se libera con la última función)
//   cupo por fecha → event_tickets.event_date_id + total_quantity (EditEventForm.vue); "Últimas" / "Cupos llenos" →
//               eventView.js
//   lista de espera → RsvpForm.vue (modo full), NotifyForm.vue, /api/events/waitlist.ts (solo registra: nadie la ve)
//   cupo que se libera → postsale.ts anula las entradas reembolsadas (status cancelled) y eventPage.ts no las cuenta
//   máximo por compra → DEFAULT_MAX_PER_PURCHASE (Reservation/pricing.js); cambiarlo → tools/tickets.ts (max_per_order)
//   fin de venta → event_tickets.end_date (tools/tickets.ts, hoy solo desde el asistente de IA)
//   pago → solo Webpay (CheckoutSheet.vue); preguntas al inscribirse y nombre de cada asistente → events.checkout_fields
//               (CheckoutExtras.vue; respuestas una vez por compra)
//   reseñas en la página → EventDetail.vue (showReviews: al terminar o, con review_settings.show_while_on_sale, con fechas)
//   invitar al próximo taller → invitations.ts y filterInviteRecipients de reviews.mjs (INVITE_AUDIENCES)
import { PRODUCER_FAQ, type FaqItem } from "./producerFaq";
import { ORGANIZADORES_FAQ } from "./organizadoresFaq";
import { getLanding } from "./landings";
import { INVITE_AUDIENCE_TEXT } from "./inviteAudience";
import { DEFAULT_MAX_PER_PURCHASE } from "../components/Reservation/pricing.js";
import { PAYOUT_RELEASE_HOURS } from "../../netlify/lib/legal.mjs";

const pick = (list: FaqItem[], q: string): FaqItem => {
    const item = list.find((f) => f.q === q);
    if (!item) throw new Error(`Falta la pregunta "${q}"`);
    return item;
};
/** La misma respuesta de `from` con otra pregunta (y, si hace falta, una frase más al final). */
const reword = (from: FaqItem, q: string, extra = ""): FaqItem => ({ ...from, q, a: extra ? `${from.a} ${extra}` : from.a });

const workshopLanding = getLanding("ticketera-talleres");
if (!workshopLanding) throw new Error("Falta la landing ticketera-talleres en src/data/landings.ts");

export const TALLERES_FAQ: FaqItem[] = [
    pick(PRODUCER_FAQ, "¿Cuánto cuesta usar AI Tickets?"),
    pick(workshopLanding.faq, "¿Cuánto cuesta un taller gratuito?"),
    pick(PRODUCER_FAQ, "¿Cuándo recibo el dinero de mis ventas?"),
    {
        q: "¿Y si vendo un curso de varias sesiones?",
        a: `Si lo vendes con una sola entrada para todas las sesiones, lo del curso queda disponible ${PAYOUT_RELEASE_HOURS} h después de la última sesión. Si vendes cada sesión por separado, lo de cada una queda disponible ${PAYOUT_RELEASE_HOURS} h después de que termina. Por eso te recomendamos un evento por curso o por grupo.`,
        terms: true,
    },
    pick(PRODUCER_FAQ, "¿Puedo absorber el cargo por servicio?"),
    {
        q: "¿Cada fecha puede tener sus propios cupos?",
        a: "Sí. Creas un tipo de entrada amarrado a cada fecha, con su cupo; cuando se llena, la página deja de venderlo y tu gente elige otra fecha. Una entrada \"para todas las funciones\" comparte el cupo entre todas las fechas: sirve para un curso completo.",
    },
    reword(pick(PRODUCER_FAQ, "¿Puedo publicar varias funciones de una misma obra o show?"), "¿Puedo publicar todas las fechas de mi taller juntas?"),
    {
        q: "¿Qué pasa cuando se llenan los cupos?",
        a: "La página muestra que se llenó y ofrece anotarse para que le avisen. Hoy esa lista no se ve en el panel; si se libera un cupo (por ejemplo, porque alguien te pidió la devolución), la página vuelve a inscribir sola.",
    },
    pick(workshopLanding.faq, "¿Puedo pedir datos adicionales al inscribirse?"),
    {
        q: "¿Puedo limitar a una inscripción por persona?",
        a: `Sí. Cada tipo de entrada tiene un máximo por compra (${DEFAULT_MAX_PER_PURCHASE} si no lo cambias); para un taller individual lo dejamos en 1 desde tu asistente de IA conectado o por WhatsApp.`,
    },
    {
        q: "¿Puedo cerrar las inscripciones antes del taller?",
        a: "Sí. Cada tipo de entrada puede tener un fin de venta, por ejemplo el día antes para comprar los materiales. Hoy se configura desde tu asistente de IA conectado o escribiéndonos por WhatsApp.",
    },
    pick(workshopLanding.faq, "¿Puedo escribirle a los inscritos?"),
    {
        q: "¿Mis alumnos tienen que descargar una app?",
        a: "No. Se inscriben desde el navegador del celular y reciben su entrada con QR por correo.",
    },
    {
        q: "¿Pueden pagar por transferencia o en efectivo?",
        a: "No. El pago se hace en la página con Webpay, así la inscripción queda confirmada al instante y tú no tienes que revisar nada.",
    },
    {
        q: "¿Sirve para talleres de niños?",
        a: "Sí. Se inscribe el papá, la mamá o quien esté a cargo, con su correo, y recibe la entrada. Si activas el nombre de cada asistente, escribe el de cada niño o niña, y con las preguntas al inscribirse le pides lo que necesites (edad, alergias, quién lo retira).",
    },
    pick(ORGANIZADORES_FAQ, "¿Cómo funciona la publicación automática en redes?"),
    reword(
        pick(ORGANIZADORES_FAQ, "¿Cómo funcionan las reseñas?"),
        "¿Cómo funcionan las reseñas?",
        "Si lo activas, la página del taller las muestra mientras sigue con fechas, junto al botón para inscribirse.",
    ),
    {
        q: "¿Puedo invitar a quienes vinieron a mi próximo taller?",
        a: `Sí. Desde el panel les mandas un correo a ${INVITE_AUDIENCE_TEXT}. No llega a quienes se dieron de baja ni a quienes ya tienen entrada.`,
    },
    reword(pick(PRODUCER_FAQ, "¿Qué pasa si tengo que cambiar o cancelar una función?"), "¿Y si no llego al mínimo y tengo que suspender?"),
    reword(pick(PRODUCER_FAQ, "¿Me ayudan a publicar mi primer evento?"), "¿Me ayudan a publicar mi primer taller?"),
];
