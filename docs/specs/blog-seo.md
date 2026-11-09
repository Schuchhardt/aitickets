# Blog SEO automatizado (/blog)

Artículos para productores de eventos que **primero informan y al final presentan AI Tickets**, elegidos por keywords
con demanda real en Chile y mejorados con los datos de Google. Operación y puesta en marcha:
[`docs/runbooks/blog-seo.md`](../runbooks/blog-seo.md).

## Por qué así

- **Intención informativa, no transaccional.** Las búsquedas de compra ("ticketera para teatro") ya las cubren las
  landings (`src/data/landings.ts`). El blog va por lo que el productor busca *antes* de elegir ticketera: "cómo
  organizar un concierto", "cuánto cobrar la entrada de una fiesta", "permisos para un evento". Eso trae tráfico que
  luego enlaza a las landings (cluster: artículo → hub del tema → landing).
- **Calidad antes que volumen.** Google penaliza el contenido a escala sin valor. Por eso: investigación web con
  fuentes reales, validaciones que bloquean la publicación, anti-canibalización, cuota de 3 por semana por defecto
  y refresco de lo que ya rankea en vez de escribir más.
- **El producto solo se afirma con hechos verificados** (`netlify/lib/blog/product-facts.mjs`, misma regla que las
  landings: solo lo que hace hoy).

## Flujo

```
Keyword Planner ─┐
Search Console ──┼─► candidatas ─► clasificación IA ─► score ─► aitickets_blog_keywords
Autocompletado ──┘   (por tema)     (tema, intención,      (0-100)
                                     audiencia, relevancia)
                                                              │ cuota por tema / queued a mano
                                                              ▼
              plan (¿ya lo responde otra página? secundarias) ─► investigación web (Chile, con URLs)
                                                              ─► redacción (Markdown + FAQ + metadatos)
                                                              ─► validaciones ─► publicado | borrador
                                                              ─► caché CDN + sitemap a Search Console + IndexNow
Search Console (28 días, por artículo) ─► métricas + consultas ─► refresco del que está entre la posición 3 y 30
```

| Tarea | Frecuencia (auto) | Qué hace | Código |
| --- | --- | --- | --- |
| `keywords` | semanal | Ideas de Keyword Planner para las semillas de cada tema (Chile, español), consultas de Search Console (Chile, sin la marca), autocompletado de Google; clasifica las nuevas en lotes y calcula el score | `keywords.mjs`, `google.mjs`, `autocomplete.mjs`, `scoring.mjs` |
| `generate` | `BLOG_POSTS_PER_WEEK` (máx. 1/día) | Elige keyword, plan, investigación, redacción, validación y publicación | `posts.mjs`, `writer.mjs`, `llm.mjs`, `publish.mjs` |
| `metrics` | semanal | Impresiones, clics, CTR, posición y consultas de cada artículo | `posts.mjs` (`syncPostMetrics`) |
| `refresh` | semanal | Reescribe el artículo con más impresiones entre la posición 3 y 30 (publicado hace 21+ días, sin refresco en 45) cubriendo las consultas que lo traen y mejorando título/meta si el CTR es bajo | `posts.mjs` (`refreshPost`) |

`blog-tick` (programada, a diario) dispara `blog-background` con `task: "auto"` (`runner.mjs` → `plannedTasks`).
Todo queda en `aitickets_blog_runs` con resultado y costo estimado en USD.

## Elección de keyword

1. La pedida (`run_blog_task` con `keyword_id`).
2. La mejor `queued` (priorizada a mano con `upsert_blog_keywords`).
3. Si no, la mejor `new` con score ≥ 25 del **tema con más déficit de cuota**: peso del tema (normalizado entre los
   activos) menos su parte de los artículos de los últimos 90 días.

**Score** (`scoring.mjs`): `100 × √demanda × competencia × intención × relevancia × empuje`. Demanda en escala log de
las búsquedas mensuales de Planner (o impresiones de Search Console, o señal del autocompletado); competencia de Ads
pesa poco (mide anunciantes, no SEO); informational 1 · commercial 0,85 · transactional 0,3 · navigational 0;
relevancia 0-100 de la IA pensando en productores (no en público asistente); ×1,25 si Search Console ya nos muestra
entre las posiciones 4 y 30 (striking distance).

**Descartes automáticos** al clasificar: marcas o sitios puntuales, búsquedas de público asistente ("entradas teatro
hoy"), sin tema o relevancia < 40. Nunca se toca una `queued` ni una `used`.

**Canibalización**: si la keyword ya es principal o secundaria de un artículo, se marca `used` con ese artículo. Si
el plan dice que una página existente (landing, guía o artículo) ya responde esa intención, se marca (`used` si es un
artículo del blog —candidata a su refresco—, `rejected` si es otra página) y se prueba con la siguiente. El plan
agrupa en el mismo artículo las candidatas con la misma intención (quedan `used` con él).

## Reglas editoriales (`writer.mjs` → `WRITER_SYSTEM`)

- Primer párrafo que responde la búsqueda en 40-60 palabras (fragmento destacado), 5-9 secciones `##`, ejemplos en
  CLP, listas y tablas; 1.300-2.200 palabras sin relleno.
- Toda cifra, ley o dato externo con enlace a una URL de la investigación. Nada inventado (estudios, testimonios,
  precios de terceros). Sin nombrar ni enlazar otras ticketeras.
- AI Tickets: máximo una mención natural en el cuerpo y la sección final **"Cómo hacerlo con AI Tickets"**
  (≤ 110 palabras) con hechos de `PRODUCT_FACTS` y enlace a la landing del tema. Máximo 3 menciones de la marca.
- 2-4 enlaces internos a páginas del catálogo (`INTERNAL_PAGES` + artículos publicados).
- FAQ aparte (3-5 preguntas reales), meta título ≤ 60, meta descripción 140-155, slug corto sin tildes ni años.

## Validaciones (`finalizeArticle`, sin IA)

Se limpian sin preguntar: H1 → H2; enlaces internos fuera del catálogo y externos que no salieron de la
investigación quedan como texto; ticketeras de la competencia y `passline.com` nunca se enlazan ni se citan.

**Bloquean la publicación** (queda en borrador con el detalle en `quality`): menos de 800 palabras, menos de 3
secciones, sin título o meta descripción, más de 4 menciones de la marca, título que no trabaja la keyword.
**Avisos** (se publica igual): keyword ausente al inicio, sin cierre o sin enlace a la landing, menos de 2 enlaces
internos o 3 preguntas, enlaces quitados, meta título largo.

## Páginas

- `/blog` (portada con temas, recientes y guías), `/blog/<slug>` (artículo: índice, FAQ, fuentes consultadas,
  relacionados del mismo tema y CTA suave), `/blog/tema/<slug>` (hub del cluster; 404 sin artículos), `/blog/rss.xml`.
- SSR con caché del CDN (etiqueta `blog-pages`, se vacía al publicar o editar). JSON-LD `BlogPosting`,
  `BreadcrumbList`, `FAQPage` y `CollectionPage`. Imagen para compartir: la tarjeta de la landing del tema.
- Sitemap: `/blog`, cada artículo (`lastmod` = última actualización del contenido) y los hubs con artículos.
- Borradores: `/blog/vista-previa/<id>?t=…` (link firmado de 14 días, noindex) desde `get_blog_post`.
- Markdown → HTML con allowlist propia (`src/lib/blog.ts`): tablas, `h2` con id para el índice, enlaces externos en
  pestaña nueva.

## Datos

Migración `db/migrations/202611090200_blog.sql`: `aitickets_blog_topics` (14 temas iniciales: 8 nichos y 6
funcionalidades, con semillas y peso), `aitickets_blog_keywords`, `aitickets_blog_posts`, `aitickets_blog_runs`. RLS sin
políticas: solo la service role.

## Costos aproximados

Por artículo: plan + investigación (≤ 6 búsquedas web) + redacción con Claude Opus 5.5 ≈ US$0,5-2 (queda en
`list_blog_runs`). Clasificar keywords en lote: centavos por corrida. Search Console y Keyword Planner: gratis.

## Límites conocidos

- Keyword Planner exige developer token con acceso **Basic**; sin él, la demanda sale de Search Console y del
  autocompletado (la cobertura de volumen es menor, el resto funciona igual).
- Search Console trae ~3 días de atraso y oculta consultas anónimas: las consultas por artículo suman menos que
  sus impresiones totales.
- Las métricas por consulta de Search Console son de 28 días: un artículo necesita ~3-4 semanas para tener datos
  útiles antes de refrescarse (por eso el mínimo de 21 días).
