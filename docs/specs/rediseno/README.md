# Rediseño AI Tickets — specs y prototipos

Material para implementar con Claude Code.

## Un solo PR

Todo el rediseño va en **un único PR**, rama `rediseno/aitickets`, con commits ordenados (las "fases" de cada spec son commits, no PRs):

1. `rediseno(evento): cards de acción v2` — SPEC_evento §4.4b
2. `rediseno(evento): varias funciones` — SPEC_evento §4.9b y §6.3
3. `rediseno(organizadores): limpieza y nueva estructura` — SPEC_landing_productores Fases A y B
4. `rediseno(organizadores): animaciones y pulido` — Fase C
5. `rediseno(stand-up): landing especializada` — SPEC_landing_standup
6. `rediseno(academias): landing nueva` — SPEC_landing_academias
7. `rediseno(musica): landing especializada` — SPEC_landing_musica
8. `rediseno(teatro): landing especializada` — SPEC_landing_teatro
9. `rediseno(talleres): landing especializada` — SPEC_landing_talleres
10. `rediseno(clubs): landing especializada` — SPEC_landing_clubs
11. `rediseno(fiestas): landing especializada` — SPEC_landing_fiestas
12. `rediseno(seminarios): landing especializada` — SPEC_landing_seminarios
13. `rediseno: assets optimizados, SEO, analítica y tests` — lo transversal. Este commit agrega también lo que todavía no
    está en git: esta carpeta `docs/specs/rediseno/` (README, specs, prototipos y `fotos-nicho.md`), los WebM y pósters
    WebP de los videos (`public/landing/cover-standup.webm`, `public/videos/aitickets-demo.webm` y su póster),
    `aitk-musica-prueba-sonido.jpg` con sus variantes, `scripts/landing-media.mjs`, `ProducerTracking.astro` y los tests
    nuevos (`landings-seo.spec.ts`, `landings-analytics.spec.ts`, `landing-assets.test.mjs`,
    `checkout-return-funnel.test.mjs`).

Reglas: cada commit deja el sitio compilando (`npm run check`); los tests se corren al final de cada bloque; no se hace push forzado sobre commits ya revisados. La descripción del PR lleva una sección por spec con capturas desktop y mobile, la lista de diferencias con la spec y lo que quedó marcado `Pronto`.

| Spec | Alcance | Prototipos |
|---|---|---|
| `SPEC_evento_checkout_aitickets.md` | **Solo** eventos con varias funciones (§4.9b, §6.3) y cards de acción v2 (§4.4b). Leer primero "Alcance de esta versión": video de portada, fondo animado (Iridescence) y layouts banner/poster/compact NO se tocan. | `Paid.dc.html`, `MobilePaid.dc.html`, `States.dc.html` |
| `SPEC_landing_productores_aitickets.md` | Landing principal `/organizadores` | `Landing.dc.html`, `LandingMobile.dc.html` |
| `SPEC_landing_standup_aitickets.md` | Landing `/ticketera-stand-up` | `LandingB.dc.html`, `LandingBMobile.dc.html` |
| `SPEC_landing_academias_aitickets.md` | Landing nueva para academias | `LandingAcademias.dc.html`, `LandingAcademiasMobile.dc.html` |
| `SPEC_landing_musica_aitickets.md` | Landing `/ticketera-musica-en-vivo` (misma URL, ahora `dedicated` en `landings.ts`) | Sin prototipo: manda la spec |
| `SPEC_landing_teatro_aitickets.md` | Landing `/ticketera-teatro` (misma URL, ahora `dedicated` en `landings.ts`) | Sin prototipo: manda la spec |
| `SPEC_landing_talleres_aitickets.md` | Landing `/ticketera-talleres` (misma URL, ahora `dedicated` en `landings.ts`) | Sin prototipo: manda la spec |
| `SPEC_landing_clubs_aitickets.md` | Landing nueva `/ticketera-discotecas` (`dedicated` en `landings.ts`; `/ticketera-clubs` y `/ticketera-clubes` redirigen con 301) | Sin prototipo: manda la spec |
| `SPEC_landing_fiestas_aitickets.md` | Landing nueva `/ticketera-fiestas` (`dedicated` en `landings.ts`, sin redirecciones) | Sin prototipo: manda la spec |
| `SPEC_landing_seminarios_aitickets.md` | Landing nueva `/ticketera-seminarios` (`dedicated` en `landings.ts`, sin redirecciones) | Sin prototipo: manda la spec |

## Cómo leer los prototipos

Los `.dc.html` son componentes del canvas de diseño: un template `<x-dc>` con `{{variables}}`, `sc-for` / `sc-if`, y una clase `Component` con el estado y la lógica de las demos. No abren solos en el navegador; úsalos como referencia de layout, estilos, copy y comportamiento. **Si difieren de la spec, manda la spec. Si la spec difiere del código en algo de dinero o plazos, manda el código** (`src/data/producerFaq.ts`, `src/lib`).

Los `/_blob/<id>` del prototipo corresponden a los archivos de `public/landing/` (ver tabla abajo).

## Assets (`public/landing/`)

Generados con IA como referencia de tono: reemplazar por fotos y videos reales con permiso antes de publicar (en academias, con consentimiento de las familias si aparecen menores).

| Archivo | `/_blob/` del prototipo |
|---|---|
| aitk-hero-standup.jpg | 899c0963b58a6351ce891c650af928f5 |
| aitk-musica.jpg | 44db10c3d8f1ba56f12b81f95f77a5a3 |
| aitk-productor.jpg | a75445c01b237816c05cbbc68325baf4 |
| aitk-publico.jpg | 1db53f6239951ad7931447ffc54956b2 |
| aitk-puerta-qr.jpg | ba87119f5659243eec3a86df40fc8ce4 |
| aitk-taller.jpg | c8f74e8097253dd878774efcb177a2b7 |
| aitk-teatro.jpg | 6e1e3fffbef71e768a4913da516a335a |
| aitk-backstage.jpg | 48bfd3f1bbd2157950c9471cdf8285e9 |
| aitk-comediante.jpg | 3b2662d7e351796facd5621c1bbf8fca |
| aitk-openmic.jpg | 8fdd3c8283ce4017fe052a59449273d1 |
| aitk-acad-recital.jpg | 781317cbcd2abd9dff2f563f5cbf65d8 |
| aitk-acad-puerta.jpg | 461e603f4481ff97fa0cab0e4a27a458 |
| aitk-acad-teatro.jpg | b2544c6bb054b6ef5cbbb7cf85151e82 |
| aitk-acad-directora.jpg | a83bc3dc9a84de590356381d6ff9986f |
| cover-standup.mp4 | 00830326d00224e120775f7edb31c18e |

Las fotos de las landings de nicho sin prototipo (música, teatro, talleres, clubs, fiestas y seminarios) están en [`fotos-nicho.md`](fotos-nicho.md).

### Versiones optimizadas (commit 13)

- **Fotos:** cada JPG usado tiene AVIF y WebP a varios anchos (`<nombre>-<ancho>.avif` / `.webp`: 640/1024/1344 las apaisadas, 480/896 las verticales). Las páginas las sirven en un `<picture>` con `srcset`, `sizes`, `width`/`height` y `aspect-ratio` (sin saltos de layout); el JPG queda solo de respaldo para navegadores sin AVIF/WebP y como `og:image` del hero de cada landing. Las miniaturas de "Fotos de los asistentes" de `/organizadores` usan directo la variante más chica. Las fotos de los testimonios (`*_TESTIMONIAL` en `producerSocialProof.ts`, hoy todos `null`) son `LandingPhoto` con `sources` obligatorio: al cargar una cita real hay que generar sus variantes con `node scripts/landing-media.mjs <foto>.jpg`, y cada cita la sirve en un `<picture>` (el test unitario falla si un `<img>` con `….src` de una foto queda fuera de uno).
- **Video de portada:** `cover-standup.mp4` (H.264 con el índice al principio, *faststart*) + `cover-standup.webm` (VP9 + Opus, ~30% del peso). `LandingCoverVideo` ofrece primero el WebM; el póster es la foto de la misma escena (`aitk-hero-standup`, ya en AVIF/WebP) y el `<video>` reutiliza la versión que bajó el navegador.
- **Video del modal** (demo de `/organizadores` y stand-up, `public/videos/`): `aitickets-demo.mp4` (*faststart*) + `aitickets-demo.webm` (VP9) y póster `aitickets-demo-poster.webp`. `VideoModal` ofrece primero el WebM (`webmSrc`). El JPG del póster queda para los fixtures de los e2e del evento.
- **Regenerar:** `node scripts/landing-media.mjs` crea lo que falte (variantes de las fotos que ya las tienen, el WebM de cada MP4 de `public/landing` y `public/videos`, y el póster WebP de los de `public/videos`); `node scripts/landing-media.mjs aitk-nueva.jpg` suma una foto nueva y `--force` las vuelve a generar si cambió el original. Necesita `ffmpeg` instalado para el video.
- `aitk-musica-prueba-sonido.jpg` no se usa todavía (alternativa para el momento `D-45` de música, SPEC_landing_musica §8), pero ya tiene sus variantes AVIF/WebP (480/896) para cuando una página la use.

## Transversal (commit 13)

- **Enlaces:** las landings de nicho salen de `LANDINGS` (`src/data/landings.ts`): el hub de verticales de `/organizadores` ("Todo lo demás", fila de tipos de evento), el sitemap (`src/pages/sitemap.xml.ts`) y las relacionadas las leen de ahí; el footer (columna "Para quién") las lista todas. El header de `/organizadores` se queda con `Eventos · Precios · Ingresar` (spec §4).
- **SEO:** cada landing con title y description de `landings.ts`, canonical, Open Graph con la foto del hero (también stand-up) y JSON-LD `BreadcrumbList` + `SoftwareApplication` (oferta armada con las constantes de `fees.mjs`) + `FAQPage`; `/organizadores` con `Organization` + `SoftwareApplication` + `FAQPage`.
- **Analítica:** todo con `trackEvent` (GA4, `useGoogleAnalytics.js`). `/organizadores` con prefijo `lp_` (§11, `ProducerTracking.astro` y las islas), stand-up `su_` (también `su_video_progress` y `su_calc_change`, con el mismo `useCalcChangeTracking` de `lp_calc_change`), academias `ac_`, música `mu_`, teatro `te_`, talleres `tl_`, clubs `cl_`, fiestas `fi_` y seminarios `se_`. Evento (§14): el embudo de la página y el checkout con `trackFunnel` (event_id + ref/UTM), y al volver de Webpay `order_paid`, `order_failed` y `hold_expired` según el estado que muestra `payment-confirmation.astro` (`checkoutReturnFunnel` y `trackCheckoutReturn` en `checkoutApi.js`, una vez por orden y resultado).
- **Tests:** e2e por landing (`tests/e2e/<nicho>.spec.ts`), `marketing.spec.ts` (H1, canonical, sitemap), `landings-seo.spec.ts` (Open Graph, JSON-LD, hub y footer, fotos optimizadas y la analítica `lp_`: vista, secciones, CTA, WhatsApp, conectar IA, video y su avance, sonido de la portada, FAQ y demos) y `landings-analytics.spec.ts` (por landing de nicho: `<prefijo>_view`, `_section_view`, `_cta_click` del hero, `_faq_open` y un evento propio de una isla; en la página del evento: `event_view`, `checkout_open` y `checkout_qty_change`); unitarios de cada landing, `landing-assets.test.mjs` (que existan todas las variantes y los WebM, y que cada vertical esté enlazada) y `checkout-return-funnel.test.mjs` (el evento de la vuelta de Webpay en cada estado y sin repetirse al recargar).
