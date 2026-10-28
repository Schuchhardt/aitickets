// Preguntas frecuentes de /ticketera-seminarios (SPEC_landing_seminarios §4.11), en el orden de la spec: las de dinero y
// plazos tal cual de PRODUCER_FAQ (fees.mjs, legal.mjs); redes y reseñas de ORGANIZADORES_FAQ; las propias de seminarios
// de src/data/landings.ts. La de reseñas se reformula como encuesta: la pregunta vive aquí y la respuesta es la de
// ORGANIZADORES_FAQ con una frase más (el mensaje privado, EventReviews.vue).
// "¿Cuándo recibo lo recaudado?" arma su respuesta con PAYOUT_SCHEDULE_TEXT, el cobro por jornada (congressReleaseText,
// según ledger.ts: cada orden con el término de su función y el pase completo con la última), una frase sobre los
// check-ins (escrita aquí, sin cifra: la regla de que acreditan que el evento se realizó está en ledger.ts) y la última
// frase de la respuesta de PRODUCER_FAQ (la cuenta bancaria), sin reescribirla.
// "¿Una empresa puede comprar para todo su equipo?" usa DEFAULT_MAX_PER_PURCHASE (pricing.js) y el tope del asistente de
// IA (MAX_PER_ORDER_AI, tools/tickets.ts); las cortesías, MAX_COURTESY_PER_REQUEST (courtesy.ts, módulo de servidor: este
// archivo solo lo importa la página al construir); "¿Sirve para un congreso grande?" usa LARGE_CAPACITY y
// RESERVE_BY_LEVEL (event-risk.mjs) y RESERVE_HOLD_DAYS (ledger.ts), con el mismo texto que fiestas y música.
import { PRODUCER_FAQ, type FaqItem } from "./producerFaq";
import { ORGANIZADORES_FAQ } from "./organizadoresFaq";
import { getLanding } from "./landings";
import { PAYOUT_SCHEDULE_TEXT } from "../../netlify/lib/legal.mjs";
import { LARGE_CAPACITY, RESERVE_BY_LEVEL } from "../../netlify/lib/event-risk.mjs";
import { DEFAULT_MAX_PER_PURCHASE } from "../components/Reservation/pricing.js";
import { MAX_PER_ORDER_AI, congressReleaseText } from "../components/landing/seminarios/seminariosLanding.js";
import { MAX_COURTESY_PER_REQUEST } from "../lib/courtesy";
import { RESERVE_HOLD_DAYS } from "../lib/producer-api/ledger";

const pick = (list: FaqItem[], q: string): FaqItem => {
    const item = list.find((f) => f.q === q);
    if (!item) throw new Error(`Falta la pregunta "${q}"`);
    return item;
};
/** La misma respuesta de `from` con otra pregunta (y, si hace falta, una frase más al final). */
const reword = (from: FaqItem, q: string, extra = ""): FaqItem => ({ ...from, q, a: extra ? `${from.a} ${extra}` : from.a });

const seminarLanding = getLanding("ticketera-seminarios");
if (!seminarLanding) throw new Error("Falta la landing ticketera-seminarios en src/data/landings.ts");
const own = (q: string) => pick(seminarLanding.faq, q);

const payout = pick(PRODUCER_FAQ, "¿Cuándo recibo el dinero de mis ventas?");
if (!payout.a.startsWith(PAYOUT_SCHEDULE_TEXT)) throw new Error("La respuesta de pago de PRODUCER_FAQ ya no empieza con PAYOUT_SCHEDULE_TEXT");
/** "Para retirar necesitas registrar una cuenta bancaria…" (lo que sigue a PAYOUT_SCHEDULE_TEXT en PRODUCER_FAQ) */
const payoutBank = payout.a.slice(PAYOUT_SCHEDULE_TEXT.length).trim();

export const SEMINARIOS_FAQ: FaqItem[] = [
    pick(PRODUCER_FAQ, "¿Cuánto cuesta usar AI Tickets?"),
    own("¿Cuánto cuesta una charla gratuita?"),
    {
        q: "¿Cuándo recibo lo recaudado?",
        a: `${PAYOUT_SCHEDULE_TEXT} ${congressReleaseText} Acreditar en la puerta cuenta: los check-ins acreditan que el evento se realizó, una de las condiciones para liberar el pago. ${payoutBank}`,
        terms: true,
    },
    pick(PRODUCER_FAQ, "¿Puedo absorber el cargo por servicio?"),
    own("¿Cómo publico un congreso de varios días?"),
    own("¿Dónde va el programa con los expositores?"),
    {
        q: "¿Una empresa puede comprar para todo su equipo?",
        a: `Sí. Son hasta ${DEFAULT_MAX_PER_PURCHASE} entradas por compra si no lo cambias (se sube hasta ${MAX_PER_ORDER_AI} desde tu asistente de IA o escribiéndonos por WhatsApp). Si activas "Nombre de cada asistente" en tu evento, la empresa escribe al comprar el nombre y el correo de cada persona y a cada una le llega su QR. Si no, quien compra recibe cada entrada con su link "Ver QR" y se la reenvía; para cambiar el titular después, tu equipo lo hace desde tu asistente de IA: le llega un QR nuevo y el anterior deja de servir.`,
    },
    own("¿Pueden pedirme factura?"),
    own("¿Puedo tener precio de socio o de convenio?"),
    own("¿Cómo funciona la entrada estudiante?"),
    {
        q: "¿Cómo acredito a expositores, auspiciadores y prensa?",
        a: `Con cortesías desde tu panel: tipo de entrada, nombre y correo, hasta ${MAX_COURTESY_PER_REQUEST} por envío. Les llega su QR, se acreditan como cualquier entrada y no cuentan como venta.`,
    },
    own("¿Qué pasa si se cae el wifi del lugar?"),
    own("¿Entregan certificado de asistencia?"),
    own("¿Puedo hacer un evento solo para mi empresa o mis socios?"),
    own("¿Sirve para una charla online o híbrida?"),
    {
        q: "¿Sirve para un congreso grande?",
        a: `Sí. Si el aforo pasa de ${LARGE_CAPACITY.toLocaleString("es-CL")} personas o es un evento masivo, te pedimos el permiso del lugar y una póliza de responsabilidad civil (y, si es masivo, la autorización de la Delegación Presidencial). Según el riesgo del evento, entre el ${RESERVE_BY_LEVEL.medium}% y el ${RESERVE_BY_LEVEL.high}% de lo vendido puede quedar como reserva hasta ${RESERVE_HOLD_DAYS} días después del congreso.`,
        terms: true,
    },
    pick(ORGANIZADORES_FAQ, "¿Cómo funciona la publicación automática en redes?"),
    reword(
        pick(ORGANIZADORES_FAQ, "¿Cómo funcionan las reseñas?"),
        "¿Cómo funciona la encuesta después del evento?",
        "Además de las estrellas y el comentario, cada persona puede dejarte un mensaje privado que solo ves tú.",
    ),
    pick(PRODUCER_FAQ, "¿Qué pasa si tengo que cambiar o cancelar una función?"),
    pick(PRODUCER_FAQ, "¿Me ayudan a publicar mi primer evento?"),
];
