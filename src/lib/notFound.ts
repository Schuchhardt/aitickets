// 404 de páginas SSR cuyo contenido puede aparecer después (borrador que se publica, sitio que se activa).
// Astro responde con la página 404 prerenderizada y le copia estos headers (mergeResponses). Sin ellos, el Edge
// de Netlify guarda el 404 estático bajo esa URL (sin distinguir query params) hasta el siguiente deploy: un
// evento recién publicado seguía dando 404 a quien había abierto su link en borrador.
export const notFound = () =>
  new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Netlify-CDN-Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
