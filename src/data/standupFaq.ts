// Preguntas frecuentes de /ticketera-stand-up (SPEC_landing_standup §4.10): las de la landing principal (dinero y plazos
// tal cual de PRODUCER_FAQ; difusión automática, anuncios, video de portada, reseñas y muro de ORGANIZADORES_FAQ,
// verificadas contra el código) más las propias del stand-up que ya tenía la página (src/data/landings.ts), en el orden
// de la spec principal (§5.8) con las del stand-up junto a la de links por promotor.
import { PRODUCER_FAQ, type FaqItem } from "./producerFaq";
import { ORGANIZADORES_FAQ } from "./organizadoresFaq";
import { getLanding } from "./landings";

const pick = (list: FaqItem[], q: string): FaqItem => {
    const item = list.find((f) => f.q === q);
    if (!item) throw new Error(`Falta la pregunta "${q}"`);
    return item;
};
const standupLanding = getLanding("ticketera-stand-up");
if (!standupLanding) throw new Error("Falta la landing ticketera-stand-up en src/data/landings.ts");

export const STANDUP_FAQ: FaqItem[] = [
    pick(PRODUCER_FAQ, "¿Cuánto cuesta usar AI Tickets?"),
    pick(PRODUCER_FAQ, "¿Cuándo recibo el dinero de mis ventas?"),
    pick(PRODUCER_FAQ, "¿Puedo absorber el cargo por servicio?"),
    pick(PRODUCER_FAQ, "¿Puedo publicar varias funciones de una misma obra o show?"),
    pick(PRODUCER_FAQ, "¿Puedo saber cuántas entradas vende cada promotor?"),
    pick(standupLanding.faq, "¿Cada comediante puede ver cuánto vendió?"),
    pick(standupLanding.faq, "¿Sirve para open mics o funciones gratis?"),
    pick(ORGANIZADORES_FAQ, "¿Cómo funciona la publicación automática en redes?"),
    pick(ORGANIZADORES_FAQ, "¿Tengo que pagar anuncios?"),
    pick(ORGANIZADORES_FAQ, "¿Puedo poner un video como portada del evento?"),
    pick(ORGANIZADORES_FAQ, "¿Cómo funcionan las reseñas?"),
    pick(ORGANIZADORES_FAQ, "¿Qué es el muro de asistentes?"),
    pick(PRODUCER_FAQ, "¿Necesito saber de inteligencia artificial?"),
    pick(PRODUCER_FAQ, "¿Qué pasa si tengo que cambiar o cancelar una función?"),
    pick(PRODUCER_FAQ, "¿Me ayudan a publicar mi primer evento?"),
];
