// Ícono de cada categoría del evento (category_tags.name). Las del editor (EditEventForm.vue) son fijas, pero
// hay nombres libres de eventos antiguos o del MCP: se busca por palabra clave y si no calza, una etiqueta.
import { Mic, Drama, Music, PartyPopper, FerrisWheel, Tent, Footprints, Baby, Presentation, Trophy, UtensilsCrossed, Tag } from "lucide-vue-next";

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Orden importa: la primera regla que calza gana ("Festival de música" => festival)
const RULES = [
  [/stand.?up|comedia|humor|impro/, Mic],
  [/festival|feria/, FerrisWheel],
  [/teatro|obra|musical/, Drama],
  [/circo|acrobac/, Tent],
  [/danza|baile|ballet/, Footprints],
  [/infantil|ninos|familia/, Baby],
  [/taller|charla|conferencia|curso|seminario|workshop/, Presentation],
  [/deporte|carrera|futbol|running|torneo/, Trophy],
  [/gastronom|comida|vino|cerveza|degustacion/, UtensilsCrossed],
  [/fiesta|party|club|dj|electronica/, PartyPopper],
  [/musica|concierto|banda|rock|jazz|indie|tocata/, Music],
];

/** Componente lucide para el nombre de una categoría. */
export function categoryIcon(name) {
  const n = normalize(name);
  return RULES.find(([re]) => re.test(n))?.[1] || Tag;
}
