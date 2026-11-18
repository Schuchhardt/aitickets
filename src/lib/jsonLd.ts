// Serializa datos estructurados para <script type="application/ld+json">.
// Varios nodos van en un solo objeto con "@graph" y "@context" arriba, nunca como arreglo suelto: es
// JSON-LD válido igual para Google, y hay scripts de terceros (extensiones de Safari) que leen
// `data["@context"].toLowerCase()` del bloque y se caen con un arreglo en la raíz.
// "<" se escapa para que un texto con "</script>" no pueda cerrar el bloque.
export function jsonLdString(data: Record<string, unknown> | Record<string, unknown>[]): string {
  const root =
    Array.isArray(data) && data.length === 1
      ? data[0]
      : Array.isArray(data)
        ? { "@context": "https://schema.org", "@graph": data.map(({ "@context": _ctx, ...node }) => node) }
        : data;
  return JSON.stringify(root).replace(/</g, "\\u003c");
}
