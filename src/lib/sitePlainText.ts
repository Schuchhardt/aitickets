// HTML saneado de "Sobre nosotros" (content.about) → texto plano con párrafos separados por una línea en blanco.
// Módulo puro (servidor y navegador): lo usa la vista previa en vivo del sitio para editar el texto ahí mismo.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  const withBreaks = String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|blockquote|div)>\s*/gi, "\n\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(withBreaks)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
