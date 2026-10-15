// Enlaces internos entre landings SEO, guías y páginas fijas (tarjetas "También te puede servir").
import { getCollection } from "astro:content";
import { LANDINGS } from "../data/landings";

export type SeoLink = { href: string; title: string; text: string };

const FIXED: Record<string, SeoLink> = {
    precios: { href: "/precios", title: "Precios", text: "Calcula cuánto paga el comprador y cuánto recibes tú." },
    "ticketeras-en-chile": { href: "/ticketeras-en-chile", title: "Ticketeras en Chile", text: "Cuánto cobra cada una, con fuentes y fecha de revisión." },
    organizadores: { href: "/organizadores", title: "Para organizadores", text: "Todo lo que puedes hacer con AI Tickets." },
};

/** Resuelve slugs ("ticketera-teatro", "guias/como-hacer-una-preventa", "precios") a enlaces. Ignora los desconocidos. */
export async function relatedLinks(slugs: string[]): Promise<SeoLink[]> {
    const guides = await getCollection("guias");
    const out: SeoLink[] = [];
    for (const slug of slugs) {
        if (slug.startsWith("guias/")) {
            const g = guides.find((e) => e.id === slug.slice("guias/".length));
            if (g) out.push({ href: `/${slug}`, title: g.data.cardTitle, text: g.data.description });
            continue;
        }
        const landing = LANDINGS.find((l) => l.slug === slug);
        if (landing) out.push({ href: `/${landing.slug}`, title: landing.card.title, text: landing.card.text });
        else if (FIXED[slug]) out.push(FIXED[slug]);
    }
    return out;
}
