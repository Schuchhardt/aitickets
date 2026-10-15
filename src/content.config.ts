// Colecciones de contenido. guias: artículos para productores (src/content/guias/*.md → /guias/<slug>).
// Igual que las landings, solo se describe lo que el producto hace hoy (ver src/data/landings.ts).
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const guias = defineCollection({
    loader: glob({ pattern: "*.md", base: "./src/content/guias" }),
    schema: z.object({
        title: z.string(),
        description: z.string().max(170),
        /** Título corto para tarjetas y enlaces. */
        cardTitle: z.string(),
        published: z.coerce.date(),
        updated: z.coerce.date().optional(),
        /** Landing a la que lleva el CTA y slugs relacionados (landings o "guias/<slug>"). */
        landing: z.string(),
        related: z.array(z.string()).default([]),
    }),
});

export const collections = { guias };
