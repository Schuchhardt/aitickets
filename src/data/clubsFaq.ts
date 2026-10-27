// Preguntas frecuentes de /ticketera-discotecas (SPEC_landing_clubs §4.11), en el orden de la spec: las de dinero y
// plazos tal cual de PRODUCER_FAQ (fees.mjs, legal.mjs); redes, anuncios y video de portada de ORGANIZADORES_FAQ; las
// propias de clubs de src/data/landings.ts. Dos de PRODUCER_FAQ se reformulan para clubs (RRPP, noches del mes): la
// pregunta vive aquí y la respuesta es la de PRODUCER_FAQ con una frase más.
// "¿Cuándo recibo lo de cada noche?" arma su respuesta con PAYOUT_SCHEDULE_TEXT, una frase sobre el cruce de medianoche
// y los check-ins (ledger.ts: functionEnd y CHECKIN_RELEASE_THRESHOLD) y la última frase de la respuesta de
// PRODUCER_FAQ (la cuenta bancaria), sin reescribirla.
import { PRODUCER_FAQ, type FaqItem } from "./producerFaq";
import { ORGANIZADORES_FAQ } from "./organizadoresFaq";
import { getLanding } from "./landings";
import { PAYOUT_SCHEDULE_TEXT } from "../../netlify/lib/legal.mjs";

const pick = (list: FaqItem[], q: string): FaqItem => {
    const item = list.find((f) => f.q === q);
    if (!item) throw new Error(`Falta la pregunta "${q}"`);
    return item;
};
/** La misma respuesta de `from` con otra pregunta (y, si hace falta, una frase más al final). */
const reword = (from: FaqItem, q: string, extra = ""): FaqItem => ({ ...from, q, a: extra ? `${from.a} ${extra}` : from.a });

const clubsLanding = getLanding("ticketera-discotecas");
if (!clubsLanding) throw new Error("Falta la landing ticketera-discotecas en src/data/landings.ts");

const payout = pick(PRODUCER_FAQ, "¿Cuándo recibo el dinero de mis ventas?");
if (!payout.a.startsWith(PAYOUT_SCHEDULE_TEXT)) throw new Error("La respuesta de pago de PRODUCER_FAQ ya no empieza con PAYOUT_SCHEDULE_TEXT");
/** "Para retirar necesitas registrar una cuenta bancaria…" (lo que sigue a PAYOUT_SCHEDULE_TEXT en PRODUCER_FAQ) */
const payoutBank = payout.a.slice(PAYOUT_SCHEDULE_TEXT.length).trim();

export const CLUBS_FAQ: FaqItem[] = [
    pick(PRODUCER_FAQ, "¿Cuánto cuesta usar AI Tickets?"),
    {
        q: "¿Cuándo recibo lo de cada noche?",
        a: `${PAYOUT_SCHEDULE_TEXT} Si la noche termina pasada la medianoche, se cuenta desde la hora de término. Escanea las entradas en la puerta: los check-ins acreditan que la noche se realizó, una de las condiciones para liberar el pago. ${payoutBank}`,
        terms: true,
    },
    pick(PRODUCER_FAQ, "¿Puedo absorber el cargo por servicio?"),
    pick(clubsLanding.faq, "¿Cómo armo la lista free?"),
    reword(
        pick(PRODUCER_FAQ, "¿Puedo saber cuántas entradas vende cada promotor?"),
        "¿Puedo saber cuántos trae cada RRPP?",
        "Las inscripciones a la lista free también cuentan, con ingreso $0.",
    ),
    pick(clubsLanding.faq, "¿Cómo vendo mesas?"),
    reword(
        pick(PRODUCER_FAQ, "¿Puedo publicar varias funciones de una misma obra o show?"),
        "¿Puedo publicar todas las noches del mes?",
        "Cada noche puede terminar pasada la medianoche.",
    ),
    pick(clubsLanding.faq, "¿Puedo pedir que sean mayores de 18?"),
    pick(clubsLanding.faq, "¿Qué pasa si alguien comparte el pantallazo de su QR?"),
    pick(clubsLanding.faq, "¿Puedo tener lista de invitados y cortesías?"),
    pick(clubsLanding.faq, "¿Se puede pagar el cover en la puerta?"),
    pick(ORGANIZADORES_FAQ, "¿Cómo funciona la publicación automática en redes?"),
    pick(ORGANIZADORES_FAQ, "¿Tengo que pagar anuncios?"),
    pick(ORGANIZADORES_FAQ, "¿Puedo poner un video como portada del evento?"),
    pick(PRODUCER_FAQ, "¿Qué pasa si tengo que cambiar o cancelar una función?"),
    pick(PRODUCER_FAQ, "¿Me ayudan a publicar mi primer evento?"),
];
