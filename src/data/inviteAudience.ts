// A quiénes se puede invitar al próximo evento, en una frase, con las audiencias que ofrece el panel (INVITE_AUDIENCES de
// netlify/lib/reviews.mjs): "todos los asistentes, a quienes ingresaron o a quienes calificaron con 4 o 5 estrellas".
// La usan las FAQ y las secciones de teatro y talleres (antes vivía en teatroFaq.ts, que la sigue exportando).
import { INVITE_AUDIENCES } from "../../netlify/lib/reviews.mjs";

/** "Solo quienes calificaron con 4 o 5 estrellas" → "quienes calificaron con 4 o 5 estrellas" (para usarlo en una frase). */
const audience = (label: string): string =>
    label
        .replace(/^Solo /, "")
        .replace(/ \(check-in\)$/, "")
        .replace(/^\p{Lu}/u, (c) => c.toLowerCase());

export const INVITE_AUDIENCE_TEXT = `${audience(INVITE_AUDIENCES.all)}, a ${audience(INVITE_AUDIENCES.checked_in)} o a ${audience(INVITE_AUDIENCES.promoters)}`;
