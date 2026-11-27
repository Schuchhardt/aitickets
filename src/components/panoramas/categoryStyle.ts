// Fondo y emoji de cada categoría para los panoramas sin afiche (src/components/panoramas).
import type { Category } from "../../lib/market/taxonomy";

export const CATEGORY_STYLE: Record<Category, { bg: string; emoji: string }> = {
    concierto: { bg: "bg-gradient-to-br from-fuchsia-600 to-indigo-800", emoji: "🎸" },
    festival: { bg: "bg-gradient-to-br from-orange-500 to-pink-700", emoji: "🎡" },
    fiesta: { bg: "bg-gradient-to-br from-violet-600 to-black", emoji: "🪩" },
    club: { bg: "bg-gradient-to-br from-slate-800 to-black", emoji: "🎧" },
    stand_up: { bg: "bg-gradient-to-br from-amber-500 to-red-700", emoji: "🎤" },
    teatro: { bg: "bg-gradient-to-br from-rose-700 to-stone-900", emoji: "🎭" },
    danza: { bg: "bg-gradient-to-br from-pink-500 to-purple-800", emoji: "🩰" },
    infantil: { bg: "bg-gradient-to-br from-sky-400 to-emerald-600", emoji: "🎈" },
    conferencia: { bg: "bg-gradient-to-br from-blue-600 to-slate-900", emoji: "💡" },
    taller: { bg: "bg-gradient-to-br from-emerald-500 to-teal-800", emoji: "🛠️" },
    deportes: { bg: "bg-gradient-to-br from-green-500 to-blue-800", emoji: "🏃" },
    feria: { bg: "bg-gradient-to-br from-yellow-500 to-orange-700", emoji: "🧺" },
    cine: { bg: "bg-gradient-to-br from-zinc-700 to-black", emoji: "🎬" },
    otro: { bg: "bg-gradient-to-br from-lime-500 to-emerald-800", emoji: "✨" },
};
