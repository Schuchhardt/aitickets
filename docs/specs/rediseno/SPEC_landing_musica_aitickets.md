# AI Tickets — Landing especializada para música en vivo

**Para:** Claude Code (implementación)
**Ruta:** `/ticketera-musica-en-vivo` (ya existe como landing genérica en `src/data/landings.ts`, generada por `[landing].astro`). **Se mantiene la URL**: la entrada de `landings.ts` pasa a `dedicated: true` y la página propia vive en `src/pages/ticketera-musica-en-vivo.astro`, igual que `/ticketera-stand-up`. La tarjeta, el sitemap, las relacionadas y "Según lo que produces" de `/organizadores` siguen leyendo de `landings.ts`.
**Público:** bandas y solistas que autogestionan sus fechas, productoras de conciertos y ciclos, y salas o venues de música en vivo (de la tocata de 80 personas en un bar a la sala de 1.000). Venden preventas por tandas, tipos de entrada con cupo, carteles con varias bandas y giras por varias ciudades.
**Promesa:** *Tú pon la música. La boletería corre por nuestra cuenta.* Preventa con cupo, un link por banda del cartel, la fecha en Instagram hasta el día del show, puerta con QR aunque no haya señal y lo de cada fecha disponible 48 h después.
**Métrica:** visitas → cuentas creadas → primer concierto publicado, comparada con `/organizadores` y con la landing genérica anterior (mismo slug, antes y después).
**Prototipo:** no hay artboard todavía. Esta spec define layout, copy y comportamiento; si después se dibuja un prototipo y difiere, manda este documento.
**Reutiliza** de `SPEC_landing_productores_aitickets.md`: fórmula de precio (§5.3), header sticky (§4), accesibilidad (§9), analítica base (§11). De la implementación de stand-up y academias (en el repo): `LandingFaq`, `LandingMobileBar`, `LandingMotion`, `CtaTracking`, `AppFooter tone="dark"`, `usePriceCalculator`, `priceQuote` (producerLanding.js), `SoonBadge`. **No reutiliza** su lenguaje visual: nada de serif cursiva, nada de radios grandes ni de franja marquee.

---

## 0. Antes de empezar (Claude Code)

1. **Tema propio** `[data-theme="musica"]` en `src/styles/landing-musica.css`, con scope, sin tocar los tokens globales. Debe verse distinto de stand-up (oscuro cálido + serif) y de academias (papel cálido + serif): ver §1.
2. **Dinero y plazos salen del código**, nunca escritos a mano: `SERVICE_FEE_PERCENT_LABEL`, `IVA_PERCENT_LABEL`, `computeFeeSplit` (netlify/lib/fees.mjs); `PAYOUT_RELEASE_HOURS`, `PAYOUT_BUSINESS_DAYS`, `PAYOUT_SCHEDULE_TEXT`, `PAYOUT_SHORT_TEXT` (netlify/lib/legal.mjs); `ABSORB_FEE_ACTIVATION` y `PRODUCER_FAQ` (src/data/producerFaq.ts); `DEFAULT_MAX_PER_PURCHASE` (Reservation/pricing.js). En esta spec los montos aparecen como `{…}` o con su valor actual solo para verificar.
3. **Cadencia de redes y anuncios salen del código:** `DEFAULT_CADENCE` y `DEFAULT_KEYWORD` (src/lib/socialSeriesCadence.ts, sin dependencias de servidor, ya la importa stand-up), `AD_LIMITS` (netlify/lib/zernio-ads.mjs: hoy 1 a 30 días). El tope de 60 funciones está en `producer-api/tools/schedule.ts` como `const MAX_FUNCTIONS` sin exportar: exportarlo (cambio aditivo, anotado) o seguir usando el texto de `PRODUCER_FAQ`.
4. **"Pronto"**: todo lo de §0.5 que no existe se muestra con `SoonBadge` (variante `dark` en fondos oscuros). Nunca se dibuja como si funcionara.
5. **Verificado en el código (se puede prometer):**
   - Tipos de entrada con precio y cupo; entradas para una función o para todas (`EditEventForm.vue`).
   - Varias fechas en un evento, cada una con su lugar (locations con dates en el formulario; hasta 60 funciones, `schedule.ts`). Gira de ejemplo: `/eventos/evento-demo-gira`.
   - Ventana de venta por tipo de entrada (`init_date`/`end_date`): la página muestra "Venta abre el …" y las entradas futuras atenuadas (`eventPage.ts`, `eventView.js`). **Hoy se configura desde el asistente de IA conectado** (`tools/tickets.ts`), no desde el formulario del panel: el copy lo dice igual que `ABSORB_FEE_ACTIVATION`.
   - "Avísame" / lista de espera: la página registra el correo cuando la venta no abre, se agota o se llena (`api/events/waitlist.ts`). **El aviso automático no existe** ("las notificaciones automáticas quedan fuera de alcance"): `Pronto`.
   - Códigos de descuento: % o monto fijo, usos máximos, límite por comprador, inicio y término (`netlify/lib/discounts.mjs`). Se aplican al subtotal de todo el evento (no a un tipo de entrada).
   - Máximo por compra por tipo de entrada (`DEFAULT_MAX_PER_PURCHASE`, se cambia desde el asistente de IA o por WhatsApp).
   - Links con seguimiento por canal o nombre propio (`TrackingLinkBuilder.vue`, `utm_*`); la venta se asocia al link si compra en la misma visita (`PRODUCER_FAQ`).
   - Métricas: visitas, conversión, ventas por canal, ciudades, horas (`eventAnalytics.ts`, `GeoTable.vue`). Reporte semanal por correo **los domingos** con ideas (`weekly-report-send.mjs`).
   - Serie automática en **Instagram**: historias cada `sparse_every_days` días, diarias desde D-`daily_from_days`, una el día del show; post diario de feed de D-7 a D-1; "Quedan N entradas" bajo `scarcity_threshold_pct`% disponible; DM con el link a quien responde la palabra `DEFAULT_KEYWORD` (`ORGANIZADORES_FAQ`, `socialSeriesCadence.ts`, `socialSeriesRender.ts`).
   - Anuncios en Instagram y Facebook vía Zernio con la cuenta publicitaria de Meta del productor: presupuesto diario, días (`AD_LIMITS`), Chile o una ciudad con radio, edad; ventas atribuidas a cada anuncio; Meta cobra el gasto directo (`zernio-ads.mjs`, `ORGANIZADORES_FAQ`).
   - Check-in con QR desde el celular, offline con sincronización, una entrada usada no vuelve a entrar, contador de validadas, búsqueda por nombre y reenvío (`ValidateQR.vue`, `/api/orders/resend`); rol Puerta (`permissions.ts`) o link de puerta sin cuenta que vence solo (`/puerta/<token>`, **hoy se crea desde el asistente de IA**, `tools/access.ts`).
   - Cortesías por correo con su propio QR, no cuentan como venta (`CourtesyTicketsForm.vue`, `orderKinds`).
   - Recordatorio por correo al comprador antes del show (`send-event-reminders`) y aviso si cambias fecha u horario (`PRODUCER_FAQ`).
   - Reseñas con fotos `REVIEW_REQUEST_DELAY_HOURS`–`REVIEW_REQUEST_WINDOW_HOURS` h después, código de premio, invitación masiva a los asistentes para tu próximo evento (`reviews.mjs`, `invitations.ts`), muro de asistentes.
   - Video de portada del evento (`eventVideo.ts`) y web gratis de la productora/banda/sala con su cartelera en `aitickets.cl/o/<slug>` y plantillas (`sites.ts`, `/web-gratis`).
   - Eventos de más de `LARGE_CAPACITY` (1.000) personas o masivos: piden documentos (autorización) y pueden tener retención de fondos según riesgo (`event-risk.mjs`). La landing **no** promete lo contrario.
6. **No existe (no prometer, o `Pronto` si se muestra):** aviso automático a la lista de espera; apertura automática de la siguiente tanda cuando se agota la anterior; apertura programada desde el formulario del panel (existe solo vía IA); Facebook, TikTok y reels en la serie automática; segmentar anuncios por gustos musicales; mapa de asientos numerados (**no se muestra como Pronto: se dice que no hay**, como en la landing actual); venta en efectivo en la puerta; line-up estructurado (bandas con horario) en la página del evento; dirección secreta revelada solo a compradores (la columna `secret_location` existe y se envía en el correo, pero el productor no puede cargarla desde el panel ni la API: ver Preguntas abiertas); que cada banda vea sus propias ventas con un acceso propio.
7. **Fotos:** las de `public/landing/` son de referencia generadas con IA. En producción van fotos reales de shows de productoras, bandas o salas que usen AI Tickets, con autorización escrita. Mientras no existan, se usan las de referencia con el mismo bloqueo de publicación que stand-up (anotarlo en el PR). Lista de fotos reales necesarias en §8.
8. **Testimonio:** solo una cita real (nombre, banda/productora/sala, ciudad, foto autorizada). Si no hay (`MUSIC_TESTIMONIAL = null` en `producerSocialProof.ts`), la sección no se renderiza.
9. **Nombres de ejemplo** (bandas, salas): ficticios, y cada card con datos dice `ejemplo`. Antes de publicar, buscar que no coincidan con bandas o salas chilenas reales; si coinciden, cambiarlos.
10. Las fases (§12) son commits dentro del PR único del rediseño (ver `README.md`).

---

## 1. Sistema visual propio: "afiche de gira"

La referencia es el afiche serigrafiado de tocata y el cartel de festival: tinta negra, un solo rojo de luz de sala, papel de afiche, tipografía condensada en mayúsculas, sellos de goma y talones de entrada perforados. Todo cuadrado y con grano. Es el opuesto formal de las otras dos landings:

| | Stand-up | Academias | **Música en vivo** |
|---|---|---|---|
| Fondo | negro cálido `#0E0B09` | papel cálido `#FBF7F0` | **negro escenario frío `#0A0A0D`** + bloques de papel de afiche gris `#EEE9DF` + un bloque rojo a sangre |
| Acento | lima + crema | tinta + café serif | **rojo de sala `#FF3B30`** (gráfica, tipografía grande, sellos); lima solo en acciones y confirmaciones |
| Titulares | Unbounded + Fraunces cursiva | Unbounded + Fraunces cursiva | **Anton condensada, mayúsculas**; énfasis con color rojo o letra calada (contorno), nunca cursiva |
| Metadatos | sans | sans | **monoespaciada del sistema** (fechas, horas, tandas, "D-7"), como un setlist |
| Radios | 18–28 px, botones pill | 24–32 px | **0 px** en fotos y bloques, **4–6 px** en cards y botones; talones con muescas de perforación |
| Fotos | color, cálidas, con overlay | color, sombra cálida | **duotono negro + rojo con grano** (oscuro) o **fotocopia en grises** (papel) |
| Ritmo | capítulos foto/texto alternados | comparador y pasos | **cortes duros**: negro → papel → negro → rojo a sangre → negro → papel; números de sección "01 —" en mono, como un setlist |
| Firma interactiva | mapa de sala que se llena | antes/después del chat | **curva de venta de un concierto** con cabezal que recorre los momentos + **tandas que se agotan con sello** |

```css
[data-theme="musica"] {
  --mu-stage: #0A0A0D;          /* fondo principal (negro escenario, frío) */
  --mu-stage-2: #141418;        /* secciones alternas, cards */
  --mu-stage-3: #1F1F26;        /* inputs, chips, filas */
  --mu-line: rgba(242, 240, 235, 0.12);
  --mu-text-1: #F2F0EB;
  --mu-text-2: #C8C5BE;
  --mu-text-3: #A19E97;         /* meta, eyebrows (≈ 7:1 sobre stage) */
  --mu-red: #FF3B30;            /* rojo de sala: gráfica, titulares, sellos (≈ 5,5:1 sobre stage) */
  --mu-red-deep: #5A0E0A;       /* sombra del duotono */
  --mu-red-ink: #A3120B;        /* rojo para texto sobre papel (AA) */
  --mu-paper: #EEE9DF;          /* papel de afiche */
  --mu-paper-2: #E2DCCF;        /* cinta adhesiva, controles sobre papel */
  --mu-ink: #111013;            /* texto sobre papel y sobre rojo */
  --mu-grain: url("data:image/svg+xml,…feTurbulence…");  /* grano, inline, < 1 KB */
  --brand-lime: (lima de marca);
  /* puente a los tokens que leen LandingFaq, LandingMobileBar, SoonBadge (como en academias) */
  --surface-0: var(--mu-stage); --surface-1: var(--mu-stage-2); --surface-2: var(--mu-stage-3);
  --text-1: var(--mu-text-1); --text-2: var(--mu-text-2); --text-3: var(--mu-text-3);
  --border: var(--mu-line);
}
```

**Reglas de color**
- **Rojo** (`--mu-red`): titulares grandes o su segunda línea, sellos (`AGOTADA`, `AGOTADO`), la curva de venta y su cabezal, barras del ecualizador, el bloque a sangre de §4.4, la barra de progreso de lectura. En texto, solo ≥ 18 px. Sobre papel se usa `--mu-red-ink`.
- **Lima**: botones primarios, "✓ Válida", "Publicado", el monto "Tú recibes". Nunca lima y rojo pegados en piezas chicas.
- El rojo de §4.4 (bloque a sangre) lleva texto `--mu-ink` (contraste ≈ 6:1) y botón tinta, no lima.

**Tipografía**
- **Anton 400** (Google Fonts / `@fontsource/anton`, solo `latin`, `font-display: swap`, ~25 KB). Fallback con métricas ajustadas: `"Anton", "Anton Fallback", Impact, "Arial Narrow", sans-serif` con `@font-face { font-family: "Anton Fallback"; src: local("Impact"); size-adjust: …; }` para que el swap no mueva el hero.
- Cuerpo: Prompt (la sans actual). Metadatos: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` con `font-variant-numeric: tabular-nums`, 13–14 px, tracking .06em, mayúsculas. Sin fuente mono descargada.
- **Letra calada** (énfasis alternativo al rojo): `color: transparent; -webkit-text-stroke: 1.5px var(--mu-text-1)` solo ≥ 56 px y con `@supports not (-webkit-text-stroke: 1px)` → color `--mu-text-1`. Nunca para información esencial pequeña.
- **Escala desktop:** H1 152/136 (segunda línea 84/84), H2 104/96, H3 44/44, cuerpo 18/29. **Mobile:** H1 64/58 (segunda línea 38/38), H2 52/50, H3 28/30, cuerpo 16/25. Anton en mayúsculas con tracking 0; nunca bajo 24 px.

**Recursos gráficos**
- **Duotono**: `<picture>` en un contenedor con `filter: grayscale(1) contrast(1.15)` y una capa encima `background: var(--mu-red); mix-blend-mode: multiply` + capa `--mu-red-deep` en `screen`/`lighten` para las sombras. Sin JS, sin procesar archivos. Sobre papel: solo `grayscale(1) contrast(1.25)` ("fotocopia").
- **Grano**: pseudo-elemento con `--mu-grain` al 7%, `pointer-events: none`, una sola capa por sección (no por foto).
- **Talón de entrada**: card con muescas semicirculares (`radial-gradient` en `mask`) y línea punteada vertical de perforación; el talón chico lleva el dato clave.
- **Sello de goma**: texto Anton en caja con borde doble, rotado −8° a −12°, `--mu-red`, con textura (máscara de grano) — `AGOTADA`, `AGOTADO`.
- **Ecualizador**: fila de 24–32 barras verticales finas (`scaleY`), en el borde inferior del hero y del cierre. Decorativo (`aria-hidden`).
- **Cinta adhesiva**: dos rectángulos `--mu-paper-2` al 80% rotados en las esquinas del afiche de §4.5.
- **Numeración de setlist**: cada H2 lleva antes `01 —`, `02 —`… en mono `--mu-text-3`.
- Iconos: los del sitio (lucide). Nada de logos de Instagram, Facebook, Spotify ni de bandas reales.

---

## 2. Estructura

| # | Sección | Fondo | Ancla |
|---|---|---|---|
| 1 | Hero afiche con foto duotono, talón de ejemplo y ecualizador | foto duotono | |
| 2 | Hecho para (cartel + selector "¿Quién eres?") | papel | `#para-quien` |
| 3 | La curva de un concierto (firma) | stage | `#como-se-vende` |
| 4 | Preventa por tandas | **rojo a sangre** | `#preventa` |
| 5 | El cartel, con un link por banda | stage-2 | |
| 6 | Una gira, un solo evento | stage | |
| 7 | La noche del show (puerta) | stage + foto | `#puerta` |
| 8 | Tu fecha en Instagram + anuncios | stage-2 | `#difusion` |
| 9 | Precio (talón calculadora) | papel | `#precio` |
| 10 | Testimonio de prensa (solo si es real) | stage | |
| 11 | Preguntas frecuentes | stage | |
| 12 | Cierre con foto duotono | foto duotono | |
| 13 | Footer (`AppFooter tone="dark"`) | stage | |

---

## 3. Header y progreso

- `MusicHeader.vue` (patrón de `StandupHeader.vue`): `position: fixed`, transparente sobre el hero; tras 40 px de scroll, `rgba(10,10,13,.86)` + `backdrop-filter: blur(14px)` + borde inferior `--mu-line`.
- Logo · links `Cómo se vende` (`#como-se-vende`) · `Puerta` (`#puerta`) · `Precio` (`#precio`) · `Ingresar` · botón lima `Publicar fecha` (radio 6, no pill).
- **Barra de progreso de lectura**: 2 px `--mu-red`, `transform: scaleX(progreso)` (reusar `ReadingProgress.vue` de stand-up con prop `color`; cambio aditivo).
- Mobile: logo + botón de menú cuadrado (44×44, radio 6). `LandingMobileBar variant="pill"` con `title="Gratis para publicar"`, `subtitle="0% de comisión para ti"`, `ctaLabel="Publicar fecha"`; aparece después del hero y se oculta en el cierre (comportamiento existente).

---

## 4. Secciones (copy es-CL completo)

### 4.1 Hero
- Altura `min(100svh, 920px)` desktop / 760 px mobile. Foto `aitk-musica-sala` (sala llena desde el fondo, luz roja), duotono + grano, `object-position: 50% 45%`. Overlay de legibilidad: gradiente de `--mu-stage` al 85% abajo-izquierda a transparente.
- Eyebrow mono: `PARA BANDAS, SOLISTAS, PRODUCTORAS Y SALAS`
- H1 (Anton): **TÚ PON LA MÚSICA.** / segunda línea en `--mu-red`, 84 px: **LA BOLETERÍA CORRE POR NUESTRA CUENTA.**
- Bajada (armada con constantes): *Preventa por tandas con su cupo, un link para cada banda del cartel, tu fecha en Instagram hasta el día del show y check-in con QR aunque la sala no tenga señal. Lo de cada fecha queda disponible `{PAYOUT_RELEASE_HOURS}` h después del show. 0% de comisión para ti.*
- CTAs: lima `Publicar mi próximo concierto →` (`landing.cta.label`, `publishUrl("musica_hero")`) · botón con borde `Ver un concierto de ejemplo` (`landing.demo.url` = `/eventos/evento-demo-concierto`).
- Microcopy mono bajo los CTAs: `SIN MENSUALIDAD · SIN PERMANENCIA · {SERVICE_FEE_NOTE} LO PAGA EL PÚBLICO` (de fees.mjs).
- **Talón de ejemplo** (derecha, 340 px, rotado −4°, papel `--mu-paper` con texto tinta; muescas y perforación):
  - Cabecera mono: `ENTRADA · EJEMPLO`
  - Anton 44: `NIEBLA NORTE` · Prompt: `Lanzamiento de "Ruta 5"`
  - Mono: `SÁB 14 DIC · 21:00 · SALA EJEMPLO, SANTIAGO`
  - Tres filas de tandas: `Preventa 1 · $8.000` con sello rojo **AGOTADA** encima · `Preventa 2 · $10.000 · Quedan 38` · `General · $12.000 · Desde el 1 dic` (atenuada, como en el checkout real).
  - Talón (columna derecha tras la perforación): patrón decorativo de cuadritos tipo QR **que no es un QR válido** (grilla fija, `aria-hidden`) y `N.º 0142`.
  - Precios de ejemplo sin cargo: debajo, en mono 11 px, `+ cargo por servicio {SERVICE_FEE_PERCENT_LABEL} + IVA`.
- **Ecualizador** en el borde inferior: 32 barras de 6 px, `--mu-red` al 70%, alturas de 8 a 64 px.
- Mobile: H1, bajada, CTAs apilados a ancho completo; el talón va debajo, sin rotación, con solo dos tandas (Preventa 1 agotada y Preventa 2).

### 4.2 Hecho para (fondo papel, ancla `#para-quien`)
- Numeración `01 —`; eyebrow mono `HECHO PARA`.
- **Cartel tipográfico** (Anton, tinta, jerarquía de afiche de festival, centrado): línea 1 120 px `BANDAS · SOLISTAS`; línea 2 80 px `PRODUCTORAS · SALAS`; línea 3 48 px `TOCATAS · CICLOS · LANZAMIENTOS · FESTIVALES · GIRAS`. En mobile: 48/36/22 px y la línea 3 hace salto natural.
- **Selector "¿Quién eres?"** debajo (segmented cuadrado, tinta sobre papel, indicador que se desliza): `Banda o solista` · `Productora` · `Sala o venue`. Al cambiar, la palabra correspondiente del cartel pasa a `--mu-red-ink` y cambian tres líneas (cada una con número mono `1`, `2`, `3`):

| Banda o solista | Productora | Sala o venue |
|---|---|---|
| **Vende tu lanzamiento sin depender de nadie.** Tu página de venta, tu cobro y tu puerta, aunque toques en un bar sin ticketera. | **Varias fechas y ciudades en un evento.** Hasta 60 fechas, cada una con su lugar, sus entradas y su cobro. | **Toda tu cartelera en tu propia web.** Una página gratis con tus próximas fechas en `aitickets.cl/o/tu-sala`, cada una vendiendo entradas. |
| **Un link para cada integrante.** Cada uno comparte el suyo y ves cuántas entradas movió. | **Un link por banda del cartel, medio o campaña.** Sabes quién llenó la sala antes de armar el próximo cartel. | **La puerta de cada noche, ordenada.** Tu equipo escanea con el celular, aunque el subterráneo no tenga señal. |
| **Tu web gratis con tus fechas.** Una página con tu cartelera en `aitickets.cl/o/tu-banda`, sin pagar hosting. | **Equipo con su rol.** Puerta, Marketing, Finanzas o Solo lectura: cada uno ve lo suyo. | **Cobras cada fecha por separado.** `{PAYOUT_SHORT_TEXT}`. |

- Default: `Banda o solista`. Teclado: flechas como `usePayerToggle` (radiogroup). Sin JS: se muestran las tres columnas apiladas.

### 4.3 La curva de un concierto (firma, ancla `#como-se-vende`)
- Numeración `02 —`; eyebrow mono `CÓMO SE VENDE UN CONCIERTO`; H2 **LA VENTA SE JUEGA** / en rojo **EN DOS MOMENTOS.**; bajada: *Las primeras horas de la preventa y la última semana. Entre medio, la venta se aplana. Así te acompaña AI Tickets en cada parte.*
- **Layout desktop:** grid `minmax(0,1.15fr) minmax(0,1fr)`. Izquierda **sticky** (`top: 96px`): gráfico SVG 640×380 (`MusicSalesCurve.vue`). Derecha: seis momentos que se recorren con scroll normal (sin scroll-jacking).
- **Gráfico** (ilustración, etiqueta `Curva de ejemplo` arriba a la derecha en mono): eje X `D-45 … D-7 … SHOW … +48 H`; eje Y "entradas por día" sin números. Curva en `--mu-red` (stroke 3) con relleno `--mu-red` al 12%: pico alto en D-45/D-44, meseta baja, segundo pico desde D-7 hasta el show. Cabezal: línea vertical `--mu-text-1` al 40% + punto rojo de 10 px con halo; se mueve al momento activo (`IntersectionObserver` con `rootMargin: "-45% 0px -45% 0px"`). Contador debajo: `Vendidas {n} de 400 · ejemplo`, que sube según el momento (0 → 160 → 210 → 330 → 400 → 400).
- **Seis momentos** (cada uno: mono rojo con día · H3 Anton · texto · chips de herramienta, `SoonBadge` donde corresponde):

| Día (mono) | H3 | Texto | Chips |
|---|---|---|---|
| `D-45 · ANUNCIO` | **PUBLICAS LA FECHA EN UNA TARDE.** | Creas los tipos de entrada con su precio y su cupo: Preventa 1, Preventa 2, General, VIP. Si la venta abre más adelante, la página muestra cuándo parte y junta los correos de quienes quieren enterarse. | `Tipos de entrada con cupo` · `Venta abre el …` · `Lista de "Avísame"` · `Aviso automático al abrir` + Pronto |
| `D-44 · PREVENTA` | **LA PRIMERA OLA SE AGOTA EN HORAS.** | Cuando se acaba la Preventa 1, aparece agotada y tu público ve la siguiente tanda con su precio. Los códigos de descuento tienen cupo, límite por persona y fecha de término. | `Tandas con cupo` · `Códigos con fecha límite` · `Siguiente tanda automática` + Pronto |
| `D-30 · LA MESETA` | **CUANDO LA VENTA SE APLANA, SABES POR QUÉ.** | En las métricas del evento ves visitas, conversión, ventas por canal, desde qué ciudades te visitan y a qué hora se compra. Cada domingo te llega un reporte con la semana y qué hacer en la próxima. | `Ventas por canal` · `Ciudades y horas` · `Reporte semanal` |
| `D-7 · ÚLTIMA SEMANA` | **LA SEGUNDA OLA.** | Las historias en tu Instagram pasan a ser diarias y se suma un post diario en el feed. Cuando queda menos del `{scarcity_threshold_pct}`% de las entradas, cada pieza dice cuántas quedan. Buen momento para un código de última semana. | `Historias diarias` · `Quedan N entradas` · `Código de última semana` |
| `SHOW · 20:30` | **LA PUERTA AVANZA SOLA.** | Tu equipo escanea los QR con su celular, aunque la sala no tenga señal. Las cortesías de prensa y de las bandas entran con su propio QR. | `QR sin señal` · `Cortesías` · `Rol Puerta` |
| `+{PAYOUT_RELEASE_HOURS} H · EL BIS` | **LA PLATA DE LA FECHA, Y LA PRÓXIMA.** | Lo de esta fecha queda disponible `{PAYOUT_RELEASE_HOURS}` h después del show; pides el retiro y llega en hasta `{PAYOUT_BUSINESS_DAYS}` días hábiles. Tu público recibe un correo para calificar y subir fotos, y con un clic lo invitas a tu próxima fecha. | `Cobro por fecha`* · `Reseñas con fotos` · `Invitar al próximo show` |

  \* Nota `*Se aplican términos y condiciones` (`TERMS_NOTE`) al pie de la sección.
- Los números de la tabla (`D-7`, porcentaje) salen de `DEFAULT_CADENCE` (`daily_from_days`, `scarcity_threshold_pct`); los de pago, de legal.mjs.
- **Mobile:** el gráfico va arriba (no sticky), 100% de ancho, alto 180 px, con seis marcadores numerados tocables sobre la curva. Debajo, los momentos como carrusel horizontal con `scroll-snap` (card 86% de ancho); la card visible mueve el cabezal y tocar un marcador desplaza el carrusel. Indicador `3 / 6` en mono.
- Accesibilidad: el SVG tiene `role="img"` y `aria-label="Curva de venta de ejemplo: un pico en la preventa, una meseta y un segundo pico la última semana antes del show"`. Los momentos son una lista ordenada (`<ol>`), legible sin JS.

### 4.4 Preventa por tandas (bloque rojo a sangre, ancla `#preventa`)
- Fondo `--mu-red`, texto `--mu-ink`, grano al 10%. Numeración `03 —` en tinta al 60%.
- H2 **PREVENTA QUE SE AGOTA** / letra calada en tinta **DE VERDAD.**
- Texto: *Cada tanda es un tipo de entrada con su precio y su cupo. Cuando se acaba, se ve agotada y queda la siguiente. ¿Cancha, platea y VIP? También son tipos de entrada, cada uno con su cupo. No hay mapa de asientos numerados.*
- **Demo de tandas** (`TierStack.vue`, derecha en desktop / debajo en mobile): tres talones apilados (papel, tinta) con barra de cupo:
  - `PREVENTA 1 · $8.000 · 100 entradas`
  - `PREVENTA 2 · $10.000 · 150 entradas`
  - `GENERAL · $12.000 · 250 entradas`
  - Al entrar en viewport, la barra de Preventa 1 se llena (1,2 s); al 100%, cae el sello **AGOTADA** (rojo sobre papel → aquí tinta sobre papel con borde doble) y empieza a llenarse Preventa 2 hasta 74%, queda `Quedan 38` en mono. General muestra `Desde el 1 dic` atenuada. Botón tinta pequeño `↻ Repetir` (vuelve a correr la demo). Etiqueta `ejemplo` arriba.
  - Debajo de los talones, una fila "Así lo ve tu público" con el checkout simplificado: Preventa 1 tachada `Agotada`, Preventa 2 con selector `− 2 +` y el precio con `{SERVICE_FEE_NOTE}`.
- **Lista de capacidades** (izquierda, debajo del texto; ítems con cuadrado tinta de 8 px):
  - **Tandas con cupo** — Preventa 1, 2 y General, o las que quieras, cada una con su precio.
  - **Hora de apertura** — La página muestra "Venta abre el …" y anota a quienes quieren enterarse. Hoy la hora se programa desde tu asistente de IA conectado o escribiéndonos por WhatsApp.
  - **Máximo por compra** — `{DEFAULT_MAX_PER_PURCHASE}` entradas por persona si no lo cambias, para que la preventa alcance para más gente.
  - **Códigos con fecha límite** — Por porcentaje o monto, con usos máximos, límite por comprador y fecha de término.
  - **Lista de espera cuando se agota** — Tu público deja su correo en la página del evento. `Aviso automático` + Pronto.
- Mobile: H2, texto, demo, lista. Sin rotaciones.

### 4.5 El cartel, con un link por banda (stage-2)
- Numeración `04 —`; eyebrow mono `LINKS CON SEGUIMIENTO`; H2 **CADA BANDA DEL CARTEL,** / en rojo **CON SU LINK.**
- Texto: *Creas un link para cada banda, para el medio que te entrevistó o para tu campaña, y cada uno lo comparte en sus redes. En las métricas del evento ves las órdenes, entradas e ingresos que trajo cada link, comparados con la venta directa. La venta se asocia al link cuando la persona compra en la misma visita en que llegó con él.*
- **Afiche** (`LineupPoster.vue`, izquierda, papel rotado −1°, cinta en dos esquinas, fotocopia de `aitk-musica` muy recortada arriba como franja de 120 px): mono `VIE 21 FEB · SALA EJEMPLO · SANTIAGO · EJEMPLO`; Anton jerárquico: `NIEBLA NORTE` (96 px) / `LOS TRASNOCHE · MARÍA PAZ RIVAS` (48 px) / `CIERRE: DJ KILÓMETRO 0` (28 px). Cada nombre es un botón.
- **Panel de links** (derecha, `--mu-stage-3`): `Ventas por link · ejemplo`. Filas con barra horizontal (texto-1; la seleccionada en rojo):
  - `Niebla Norte` 112 · `Los Trasnoche` 64 · `María Paz Rivas` 41 · `Radio ejemplo · entrevista` 23 · `Directo / sin seguimiento` 58 (usa `DIRECT_CHANNEL` de eventAnalytics.ts).
  - Al tocar un nombre en el afiche (o una fila), se resalta su fila y aparece su link en mono: `aitickets.cl/eventos/festival-ejemplo?utm_source=niebla-norte` con botón `Copiar` (copia el texto de ejemplo; toast `Es un ejemplo: crea los tuyos en el panel`).
- Nota bajo el panel: *¿La banda quiere saber cuánto vendió? Exporta las órdenes a CSV o comparte la tabla de ventas por canal.* (`standup` FAQ, real). Link `Guía: cómo medir ventas por promotor →` (`/guias/como-medir-ventas-por-promotor`).
- Mobile: afiche a ancho completo sin rotación, panel debajo; el link de ejemplo se corta con `overflow-wrap: anywhere`.

### 4.6 Una gira, un solo evento (stage)
- Numeración `05 —`; H2 **UNA GIRA,** / letra calada **UN SOLO EVENTO.**; texto a la derecha: *Hasta 60 fechas en un evento, cada una con su lugar y su ciudad. Entradas para una fecha específica o válidas para cualquiera. Si cambias un horario, avisamos por correo a quienes ya compraron. Y cada fecha se cobra por separado: no esperas a que termine la gira.*
- **Setlist de fechas** (`TourDates.astro` + script chico): tabla de filas a ancho completo, borde inferior `--mu-line`, columnas en mono salvo la ciudad (Anton 40 px):

| Fecha | Ciudad | Lugar | Estado |
|---|---|---|---|
| `VIE 07 MAR · 21:00` | VALPARAÍSO | Sala ejemplo | `Quedan 40` |
| `SÁB 08 MAR · 21:30` | SANTIAGO | Teatro ejemplo | sello **AGOTADO** |
| `VIE 14 MAR · 21:00` | CONCEPCIÓN | Bar ejemplo | `Preventa 2` |
| `SÁB 15 MAR · 22:00` | TEMUCO | Centro cultural ejemplo | `Venta abre el 20 feb` (atenuada) |

- Etiqueta `Gira de ejemplo` arriba. Hover desktop: la fila se invierte (fondo `--mu-red`, texto tinta) y aparece `Ver la gira de ejemplo →` a la derecha. Toda la tabla enlaza a `/eventos/evento-demo-gira`.
- Debajo, dos líneas con cuadrado rojo: **Duplica el evento** — *La próxima temporada copias descripción, imagen, lugares y entradas, y solo cambias las fechas.* · **Cobro por fecha** — `{PAYOUT_SCHEDULE_TEXT}*`.
- Mobile: cada fila pasa a bloque de dos líneas (ciudad Anton 28 px + mono fecha · lugar), estado a la derecha.
- Tabla real (`<table>` con `<caption class="sr-only">Gira de ejemplo</caption>`), no divs.

### 4.7 La noche del show (ancla `#puerta`)
- Numeración `06 —`. Desktop: grid `5fr 6fr`. Izquierda: foto `aitk-puerta-qr` 4:5 en duotono, radio 0, con **pulsera** encima (banda lima horizontal de 64 px que cruza la foto en diagonal −6°, como una pulsera de evento): `✓ VÁLIDA · PREVENTA 2 · ENTRADA 1 DE 2 · PUERTA 21:47` en mono tinta.
- Derecha: eyebrow mono `LA NOCHE DEL SHOW`; H2 **NADIE EN LA PUERTA** / en rojo **CON UNA LISTA DE PAPEL.**
- Cinco ítems (número mono rojo + título Prompt 600 + texto):
  1. **Escaneas con el celular, aunque no haya señal.** La lista se descarga antes y se sincroniza cuando vuelve la conexión. Una entrada usada no vuelve a entrar.
  2. **Ves cuántos han entrado.** El escáner cuenta las entradas validadas sobre el total, en vivo.
  3. **Prensa, bandas e invitados, con cortesía.** Les mandas su entrada sin costo por correo, con su propio QR. No cuenta como venta.
  4. **El equipo de puerta no necesita tu cuenta.** Le das el rol Puerta, o un link temporal que vence solo (lo creas desde tu asistente de IA).
  5. **¿Llegó sin la entrada en el celular?** Se busca por nombre en la lista y se le reenvía al correo.
- Link mono `Guía: check-in con QR →` (`/guias/como-hacer-check-in-con-qr`).
- Mobile: foto 4:5 a ancho completo (pulsera más corta), texto debajo.

### 4.8 Tu fecha en Instagram + anuncios (stage-2, ancla `#difusion`)
- Numeración `07 —`; eyebrow mono `DIFUSIÓN AUTOMÁTICA`; H2 **TU FECHA EN INSTAGRAM** / en rojo **HASTA EL DÍA DEL SHOW.**
- Bajada: *Conectas tu Instagram una vez y apruebas la serie con una vista previa de cada pieza. Con el afiche y los datos de tu evento armamos historias con cuenta regresiva y posts para el feed, y se publican solos. Si se agota, cambias la fecha o cancelas, la serie se ajusta o se detiene sola.* (consistente con `ORGANIZADORES_FAQ`).
- **Izquierda: historia de ejemplo** (`GigStoryMockup.astro`, 280×560, marco negro radio 32 — el único radio grande de la página, porque es un teléfono): fondo con `aitk-musica` en duotono; arriba 3 barras de progreso (la segunda se llena en 5 s, en loop mientras está visible); avatar cuadrado + `sala.ejemplo · programada 19:30`; Anton 72 `HOY` / `21:00`; sticker papel rotado −4° `Quedan 38 entradas`; sticker lima `Responde {DEFAULT_KEYWORD} y te llega el link`. Mockup genérico: sin interfaz ni logos de Instagram.
- **Derecha, card 1 · la serie en el tiempo** (`SeriesTimeline.vue`): línea horizontal de D-14 a SHOW con marcas calculadas con `DEFAULT_CADENCE` (no a mano): historias cada `sparse_every_days` días desde D-`sparse_start_days`, diarias desde D-`daily_from_days`, la del día del show a las `event_day_time`; posts de feed de D-`feed_posts_from_days` a D-`feed_posts_to_days`. Historias = barras rojas altas; posts = barras papel bajas (lectura de ecualizador). Leyenda mono: `{h} historias · {p} posts · hora: la de más visitas de tu evento, o {default_time}`. Chips de redes: `● Instagram` (borde lima) · `Facebook` + Pronto · `TikTok` + Pronto · `Reels` + Pronto.
- **Derecha, card 2 · anuncios** (papel, texto tinta): badge mono `QUEDAN 38 ENTRADAS · FALTAN 3 DÍAS`; H3 **¿NECESITAS UN EMPUJÓN?** / **IMPULSA CON ANUNCIOS.**; texto: *Lanza un anuncio en Instagram y Facebook desde tu panel, para Chile o para tu ciudad. Tú defines cuánto invertir por día y por cuántos días, y lo pausas cuando quieras. Meta cobra el gasto directo en tu cuenta publicitaria y ves cuántas entradas vendió cada anuncio.*
  - Mini formulario demo: slider `Presupuesto diario` ($3.000–$50.000, default $5.000), slider `Días` (`AD_LIMITS.minDays`–7 en la demo, la nota dice "hasta `{AD_LIMITS.maxDays}` días"), chips `Santiago · 25 km` · `18–45 años` · `Gustos musicales` + Pronto (deshabilitado). Botón tinta `Impulsar · {total} en total` → estado `✓ Anuncio activo · {días} días` + `Pausar`. **Sin alcance ni resultados estimados.** Reusar la lógica de `StandupAdsDemo.vue` con nueva piel (prop `theme` o componente nuevo que comparta un composable; decidir al implementar, sin duplicar la matemática).
- Mobile: historia (160 px de ancho) a la izquierda con la leyenda de la serie a la derecha; debajo la línea de tiempo a ancho completo con scroll horizontal; debajo la card de anuncios con un slider (`Días` fijo en 3).

### 4.9 Precio (fondo papel, ancla `#precio`)
- Numeración `08 —` en tinta al 50%; eyebrow mono `PRECIO`; H2 en tinta **TÚ COBRAS EL 100%** / en `--mu-red-ink` **DE TU ENTRADA.**
- Texto (armado como el `priceLead` de stand-up, con constantes): *Para ti, 0% de comisión. El comprador paga un cargo por servicio de `{SERVICE_FEE_PERCENT_LABEL}` más IVA (`{IVA_PERCENT_LABEL}`) sobre ese cargo. Si prefieres un precio final redondo, lo absorbes tú, por evento. `{ABSORB_FEE_ACTIVATION}` Las tocatas gratis no pagan nada.*
- Garantías en mono con separador `·`: `Sin mensualidad · Sin permanencia · {PAYOUT_SHORT_TEXT}`.
- **Talón calculadora** (`TicketCalculator.vue`, usa `priceQuote` + `usePayerToggle` + `useDelayedAnnouncement`): un talón grande blanco con perforación vertical.
  - Cuerpo (izquierda): mono `TU ENTRADA`; valor grande Anton 72 `{price}`; slider `Valor de la entrada` $2.000–$60.000, paso $500, default **$12.000**; segmented cuadrado `Paga el público` / `Lo absorbo yo`; desglose en mono: `Entrada`, `Cargo por servicio ({SERVICE_FEE_PERCENT_LABEL})`, `IVA del cargo ({IVA_PERCENT_LABEL})` (etiquetas `SERVICE_FEE_LABEL` / `SERVICE_FEE_TAX_LABEL`).
  - Talón (derecha): `TU PÚBLICO PAGA` + monto Anton 48 tinta; bloque lima `TÚ RECIBES` + monto Anton 56.
  - Verificación (computeFeeSplit): **$12.000 → público $13.142 / tú $12.000; absorbido → público $12.000 / tú $10.858.** $8.000 → $8.762 / $8.000; absorbido → $7.238.
  - Región `aria-live` con `useDelayedAnnouncement`.
- Debajo, fila chica: `TOCATA GRATIS` · *Inscripción con QR para cada persona. $0 para todos.*
- Nota: `*Se aplican términos y condiciones` → `/terminos-productores`.
- Mobile: talón vertical (perforación horizontal), segmented visible (a diferencia de academias, porque el absorber es frecuente en música con precio redondo).

### 4.10 Testimonio de prensa (solo si es real)
- Solo si `MUSIC_TESTIMONIAL` no es `null`. Formato "cita de prensa": comillas Anton rojas de 160 px, cita en Prompt 400 32/44 (24/34 mobile, sin cursiva), foto cuadrada 72 px en duotono, nombre (Prompt 600), `banda / productora / sala · ciudad` en mono.
- Si es `null`, no se renderiza nada (ni el contenedor).

### 4.11 Preguntas frecuentes
`src/data/musicaFaq.ts`, mismo patrón que `standupFaq.ts` (`pick` con error si falta). Orden:

| # | Fuente | Pregunta |
|---|---|---|
| 1 | `PRODUCER_FAQ` | ¿Cuánto cuesta usar AI Tickets? |
| 2 | `PRODUCER_FAQ` | ¿Cuándo recibo el dinero de mis ventas? (`terms`) |
| 3 | `PRODUCER_FAQ` | ¿Puedo absorber el cargo por servicio? |
| 4 | landings.ts (música, se conserva) | ¿Puedo vender entradas de distintas zonas o precios? — *Sí, con tipos de entrada distintos, cada uno con su precio y su cupo. AI Tickets no tiene mapa de asientos numerados.* |
| 5 | nueva | ¿Cómo armo una preventa por tandas? — *Creas un tipo de entrada por tanda (Preventa 1, Preventa 2, General) con su precio y su cupo. Cuando una se agota, aparece agotada y tu público ve la siguiente. Si quieres que una tanda abra en una fecha y hora exacta, hoy se programa desde tu asistente de IA conectado o escribiéndonos por WhatsApp.* |
| 6 | `PRODUCER_FAQ` | ¿Puedo publicar varias funciones de una misma obra o show? → reformulada en la UI como **¿Puedo publicar una gira o varias fechas?** con la misma respuesta + *Cada fecha puede tener su propio lugar.* (si se reformula, la `q` vive en musicaFaq.ts y la `a` se arma con la de PRODUCER_FAQ) |
| 7 | `PRODUCER_FAQ` | ¿Puedo saber cuántas entradas vende cada promotor? → en la UI **¿Puedo saber cuántas entradas vende cada banda del cartel?** (misma respuesta) |
| 8 | nueva | ¿Puedo tener una lista de invitados? — *Sí. Envías cortesías por correo desde el panel, para prensa, bandas o amigos, cada una con su QR. No cuentan como venta y se validan igual en la puerta.* |
| 9 | nueva | ¿Qué pasa cuando se agota? — *La entrada aparece agotada y tu público puede dejar su correo en la página del evento para enterarse. El aviso automático cuando vuelva a haber entradas todavía no está disponible.* (la lista de espera hoy solo se guarda: no hay vista en el panel ni en la API; ver Preguntas abiertas 5) |
| 10 | `ORGANIZADORES_FAQ` | ¿Cómo funciona la publicación automática en redes? |
| 11 | `ORGANIZADORES_FAQ` | ¿Tengo que pagar anuncios? |
| 12 | `ORGANIZADORES_FAQ` | ¿Puedo poner un video como portada del evento? (un clip del último show) |
| 13 | nueva | ¿Sirve para un concierto grande? — *Sí. Si el aforo pasa de `{LARGE_CAPACITY}` personas o es un evento masivo, te pedimos el permiso del lugar y una póliza de responsabilidad civil (y, si es masivo, la autorización de la Delegación Presidencial). Según el riesgo del evento, entre el `{RESERVE_BY_LEVEL.medium}`% y el `{RESERVE_BY_LEVEL.high}`% de lo vendido puede quedar como reserva hasta `{RESERVE_HOLD_DAYS}` días después del show.* `terms: true`. Sale del código: los documentos (`requiredDocumentKinds`) no condicionan la liberación en el ledger; lo que retiene es la reserva por riesgo (`large_capacity` suma 30 → nivel medio o más). Texto a validar con el dueño, ver Preguntas abiertas. |
| 14 | `ORGANIZADORES_FAQ` | ¿Cómo funcionan las reseñas? |
| 15 | `PRODUCER_FAQ` | ¿Qué pasa si tengo que cambiar o cancelar una función? (`terms`) |
| 16 | `PRODUCER_FAQ` | ¿Me ayudan a publicar mi primer evento? |

- Las FAQ de "¿Cómo cobro si hago varias fechas?" y "¿Hay costo por usar la plataforma?" que tiene hoy la entrada de landings.ts quedan cubiertas por 2 y 1 (se eliminan de `landings.ts` o se dejan y musicaFaq no las usa; decidir para no duplicar en el JSON-LD).
- Estilo: `LandingFaq` con los tokens puente; pregunta en Prompt 600, signo `+` en Anton rojo que rota 45° al abrir.

### 4.12 Cierre
- Foto a pantalla completa `aitk-musica` (manos al frente del escenario), duotono, `object-position: 50% 30%`, overlay radial `--mu-stage` al 70%. Ecualizador abajo (como el hero).
- H2 Anton 120 px (56 mobile): **LA PRÓXIMA FECHA** / en rojo **EMPIEZA CON UN LINK.**
- Bajada: *Publícala hoy. Crear tu cuenta es gratis y no hay costos fijos. Si quieres, la armamos contigo.*
- CTAs: lima `Publicar mi próximo concierto →` (`publishUrl("musica_closing")`) · borde `Hablar por WhatsApp` · link `Agenda una demo de 15 min` (mismos destinos que stand-up).

### 4.13 Footer
`AppFooter tone="dark"`. En "Para quién", el link `Música en vivo` ya apunta a esta URL (`AppFooter.vue`): no hay que cambiarlo.

---

## 5. Mobile

- Ancho base 390; gutter 20 px; secciones 72 px de padding vertical (desktop 140).
- Orden igual al desktop. Cambios: hero con talón debajo del CTA (dos tandas); cartel tipográfico reducido y selector a ancho completo con scroll horizontal si no cabe; curva no sticky con carrusel de momentos (§4.3); tandas debajo del texto; afiche del cartel sin rotación; gira en bloques; puerta con foto arriba; difusión compacta (§4.8); talón calculadora vertical.
- Objetivos táctiles ≥ 44×44. Nada de hover como única forma de ver información (el link del cartel y "Ver la gira" también se ven al tocar).
- `LandingMobileBar` en píldora oscura aparece después del hero y se oculta al llegar al cierre.

---

## 6. Animaciones (todas con `prefers-reduced-motion`)

Solo `transform`, `opacity` y `clip-path`. Con `prefers-reduced-motion: reduce` todo queda en su estado final, sin loops (el ecualizador queda estático con alturas fijas, la historia sin barra animada, la curva con el cabezal en el último momento visible, las tandas ya en su estado final con el sello puesto y sin botón `Repetir`). Usar `LandingMotion` (`data-lp-reveal` / `data-lp-step`) para los reveal genéricos.

| # | Elemento | Animación |
|---|---|---|
| M1 | Foto del hero | `scale 1.06→1` + el duotono entra de `opacity .6→1`, 1,8 s, una vez |
| M2 | H1 | Cada línea entra con `clip-path: inset(0 0 100% 0) → inset(0)` (efecto de impresión), stagger 140 ms |
| M3 | Bajada y CTAs | Fade + `translateY 16px`, delay 600–750 ms |
| M4 | Talón del hero | Entra a los 900 ms: `translateY 24px` + `rotate(-8deg → -4deg)`; el sello **AGOTADA** cae a los 1,5 s (`scale 1.6→1`, `opacity 0→1`, 220 ms, curva con rebote leve) |
| M5 | Ecualizador | Barras con `scaleY` en loop (cada barra con duración 0,9–1,6 s y desfase propio, `animation-play-state: paused` fuera de viewport) |
| M6 | Cartel "Hecho para" | Las líneas del cartel entran con stagger 100 ms; al cambiar de tab, la palabra activa cambia de color en 200 ms y las tres líneas hacen crossfade + `translateY ±8px` (240 ms) |
| M7 | Curva | La curva se dibuja con `stroke-dashoffset` (1,4 s) al entrar; el cabezal se desplaza entre momentos con `transform` 500 ms; el contador interpola |
| M8 | Momentos | Reveal al 25% (fade + `translateY 24px`); el chip del momento activo se resalta |
| M9 | Tandas | Barra de cupo `scaleX 0→1` (1,2 s), sello con el mismo pop de M4, segunda barra a 0,74 |
| M10 | Afiche del cartel | Entra con `rotate(-3deg → -1deg)` + fade; al seleccionar un nombre, su barra crece `scaleX` 400 ms |
| M11 | Gira | Sello **AGOTADO** con pop al entrar la fila; hover desktop: inversión de fila con `clip-path` de izquierda a derecha, 220 ms |
| M12 | Pulsera de la puerta | Se "pega" a la foto: `scaleX 0→1` desde la izquierda, 500 ms, al 40% de visibilidad |
| M13 | Historia de ejemplo | Barra de progreso de 5 s en loop solo mientras está visible |
| M14 | Serie en el tiempo | Barras con pop `scaleY` en stagger de 40 ms por día |
| M15 | Anuncios | Al impulsar: cambio de estado con pop del check |
| M16 | Calculadora | Montos interpolan en 250 ms (opcional) |
| M17 | Barra de lectura | `scaleX` según scroll |

---

## 7. Rendimiento

- **LCP = foto del hero** (`aitk-musica-sala`): AVIF/WebP a 640, 1024 y 1344 (sharp, como stand-up), `fetchpriority="high"`, sin `loading="lazy"`. La referencia mide 1024 px de ancho: el duotono y el grano disimulan, pero la foto real debe venir a 2400 px.
- El duotono es CSS (filtro + capas de mezcla) sobre el `<picture>`: no se generan archivos teñidos. Probar en Safari iOS que `mix-blend-mode` no se rompa dentro de contenedores con `transform`; si se rompe, fallback a `filter: grayscale(1) sepia(1) hue-rotate(-40deg) saturate(4)`.
- Anton: un solo archivo `latin` 400, `preload` solo en esta página, fallback con `size-adjust` (CLS < 0,05).
- Grano: un SVG inline de < 1 KB como `background-image`, una capa por sección.
- Ecualizador: 32 `div` con `transform`; `will-change` solo mientras está en viewport.
- Curva: un SVG con un `path`; nada de librerías de gráficos.
- Islas Vue con `client:visible` (curva, tandas, cartel, serie, anuncios, calculadora) y `client:idle` (header, barra mobile). La página debe funcionar y leerse completa sin JS.
- Resto de fotos `loading="lazy"`, `srcset` y `aspect-ratio` reservado. Lighthouse móvil ≥ 90 en performance y accesibilidad.

---

## 8. Fotos

**Se reutilizan** (todas en `public/landing/`; generar AVIF/WebP de las que aún no tienen):

| Uso | Archivo | Tratamiento | Variantes |
|---|---|---|---|
| Hero | `aitk-musica-sala.jpg` (3:2, 1024 px) | duotono + grano | 640/1024 (crear) |
| Cierre e historia de ejemplo | `aitk-musica.jpg` (4:5, 896 px) | duotono | 480/896 (crear) |
| Franja del afiche del cartel | `aitk-musica.jpg` (recorte) | fotocopia | (las mismas) |
| Puerta | `aitk-puerta-qr.jpg` (4:5) | duotono | ya existen |

`aitk-musica-prueba-sonido.jpg` queda disponible como alternativa para el momento `D-45` en una iteración con foto (hoy los momentos van sin foto, solo gráfico). No se generan imágenes nuevas.

**Fotos reales que harían falta** (con autorización escrita de la banda, la sala y, si se reconoce, del público):
1. Hero: sala llena desde el fondo con la banda iluminada, horizontal, ≥ 2400 px, con espacio oscuro abajo a la izquierda para el titular.
2. Cierre: primeras filas con manos arriba, vertical y horizontal (para mobile y desktop).
3. Puerta: staff escaneando un QR en la entrada de una sala de conciertos, con fila de público.
4. Franja del cartel: afiche real de una fecha vendida con AI Tickets (con permiso de la banda para mostrar el nombre) o, si no, la misma foto de público.
5. Testimonio: retrato de quien da la cita.
6. Opcional para `D-45`: prueba de sonido o carga de equipos en una sala real.

---

## 9. SEO

- **Title** (`landings.ts`): *Ticketera para conciertos y tocatas en Chile · 0% de comisión | AI Tickets*
- **Description:** *Vende entradas para tus conciertos, tocatas y giras: preventa por tandas con cupo, un link por banda del cartel, check-in con QR aunque no haya señal y cobro por fecha. 0% de comisión para bandas, productoras y salas.*
- **H1 visible sin JS** (el del hero). El `h1` de `landings.ts` se actualiza para que la tarjeta y las relacionadas no contradigan la página.
- **Palabras clave a cubrir en el texto, sin forzar** (búsquedas en Chile): ticketera para conciertos, vender entradas para tocatas, venta de entradas para bandas, plataforma para vender entradas de conciertos, preventa de entradas, entradas por tandas, ticketera independiente, ticketera para salas de concierto, entradas para gira, lista de invitados, entradas con QR, productora de conciertos, sala de conciertos Santiago, tocata en Valparaíso.
- **JSON-LD:** `BreadcrumbList` (AI Tickets → Para organizadores → Música en vivo), `SoftwareApplication` con `Offer` armada con constantes (como stand-up) y `FAQPage` con `MUSICA_FAQ`.
- Imagen OG: el hero (`image={MUSIC_PHOTOS.hero.src}` en `Layout`).
- Links internos: `/organizadores`, `/ticketera-stand-up`, `/ticketera-teatro`, `/ventas-por-promotor`, `/entradas-con-qr`, `/guias/como-hacer-una-preventa`, `/guias/como-medir-ventas-por-promotor`, `/guias/como-hacer-check-in-con-qr`, `/web-gratis`, `/eventos/evento-demo-concierto`, `/eventos/evento-demo-gira`.
- Alt de fotos descriptivos (no "imagen de…"): *Banda tocando con luces rojas frente a una sala llena*, *Público con las manos arriba frente al escenario*, *Persona del equipo escaneando el QR de una entrada en la puerta*.

---

## 10. Analítica

Prefijo `mu_`, mismo mecanismo que `StandupTracking.astro` / `AcademyTracking.astro` (atributos `data-mu-*` + `CtaTracking`):
- `mu_view`, `mu_cta_click {position}` (`hero`, `closing`, `header`, `mobile_bar`), `mu_demo_click {position}`, `mu_whatsapp_click`, `mu_faq_open {question}`, `mu_section_view {section}`.
- Propios: `mu_audience_tab {audience}` (`band`, `producer`, `venue`), `mu_curve_step {step}` (1–6, una vez por paso), `mu_tiers_replay`, `mu_lineup_select {band}`, `mu_link_copy`, `mu_tour_click`, `mu_ads_demo {budget, days}`, `mu_calc_change {price, payer}` (con debounce).

---

## 11. Componentes

Carpeta `src/components/landing/musica/`; datos y cálculos sin Node en `musicaLanding.js` (como `standupLanding.js`).

| Componente | Tipo | Notas |
|---|---|---|
| `MusicHeader.vue` | isla `client:idle` | patrón de `StandupHeader`, botón cuadrado |
| `MusicHero.astro` | estático + CSS | foto duotono, H1, talón `GigTicket.astro`, `EqBars.astro` |
| `GigTicket.astro` | estático | talón perforado reutilizable (hero, tandas, calculadora usa su CSS) |
| `RubberStamp.astro` | estático | sello `AGOTADA`/`AGOTADO` |
| `EqBars.astro` | estático + CSS | ecualizador decorativo, pausa fuera de viewport con un script mínimo |
| `DuotonePhoto.astro` | estático | `<picture>` + capas de duotono/fotocopia (prop `tone: "red" \| "copy"`) |
| `AudiencePoster.vue` | isla `client:visible` | cartel + selector "¿Quién eres?"; SSR muestra las tres columnas |
| `MusicSalesCurve.vue` | isla `client:visible` | SVG + momentos + carrusel mobile; datos en `musicaLanding.js` |
| `TierStack.vue` | isla `client:visible` | demo de tandas |
| `LineupPoster.vue` | isla `client:visible` | afiche + panel de links |
| `TourDates.astro` | estático + script chico | tabla de gira |
| `MusicDoor.astro` | estático | foto + pulsera + ítems |
| `GigStoryMockup.astro` | estático + CSS | historia de ejemplo |
| `SeriesTimeline.vue` | isla `client:visible` | marcas calculadas con `DEFAULT_CADENCE` (función pura en `musicaLanding.js`, testeable) |
| `MusicAdsDemo.vue` | isla `client:visible` | piel nueva sobre la lógica de `StandupAdsDemo` (sin duplicar la matemática) |
| `TicketCalculator.vue` | isla `client:visible` | `priceQuote` + `usePayerToggle` + `useDelayedAnnouncement` |
| `PressQuote.astro` | estático | no renderiza sin `MUSIC_TESTIMONIAL` |
| `MusicClosing.astro` | estático | |
| `MusicTracking.astro` | script | eventos `mu_*` |

Compartidos sin cambios: `LandingFaq`, `LandingMobileBar` (`variant="pill"` con textos), `LandingMotion`, `CtaTracking`, `AppFooter tone="dark"`, `SoonBadge`. Cambios aditivos posibles (anotar en el PR): `ReadingProgress` con prop `color`; exportar `MAX_FUNCTIONS` de `schedule.ts`; `MUSIC_TESTIMONIAL` en `producerSocialProof.ts`.

Datos: `landings.ts` (entrada `ticketera-musica-en-vivo` con `dedicated: true`, `sections: []` como academias, title/description/h1 de §9), `src/data/musicaFaq.ts`.

Tests (como stand-up y academias): unitario de `musicaLanding.js` (marcas de la serie a partir de `DEFAULT_CADENCE`, montos de la calculadora contra `computeFeeSplit`, orden de tandas) y e2e de la página (H1 visible sin JS, FAQ con JSON-LD, calculadora $12.000 → $13.142 / $12.000, `Pronto` presente en lo de §0.6 que se muestra, sin testimonio cuando es `null`, `prefers-reduced-motion` deja el sello puesto). Agregar la URL a `tests/e2e/marketing.spec.ts` si lista las landings.

---

## 12. Fases (commits dentro del PR único)

1. **Página y tema:** tema `musica`, Anton, duotono, hero (sin animación), "Hecho para" sin JS, momentos como lista, tandas estáticas, cartel, gira, puerta, difusión estática, precio, FAQ, cierre, footer; `landings.ts` con `dedicated: true`; fotos de referencia en AVIF/WebP. Criterio: `npm run check` sin errores; Lighthouse móvil ≥ 90.
2. **Interacción:** selector de audiencia, curva con cabezal y carrusel mobile, demo de tandas, links del cartel, serie con `DEFAULT_CADENCE`, demo de anuncios, calculadora.
3. **Movimiento:** M1–M17 y `prefers-reduced-motion`; analítica `mu_*`; tests.
4. **Contenido real:** fotos reales autorizadas (§8), testimonio, afiche real en el cartel, nombres de ejemplo revisados.

---

## 13. Preguntas abiertas

1. **Fotos reales:** ¿qué bandas, productoras o salas que usan AI Tickets pueden aportar fotos con autorización? (§8)
2. **Testimonio:** ¿quién da la primera cita (nombre, banda/productora/sala, ciudad, foto)?
3. **Dirección secreta para tocatas:** `events.secret_location` existe y llega en el correo de la entrada, pero el productor no puede cargarla desde el panel ni desde la API. ¿Se habilita? Si se habilita, sumar un formato "Tocata en lugar secreto" a §4.2 y una FAQ; mientras no, no se menciona.
4. **Apertura programada desde el panel:** la ventana de venta por tipo de entrada existe en la BD y en la API de IA pero no en `EditEventForm.vue`. ¿Se agrega al formulario? Si se agrega, quitar "hoy desde tu asistente de IA" del copy.
5. **Aviso a la lista de espera** y **apertura automática de la siguiente tanda:** van con `Pronto`. Además, los correos de `aitickets_event_waitlist` hoy no se ven en ningún lado (ni panel ni API): ¿se agrega al menos una exportación? ¿Están en el plan? Si no, ¿preferimos sacarlas en vez de mostrarlas como Pronto?
6. **Concierto grande (FAQ 13):** confirmar el texto sobre documentos y retención de fondos para aforo > `LARGE_CAPACITY` o eventos masivos (`event-risk.mjs`: `requires_documents`, `reserve_pct`), y si conviene mencionarlo en la landing o solo en los términos.
7. **Venta en puerta / efectivo:** no existe. ¿Es una objeción frecuente de salas? Si lo es, decidir si se responde en la FAQ ("se compra desde el celular en la página del evento mientras haya cupo") o se marca Pronto.
8. **Acceso de cada banda a sus ventas:** hoy se comparte con CSV. ¿Hay interés en un acceso de solo lectura por link? (no se promete).
9. **Line-up estructurado** (bandas con horario en la página del evento) y **embed de Spotify/YouTube:** no existen; ¿entran al roadmap? La landing no los muestra.
10. **Anton:** confirmar con el dueño la tipografía de acento (alternativas condensadas: Big Shoulders Display, Bebas Neue). Debe quedar distinta de Unbounded y de Fraunces.
11. **Nombres de ejemplo:** "Niebla Norte", "Los Trasnoche", "María Paz Rivas", "DJ Kilómetro 0", "Sala ejemplo": revisar que no existan en Chile antes de publicar.
12. **Otras landings de nicho** (clubs, fiestas, seminarios, teatro, talleres): esta spec fija el patrón "una identidad visual por nicho"; mantener una tabla comparativa como la de §1 para que ninguna repita paleta, tipografía de acento ni firma interactiva.
