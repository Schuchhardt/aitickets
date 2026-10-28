// Preguntas frecuentes de la landing /organizadores (SPEC_landing_productores §5.8). Las de dinero y plazos son las de
// PRODUCER_FAQ tal cual (producerFaq.ts: fees.mjs y legal.mjs); se suman las de difusión automática
// (src/lib/socialSeries.ts), anuncios (netlify/lib/zernio-ads.mjs), video de portada (src/lib/eventVideo.ts), reseñas
// (netlify/lib/reviews.mjs) y muro de asistentes (netlify/lib/attendee-community.mjs). Va en un archivo aparte para que
// las islas que solo importan TERMS_NOTE de producerFaq.ts no carguen estos módulos.
import { PRODUCER_FAQ, type FaqItem } from "./producerFaq";
import { MAX_PHOTOS_PER_PERSON, REVIEW_REQUEST_DELAY_HOURS, REVIEW_REQUEST_WINDOW_HOURS } from "../../netlify/lib/reviews.mjs";
import { FEED_MESSAGE_MAX } from "../../netlify/lib/attendee-community.mjs";
import { EVENT_VIDEO_MAX_BYTES } from "../lib/eventVideo";

const producerFaq = (q: string): FaqItem => {
    const item = PRODUCER_FAQ.find((f) => f.q === q);
    if (!item) throw new Error(`Falta la pregunta "${q}" en PRODUCER_FAQ`);
    return item;
};
const videoMaxMb = Math.round(EVENT_VIDEO_MAX_BYTES / (1024 * 1024));

export const ORGANIZADORES_FAQ: FaqItem[] = [
    producerFaq("¿Cuánto cuesta usar AI Tickets?"),
    producerFaq("¿Cuándo recibo el dinero de mis ventas?"),
    producerFaq("¿Puedo absorber el cargo por servicio?"),
    producerFaq("¿Puedo publicar varias funciones de una misma obra o show?"),
    producerFaq("¿Puedo saber cuántas entradas vende cada promotor?"),
    {
        q: "¿Cómo funciona la publicación automática en redes?",
        a: "Conectas tu Instagram una vez y apruebas la serie con una vista previa de cada pieza. Con el póster y los datos de tu evento armamos historias con cuenta regresiva, que se vuelven diarias la última semana, y una publicación diaria en el feed esa semana, y se publican solos hasta el día de la función. A quien responde una historia o comenta una publicación con la palabra clave le llega el link de compra por DM. Si se agota, cambias la fecha o cancelas, la serie se ajusta o se detiene sola. Si conectas tu página de Facebook o tu TikTok, la serie sale también ahí con la misma cadencia, y si el evento tiene un video vertical corto (3 a 60 segundos), se publica como reel unos días antes. Si una red falla, las demás siguen.",
    },
    {
        q: "¿Tengo que pagar anuncios?",
        a: "No. Publicar en tus redes no tiene costo. Los anuncios en Instagram y Facebook son opcionales: conectas tu cuenta publicitaria de Meta, defines un presupuesto diario y los días, y los pausas cuando quieras. Meta cobra el gasto directo en tu cuenta publicitaria.",
    },
    {
        q: "¿Puedo poner un video como portada del evento?",
        a: `Sí, y te lo recomendamos. Subes un MP4, MOV o WebM de hasta ${videoMaxMb} MB y reemplaza la imagen arriba de la página: se reproduce solo, sin sonido, y cada persona puede activarlo. La imagen del evento se sigue usando al compartir y en los correos.`,
    },
    {
        q: "¿Cómo funcionan las reseñas?",
        a: `Entre ${REVIEW_REQUEST_DELAY_HOURS} y ${REVIEW_REQUEST_WINDOW_HOURS} horas después de cada función, los asistentes reciben un correo para calificar con estrellas, dejar un comentario y subir hasta ${MAX_PHOTOS_PER_PERSON} fotos. Ves todo en el panel, puedes ocultar comentarios y, si quieres, premiar a quien califica con un código de descuento para tus próximos eventos, sin importar la nota.`,
    },
    {
        q: "¿Qué es el muro de asistentes?",
        a: `Un espacio en la página del evento donde quienes tienen entrada reaccionan con un emoji y dejan un mensaje corto (hasta ${FEED_MESSAGE_MAX} caracteres) que ven los demás asistentes. Tú lo moderas desde el panel. Después del evento queda como recuerdo, con el título "Así lo vivieron".`,
    },
    producerFaq("¿Necesito saber de inteligencia artificial?"),
    producerFaq("¿Qué pasa si tengo que cambiar o cancelar una función?"),
    producerFaq("¿Me ayudan a publicar mi primer evento?"),
];
