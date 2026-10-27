// Preguntas frecuentes de productores (landing / y /organizadores). Cada respuesta está verificada contra el
// producto: tarifas en fees.mjs, plazos en legal.mjs (PAYOUT_*), funciones en producer-api/tools/schedule.ts,
// atribución por link en eventos/[slug].astro (sessionStorage) y cambios/cancelación en postsale.ts.
import { SERVICE_FEE_PERCENT_LABEL, IVA_PERCENT_LABEL, computeFeeSplit } from "../../netlify/lib/fees.mjs";
import { PAYOUT_SCHEDULE_TEXT } from "../../netlify/lib/legal.mjs";

/** terms: la respuesta promete algo condicionado (pagos, devoluciones) y termina con "*Se aplican términos y condiciones". */
export type FaqItem = { q: string; a: string; terms?: boolean };

/** Enlace de la nota "*Se aplican términos y condiciones" (el detalle está en los términos para productores). */
export const TERMS_NOTE = { text: "*Se aplican términos y condiciones", href: "/terminos-productores" };

/** Cómo se activa hoy el cargo absorbido (no hay switch en el panel). La usan esta FAQ y el precio de /organizadores. */
export const ABSORB_FEE_ACTIVATION = "Hoy se activa desde tu asistente de IA conectado o escribiéndonos por WhatsApp.";

const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const absorbed = computeFeeSplit(10000, { absorbed: true });

export const PRODUCER_FAQ: FaqItem[] = [
    {
        q: "¿Cuánto cuesta usar AI Tickets?",
        a: `Crear tu cuenta y publicar es gratis y no hay mensualidad. Por cada entrada pagada, el comprador paga un cargo por servicio de ${SERVICE_FEE_PERCENT_LABEL} del valor de la entrada más IVA (${IVA_PERCENT_LABEL}) sobre ese cargo. Tú recibes el 100% del valor de tus entradas. Las entradas gratis no pagan cargo.`,
    },
    {
        q: "¿Cuándo recibo el dinero de mis ventas?",
        a: `${PAYOUT_SCHEDULE_TEXT} Para retirar necesitas registrar una cuenta bancaria, que AI Tickets verifica normalmente en 1 día hábil.`,
        terms: true,
    },
    {
        q: "¿Puedo absorber el cargo por servicio?",
        a: `Sí, por evento. El comprador ve un precio final y el cargo con su IVA se descuenta de tu venta: en una entrada de $10.000 recibes ${clp(absorbed.producerNet)}. ${ABSORB_FEE_ACTIVATION}`,
    },
    {
        q: "¿Puedo publicar varias funciones de una misma obra o show?",
        a: "Sí. Un evento puede tener hasta 60 funciones, con entradas para una función específica o válidas para todas. Para la semana siguiente también puedes duplicar el evento y solo cambiar las fechas.",
    },
    {
        q: "¿Puedo saber cuántas entradas vende cada promotor?",
        a: "Sí. Crea un link con seguimiento para cada comediante, promotor o campaña y en las métricas del evento verás órdenes, entradas e ingresos por canal. La venta se asocia al link cuando la persona compra en la misma visita en que llegó con él.",
    },
    {
        q: "¿Necesito saber de inteligencia artificial?",
        a: "No. Todo se hace desde el panel. Si quieres, puedes conectar AI Tickets a Claude o ChatGPT para consultar tus ventas, preparar publicaciones o crear códigos de descuento conversando; las acciones que publican, cobran o envían mensajes siempre te piden confirmación.",
    },
    {
        q: "¿Qué pasa si tengo que cambiar o cancelar una función?",
        a: "Si cambias la fecha u horario de un evento publicado, avisamos por email a quienes ya compraron. Si cancelas, los compradores reciben la devolución de sus entradas y del cargo por servicio.",
        terms: true,
    },
    {
        q: "¿Me ayudan a publicar mi primer evento?",
        a: "Sí. Escríbenos por WhatsApp o agenda una demo de 15 minutos y lo armamos contigo.",
    },
];
