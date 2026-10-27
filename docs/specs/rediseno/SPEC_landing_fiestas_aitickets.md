# AI Tickets — Landing especializada para fiestas y productoras de eventos

**Para:** Claude Code (implementación)
**Ruta:** `/ticketera-fiestas` (**nueva**). Sigue el patrón de las otras verticales (`/ticketera-teatro`, `/ticketera-talleres`) y cubre las búsquedas "ticketera para fiestas", "venta de entradas para fiestas" y "preventa fiesta". Igual que las otras landings dedicadas: entrada **nueva** en `src/data/landings.ts` con `dedicated: true` y página propia `src/pages/ticketera-fiestas.astro`; la tarjeta, el sitemap, las relacionadas y "Según lo que produces" de `/organizadores` leen de `landings.ts`. Sin redirecciones (Preguntas abiertas 1).
**Público:** productoras de fiestas y eventos temáticos que arman **una fiesta puntual o itinerante**: fiestas universitarias (mechonas, aniversarios, fiestas de carrera, organizadas por centros de estudiantes), fiestas temáticas (los 2000, reggaetón antiguo, Halloween, disfraces), fiestas en galpón o casona con un lugar distinto cada vez, Año Nuevo y fechas grandes, y marcas de fiesta que salen de gira por regiones. Su realidad: **preventas por etapas** (Preventa 1, 2, 3, General) que suben de precio, **promotores** que venden por su cuenta (veinte personas con su código o su link), **mucha difusión en Instagram** con el flyer y cuenta regresiva, compras en grupo, transferencias por WhatsApp con pantallazos, la dirección que se avisa a última hora, puerta con fila larga y sin señal en el galpón, y la plata que se cuadra el domingo.
**Frontera con otras landings:** el **local con noches que se repiten** todas las semanas (lista free, cover, mesas) va en `/ticketera-discotecas`; el **concierto con bandas en vivo** va en `/ticketera-musica-en-vivo`; las **charlas, seminarios y congresos** van en la landing de seminarios (en diseño). Esta página es para **la fiesta que se arma, se vende por etapas y pasa una vez** (o se repite de gira). Se enlazan entre sí.
**Promesa:** *Tú armas la fiesta. La preventa se vende por etapas.* Preventa por etapas con fecha de apertura, un código y un link para cada promotor, el flyer en Instagram toda la semana, la puerta con QR aunque no haya señal y lo de tu fiesta disponible `{PAYOUT_RELEASE_HOURS}` h después de que termina. 0% de comisión para la productora.
**Métrica:** visitas → cuentas creadas → primera fiesta publicada **con al menos dos etapas** (dos tipos de entrada pagados con `init_date` distinto) **o al menos un código de descuento o link de seguimiento**, comparada con `/organizadores`.
**Prototipo:** no hay artboard. Esta spec define layout, copy y comportamiento; si después se dibuja un prototipo y difiere, manda este documento.
**Reutiliza** de `SPEC_landing_productores_aitickets.md`: fórmula de precio (§5.3), header sticky (§4), accesibilidad (§9), analítica base (§11). De lo ya implementado en el repo: `LandingFaq`, `LandingMobileBar`, `LandingMotion`, `CtaTracking`, `AppFooter tone="dark"`, `SoonBadge`, `priceQuote` / `parseAmount` / `CALC_PRICE` (producerLanding.js), `usePayerToggle` y `useDelayedAnnouncement` (usePriceCalculator.js), `useAdsDemo`, la lógica de `WallDemo.vue`, `seriesMarks` (musicaLanding.js) y `formatSaleStart` (event/eventView.js). **No reutiliza** el lenguaje visual de ninguna otra landing (ver §1).

---

## 0. Antes de empezar (Claude Code)

1. **Tema propio** `[data-theme="fiestas"]` en `src/styles/landing-fiestas.css`, con scope y sin tocar los tokens globales; puente a `--surface-*`, `--text-*`, `--border` como música y clubs (para `LandingFaq`, `LandingMobileBar`, `SoonBadge`). Debe verse distinto de stand-up, academias, música, teatro, talleres y clubs (tabla de §1) y de seminarios cuando exista (Preguntas abiertas 15).
2. **Dinero y plazos salen del código**, nunca escritos a mano: `SERVICE_FEE_PERCENT_LABEL`, `IVA_PERCENT_LABEL`, `SERVICE_FEE_NOTE`, `SERVICE_FEE_LABEL`, `SERVICE_FEE_TAX_LABEL`, `computeFeeSplit` (netlify/lib/fees.mjs); `computeDiscountAmount`, `computeDiscountedTotals` (netlify/lib/discounts.mjs, sin dependencias de Node); `PAYOUT_RELEASE_HOURS`, `PAYOUT_BUSINESS_DAYS`, `PAYOUT_SCHEDULE_TEXT`, `PAYOUT_SHORT_TEXT` (netlify/lib/legal.mjs); `ABSORB_FEE_ACTIVATION`, `PRODUCER_FAQ`, `TERMS_NOTE`, `MAX_EVENT_FUNCTIONS` (src/data/producerFaq.ts); `DEFAULT_MAX_PER_PURCHASE` (Reservation/pricing.js); `CHECKIN_RELEASE_THRESHOLD`, `RESERVE_HOLD_DAYS` (src/lib/producer-api/ledger.ts); `LARGE_CAPACITY`, `RESERVE_BY_LEVEL` (netlify/lib/event-risk.mjs); `MAX_COURTESY_PER_REQUEST` (src/lib/courtesy.ts). En esta spec los montos van como `{…}` o con su valor actual solo para verificar.
3. **Redes, anuncios y comunidad salen del código:** `DEFAULT_CADENCE`, `DEFAULT_KEYWORD`, `stageOf` (src/lib/socialSeriesCadence.ts); los textos de cada pieza con `pieceText` (src/lib/socialSeriesRender.ts) **llamado en el frontmatter de Astro al construir** (el módulo es de servidor) y pasado por props; `AD_LIMITS` (netlify/lib/zernio-ads.mjs: 1 a 30 días, edad mínima por defecto 18, radios de ciudad 17/25/40/80 km); `REVIEW_REQUEST_DELAY_HOURS`, `REVIEW_REQUEST_WINDOW_HOURS`, `MAX_PHOTOS_PER_PERSON`, `INVITE_AUDIENCES`, `MAX_INVITATIONS_PER_ORG_PER_DAY`, `REWARD_LIMITS`, `RATING_LABELS` (netlify/lib/reviews.mjs); `FEED_EMOJIS`, `FEED_MESSAGE_MAX` (netlify/lib/attendee-community.mjs, por props como en `/organizadores`); `GALLERY_MAX_IMAGES` (src/lib/eventGallery.ts, por props); `EVENT_VIDEO_MAX_BYTES` (src/lib/eventVideo.ts); `MAX_REFERENCE_IMAGES` (src/lib/marketing.ts, por props); `DIRECT_CHANNEL` (src/lib/eventAnalytics.ts).
4. **Rótulos de la página del evento, tal cual:** `Agotada` (fila de entrada), `Disponible desde el {formatSaleStart(iso)}` (fila de una etapa que aún no abre, `CheckoutStepChoose.vue`), `Últimas entradas` (`cardLabel`, poco stock), `Venta abre el …` + cuenta regresiva `HH : MM : SS` las últimas 24 h + `Avisarme cuando abra` (`EventActionCard.vue`), `Agotado` (evento). Las fechas de ejemplo se formatean con `formatSaleStart` para que coincidan con lo que ve el público.
5. **"Pronto"**: todo lo de §0.7 que se muestre lleva `SoonBadge` (`dark` sobre fondos oscuros y cobalto). Nunca se dibuja como si funcionara.
6. **Verificado en el código (se puede prometer):**
   - **Preventa por etapas:** cada etapa es un tipo de entrada con precio, cupo, descripción y ventana de venta (`init_date`/`end_date`, `isTicketOnSale` en netlify/lib/tickets.mjs). Mientras una etapa está a la venta, las que abren después se ven atenuadas con `Disponible desde el …` y la agotada con `Agotada` (`unavailableTickets` en eventPage.ts, `CheckoutStepChoose.vue`). Si **nada** está a la venta todavía, la card muestra `Venta abre el …`, la cuenta regresiva las últimas 24 h y recarga sola al abrir. **La ventana se programa hoy desde el asistente de IA** (`tools/tickets.ts`: `sales_start`/`sales_end`), no desde el formulario del panel: el copy lo dice como `ABSORB_FEE_ACTIVATION`. Adelantar una etapa = cambiar su `sales_start` (mismo camino).
   - **Máximo por compra** por tipo de entrada (`DEFAULT_MAX_PER_PURCHASE` si no se cambia; se ajusta desde el asistente de IA).
   - **Códigos de descuento por promotor:** % o monto fijo (siempre > 0), usos máximos, límite por comprador, inicio y término; **de un evento o de toda la organización** (sirven para todas tus fiestas) (`discounts.mjs`, `/api/discount-codes`). En el panel (`DiscountCodesManager.vue`) cada código muestra `Usos N / máx`, compras, descuento otorgado y ventas (`aitickets_discount_code_stats`: ventas = subtotal ya descontado de las órdenes pagadas) y queda `Agotado` al llegar al máximo. El descuento se aplica al subtotal de toda la orden.
   - **Links por promotor:** links con seguimiento (`TrackingLinkBuilder.vue`, `ref`/`utm_*`); en las métricas, órdenes, entradas e ingresos por canal y visitas/conversión por canal (`eventAnalytics.ts`). La venta se asocia al link si compra en la misma visita (`PRODUCER_FAQ`). **CSV de órdenes** con columnas `Código de descuento` y `Canal` (`ordersExport.ts`) para liquidar a cada promotor.
   - **"Invitar a alguien":** en la página de la orden, botón que comparte `Voy a {evento}, ¿vamos?` con el link `?ref=invite`; esas compras quedan en su propio canal (`ref:invite`) (`src/pages/order/[id].astro`, `trackingChannel`).
   - **Cada amigo con su QR:** el correo trae cada entrada con su link "Ver QR" (`src/pages/ticket/[id].astro`: "para pasársela a un acompañante").
   - **Instagram automático:** historias cada `sparse_every_days` días desde D-`sparse_start_days`, diarias desde D-`daily_from_days`, una el día; post diario de D-`feed_posts_from_days` a D-`feed_posts_to_days`; `Quedan N entradas` bajo `scarcity_threshold_pct`% en la última semana; DM con el link a quien responde `DEFAULT_KEYWORD`; si se agota, la serie se ajusta (`ORGANIZADORES_FAQ`, `pieceText` con variante `sold_out`: `Agotado` / `Entradas agotadas.`).
   - **Piezas con IA en el panel** (Promocionar → `CreateSocialPost.vue`, `/api/promote/generate`): texto con tono y una imagen a partir de los datos del evento, con hasta `MAX_REFERENCE_IMAGES` imágenes de referencia (por ejemplo, el flyer de la edición anterior). La imagen sale sin texto salvo que se pida (`generateEventImage`).
   - **Anuncios** en Instagram y Facebook con la cuenta publicitaria de Meta de la productora: presupuesto diario, días (`AD_LIMITS`), Chile o ciudad con radio, edad (desde `AD_LIMITS.defaultAgeMin`); ventas atribuidas a cada anuncio; Meta cobra el gasto directo.
   - **Página del evento:** el flyer se muestra en su proporción real y la página toma su color (`eventCoverMeta.ts`, `eventTint.js`); video de portada MP4/MOV/WebM de hasta `EVENT_VIDEO_MAX_BYTES` (`ORGANIZADORES_FAQ`); **galería** al final de la página con hasta `GALLERY_MAX_IMAGES` fotos y un video (`eventGallery.ts`, se carga desde el panel: sirve para las fotos de la edición anterior); asistente que responde dudas de los compradores con la información cargada.
   - **"Quiénes van":** muro de asistentes (emoji de `FEED_EMOJIS` + mensaje de hasta `FEED_MESSAGE_MAX` caracteres) que ven **solo quienes tienen entrada**, en la página de su orden o de su entrada; la productora lo modera; después del evento se titula "Así lo vivieron" (`attendee-community.mjs`, `AttendeeFeed.vue`). La card del evento enlaza "Ver quiénes van →" a quien ya compró.
   - **Mensajes a los asistentes:** correo a quienes compraron, ahora o programado (`send_attendee_message`, `schedule_reminder` en `tools/messaging.ts`), **desde el asistente de IA**. Sirve para avisar la dirección exacta el mismo día.
   - **Varias fechas o ciudades:** hasta `{MAX_EVENT_FUNCTIONS}` funciones por evento, cada una con su lugar y su hora de término aunque cruce la medianoche (`schedule.ts`); entradas por función. **Duplicar evento** (`eventDuplicate.ts`): copia descripción, imagen, lugar, tipos de entrada (las etapas) y preguntas frecuentes.
   - **Puerta:** escáner en el celular, offline con sincronización (`ValidateQR.vue`: "✅ Entrada validada con éxito para {nombre} (pendiente de sincronizar)"), una entrada usada no vuelve a entrar ("❌ Este ticket ya fue validado") **en ese celular sin señal y en todos con señal** (ver Preguntas abiertas 8), muestra nombre y tipo de entrada, contador `N / M entradas validadas`, búsqueda por nombre y reenvío al correo (`/api/orders/resend`); rol Puerta (`permissions.ts`) o link de escáner sin cuenta que vence solo (`/puerta/<token>`, **hoy se crea desde el asistente de IA**, `tools/access.ts`). Varios celulares pueden escanear a la vez.
   - **Cortesías** con su propio QR por correo desde el panel (`CourtesyTicketsForm.vue`, hasta `MAX_COURTESY_PER_REQUEST` por envío), no cuentan como venta. **Transferir una entrada** a otra persona con QR nuevo: desde el asistente de IA (`transfer_ticket`).
   - **Aforo y llegadas** por tipo de entrada: desde el asistente de IA (`get_checkin_stats`).
   - **Cobro:** el ledger libera cada orden `{PAYOUT_RELEASE_HOURS}` h después del **término** de su función, entendiendo el cruce de medianoche (`ledger.ts`). Condiciones (términos §8): identidad aprobada, cuenta bancaria verificada, check-ins ≥ `CHECKIN_RELEASE_THRESHOLD` de las entradas pagadas **o** acreditar que se realizó, sin reclamos abiertos; **reserva por riesgo** (`event-risk.mjs`): productora nueva, lugar sin dirección exacta, aforo > `LARGE_CAPACITY` o masivo, ritmo de ventas anómalo, muchos compradores con un mismo teléfono; nivel medio retiene `RESERVE_BY_LEVEL.medium`% y alto `RESERVE_BY_LEVEL.high`% hasta `RESERVE_HOLD_DAYS` días. Todo lo de plazos lleva `*` con `TERMS_NOTE`.
   - **Después:** reseñas con fotos (hasta `MAX_PHOTOS_PER_PERSON`) entre `REVIEW_REQUEST_DELAY_HOURS` y `REVIEW_REQUEST_WINDOW_HOURS` h, código de premio (`REWARD_LIMITS`); invitar a la próxima fiesta a `INVITE_AUDIENCES` (todos, solo quienes ingresaron, solo quienes calificaron, solo 4 o 5 estrellas), máx. `MAX_INVITATIONS_PER_ORG_PER_DAY` envíos al día; reporte semanal los domingos (`weekly-report-send.mjs`).
   - **Web gratis** de la productora con su cartelera (`/web-gratis`, `sites.ts`, plantilla `nocturno` o `clasico` con sus colores).
   - **Eventos grandes o masivos:** aforo > `LARGE_CAPACITY` o masivo piden documentos (permiso, póliza y, si es masivo, la autorización de la Delegación Presidencial; Ley 21.659 en `eventPage.ts`).
7. **No existe (no prometer, o `Pronto` si se muestra):**
   - **Abrir la siguiente etapa sola cuando se agota la anterior** → `Pronto` en §4.3. Hoy cada etapa abre en su fecha y hora, y si una se agota antes, se adelanta la siguiente desde el asistente de IA o por WhatsApp.
   - **Programar las etapas desde el formulario del panel:** no existe; se dice como `ABSORB_FEE_ACTIVATION` ("hoy desde tu asistente de IA conectado o escribiéndonos por WhatsApp"). Sin `Pronto` (Preguntas abiertas 3).
   - **Aviso automático a quienes dejaron su correo** en "Avisarme cuando abra" (hoy solo se guarda, `api/events/waitlist.ts`) → `Pronto` en §4.3.
   - **Dirección secreta cargada por la productora:** la columna `secret_location` existe, la página la oculta ("Ubicación aproximada", "La ubicación exacta aparece en tu entrada") y el correo la incluye, pero **no se puede cargar desde el panel ni la API** → `Pronto` en §4.6. Hoy: publicar la comuna y avisar la dirección con un mensaje programado.
   - **Acceso propio de cada promotor** a sus números → `Pronto` en §4.4 (igual que clubs).
   - **Comisión o premio automático al promotor** (liquidación, "el que vende 30 entra gratis"): no existe; se exporta el CSV. No se muestra como Pronto.
   - **Código solo para medir, sin descuento:** no existe (valor > 0). Para medir sin descuento, el link. No se muestra.
   - **Promos por cantidad** (4x3, pack de grupo): los códigos descuentan sobre el subtotal, no por cantidad. No se muestra (Preguntas abiertas 11).
   - **Verificar que el comprador es alumno, su edad o su RUT:** no hay preguntas en el checkout. Se dice en la FAQ; la puerta ve el tipo de entrada y pide la credencial. Sin `Pronto`.
   - **Venta en la puerta (efectivo o máquina):** no existe. Sin `Pronto`.
   - **Muro "Quiénes van" público** para quien todavía no compra: no; lo ven solo quienes tienen entrada. No se dibuja como público.
   - **Vista de aforo en vivo en el panel** (hoy por IA y el contador del escáner) → `Pronto` en §4.7.
   - Facebook, TikTok y reels en la serie automática → `Pronto`. Segmentar anuncios por gustos ("reggaetón", "música electrónica") → `Pronto`.
   - Plano del lugar o zonas para elegir: no hay. No se muestra.
8. **Fotos:** las de `public/landing/aitk-fiesta-*.jpg` son de referencia generadas con IA (fotos-nicho.md). En producción van fotos reales de fiestas de productoras que usen AI Tickets, con autorización escrita de la productora y, si se reconocen, de las personas. Mientras no existan, se usan las de referencia con el mismo bloqueo de publicación que stand-up (anotarlo en el PR). Lista de fotos reales necesarias en §8. **No se generan imágenes nuevas.**
9. **Testimonio:** solo una cita real (nombre, productora o centro de estudiantes, ciudad, foto autorizada). Si no hay (`PARTY_TESTIMONIAL = null` en `producerSocialProof.ts`, cambio aditivo), la sección no se renderiza.
10. **Nombres de ejemplo** (fiesta, productora, promotores, cuenta de Instagram): ficticios, y cada card con datos dice `ejemplo`. **Nunca nombres de universidades reales** (la fiesta universitaria de ejemplo es de "una carrera", sin casa de estudios). Antes de publicar, revisar que "Fiesta Disquete" y los demás no coincidan con fiestas, productoras o personas reales de Chile.
11. **Alcohol y edad:** la foto universitaria muestra un vaso rojo. El copy no menciona alcohol ni marcas; las piezas de anuncios de ejemplo no muestran alcohol; los anuncios de ejemplo apuntan a mayores de `{AD_LIMITS.defaultAgeMin}`. Revisar con el dueño la Ley 21.363 antes de usar esa foto en anuncios pagados (Preguntas abiertas 12).
12. Las fases (§12) son commits dentro del PR único del rediseño (ver `README.md`): agregar `rediseno(fiestas): landing especializada` a la lista de commits del README y la fila de la spec a su tabla.

---

## 1. Sistema visual propio: "pulsera, sticker y desechable"

La referencia es **todo lo que queda de una fiesta en el bolsillo y en el celular**: la **pulsera de Tyvek** de color que se cierra con su pestaña numerada (una por etapa: amarilla la Preventa 1, naranja la 2, azul la 3), los **stickers troquelados** con borde blanco que se pegan en el flyer y en el celular, las fotos de **cámara desechable** con flash duro y la **fecha estampada en naranjo** en la esquina, el **confeti** del final. Es la única landing **a todo color**: los fondos son bloques planos de color de pulsera (naranja, azul cobalto, crema), y la noche oscura aparece **una sola vez**, en la puerta. Composición **suelta y en capas**: cosas pegadas encima de otras, levemente giradas, nunca alineadas al milímetro. La página se ordena como **la vida de una fiesta**, de la idea al día después: cada sección se abre con **su pulsera** (`LA IDEA`, `PREVENTA`, `LOS PROMOS`, `LA ÚLTIMA SEMANA`, `QUIÉNES VAN`, `SÁB 23:00`, `LA CAJA`, `EL DÍA DESPUÉS`).

| | Stand-up | Academias | Música en vivo | Teatro | Talleres | Clubs | **Fiestas** |
|---|---|---|---|---|---|---|---|
| Fondo | negro cálido | papel cálido | negro frío + papel de afiche + rojo a sangre | azul noche + terciopelo + marfil | papel de cuaderno con cuadrícula | negro violáceo + halos + blanco servicio | **bloques planos de color de pulsera**: naranja `#FF5B14`, azul cobalto `#2B36FF` y crema sticker `#FFF4E4`; **un solo** bloque oscuro (`#120F14`, la noche de la puerta) |
| Acento | lima + crema | tinta + café | rojo de sala | dorado de palco | azul lápiz + destacador | rosa fluor + violeta UV | **los tres colores de pulsera se turnan** (cada uno es fondo de una sección y acento de las otras) + **amarillo confeti `#FFE14D`** solo sobre cobalto y noche; lima solo en "✓ Válida" y "Tú recibes" |
| Titulares | Unbounded + Fraunces cursiva | Unbounded + Fraunces cursiva | Anton mayúsculas | Bodoni Moda | Bricolage Grotesque | Doto (LED) | **Bagel Fat One** (redonda, gorda, "inflada"), caja baja y alta; énfasis = **la frase va dentro de un sticker troquelado** (crema, contorno tinta de 3 px, sombra dura, girado −3°), nunca cursiva, color solo ni subrayado |
| Metadatos | sans | sans | mono (setlist) | Prompt espaciada | Caveat manuscrita | horas en Doto | **impresos en la pulsera**: Prompt 700 en mayúsculas, tracking .12em, repetido a lo largo de la banda (`PREVENTA 1 · AI TICKETS · PREVENTA 1 ·`), con la pestaña y su **N° de serie** |
| Formas | radios 18–28, pill | radios 24–32 | 0 px, talones | arco de proscenio | fichas, cartón | cápsulas, LED | **pulseras** (bandas de 28–40 px con extremos redondeados y pestaña cuadrada), **stickers troquelados** (cualquier forma: círculo, estrella, pastilla, corazón, ticket; borde blanco 6 px + contorno tinta 2 px), cards 20 px; botones "sticker" (pastilla 999 px, contorno tinta 2 px, sombra dura `0 4px 0`) |
| Fotos | color cálido | color con sombra | duotono + grano | viñeta de foco | color natural impreso | color de club + fuga de luz | **desechable**: borde blanco grueso como copia, giro ±2–4°, `contrast(1.08) saturate(1.12)`, **viñeta de flash** (centro más claro) y **fecha estampada** naranja abajo a la derecha (`'26 11 28`) |
| Ritmo | capítulos alternados | comparador y pasos | cortes duros "01 —" | actos centrados | separadores con pestaña | hora a hora | **la vida de una fiesta**: cada sección abre con **su pulsera** cruzando el borde superior, girada −2°, que **se cierra** al entrar; el color de fondo cambia de golpe entre secciones (sin degradados) |
| Firma interactiva | mapa de sala | antes/después del chat | curva de venta + tandas con sello | cartelera + fader | arma tu taller + pasar lista | noche en vivo (crossfader) + linterna UV | **"La escalera"**: armas tus etapas (cuántas, precio y cupo) y **juegas la preventa**: cuando una etapa se agota antes de tiempo, la página te pregunta *"¿Abrimos la 2?"* y tú decides; la pulsera agotada **se corta con tijera** y cae confeti + **plancha de stickers de promotores** que se despegan |

```css
[data-theme="fiestas"] {
  --fi-naranja: #FF5B14;        /* pulsera naranja: hero, difusión, cierre. Texto encima: solo tinta (6:1) */
  --fi-naranja-ink: #B83A00;    /* naranja para texto sobre crema (5,3:1) */
  --fi-cobalto: #2B36FF;        /* pulsera azul: la escalera, el día después. Texto encima: crema (6,3:1) o amarillo (5,3:1) */
  --fi-cobalto-2: #1F28C9;      /* cards y controles sobre cobalto (crema encima: 8,8:1) */
  --fi-crema: #FFF4E4;          /* papel de sticker: fondo claro y relleno de stickers */
  --fi-crema-2: #F5E6CF;        /* secciones claras alternas, controles sobre crema */
  --fi-tinta: #16110D;          /* texto principal y contornos (17:1 sobre crema) */
  --fi-text-2: #4A3F35;         /* texto secundario sobre crema (9,4:1) */
  --fi-text-3: #6B5E51;         /* meta sobre crema (5,8:1) */
  --fi-ink-on-naranja: #2A1F17; /* meta sobre naranja (5,2:1) */
  --fi-amarillo: #FFE14D;       /* confeti, pulsera de la Preventa 1, cifras sobre cobalto y noche. Nunca texto sobre crema */
  --fi-noche: #120F14;          /* la noche de la puerta (única sección oscura) */
  --fi-noche-2: #1D1920;        /* cards sobre noche */
  --fi-text-night-2: #D9CFC3;   /* (12:1 sobre noche) */
  --fi-text-night-3: #A99E92;   /* meta sobre noche (7,2:1) */
  --fi-stamp: #FF8A2A;          /* fecha estampada de desechable (decorativa, aria-hidden) */
  --brand-lime: (lima de marca);
  /* puente a los tokens que leen LandingFaq, LandingMobileBar, SoonBadge (como en música y clubs) */
  --surface-0: var(--fi-crema); --surface-1: var(--fi-crema-2); --surface-2: #FFFFFF;
  --text-1: var(--fi-tinta); --text-2: var(--fi-text-2); --text-3: var(--fi-text-3);
  --border: rgba(22, 17, 13, 0.14);
}
/* En las secciones oscuras/cobalto se redefinen localmente --surface-*, --text-* y --border (clase .fi-on-dark) */
```

**Reglas de color**
- **Naranja**: fondo del hero, la difusión y el cierre; como acento sobre crema, solo `--fi-naranja-ink` en texto y `--fi-naranja` en piezas gráficas (pulseras, stickers, barras). Nunca texto crema sobre naranja (2,9:1).
- **Cobalto**: fondo de la escalera y del día después; como acento sobre crema, texto y cifras (6,3:1). Sobre cobalto el texto es crema y las cifras grandes amarillas.
- **Amarillo confeti**: confeti, pulsera de la Preventa 1, `Quedan N` y cifras grandes sobre cobalto y noche. Nunca sobre crema ni naranja (sin contraste).
- **Lima** (marca): solo "✓ Válida" en el escáner y el bloque `TÚ RECIBES`. Los CTA son **botones sticker** (ver abajo), no lima: en esta paleta el lima pelea con el naranja.
- **Una pulsera nunca va sobre un fondo de su mismo color** (la de la sección toma el color siguiente de la secuencia).

**Tipografía**
- **Bagel Fat One 400** (`@fontsource/bagel-fat-one`, subsets `latin` y `latin-ext`; usar solo `latin`, que trae Á É Í Ó Ú Ñ ¿ ¡; **verificar** en el build y, si falta un glifo, pedir `latin-ext`). La flecha → no viene: va en Prompt. `font-display: swap`; fallback con métricas ajustadas `"Bagel Fat One", "Bagel Fallback", "Arial Black", system-ui, sans-serif` con `@font-face { font-family: "Bagel Fallback"; src: local("Arial Black"); size-adjust: …; ascent-override: …; }`.
- Bagel solo en titulares, cifras grandes y códigos de promotor, **nunca bajo 24 px** ni en párrafos.
- Cuerpo y meta: Prompt (la sans actual). Meta de pulsera: Prompt 700, 12 px, mayúsculas, tracking .12em, `tabular-nums`.
- **Escala desktop:** H1 112/104, H2 64/66, H3 30/34 (Prompt 700, no Bagel), cuerpo 18/29, cifras grandes 56–96. **Mobile:** H1 52/52, H2 36/40, H3 22/26, cuerpo 16/25.

**Recursos gráficos**
- **Pulsera** (`Wristband.astro`): banda de 32 px de alto (28 en mobile) con extremos redondeados, color de pulsera, textura de fibras de Tyvek muy sutil (SVG `feTurbulence` en `<pattern>` precalculado como `data:` de < 2 KB, opacidad 6%), texto Prompt 700 repetido a lo largo (`aria-hidden`; el texto real de la sección está en el eyebrow) y **pestaña** cuadrada de 40×40 en un extremo con `N° 000{n}` (como la numeración de una pulsera real). Props: `color`, `label`, `serial`, `cut` (agotada: dos mitades separadas por un corte en zigzag), `tilt` (−2° por defecto). Como **separador de sección** cruza el borde superior de la sección a sangre, girada −2°, la mitad sobre la sección anterior.
- **Sticker troquelado** (`Sticker.astro`): cualquier contenido dentro de un recorte con borde blanco 6 px + contorno tinta 2 px y sombra dura `4px 4px 0 var(--fi-tinta)` al 100% (sin blur). Formas: `pill`, `circle`, `burst` (estrella de 12 puntas, `clip-path: polygon`), `heart`, `ticket` (con muescas). Giro por prop (−4° a 4°).
- **Titular con sticker** (`StickerHeading.astro`): H1/H2 en Bagel; la parte enfatizada (prop `sticker`) va en un sticker `pill` crema con contorno tinta, girado −3°, que puede saltar de línea como bloque. El texto completo es un solo `<h1>`/`<h2>` (el sticker es un `<span>`), legible sin CSS.
- **Foto desechable** (`DisposablePhoto.astro`): `<picture>` con marco blanco de 12 px (16 en desktop) y 40 px abajo (como copia), radio 6 px, giro por prop, sombra suave `0 18px 40px rgba(22,17,13,.22)`, **viñeta de flash** (`radial-gradient` blanco al 14% en el centro, `mix-blend-mode: soft-light`) y **fecha estampada** abajo a la derecha dentro de la foto: `'AA MM DD` de la fiesta de ejemplo en Prompt 600 15 px `--fi-stamp` con `text-shadow: 0 0 6px rgba(255,138,42,.7)`, `aria-hidden`.
- **Tira de photobooth** (`PhotoStrip.astro`): tres cuadros verticales de una misma foto con `object-position` distintos, marco blanco, y al pie `FIESTA DISQUETE · EJEMPLO` en Prompt 700 10 px; se usa una vez (§4.2).
- **Tira de negativo** (`FilmStrip.astro`): banda tinta con perforaciones (pseudo-elementos) que contiene las historias de ejemplo (§4.5).
- **Confeti** (`Confetti.astro`): 10–14 piezas estáticas por sección donde aparece (rectángulos 6×12 y círculos 8 px en amarillo, naranja, cobalto y crema), posiciones fijas en el archivo de datos, `aria-hidden`. **Ráfaga** (`burst`, script chico en `fiestasLanding.client.js`): 24 piezas que salen de un punto con `transform` y `opacity` (900 ms) y se borran del DOM; solo como respuesta a una acción (agotada en la escalera, cierre).
- **Botón sticker**: pastilla 999 px, 52 px de alto, contorno tinta 2 px, sombra dura `0 4px 0 var(--fi-tinta)`; al presionar baja 3 px y la sombra pasa a `0 1px 0` ("se aprieta"). Primario: relleno crema sobre naranja/cobalto/noche, relleno tinta con texto crema sobre crema. Foco: anillo de 3 px `--fi-cobalto` (o amarillo sobre cobalto/noche) + offset 3 px.
- Iconos: los del sitio (lucide: `party-popper`, `ticket`, `scissors`, `qr-code`, `users`, `camera`). Nada de logos de Instagram, Facebook, WhatsApp ni de universidades o marcas de alcohol.

---

## 2. Estructura

| # | Pulsera | Sección | Fondo | Ancla |
|---|---|---|---|---|
| 1 | — | Hero: H1 con sticker, foto desechable, card "Tu fiesta" | naranja | |
| 2 | `LA IDEA` (cobalto) | Hecho para: tipos de fiesta en stickers + tira de photobooth | crema | `#para-quien` |
| 3 | `PREVENTA` (amarilla) | **La escalera** (firma) | cobalto | `#preventa` |
| 4 | `LOS PROMOS` (naranja) | Un código para cada promotor | crema | `#promotores` |
| 5 | `LA ÚLTIMA SEMANA` (cobalto) | Tu flyer en historias + piezas con IA + anuncios | naranja | `#difusion` |
| 6 | `QUIÉNES VAN` (naranja) | La fiesta empieza antes: la página, el muro, el grupo | crema-2 | `#pagina` |
| 7 | `SÁB 23:00` (amarilla) | La noche: montaje, puerta sin señal, escáner | **noche** | `#puerta` |
| 8 | `LA CAJA` (naranja) | Precio y cobro, calculadora por etapas | crema | `#precio` |
| 9 | `EL DÍA DESPUÉS` (amarilla) | Las fotos de esta venden la próxima | cobalto | |
| 10 | — | Testimonio (solo si es real) | crema | |
| 11 | `PREGUNTAS` (cobalto) | Preguntas frecuentes | crema | |
| 12 | — | Cierre: la pulsera con el nombre de tu fiesta | naranja + confeti | |
| 13 | — | Footer (`AppFooter tone="dark"`) | tinta | |

Orden pensado como la vida de una fiesta: la idea, la preventa, los promos, la última semana, el hype, la noche, la caja y el día después.

---

## 3. Header y pulsera de progreso

- `PartyHeader.vue` (patrón de `StandupHeader.vue`/`ClubHeader.vue`): `position: fixed`, transparente sobre el hero (logo y links en tinta); tras 40 px de scroll, fondo `--fi-crema` al 92% + `backdrop-filter: blur(12px)` + borde inferior `--border`.
- Logo · links `Preventa` (`#preventa`) · `Promotores` (`#promotores`) · `La puerta` (`#puerta`) · `Precio` (`#precio`) · `Ingresar` · botón sticker tinta `Publicar mi fiesta`.
- **Pulsera de progreso** (en lugar de la barra de lectura de stand-up y del reloj de clubs): banda de 6 px pegada al borde inferior del header que se llena con el scroll (`transform: scaleX(progreso)`); su color es el de la pulsera de la sección visible y en el extremo lleno lleva una pestaña de 14×14 (`aria-hidden`). En desktop, al lado de la pestaña, la etiqueta de la sección en meta 10 px (`PREVENTA`, `LOS PROMOS`…). Con `prefers-reduced-motion` igual se actualiza (es estado), sin transición de color.
- Mobile: logo + botón de menú (44×44, sticker `circle`). `LandingMobileBar variant="pill"` con `title="Gratis para publicar"`, `subtitle="0% de comisión para la productora"`, `ctaLabel="Publicar mi fiesta"`; aparece después del hero y se oculta en el cierre (comportamiento existente).

---

## 4. Secciones (copy es-CL completo)

### 4.1 Hero (naranja)
- Altura `min(100svh, 920px)` desktop / auto mobile (≥ 760 px). Grid `7fr 5fr`. Confeti estático (12 piezas) repartido por los bordes.
- **Izquierda:**
  - Eyebrow (meta, `--fi-ink-on-naranja`): `PARA PRODUCTORAS DE FIESTAS, CENTROS DE ESTUDIANTES Y FIESTAS TEMÁTICAS`
  - H1 (`StickerHeading`): **Preventa 1: agotada.** / en sticker: **¿Abrimos la 2?**
  - Bajada (con constantes): *Vende tu fiesta por etapas, con un código para cada promotor, tu flyer en Instagram toda la semana y la puerta con QR aunque el galpón no tenga señal. Lo de tu fiesta queda disponible `{PAYOUT_RELEASE_HOURS}` h después de que termina\*. 0% de comisión para la productora.*
  - CTAs: botón sticker crema `Publicar mi fiesta →` (`landing.cta.label`, `publishUrl("fiestas_hero")`) · botón con contorno tinta `Ver un evento de ejemplo` (`landing.demo.url`, ver Preguntas abiertas 10).
  - Microcopy meta bajo los CTAs: `SIN MENSUALIDAD · SIN PERMANENCIA · LAS ENTRADAS GRATIS NO PAGAN NADA`. Nota `*` → `TERMS_NOTE` al pie del hero, 12 px.
- **Derecha (capas):**
  - **Foto desechable** `aitk-fiesta-pista` (galpón con confeti, gente saltando), 4:3 recortada de la 3:2 con `object-position: 45% 40%` (que la bandera del fondo quede fuera o en el borde), giro 2,5°, fecha estampada de la fiesta de ejemplo.
  - Encima, abajo a la izquierda y girada −2°: **card "Tu fiesta"** (340 px, crema, radio 20, contorno tinta 2 px, sombra dura):
    - Meta: `FIESTA DISQUETE · EJEMPLO` y `SÁB {fecha} · 23:00 → 05:00 · GALPÓN EN SANTIAGO`.
    - Rótulo de estado como en la card real (`cardLabel`, tono warning): `Últimas entradas`.
    - Cuatro filas (nombre en Prompt 600, precio en Prompt 700, estado a la derecha):
      - `Preventa 1` · `$8.000` · pulsera amarilla **cortada** + `Agotada`
      - `Preventa 2` · `$10.000` · selector visual `− 2 +` (no funcional, `aria-hidden`) y debajo en meta `{SERVICE_FEE_NOTE}`
      - `Preventa 3` · `$12.000` · `Disponible desde el {formatSaleStart(P3)}` (atenuada)
      - `General` · `$15.000` · `Disponible desde el {formatSaleStart(G)}` (atenuada)
    - Sticker `burst` amarillo pegado en la esquina superior derecha: `ejemplo`.
- Fecha de ejemplo (para todo el sitio): la fiesta es el **sábado** que cae al menos 28 días después de la fecha de build, en hora de Chile (`EVENT_TIMEZONE`), 23:00 → 05:00 del domingo; la calcula `fiestasLanding.js` en el frontmatter y la pasa por props (la página es `prerender`, así no hay desfase de hidratación).
- Mobile: eyebrow, H1, bajada, CTAs a ancho completo; debajo, la foto (giro 1,5°) y la card encima de su borde inferior (giro −1,5°), sin confeti sobre el texto.

### 4.2 Hecho para (crema, pulsera `LA IDEA`, ancla `#para-quien`)
- H2 **Si la armas tú,** / sticker **se vende aquí.**
- Bajada: *Una fiesta que se arma, se difunde y pasa una vez. O que sale de gira.*
- **Seis stickers** (grid 3×2 desktop, 2×3 mobile; cada uno con forma y giro distintos, ícono lucide, título Prompt 700 y una línea):
  1. `burst` amarillo · **Fiestas universitarias** — Mechonas, aniversarios y fiestas de carrera, con entrada alumno y general.
  2. `pill` naranja · **Fiestas temáticas** — Los 2000, reggaetón antiguo, Halloween, disfraces. El flyer manda.
  3. `ticket` crema · **En galpón o casona** — Un lugar distinto cada vez y la puerta sin señal. Igual se escanea.
  4. `circle` cobalto (texto crema) · **Año Nuevo y fechas grandes** — Preventas largas, con etapas que abren semanas antes.
  5. `heart` naranja · **Aniversarios y fiestas de marca** — Invitados con cortesía y venta en el mismo evento.
  6. `pill` crema · **La fiesta que sale de gira** — Santiago, Viña y Concepción en un solo evento, una fecha por ciudad (hasta `{MAX_EVENT_FUNCTIONS}`).
- **Tira de photobooth** (`PhotoStrip`, a la derecha en desktop, girada 3°, 220 px de ancho) con `aitk-fiesta-universitaria` en tres cuadros (cara, grupo, luces del fondo).
- **Banda "¿Eres de un centro de estudiantes?"** (card crema-2 con contorno, ancho completo debajo): *Publicas gratis, tu compañera de tesorería ve las ventas con el rol Finanzas y lo vendido llega a la cuenta bancaria que registren (verificada, a nombre de quien aprobó su identidad). Entrada alumno y entrada general son dos tipos de entrada: en la puerta se ve cuál trae cada uno para pedir la credencial.* (ver Preguntas abiertas 13 antes de publicar el detalle de la cuenta).
- Fila final de enlaces meta: *¿Tienes un local con noches todas las semanas?* `Clubs y discotecas →` (`/ticketera-discotecas`) · *¿Tocan bandas en vivo?* `Música en vivo →` (`/ticketera-musica-en-vivo`).

### 4.3 La escalera (firma, cobalto, pulsera `PREVENTA`, ancla `#preventa`)
- H2 (crema) **Sube el precio** / sticker **por etapas.**
- Bajada: *Cada etapa es un tipo de entrada con su precio, su cupo y la fecha y hora en que abre. Tu público ve la que está a la venta, la agotada como agotada y las que vienen con su fecha. Arma la tuya y juega la preventa.*
- **Layout desktop** (`PresaleStairs.vue`, card grande `--fi-cobalto-2` con radio 24, etiqueta sticker `ejemplo · ritmo de ventas inventado, no una predicción`): grid `1.4fr 1fr`.
  - **Izquierda, la escalera:** las etapas son **pulseras apiladas en escalones** (cada una más alta y más a la derecha que la anterior, el ancho proporcional al cupo). Colores fijos por orden: amarilla, naranja, crema, tinta (con texto crema). Cada pulsera lleva `PREVENTA 1 · $8.000 · 150` impreso y una **barra de llenado** dentro (vendidas / cupo).
    - Controles arriba: segmented `2 · 3 · 4 etapas` (default 4: Preventa 1, 2, 3 y General; con 2: Preventa y General; con 3: Preventa 1, 2 y General).
    - Al tocar una pulsera se despliega su editor: stepper de **precio** (±$1.000, de $1.000 a $60.000; en el campo, `parseAmount` con tope `CALC_PRICE.inputMax`) y de **cupo** (±25, de 25 a 500), y su **apertura** en meta (`Abre lun {fecha}, 20:00`, fija por etapa: D-26, D-19, D-12 y D-5 a las 20:00, cada una lunes). Regla: si una etapa queda más barata que la anterior se muestra un aviso suave *"Ojo: esta etapa es más barata que la anterior"* (no se bloquea).
    - Contador grande del día de la simulación en Bagel 56 amarillo: `D-26` … `D-1` · `SÁB: FIESTA`.
  - **Derecha, "Así lo ve tu público"** (`BuyerPreview`, card crema dentro de la cobalto, como el checkout simplificado): título del evento de ejemplo y filas con los **rótulos reales** según el estado de la simulación: `Agotada` (con la pulsera cortada), la etapa a la venta con su precio y `{SERVICE_FEE_NOTE}`, y las siguientes atenuadas con `Disponible desde el {formatSaleStart}`. Arriba, el rótulo de la card (`Últimas entradas` con el criterio de poco stock de la página del evento: `stockSummary` de `eventView.js`, quedan 10 o menos o el 15% o menos de lo que está a la venta; antes decía "menos del 30%", manda el producto).
  - **Abajo, a todo el ancho:** botón sticker crema **`▶ Abrir la preventa`** y, al terminar, `↻ Otra vez`. Resumen en una fila: `Vendidas {n} de {cupo total}` · `Tú recibes {Σ priceQuote(precio, 'buyer', vendidas).total}` (Bagel, amarillo) · meta `si tu público paga el cargo`.
- **Cómo se juega** (datos y reglas en `fiestasLanding.js`, función pura `playPresale(stages, choices)`; un test las cuadra):
  - La preventa corre día a día de D-26 a D-1 (≈ 7 s en total, 260 ms por día). Cada día tiene una **demanda de ejemplo** fija: `D-26 70 · 25 30 · 24 22 · 23 18 · 22 25 · 21 20 · 20 24 · 19 45 · 18 20 · 17 16 · 16 18 · 15 30 · 14 28 · 13 22 · 12 40 · 11 18 · 10 20 · 9 22 · 8 26 · 7 30 · 6 28 · 5 35 · 4 25 · 3 30 · 2 28 · 1 32` (los saltos son los días en que abre una etapa: el "drop"). El precio no cambia la demanda (por eso el rótulo "no una predicción").
  - Hay **una etapa a la venta a la vez**. Cada etapa abre en su fecha; si la anterior aún tenía cupo, se cierra con lo vendido (como `end_date` = apertura de la siguiente).
  - **Si una etapa se agota antes de que abra la siguiente**, la simulación **se detiene** y aparece un sticker grande sobre la escalera: **"Preventa 1: agotada en 4 días. ¿Abrimos la 2?"** (texto armado con los datos) con dos botones: sticker crema `Adelantar la Preventa 2` y con contorno `Esperar al lunes`. Debajo, en meta: *Hoy la adelantas desde tu asistente de IA o escribiéndonos por WhatsApp.* + chip `Que abra sola cuando se agota la anterior` + **Pronto**.
    - `Adelantar`: la siguiente abre ese mismo día y recibe lo que queda de la demanda de ese día.
    - `Esperar`: no se vende nada hasta la fecha de la siguiente (la demanda de esos días se pierde); el contador muestra `Sin entradas a la venta hasta el lunes`.
  - Al agotarse una etapa, su pulsera **se corta** (tijera, las dos mitades caen) y sale una **ráfaga de confeti** (una por etapa).
  - Final: si General se agota, el contador muestra `AGOTADO` y aparece la última historia de la serie (`pieceText` variante `sold_out`: **Agotado** / *Entradas agotadas.*) como sticker; si no, `Vendiste {n} de {total}`.
  - **Verificación** (precios $8.000 / $10.000 / $12.000 / $15.000, cupos 150 / 200 / 200 / 150): adelantando siempre → 3 pausas (P1 se agota D-22, P2 D-14, P3 D-6), **700 de 700**, General agotada en D-1, **tú recibes $7.850.000**; esperando siempre → 1 pausa, P2 vende 179 y P3 184, **663 de 700**, tú recibes $7.448.000.
- **Lista bajo la escalera** (crema sobre cobalto; ítems con mini pulsera de 8 px):
  - **Cada etapa con su fecha y hora** — La programas una vez. Hoy se programa desde tu asistente de IA conectado o escribiéndonos por WhatsApp.
  - **Antes de abrir, cuenta regresiva** — Las últimas 24 horas antes de la primera etapa, tu página muestra la cuenta regresiva y un botón para dejar el correo. `Aviso automático cuando abre` + Pronto.
  - **Hasta `{DEFAULT_MAX_PER_PURCHASE}` por compra** — Si no lo cambias, para que la preventa alcance para más gente.
  - **Las etapas se copian** — Duplicas la fiesta y vuelves a tener tus etapas, solo cambias las fechas.
- Links meta: `Guía: cómo hacer una preventa →` (`/guias/como-hacer-una-preventa`).
- **Mobile:** la escalera se dibuja vertical (pulseras apiladas a ancho completo, escalonadas 12 px a la derecha); el editor de cada etapa se abre como hoja inferior (`<dialog>`); "Así lo ve tu público" va debajo, colapsado en 2 filas (la que está a la venta y la siguiente); el sticker de la pausa ocupa el ancho y los dos botones van apilados.
- **Accesibilidad:** la escalera es `role="group"` con `aria-label="Simulación de una preventa por etapas, ejemplo"`; cada pulsera es un `<button aria-expanded>`; los steppers son `<button>` con `aria-label` ("Subir precio de Preventa 2") y un `<output>`; el estado (día, etapa a la venta, pausa) se anuncia en `aria-live="polite"` con `useDelayedAnnouncement` solo en pausas y al final. La pausa mueve el foco al botón `Adelantar`. **Sin JS:** se ve la escalera por defecto con su resumen y una `<table>` (caption `sr-only`) con etapa, precio, cupo, apertura y lo que recibes si se vende todo.

### 4.4 Un código para cada promotor (crema, pulsera `LOS PROMOS`, ancla `#promotores`)
- H2 **Cada promotor,** / sticker **con su código.**
- Texto: *En una fiesta venden veinte personas: el centro de estudiantes, los amigos del DJ, la cuenta de memes. A cada uno le das su código de descuento y su link. En tu panel ves cuántas veces se usó cada código, cuánto vendió y cuánto descontó; en las métricas de la fiesta, cuántas visitas y entradas trajo cada link. Sin pantallazos de transferencias ni planillas compartidas.*
- **Plancha de stickers** (`PromoSheet.vue`, izquierda en desktop): hoja crema-2 con borde punteado de "corte" y seis stickers de formas distintas, cada uno con el **código** en Bagel 28, el nombre en meta y un anillo de usos (SVG, `usos / máximo`):

| Código | Quién | Compras | Entradas por compra | Máx. usos |
|---|---|---|---|---|
| `CATA10` | Cata · promotora | 44 | 2 | 60 |
| `CEE10` | Centro de estudiantes | 52 | 3 | 80 |
| `FEÑA10` | Feña · promotor | 31 | 2 | 60 |
| `TOPO10` | DJ Topo | 18 | 1 | 40 |
| `MEMES10` | @memes.ejemplo | 12 | 2 | 40 |
| `JAVI10` | Javi · promotor | 7 | 4 | 40 |

  - Todos: 10% de descuento sobre la Preventa 2 ($10.000). Descuento y ventas se calculan con `computeDiscountedTotals` por orden (no a mano). Verificación: `CATA10` → descuento $88.000, ventas $792.000; `CEE10` → $156.000 / $1.404.000.
  - Al tocar un sticker **se despega** (gira y se da vuelta) y por detrás muestra las mismas columnas del panel: `Usos 44 / 60` · `Compras 44` · `Descuento $88.000` · `Ventas $792.000`. Otro toque lo vuelve a pegar. Selector arriba: `Por ventas` / `Por usos` (reordena con FLIP).
  - Selector `Códigos` / `Links`: con `Links` la plancha se cambia por una lista de canales (filas con barra): `ref:cata` · `Instagram (bio)` · `ref:invite · Invitar a alguien` · `{DIRECT_CHANNEL}` con visitas, entradas e ingresos (ingresos = entradas × $10.000, calculados). Al tocar `ref:cata` aparece su link `aitickets.cl/eventos/fiesta-disquete?ref=cata` con botón `Copiar` (copia el texto de ejemplo; toast `Es un ejemplo: crea los tuyos en el panel`).
- **Foto desechable** `aitk-fiesta-promotor` (a la derecha, 4:5, giro −2,5°) con un sticker `pill` naranja pegado: `CATA10`.
- **Cuatro ítems** (número en sticker `circle` cobalto + título Prompt 700 + texto):
  1. **Un código por promotor, en un minuto.** Porcentaje o monto, usos máximos, límite por persona y fecha de término. Puede servir para una fiesta o para todas las tuyas.
  2. **Y su link, por si no usan el código.** Cada link suma visitas, entradas e ingresos en las métricas de la fiesta. La venta se asocia al link cuando la persona compra en la misma visita en que llegó con él.
  3. **Liquidas con un CSV.** Exportas las órdenes con su código y su canal, y calculas lo de cada promotor.
  4. **Los que compran también invitan.** En la página de su compra tienen un botón "Invitar a alguien" que comparte *"Voy a Fiesta Disquete, ¿vamos?"*. Esas ventas se ven como su propio canal.
- Debajo: chip `Cada promotor ve sus números en su celular` + Pronto.
- Links meta: `Guía: cómo medir ventas por promotor →` (`/guias/como-medir-ventas-por-promotor`) · `Ventas por promotor →` (`/ventas-por-promotor`).
- **Mobile:** foto arriba (3:4, giro 1°), plancha en 2 columnas, ítems debajo; el link se corta con `overflow-wrap: anywhere`.

### 4.5 La última semana (naranja, pulsera `LA ÚLTIMA SEMANA`, ancla `#difusion`)
- H2 **Tu flyer, en historias** / sticker **hasta el sábado.**
- Bajada (consistente con `ORGANIZADORES_FAQ`): *Conectas tu Instagram una vez y apruebas la serie con una vista previa de cada pieza. Con tu flyer y los datos de la fiesta armamos historias con cuenta regresiva, que se vuelven diarias la última semana, y un post diario en el feed esa semana, y se publican solos. A quien responde la historia con la palabra `{DEFAULT_KEYWORD}` le llega el link por DM. Cuando quedan pocas, la historia lo dice; si se agota, la serie se ajusta sola.*
- **Tira de negativo** (`FilmStrip.astro`, ancho completo, girada −1°): cinco cuadros 9:16 (180×320 desktop) con el flyer de ejemplo de fondo (`aitk-fiesta-pista` recortada vertical) y el texto real de `pieceText` encima en Bagel:
  1. `D-10` · **Faltan 10 días** · `SÁB {fecha} · 23:00 h`
  2. `D-7` · **Faltan 7 días** · sticker amarillo `Quedan 180 entradas` (180 de 700 = 26%: la serie solo lo muestra bajo el `scarcity_threshold_pct`% del aforo del evento, `socialSeries.ts`; lo verifica el test)
  3. `D-3` · **Faltan 3 días** · `Quedan 64 entradas`
  4. `D-1` · **Mañana** · *Última noche para comprar*
  5. `AGOTADO` · **Agotado** · *Entradas agotadas.*
  - Bajo cada cuadro, en meta crema sobre tinta, la hora: `{default_time}` (o `{event_day_time}` el día). Sticker lima en el cuadro 1: `Responde {DEFAULT_KEYWORD} y te llega el link`. No se muestra la pieza del día de la fiesta ("Hoy") porque su llamado menciona entradas en puerta (Preguntas abiertas 16).
  - Leyenda (Prompt, tinta): `{h} historias y {p} posts en las últimas dos semanas · hora: la de más visitas de tu fiesta, o {default_time}` (contados con `seriesMarks`/`DEFAULT_CADENCE`).
  - Chips: `● Instagram` · `Facebook` + Pronto · `TikTok` + Pronto · `Reels` + Pronto.
- **Debajo, dos cards** (crema, contorno tinta, sombra dura, giros ±1°):
  - **Piezas con IA** (`AiPieceCard.astro`): H3 **¿Sin diseñador esta vez?** Texto: *En Promocionar escribes el post con el tono que quieras y generas una imagen a partir de los datos de tu fiesta. Si subes hasta `{MAX_REFERENCE_IMAGES}` imágenes de referencia, como el flyer de la edición anterior, la nueva sigue su estilo y sus colores.* Mockup: cuatro miniaturas de referencia (recortes de las fotos de fiesta, etiqueta `referencia`) → flecha → un cuadro con `Generar imagen` en botón sticker. Sin resultado inventado (el cuadro muestra la textura de pulsera con `ejemplo`).
  - **Anuncios** (`PartyAdsDemo.vue`, piel nueva sobre `useAdsDemo`, misma matemática que stand-up/música/clubs): badge meta `PREVENTA 3 · QUEDAN 64`; H3 **¿Se frenó la venta? Impúlsala.**; texto: *Lanza un anuncio en Instagram y Facebook desde tu panel, para tu ciudad y desde los `{AD_LIMITS.defaultAgeMin}` años. Tú defines cuánto invertir por día y por cuántos días, y lo pausas cuando quieras. Meta cobra el gasto directo en tu cuenta publicitaria y ves cuántas entradas vendió cada anuncio.* Slider `Presupuesto diario` ($3.000–$50.000, default $5.000), slider `Días` (1–5 en la demo; nota `hasta {AD_LIMITS.maxDays} días`), chips `Santiago · 17 km` · `{defaultAgeMin}–25 años` · `Reggaetón` + Pronto (deshabilitado). Botón sticker `Impulsar · {total} en total` → `✓ Anuncio activo · {días} días` + `Pausar`. **Sin alcance ni resultados estimados.** La pieza de ejemplo no muestra alcohol.
- **Mobile:** la tira de negativo hace scroll horizontal con `scroll-snap` (cuadros de 150×267, se ve el siguiente asomado), las dos cards apiladas y los anuncios con un solo slider (`Días` fijo en 3).

### 4.6 La fiesta empieza antes (crema-2, pulsera `QUIÉNES VAN`, ancla `#pagina`)
- H2 **La fiesta** / sticker **empieza antes.**
- Bajada: *La página de tu fiesta trabaja para que el que ya compró arrastre a su grupo.*
- **Izquierda: teléfono** (300×600, marco tinta radio 40) con la **página de una fiesta de ejemplo** dibujada con los elementos reales: flyer vertical completo (recorte de `aitk-fiesta-pista` con el nombre `FIESTA DISQUETE` en Bagel encima, como flyer), fondo con el tinte pastel del flyer, rótulo `Últimas entradas`, botón `Comprar entradas`, y abajo el inicio de la galería (3 miniaturas). Etiqueta sticker `ejemplo`. Mockup decorativo: no copia la interfaz exacta del evento.
- **Derecha: "Quiénes van"** (`PartyWall.vue`, piel sticker sobre la lógica de `WallDemo.vue`: mismos `FEED_EMOJIS`, mensajes de hasta `FEED_MESSAGE_MAX` caracteres, conteos de mayor a menor; demo local, no publica nada). Los conteos son stickers `circle` con el emoji y el número; los mensajes de ejemplo son stickers `pill` con nombre (`Coni R.`, `Mati G.`, `Fran S.`): *"Vamos 8 de la carrera 🔥"*, *"¿Alguien de Maipú para compartir el auto?"*, *"La del año pasado fue la mejor. Repito."*. Encabezado meta: `LO VEN SOLO QUIENES TIENEN ENTRADA`.
- **Seis ítems** (dos columnas debajo, ícono en sticker chico):
  1. **Tu flyer, completo.** Se ve en su proporción y la página toma su color.
  2. **El aftermovie arriba.** Un video de portada (MP4, MOV o WebM de hasta `{EVENT_VIDEO_MAX_BYTES / 1MB}` MB) que se reproduce solo, sin sonido.
  3. **Las fotos de la anterior.** Una galería al final de la página, con hasta `{GALLERY_MAX_IMAGES}` fotos y un video.
  4. **"Quiénes van".** Quien compra reacciona con un emoji y deja un mensaje que ven los demás asistentes. Tú lo moderas.
  5. **Uno compra, cada uno con su QR.** Quien compra para el grupo le pasa a cada amigo su entrada con "Ver QR". Hasta `{DEFAULT_MAX_PER_PURCHASE}` por compra si no lo cambias.
  6. **Un asistente que responde.** El dress code, la edad mínima o hasta cuándo hay preventa, con la información que cargaste.
- **Fila "La dirección"** (card con contorno, ancho completo): *¿Fiesta en lugar secreto? Publica la comuna y avísales la dirección exacta el mismo día con un correo programado a todos los que compraron (desde tu asistente de IA).* + chip `Dirección que solo ven quienes compran` + Pronto.
- **Mobile:** teléfono a 240×480 arriba; el muro debajo en versión `compact` (4 chips tocables y 2 mensajes, como `WallDemo`); ítems en una columna.

### 4.7 La noche (noche, pulsera `SÁB 23:00`, ancla `#puerta`)
- Única sección oscura (`.fi-on-dark`). Confeti estático muy tenue (amarillo al 30%).
- H2 (crema) **En el galpón no hay señal.** / sticker **La puerta igual avanza.**
- **Izquierda: la noche en cuatro horas** (línea de tiempo vertical, horas en Bagel 32 amarillo, texto Prompt):
  - `17:00` · **Montaje.** Foto desechable `aitk-fiesta-montaje` (4:5, 220 px, giro −3°, fecha estampada). *Tu equipo de puerta recibe su rol o un link de escáner que vence solo (lo creas desde tu asistente de IA). No necesitan tu cuenta.*
  - `23:00` · **Abre la puerta.** *Tres celulares escanean a la vez. La lista se descarga antes: si se cae la señal, cada celular sigue validando y se sincroniza cuando vuelve.*
  - `01:30` · **El peak.** *El contador del escáner dice cuántos entraron. ¿Por tipo de entrada y llegadas cada 15 minutos? Pregúntaselo a tu asistente de IA.* + chip `Aforo en vivo en el panel` + Pronto.
  - `05:00` · **Se prenden las luces.** *Ingresaron 642 de 700.* (ejemplo) *Lo de tu fiesta queda disponible el MAR 05:00\** (término DOM 05:00 + `PAYOUT_RELEASE_HOURS`, calculado en `fiestasLanding.js`; con el valor actual, martes).
- **Derecha: el escáner** (`DoorScanner.vue`, teléfono 300×600 con la interfaz del escáner en tonos de noche): arriba `Sin conexión · 3 por sincronizar` (meta amarillo) y `318 / 700 entradas validadas`. Botón sticker `Escanear siguiente` que recorre cuatro casos con los **textos reales**:
  1. `✅ Entrada validada con éxito para Coni Rojas (pendiente de sincronizar)` · tipo `Preventa 2` (banner lima).
  2. `✅ … para Mati González` · tipo `Alumno` + nota meta *Pide la credencial* (banner lima).
  3. `❌ Este ticket ya fue validado` (banner rojo de error del producto, sacudida F12) + nota meta *El pantallazo que ya entró no entra de nuevo.*
  4. `✅ … para DJ Topo` · tipo `Cortesía` (banner lima).
  - El contador sube con cada válida. `aria-live="polite"` con el resultado. Sin JS: se ven los cuatro casos como lista.
- **Siete ítems** bajo la línea de tiempo (número en sticker amarillo con texto tinta + título Prompt 700 + texto), en dos columnas:
  1. **Escanean varios celulares a la vez.** Con el rol Puerta o un link de escáner que vence solo.
  2. **Sin señal, igual.** Cada celular valida y rechaza lo que ya escaneó; al volver la conexión se sincroniza con los demás.
  3. **Un QR entra una vez.** El pantallazo compartido que ya entró, no entra de nuevo.
  4. **La puerta ve qué entrada es.** Preventa, General, Alumno o Cortesía, con el nombre de quien la compró.
  5. **¿Se le borró el correo?** Se busca por nombre y se le reenvía.
  6. **¿No puede ir?** Tu equipo le transfiere la entrada a otra persona desde tu asistente de IA: el QR anterior deja de servir.
  7. **DJs, staff e invitados.** Cortesías con su propio QR, hasta `{MAX_COURTESY_PER_REQUEST}` por envío; no cuentan como venta.
- Nota con `*` (texto chico): *Escanear también cuenta para tu pago: los check-ins de la puerta acreditan que la fiesta se realizó, una de las condiciones para liberar lo vendido.* (ledger.ts, `TERMS_NOTE`).
- Links meta: `Guía: check-in con QR →` (`/guias/como-hacer-check-in-con-qr`) · `Entradas con QR →` (`/entradas-con-qr`).
- **Mobile:** línea de tiempo arriba (fotos a 160 px), escáner debajo a 260×520, ítems en una columna.

### 4.8 La caja (crema, pulsera `LA CAJA`, ancla `#precio`)
- H2 **Tú recibes el 100%** / sticker **de cada etapa.**
- Texto (armado como el `priceLead` de stand-up, con constantes): *Para la productora, 0% de comisión. El comprador paga un cargo por servicio de `{SERVICE_FEE_PERCENT_LABEL}` más IVA (`{IVA_PERCENT_LABEL}`) sobre ese cargo. Si prefieres precios redondos, lo absorbes tú, por evento. `{ABSORB_FEE_ACTIVATION}` Las entradas gratis no pagan nada.*
- Garantías en meta con `·`: `Sin mensualidad · Sin permanencia · {PAYOUT_SHORT_TEXT}*`.
- **Calculadora por etapas** (`StageCalculator.vue`, usa `priceQuote` + `usePayerToggle` + `useDelayedAnnouncement`): card blanca con contorno tinta 2 px y sombra dura, radio 20.
  - Una fila por etapa (las cuatro por defecto de §4.3; botón `+ Etapa` hasta 4 y `×` para quitar hasta 1), cada una con mini pulsera de su color, nombre, **precio** (campo con `parseAmount`, tope `CALC_PRICE.inputMax`) y **cupo** (campo, 1 a `CALC_QTY.inputMax`).
  - Segmented `Paga el público` / `Lo absorbo yo`.
  - Por fila, a la derecha: `Tu público paga {buyerPays}` · `Tú recibes {perTicket}` por entrada (Prompt 600, `tabular-nums`).
  - Abajo: desglose de **una** entrada de la etapa elegida (`Entrada`, `SERVICE_FEE_LABEL`, `SERVICE_FEE_TAX_LABEL`) y totales: `SI SE VENDE TODO, TU PÚBLICO PAGA {Σ buyerPays × cupo}` (Prompt 700) y bloque lima **`TÚ RECIBES {Σ priceQuote(precio, payer, cupo).total}`** (Bagel 56, tinta).
  - Verificación (computeFeeSplit): **$8.000 → público $8.762 / tú $8.000; absorbido → $8.000 / $7.238. $10.000 → $10.952 / $10.000; absorbido $9.048. $12.000 → $13.142 / $12.000; absorbido $10.858. $15.000 → $16.428 / $15.000; absorbido $13.572.** Con los cupos 150/200/200/150: tú recibes **$7.850.000** (público paga $8.597.300); absorbido, tú recibes **$7.102.700**.
  - Región `aria-live` con `useDelayedAnnouncement`.
- **Cobro de la fiesta** (fila con ícono de reloj): `{PAYOUT_SCHEDULE_TEXT}*` + *Si la fiesta termina a las 05:00, las `{PAYOUT_RELEASE_HOURS}` h cuentan desde las 05:00. ¿Gira por varias ciudades? Cada fecha se cobra por separado.*
- Nota: `TERMS_NOTE` → `/terminos-productores`.
- **Mobile:** cada etapa como card apilada (precio y cupo en una fila), totales apilados.

### 4.9 El día después (cobalto, pulsera `EL DÍA DESPUÉS`)
- H2 (crema) **Las fotos de esta** / sticker **venden la próxima.**
- **Hoja de contactos** (izquierda en desktop): 6 fotos desechables chicas en dos filas (recortes de `aitk-fiesta-pista`, `aitk-fiesta-universitaria` y `aitk-publico`, todas con fecha estampada), giros alternados, y encima dos stickers de reseña: `★★★★★ Excelente` y `★★★★ Muy bueno` (`RATING_LABELS`), etiqueta `ejemplo`.
- **Cuatro cards** (crema sobre cobalto, contorno tinta, número Bagel cobalto):
  1. **Fotos y estrellas de tu público.** Entre `{REVIEW_REQUEST_DELAY_HOURS}` y `{REVIEW_REQUEST_WINDOW_HOURS}` h después de la fiesta les llega un correo para calificar y subir hasta `{MAX_PHOTOS_PER_PERSON}` fotos. Si quieres, premias con un código para la próxima.
  2. **Invita solo a los que vinieron.** Mandas el link de tu próxima fiesta a todos, solo a quienes entraron por la puerta o solo a quienes calificaron con 4 o 5 estrellas.
  3. **"Quiénes van" pasa a "Así lo vivieron".** El muro queda como recuerdo para tus asistentes.
  4. **La próxima, en un clic.** Duplicas la fiesta con sus etapas y sus preguntas frecuentes, subes las mejores fotos a la galería y el domingo te llega por correo cómo vendió la semana.
- **Mobile:** hoja de contactos en 3×2 a ancho completo; cards en carrusel con `scroll-snap` (card al 86%).

### 4.10 Testimonio (solo si es real)
- Solo si `PARTY_TESTIMONIAL` no es `null`. La cita va dentro de un **sticker grande** `pill` crema girado −1,5° (Prompt 400 28/40, 20/30 mobile), con comillas Bagel naranja de 96 px; foto desechable 120×150 con fecha estampada; nombre (Prompt 700) y `productora o centro de estudiantes · ciudad` en meta.
- Si es `null`, no se renderiza nada (ni el contenedor).

### 4.11 Preguntas frecuentes (crema, pulsera `PREGUNTAS`)
`src/data/fiestasFaq.ts`, mismo patrón que `musicaFaq.ts`/`clubsFaq.ts` (`pick` con error si falta, `reword`). Orden:

| # | Fuente | Pregunta |
|---|---|---|
| 1 | `PRODUCER_FAQ` | ¿Cuánto cuesta usar AI Tickets? |
| 2 | nueva (`terms`) | ¿Cuándo recibo lo de mi fiesta? — `{PAYOUT_SCHEDULE_TEXT}` + *Si la fiesta termina pasada la medianoche, se cuenta desde la hora de término. Escanea las entradas en la puerta: los check-ins acreditan que la fiesta se realizó, una de las condiciones para liberar el pago. Para retirar necesitas registrar una cuenta bancaria, que AI Tickets verifica normalmente en 1 día hábil.* (la última frase, tomada de la respuesta de PRODUCER_FAQ, no reescrita) |
| 3 | `PRODUCER_FAQ` | ¿Puedo absorber el cargo por servicio? |
| 4 | nueva | ¿Cómo armo una preventa por etapas? — *Cada etapa es un tipo de entrada con su precio, su cupo y su fecha y hora de apertura y cierre. Hoy las fechas se programan desde tu asistente de IA conectado o escribiéndonos por WhatsApp. Mientras una etapa está a la venta, tu público ve las siguientes con su fecha de apertura. Si una etapa se agota antes de tiempo, adelantas la siguiente por el mismo camino: todavía no abre sola.* |
| 5 | `PRODUCER_FAQ` reformulada | ¿Puedo saber cuánto vende cada promotor? (respuesta de "¿Puedo saber cuántas entradas vende cada promotor?") + *Si además le das un código de descuento, en tu panel ves cuántas veces se usó, cuánto vendió y cuánto descontó. Puedes exportar las órdenes a CSV con su código y su canal.* |
| 6 | nueva | ¿Puedo tener entrada alumno y entrada general? — *Sí: son dos tipos de entrada, cada uno con su precio y su cupo. AI Tickets no verifica al comprar que la persona sea alumna: en la puerta tu equipo ve el tipo de entrada al escanearla y pide la credencial.* |
| 7 | nueva | ¿Puedo pedir que sean mayores de 18? — (misma respuesta que clubs, con "fiesta" en vez de "evento") *Hoy AI Tickets no verifica la edad al comprar. Indícalo en la descripción de la fiesta y en el nombre de la entrada ("+18"): el asistente de la página lo responde a quien pregunte, y tu equipo revisa el carnet en la puerta.* |
| 8 | nueva | ¿Puedo avisar la dirección a última hora? — *Sí. Publica la comuna o un punto de referencia y, el mismo día, programa un correo a todos los que compraron con la dirección exacta desde tu asistente de IA. Ten en cuenta que un evento sin dirección exacta puede quedar con una parte de lo vendido en reserva (ver términos).* `terms: true` (validar con el dueño, Preguntas abiertas 6) |
| 9 | nueva | ¿Qué pasa si alguien comparte el pantallazo de su QR? — *Cada QR entra una sola vez: si el pantallazo ya se usó, el escáner lo marca como validado y no pasa. Si la señal se cae, cada celular sigue validando y rechaza lo que él ya escaneó, y todo se cruza al volver la conexión. Si una persona no puede ir, tu equipo le transfiere la entrada a otra persona desde tu asistente de IA y el QR anterior deja de servir.* |
| 10 | nueva | ¿Cómo le paso su entrada a cada amigo? — *Quien compra recibe un correo con cada entrada y su link "Ver QR": le manda a cada amigo la suya. Si no lo cambias, son hasta `{DEFAULT_MAX_PER_PURCHASE}` entradas por compra.* |
| 11 | nueva (`terms`) | ¿Sirve para una fiesta grande o masiva? — *Sí. Si el aforo pasa de `{LARGE_CAPACITY}` personas o es un evento masivo, te pedimos el permiso del lugar y una póliza de responsabilidad civil (y, si es masivo, la autorización de la Delegación Presidencial). Según el riesgo del evento, entre el `{RESERVE_BY_LEVEL.medium}`% y el `{RESERVE_BY_LEVEL.high}`% de lo vendido puede quedar como reserva hasta `{RESERVE_HOLD_DAYS}` días después de la fiesta.* (mismo texto que la FAQ 13 de música, validado allí) |
| 12 | nueva | ¿Se puede vender en la puerta? — *AI Tickets vende online: tu público compra desde el celular en la página de la fiesta, mientras haya cupo y la venta esté abierta. No hay cobro en efectivo ni con máquina en la puerta.* |
| 13 | `ORGANIZADORES_FAQ` | ¿Cómo funciona la publicación automática en redes? |
| 14 | `ORGANIZADORES_FAQ` | ¿Tengo que pagar anuncios? |
| 15 | `ORGANIZADORES_FAQ` | ¿Puedo poner un video como portada del evento? (el aftermovie de la anterior) |
| 16 | `ORGANIZADORES_FAQ` reformulada | ¿Qué es "Quiénes van"? — *Un espacio que ven quienes tienen entrada, desde la página de su compra o de su entrada: reaccionan con un emoji y dejan un mensaje corto (hasta `{FEED_MESSAGE_MAX}` caracteres) que ven los demás asistentes. Tú lo moderas desde el panel. Después de la fiesta queda como recuerdo, con el título "Así lo vivieron".* (ver Preguntas abiertas 14) |
| 17 | `PRODUCER_FAQ` | ¿Qué pasa si tengo que cambiar o cancelar una función? (`terms`) |
| 18 | `PRODUCER_FAQ` | ¿Me ayudan a publicar mi primer evento? |

- Estilo: `LandingFaq` con los tokens puente; pregunta en Prompt 700; el `+` es un sticker `circle` naranja 32 px que gira 45° al abrir (con `prefers-reduced-motion`, cambia sin girar).

### 4.12 Cierre (naranja + confeti)
- Sin foto. Confeti estático (14 piezas) que flota lento (F16).
- H2 (`StickerHeading`, Bagel 96 / 44 mobile) **¿Cuándo abre** / sticker **tu preventa?**
- **La pulsera con tu nombre** (`BandNamer.vue`): una pulsera grande (64 px de alto, ancho del contenedor, girada −2°) que dice `FIESTA DISQUETE · PREVENTA 1 · N° 0001`; encima, un campo `Ponle nombre a tu fiesta` (máx. 24 caracteres, `autocomplete="off"`) que reescribe la pulsera en vivo en mayúsculas (`FIESTA {NOMBRE} · PREVENTA 1`). Es solo decorativo: el texto **no se envía ni se guarda** (ni en analítica ni en `localStorage`); el CTA no lo lleva a ninguna parte. SSR/sin JS: la pulsera con el nombre de ejemplo, sin campo.
- Bajada: *Publícala hoy. Crear tu cuenta es gratis y no hay costos fijos. Si quieres, la armamos contigo.*
- CTAs: botón sticker crema `Publicar mi fiesta →` (`publishUrl("fiestas_closing")`) · contorno tinta `Hablar por WhatsApp` · link `Agenda una demo de 15 min` (mismos destinos que stand-up y clubs).

### 4.13 Footer
`AppFooter tone="dark"`. En "Para quién" se agrega `{ href: "/ticketera-fiestas", label: "Fiestas" }` después de `Clubs y discotecas` (cambio aditivo en `AppFooter.vue`, anotar en el PR).

---

## 5. Mobile

- Ancho base 390; gutter 20 px; secciones 72 px de padding vertical (desktop 136). Las pulseras separadoras cruzan el ancho a sangre (`width: calc(100% + 40px)`, `margin-inline: -20px`) sin provocar scroll horizontal (`overflow-x: clip` en la sección).
- Orden igual al desktop. Cambios: card del hero bajo la foto; stickers de "Hecho para" en 2 columnas y la tira de photobooth arriba a la derecha, chica (120 px), girada; **escalera vertical** con editor en hoja inferior y la pausa a ancho completo (§4.3); plancha de promotores en 2 columnas; tira de negativo con scroll horizontal; muro compacto; línea de tiempo de la noche arriba del escáner; calculadora en cards apiladas; día después en carrusel.
- Giros: en mobile, máximo ±2° (más giro rompe la lectura en pantallas angostas) y nunca sobre bloques de texto de más de 2 líneas.
- Objetivos táctiles ≥ 44×44 (steppers 44×44, stickers de promotor ≥ 96×96). Nada de hover como única forma de ver información: los stickers de promotor se despegan al tocar, el editor de etapas se abre al tocar.
- `LandingMobileBar` en píldora aparece después del hero y se oculta al llegar al cierre.

---

## 6. Animaciones (todas con `prefers-reduced-motion`)

Solo `transform`, `opacity` y `clip-path`. Con `prefers-reduced-motion: reduce` todo queda en su estado final y sin loops: sin flash, sin ráfagas de confeti (el confeti estático queda), stickers ya pegados sin rebote, pulseras ya cerradas, la escalera avanza **por pasos** (botón `Siguiente día` en vez de corrida automática; las pausas y decisiones se mantienen), los stickers de promotor cambian de cara sin girar, el escáner cambia de caso sin sacudida. Reveals genéricos con `LandingMotion` (`data-lp-reveal` / `data-lp-step`).

| # | Elemento | Animación |
|---|---|---|
| F1 | Foto del hero | **Flash de desechable**: capa blanca `opacity 0→.85→0` (180 ms) y la foto se asienta (`rotate 6°→2.5°`, `scale 1.04→1`, 700 ms, `cubic-bezier(.2,.8,.2,1)`); la fecha estampada aparece después del flash (`opacity`, 200 ms). Una vez |
| F2 | H1 | La primera línea sube (`translateY 24px`, 500 ms); el **sticker se pega**: `scale 1.25→1`, `rotate -12°→-3°`, `opacity 0→1`, 420 ms con rebote `cubic-bezier(.34,1.56,.64,1)`, delay 350 ms |
| F3 | Bajada y CTAs | Fade + `translateY 16px`, delay 600–750 ms |
| F4 | Card "Tu fiesta" | Entra a 0,9 s (`translateY 24px`, `rotate -6°→-2°`); a 1,6 s la pulsera de la Preventa 1 **se corta** (F7) y aparece `Agotada` |
| F5 | Pulseras de sección | Al 30% de visibilidad la banda entra desde la izquierda (`translateX -6%→0`, 500 ms) y la pestaña **se cierra** (`rotate -35°→0`, 260 ms, `transform-origin` en su bisagra) |
| F6 | Stickers (hecho para, ítems) | Pop `scale .6→1` + giro final, stagger 60 ms, rebote suave |
| F7 | Pulsera cortada (escalera, hero) | Corte en zigzag (`clip-path` en dos mitades) y las mitades se separan 6 px y caen 10 px con `rotate ±4°` (360 ms) |
| F8 | Escalera | Barras de llenado `scaleX` por día (260 ms por día, `linear`); contador de día cambia sin transición; sticker de pausa entra como F2; **ráfaga de confeti** al agotarse cada etapa (900 ms, 24 piezas) |
| F9 | Plancha de promotores | Los stickers aparecen con pop stagger 70 ms; los anillos de usos se dibujan (`stroke-dashoffset`, 600 ms); al tocar, **se despega**: `rotateY 0→180°` con `perspective` (420 ms) y una esquina levantada (sombra que crece); reordenar con FLIP 320 ms |
| F10 | Tira de negativo | Cuadros entran con stagger 80 ms (`translateX 24px`); el sticker `Quedan N` hace pop a 300 ms |
| F11 | Muro | La reacción nueva salta (`scale 1→1.2→1`, 240 ms), como `WallDemo` |
| F12 | Escáner | El banner de resultado baja (`translateY -12px→0`, 200 ms); el ❌ se sacude (`translateX ±4px` × 3, 240 ms); el contador sube sin interpolar |
| F13 | Línea de tiempo de la noche | Las horas se encienden en orden al 30% de visibilidad (stagger 150 ms); la foto de montaje con F1 en versión corta (sin giro) |
| F14 | Calculadora | Montos interpolan 250 ms (opcional) |
| F15 | Hoja de contactos | Las fotos aparecen una a una con flash (stagger 120 ms), solo la primera vez |
| F16 | Confeti estático (hero y cierre) | Flota `translateY ±6px` y `rotate ±8°`, 6–9 s alternado, desfasado por pieza; pausado fuera de viewport |
| F17 | Pulsera de progreso del header | `scaleX` según scroll (estado, sin transición); cambia de color al cambiar de sección |
| F18 | Cierre | La pulsera reescribe el nombre al teclear (sin animación por letra); el CTA principal tiene un único "golpe" de sombra al entrar en viewport |

---

## 7. Rendimiento

- **LCP = foto del hero** (`aitk-fiesta-pista`): AVIF/WebP a 640 y 1024 (sharp, como las demás; la referencia mide 1024 px: la real debe venir a ≥ 2400 px y entonces se suma 1344/2048), `fetchpriority="high"`, sin `loading="lazy"`.
- Bagel Fat One: un archivo `latin` 400, `preload` solo en esta página si no lo inlinea Vite (si pesa menos que `assetsInlineLimit`, como Doto en clubs, se inlinea y no hace falta preload), fallback con `size-adjust` (CLS < 0,05). El H1 tiene que ser legible con el fallback si la fuente tarda.
- Pulseras, stickers, confeti, viñeta de flash y perforaciones del negativo son CSS/SVG inline (sin imágenes); la textura de Tyvek es un `data:` SVG < 2 KB compartido. Sin `filter: blur` animado.
- La ráfaga de confeti crea 24 nodos y los borra al terminar; nunca más de una ráfaga a la vez.
- Islas Vue con `client:visible` (`PresaleStairs`, `PromoSheet`, `PartyAdsDemo`, `PartyWall`, `DoorScanner`, `StageCalculator`, `BandNamer`) y `client:idle` (`PartyHeader`, `LandingMobileBar`). La página se lee completa sin JS (estados SSR descritos en cada sección).
- Fotos repetidas (la del hero aparece recortada en la historia, el teléfono y la hoja de contactos) usan el **mismo archivo** con `object-position` distinto: una sola descarga.
- Resto de fotos `loading="lazy"`, `srcset`, `aspect-ratio` reservado. Lighthouse móvil ≥ 90 en performance y accesibilidad.
- Probar en Safari iOS el `rotateY` con `backface-visibility` de los stickers de promotor dentro de contenedores girados; si falla, el cambio de cara es un fundido.

---

## 8. Fotos

**Se reutilizan** (todas en `public/landing/`; generar AVIF/WebP de las que aún no tienen):

| Uso | Archivo | Tratamiento | Variantes |
|---|---|---|---|
| Hero, flyer de las historias, teléfono, hoja de contactos | `aitk-fiesta-pista.jpg` (3:2, 1024 px) | desechable + fecha | 640/1024 (crear) |
| Hecho para (tira de photobooth), hoja de contactos | `aitk-fiesta-universitaria.jpg` (4:5, 896 px) | tira de 3 cuadros | 480/896 (crear) |
| Promotores | `aitk-fiesta-promotor.jpg` (4:5, 896 px) | desechable | 480/896 (crear) |
| La noche (17:00, montaje) | `aitk-fiesta-montaje.jpg` (4:5, 896 px) | desechable chica | 480/896 (crear) |
| Hoja de contactos (una de las 6) | `aitk-publico.jpg` (ya tiene variantes) | desechable chica | existentes |

No se usan `aitk-puerta-qr` ni las de clubs para no repetir fotos de otras landings; la puerta va con el escáner dibujado. No se generan imágenes nuevas. La foto de montaje muestra mesas puestas (parece un matrimonio): sirve de referencia de tono, pero la real debe ser un galpón o casona preparándose para una fiesta.

**Fotos reales que harían falta** (con autorización escrita de la productora y, si se reconocen, de las personas; en fiestas universitarias, **solo mayores de edad**):
1. Hero: pista llena en un galpón o casona, con confeti o luces, horizontal, ≥ 2400 px, con espacio para el titular a la izquierda y **sin banderas ni marcas** en el fondo.
2. Grupo de amigos en una fiesta (selfie o foto de grupo), vertical, **sin vasos con alcohol visibles** (o desenfocados).
3. Promotor o promotora mostrando su código/link en el celular, vertical.
4. Equipo montando una fiesta en un galpón (luces, DJ, barra), vertical.
5. Puerta de una fiesta: celular escaneando un QR con fila detrás, vertical (opcional: hoy la sección va sin foto).
6. 4–6 fotos "de desechable" de una fiesta real para la hoja de contactos del día después.
7. Testimonio: retrato de quien da la cita.

---

## 9. SEO

- **Title** (`landings.ts`): *Ticketera para fiestas en Chile: preventa por etapas y códigos para promotores · 0% de comisión | AI Tickets*
- **Description:** *Vende entradas para tu fiesta: preventa por etapas con fecha de apertura, un código y un link para cada promotor, tu flyer en Instagram toda la semana y check-in con QR aunque no haya señal. 0% de comisión para la productora.*
- **H1 visible sin JS** (el del hero). El `h1` de `landings.ts`: "Preventa 1: agotada. ¿Abrimos la 2?". Card: `{ title: "Fiestas", text: "Preventa por etapas, un código para cada promotor y la puerta con QR aunque no haya señal." }`. `eyebrow`: "Para productoras de fiestas y centros de estudiantes". `kind: "vertical"`, `sections: []`, `faq`: las propias de fiestas que no vienen de PRODUCER_FAQ/ORGANIZADORES_FAQ (como música, talleres y clubs), `demo` (Preguntas abiertas 10), `cta: { label: "Publicar mi fiesta", campaign: "vertical_fiestas" }`, `related: ["ventas-por-promotor", "ticketera-discotecas", "entradas-con-qr"]`, `dedicated: true`. Cambio aditivo: agregar `"ticketera-fiestas"` a `related` de `ticketera-discotecas` (lo pedía su spec) Como clubs y música son `dedicated` y no leen `related`, también se suma `fiestas` (aditivo) a la fila "También para …" de sus cierres (`ClubClosing.astro`, `MusicClosing.astro`), para que las tres landings de noche se enlacen entre sí.
- **Palabras clave a cubrir en el texto, sin forzar** (búsquedas en Chile): ticketera para fiestas, venta de entradas para fiestas, vender entradas fiesta, preventa fiesta, preventa por etapas, entradas fiesta universitaria, fiesta mechona, fiesta de carrera, centro de estudiantes fiesta, fiesta temática Santiago, fiesta de los 2000, fiesta Halloween entradas, fiesta Año Nuevo entradas, fiesta en galpón, códigos de descuento para promotores, link de promotor, entradas con QR para fiestas, control de acceso fiesta, productora de fiestas, ticketera sin comisión.
- **JSON-LD:** `BreadcrumbList` (AI Tickets → Para organizadores → Fiestas), `SoftwareApplication` con `Offer` armada con constantes (como música y clubs) y `FAQPage` con `FIESTAS_FAQ`.
- Imagen OG: el hero (`image={PARTY_PHOTOS.hero.src}`).
- Links internos: `/organizadores`, `/ticketera-discotecas`, `/ticketera-musica-en-vivo`, `/ventas-por-promotor`, `/entradas-con-qr`, `/web-gratis`, `/guias/como-hacer-una-preventa`, `/guias/como-medir-ventas-por-promotor`, `/guias/como-hacer-check-in-con-qr`, `/ticketeras-en-chile`.
- Sitemap: la URL la arma `landings.ts`.
- Alt de fotos descriptivos: *Gente saltando con los brazos arriba en una fiesta en un galpón, con confeti en el aire*, *Grupo de amigos sacándose una selfie en una fiesta al aire libre al atardecer*, *Promotora mostrando su celular a un amigo en una barra*, *Equipo de producción colgando luces y armando el lugar de la fiesta*.

---

## 10. Analítica

Prefijo `fi_`, mismo mecanismo que `ClubTracking.astro` (atributos `data-fi-*` + `CtaTracking`):
- `fi_view`, `fi_cta_click {position}` (`hero`, `closing`, `header`, `mobile_bar`), `fi_demo_click {position}`, `fi_whatsapp_click`, `fi_faq_open {question}`, `fi_section_view {section}`.
- Propios: `fi_stairs_play`, `fi_stairs_count {n}`, `fi_stairs_edit {stage, field}` (debounce; sin el valor), `fi_stairs_choice {stage, choice: "advance" | "wait"}`, `fi_stairs_end {sold, total}`, `fi_promo_flip {code}`, `fi_promo_mode {mode}`, `fi_promo_sort {by}`, `fi_link_copy`, `fi_wall_react {emoji}`, `fi_scan_demo {case}`, `fi_ads_demo {budget, days}`, `fi_calc_change {payer, stages}` (debounce), `fi_band_name` (una vez, **sin el texto**).

---

## 11. Componentes

Carpeta `src/components/landing/fiestas/`; datos y cálculos sin Node en `fiestasLanding.js` (como `clubsLanding.js`): fotos, fecha de la fiesta de ejemplo y aperturas de cada etapa (ISO en hora de Chile), etapas por defecto, demanda diaria y `playPresale(stages, choices)`, stickers de promotores con sus totales (`computeDiscountedTotals`), canales de ejemplo, casos del escáner, hora de cobro (término + `PAYOUT_RELEASE_HOURS`), fecha estampada, posiciones del confeti. `fiestasLanding.client.js`: ráfaga de confeti y helpers de DOM.

| Componente | Tipo | Notas |
|---|---|---|
| `PartyHeader.vue` | isla `client:idle` | patrón de `StandupHeader`, pulsera de progreso en vez de barra de lectura |
| `Wristband.astro` | estático | pulsera: `color`, `label`, `serial`, `cut`, `tilt`; separador de sección |
| `Sticker.astro` | estático | troquelado: `shape`, `tone`, `tilt` |
| `StickerHeading.astro` | estático | H1/H2 en Bagel con la parte en sticker (prop `sticker`) |
| `DisposablePhoto.astro` | estático | `<picture>` con marco, flash y fecha estampada |
| `PhotoStrip.astro` | estático | tira de photobooth |
| `Confetti.astro` | estático | piezas estáticas desde el archivo de datos |
| `PartyHero.astro` | estático + CSS | H1, foto, card "Tu fiesta" |
| `PartyForWho.astro` | estático | stickers, tira, banda de centros de estudiantes |
| `PresaleStairs.vue` | isla `client:visible` | la escalera (firma): editor, simulación, pausas, `BuyerPreview`; SSR con el estado inicial y tabla |
| `BuyerPreview.vue` | dentro de `PresaleStairs` | filas con rótulos reales (`formatSaleStart`) |
| `PartyPromoters.astro` | estático | texto, foto, ítems |
| `PromoSheet.vue` | isla `client:visible` | plancha de stickers + vista de links + copiar |
| `PartyDiffusion.astro` | estático | serie + cards |
| `FilmStrip.astro` | estático | historias con `pieceText` (por props) |
| `AiPieceCard.astro` | estático | piezas con IA |
| `PartyAdsDemo.vue` | isla `client:visible` | piel nueva sobre `useAdsDemo` (sin duplicar la matemática) |
| `PartyPage.astro` | estático | teléfono, ítems, dirección |
| `PartyWall.vue` | isla `client:visible` | piel sticker; la lógica de `WallDemo.vue` se extrae a `useWallDemo` (src/composables, cambio aditivo: `WallDemo` pasa a usarlo sin cambiar su comportamiento) |
| `PartyNight.astro` | estático | línea de tiempo + ítems |
| `DoorScanner.vue` | isla `client:visible` | escáner de ejemplo con textos reales |
| `PartyPrice.astro` | estático | texto de precio + cobro |
| `StageCalculator.vue` | isla `client:visible` | etapas + `priceQuote` + `usePayerToggle` + `useDelayedAnnouncement` |
| `DayAfter.astro` | estático | hoja de contactos + cards |
| `PartyQuote.astro` | estático | no renderiza sin `PARTY_TESTIMONIAL` |
| `PartyClosing.astro` | estático | H2, CTAs |
| `BandNamer.vue` | isla `client:visible` | pulsera con el nombre (nada se envía ni se guarda) |
| `PartyTracking.astro` | script | eventos `fi_*` |

Compartidos sin cambios: `LandingFaq`, `LandingMobileBar` (`variant="pill"` con textos), `LandingMotion`, `CtaTracking`, `AppFooter tone="dark"`, `SoonBadge`. Cambios aditivos (anotar en el PR): entrada nueva en `landings.ts` (+ `related` de discotecas); `PARTY_TESTIMONIAL` en `producerSocialProof.ts`; link en `AppFooter.vue`; `useWallDemo` extraído de `WallDemo.vue`; dependencia `@fontsource/bagel-fat-one`; fila y commit en `README.md`.

Datos: `landings.ts` (§9), `src/data/fiestasFaq.ts` (§4.11).

Tests (como clubs): unitario de `fiestasLanding.js` — `playPresale`: vendidas nunca superan el cupo, una sola etapa a la venta por día, las etapas abren en orden, las pausas aparecen solo si la siguiente abre después del día en que se agotó, `advance` abre la siguiente ese día con el resto de la demanda, `wait` pierde la demanda hasta la apertura, y los casos de verificación de §4.3 (700/$7.850.000 adelantando siempre; 663/$7.448.000 esperando siempre); fecha de la fiesta = sábado ≥ 28 días después en hora de Chile y aperturas en lunes 20:00; rótulos con `formatSaleStart`; totales de promotores con `computeDiscountedTotals` (`CATA10` → $88.000 / $792.000); `Quedan N` de la historia D-7 bajo `scarcity_threshold_pct`; hora de cobro = término (domingo 05:00) + `PAYOUT_RELEASE_HOURS`. E2E de la página: carga, H1 visible sin JS, CTA, consola limpia, FAQ con JSON-LD, calculadora $10.000 → $10.952 / $10.000 y total $7.850.000, la escalera llega a la pausa "¿Abrimos la 2?" y al adelantar sigue, `Pronto` presente en lo de §0.7 que se muestra, sin testimonio cuando es `null`, con `prefers-reduced-motion` la escalera muestra `Siguiente día` y no hay ráfagas, barra mobile, mobile sin scroll horizontal (las pulseras a sangre). Agregar la URL a `tests/e2e/marketing.spec.ts` (H1 y sitemap).

---

## 12. Fases (commits dentro del PR único)

1. **Página y tema:** tema `fiestas`, Bagel Fat One, pulseras, stickers, fotos desechables; hero (sin animación), hecho para, escalera en su estado inicial + tabla, promotores estáticos, difusión con la tira de negativo, la fiesta empieza antes (muro estático), la noche con el escáner en su primer caso, precio con calculadora, día después, FAQ, cierre sin campo, footer; `landings.ts`, `fiestasFaq.ts`, link del footer, `related` de discotecas; fotos de referencia en AVIF/WebP. Criterio: `npm run check` sin errores; Lighthouse móvil ≥ 90.
2. **Interacción:** simulación de la escalera con pausas y decisiones, editor de etapas, plancha de promotores (despegar, ordenar, links, copiar), demo de anuncios, muro (`useWallDemo`), escáner con sus cuatro casos, calculadora por etapas, pulsera con nombre, pulsera de progreso del header.
3. **Movimiento:** F1–F18 y `prefers-reduced-motion`; analítica `fi_*`; tests.
4. **Contenido real:** fotos reales autorizadas (§8), testimonio, evento de ejemplo de fiesta, nombres de ejemplo revisados.

---

## 13. Preguntas abiertas

1. **URL:** `/ticketera-fiestas` sigue el patrón de las otras verticales. Confirmar con Search Console o Keyword Planner si "ticketera para fiestas" o "venta de entradas fiestas" tiene más volumen y si conviene, más adelante, una página aparte para **fiestas universitarias / centros de estudiantes** (búsqueda propia: "entradas fiesta mechona").
2. **Entre etapas la página dice "Agotado"** (bug para fiestas): en `eventPage.ts`, si la etapa vigente se agota y la siguiente abre más tarde, `saleState` queda en `sold_out` (hay entradas en ventana con stock 0) y la card muestra `Agotado` + "Avisarme si se liberan", en vez de `Venta abre el …` con la cuenta regresiva a la siguiente etapa. No se arregla en esta landing (abrir un issue: priorizar `upcoming` cuando ninguna entrada está a la venta y alguna abre después). Mientras tanto, la landing no promete la cuenta regresiva entre etapas, solo antes de la primera, y empuja a adelantar la siguiente.
3. **Programar etapas desde el panel:** es la mecánica central de esta landing y hoy solo existe por el asistente de IA o WhatsApp (`tools/tickets.ts`). ¿Entra al roadmap agregar "Inicio de venta" y "Fin de venta" en `EditEventForm.vue`? Si se agrega, quitar "desde tu asistente de IA…" de §4.3 y la FAQ 4.
4. **Abrir la siguiente etapa sola** (`Pronto`) y **aviso automático** a quienes dejaron su correo (`Pronto`): ¿están en el plan? Si no, sacarlos.
5. **Dirección secreta** (`Pronto`): la columna, la página ("Ubicación aproximada") y el correo ya la manejan; falta que la productora la cargue (panel o `tools/events.ts`). Es muy pedida en fiestas.
6. **Reserva por riesgo y fiestas:** las señales de `event-risk.mjs` castigan justo el patrón de una fiesta: productora nueva (+25), **lugar sin dirección exacta** (+20, si solo publican la comuna), **ritmo de ventas anómalo** (+20: un "drop" de preventa que vende ≥ 50 en 24 h y 5× el promedio) y **muchos compradores con un mismo teléfono** (+25: un promotor que compra para su grupo). Una productora nueva con un drop exitoso en un lugar "por confirmar" llega a nivel alto (≥ 50) y retendría el `{RESERVE_BY_LEVEL.high}`% hasta `{RESERVE_HOLD_DAYS}` días. ¿Se ajustan los pesos para preventas, o se explica en la landing (FAQ propia) para que no sea sorpresa? Hoy solo aparece en la FAQ 8 y 11 y en los términos (`*`).
7. **Escáner y medianoche:** igual que clubs (Preguntas abiertas 8 de su spec): `getFunctionCheck` compara la fecha de la función con el día de hoy en Chile; una entrada de una fiesta que empieza el sábado 23:00 escaneada el domingo 00:30 podría marcarse "de otra función" y pedir confirmación. Mismo issue; la landing no menciona ese aviso.
8. **Varias filas sin señal:** offline, cada celular solo conoce lo que validó él: el mismo pantallazo podría entrar una vez por cada celular desconectado, y el duplicado aparece al sincronizar (409). Por eso el copy dice "rechaza lo que ya escaneó" y "se cruza al volver la conexión". ¿Se agrega en el escáner un aviso post-sincronización de duplicados, o una recomendación de una fila por tipo de entrada?
9. **Promotores:** "cada promotor ve sus números" va con `Pronto` (igual que clubs). ¿Está en el plan? ¿Interesa un código "solo para medir" (0%) o la comisión/premio automático?
10. **Evento de ejemplo:** no hay un evento demo de fiesta en `demoEvent.mjs`. Mientras tanto el CTA secundario apunta a `/eventos/evento-demo-concierto` con "Ver un evento de ejemplo". ¿Se crea `evento-demo-fiesta` (sábado 23:00 → 05:00, Preventa 1 agotada, Preventa 2 a la venta, Preventa 3 y General con apertura futura)? Requiere una migración de datos como `202610140200_demo_events_free_and_tour.sql`: no se hace sin el visto bueno. Ojo con el punto 2: la demo debe tener una etapa a la venta para no mostrar "Agotado".
11. **Promos por cantidad** (4x3, pack de 5): no existen y son comunes en fiestas. ¿Roadmap? Hoy se puede un tipo de entrada "Pack 4" con su precio, pero emite **un** QR por unidad (como la mesa en clubs).
12. **Alcohol y menores:** la foto universitaria de referencia tiene un vaso rojo; confirmar criterio legal (Ley 21.363) y que en fiestas universitarias las fotos reales sean de mayores de edad. ¿La landing debería decir algo sobre fiestas con menores (+15, fiestas de colegio)? Hoy no lo menciona.
13. **Centros de estudiantes y cobro:** la banda de §4.2 dice que lo vendido llega a la cuenta registrada por quien aprobó su identidad. Confirmar con los términos de productores si una persona puede cobrar a su nombre la fiesta de un centro de estudiantes (o si hace falta RUT de la organización) antes de publicar ese detalle; si hay dudas, la banda se queda solo con "publicas gratis y cobras con Webpay".
14. **Muro "Quiénes van":** `ORGANIZADORES_FAQ` dice "un espacio en la página del evento", pero el muro vive en la página de la orden y de la entrada (solo asistentes). Esta landing usa la versión precisa (FAQ 16 reformulada); ¿se corrige también `ORGANIZADORES_FAQ`?
15. **Seminarios:** se diseña en paralelo. Mantener la tabla de §1 actualizada para que ninguna repita paleta (aquí: naranja + cobalto + crema a todo color), tipografía de acento (Bagel Fat One) ni firma (escalera de preventa + stickers que se despegan). Si seminarios toma azul cobalto o naranja, revisar.
16. **Historia del día de la fiesta:** `pieceText` en etapa `today` usa el llamado "Entradas en puerta o por DM", que sugiere venta en puerta (que AI Tickets no hace). La landing no muestra esa pieza; ¿se cambia el texto del producto?
17. **Bagel Fat One:** confirmar con el dueño la tipografía de acento (alternativas con el mismo espíritu "sticker": Titan One, Rubik Bubbles para el cierre). Verificar acentos, Ñ, ¿ y ¡ en el subset `latin`.
18. **Nombres de ejemplo:** "Fiesta Disquete", "DJ Topo", "@memes.ejemplo", "Galpón en Santiago": revisar que no coincidan con fiestas, DJs o cuentas reales antes de publicar.
