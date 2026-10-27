// Portada (/): cada nicho lleva a una landing que existe, con su H1 como frase, y las fotos tienen sus variantes.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HOME_CLOSING_PHOTOS,
  HOME_MOSAIC,
  HOME_NICHES,
  HOME_ROTATING_WORDS,
  HOME_STORY_PHOTOS,
} from "../../src/components/landing/home/homeLanding.js";

const PAGES = {
  "/ticketera-stand-up": "src/pages/ticketera-stand-up.astro",
  "/ticketera-teatro": "src/pages/ticketera-teatro.astro",
  "/ticketera-musica-en-vivo": "src/pages/ticketera-musica-en-vivo.astro",
  "/ticketera-discotecas": "src/pages/ticketera-discotecas.astro",
  "/ticketera-fiestas": "src/pages/ticketera-fiestas.astro",
  "/ticketera-talleres": "src/pages/ticketera-talleres.astro",
  "/ticketera-seminarios": "src/pages/ticketera-seminarios.astro",
  "/academias": "src/pages/academias.astro",
};

const allPhotos = [
  ...HOME_NICHES.map((n) => n.photo),
  ...HOME_MOSAIC.flat().map((t) => t.photo),
  ...Object.values(HOME_STORY_PHOTOS),
  ...HOME_CLOSING_PHOTOS,
];

describe("portada", () => {
  it("tiene los ocho nichos, cada uno con su landing", () => {
    expect(HOME_NICHES.map((n) => n.href)).toEqual(Object.keys(PAGES));
    for (const niche of HOME_NICHES) expect(existsSync(PAGES[niche.href])).toBe(true);
  });

  it("la palabra que rota tiene una por nicho (los % de la animación asumen 8)", () => {
    expect(HOME_ROTATING_WORDS).toHaveLength(HOME_NICHES.length);
    expect(HOME_ROTATING_WORDS).toHaveLength(8);
    const hero = readFileSync("src/components/landing/home/HomeHero.astro", "utf8");
    expect(hero).toMatch(/12\.5%/);
  });

  it("todas las fotos existen con sus variantes AVIF/WebP", () => {
    for (const photo of allPhotos) {
      expect(existsSync(`public${photo.src}`)).toBe(true);
      for (const source of photo.sources) {
        for (const entry of source.srcset.split(", ")) {
          expect(existsSync(`public${entry.split(" ")[0]}`)).toBe(true);
        }
      }
    }
  });
});
