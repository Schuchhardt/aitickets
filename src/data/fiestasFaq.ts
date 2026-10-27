// Preguntas frecuentes de /ticketera-fiestas (SPEC_landing_fiestas §4.11), en el orden de la spec: las de dinero y
// plazos tal cual de PRODUCER_FAQ (fees.mjs, legal.mjs); redes, anuncios y video de portada de ORGANIZADORES_FAQ; las
// propias de fiestas de src/data/landings.ts. Una de PRODUCER_FAQ se reformula para promotores: la pregunta vive aquí y
// la respuesta es la de PRODUCER_FAQ con una frase más.
// "¿Cuándo recibo lo de mi fiesta?" arma su respuesta con PAYOUT_SCHEDULE_TEXT, una frase sobre el cruce de medianoche y
// los check-ins (ledger.ts: functionEnd y CHECKIN_RELEASE_THRESHOLD) y la última frase de la respuesta de PRODUCER_FAQ
// (la cuenta bancaria), sin reescribirla. "¿Sirve para una fiesta grande o masiva?" usa LARGE_CAPACITY y
// RESERVE_BY_LEVEL (event-risk.mjs) y RESERVE_HOLD_DAYS (ledger.ts), con el mismo texto que la de música. "¿Qué es
// Quiénes van?" es la versión precisa del muro (lo ven quienes tienen entrada, en su orden o su entrada; Preguntas
// abiertas 14), con FEED_MESSAGE_MAX de attendee-community.mjs.
import { PRODUCER_FAQ, type FaqItem } from "./producerFaq";
import { ORGANIZADORES_FAQ } from "./organizadoresFaq";
import { getLanding } from "./landings";
import { PAYOUT_SCHEDULE_TEXT } from "../../netlify/lib/legal.mjs";
import { LARGE_CAPACITY, RESERVE_BY_LEVEL } from "../../netlify/lib/event-risk.mjs";
import { FEED_MESSAGE_MAX } from "../../netlify/lib/attendee-community.mjs";
import { RESERVE_HOLD_DAYS } from "../lib/producer-api/ledger";

const pick = (list: FaqItem[], q: string): FaqItem => {
    const item = list.find((f) => f.q === q);
    if (!item) throw new Error(`Falta la pregunta "${q}"`);
    return item;
};
/** La misma respuesta de `from` con otra pregunta (y, si hace falta, una frase más al final). */
const reword = (from: FaqItem, q: string, extra = ""): FaqItem => ({ ...from, q, a: extra ? `${from.a} ${extra}` : from.a });

const partyLanding = getLanding("ticketera-fiestas");
if (!partyLanding) throw new Error("Falta la landing ticketera-fiestas en src/data/landings.ts");

const payout = pick(PRODUCER_FAQ, "¿Cuándo recibo el dinero de mis ventas?");
if (!payout.a.startsWith(PAYOUT_SCHEDULE_TEXT)) throw new Error("La respuesta de pago de PRODUCER_FAQ ya no empieza con PAYOUT_SCHEDULE_TEXT");
/** "Para retirar necesitas registrar una cuenta bancaria…" (lo que sigue a PAYOUT_SCHEDULE_TEXT en PRODUCER_FAQ) */
const payoutBank = payout.a.slice(PAYOUT_SCHEDULE_TEXT.length).trim();
// El muro existe en ORGANIZADORES_FAQ con otra pregunta: si desaparece de allá, esta también hay que revisarla
pick(ORGANIZADORES_FAQ, "¿Qué es el muro de asistentes?");

export const FIESTAS_FAQ: FaqItem[] = [
    pick(PRODUCER_FAQ, "¿Cuánto cuesta usar AI Tickets?"),
    {
        q: "¿Cuándo recibo lo de mi fiesta?",
        a: `${PAYOUT_SCHEDULE_TEXT} Si la fiesta termina pasada la medianoche, se cuenta desde la hora de término. Escanea las entradas en la puerta: los check-ins acreditan que la fiesta se realizó, una de las condiciones para liberar el pago. ${payoutBank}`,
        terms: true,
    },
    pick(PRODUCER_FAQ, "¿Puedo absorber el cargo por servicio?"),
    pick(partyLanding.faq, "¿Cómo armo una preventa por etapas?"),
    reword(
        pick(PRODUCER_FAQ, "¿Puedo saber cuántas entradas vende cada promotor?"),
        "¿Puedo saber cuánto vende cada promotor?",
        "Si además le das un código de descuento, en tu panel ves cuántas veces se usó, cuánto vendió y cuánto descontó. Puedes exportar las órdenes a CSV con su código y su canal.",
    ),
    pick(partyLanding.faq, "¿Puedo tener entrada alumno y entrada general?"),
    pick(partyLanding.faq, "¿Puedo pedir que sean mayores de 18?"),
    pick(partyLanding.faq, "¿Puedo avisar la dirección a última hora?"),
    pick(partyLanding.faq, "¿Qué pasa si alguien comparte el pantallazo de su QR?"),
    pick(partyLanding.faq, "¿Cómo le paso su entrada a cada amigo?"),
    {
        q: "¿Sirve para una fiesta grande o masiva?",
        a: `Sí. Si el aforo pasa de ${LARGE_CAPACITY.toLocaleString("es-CL")} personas o es un evento masivo, te pedimos el permiso del lugar y una póliza de responsabilidad civil (y, si es masivo, la autorización de la Delegación Presidencial). Según el riesgo del evento, entre el ${RESERVE_BY_LEVEL.medium}% y el ${RESERVE_BY_LEVEL.high}% de lo vendido puede quedar como reserva hasta ${RESERVE_HOLD_DAYS} días después de la fiesta.`,
        terms: true,
    },
    pick(partyLanding.faq, "¿Se puede vender en la puerta?"),
    pick(ORGANIZADORES_FAQ, "¿Cómo funciona la publicación automática en redes?"),
    pick(ORGANIZADORES_FAQ, "¿Tengo que pagar anuncios?"),
    pick(ORGANIZADORES_FAQ, "¿Puedo poner un video como portada del evento?"),
    {
        q: "¿Qué es \"Quiénes van\"?",
        a: `Un espacio que ven quienes tienen entrada, desde la página de su compra o de su entrada: reaccionan con un emoji y dejan un mensaje corto (hasta ${FEED_MESSAGE_MAX} caracteres) que ven los demás asistentes. Tú lo moderas desde el panel. Después de la fiesta queda como recuerdo, con el título "Así lo vivieron".`,
    },
    pick(PRODUCER_FAQ, "¿Qué pasa si tengo que cambiar o cancelar una función?"),
    pick(PRODUCER_FAQ, "¿Me ayudan a publicar mi primer evento?"),
];
