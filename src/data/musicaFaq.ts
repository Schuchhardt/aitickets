// Preguntas frecuentes de /ticketera-musica-en-vivo (SPEC_landing_musica §4.11), en el orden de la spec: las de dinero
// y plazos tal cual de PRODUCER_FAQ (fees.mjs, legal.mjs); difusión, anuncios, video de portada y reseñas de
// ORGANIZADORES_FAQ; la de zonas que ya tenía la página (src/data/landings.ts) y las propias de música. Dos de
// PRODUCER_FAQ se reformulan para música (gira, bandas del cartel): la pregunta vive aquí y la respuesta es la de
// PRODUCER_FAQ. Todo verificado en el código:
//   lista de "Avísame" → api/events/waitlist.ts (solo guarda el correo: el aviso automático no existe)
//   cortesías → CourtesyTicketsForm.vue y orderKinds (no cuentan como venta)
//   aforo grande → netlify/lib/event-risk.mjs (LARGE_CAPACITY, requires_documents, RESERVE_BY_LEVEL),
//                  src/lib/eventDocuments.ts (requiredDocumentKinds) y la reserva por riesgo del ledger
//                  (RESERVE_HOLD_DAYS). Los documentos no frenan la liberación de fondos: lo que retiene es la reserva
//                  (aforo grande suma large_capacity → nivel medio o más)
//   apertura programada de una tanda → tools/tickets.ts (hoy desde el asistente de IA, no desde el formulario)
import { PRODUCER_FAQ, type FaqItem } from "./producerFaq";
import { ORGANIZADORES_FAQ } from "./organizadoresFaq";
import { getLanding } from "./landings";
import { LARGE_CAPACITY, RESERVE_BY_LEVEL } from "../../netlify/lib/event-risk.mjs";
import { RESERVE_HOLD_DAYS } from "../lib/producer-api/ledger";

const pick = (list: FaqItem[], q: string): FaqItem => {
    const item = list.find((f) => f.q === q);
    if (!item) throw new Error(`Falta la pregunta "${q}"`);
    return item;
};
/** La misma respuesta de `from` con otra pregunta (y, si hace falta, una frase más al final). */
const reword = (from: FaqItem, q: string, extra = ""): FaqItem => ({ ...from, q, a: extra ? `${from.a} ${extra}` : from.a });

const musicLanding = getLanding("ticketera-musica-en-vivo");
if (!musicLanding) throw new Error("Falta la landing ticketera-musica-en-vivo en src/data/landings.ts");

export const MUSICA_FAQ: FaqItem[] = [
    pick(PRODUCER_FAQ, "¿Cuánto cuesta usar AI Tickets?"),
    pick(PRODUCER_FAQ, "¿Cuándo recibo el dinero de mis ventas?"),
    pick(PRODUCER_FAQ, "¿Puedo absorber el cargo por servicio?"),
    pick(musicLanding.faq, "¿Puedo vender entradas de distintas zonas o precios?"),
    {
        q: "¿Cómo armo una preventa por tandas?",
        a: "Creas un tipo de entrada por tanda (Preventa 1, Preventa 2, General) con su precio y su cupo. Cuando una se agota, aparece agotada y tu público ve la siguiente. Si quieres que una tanda abra en una fecha y hora exacta, hoy se programa desde tu asistente de IA conectado o escribiéndonos por WhatsApp.",
    },
    reword(pick(PRODUCER_FAQ, "¿Puedo publicar varias funciones de una misma obra o show?"), "¿Puedo publicar una gira o varias fechas?", "Cada fecha puede tener su propio lugar."),
    reword(pick(PRODUCER_FAQ, "¿Puedo saber cuántas entradas vende cada promotor?"), "¿Puedo saber cuántas entradas vende cada banda del cartel?"),
    {
        q: "¿Puedo tener una lista de invitados?",
        a: "Sí. Envías cortesías por correo desde el panel, para prensa, bandas o amigos, cada una con su QR. No cuentan como venta y se validan igual en la puerta.",
    },
    {
        q: "¿Qué pasa cuando se agota?",
        a: "La entrada aparece agotada y tu público puede dejar su correo en la página del evento para enterarse. Cuando vuelve a haber entradas (se libera un cupo o se abre la siguiente tanda), les llega un correo automático con el link, una sola vez.",
    },
    pick(ORGANIZADORES_FAQ, "¿Cómo funciona la publicación automática en redes?"),
    pick(ORGANIZADORES_FAQ, "¿Tengo que pagar anuncios?"),
    pick(ORGANIZADORES_FAQ, "¿Puedo poner un video como portada del evento?"),
    {
        q: "¿Sirve para un concierto grande?",
        a: `Sí. Si el aforo pasa de ${LARGE_CAPACITY.toLocaleString("es-CL")} personas o es un evento masivo, te pedimos el permiso del lugar y una póliza de responsabilidad civil (y, si es masivo, la autorización de la Delegación Presidencial). Según el riesgo del evento, entre el ${RESERVE_BY_LEVEL.medium}% y el ${RESERVE_BY_LEVEL.high}% de lo vendido puede quedar como reserva hasta ${RESERVE_HOLD_DAYS} días después del show.`,
        terms: true,
    },
    pick(ORGANIZADORES_FAQ, "¿Cómo funcionan las reseñas?"),
    pick(PRODUCER_FAQ, "¿Qué pasa si tengo que cambiar o cancelar una función?"),
    pick(PRODUCER_FAQ, "¿Me ayudan a publicar mi primer evento?"),
];
